import assert from 'node:assert/strict';
import test from 'node:test';

import { hashDid, type AgentDID, type GroupChainState, type GroupMemberRecord, type GroupRecord } from './protocol/index.js';

import { ApiServer } from './api/server.js';
import type { RuntimeContext } from './api/types.js';
import { AttachmentService } from './services/attachment-service.js';
import { MessageService } from './services/message-service.js';
import { NodeMonitoringService } from './services/node-monitoring-service.js';

interface MutableClock {
  now(): number;
  tick(ms: number): void;
}

interface DataEnvelope<T> {
  data: T;
}

interface PaginationEnvelope<T> {
  data: T[];
  meta: {
    pagination: {
      page: number;
      perPage: number;
      total: number;
      totalPages: number;
    };
  };
}

interface JsonEnvelope {
  envelopeId: string;
  conversationId: string;
  conversationType: 'direct' | 'group';
  seq: string;
  contentType: 'text' | 'image' | 'file' | 'control';
  sentAtMs: number;
  ttlSec: number;
  provisional?: boolean;
  attachmentManifestHash?: string;
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

function bytes32(fill: string): string {
  return `0x${fill.repeat(64)}`;
}

class FakeIdentityService {
  async getSelf() {
    return {
      did: 'did:claw:zAlice',
      didHash: hashDid('did:claw:zAlice'),
      controller: `0x${'1'.repeat(40)}`,
      publicKey: '0x11',
      isActive: true,
      resolvedAtMs: Date.now(),
    };
  }

  async resolve(did: string) {
    return {
      did,
      didHash: hashDid(did),
      controller: `0x${'2'.repeat(40)}`,
      publicKey: '0x22',
      isActive: true,
      resolvedAtMs: Date.now(),
    };
  }
}

class FakeKeyLifecycleService {
  assertCanUseKey() {
    return {
      did: 'did:claw:zAlice',
      suite: 'signal',
      keyId: 'mailbox-1',
      publicKey: '0x11',
      state: 'ACTIVE',
      createdAtMs: Date.now(),
      activatedAtMs: Date.now(),
    };
  }

  registerKey() {
    return this.assertCanUseKey();
  }

  rotateKey() {
    return {
      previous: this.assertCanUseKey(),
      current: this.assertCanUseKey(),
    };
  }

  revokeKey() {
    return {
      ...this.assertCanUseKey(),
      state: 'REVOKED',
    };
  }

  recoverKey() {
    return {
      revoked: {
        ...this.assertCanUseKey(),
        state: 'RECOVERED',
      },
      recovered: this.assertCanUseKey(),
    };
  }

  listKeys() {
    return [this.assertCanUseKey()];
  }
}

class FakeClawNetGatewayService {
  baseUrl = 'http://127.0.0.1:9528';

  async getBalance(did?: string) {
    return {
      did: did ?? 'did:claw:zAlice',
      address: `0x${'1'.repeat(40)}`,
      native: '1000000000000000000',
      token: '1000000000000000000',
    };
  }

  async getNonce() {
    return {
      nonce: 1,
      address: `0x${'1'.repeat(40)}`,
    };
  }

  async getSelfIdentity() {
    return {
      did: 'did:claw:zAlice',
      address: `0x${'1'.repeat(40)}`,
      isActive: true,
      controller: `0x${'1'.repeat(40)}`,
      activeKey: '0x11',
      document: {
        capabilities: ['chat'],
        keyHistory: [],
      },
    };
  }

