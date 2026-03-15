/**
 * IndexerQuery — paginated, filterable read access to indexed chain data.
 *
 * All query methods return a `PaginatedResult<T>` so the REST API can
 * forward pagination metadata directly to callers.
 *
 * Internally, every query is a prepared SQLite statement (parameterised to
 * prevent SQL injection).  The underlying `better-sqlite3` connection is
 * synchronous — perfectly adequate for a single-node daemon.
 */

import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginationOpts {
  /** Maximum number of rows (default: 50, max: 200). */
  limit?: number;
  /** Number of rows to skip (default: 0). */
  offset?: number;
}

// -- Transfer queries -------------------------------------------------------

export interface TransferRow {
  id: number;
  block: number;
  txHash: string;
  fromAddr: string;
  toAddr: string;
  amount: string;
  timestamp: number;
}

export interface TransferFilter extends PaginationOpts {
  /** Filter transfers involving this address (sender OR recipient). */
  address?: string;
  fromBlock?: number;
  toBlock?: number;
}

// -- Escrow queries ---------------------------------------------------------

export interface EscrowRow {
  escrowId: string;
  depositor: string;
  beneficiary: string;
  arbiter: string;
  amount: string;
  status: number;
  createdAt: number;
  updatedAt: number;
}

export interface EscrowFilter extends PaginationOpts {
  /** Filter by depositor, beneficiary, or arbiter address. */
  address?: string;
  status?: number;
}

// -- Service contract queries -----------------------------------------------

export interface ServiceContractRow {
  contractId: string;
  client: string;
  provider: string;
  status: number;
  createdAt: number;
  updatedAt: number;
}

export interface ServiceContractFilter extends PaginationOpts {
  /** Filter by client or provider address. */
  address?: string;
  status?: number;
}

// -- Proposal queries -------------------------------------------------------

export interface ProposalRow {
  proposalId: number;
  proposer: string;
  pType: number;
  status: number;
  createdAt: number;
}

export interface ProposalFilter extends PaginationOpts {
  proposer?: string;
  status?: number;
}

// -- Vote queries -----------------------------------------------------------

export interface VoteRow {
  proposalId: number;
  voter: string;
  support: number;
  weight: string;
  timestamp: number;
}

export interface VoteFilter extends PaginationOpts {
  proposalId?: number;
  voter?: string;
}

// -- Review queries ---------------------------------------------------------

export interface ReviewRow {
  reviewHash: string;
  reviewerDid: string;
  subjectDid: string;
  relatedTxHash: string;
  timestamp: number;
}

export interface ReviewFilter extends PaginationOpts {
  subjectDid?: string;
  reviewerDid?: string;
}

// -- DID cache queries ------------------------------------------------------

export interface DidCacheRow {
  controller: string;
  activeKey: string;
  isActive: boolean;
  updatedAt: number;
}

// -- Generic event queries --------------------------------------------------

export interface EventRow {
  id: number;
  block: number;
  txHash: string;
  logIndex: number;
  contract: string;
  eventName: string;
  args: string;
  timestamp: number;
}

export interface EventFilter extends PaginationOpts {
  contract?: string;
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
}

// -- Relay reward queries ---------------------------------------------------

export interface RelayRewardRow {
  id: number;
  relayDidHash: string;
  periodId: number;
  rewardAmount: string;
  confirmedBytes: string;
  confirmedPeers: number;
  timestamp: number;
}

export interface RelayRewardFilter extends PaginationOpts {
  relayDidHash?: string;
}

// ---------------------------------------------------------------------------
// IndexerQuery
// ---------------------------------------------------------------------------

export class IndexerQuery {
  constructor(private readonly db: Database.Database) {}

  // ── Transfers ───────────────────────────────────────────────────────────

