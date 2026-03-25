import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiServer } from './api/server.js';
import type { RuntimeContext } from './api/types.js';
import { NodeMonitoringService } from './services/node-monitoring-service.js';

const AUTH_HEADERS = { authorization: 'Bearer tses_test_token' };

class FakeIdentityService {
  getSelfDid(): string {
    return 'did:claw:zSelf';
  }

  async getSelf() {
    return {
      did: 'did:claw:zSelf',
      didHash: '0x' + '1'.repeat(64),
      controller: '0x' + '1'.repeat(40),
      publicKey: '0x11',
      isActive: true,
      resolvedAtMs: Date.now(),
    };
  }

  async resolve(did: string) {
    if (!did.startsWith('did:claw:')) {
      throw new Error('invalid did');
    }
    return {
      did,
      didHash: '0x' + '2'.repeat(64),
      controller: '0x' + '2'.repeat(40),
      publicKey: '0x22',
      isActive: true,
      resolvedAtMs: Date.now(),
    };
  }

  notifyDidRevoked(did: string, options?: { source?: string; revokedAtMs?: number }) {
    return {
      did,
      didHash: '0x' + 'f'.repeat(64),
      revokedAtMs: options?.revokedAtMs ?? Date.now(),
      source: options?.source ?? 'test',
    };
  }
}

class FakeGroupService {
  createGroup() {
    throw new Error('not used');
  }
  inviteMember() {
    throw new Error('not used');
  }
  acceptInvite() {
    throw new Error('not used');
  }
  removeMember() {
    throw new Error('not used');
  }
  getGroup(groupId: string) {
    return {
      groupId,
      creatorDid: 'did:claw:zSelf',
      creatorDidHash: '0x' + '1'.repeat(64),
      groupDomain: 'alpha.tel',
      domainProofHash: '0x' + '3'.repeat(64),
      initialMlsStateHash: '0x' + '4'.repeat(64),
      state: 'ACTIVE',
      createdAtMs: Date.now(),
      txHash: '0x' + '5'.repeat(64),
      blockNumber: 100,
    };
  }
  listGroups() {
    return [this.getGroup('0x' + 'b'.repeat(64))];
  }
  listMembers() {
    return [];
  }
  getChainState(groupId: string) {
    return {
      groupId,
      state: 'ACTIVE',
      finalizedTxHash: '0x' + '5'.repeat(64),
      blockNumber: 100,
      updatedAtMs: Date.now(),
    };
  }
}

class FakeMessageService {
  private readonly privateConversations = new Set<string>();

  send() {
    throw new Error('not used');
  }
  pull() {
    return { items: [], nextCursor: null };
  }
  listRetracted() {
    return [];
  }
  async buildAuditSnapshot(options?: { sampleSize?: number; retractionScanLimit?: number }) {
    return {
      activeEnvelopeCount: 0,
      retractedCount: 0,
      retractedByReason: {
        REORGED_BACK: 0,
      },
      sampledRetractions: [],
      sampleSize: Math.max(1, Math.min(100, options?.sampleSize ?? 20)),
      retractionScanLimit: Math.max(1, Math.min(100_000, options?.retractionScanLimit ?? 2_000)),
    };
  }

  async listConversations() {
    const conversationId = 'direct:did:claw:zSelf:did:claw:zPeer';
    const isPrivate = this.privateConversations.has(conversationId);
    return [
      {
        conversationId,
        conversationType: 'direct',
        peerDid: 'did:claw:zPeer',
        displayName: 'did:claw:zPeer',
        lastMessagePreview: isPrivate ? null : 'hello',
        lastMessageAtMs: Date.now(),
        unreadCount: 0,
        private: isPrivate,
        avatarUrl: null,
      },
    ];
  }

  async setConversationPrivacy(conversationId: string, isPrivate: boolean) {
    if (isPrivate) {
      this.privateConversations.add(conversationId);
    } else {
      this.privateConversations.delete(conversationId);
    }

    return {
      conversationId,
      private: isPrivate,
      updatedAtMs: Date.now(),
    };
  }

  async listPrivateConversationIds() {
    return [...this.privateConversations];
  }
}

class FakeAttachmentService {
  initUpload() {
    return {
      objectKey: 'o1',
      uploadUrl: 'https://u',
      expiresInSec: 900,
    };
  }
  completeUpload() {
    return {
      objectKey: 'o1',
      manifestHash: '0x' + '1'.repeat(64),
      checksum: '0x11',
      completedAtMs: Date.now(),
    };
  }
}

class FakeKeyLifecycleService {
  registerKey() {
    return {
      did: 'did:claw:zSelf',
      suite: 'signal',
      keyId: 'signal-key-v1',
      publicKey: '0x11',
      state: 'ACTIVE',
      createdAtMs: Date.now(),
      activatedAtMs: Date.now(),
    };
  }

  rotateKey() {
    return {
      previous: this.registerKey(),
      current: {
        ...this.registerKey(),
        keyId: 'signal-key-v2',
      },
    };
  }

  revokeKey() {
    return {
      ...this.registerKey(),
      state: 'REVOKED',
      revokedAtMs: Date.now(),
      revokeReason: 'test',
    };
  }

  recoverKey() {
    return {
      revoked: {
        ...this.registerKey(),
        state: 'RECOVERED',
      },
      recovered: {
        ...this.registerKey(),
        keyId: 'signal-key-v3',
      },
    };
  }

  listKeys() {
    return [this.registerKey()];
  }

  assertCanUseKey() {
    return this.registerKey();
  }
}

class FakeClawNetGatewayService {
  baseUrl = 'http://127.0.0.1:9528';

