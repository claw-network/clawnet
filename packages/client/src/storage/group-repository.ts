import Database from 'better-sqlite3';

import type {
  GroupChainState,
  GroupMemberRecord,
  GroupRecord,
  GroupState,
  MembershipState,
} from '../protocol/index.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  group_id TEXT PRIMARY KEY,
  creator_did TEXT NOT NULL,
  creator_did_hash TEXT NOT NULL,
  group_domain TEXT NOT NULL,
  domain_proof_hash TEXT NOT NULL,
  initial_mls_state_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  tx_hash TEXT,
  block_number INTEGER
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  did TEXT NOT NULL,
  did_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  invite_id TEXT,
  tx_hash TEXT,
  PRIMARY KEY(group_id, did_hash)
);

CREATE TABLE IF NOT EXISTS group_chain_state (
  group_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  pending_tx_hash TEXT,
  finalized_tx_hash TEXT,
  block_number INTEGER,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  tx_hash TEXT,
  block_number INTEGER,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_indexed_block INTEGER NOT NULL,
  last_indexed_hash TEXT,
  reorg_count INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexed_blocks (
  block_number INTEGER PRIMARY KEY,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  indexed_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_events_group_id ON group_events(group_id);
`;

interface GroupEventRow {
  id: number;
  groupId: string;
  eventName: string;
  txHash: string | null;
  blockNumber: number | null;
  payloadJson: string;
  createdAtMs: number;
}

interface GroupEventRowWithoutId {
  eventName: string;
  txHash: string | null;
  blockNumber: number | null;
  payloadJson: string;
  createdAtMs: number;
}

export interface GroupEventRecord {
  id: number;
  groupId: string;
  eventName: string;
  txHash: string | null;
  blockNumber: number | null;
  payload: Record<string, unknown>;
  createdAtMs: number;
}

export interface IndexedBlockRecord {
  blockNumber: number;
  blockHash: string;
  parentHash: string;
  indexedAtMs: number;
}

export interface IndexerStateRecord {
  lastIndexedBlock: number;
  lastIndexedHash: string | null;
  reorgCount: number;
  updatedAtMs: number;
}

export class GroupRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  saveGroup(record: GroupRecord): void {
    this.db
      .prepare(
        `INSERT INTO groups (
          group_id, creator_did, creator_did_hash, group_domain, domain_proof_hash,
          initial_mls_state_hash, state, created_at_ms, tx_hash, block_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id) DO UPDATE SET
          state = excluded.state,
          tx_hash = excluded.tx_hash,
          block_number = excluded.block_number`,
      )
      .run(
        record.groupId,
        record.creatorDid,
        record.creatorDidHash,
        record.groupDomain,
        record.domainProofHash,
        record.initialMlsStateHash,
        record.state,
        record.createdAtMs,
        record.txHash ?? null,
        record.blockNumber ?? null,
      );
  }

  getGroup(groupId: string): GroupRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          group_id AS groupId,
          creator_did AS creatorDid,
          creator_did_hash AS creatorDidHash,
          group_domain AS groupDomain,
          domain_proof_hash AS domainProofHash,
          initial_mls_state_hash AS initialMlsStateHash,
          state,
          created_at_ms AS createdAtMs,
          tx_hash AS txHash,
          block_number AS blockNumber
        FROM groups
        WHERE group_id = ?`,
      )
      .get(groupId) as GroupRecord | undefined;

    return row ?? null;
  }

  listGroups(): GroupRecord[] {
    return this.db
      .prepare(
        `SELECT
          group_id AS groupId,
          creator_did AS creatorDid,
          creator_did_hash AS creatorDidHash,
          group_domain AS groupDomain,
          domain_proof_hash AS domainProofHash,
          initial_mls_state_hash AS initialMlsStateHash,
          state,
          created_at_ms AS createdAtMs,
          tx_hash AS txHash,
          block_number AS blockNumber
        FROM groups
        ORDER BY created_at_ms ASC`,
      )
      .all() as GroupRecord[];
  }

  saveMember(record: GroupMemberRecord): void {
    this.db
      .prepare(
        `INSERT INTO group_members (
          group_id, did, did_hash, state, joined_at_ms, invite_id, tx_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id, did_hash) DO UPDATE SET
          state = excluded.state,
          invite_id = excluded.invite_id,
          tx_hash = excluded.tx_hash`,
      )
      .run(
        record.groupId,
        record.did,
        record.didHash,
        record.state,
        record.joinedAtMs,
        record.inviteId ?? null,
        record.txHash ?? null,
      );
  }

  removeMember(groupId: string, didHash: string): void {
    this.db
      .prepare('DELETE FROM group_members WHERE group_id = ? AND did_hash = ?')
      .run(groupId, didHash);
  }

  listMembers(groupId: string, state?: MembershipState): GroupMemberRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          group_id AS groupId,
          did,
          did_hash AS didHash,
          state,
          joined_at_ms AS joinedAtMs,
          invite_id AS inviteId,
          tx_hash AS txHash
        FROM group_members
        WHERE group_id = ? ${state ? 'AND state = ?' : ''}
        ORDER BY joined_at_ms ASC`,
      )
      .all(...(state ? [groupId, state] : [groupId])) as GroupMemberRecord[];

    return rows;
  }

  saveChainState(state: GroupChainState): void {
    this.db
      .prepare(
        `INSERT INTO group_chain_state (
          group_id, state, pending_tx_hash, finalized_tx_hash, block_number, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id) DO UPDATE SET
          state = excluded.state,
          pending_tx_hash = excluded.pending_tx_hash,
          finalized_tx_hash = excluded.finalized_tx_hash,
          block_number = excluded.block_number,
          updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        state.groupId,
        state.state,
        state.pendingTxHash ?? null,
        state.finalizedTxHash ?? null,
        state.blockNumber ?? null,
        state.updatedAtMs,
      );
  }

  getChainState(groupId: string): GroupChainState | null {
    const row = this.db
      .prepare(
        `SELECT
          group_id AS groupId,
          state,
          pending_tx_hash AS pendingTxHash,
          finalized_tx_hash AS finalizedTxHash,
          block_number AS blockNumber,
          updated_at_ms AS updatedAtMs
        FROM group_chain_state
        WHERE group_id = ?`,
      )
      .get(groupId) as GroupChainState | undefined;

    return row ?? null;
  }

  recordEvent(params: {
    groupId: string;
    eventName: string;
    txHash?: string;
    blockNumber?: number;
    payload: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO group_events (
          group_id, event_name, tx_hash, block_number, payload_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.groupId,
        params.eventName,
        params.txHash ?? null,
        params.blockNumber ?? null,
        JSON.stringify(params.payload),
        Date.now(),
      );
  }

  listEvents(groupId: string): Array<{
    eventName: string;
    txHash: string | null;
    blockNumber: number | null;
    payload: Record<string, unknown>;
    createdAtMs: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT
          event_name AS eventName,
          tx_hash AS txHash,
          block_number AS blockNumber,
          payload_json AS payloadJson,
          created_at_ms AS createdAtMs
         FROM group_events
         WHERE group_id = ?
         ORDER BY id ASC`,
      )
      .all(groupId) as GroupEventRowWithoutId[];

    return rows.map((row) => ({
      eventName: row.eventName,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      createdAtMs: row.createdAtMs,
    }));
  }

  listAllEvents(toBlock?: number): GroupEventRecord[] {
    const query = toBlock == null
      ? `SELECT
           id,
           group_id AS groupId,
           event_name AS eventName,
           tx_hash AS txHash,
           block_number AS blockNumber,
           payload_json AS payloadJson,
           created_at_ms AS createdAtMs
         FROM group_events
         ORDER BY id ASC`
      : `SELECT
           id,
           group_id AS groupId,
           event_name AS eventName,
           tx_hash AS txHash,
           block_number AS blockNumber,
           payload_json AS payloadJson,
           created_at_ms AS createdAtMs
         FROM group_events
         WHERE block_number IS NOT NULL AND block_number <= ?
         ORDER BY id ASC`;

    const rows = (toBlock == null
      ? this.db.prepare(query).all()
      : this.db.prepare(query).all(toBlock)) as GroupEventRow[];

    return rows.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      eventName: row.eventName,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      createdAtMs: row.createdAtMs,
    }));
  }

  deleteEventsAfterBlock(blockNumber: number): void {
    this.db
      .prepare('DELETE FROM group_events WHERE block_number IS NOT NULL AND block_number > ?')
      .run(blockNumber);
  }

  clearReadModel(): void {
    this.db.exec('DELETE FROM groups; DELETE FROM group_members; DELETE FROM group_chain_state;');
  }

  updateGroupState(groupId: string, state: GroupState, txHash?: string, blockNumber?: number): void {
    this.db
      .prepare(
        `UPDATE groups
         SET state = ?, tx_hash = COALESCE(?, tx_hash), block_number = COALESCE(?, block_number)
         WHERE group_id = ?`,
      )
      .run(state, txHash ?? null, blockNumber ?? null, groupId);
  }

  saveIndexerState(state: IndexerStateRecord): void {
    this.db
      .prepare(
        `INSERT INTO indexer_state (id, last_indexed_block, last_indexed_hash, reorg_count, updated_at_ms)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_indexed_block = excluded.last_indexed_block,
           last_indexed_hash = excluded.last_indexed_hash,
           reorg_count = excluded.reorg_count,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .run(state.lastIndexedBlock, state.lastIndexedHash, state.reorgCount, state.updatedAtMs);
  }

  getIndexerState(): IndexerStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           last_indexed_block AS lastIndexedBlock,
           last_indexed_hash AS lastIndexedHash,
           reorg_count AS reorgCount,
           updated_at_ms AS updatedAtMs
         FROM indexer_state
         WHERE id = 1`,
      )
      .get() as IndexerStateRecord | undefined;

    return row ?? null;
  }

  recordIndexedBlock(record: IndexedBlockRecord): void {
    this.db
      .prepare(
        `INSERT INTO indexed_blocks (block_number, block_hash, parent_hash, indexed_at_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(block_number) DO UPDATE SET
           block_hash = excluded.block_hash,
           parent_hash = excluded.parent_hash,
           indexed_at_ms = excluded.indexed_at_ms`,
      )
      .run(record.blockNumber, record.blockHash, record.parentHash, record.indexedAtMs);
  }

  getIndexedBlock(blockNumber: number): IndexedBlockRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          block_number AS blockNumber,
          block_hash AS blockHash,
          parent_hash AS parentHash,
          indexed_at_ms AS indexedAtMs
        FROM indexed_blocks
        WHERE block_number = ?`,
      )
      .get(blockNumber) as IndexedBlockRecord | undefined;

    return row ?? null;
  }

  deleteIndexedBlocksAfter(blockNumber: number): void {
    this.db
      .prepare('DELETE FROM indexed_blocks WHERE block_number > ?')
      .run(blockNumber);
  }
}
