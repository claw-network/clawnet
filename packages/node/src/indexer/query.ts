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
