import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorCodes, TelagentError, type AgentDID } from '../protocol/index.js';

import { KeyLifecycleService, type KeySuite } from './key-lifecycle-service.js';

interface MutableClock {
  now(): number;
  tick(ms: number): void;
}

interface FleetNode {
  nodeId: string;
  did: AgentDID;
  lifecycle: KeyLifecycleService;
}

function createClock(startMs = 5_000_000): MutableClock {
  let current = startMs;
  return {
    now() {
      return current;
    },
    tick(ms: number) {
      current += ms;
    },
  };
}

function keyHex(seed: string): string {
  return `0x${seed.repeat(64)}`;
}

function keyId(nodeId: string, suite: KeySuite, version: string): string {
  return `${suite}-${nodeId}-${version}`;
}

function isForbidden(error: unknown): boolean {
  return error instanceof TelagentError && error.code === ErrorCodes.FORBIDDEN;
}

test('TA-P12-007 orchestrator supports staged key rotation with rollback recovery', () => {
  const clock = createClock();
  const nodes: FleetNode[] = ['node-a', 'node-b', 'node-c'].map((nodeId) => ({
    nodeId,
    did: `did:claw:z${nodeId.replace('-', '').toUpperCase()}` as AgentDID,
    lifecycle: new KeyLifecycleService({
      clock,
      defaultSignalGraceSec: 90,
      defaultMlsGraceSec: 90,
    }),
  }));
  const oldKeys = new Map<string, { signal: string; mls: string }>();
  const currentKeys = new Map<string, { signal: string; mls: string }>();

  for (const node of nodes) {
    const signalV1 = keyId(node.nodeId, 'signal', 'v1');
    const mlsV1 = keyId(node.nodeId, 'mls', 'v1');
    node.lifecycle.registerKey({
      did: node.did,
      suite: 'signal',
      keyId: signalV1,
      publicKey: keyHex('1'),
    });
    node.lifecycle.registerKey({
      did: node.did,
      suite: 'mls',
      keyId: mlsV1,
      publicKey: keyHex('2'),
    });
    oldKeys.set(node.nodeId, { signal: signalV1, mls: mlsV1 });
    currentKeys.set(node.nodeId, { signal: signalV1, mls: mlsV1 });
  }

  // Batch 1 canary rotation on node-a.
  const canary = nodes[0];
  canary.lifecycle.rotateKey({
    did: canary.did,
    suite: 'signal',
    fromKeyId: currentKeys.get(canary.nodeId)!.signal,
    toKeyId: keyId(canary.nodeId, 'signal', 'v2'),
    publicKey: keyHex('3'),
    gracePeriodSec: 90,
  });
  canary.lifecycle.rotateKey({
    did: canary.did,
    suite: 'mls',
    fromKeyId: currentKeys.get(canary.nodeId)!.mls,
    toKeyId: keyId(canary.nodeId, 'mls', 'v2'),
    publicKey: keyHex('4'),
    gracePeriodSec: 90,
  });
  currentKeys.set(canary.nodeId, {
    signal: keyId(canary.nodeId, 'signal', 'v2'),
    mls: keyId(canary.nodeId, 'mls', 'v2'),
  });

  // Other nodes remain unchanged before next batch.
  assert.equal(currentKeys.get('node-b')?.signal, keyId('node-b', 'signal', 'v1'));
  assert.equal(currentKeys.get('node-c')?.mls, keyId('node-c', 'mls', 'v1'));

  // Batch 2 rotate node-b and node-c.
  for (const node of [nodes[1], nodes[2]]) {
    const current = currentKeys.get(node.nodeId)!;
    node.lifecycle.rotateKey({
      did: node.did,
      suite: 'signal',
      fromKeyId: current.signal,
      toKeyId: keyId(node.nodeId, 'signal', 'v2'),
      publicKey: keyHex('5'),
      gracePeriodSec: 90,
    });
    node.lifecycle.rotateKey({
      did: node.did,
      suite: 'mls',
      fromKeyId: current.mls,
      toKeyId: keyId(node.nodeId, 'mls', 'v2'),
      publicKey: keyHex('6'),
      gracePeriodSec: 90,
    });
    currentKeys.set(node.nodeId, {
      signal: keyId(node.nodeId, 'signal', 'v2'),
      mls: keyId(node.nodeId, 'mls', 'v2'),
    });
  }

  // Inject failure on node-c and execute rollback recovery.
  const failed = nodes[2];
  const failedCurrent = currentKeys.get(failed.nodeId)!;
  failed.lifecycle.revokeKey({
    did: failed.did,
    suite: 'signal',
    keyId: failedCurrent.signal,
    reason: 'canary-failed',
  });
  failed.lifecycle.revokeKey({
    did: failed.did,
    suite: 'mls',
    keyId: failedCurrent.mls,
    reason: 'canary-failed',
  });

  assert.equal(
    (() => {
      try {
        failed.lifecycle.assertCanUseKey({
          did: failed.did,
          suite: 'signal',
          keyId: failedCurrent.signal,
        });
        return false;
      } catch (error) {
        return isForbidden(error);
      }
    })(),
    true,
  );

  const signalRollback = `${failedCurrent.signal}-rollback`;
  const mlsRollback = `${failedCurrent.mls}-rollback`;
  failed.lifecycle.recoverKey({
    did: failed.did,
    suite: 'signal',
    revokedKeyId: failedCurrent.signal,
    recoveredKeyId: signalRollback,
    publicKey: keyHex('7'),
  });
  failed.lifecycle.recoverKey({
    did: failed.did,
    suite: 'mls',
    revokedKeyId: failedCurrent.mls,
    recoveredKeyId: mlsRollback,
    publicKey: keyHex('8'),
  });
  currentKeys.set(failed.nodeId, {
    signal: signalRollback,
    mls: mlsRollback,
  });

  // Grace period expiry should retire v1 keys.
  clock.tick(91_000);
  for (const node of nodes) {
    const old = oldKeys.get(node.nodeId)!;
    for (const suite of ['signal', 'mls'] as const) {
      assert.equal(
        (() => {
          try {
            node.lifecycle.assertCanUseKey({
              did: node.did,
              suite,
              keyId: old[suite],
            });
            return false;
          } catch (error) {
            return isForbidden(error);
          }
        })(),
        true,
      );
    }
  }

  // Final fleet health.
  for (const node of nodes) {
    const current = currentKeys.get(node.nodeId)!;
    node.lifecycle.assertCanUseKey({
      did: node.did,
      suite: 'signal',
      keyId: current.signal,
    });
    node.lifecycle.assertCanUseKey({
      did: node.did,
      suite: 'mls',
      keyId: current.mls,
    });
  }
});
