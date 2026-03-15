/**
 * EventIndexer — polls the chain for contract events and writes them to
 * the IndexerStore.
 *
 * Architecture:
 *   1. On `start()`, catch up from `lastIndexedBlock + 1` → current head.
 *   2. Then poll every `pollIntervalMs` for new blocks.
 *   3. Every batch of logs is processed inside a single SQLite transaction
 *      (atomicity: either the whole batch commits, or nothing).
 *   4. Each log is stored in the generic `events` table AND materialised
 *      into module-specific tables (transfers, escrows, proposals, …).
 *
 * Uses `provider.getLogs()` (JSON-RPC `eth_getLogs`) rather than websocket
 * subscriptions — simpler, more resilient, and sufficient for a single-node
 * daemon.
 */

import { type Log } from 'ethers';

import { createLogger } from '../logger.js';
import {
  CONTRACT_KEYS,
  type ContractKey,
} from '../services/chain-config.js';
import { type ContractProvider } from '../services/contract-provider.js';
import { type IndexerStore } from './store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventIndexerConfig {
  /** Milliseconds between poll cycles (default: 5 000). */
  pollIntervalMs?: number;
  /** Maximum number of blocks per `eth_getLogs` batch (default: 2 000). */
  batchSize?: number;
  /** Override the starting block instead of resuming from last indexed. */
  startBlock?: number;
}

type Logger = ReturnType<typeof createLogger>;

// ---------------------------------------------------------------------------
// EventIndexer
// ---------------------------------------------------------------------------

export class EventIndexer {
  private readonly log: Logger;
  private readonly store: IndexerStore;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  /** Map lowercased contract address → config key. */
  private readonly addressToKey = new Map<string, ContractKey>();

  /** Block-number → unix timestamp cache (avoids redundant RPC calls). */
  private readonly tsCache = new Map<number, number>();

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private running = false;

