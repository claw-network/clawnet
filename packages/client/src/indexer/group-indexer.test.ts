import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Interface, type Log } from 'ethers';

import { TELAGENT_GROUP_REGISTRY_ABI } from '../services/abis.js';
import type { ContractProvider } from '../services/contract-provider.js';
import { GroupRepository } from '../storage/group-repository.js';
import { GroupIndexer } from './group-indexer.js';

interface ChainBlock {
  number: number;
  hash: string;
  parentHash: string;
}

class FakeProvider {
  private blocks = new Map<number, ChainBlock>();
  private logsByBlock = new Map<number, Log[]>();
  private head = 0;

  setChain(blocks: Map<number, ChainBlock>, logsByBlock: Map<number, Log[]>): void {
    this.blocks = blocks;
    this.logsByBlock = logsByBlock;
    this.head = Math.max(0, ...blocks.keys());
  }

  setHead(head: number): void {
    this.head = head;
  }

  async getBlockNumber(): Promise<number> {
    return this.head;
  }

  async getBlock(blockNumber: number): Promise<ChainBlock | null> {
    return this.blocks.get(blockNumber) ?? null;
  }

  async getLogs(filter: { fromBlock?: number; toBlock?: number; address?: string }): Promise<Log[]> {
    const fromBlock = Number(filter.fromBlock ?? 0);
    const toBlock = Number(filter.toBlock ?? this.head);
    const address = (filter.address ?? '').toLowerCase();

    const result: Log[] = [];
    for (let block = fromBlock; block <= toBlock; block++) {
      const logs = this.logsByBlock.get(block) ?? [];
      for (const log of logs) {
        if (!address || log.address.toLowerCase() === address) {
          result.push(log);
        }
      }
    }

    return result;
  }
}

function toHash(seed: string): string {
  const hex = Buffer.from(seed).toString('hex');
  return `0x${hex.padStart(64, '0').slice(-64)}`;
}

function buildLinearChain(length: number, forkTag: string): Map<number, ChainBlock> {
  const blocks = new Map<number, ChainBlock>();
  let parentHash = toHash(`${forkTag}-genesis`);

  for (let i = 1; i <= length; i++) {
    const hash = toHash(`${forkTag}-block-${i}`);
    blocks.set(i, {
      number: i,
      hash,
      parentHash,
    });
    parentHash = hash;
  }

  return blocks;
}

function forkFrom(base: Map<number, ChainBlock>, forkFromBlock: number, newTag: string): Map<number, ChainBlock> {
  const maxBlock = Math.max(0, ...base.keys());
  const forked = new Map<number, ChainBlock>();

  for (let i = 1; i <= forkFromBlock; i++) {
    const block = base.get(i);
    if (block) {
      forked.set(i, block);
    }
  }

  let parentHash = forked.get(forkFromBlock)?.hash ?? toHash(`${newTag}-genesis`);
  for (let i = forkFromBlock + 1; i <= maxBlock; i++) {
    const hash = toHash(`${newTag}-block-${i}`);
    forked.set(i, {
      number: i,
      hash,
      parentHash,
    });
    parentHash = hash;
  }

  return forked;
}

function makeLog(params: {
  iface: Interface;
  address: string;
  eventName: string;
  args: readonly unknown[];
  blockNumber: number;
  blockHash: string;
  txSeed: string;
}): Log {
  const fragment = params.iface.getEvent(params.eventName);
  if (!fragment) {
    throw new Error(`event not found: ${params.eventName}`);
  }
  const encoded = params.iface.encodeEventLog(fragment, params.args);

  return {
    address: params.address,
    data: encoded.data,
    topics: encoded.topics,
    blockNumber: params.blockNumber,
    blockHash: params.blockHash,
    transactionHash: toHash(params.txSeed),
    logIndex: 0,
    transactionIndex: 0,
    removed: false,
    index: 0,
  } as unknown as Log;
}

function buildContracts(provider: FakeProvider, iface: Interface, address: string): ContractProvider {
  return {
    provider,
    config: { finalityDepth: 12 },
    telagentGroupRegistry: {
      interface: iface,
      getAddress: async () => address,
    },
  } as unknown as ContractProvider;
}

async function createRepo(t: test.TestContext): Promise<GroupRepository> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'telagent-p3-indexer-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return new GroupRepository(path.join(dir, 'group-indexer.sqlite'));
}

