/**
 * IndexerStore SQLite persistence for the Event Indexer.
 *
 * Manages all on-chain event data:
 * - Generic `events` table (raw event log)
 * - Module-specific materialized tables (transfers, contracts, proposals, votes, reviews, escrows)
 * - Indexer metadata (last indexed block, etc.)
 *
 * Uses `better-sqlite3` for synchronous, single-connection access
 * ideal for a single-node daemon where reads and writes are serialised.
 */

import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawEvent {
  block: number;
  txHash: string;
  logIndex: number;
  contract: string;
  eventName: string;
  args: string; // JSON-encoded
  timestamp: number;
}

export interface WalletTransfer {
  id?: number;
  block: number;
  txHash: string;
  fromAddr: string;
  toAddr: string;
  amount: string; // uint256 as decimal string
  timestamp: number;
}

export interface IndexedServiceContract {
  contractId: string;
  client: string;
  provider: string;
  status: number;
  createdAt: number;
  updatedAt: number;
}

export interface IndexedProposal {
  proposalId: number;
  proposer: string;
  pType: number;
  status: number;
  createdAt: number;
}

export interface IndexedVote {
  proposalId: number;
  voter: string;
  support: number;
  weight: string; // uint256 as decimal string
  timestamp: number;
}

export interface IndexedReview {
  reviewHash: string;
  reviewerDid: string;
  subjectDid: string;
  relatedTxHash: string;
  timestamp: number;
}