  constructor(
    private readonly contracts: ContractProvider,
    store: IndexerStore,
    config: EventIndexerConfig = {},
    logger?: Logger,
  ) {
    this.store = store;
    this.pollIntervalMs = config.pollIntervalMs ?? 5_000;
    this.batchSize = config.batchSize ?? 2_000;
    this.log = logger ?? createLogger({ level: 'info' });

    if (config.startBlock !== undefined) {
      store.lastIndexedBlock = config.startBlock;
    }

    this.buildAddressMap();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.log.info(
      'Event indexer starting — resuming from block %d',
      this.store.lastIndexedBlock,
    );

    // Synchronous catch-up before we go into polling mode.
    await this.catchUp();

    this.intervalId = setInterval(() => {
      if (this.polling || !this.running) return;
      this.polling = true;
      this.catchUp()
        .catch((err: unknown) =>
          this.log.error('Indexer poll error: %s', err),
        )
        .finally(() => {
          this.polling = false;
        });
    }, this.pollIntervalMs);

    this.log.info(
      'Event indexer running — polling every %d ms',
      this.pollIntervalMs,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.log.info(
      'Event indexer stopped at block %d',
      this.store.lastIndexedBlock,
    );
  }

  // ── Core loop ───────────────────────────────────────────────────────────

  private async catchUp(): Promise<void> {
    const latest = await this.contracts.provider.getBlockNumber();
    let from = this.store.lastIndexedBlock + 1;

    // If the stored pointer is ahead of the chain (e.g. chain was reset),
    // reset to block 0 so we don't miss any events.
    if (this.store.lastIndexedBlock > latest) {
      this.log.warn(
        'Indexer pointer (%d) is ahead of chain (%d) — chain reset detected, rewinding to block 0',
        this.store.lastIndexedBlock,
        latest,
      );
      this.store.lastIndexedBlock = 0;
      from = 0;
    }

    if (from > latest) return;

    this.log.debug('Catching up: blocks %d → %d', from, latest);

    while (from <= latest && this.running) {
      const to = Math.min(from + this.batchSize - 1, latest);
      await this.processBlockRange(from, to);
      from = to + 1;
    }
  }

  private async processBlockRange(from: number, to: number): Promise<void> {
    const addresses = [...this.addressToKey.keys()];

    if (addresses.length === 0) {
      this.store.lastIndexedBlock = to;
      return;
    }

    const logs = await this.contracts.provider.getLogs({
      address: addresses,
      fromBlock: from,
      toBlock: to,
    });

    if (logs.length > 0) {
      this.log.debug(
        'Processing %d log(s) in blocks %d–%d',
        logs.length,
        from,
        to,
      );
    }

    // Pre-fetch block timestamps (async) before entering the sync transaction.
    const uniqueBlocks = [...new Set(logs.map((l) => l.blockNumber))];
    await Promise.all(uniqueBlocks.map((bn) => this.cacheTimestamp(bn)));

    // Commit everything atomically.
    this.store.transaction(() => {
      for (const log of logs) {
        this.processLog(log);
      }
      this.store.lastIndexedBlock = to;
    });
  }

  // ── Log processing ──────────────────────────────────────────────────────

  private processLog(log: Log): void {
    const addr = log.address.toLowerCase();
    const key = this.addressToKey.get(addr);
    if (!key) return;

    let contract;
    try {
      contract = this.contracts.get(key);
    } catch {
      return;
    }

    let parsed;
    try {
      parsed = contract.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
    } catch {
      // Malformed or unknown event — skip.
      return;
    }
    if (!parsed) return;

    // Convert Result → plain object with bigint→string coercion.
    const args: Record<string, string> = {};
    for (let i = 0; i < parsed.fragment.inputs.length; i++) {
      const param = parsed.fragment.inputs[i];
      const val: unknown = parsed.args[i];
      args[param.name] = typeof val === 'bigint' ? val.toString() : String(val);
    }

    const timestamp = this.tsCache.get(log.blockNumber) ?? 0;

    // ① Generic event storage.
    this.store.insertEvent({
      block: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.index,
      contract: key,
      eventName: parsed.name,
      args: JSON.stringify(args),
      timestamp,
    });

    // ② Module-specific materialisation.
    this.materialize(key, parsed.name, args, log, timestamp);
  }

  // ── Materialisers ──────────────────────────────────────────────────────
  //
  // Each module materialiser is a thin switch over event names.  Unknown
  // events are silently ignored — they're still captured in the generic
  // `events` table.
  //
  // Phase 0 implements the most common events.  Additional events are
  // added as each service module is implemented in Phases 1–5.

  private materialize(
    key: ContractKey,
    eventName: string,
    args: Record<string, string>,
    log: Log,
    timestamp: number,
  ): void {
    switch (key) {
      case 'token':
        this.materializeToken(eventName, args, log, timestamp);
        break;
      case 'escrow':
        this.materializeEscrow(eventName, args, log, timestamp);
        break;
      case 'identity':
        this.materializeIdentity(eventName, args, timestamp);
        break;
      case 'contracts':
        this.materializeServiceContract(eventName, args, timestamp);
        break;
      case 'dao':
        this.materializeDao(eventName, args, timestamp);
        break;
      case 'reputation':
        this.materializeReputation(eventName, args, log, timestamp);
        break;
      case 'relayReward':
        this.materializeRelayReward(eventName, args, timestamp);
        break;
      // staking / paramRegistry — Phase 3+
      default:
        break;
    }
  }

  // ── Token ───────────────────────────────────────────────────────────────

  private materializeToken(
    eventName: string,
    args: Record<string, string>,
    log: Log,
    timestamp: number,
  ): void {
    if (eventName === 'Transfer') {
      this.store.insertTransfer({
        block: log.blockNumber,
        txHash: log.transactionHash,
        fromAddr: args['from'] ?? '',
        toAddr: args['to'] ?? '',
        amount: args['value'] ?? '0',
        timestamp,
      });
    }
    // Approval — not materialised; query from generic `events` if needed.
  }

  // ── Escrow ──────────────────────────────────────────────────────────────

  // Status codes aligned with ClawEscrow.sol EscrowStatus enum:
  //   Active = 0, Released = 1, Refunded = 2, Expired = 3, Disputed = 4
  private static readonly ESCROW_STATUS = {
    Active: 0,
    Released: 1,
    Refunded: 2,
    Expired: 3,
    Disputed: 4,
  } as const;

  private materializeEscrow(
    eventName: string,
    args: Record<string, string>,
    log: Log,
    timestamp: number,
  ): void {
    const S = EventIndexer.ESCROW_STATUS;
    switch (eventName) {
      case 'EscrowCreated':
        this.store.upsertEscrow({
          escrowId: args['escrowId'] ?? '',
          depositor: args['depositor'] ?? '',
          beneficiary: args['beneficiary'] ?? '',
          arbiter: args['arbiter'] ?? '',
          amount: args['amount'] ?? '0',
          status: S.Active,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        break;
      case 'EscrowFunded':
        // Funding does not change escrow status — it remains Active.
        // Only update the amount and timestamp.
        this.store.updateEscrowAmount(
          args['escrowId'] ?? '',
          args['amount'] ?? '0',
          timestamp,
        );
        break;
      case 'EscrowReleased':
        this.store.updateEscrowStatus(args['escrowId'] ?? '', S.Released, timestamp);
        break;
      case 'EscrowRefunded':
        this.store.updateEscrowStatus(args['escrowId'] ?? '', S.Refunded, timestamp);
        break;
      case 'EscrowExpired':
        this.store.updateEscrowStatus(args['escrowId'] ?? '', S.Expired, timestamp);
        break;
      case 'EscrowDisputed':
        this.store.updateEscrowStatus(args['escrowId'] ?? '', S.Disputed, timestamp);
        break;
      case 'EscrowResolved': {
        // Arbiter resolution: releasedToBeneficiary → Released, otherwise → Refunded
        const released = args['releasedToBeneficiary'] === 'true';
        this.store.updateEscrowStatus(
          args['escrowId'] ?? '',
          released ? S.Released : S.Refunded,
          timestamp,
        );
        break;
      }
      default:
        break;
    }
  }

  // ── Identity ────────────────────────────────────────────────────────────

  private materializeIdentity(
    eventName: string,
    args: Record<string, string>,
    timestamp: number,
  ): void {
    switch (eventName) {
      case 'DIDRegistered':
        this.store.upsertDid(
          args['didHash'] ?? '',
          args['controller'] ?? '',
          args['key'] ?? '',
          true,
          timestamp,
        );
        break;
      case 'KeyRotated':
        this.store.upsertDid(
          args['didHash'] ?? '',
          '', // controller unchanged
          args['newKey'] ?? '',
          true,
          timestamp,
        );
        break;
      case 'DIDRevoked':
        this.store.upsertDid(
          args['didHash'] ?? '',
          '',
          '',
          false,
          timestamp,
        );
        break;
      default:
        break;
    }
  }

  // ── Service contracts ───────────────────────────────────────────────────

  private materializeServiceContract(
    eventName: string,
    args: Record<string, string>,
    timestamp: number,
  ): void {
    switch (eventName) {
      case 'ContractCreated':
        this.store.upsertServiceContract({
          contractId: args['contractId'] ?? '',
          client: args['client'] ?? '',
          provider: args['provider'] ?? '',
          status: 0, // Created
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        break;
      case 'ContractSigned':
        this.store.updateServiceContractStatus(args['contractId'] ?? '', 1, timestamp);
        break;
      case 'ContractActivated':
        this.store.updateServiceContractStatus(args['contractId'] ?? '', 2, timestamp);
        break;
      case 'ContractCompleted':
        this.store.updateServiceContractStatus(args['contractId'] ?? '', 3, timestamp);
        break;
      case 'ContractDisputed':
        this.store.updateServiceContractStatus(args['contractId'] ?? '', 4, timestamp);
        break;
      case 'ContractTerminated':
        this.store.updateServiceContractStatus(args['contractId'] ?? '', 5, timestamp);
        break;
      case 'ContractCancelled':
        this.store.updateServiceContractStatus(args['contractId'] ?? '', 6, timestamp);
        break;
      case 'DisputeResolved': {
        // Resolution: 0=FavorProvider→Completed(3), 1=FavorClient→Terminated(5), 2=Resume→Active(2)
        const resolution = Number(args['resolution'] ?? 2);
        const statusMap: Record<number, number> = { 0: 3, 1: 5, 2: 2 };
        const newStatus = statusMap[resolution] ?? 2;
        this.store.updateServiceContractStatus(args['contractId'] ?? '', newStatus, timestamp);
        break;
      }
      default:
        break;
    }
  }

  // ── DAO ─────────────────────────────────────────────────────────────────

  private materializeDao(
    eventName: string,
    args: Record<string, string>,
    timestamp: number,
  ): void {
    switch (eventName) {
      case 'ProposalCreated':
        this.store.upsertProposal({
          proposalId: Number(args['proposalId'] ?? 0),
          proposer: args['proposer'] ?? '',
          pType: Number(args['pType'] ?? 0),
          status: 0, // Discussion
          createdAt: timestamp,
        });
        break;
      case 'VoteCast':
        this.store.insertVote({
          proposalId: Number(args['proposalId'] ?? 0),
          voter: args['voter'] ?? '',
          support: Number(args['support'] ?? 0),
          weight: args['weight'] ?? '0',
          timestamp,
        });
        break;
      case 'ProposalAdvanced': {
        // ProposalAdvanced(uint256 proposalId, ProposalStatus newStatus)
        const newStatus = Number(args['newStatus'] ?? 0);
        this.store.updateProposalStatus(Number(args['proposalId'] ?? 0), newStatus);
        break;
      }
      case 'ProposalQueued':
        // Timelocked = 4
        this.store.updateProposalStatus(Number(args['proposalId'] ?? 0), 4);
        break;
      case 'ProposalExecuted':
        // Executed = 5
        this.store.updateProposalStatus(Number(args['proposalId'] ?? 0), 5);
        break;
      case 'ProposalCancelled':
        // Cancelled = 6
        this.store.updateProposalStatus(Number(args['proposalId'] ?? 0), 6);
        break;
      case 'EmergencyExecuted':
        // Emergency execution → Executed = 5
        this.store.updateProposalStatus(Number(args['proposalId'] ?? 0), 5);
        break;
      default:
        break;
    }
  }

  // ── Reputation ──────────────────────────────────────────────────────────

  private materializeReputation(
    eventName: string,
    args: Record<string, string>,
    log: Log,
    timestamp: number,
  ): void {
    if (eventName === 'ReviewRecorded') {
      this.store.insertReview({
        reviewHash: args['reviewHash'] ?? '',
        reviewerDid: args['reviewerDid'] ?? '',
        subjectDid: args['subjectDid'] ?? '',
        relatedTxHash: log.transactionHash,
        timestamp,
      });
    }
    // ReputationAnchored — informational; stored in generic events only.
  }

  // ── Relay Reward ────────────────────────────────────────────────────────

  private materializeRelayReward(
    eventName: string,
    args: Record<string, string>,
    timestamp: number,
  ): void {
    if (eventName === 'RewardClaimed') {
      this.store.insertRelayReward({
        relayDidHash: args['relayDidHash'] ?? '',
        periodId: Number(args['periodId'] ?? 0),
        rewardAmount: args['rewardAmount'] ?? '0',
        confirmedBytes: args['confirmedBytes'] ?? '0',
        confirmedPeers: Number(args['confirmedPeers'] ?? 0),
        timestamp,
      });
    }
    // RewardParamsUpdated — informational; stored in generic events only.
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private buildAddressMap(): void {
    for (const key of CONTRACT_KEYS) {
      try {
        const contract = this.contracts.get(key);
        const addr = contract.target;
        if (typeof addr === 'string') {
          this.addressToKey.set(addr.toLowerCase(), key);
        }
      } catch {
        // Contract not initialised — skip.
      }
    }

    this.log.debug(
      'Indexer tracking %d contract(s): %s',
      this.addressToKey.size,
      [...this.addressToKey.values()].join(', '),
    );
  }

  private async cacheTimestamp(blockNumber: number): Promise<void> {
    if (this.tsCache.has(blockNumber)) return;
    const block = await this.contracts.provider.getBlock(blockNumber);
    this.tsCache.set(blockNumber, block?.timestamp ?? 0);

    // Prune cache if it grows too large (keep last 500 entries).
    if (this.tsCache.size > 500) {
      const oldest = [...this.tsCache.keys()].slice(
        0,
        this.tsCache.size - 500,
      );
      for (const key of oldest) {
        this.tsCache.delete(key);
      }
    }
  }
}