  getTransfers(filter: TransferFilter = {}): PaginatedResult<TransferRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.address) {
      where.push('(from_addr = ? OR to_addr = ?)');
      params.push(filter.address, filter.address);
    }
    if (filter.fromBlock !== undefined) {
      where.push('block >= ?');
      params.push(filter.fromBlock);
    }
    if (filter.toBlock !== undefined) {
      where.push('block <= ?');
      params.push(filter.toBlock);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('wallet_transfers', clause, params);
    const rows = this.db
      .prepare(
        `SELECT id, block, tx_hash AS txHash, from_addr AS fromAddr,
                to_addr AS toAddr, amount, timestamp
         FROM wallet_transfers ${clause}
         ORDER BY block DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as TransferRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Escrows ─────────────────────────────────────────────────────────────

  getEscrows(filter: EscrowFilter = {}): PaginatedResult<EscrowRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.address) {
      where.push('(depositor = ? OR beneficiary = ? OR arbiter = ?)');
      params.push(filter.address, filter.address, filter.address);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      params.push(filter.status);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('escrows', clause, params);
    const rows = this.db
      .prepare(
        `SELECT escrow_id AS escrowId, depositor, beneficiary, arbiter,
                amount, status, created_at AS createdAt, updated_at AS updatedAt
         FROM escrows ${clause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as EscrowRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Service contracts ───────────────────────────────────────────────────

  getServiceContracts(
    filter: ServiceContractFilter = {},
  ): PaginatedResult<ServiceContractRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.address) {
      where.push('(client = ? OR provider = ?)');
      params.push(filter.address, filter.address);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      params.push(filter.status);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('service_contracts', clause, params);
    const rows = this.db
      .prepare(
        `SELECT contract_id AS contractId, client, provider, status,
                created_at AS createdAt, updated_at AS updatedAt
         FROM service_contracts ${clause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ServiceContractRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Proposals ───────────────────────────────────────────────────────────

  getProposals(filter: ProposalFilter = {}): PaginatedResult<ProposalRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.proposer) {
      where.push('proposer = ?');
      params.push(filter.proposer);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      params.push(filter.status);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('proposals', clause, params);
    const rows = this.db
      .prepare(
        `SELECT proposal_id AS proposalId, proposer, p_type AS pType,
                status, created_at AS createdAt
         FROM proposals ${clause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ProposalRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Votes ───────────────────────────────────────────────────────────────

  getVotes(filter: VoteFilter = {}): PaginatedResult<VoteRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.proposalId !== undefined) {
      where.push('proposal_id = ?');
      params.push(filter.proposalId);
    }
    if (filter.voter) {
      where.push('voter = ?');
      params.push(filter.voter);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('votes', clause, params);
    const rows = this.db
      .prepare(
        `SELECT proposal_id AS proposalId, voter, support, weight, timestamp
         FROM votes ${clause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as VoteRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Reviews ─────────────────────────────────────────────────────────────

  getReviews(filter: ReviewFilter = {}): PaginatedResult<ReviewRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.subjectDid) {
      where.push('subject_did = ?');
      params.push(filter.subjectDid);
    }
    if (filter.reviewerDid) {
      where.push('reviewer_did = ?');
      params.push(filter.reviewerDid);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('reviews', clause, params);
    const rows = this.db
      .prepare(
        `SELECT review_hash AS reviewHash, reviewer_did AS reviewerDid,
                subject_did AS subjectDid, related_tx_hash AS relatedTxHash,
                timestamp
         FROM reviews ${clause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ReviewRow[];

    return { items: rows, total, limit, offset };
  }

  // ── DID cache ───────────────────────────────────────────────────────────

  /**
   * Look up a single DID record from the indexer cache.
   *
   * @param didHash  The keccak256 hash of the full DID string.
   * @returns Cached record, or `null` if not found.
   */
  getDid(didHash: string): DidCacheRow | null {
    const row = this.db
      .prepare(
        `SELECT controller, active_key AS activeKey,
                is_active AS isActive, updated_at AS updatedAt
         FROM did_cache
         WHERE did_hash = ?`,
      )
      .get(didHash) as { controller: string; activeKey: string; isActive: number; updatedAt: number } | undefined;

    if (!row) return null;
    return {
      controller: row.controller,
      activeKey: row.activeKey,
      isActive: row.isActive === 1,
      updatedAt: row.updatedAt,
    };
  }

  // ── Generic events ──────────────────────────────────────────────────────

  getEvents(filter: EventFilter = {}): PaginatedResult<EventRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.contract) {
      where.push('contract = ?');
      params.push(filter.contract);
    }
    if (filter.eventName) {
      where.push('event_name = ?');
      params.push(filter.eventName);
    }
    if (filter.fromBlock !== undefined) {
      where.push('block >= ?');
      params.push(filter.fromBlock);
    }
    if (filter.toBlock !== undefined) {
      where.push('block <= ?');
      params.push(filter.toBlock);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('events', clause, params);
    const rows = this.db
      .prepare(
        `SELECT id, block, tx_hash AS txHash, log_index AS logIndex,
                contract, event_name AS eventName, args, timestamp
         FROM events ${clause}
         ORDER BY block DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as EventRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Relay Rewards ───────────────────────────────────────────────────────

  getRelayRewards(filter: RelayRewardFilter = {}): PaginatedResult<RelayRewardRow> {
    const { limit, offset } = normalisePagination(filter);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.relayDidHash) {
      where.push('relay_did_hash = ?');
      params.push(filter.relayDidHash);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.count('relay_rewards', whereClause, params);

    const rows = this.db
      .prepare(
        `SELECT id, relay_did_hash AS relayDidHash, period_id AS periodId,
                reward_amount AS rewardAmount, confirmed_bytes AS confirmedBytes,
                confirmed_peers AS confirmedPeers, timestamp
         FROM relay_rewards ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as RelayRewardRow[];

    return { items: rows, total, limit, offset };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private count(
    table: string,
    whereClause: string,
    params: unknown[],
  ): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM ${table} ${whereClause}`)
      .get(...params) as { cnt: number };
    return row.cnt;
  }

  // ── Faucet claims ───────────────────────────────────────────────────────

  /** Check whether a DID has already claimed from the public faucet. */
  hasFaucetClaim(did: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM faucet_claims WHERE did = ?')
      .get(did) as { 1: number } | undefined;
    return row !== undefined;
  }

  /** Count faucet claims from a given IP since the provided ISO timestamp. */
  getIpFaucetClaimCount(ip: string, since: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM faucet_claims WHERE ip = ? AND claimed_at >= ?')
      .get(ip, since) as { cnt: number };
    return row.cnt;
  }

  /** Record a new faucet claim. */
  insertFaucetClaim(claim: {
    did: string;
    address: string;
    amount: number;
    ip?: string;
    txHash?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO faucet_claims (did, address, amount, ip, tx_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(claim.did, claim.address, claim.amount, claim.ip ?? null, claim.txHash ?? null);
  }

  /** Get total faucet Tokens distributed today (UTC). */
  getFaucetDailyTotal(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM faucet_claims
         WHERE claimed_at >= date('now')`,
      )
      .get() as { total: number };
    return row.total;
  }

  /** List faucet claims with pagination. */
  listFaucetClaims(opts: PaginationOpts = {}): PaginatedResult<{
    did: string;
    address: string;
    amount: number;
    txHash: string | null;
    claimedAt: string;
  }> {
    const { limit, offset } = normalisePagination(opts);
    const total = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM faucet_claims').get() as { cnt: number }
    ).cnt;
    const rows = this.db
      .prepare(
        `SELECT did, address, amount, tx_hash AS txHash, claimed_at AS claimedAt
         FROM faucet_claims ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
        did: string;
        address: string;
        amount: number;
        txHash: string | null;
        claimedAt: string;
      }>;
    return { items: rows, total, limit, offset };
  }

  /** Faucet stats: total claims count and total distributed. */
  getFaucetStats(): { totalClaims: number; totalDistributed: number; todayDistributed: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS totalClaims, COALESCE(SUM(amount), 0) AS totalDistributed FROM faucet_claims`,
      )
      .get() as { totalClaims: number; totalDistributed: number };
    return {
      totalClaims: row.totalClaims,
      totalDistributed: row.totalDistributed,
      todayDistributed: this.getFaucetDailyTotal(),
    };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function normalisePagination(opts: PaginationOpts): {
  limit: number;
  offset: number;
} {
  let limit = opts.limit ?? DEFAULT_LIMIT;
  if (limit < 1) limit = 1;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = Math.max(opts.offset ?? 0, 0);
  return { limit, offset };
}