  async getBalance(did?: string) {
    return {
      did: did ?? 'did:claw:zSelf',
      address: '0x' + '1'.repeat(40),
      native: '1000000000000000000',
      token: '2000000000000000000',
    };
  }

  async getNonce() {
    return {
      nonce: 1,
      address: '0x' + '1'.repeat(40),
    };
  }

  async resolveIdentity(did: string) {
    return {
      did,
      address: '0x' + '2'.repeat(40),
      isActive: true,
      controller: '0x' + '2'.repeat(40),
      activeKey: '0x22',
      document: {
        capabilities: ['chat'],
        keyHistory: [],
      },
    };
  }

  async getSelfIdentity() {
    return this.resolveIdentity('did:claw:zSelf');
  }
}

class FakeSessionManager {
  async unlock() {
    return {
      sessionToken: 'tses_test_token',
      expiresAt: new Date(Date.now() + 60_000),
      scope: ['transfer', 'escrow', 'market', 'contract', 'reputation', 'identity'],
    };
  }

  lock() {}

  getSessionInfo() {
    return {
      active: true,
      expiresAt: new Date(Date.now() + 60_000),
      scope: ['transfer'],
      operationsUsed: 0,
      createdAt: new Date(),
    };
  }
}

class FakeNonceManager {}

class FakeClawNetTransportService {
  async sendEnvelope() {
    return { messageId: 'fake-msg-id', delivered: true };
  }
  startListening() {}
  stopListening() {}
}

async function startTestServer() {
  const context: RuntimeContext = {
    config: { host: '127.0.0.1', port: 0 },
    identityService: new FakeIdentityService() as unknown as RuntimeContext['identityService'],
    groupService: new FakeGroupService() as unknown as RuntimeContext['groupService'],
    messageService: new FakeMessageService() as unknown as RuntimeContext['messageService'],
    attachmentService: new FakeAttachmentService() as unknown as RuntimeContext['attachmentService'],
    monitoringService: new NodeMonitoringService(),
    keyLifecycleService: new FakeKeyLifecycleService() as unknown as RuntimeContext['keyLifecycleService'],
    clawnetGateway: new FakeClawNetGatewayService() as unknown as RuntimeContext['clawnetGateway'],
    clawnetTransportService: new FakeClawNetTransportService() as unknown as RuntimeContext['clawnetTransportService'],
    sessionManager: new FakeSessionManager() as unknown as RuntimeContext['sessionManager'],
    nonceManager: new FakeNonceManager() as unknown as RuntimeContext['nonceManager'],
    contactService: {} as unknown as RuntimeContext['contactService'],
    selfProfileStore: {} as unknown as RuntimeContext['selfProfileStore'],
    peerProfileRepository: {} as unknown as RuntimeContext['peerProfileRepository'],
  };

  const server = new ApiServer(context);
  await server.start();

  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test('routes only serve /api/v1/* prefix', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const apiRes = await fetch(`${baseUrl}/api/v1/node`);
  assert.equal(apiRes.status, 200);
  const apiBody = (await apiRes.json()) as { data: { service: string } };
  assert.equal(apiBody.data.service, 'telagent-node');

  const noPrefixRes = await fetch(`${baseUrl}/v1/node`);
  assert.equal(noPrefixRes.status, 404);

  const conversationsRes = await fetch(`${baseUrl}/api/v1/conversations`, { headers: AUTH_HEADERS });
  assert.equal(conversationsRes.status, 200);
  const conversationsBody = (await conversationsRes.json()) as {
    data: Array<{ conversationId: string }>;
  };
  assert.equal(conversationsBody.data.length, 1);

  const privacyRes = await fetch(
    `${baseUrl}/api/v1/conversations/${encodeURIComponent('direct:did:claw:zSelf:did:claw:zPeer')}/privacy`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer tses_test_token',
      },
      body: JSON.stringify({ private: true }),
    },
  );
  assert.equal(privacyRes.status, 200);

  const permissionsRes = await fetch(`${baseUrl}/api/v1/owner/permissions`, { headers: AUTH_HEADERS });
  assert.equal(permissionsRes.status, 200);
  const permissionsBody = (await permissionsRes.json()) as {
    data: { mode: string; privateConversations: string[] };
  };
  assert.equal(permissionsBody.data.mode, 'observer');
  assert.equal(permissionsBody.data.privateConversations.includes('direct:did:claw:zSelf:did:claw:zPeer'), true);

  const auditRes = await fetch(`${baseUrl}/api/v1/node/audit-snapshot`);
  assert.equal(auditRes.status, 200);

  const noPrefixAuditRes = await fetch(`${baseUrl}/v1/node/audit-snapshot`);
  assert.equal(noPrefixAuditRes.status, 404);

  const revokeRes = await fetch(`${baseUrl}/api/v1/node/revocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      did: 'did:claw:zSelf',
      source: 'prefix-test',
    }),
  });
  assert.equal(revokeRes.status, 201);

  const noPrefixRevokeRes = await fetch(`${baseUrl}/v1/node/revocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      did: 'did:claw:zSelf',
      source: 'prefix-test',
    }),
  });
  assert.equal(noPrefixRevokeRes.status, 404);

  const noPrefixPrivacyRes = await fetch(
    `${baseUrl}/v1/conversations/${encodeURIComponent('direct:did:claw:zSelf:did:claw:zPeer')}/privacy`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer tses_test_token',
      },
      body: JSON.stringify({ private: false }),
    },
  );
  assert.equal(noPrefixPrivacyRes.status, 404);
});

test('identity endpoint responds with data envelope', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(`${baseUrl}/api/v1/identities/self`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { did: string } };
  assert.equal(body.data.did, 'did:claw:zSelf');
});