test('finalityDepth only materializes finalized blocks', async (t) => {
  const iface = new Interface(TELAGENT_GROUP_REGISTRY_ABI);
  const address = `0x${'a'.repeat(40)}`;
  const groupId = `0x${'1'.repeat(64)}`;
  const inviteId = `0x${'2'.repeat(64)}`;
  const creatorDidHash = `0x${'3'.repeat(64)}`;
  const inviteeDidHash = `0x${'4'.repeat(64)}`;

  const blocks = buildLinearChain(24, 'chain-a');
  const logsByBlock = new Map<number, Log[]>();
  logsByBlock.set(14, [
    makeLog({
      iface,
      address,
      eventName: 'GroupCreated',
      args: [groupId, creatorDidHash, toHash('domain-a'), `0x${'5'.repeat(64)}`, 14],
      blockNumber: 14,
      blockHash: blocks.get(14)?.hash ?? toHash('missing-14'),
      txSeed: 'group-created-14',
    }),
  ]);
  logsByBlock.set(18, [
    makeLog({
      iface,
      address,
      eventName: 'MemberInvited',
      args: [groupId, inviteId, creatorDidHash, inviteeDidHash, `0x${'6'.repeat(64)}`],
      blockNumber: 18,
      blockHash: blocks.get(18)?.hash ?? toHash('missing-18'),
      txSeed: 'member-invited-18',
    }),
  ]);

  const provider = new FakeProvider();
  provider.setChain(blocks, logsByBlock);
  provider.setHead(22);

  const repo = await createRepo(t);
  const contracts = buildContracts(provider, iface, address);
  const indexer = new GroupIndexer(contracts, repo, { finalityDepth: 5, pollIntervalMs: 1_000_000 });

  await indexer.catchUp();

  const group = repo.getGroup(groupId);
  assert.ok(group);
  assert.equal(group.blockNumber, 14);
  assert.equal(repo.listMembers(groupId, 'PENDING').length, 0);

  provider.setHead(24);
  await indexer.catchUp();

  const pending = repo.listMembers(groupId, 'PENDING');
  const finalized = repo.listMembers(groupId, 'FINALIZED');
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.didHash, inviteeDidHash);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0]?.didHash, creatorDidHash);
});

test('reorg rollback replays canonical events and restores deterministic view', async (t) => {
  const iface = new Interface(TELAGENT_GROUP_REGISTRY_ABI);
  const address = `0x${'b'.repeat(40)}`;
  const groupId = `0x${'7'.repeat(64)}`;
  const inviteIdA = `0x${'8'.repeat(64)}`;
  const inviteIdB = `0x${'9'.repeat(64)}`;
  const creatorDidHash = `0x${'a'.repeat(64)}`;
  const inviteeDidHashA = `0x${'b'.repeat(64)}`;
  const inviteeDidHashB = `0x${'c'.repeat(64)}`;

  const chainA = buildLinearChain(15, 'chain-a');
  const logsA = new Map<number, Log[]>();
  logsA.set(8, [
    makeLog({
      iface,
      address,
      eventName: 'GroupCreated',
      args: [groupId, creatorDidHash, toHash('domain-b'), `0x${'d'.repeat(64)}`, 8],
      blockNumber: 8,
      blockHash: chainA.get(8)?.hash ?? toHash('missing-a8'),
      txSeed: 'group-created-a8',
    }),
  ]);
  logsA.set(9, [
    makeLog({
      iface,
      address,
      eventName: 'MemberInvited',
      args: [groupId, inviteIdA, creatorDidHash, inviteeDidHashA, `0x${'e'.repeat(64)}`],
      blockNumber: 9,
      blockHash: chainA.get(9)?.hash ?? toHash('missing-a9'),
      txSeed: 'member-invited-a9',
    }),
  ]);

  const provider = new FakeProvider();
  provider.setChain(chainA, logsA);

  const repo = await createRepo(t);
  const contracts = buildContracts(provider, iface, address);
  const indexer = new GroupIndexer(contracts, repo, { finalityDepth: 0, pollIntervalMs: 1_000_000 });

  await indexer.catchUp();

  let pending = repo.listMembers(groupId, 'PENDING');
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.didHash, inviteeDidHashA);

  const chainB = forkFrom(chainA, 8, 'chain-b');
  const logsB = new Map<number, Log[]>();
  logsB.set(8, logsA.get(8) ?? []);
  logsB.set(9, [
    makeLog({
      iface,
      address,
      eventName: 'MemberInvited',
      args: [groupId, inviteIdB, creatorDidHash, inviteeDidHashB, `0x${'f'.repeat(64)}`],
      blockNumber: 9,
      blockHash: chainB.get(9)?.hash ?? toHash('missing-b9'),
      txSeed: 'member-invited-b9',
    }),
  ]);

  provider.setChain(chainB, logsB);
  await indexer.catchUp();

  pending = repo.listMembers(groupId, 'PENDING');
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.didHash, inviteeDidHashB);
  assert.equal(repo.listMembers(groupId).some((member) => member.didHash === inviteeDidHashA), false);
  assert.equal(repo.getIndexerState()?.reorgCount, 1);
});
