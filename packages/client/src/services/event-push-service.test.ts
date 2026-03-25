import assert from 'node:assert/strict';
import test from 'node:test';

import { EventPushService } from './event-push-service.js';

function createService(overrides?: {
  createSubscriptionDelegation?: (input: Record<string, unknown>) => Promise<{ delegationId: string; expiresAtMs: number }>;
  proxyRequest?: (...args: unknown[]) => Promise<{ status: number; bodyBytes?: Uint8Array }>;
}) {
  const clawnetGateway = {
    client: {
      identity: { did: 'did:claw:zGateway' },
      messaging: {
        createSubscriptionDelegation: overrides?.createSubscriptionDelegation
          ?? (async () => ({ delegationId: 'dlg-1', expiresAtMs: 123 })),
        revokeSubscriptionDelegation: async () => undefined,
      },
    },
    getSelfIdentity: async () => ({ did: 'did:claw:zGateway' }),
    baseUrl: 'http://127.0.0.1:9528',
  };

  const apiProxyService = overrides?.proxyRequest
    ? {
        proxyRequest: overrides.proxyRequest,
      }
    : undefined;

  return new EventPushService(
    clawnetGateway as never,
    apiProxyService as never,
  );
}

test('createDelegation forwards requested topics and metadataOnly', async () => {
  let captured: Record<string, unknown> | undefined;
  const service = createService({
    createSubscriptionDelegation: async (input) => {
      captured = input;
      return { delegationId: 'dlg-1', expiresAtMs: 123 };
    },
  });

  const result = await service.createDelegation('did:claw:zGateway', {
    topics: ['telagent/receipt'],
    metadataOnly: false,
    expiresInSec: 90,
  });

  assert.equal(result.delegationId, 'dlg-1');
  assert.deepEqual(captured?.topics, ['telagent/receipt']);
  assert.equal(captured?.metadataOnly, false);
  assert.equal(captured?.expiresInSec, 90);
});

test('gateway creates separate delegations for metadata and receipt channels', async () => {
  const proxyCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const service = createService({
    proxyRequest: async (_targetDid, _method, path, _headers, body) => {
      const parsed = JSON.parse(String(body)) as Record<string, unknown>;
      proxyCalls.push({ path: String(path), body: parsed });
      return {
        status: 201,
        bodyBytes: new TextEncoder().encode(JSON.stringify({
          data: { delegationId: `dlg-${proxyCalls.length}` },
        })),
      };
    },
  });

  (service as any).connectDelegationWs = () => undefined;

  let closeHandler: (() => void) | undefined;
  const res = {
    writableEnded: false,
    writeHead: () => undefined,
    write: () => true,
    end: () => {
      res.writableEnded = true;
      return res as never;
    },
    on: (event: string, handler: () => void) => {
      if (event === 'close') {
        closeHandler = handler;
      }
      return res as never;
    },
  };

  const clientId = await service.addGatewayClient(res as never, 'did:claw:zTarget');

  assert.equal(clientId, 'gateway-1');
  assert.equal(proxyCalls.length, 2);
  assert.equal(proxyCalls[0]?.path, '/api/v1/events/subscribe');
  assert.deepEqual(proxyCalls[0]?.body.topics, ['telagent/envelope', 'telagent/group-sync']);
  assert.equal(proxyCalls[0]?.body.metadataOnly, true);
  assert.deepEqual(proxyCalls[1]?.body.topics, ['telagent/receipt']);
  assert.equal(proxyCalls[1]?.body.metadataOnly, false);

  closeHandler?.();
});

test('delegated receipt payload is converted into envelopeId notification', () => {
  const service = createService();
  const notification = (service as any).delegatedMessageToNotification({
    topic: 'telagent/receipt',
    sourceDid: 'did:claw:zPeer',
    receivedAtMs: 100,
    payload: JSON.stringify({
      envelopeId: 'env-123',
      status: 'delivered',
      timestampMs: 100,
    }),
  });

  assert.deepEqual(notification, {
    type: 'receipt',
    sourceDid: 'did:claw:zPeer',
    envelopeId: 'env-123',
    atMs: 100,
  });
});