  async resolveIdentity(did: string) {
    return {
      ...(await this.getSelfIdentity()),
      did,
    };
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

class FakeGroupService {
  private readonly groups = new Map<string, GroupRecord>();
  private readonly members = new Map<string, GroupMemberRecord[]>();
  private readonly chainStates = new Map<string, GroupChainState>();
  private readonly inviteTargetById = new Map<string, { groupId: string; inviteeDid: AgentDID }>();
  private txNonce = 1;

  constructor(private readonly clock: MutableClock) {}

  async createGroup(input: {
    creatorDid: AgentDID;
    groupId: string;
    groupDomain: string;
    domainProofHash: string;
    initialMlsStateHash: string;
  }): Promise<{ txHash: string; group: GroupRecord }> {
    const createdAtMs = this.clock.now();
    const txHash = this.nextTxHash();
    const group: GroupRecord = {
      groupId: input.groupId,
      creatorDid: input.creatorDid,
      creatorDidHash: hashDid(input.creatorDid),
      groupDomain: input.groupDomain,
      domainProofHash: input.domainProofHash,
      initialMlsStateHash: input.initialMlsStateHash,
      state: 'ACTIVE',
      createdAtMs,
      txHash,
      blockNumber: this.txNonce,
    };

    this.groups.set(input.groupId, group);
    this.chainStates.set(input.groupId, {
      groupId: input.groupId,
      state: 'ACTIVE',
      finalizedTxHash: txHash,
      blockNumber: this.txNonce,
      updatedAtMs: createdAtMs,
    });
    this.upsertMember(input.groupId, {
      groupId: input.groupId,
      did: input.creatorDid,
      didHash: hashDid(input.creatorDid),
      state: 'FINALIZED',
      joinedAtMs: createdAtMs,
      txHash,
    });

    return {
      txHash,
      group,
    };
  }

  async inviteMember(input: {
    groupId: string;
    inviteId: string;
    inviterDid: AgentDID;
    inviteeDid: AgentDID;
    mlsCommitHash: string;
  }): Promise<{ txHash: string }> {
    this.requireGroup(input.groupId);
    const txHash = this.nextTxHash();

    this.inviteTargetById.set(input.inviteId, {
      groupId: input.groupId,
      inviteeDid: input.inviteeDid,
    });
    this.upsertMember(input.groupId, {
      groupId: input.groupId,
      did: input.inviteeDid,
      didHash: hashDid(input.inviteeDid),
      state: 'PENDING',
      joinedAtMs: this.clock.now(),
      inviteId: input.inviteId,
    });

    return { txHash };
  }

  async acceptInvite(input: {
    groupId: string;
    inviteId: string;
    inviteeDid: AgentDID;
    mlsWelcomeHash: string;
  }): Promise<{ txHash: string }> {
    this.requireGroup(input.groupId);
    const invitation = this.inviteTargetById.get(input.inviteId);
    if (!invitation || invitation.groupId !== input.groupId || invitation.inviteeDid !== input.inviteeDid) {
      throw new Error(`invite(${input.inviteId}) does not match group/member`);
    }

    const txHash = this.nextTxHash();
    this.upsertMember(input.groupId, {
      groupId: input.groupId,
      did: input.inviteeDid,
      didHash: hashDid(input.inviteeDid),
      state: 'FINALIZED',
      joinedAtMs: this.clock.now(),
      inviteId: input.inviteId,
      txHash,
    });

    return { txHash };
  }

  async removeMember(input: { groupId: string; operatorDid: AgentDID; memberDid: AgentDID; mlsCommitHash: string }): Promise<{ txHash: string }> {
    this.requireGroup(input.groupId);
    const txHash = this.nextTxHash();
    this.upsertMember(input.groupId, {
      groupId: input.groupId,
      did: input.memberDid,
      didHash: hashDid(input.memberDid),
      state: 'REMOVED',
      joinedAtMs: this.clock.now(),
      txHash,
    });
    return { txHash };
  }

  getGroup(groupId: string): GroupRecord {
    return this.requireGroup(groupId);
  }

  listMembers(groupId: string, state?: 'PENDING' | 'FINALIZED' | 'REMOVED'): GroupMemberRecord[] {
    this.requireGroup(groupId);
    const records = [...(this.members.get(groupId) ?? [])].sort((a, b) => a.joinedAtMs - b.joinedAtMs);
    if (!state) {
      return records;
    }
    return records.filter((member) => member.state === state);
  }

  getChainState(groupId: string): GroupChainState {
    const state = this.chainStates.get(groupId);
    if (!state) {
      throw new Error(`group(${groupId}) not found`);
    }
    return state;
  }

  private upsertMember(groupId: string, member: GroupMemberRecord): void {
    const current = this.members.get(groupId) ?? [];
    const filtered = current.filter((item) => item.didHash.toLowerCase() !== member.didHash.toLowerCase());
    filtered.push(member);
    this.members.set(groupId, filtered);
  }

  private requireGroup(groupId: string): GroupRecord {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`group(${groupId}) not found`);
    }
    return group;
  }

