import type { Log } from 'ethers';

import type { ContractProvider } from '../services/contract-provider.js';
import type { GroupRepository, GroupEventRecord } from '../storage/group-repository.js';

interface CanonicalBlock {
  number: number;
  hash: string;
  parentHash: string;
}

export class GroupIndexer {
  private interval: NodeJS.Timeout | null = null;
  private lastIndexedBlock = 0;
  private syncing = false;

  constructor(
    private readonly contracts: ContractProvider,
    private readonly repo: GroupRepository,
    private readonly options: { pollIntervalMs?: number; finalityDepth?: number } = {},
  ) {}

  async start(): Promise<void> {
    if (this.interval) {
      return;
    }

    const persisted = this.repo.getIndexerState();
    if (persisted) {
      this.lastIndexedBlock = persisted.lastIndexedBlock;
    } else {
      const finalityDepth = this.options.finalityDepth ?? this.contracts.config.finalityDepth;
      const head = await this.contracts.provider.getBlockNumber();
      const bootstrapBlock = Math.max(0, head - finalityDepth);
      this.lastIndexedBlock = bootstrapBlock;

      const bootstrapCanonical =
        bootstrapBlock > 0 ? await this.getCanonicalBlock(bootstrapBlock) : null;
      const bootstrapHash = bootstrapCanonical?.hash ?? null;

      if (bootstrapCanonical) {
        const block = bootstrapCanonical;
        if (block) {
          this.repo.recordIndexedBlock({
            blockNumber: bootstrapBlock,
            blockHash: block.hash,
            parentHash: block.parentHash,
            indexedAtMs: Date.now(),
          });
        }
      }

      this.repo.saveIndexerState({
        lastIndexedBlock: bootstrapBlock,
        lastIndexedHash: bootstrapHash,
        reorgCount: 0,
        updatedAtMs: Date.now(),
      });
    }

    // Run initial catchUp in background so it doesn't block node startup.
    // The polling loop will pick up where it left off.
    void this.catchUp().catch(() => {
      // Initial catch-up failure is non-fatal; polling will retry.
    });

    const intervalMs = this.options.pollIntervalMs ?? 5_000;
    this.interval = setInterval(() => {
      void this.catchUp().catch(() => {
        // Keep polling loop alive; failures are visible from task logs/tests.
      });
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (!this.interval) {
      return;
    }
    clearInterval(this.interval);
    this.interval = null;
  }

  async catchUp(): Promise<void> {
    if (this.syncing) {
      return;
    }

    this.syncing = true;
    try {
      await this.ensureCanonicalHead();

      const finalityDepth = this.options.finalityDepth ?? this.contracts.config.finalityDepth;
      const head = await this.contracts.provider.getBlockNumber();
      const targetBlock = Math.max(0, head - finalityDepth);

      if (targetBlock <= this.lastIndexedBlock) {
        return;
      }

      const logs = await this.contracts.provider.getLogs({
        address: await this.contracts.telagentGroupRegistry.getAddress(),
        fromBlock: this.lastIndexedBlock + 1,
        toBlock: targetBlock,
      });

      const logsByBlock = new Map<number, Log[]>();
      for (const log of logs) {
        if (typeof log.blockNumber !== 'number') {
          continue;
        }
        const bucket = logsByBlock.get(log.blockNumber);
        if (bucket) {
          bucket.push(log);
        } else {
          logsByBlock.set(log.blockNumber, [log]);
        }
      }

      let lastHash: string | null = null;
      for (let blockNumber = this.lastIndexedBlock + 1; blockNumber <= targetBlock; blockNumber++) {
        const block = await this.getCanonicalBlock(blockNumber);
        if (!block) {
          break;
        }

        const blockLogs = logsByBlock.get(blockNumber) ?? [];
        for (const log of blockLogs) {
          this.processLog(log);
        }

        this.repo.recordIndexedBlock({
          blockNumber,
          blockHash: block.hash,
          parentHash: block.parentHash,
          indexedAtMs: Date.now(),
        });

        this.lastIndexedBlock = blockNumber;
        lastHash = block.hash;
      }

      if (this.lastIndexedBlock > 0) {
        const fallbackHash = this.repo.getIndexedBlock(this.lastIndexedBlock)?.blockHash ?? null;
        this.repo.saveIndexerState({
          lastIndexedBlock: this.lastIndexedBlock,
          lastIndexedHash: lastHash ?? fallbackHash,
          reorgCount: this.repo.getIndexerState()?.reorgCount ?? 0,
          updatedAtMs: Date.now(),
        });
      }
    } finally {
      this.syncing = false;
    }
  }

  private async ensureCanonicalHead(): Promise<void> {
    if (this.lastIndexedBlock <= 0) {
      return;
    }

    const indexed = this.repo.getIndexedBlock(this.lastIndexedBlock);
    const expectedHash = indexed?.blockHash ?? this.repo.getIndexerState()?.lastIndexedHash;
    if (!expectedHash) {
      return;
    }

    const chainBlock = await this.getCanonicalBlock(this.lastIndexedBlock);
    if (!chainBlock) {
      return;
    }

    if (chainBlock.hash.toLowerCase() === expectedHash.toLowerCase()) {
      return;
    }

    const ancestor = await this.findCommonAncestor(this.lastIndexedBlock);
    await this.rollbackAndReplay(ancestor);
  }

  private async findCommonAncestor(fromBlock: number): Promise<number> {
    let block = fromBlock;
    while (block > 0) {
      const indexed = this.repo.getIndexedBlock(block);
      if (!indexed) {
        block -= 1;
        continue;
      }

      const chainBlock = await this.getCanonicalBlock(block);
      if (chainBlock && chainBlock.hash.toLowerCase() === indexed.blockHash.toLowerCase()) {
        return block;
      }

      block -= 1;
    }

    return 0;
  }

  private async rollbackAndReplay(ancestorBlock: number): Promise<void> {
    const replayEvents = this.repo.listAllEvents(ancestorBlock);

    this.repo.deleteEventsAfterBlock(ancestorBlock);
    this.repo.deleteIndexedBlocksAfter(ancestorBlock);
    this.repo.clearReadModel();

    for (const event of replayEvents) {
      this.applyStoredEvent(event);
    }

    const prevState = this.repo.getIndexerState();
    const ancestorHash = ancestorBlock > 0 ? this.repo.getIndexedBlock(ancestorBlock)?.blockHash ?? null : null;

    this.lastIndexedBlock = ancestorBlock;
    this.repo.saveIndexerState({
      lastIndexedBlock: ancestorBlock,
      lastIndexedHash: ancestorHash,
      reorgCount: (prevState?.reorgCount ?? 0) + 1,
      updatedAtMs: Date.now(),
    });
  }

  private processLog(log: Log): void {
    const parsed = this.contracts.telagentGroupRegistry.interface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });

    if (!parsed) {
      return;
    }

    const blockNumber = typeof log.blockNumber === 'number' ? log.blockNumber : undefined;
    const parsedArgs: string[] = [];
    for (let i = 0; i < parsed.fragment.inputs.length; i++) {
      parsedArgs.push(String(parsed.args[i]));
    }

    this.applyParsedEvent(parsed.name, parsedArgs, log.transactionHash, blockNumber);

    const payload: Record<string, unknown> = {};
    for (let i = 0; i < parsed.fragment.inputs.length; i++) {
      const input = parsed.fragment.inputs[i];
      payload[input.name || `arg${i}`] = String(parsed.args[i]);
    }

    const groupId = typeof payload.groupId === 'string' ? payload.groupId : undefined;
    if (!groupId) {
      return;
    }

    this.repo.recordEvent({
      groupId,
      eventName: parsed.name,
      txHash: log.transactionHash,
      blockNumber,
      payload,
    });
  }

