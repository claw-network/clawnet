import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ErrorCodes, TelagentError, hashDid, type GroupState } from '../protocol/index.js';

import { KeyLifecycleService } from './key-lifecycle-service.js';
import { MessageService, type MessageIdentityService } from './message-service.js';
import { MessageRepository } from '../storage/message-repository.js';

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

function createMessageService(startMs?: number) {
  const clock = createClock(startMs);
  const groups = {} as ConstructorParameters<typeof MessageService>[0];
  const service = new MessageService(groups, { clock });
  return { service, clock };
}

function createGroupHarness() {
  const stateByGroup = new Map<string, GroupState>();
  const membersByGroup = new Map<string, Array<{ didHash: string; state: 'PENDING' | 'FINALIZED' | 'REMOVED' }>>();

  const groups = {
    getChainState(groupId: string) {
      const state = stateByGroup.get(groupId);
      if (!state) {
        throw new Error(`group(${groupId}) not found`);
      }
      return {
        groupId,
        state,
        updatedAtMs: Date.now(),
      };
    },
    listMembers(groupId: string) {
      return (membersByGroup.get(groupId) ?? []).map((member) => ({
        groupId,
        did: `did:claw:${member.didHash.slice(2, 10)}`,
        didHash: member.didHash,
        state: member.state,
        joinedAtMs: Date.now(),
      }));
    },
    listGroups() {
      return [...stateByGroup.keys()].map((groupId) => ({
        groupId,
        creatorDid: 'did:claw:zCreator',
        creatorDidHash: hashDid('did:claw:zCreator'),
        groupDomain: 'alpha.tel',
        domainProofHash: `0x${'1'.repeat(64)}`,
        initialMlsStateHash: `0x${'2'.repeat(64)}`,
        state: stateByGroup.get(groupId) ?? 'PENDING_ONCHAIN',
        createdAtMs: Date.now(),
      }));
    },
  } as unknown as ConstructorParameters<typeof MessageService>[0];

  return {
    groups,
    setGroupState(groupId: string, state: GroupState) {
      stateByGroup.set(groupId, state);
    },
    setMemberState(groupId: string, did: string, state: 'PENDING' | 'FINALIZED' | 'REMOVED') {
      const members = membersByGroup.get(groupId) ?? [];
      const didHash = hashDid(did);
      const nextMembers = members.filter((member) => member.didHash !== didHash);
      nextMembers.push({ didHash, state });
      membersByGroup.set(groupId, nextMembers);
    },
  };
}

function createGroupMessageService(groupId: string, state: GroupState, startMs?: number) {
  const clock = createClock(startMs);
  const harness = createGroupHarness();
  harness.setGroupState(groupId, state);
  harness.setMemberState(groupId, 'did:claw:zAlice', 'FINALIZED');

  const service = new MessageService(harness.groups, { clock });
  return {
    service,
    clock,
    setGroupState(nextState: GroupState) {
      harness.setGroupState(groupId, nextState);
    },
  };
}