  private nextTxHash(): string {
    const txHash = `0x${this.txNonce.toString(16).padStart(64, '0')}`;
    this.txNonce++;
    return txHash;
  }
}

async function startE2EServer(startMs?: number): Promise<{
  server: ApiServer;
  baseUrl: string;
  clock: MutableClock;
}> {
  const clock = createClock(startMs);
  const groupService = new FakeGroupService(clock);
  const messageService = new MessageService(groupService as unknown as RuntimeContext['groupService'], { clock });
  const attachmentService = new AttachmentService({ clock });
  const monitoringService = new NodeMonitoringService({
    clock: {
      nowMs: () => clock.now(),
    },
  });

  const context: RuntimeContext = {
    config: {
      host: '127.0.0.1',
      port: 0,
    },
    identityService: new FakeIdentityService() as unknown as RuntimeContext['identityService'],
    groupService: groupService as unknown as RuntimeContext['groupService'],
    messageService,
    attachmentService,
    monitoringService,
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
    clock,
  };
}

async function postJson(baseUrl: string, path: string, payload: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tses_test_token' },
    body: JSON.stringify(payload),
  });
}

async function getJson(baseUrl: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: 'Bearer tses_test_token' } });
}

test('TA-P4-009 E2E main path: create -> invite -> accept -> group chat (text/image/file)', async (t) => {
  const { server, baseUrl } = await startE2EServer();
  t.after(async () => {
    await server.stop();
  });

  const groupId = bytes32('a');
  const inviteId = bytes32('b');
  const creatorDid = 'did:claw:zAlice';
  const inviteeDid = 'did:claw:zBob';
  const conversationId = `group:${groupId}`;

  const createGroupRes = await postJson(baseUrl, '/api/v1/groups', {
    creatorDid,
    groupId,
    groupDomain: 'alpha.tel',
    domainProofHash: bytes32('1'),
    initialMlsStateHash: bytes32('2'),
  });
  assert.equal(createGroupRes.status, 201);

  const createGroupBody = (await createGroupRes.json()) as DataEnvelope<{ group: { state: string } }>;
  assert.equal(createGroupBody.data.group.state, 'ACTIVE');

  const inviteRes = await postJson(baseUrl, `/api/v1/groups/${groupId}/invites`, {
    inviterDid: creatorDid,
    inviteeDid,
    inviteId,
    mlsCommitHash: bytes32('3'),
  });
  assert.equal(inviteRes.status, 201);

  const pendingMembersRes = await getJson(baseUrl, `/api/v1/groups/${groupId}/members?view=pending&page=1&per_page=20`);
  assert.equal(pendingMembersRes.status, 200);
  const pendingMembers = (await pendingMembersRes.json()) as PaginationEnvelope<{ did: string; state: string }>;
  assert.equal(pendingMembers.data.length, 1);
  assert.equal(pendingMembers.data[0].did, inviteeDid);
  assert.equal(pendingMembers.data[0].state, 'PENDING');

  const acceptRes = await postJson(baseUrl, `/api/v1/groups/${groupId}/invites/${inviteId}/accept`, {
    inviteeDid,
    mlsWelcomeHash: bytes32('4'),
  });
  assert.equal(acceptRes.status, 201);

  const finalizedMembersRes = await getJson(
    baseUrl,
    `/api/v1/groups/${groupId}/members?view=finalized&page=1&per_page=20`,
  );
  assert.equal(finalizedMembersRes.status, 200);
  const finalizedMembers = (await finalizedMembersRes.json()) as PaginationEnvelope<{ did: string; state: string }>;
  assert.equal(finalizedMembers.meta.pagination.total, 2);
  assert.deepEqual(
    finalizedMembers.data.map((member) => member.did).sort(),
    [creatorDid, inviteeDid],
  );
  assert.ok(finalizedMembers.data.every((member) => member.state === 'FINALIZED'));

  const textRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-009-text',
    senderDid: creatorDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-main',
    sealedHeader: '0x11',
    ciphertext: '0x22',
    contentType: 'text',
    ttlSec: 3600,
  });
  assert.equal(textRes.status, 201);
  const textEnvelope = (await textRes.json()) as DataEnvelope<{ envelope: JsonEnvelope }>;
  assert.equal(textEnvelope.data.envelope.seq, '1');
  assert.equal(textEnvelope.data.envelope.provisional, false);

  const imageManifestHash = bytes32('5');
  const imageInitRes = await postJson(baseUrl, '/api/v1/attachments/init-upload', {
    filename: 'room-photo.png',
    contentType: 'image/png',
    sizeBytes: 120_000,
    manifestHash: imageManifestHash,
  });
  assert.equal(imageInitRes.status, 201);
  const imageInit = (await imageInitRes.json()) as DataEnvelope<{ objectKey: string }>;

  const imageCompleteRes = await postJson(baseUrl, '/api/v1/attachments/complete-upload', {
    objectKey: imageInit.data.objectKey,
    manifestHash: imageManifestHash,
    checksum: bytes32('6'),
  });
  assert.equal(imageCompleteRes.status, 200);

  const imageRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-009-image',
    senderDid: inviteeDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-main',
    sealedHeader: '0x33',
    ciphertext: '0x44',
    contentType: 'image',
    attachmentManifestHash: imageManifestHash,
    ttlSec: 3600,
  });
  assert.equal(imageRes.status, 201);

  const fileManifestHash = bytes32('7');
  const fileInitRes = await postJson(baseUrl, '/api/v1/attachments/init-upload', {
    filename: 'brief.pdf',
    contentType: 'application/pdf',
    sizeBytes: 512_000,
    manifestHash: fileManifestHash,
  });
  assert.equal(fileInitRes.status, 201);
  const fileInit = (await fileInitRes.json()) as DataEnvelope<{ objectKey: string }>;

  const fileCompleteRes = await postJson(baseUrl, '/api/v1/attachments/complete-upload', {
    objectKey: fileInit.data.objectKey,
    manifestHash: fileManifestHash,
    checksum: bytes32('8'),
  });
  assert.equal(fileCompleteRes.status, 200);

  const fileRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-009-file',
    senderDid: creatorDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-main',
    sealedHeader: '0x55',
    ciphertext: '0x66',
    contentType: 'file',
    attachmentManifestHash: fileManifestHash,
    ttlSec: 3600,
  });
  assert.equal(fileRes.status, 201);

  const pullRes = await getJson(
    baseUrl,
    `/api/v1/messages/pull?conversation_id=${encodeURIComponent(conversationId)}&limit=20`,
  );
  assert.equal(pullRes.status, 200);
  const pullBody = (await pullRes.json()) as DataEnvelope<{ items: JsonEnvelope[]; cursor: string | null }>;
  assert.equal(pullBody.data.items.length, 3);
  assert.deepEqual(
    pullBody.data.items.map((item) => item.contentType),
    ['text', 'image', 'file'],
  );
  assert.deepEqual(
    pullBody.data.items.map((item) => item.seq),
    ['1', '2', '3'],
  );
  assert.ok(pullBody.data.items.every((item) => item.provisional === false));
  assert.equal(pullBody.data.cursor, null);
});