export interface EscrowRecord {
  escrowId: string;
  depositor: string;
  beneficiary: string;
  arbiter: string;
  amount: string;
  status: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
-- Indexer metadata (last indexed block, etc.)
CREATE TABLE IF NOT EXISTS indexer_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Generic event log (all contracts, all events)
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  block       INTEGER NOT NULL,
  tx_hash     TEXT    NOT NULL,
  log_index   INTEGER NOT NULL,
  contract    TEXT    NOT NULL,
  event_name  TEXT    NOT NULL,
  args        TEXT    NOT NULL,
  timestamp   INTEGER NOT NULL,
  UNIQUE(tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_events_block    ON events(block);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract, event_name);

-- Wallet: Token transfer history
CREATE TABLE IF NOT EXISTS wallet_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  block       INTEGER NOT NULL,
  tx_hash     TEXT    NOT NULL,
  from_addr   TEXT    NOT NULL,
  to_addr     TEXT    NOT NULL,
  amount      TEXT    NOT NULL,
  timestamp   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON wallet_transfers(from_addr);
CREATE INDEX IF NOT EXISTS idx_transfers_to   ON wallet_transfers(to_addr);

-- Wallet: Escrow records
CREATE TABLE IF NOT EXISTS escrows (
  escrow_id   TEXT    PRIMARY KEY,
  depositor   TEXT    NOT NULL,
  beneficiary TEXT    NOT NULL,
  arbiter     TEXT    NOT NULL,
  amount      TEXT    NOT NULL,
  status      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Service contracts
CREATE TABLE IF NOT EXISTS service_contracts (
  contract_id TEXT    PRIMARY KEY,
  client      TEXT    NOT NULL,
  provider    TEXT    NOT NULL,
  status      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_svc_client   ON service_contracts(client);
CREATE INDEX IF NOT EXISTS idx_svc_provider ON service_contracts(provider);
CREATE INDEX IF NOT EXISTS idx_svc_status   ON service_contracts(status);

-- DAO proposals
CREATE TABLE IF NOT EXISTS proposals (
  proposal_id INTEGER PRIMARY KEY,
  proposer    TEXT    NOT NULL,
  p_type      INTEGER NOT NULL,
  status      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- DAO votes
CREATE TABLE IF NOT EXISTS votes (
  proposal_id INTEGER NOT NULL,
  voter       TEXT    NOT NULL,
  support     INTEGER NOT NULL,
  weight      TEXT    NOT NULL,
  timestamp   INTEGER NOT NULL,
  PRIMARY KEY(proposal_id, voter)
);

-- Reputation reviews
CREATE TABLE IF NOT EXISTS reviews (
  review_hash      TEXT PRIMARY KEY,
  reviewer_did     TEXT NOT NULL,
  subject_did      TEXT NOT NULL,
  related_tx_hash  TEXT NOT NULL,
  timestamp        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_subject ON reviews(subject_did);

-- DID cache (identity module)
CREATE TABLE IF NOT EXISTS did_cache (
  did_hash    TEXT PRIMARY KEY,
  controller  TEXT NOT NULL,
  active_key  TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);
`;

// ---------------------------------------------------------------------------
// IndexerStore
// ---------------------------------------------------------------------------

export class IndexerStore {
  private readonly _db: Database.Database;

  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._db.exec(SCHEMA_SQL);
  }

  /** Expose the underlying Database instance (for IndexerQuery). */
  get database(): Database.Database {
    return this._db;
  }

  // ── Metadata ────────────────────────────────────────────────────────────

  getMeta(key: string): string | undefined {
    const row = this._db
      .prepare('SELECT value FROM indexer_meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this._db
      .prepare(
        'INSERT INTO indexer_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  get lastIndexedBlock(): number {
    const val = this.getMeta('last_indexed_block');
    return val ? Number(val) : 0;
  }

  set lastIndexedBlock(block: number) {
    this.setMeta('last_indexed_block', String(block));
  }

  // ── Generic events ──────────────────────────────────────────────────────

  insertEvent(event: RawEvent): void {
    this._db
      .prepare(
        `INSERT OR IGNORE INTO events (block, tx_hash, log_index, contract, event_name, args, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.block,
        event.txHash,
        event.logIndex,
        event.contract,
        event.eventName,
        event.args,
        event.timestamp,
      );
  }

  // ── Wallet transfers ────────────────────────────────────────────────────

  insertTransfer(t: WalletTransfer): void {
    this._db
      .prepare(
        `INSERT INTO wallet_transfers (block, tx_hash, from_addr, to_addr, amount, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(t.block, t.txHash, t.fromAddr, t.toAddr, t.amount, t.timestamp);
  }

  // ── Escrows ─────────────────────────────────────────────────────────────

  upsertEscrow(e: EscrowRecord): void {
    this._db
      .prepare(
        `INSERT INTO escrows (escrow_id, depositor, beneficiary, arbiter, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(escrow_id) DO UPDATE SET
           status = excluded.status,
           amount = excluded.amount,
           updated_at = excluded.updated_at`,
      )
      .run(
        e.escrowId,
        e.depositor,
        e.beneficiary,
        e.arbiter,
        e.amount,
        e.status,
        e.createdAt,
        e.updatedAt,
      );
  }

  updateEscrowStatus(escrowId: string, status: number, updatedAt: number): void {
    this._db
      .prepare('UPDATE escrows SET status = ?, updated_at = ? WHERE escrow_id = ?')
      .run(status, updatedAt, escrowId);
  }

  // ── Service contracts ───────────────────────────────────────────────────

  upsertServiceContract(c: IndexedServiceContract): void {
    this._db
      .prepare(
        `INSERT INTO service_contracts (contract_id, client, provider, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(contract_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run(
        c.contractId,
        c.client,
        c.provider,
        c.status,
        c.createdAt,
        c.updatedAt,
      );
  }

  updateServiceContractStatus(
    contractId: string,
    status: number,
    updatedAt: number,
  ): void {
    this._db
      .prepare(
        'UPDATE service_contracts SET status = ?, updated_at = ? WHERE contract_id = ?',
      )
      .run(status, updatedAt, contractId);
  }

  // ── DAO proposals ───────────────────────────────────────────────────────

  upsertProposal(p: IndexedProposal): void {
    this._db
      .prepare(
        `INSERT INTO proposals (proposal_id, proposer, p_type, status, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(proposal_id) DO UPDATE SET
           status = excluded.status`,
      )
      .run(p.proposalId, p.proposer, p.pType, p.status, p.createdAt);
  }

  updateProposalStatus(proposalId: number, status: number): void {
    this._db
      .prepare('UPDATE proposals SET status = ? WHERE proposal_id = ?')
      .run(status, proposalId);
  }

  // ── DAO votes ───────────────────────────────────────────────────────────

  insertVote(v: IndexedVote): void {
    this._db
      .prepare(
        `INSERT OR IGNORE INTO votes (proposal_id, voter, support, weight, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(v.proposalId, v.voter, v.support, v.weight, v.timestamp);
  }

  // ── Reputation reviews ──────────────────────────────────────────────────

  insertReview(r: IndexedReview): void {
    this._db
      .prepare(
        `INSERT OR IGNORE INTO reviews (review_hash, reviewer_did, subject_did, related_tx_hash, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        r.reviewHash,
        r.reviewerDid,
        r.subjectDid,
        r.relatedTxHash,
        r.timestamp,
      );
  }

  // ── DID cache ───────────────────────────────────────────────────────────

  upsertDid(
    didHash: string,
    controller: string,
    activeKey: string,
    isActive: boolean,
    updatedAt: number,
  ): void {
    this._db
      .prepare(
        `INSERT INTO did_cache (did_hash, controller, active_key, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(did_hash) DO UPDATE SET
           controller = excluded.controller,
           active_key = excluded.active_key,
           is_active  = excluded.is_active,
           updated_at = excluded.updated_at`,
      )
      .run(didHash, controller, activeKey, isActive ? 1 : 0, updatedAt);
  }

  // ── Transaction helper ──────────────────────────────────────────────────

  /** Execute a batch of operations inside a single SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this._db.transaction(fn)();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  close(): void {
    this._db.close();
  }
}