  private applyStoredEvent(event: GroupEventRecord): void {
    const payload = event.payload;

    const orderedArgs = this.eventArgsFromPayload(event.eventName, payload);
    this.applyParsedEvent(event.eventName, orderedArgs, event.txHash ?? undefined, event.blockNumber ?? undefined);
  }

  private eventArgsFromPayload(eventName: string, payload: Record<string, unknown>): string[] {
    const read = (key: string): string => String(payload[key] ?? '');

    if (eventName === 'GroupCreated') {
      return [read('groupId'), read('creatorDidHash'), read('domainHash'), read('domainProofHash'), read('blockNumber')];
    }
    if (eventName === 'MemberInvited') {
      return [read('groupId'), read('inviteId'), read('inviterDidHash'), read('inviteeDidHash'), read('mlsCommitHash')];
    }
    if (eventName === 'MemberAccepted') {
      return [read('groupId'), read('inviteId'), read('memberDidHash'), read('mlsWelcomeHash')];
    }
    if (eventName === 'MemberRemoved') {
      return [read('groupId'), read('memberDidHash'), read('operatorDidHash'), read('mlsCommitHash')];
    }

    return [];
  }

  private applyParsedEvent(
    eventName: string,
    args: string[],
    txHash?: string,
    blockNumber?: number,
  ): void {
    if (eventName === 'GroupCreated') {
      const groupId = args[0];
      const creatorDidHash = args[1] ?? '';
      const domainProofHash = args[3] ?? '0x' + '0'.repeat(64);

      const existing = this.repo.getGroup(groupId);
      if (existing) {
        this.repo.updateGroupState(groupId, 'ACTIVE', txHash, blockNumber);
      } else {
        this.repo.saveGroup({
          groupId,
          creatorDid: this.didFromHash(creatorDidHash),
          creatorDidHash,
          groupDomain: '',
          domainProofHash,
          initialMlsStateHash: '0x' + '0'.repeat(64),
          state: 'ACTIVE',
          createdAtMs: Date.now(),
          txHash,
          blockNumber,
        });
      }

      this.repo.saveMember({
        groupId,
        did: this.didFromHash(creatorDidHash),
        didHash: creatorDidHash,
        state: 'FINALIZED',
        joinedAtMs: Date.now(),
        txHash,
      });

      this.repo.saveChainState({
        groupId,
        state: 'ACTIVE',
        finalizedTxHash: txHash,
        blockNumber,
        updatedAtMs: Date.now(),
      });
      return;
    }

    if (eventName === 'MemberInvited') {
      const groupId = args[0];
      const inviteId = args[1];
      const inviteeDidHash = args[3] ?? '';

      this.repo.saveMember({
        groupId,
        did: this.didFromHash(inviteeDidHash),
        didHash: inviteeDidHash,
        state: 'PENDING',
        joinedAtMs: Date.now(),
        inviteId,
        txHash,
      });
      return;
    }

    if (eventName === 'MemberAccepted') {
      const groupId = args[0];
      const inviteId = args[1];
      const memberDidHash = args[2] ?? '';

      this.repo.saveMember({
        groupId,
        did: this.didFromHash(memberDidHash),
        didHash: memberDidHash,
        state: 'FINALIZED',
        joinedAtMs: Date.now(),
        inviteId,
        txHash,
      });
      return;
    }

    if (eventName === 'MemberRemoved') {
      const groupId = args[0];
      const memberDidHash = args[1] ?? '';

      this.repo.saveMember({
        groupId,
        did: this.didFromHash(memberDidHash),
        didHash: memberDidHash,
        state: 'REMOVED',
        joinedAtMs: Date.now(),
        txHash,
      });
    }
  }

  private async getCanonicalBlock(blockNumber: number): Promise<CanonicalBlock | null> {
    const block = await this.contracts.provider.getBlock(blockNumber);
    if (!block || !block.hash || !block.parentHash) {
      return null;
    }

    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
    };
  }

  private didFromHash(hash: string): string {
    if (!hash || !hash.startsWith('0x')) {
      return 'did:claw:unknown';
    }
    return `did:claw:${hash.slice(2, 18)}`;
  }
}