test('TA-P4-010 E2E offline 24h pull keeps dedupe and per-conversation order', async (t) => {
  const { server, baseUrl, clock } = await startE2EServer(5_000);
  t.after(async () => {
    await server.stop();
  });

  const groupId = bytes32('c');
  const inviteId = bytes32('d');
  const creatorDid = 'did:claw:zAlice';
  const inviteeDid = 'did:claw:zBob';
  const conversationId = `group:${groupId}`;

  const createGroupRes = await postJson(baseUrl, '/api/v1/groups', {
    creatorDid,
    groupId,
    groupDomain: 'offline.tel',
    domainProofHash: bytes32('9'),
    initialMlsStateHash: bytes32('a'),
  });
  assert.equal(createGroupRes.status, 201);

  const inviteRes = await postJson(baseUrl, `/api/v1/groups/${groupId}/invites`, {
    inviterDid: creatorDid,
    inviteeDid,
    inviteId,
    mlsCommitHash: bytes32('b'),
  });
  assert.equal(inviteRes.status, 201);

  const acceptRes = await postJson(baseUrl, `/api/v1/groups/${groupId}/invites/${inviteId}/accept`, {
    inviteeDid,
    mlsWelcomeHash: bytes32('c'),
  });
  assert.equal(acceptRes.status, 201);

  const firstSendRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-010-1',
    senderDid: creatorDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'offline.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-offline',
    sealedHeader: '0x71',
    ciphertext: '0x72',
    contentType: 'text',
    ttlSec: 172_800,
  });
  assert.equal(firstSendRes.status, 201);
  const firstEnvelope = (await firstSendRes.json()) as DataEnvelope<{ envelope: JsonEnvelope }>;
  assert.equal(firstEnvelope.data.envelope.seq, '1');

  const dedupeRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-010-1',
    senderDid: creatorDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'offline.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-offline',
    sealedHeader: '0x71',
    ciphertext: '0x72',
    contentType: 'text',
    ttlSec: 172_800,
  });
  assert.equal(dedupeRes.status, 201);
  const dedupeEnvelope = (await dedupeRes.json()) as DataEnvelope<{ envelope: JsonEnvelope }>;
  assert.equal(dedupeEnvelope.data.envelope.seq, '1');

  const secondSendRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-010-2',
    senderDid: inviteeDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'offline.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-offline',
    sealedHeader: '0x73',
    ciphertext: '0x74',
    contentType: 'text',
    ttlSec: 172_800,
  });
  assert.equal(secondSendRes.status, 201);

  const thirdSendRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p4-010-3',
    senderDid: creatorDid,
    conversationId,
    conversationType: 'group',
    targetDomain: 'offline.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-offline',
    sealedHeader: '0x75',
    ciphertext: '0x76',
    contentType: 'text',
    ttlSec: 172_800,
  });
  assert.equal(thirdSendRes.status, 201);

  clock.tick(86_400_000 + 1_000);

  const pullPage1Res = await getJson(
    baseUrl,
    `/api/v1/messages/pull?conversation_id=${encodeURIComponent(conversationId)}&limit=2`,
  );
  assert.equal(pullPage1Res.status, 200);
  const pullPage1 = (await pullPage1Res.json()) as DataEnvelope<{ items: JsonEnvelope[]; cursor: string | null }>;
  assert.equal(pullPage1.data.items.length, 2);
  assert.equal(pullPage1.data.cursor, '2');
  assert.deepEqual(
    pullPage1.data.items.map((item) => item.seq),
    ['1', '2'],
  );

  const pullPage2Res = await getJson(
    baseUrl,
    `/api/v1/messages/pull?conversation_id=${encodeURIComponent(conversationId)}&limit=2&cursor=${pullPage1.data.cursor}`,
  );
  assert.equal(pullPage2Res.status, 200);
  const pullPage2 = (await pullPage2Res.json()) as DataEnvelope<{ items: JsonEnvelope[]; cursor: string | null }>;
  assert.equal(pullPage2.data.items.length, 1);
  assert.equal(pullPage2.data.items[0].seq, '3');
  assert.equal(pullPage2.data.cursor, null);

  const allItems = [...pullPage1.data.items, ...pullPage2.data.items];
  assert.equal(allItems.length, 3);
  assert.deepEqual(
    allItems.map((item) => item.envelopeId),
    ['env-p4-010-1', 'env-p4-010-2', 'env-p4-010-3'],
  );
  assert.ok(clock.now() - allItems[0].sentAtMs >= 86_400_000);
});

