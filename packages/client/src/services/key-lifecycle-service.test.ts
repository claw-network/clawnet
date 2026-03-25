import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorCodes, TelagentError } from '../protocol/index.js';

import { KeyLifecycleService } from './key-lifecycle-service.js';

interface MutableClock {
  now(): number;
  tick(ms: number): void;
}

function createClock(startMs = 1_000_000): MutableClock {
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
  return `0x${seed.repeat(32)}`;
}

test('TA-P11-006 rotate key keeps old key usable in grace window then expires', () => {
  const clock = createClock();
  const service = new KeyLifecycleService({
    clock,
    defaultSignalGraceSec: 60,
  });

  service.registerKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    keyId: 'signal-key-v1',
    publicKey: keyHex('1'),
  });

  service.rotateKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    fromKeyId: 'signal-key-v1',
    toKeyId: 'signal-key-v2',
    publicKey: keyHex('2'),
  });

  const stillUsable = service.assertCanUseKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    keyId: 'signal-key-v1',
  });
  assert.equal(stillUsable.state, 'ROTATING');

  const nextUsable = service.assertCanUseKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    keyId: 'signal-key-v2',
  });
  assert.equal(nextUsable.state, 'ACTIVE');

  clock.tick(61_000);
  assert.throws(
    () =>
      service.assertCanUseKey({
        did: 'did:claw:zAlice',
        suite: 'signal',
        keyId: 'signal-key-v1',
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    },
  );
});

test('TA-P11-006 revoke and recover lifecycle is verifiable', () => {
  const service = new KeyLifecycleService();
  service.registerKey({
    did: 'did:claw:zAlice',
    suite: 'mls',
    keyId: 'mls-key-v1',
    publicKey: keyHex('a'),
  });

  const revoked = service.revokeKey({
    did: 'did:claw:zAlice',
    suite: 'mls',
    keyId: 'mls-key-v1',
    reason: 'device compromised',
  });
  assert.equal(revoked.state, 'REVOKED');

  assert.throws(
    () =>
      service.assertCanUseKey({
        did: 'did:claw:zAlice',
        suite: 'mls',
        keyId: 'mls-key-v1',
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    },
  );

  const recovered = service.recoverKey({
    did: 'did:claw:zAlice',
    suite: 'mls',
    revokedKeyId: 'mls-key-v1',
    recoveredKeyId: 'mls-key-v2',
    publicKey: keyHex('b'),
  });
  assert.equal(recovered.revoked.state, 'RECOVERED');
  assert.equal(recovered.recovered.state, 'ACTIVE');

  const activeAfterRecovery = service.assertCanUseKey({
    did: 'did:claw:zAlice',
    suite: 'mls',
    keyId: 'mls-key-v2',
  });
  assert.equal(activeAfterRecovery.state, 'ACTIVE');
});

test('TA-P11-006 rejects invalid did and malformed key id', () => {
  const service = new KeyLifecycleService();

  assert.throws(
    () =>
      service.registerKey({
        did: 'did:example:alice',
        suite: 'signal',
        keyId: 'signal-key-v1',
        publicKey: keyHex('3'),
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.VALIDATION);
      return true;
    },
  );

  assert.throws(
    () =>
      service.registerKey({
        did: 'did:claw:zAlice',
        suite: 'signal',
        keyId: 'x',
        publicKey: keyHex('4'),
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.VALIDATION);
      return true;
    },
  );
});