function createDirectInput(overrides: Partial<Parameters<MessageService['send']>[0]> = {}) {
  return {
    envelopeId: 'env-base',
    senderDid: 'did:claw:zAlice',
    conversationId: 'direct:alice-bob',
    conversationType: 'direct' as const,
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zBob',
    mailboxKeyId: 'mailbox-1',
    sealedHeader: '0x11',
    ciphertext: '0x22',
    contentType: 'text' as const,
    ttlSec: 60,
    ...overrides,
  };
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

class MutableIdentityService implements MessageIdentityService {
  private readonly revokedDids = new Set<string>();
  private readonly revocationSubscribers = new Set<
    (event: { did: string; didHash: string; revokedAtMs: number; source: string }) => void
  >();

  revoke(did: string) {
    this.revokedDids.add(did);
  }

  subscribeDidRevocations(listener: (event: {
    did: string;
    didHash: string;
    revokedAtMs: number;
    source: string;
  }) => void): () => void {
    this.revocationSubscribers.add(listener);
    return () => {
      this.revocationSubscribers.delete(listener);
    };
  }

  emitRevocation(did: string, source = 'test'): void {
    this.revoke(did);
    const event = {
      did,
      didHash: hashDid(did),
      revokedAtMs: Date.now(),
      source,
    };
    for (const listener of this.revocationSubscribers) {
      listener(event);
    }
  }

  async assertActiveDid(rawDid: string): Promise<void> {
    if (this.revokedDids.has(rawDid)) {
      throw new TelagentError(ErrorCodes.UNPROCESSABLE, 'DID is revoked or inactive');
    }
  }
}

test('TA-P4-002 sequence allocator keeps per-conversation monotonic order', async () => {
  const { service } = createMessageService();

  const first = await service.send(createDirectInput({ envelopeId: 'env-a1', conversationId: 'direct:a' }));
  const second = await service.send(createDirectInput({ envelopeId: 'env-a2', conversationId: 'direct:a' }));
  const third = await service.send(createDirectInput({ envelopeId: 'env-b1', conversationId: 'direct:b' }));

  assert.equal(first.seq, 1n);
  assert.equal(second.seq, 2n);
  assert.equal(third.seq, 1n);
});

test('TA-P4-003 dedupe keeps idempotent writes for same envelopeId', async () => {
  const { service } = createMessageService();
  const input = createDirectInput({ envelopeId: 'env-dedupe-1', conversationId: 'direct:a' });

  const first = await service.send(input);
  const second = await service.send({ ...input });

  assert.equal(first.envelopeId, 'env-dedupe-1');
  assert.equal(second.envelopeId, first.envelopeId);
  assert.equal(second.seq, first.seq);

  const pulled = await service.pull({ conversationId: 'direct:a', limit: 20 });
  assert.equal(pulled.items.length, 1);
});

test('TA-P4-003 duplicate envelopeId with different payload is rejected', async () => {
  const { service } = createMessageService();
  const input = createDirectInput({ envelopeId: 'env-dedupe-2', conversationId: 'direct:a' });
  await service.send(input);

  await assert.rejects(
    async () =>
      service.send({
        ...input,
        ciphertext: '0x33',
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.CONFLICT);
      return true;
    },
  );
});

test('TA-P14-004 direct conversation rejects non-participant writer after two participants are established', async () => {
  const { service } = createMessageService();
  const conversationId = 'direct:p14-acl';

  const first = await service.send(createDirectInput({
    envelopeId: 'env-p14-acl-1',
    senderDid: 'did:claw:zAlice',
    conversationId,
  }));
  assert.equal(first.envelopeId, 'env-p14-acl-1');

  const second = await service.send(createDirectInput({
    envelopeId: 'env-p14-acl-2',
    senderDid: 'did:claw:zBob',
    conversationId,
  }));
  assert.equal(second.envelopeId, 'env-p14-acl-2');

  await assert.rejects(
    async () =>
      service.send(createDirectInput({
        envelopeId: 'env-p14-acl-3',
        senderDid: 'did:claw:zCarol',
        conversationId,
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      assert.match(error.message, /direct conversation participant/);
      return true;
    },
  );

  const fromExisting = await service.send(createDirectInput({
    envelopeId: 'env-p14-acl-4',
    senderDid: 'did:claw:zBob',
    conversationId,
  }));
  assert.equal(fromExisting.envelopeId, 'env-p14-acl-4');
});

test('TA-P14-004 direct conversation ACL remains effective after repository-backed restart', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telagent-p14-direct-acl-'));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const dbPath = path.join(tempDir, 'mailbox.sqlite');
  const clock = createClock(12_000);
  const groups = {} as ConstructorParameters<typeof MessageService>[0];

  const repoA = new MessageRepository(dbPath);
  const serviceA = new MessageService(groups, { clock, repository: repoA });
  await serviceA.send(createDirectInput({
    envelopeId: 'env-p14-acl-restart-1',
    senderDid: 'did:claw:zAlice',
    conversationId: 'direct:p14-acl-restart',
  }));
  await serviceA.send(createDirectInput({
    envelopeId: 'env-p14-acl-restart-2',
    senderDid: 'did:claw:zBob',
    conversationId: 'direct:p14-acl-restart',
  }));

  const repoB = new MessageRepository(dbPath);
  const serviceB = new MessageService(groups, { clock, repository: repoB });
  await assert.rejects(
    async () =>
      serviceB.send(createDirectInput({
        envelopeId: 'env-p14-acl-restart-3',
        senderDid: 'did:claw:zCarol',
        conversationId: 'direct:p14-acl-restart',
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    },
  );
});

test('TA-P4-004 cleanupExpired removes expired envelopes and releases dedupe key', async () => {
  const { service, clock } = createMessageService(1_000);

  const expiredInput = createDirectInput({
    envelopeId: 'env-expired',
    conversationId: 'direct:ttl',
    ttlSec: 1,
  });
  const longLivedInput = createDirectInput({
    envelopeId: 'env-active',
    conversationId: 'direct:ttl',
    ttlSec: 100,
  });

  const first = await service.send(expiredInput);
  assert.equal(first.seq, 1n);
  clock.tick(400);
  await service.send(longLivedInput);

  clock.tick(1_100);
  const report = await service.cleanupExpired();
  assert.equal(report.removed, 1);
  assert.equal(report.remaining, 1);

  const pulled = await service.pull({ conversationId: 'direct:ttl', limit: 20 });
  assert.equal(pulled.items.length, 1);
  assert.equal(pulled.items[0].envelopeId, 'env-active');

  const resent = await service.send({
    ...expiredInput,
    ttlSec: 20,
    ciphertext: '0x44',
  });
  assert.equal(resent.envelopeId, 'env-expired');
  assert.equal(resent.seq, 3n);
});

test('TA-P14-003 conversation pull cursor stays stable after cleanup between pages', async () => {
  const { service, clock } = createMessageService(10_000);

  await service.send(createDirectInput({
    envelopeId: 'env-p14-cursor-conv-1',
    conversationId: 'direct:p14-cursor-conv',
    ttlSec: 1,
  }));
  clock.tick(100);

  await service.send(createDirectInput({
    envelopeId: 'env-p14-cursor-conv-2',
    conversationId: 'direct:p14-cursor-conv',
    ttlSec: 120,
  }));
  clock.tick(100);

  await service.send(createDirectInput({
    envelopeId: 'env-p14-cursor-conv-3',
    conversationId: 'direct:p14-cursor-conv',
    ttlSec: 120,
  }));

  const page1 = await service.pull({
    conversationId: 'direct:p14-cursor-conv',
    limit: 2,
  });
  assert.deepEqual(
    page1.items.map((item) => item.envelopeId),
    ['env-p14-cursor-conv-1', 'env-p14-cursor-conv-2'],
  );
  assert.equal(page1.nextCursor, '2');

  clock.tick(1_100);

  const page2 = await service.pull({
    conversationId: 'direct:p14-cursor-conv',
    limit: 2,
    cursor: page1.nextCursor ?? undefined,
  });
  assert.deepEqual(
    page2.items.map((item) => item.envelopeId),
    ['env-p14-cursor-conv-3'],
  );
  assert.equal(page2.nextCursor, null);
});

test('TA-P14-003 global pull cursor is keyset token and survives cleanup drift', async () => {
  const { service, clock } = createMessageService(20_000);

  await service.send(createDirectInput({
    envelopeId: 'env-p14-cursor-global-1',
    conversationId: 'direct:p14-cursor-global-a',
    ttlSec: 1,
  }));
  clock.tick(100);

  await service.send(createDirectInput({
    envelopeId: 'env-p14-cursor-global-2',
    conversationId: 'direct:p14-cursor-global-b',
    ttlSec: 120,
  }));
  clock.tick(100);

  await service.send(createDirectInput({
    envelopeId: 'env-p14-cursor-global-3',
    conversationId: 'direct:p14-cursor-global-c',
    ttlSec: 120,
  }));

  const page1 = await service.pull({ limit: 2 });
  assert.deepEqual(
    page1.items.map((item) => item.envelopeId),
    ['env-p14-cursor-global-1', 'env-p14-cursor-global-2'],
  );
  assert.ok(page1.nextCursor);
  assert.match(page1.nextCursor!, /^g1\./);

  clock.tick(1_100);

  const page2 = await service.pull({
    limit: 2,
    cursor: page1.nextCursor ?? undefined,
  });
  assert.deepEqual(
    page2.items.map((item) => item.envelopeId),
    ['env-p14-cursor-global-3'],
  );
  assert.equal(page2.nextCursor, null);
});

test('TA-P4-005 provisional envelopes are retracted when group is reorged back', async () => {
  const groupId = `0x${'a'.repeat(64)}`;
  const { service, setGroupState } = createGroupMessageService(groupId, 'PENDING_ONCHAIN', 5_000);

  const envelope = await service.send({
    envelopeId: 'env-provisional-1',
    senderDid: 'did:claw:zAlice',
    conversationId: `group:${groupId}`,
    conversationType: 'group',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zBob',
    mailboxKeyId: 'mailbox-1',
    sealedHeader: '0x11',
    ciphertext: '0x22',
    contentType: 'text',
    ttlSec: 3600,
  });

  assert.equal(envelope.provisional, true);
  assert.equal((await service.pull({ conversationId: `group:${groupId}` })).items.length, 1);

  setGroupState('REORGED_BACK');
  const afterReorg = await service.pull({ conversationId: `group:${groupId}` });
  assert.equal(afterReorg.items.length, 0);

  const retracted = await service.listRetracted();
  assert.equal(retracted.length, 1);
  assert.equal(retracted[0].envelopeId, 'env-provisional-1');
  assert.equal(retracted[0].reason, 'REORGED_BACK');
});

test('TA-P4-005 send is rejected when group chain state is REORGED_BACK', async () => {
  const groupId = `0x${'b'.repeat(64)}`;
  const { service } = createGroupMessageService(groupId, 'REORGED_BACK', 9_000);

  await assert.rejects(
    async () =>
      service.send({
        envelopeId: 'env-provisional-2',
        senderDid: 'did:claw:zAlice',
        conversationId: `group:${groupId}`,
        conversationType: 'group',
        targetDomain: 'alpha.tel',
        targetDid: 'did:claw:zBob',
        mailboxKeyId: 'mailbox-1',
        sealedHeader: '0x11',
        ciphertext: '0x22',
        contentType: 'text',
        ttlSec: 3600,
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.CONFLICT);
      assert.match(error.message, /REORGED_BACK/);
      return true;
    },
  );
});

test('TA-P12-002 buildAuditSnapshot exports hashed retraction samples', async () => {
  const groupId = `0x${'d'.repeat(64)}`;
  const { service, setGroupState } = createGroupMessageService(groupId, 'PENDING_ONCHAIN', 15_000);

  await service.send({
    envelopeId: 'env-audit-1',
    senderDid: 'did:claw:zAlice',
    conversationId: `group:${groupId}`,
    conversationType: 'group',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zBob',
    mailboxKeyId: 'mailbox-1',
    sealedHeader: '0x11',
    ciphertext: '0x22',
    contentType: 'text',
    ttlSec: 3600,
  });

  setGroupState('REORGED_BACK');
  await service.pull({ conversationId: `group:${groupId}`, limit: 20 });

  const snapshot = await service.buildAuditSnapshot({
    sampleSize: 1,
    retractionScanLimit: 10,
  });

  assert.equal(snapshot.activeEnvelopeCount, 0);
  assert.equal(snapshot.retractedCount, 1);
  assert.equal(snapshot.retractedByReason.REORGED_BACK, 1);
  assert.equal(snapshot.sampledRetractions.length, 1);
  assert.equal(snapshot.sampledRetractions[0].envelopeIdHash, digest('env-audit-1'));
  assert.equal(snapshot.sampledRetractions[0].conversationIdHash, digest(`group:${groupId}`));
  assert.equal(snapshot.sampledRetractions[0].reason, 'REORGED_BACK');
  assert.equal(snapshot.sampleSize, 1);
  assert.equal(snapshot.retractionScanLimit, 10);
});

test('TA-P12-002 buildAuditSnapshot normalizes sample and scan bounds', async () => {
  const { service } = createMessageService(20_000);

  const snapshot = await service.buildAuditSnapshot({
    sampleSize: 0,
    retractionScanLimit: 999_999,
  });

  assert.equal(snapshot.sampleSize, 1);
  assert.equal(snapshot.retractionScanLimit, 100_000);
});

test('TA-P12-003 revoked DID event isolates related sessions and evicts active sessions', async () => {
  const groupId = `0x${'e'.repeat(64)}`;
  const harness = createGroupHarness();
  harness.setGroupState(groupId, 'ACTIVE');
  harness.setMemberState(groupId, 'did:claw:zAlice', 'FINALIZED');

  const identityService = new MutableIdentityService();
  const service = new MessageService(harness.groups, {
    clock: createClock(25_000),
    identityService,
  });

  await service.send(createDirectInput({
    envelopeId: 'env-isolation-direct-1',
    conversationId: 'direct:isolation-case',
  }));
  await service.send({
    envelopeId: 'env-isolation-group-1',
    senderDid: 'did:claw:zAlice',
    conversationId: `group:${groupId}`,
    conversationType: 'group',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zBob',
    mailboxKeyId: 'mailbox-1',
    sealedHeader: '0x11',
    ciphertext: '0x33',
    contentType: 'text',
    ttlSec: 3600,
  });

  identityService.emitRevocation('did:claw:zAlice', 'test-revoke-feed');

  const isolatedConversations = service.listIsolatedConversations(10);
  const isolatedConversationIds = isolatedConversations.map((entry) => entry.conversationId).sort();
  assert.deepEqual(
    isolatedConversationIds,
    [`direct:isolation-case`, `group:${groupId}`].sort(),
  );

  const isolationEvents = service.listIsolationEvents(10);
  assert.equal(isolationEvents.length, 1);
  assert.equal(isolationEvents[0].didHash, hashDid('did:claw:zAlice'));
  assert.equal(isolationEvents[0].isolatedConversationCount, 2);
  assert.equal(isolationEvents[0].evictedConversationCount, 2);

  await assert.rejects(
    async () =>
      service.send(createDirectInput({
        envelopeId: 'env-isolation-direct-2',
        senderDid: 'did:claw:zBob',
        conversationId: 'direct:isolation-case',
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.UNPROCESSABLE);
      assert.match(error.message, /isolated/);
      return true;
    },
  );

  await assert.rejects(
    async () =>
      service.send(createDirectInput({
        envelopeId: 'env-isolation-direct-3',
        senderDid: 'did:claw:zAlice',
        conversationId: 'direct:new-after-revoke',
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.UNPROCESSABLE);
      assert.match(error.message, /revoked/);
      return true;
    },
  );
});

test('TA-P12-003 buildAuditSnapshot includes revocation isolation evidence', async () => {
  const identityService = new MutableIdentityService();
  const groups = {} as ConstructorParameters<typeof MessageService>[0];
  const service = new MessageService(groups, {
    clock: createClock(27_000),
    identityService,
  });

  await service.send(createDirectInput({
    envelopeId: 'env-revoke-audit-1',
    conversationId: 'direct:revoke-audit',
  }));
  identityService.emitRevocation('did:claw:zAlice', 'test-revoke-feed');

  const snapshot = await service.buildAuditSnapshot({
    sampleSize: 5,
    retractionScanLimit: 20,
  });

  assert.equal(snapshot.revokedDidCount, 1);
  assert.equal(snapshot.isolatedConversationCount, 1);
  assert.equal(snapshot.isolationEventCount, 1);
  assert.equal(snapshot.sampledIsolations.length, 1);
  assert.equal(snapshot.sampledIsolations[0].conversationIdHash, digest('direct:revoke-audit'));
  assert.equal(snapshot.sampledIsolations[0].revokedDidHash, hashDid('did:claw:zAlice'));
  assert.equal(snapshot.sampledIsolationEvents.length, 1);
  assert.equal(snapshot.sampledIsolationEvents[0].didHash, hashDid('did:claw:zAlice'));
  assert.equal(snapshot.sampledIsolationEvents[0].evictedConversationCount, 1);
});

test('TA-P6-001 mailbox persists messages and seq after service restart', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telagent-p6-mailbox-'));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const dbPath = path.join(tempDir, 'mailbox.sqlite');
  const clock = createClock(30_000);
  const groups = {} as ConstructorParameters<typeof MessageService>[0];

  const repoA = new MessageRepository(dbPath);
  const firstService = new MessageService(groups, { clock, repository: repoA });
  const first = await firstService.send(createDirectInput({
    envelopeId: 'env-persist-1',
    conversationId: 'direct:persist',
  }));
  assert.equal(first.seq, 1n);

  const repoB = new MessageRepository(dbPath);
  const secondService = new MessageService(groups, { clock, repository: repoB });
  const pulled = await secondService.pull({
    conversationId: 'direct:persist',
    limit: 10,
  });

  assert.equal(pulled.items.length, 1);
  assert.equal(pulled.items[0].envelopeId, 'env-persist-1');
  assert.equal(pulled.items[0].seq, 1n);

  const second = await secondService.send(createDirectInput({
    envelopeId: 'env-persist-2',
    conversationId: 'direct:persist',
  }));
  assert.equal(second.seq, 2n);
});

test('TA-P11-006 message send validates signal/mls key lifecycle status', async () => {
  const clock = createClock(50_000);
  const keyLifecycle = new KeyLifecycleService({
    clock,
    defaultSignalGraceSec: 1,
    defaultMlsGraceSec: 1,
  });
  const groups = {} as ConstructorParameters<typeof MessageService>[0];
  const service = new MessageService(groups, {
    clock,
    keyLifecycleService: keyLifecycle,
  });

  keyLifecycle.registerKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    keyId: 'signal-key-v1',
    publicKey: `0x${'1'.repeat(64)}`,
  });

  const first = await service.send(createDirectInput({
    envelopeId: 'env-key-life-1',
    mailboxKeyId: 'signal-key-v1',
  }));
  assert.equal(first.envelopeId, 'env-key-life-1');

  keyLifecycle.rotateKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    fromKeyId: 'signal-key-v1',
    toKeyId: 'signal-key-v2',
    publicKey: `0x${'2'.repeat(64)}`,
    gracePeriodSec: 1,
  });

  const inGrace = await service.send(createDirectInput({
    envelopeId: 'env-key-life-2',
    mailboxKeyId: 'signal-key-v1',
  }));
  assert.equal(inGrace.envelopeId, 'env-key-life-2');

  clock.tick(1_500);
  await assert.rejects(
    async () =>
      service.send(createDirectInput({
        envelopeId: 'env-key-life-3',
        mailboxKeyId: 'signal-key-v1',
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    },
  );

  await service.send(createDirectInput({
    envelopeId: 'env-key-life-4',
    mailboxKeyId: 'signal-key-v2',
  }));

  keyLifecycle.revokeKey({
    did: 'did:claw:zAlice',
    suite: 'signal',
    keyId: 'signal-key-v2',
    reason: 'device lost',
  });

  await assert.rejects(
    async () =>
      service.send(createDirectInput({
        envelopeId: 'env-key-life-5',
        mailboxKeyId: 'signal-key-v2',
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    },
  );
});

test('TA-P11-007 revoked DID cannot continue sending new messages', async () => {
  const clock = createClock(60_000);
  const identityService = new MutableIdentityService();
  const groups = {} as ConstructorParameters<typeof MessageService>[0];
  const service = new MessageService(groups, {
    clock,
    identityService,
  });

  const first = await service.send(createDirectInput({
    envelopeId: 'env-revoked-did-1',
    conversationId: 'direct:revoked-did',
  }));
  assert.equal(first.envelopeId, 'env-revoked-did-1');

  identityService.revoke('did:claw:zAlice');

  await assert.rejects(
    async () =>
      service.send(createDirectInput({
        envelopeId: 'env-revoked-did-2',
        conversationId: 'direct:revoked-did',
      })),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.UNPROCESSABLE);
      return true;
    },
  );

  const pulled = await service.pull({
    conversationId: 'direct:revoked-did',
    limit: 10,
  });
  assert.equal(pulled.items.length, 1);
  assert.equal(pulled.items[0].envelopeId, 'env-revoked-did-1');
});