test('TA-P14-003 E2E pull cursor stays stable when cleanup happens between pages', async (t) => {
  const { server, baseUrl, clock } = await startE2EServer(8_000);
  t.after(async () => {
    await server.stop();
  });

  const conversationId = 'direct:p14-e2e-cursor';
  const senderDid = 'did:claw:zAlice';

  const send1 = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p14-e2e-1',
    senderDid,
    conversationId,
    conversationType: 'direct',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-direct',
    sealedHeader: '0x81',
    ciphertext: '0x82',
    contentType: 'text',
    ttlSec: 1,
  });
  assert.equal(send1.status, 201);
  clock.tick(100);

  const send2 = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p14-e2e-2',
    senderDid,
    conversationId,
    conversationType: 'direct',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-direct',
    sealedHeader: '0x83',
    ciphertext: '0x84',
    contentType: 'text',
    ttlSec: 120,
  });
  assert.equal(send2.status, 201);
  clock.tick(100);

  const send3 = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p14-e2e-3',
    senderDid,
    conversationId,
    conversationType: 'direct',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-direct',
    sealedHeader: '0x85',
    ciphertext: '0x86',
    contentType: 'text',
    ttlSec: 120,
  });
  assert.equal(send3.status, 201);

  const pullPage1Res = await getJson(
    baseUrl,
    `/api/v1/messages/pull?conversation_id=${encodeURIComponent(conversationId)}&limit=2`,
  );
  assert.equal(pullPage1Res.status, 200);
  const pullPage1 = (await pullPage1Res.json()) as DataEnvelope<{ items: JsonEnvelope[]; cursor: string | null }>;
  assert.deepEqual(
    pullPage1.data.items.map((item) => item.envelopeId),
    ['env-p14-e2e-1', 'env-p14-e2e-2'],
  );
  assert.equal(pullPage1.data.cursor, '2');

  clock.tick(1_100);

  const pullPage2Res = await getJson(
    baseUrl,
    `/api/v1/messages/pull?conversation_id=${encodeURIComponent(conversationId)}&limit=2&cursor=${pullPage1.data.cursor}`,
  );
  assert.equal(pullPage2Res.status, 200);
  const pullPage2 = (await pullPage2Res.json()) as DataEnvelope<{ items: JsonEnvelope[]; cursor: string | null }>;
  assert.deepEqual(
    pullPage2.data.items.map((item) => item.envelopeId),
    ['env-p14-e2e-3'],
  );
  assert.equal(pullPage2.data.cursor, null);
});

test('TA-P14-004 E2E direct conversation blocks non-participant sender with RFC7807', async (t) => {
  const { server, baseUrl } = await startE2EServer(9_000);
  t.after(async () => {
    await server.stop();
  });

  const conversationId = 'direct:p14-acl-e2e';

  const firstRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p14-acl-e2e-1',
    senderDid: 'did:claw:zAlice',
    conversationId,
    conversationType: 'direct',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-direct',
    sealedHeader: '0x91',
    ciphertext: '0x92',
    contentType: 'text',
    ttlSec: 120,
  });
  assert.equal(firstRes.status, 201);

  const secondRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p14-acl-e2e-2',
    senderDid: 'did:claw:zBob',
    conversationId,
    conversationType: 'direct',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-direct',
    sealedHeader: '0x93',
    ciphertext: '0x94',
    contentType: 'text',
    ttlSec: 120,
  });
  assert.equal(secondRes.status, 201);

  const rejectedRes = await postJson(baseUrl, '/api/v1/messages', {
    envelopeId: 'env-p14-acl-e2e-3',
    senderDid: 'did:claw:zCarol',
    conversationId,
    conversationType: 'direct',
    targetDomain: 'alpha.tel',
    targetDid: 'did:claw:zTarget',
    mailboxKeyId: 'mailbox-direct',
    sealedHeader: '0x95',
    ciphertext: '0x96',
    contentType: 'text',
    ttlSec: 120,
  });
  assert.equal(rejectedRes.status, 403);
  assert.match(rejectedRes.headers.get('content-type') ?? '', /application\/problem\+json/i);
  const rejectedBody = (await rejectedRes.json()) as {
    status: number;
    code: string;
    detail: string;
  };
  assert.equal(rejectedBody.status, 403);
  assert.equal(rejectedBody.code, 'FORBIDDEN');
  assert.match(rejectedBody.detail, /direct conversation participant/);
});
