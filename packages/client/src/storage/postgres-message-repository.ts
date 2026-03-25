import { Pool, type PoolClient } from 'pg';

import type { ConversationSummary, Envelope } from '../protocol/index.js';

import type {
  DirectConversationParticipantCheckResult,
  EnvelopeCursorKey,
  MailboxStore,
  ProvisionalRetractionRecord,
  StoredEnvelopeRecord,
} from './mailbox-store.js';

export interface PostgresMessageRepositoryOptions {
  connectionString: string;
  schema?: string;
  maxConnections?: number;
  ssl?: boolean;
}

interface MailboxEnvelopeRow {
  envelope_id: string;
  conversation_id: string;
  conversation_type: 'direct' | 'group';
  target_domain: string | null;
  target_did: string;
  mailbox_key_id: string;
  sealed_header: string;
  seq: string;
  epoch: number | null;
  ciphertext: string;
  content_type: 'text' | 'image' | 'file' | 'control';
  attachment_manifest_hash: string | null;
  sent_at_ms: string;
  ttl_sec: number;
  provisional: boolean;
  idempotency_signature: string;
}

interface RetractionRow {
  envelope_id: string;
  conversation_id: string;
  reason: 'REORGED_BACK';
  retracted_at_ms: string;
}

interface DirectConversationRow {
  participant_a_hash: string;
  participant_b_hash: string | null;
}

function assertSchemaName(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`invalid postgres schema name: ${value}`);
  }
  return value;
}

export class PostgresMessageRepository implements MailboxStore {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: PostgresMessageRepositoryOptions) {
    this.schema = assertSchemaName(options.schema ?? 'public');
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init(): Promise<void> {
    const schemaName = this.schema;
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table('mailbox_envelopes')} (
        envelope_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        conversation_type TEXT NOT NULL,
        target_domain TEXT,
        target_did TEXT NOT NULL,
        mailbox_key_id TEXT NOT NULL,
        sealed_header TEXT NOT NULL,
        seq BIGINT NOT NULL,
        epoch INTEGER,
        ciphertext TEXT NOT NULL,
        content_type TEXT NOT NULL,
        attachment_manifest_hash TEXT,
        sent_at_ms BIGINT NOT NULL,
        ttl_sec INTEGER NOT NULL,
        provisional BOOLEAN NOT NULL DEFAULT FALSE,
        idempotency_signature TEXT NOT NULL,
        expires_at_ms BIGINT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table('mailbox_retractions')} (
        envelope_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        retracted_at_ms BIGINT NOT NULL,
        idempotency_signature TEXT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table('mailbox_sequences')} (
        conversation_id TEXT PRIMARY KEY,
        last_seq BIGINT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table('mailbox_direct_conversations')} (
        conversation_id TEXT PRIMARY KEY,
        participant_a_hash TEXT NOT NULL,
        participant_b_hash TEXT,
        created_at_ms BIGINT NOT NULL,
        updated_at_ms BIGINT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table('mailbox_conversations')} (
        conversation_id TEXT PRIMARY KEY,
        conversation_type TEXT NOT NULL DEFAULT 'direct',
        peer_did TEXT,
        group_id TEXT,
        display_name TEXT NOT NULL DEFAULT '',
        last_message_preview TEXT,
        last_message_at_ms BIGINT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        private BOOLEAN NOT NULL DEFAULT FALSE,
        avatar_url TEXT,
        updated_at_ms BIGINT NOT NULL
      )
    `);


    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_sent ON ${this.table('mailbox_envelopes')}(sent_at_ms, conversation_id)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_conversation_seq ON ${this.table('mailbox_envelopes')}(conversation_id, seq)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_pull_cursor ON ${this.table('mailbox_envelopes')}(sent_at_ms, conversation_id, seq, envelope_id)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_expires ON ${this.table('mailbox_envelopes')}(expires_at_ms)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_provisional ON ${this.table('mailbox_envelopes')}(conversation_type, provisional)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_retractions_time ON ${this.table('mailbox_retractions')}(retracted_at_ms DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_direct_conversations_a ON ${this.table('mailbox_direct_conversations')}(participant_a_hash)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_direct_conversations_b ON ${this.table('mailbox_direct_conversations')}(participant_b_hash)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_conversations_private ON ${this.table('mailbox_conversations')}(private, updated_at_ms DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_mailbox_conversations_last_msg ON ${this.table('mailbox_conversations')}(last_message_at_ms DESC)`,
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async nextSequence(conversationId: string): Promise<bigint> {
    const result = await this.pool.query<{ last_seq: string }>(
      `INSERT INTO ${this.table('mailbox_sequences')} (conversation_id, last_seq)
       VALUES ($1, 1)
       ON CONFLICT(conversation_id) DO UPDATE SET
         last_seq = ${this.table('mailbox_sequences')}.last_seq + 1
       RETURNING last_seq::text AS last_seq`,
      [conversationId],
    );

    if (!result.rowCount || !result.rows[0]) {
      throw new Error(`failed to allocate sequence for conversation(${conversationId})`);
    }
    return BigInt(result.rows[0].last_seq);
  }

  async saveEnvelope(record: StoredEnvelopeRecord): Promise<void> {
    const envelope = record.envelope;
    const expiresAtMs = envelope.sentAtMs + envelope.ttlSec * 1000;

    await this.pool.query(
      `INSERT INTO ${this.table('mailbox_envelopes')} (
        envelope_id, conversation_id, conversation_type, target_domain, target_did, mailbox_key_id,
        sealed_header, seq, epoch, ciphertext, content_type, attachment_manifest_hash,
        sent_at_ms, ttl_sec, provisional, idempotency_signature, expires_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        envelope.envelopeId,
        envelope.conversationId,
        envelope.conversationType,
        envelope.routeHint.targetDomain ?? null,
        envelope.routeHint.targetDid,
        envelope.routeHint.mailboxKeyId,
        envelope.sealedHeader,
        envelope.seq.toString(),
        envelope.epoch ?? null,
        envelope.ciphertext,
        envelope.contentType,
        envelope.attachmentManifestHash ?? null,
        envelope.sentAtMs,
        envelope.ttlSec,
        envelope.provisional ?? false,
        record.idempotencySignature,
        expiresAtMs,
      ],
    );
  }

  async getEnvelopeRecord(envelopeId: string): Promise<StoredEnvelopeRecord | null> {
    const result = await this.pool.query<MailboxEnvelopeRow>(
      `SELECT
         envelope_id,
         conversation_id,
         conversation_type,
         target_domain,
         target_did,
         mailbox_key_id,
         sealed_header,
         seq::text AS seq,
         epoch,
         ciphertext,
         content_type,
         attachment_manifest_hash,
         sent_at_ms::text AS sent_at_ms,
         ttl_sec,
         provisional,
         idempotency_signature
       FROM ${this.table('mailbox_envelopes')}
       WHERE envelope_id = $1`,
      [envelopeId],
    );

    if (!result.rowCount || !result.rows[0]) {
      return null;
    }

    const row = result.rows[0];
    return {
      envelope: this.toEnvelope(row),
      idempotencySignature: row.idempotency_signature,
    };
  }

  async getIdempotencySignature(envelopeId: string): Promise<string | null> {
    const active = await this.pool.query<{ idempotency_signature: string }>(
      `SELECT idempotency_signature
       FROM ${this.table('mailbox_envelopes')}
       WHERE envelope_id = $1`,
      [envelopeId],
    );
    if (active.rowCount && active.rows[0]) {
      return active.rows[0].idempotency_signature;
    }

    const retracted = await this.pool.query<{ idempotency_signature: string }>(
      `SELECT idempotency_signature
       FROM ${this.table('mailbox_retractions')}
       WHERE envelope_id = $1`,
      [envelopeId],
    );
    if (retracted.rowCount && retracted.rows[0]) {
      return retracted.rows[0].idempotency_signature;
    }
    return null;
  }

  async getRetraction(envelopeId: string): Promise<ProvisionalRetractionRecord | null> {
    const result = await this.pool.query<RetractionRow>(
      `SELECT
         envelope_id,
         conversation_id,
         reason,
         retracted_at_ms::text AS retracted_at_ms
       FROM ${this.table('mailbox_retractions')}
       WHERE envelope_id = $1`,
      [envelopeId],
    );

    if (!result.rowCount || !result.rows[0]) {
      return null;
    }
    const row = result.rows[0];
    return {
      envelopeId: row.envelope_id,
      conversationId: row.conversation_id,
      reason: row.reason,
      retractedAtMs: Number.parseInt(row.retracted_at_ms, 10),
    };
  }

  async countEnvelopes(conversationId?: string): Promise<number> {
    const result = conversationId
      ? await this.pool.query<{ count: string }>(
        `SELECT COUNT(1)::text AS count
         FROM ${this.table('mailbox_envelopes')}
         WHERE conversation_id = $1`,
        [conversationId],
      )
      : await this.pool.query<{ count: string }>(
        `SELECT COUNT(1)::text AS count
         FROM ${this.table('mailbox_envelopes')}`,
      );

    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async listEnvelopes(params: {
    conversationId?: string;
    limit: number;
    afterSeq?: bigint;
    afterKey?: EnvelopeCursorKey;
  }): Promise<Envelope[]> {
    const result = params.conversationId
      ? typeof params.afterSeq !== 'undefined'
        ? await this.pool.query<MailboxEnvelopeRow>(
          `SELECT
             envelope_id,
             conversation_id,
             conversation_type,
             target_domain,
         target_did,
             mailbox_key_id,
             sealed_header,
             seq::text AS seq,
             epoch,
             ciphertext,
             content_type,
             attachment_manifest_hash,
             sent_at_ms::text AS sent_at_ms,
             ttl_sec,
             provisional,
             idempotency_signature
           FROM ${this.table('mailbox_envelopes')}
           WHERE conversation_id = $1 AND seq > $2
           ORDER BY seq ASC, envelope_id ASC
           LIMIT $3`,
          [params.conversationId, params.afterSeq.toString(), params.limit],
        )
        : await this.pool.query<MailboxEnvelopeRow>(
          `SELECT
             envelope_id,
             conversation_id,
             conversation_type,
             target_domain,
         target_did,
             mailbox_key_id,
             sealed_header,
             seq::text AS seq,
             epoch,
             ciphertext,
             content_type,
             attachment_manifest_hash,
             sent_at_ms::text AS sent_at_ms,
             ttl_sec,
             provisional,
             idempotency_signature
           FROM ${this.table('mailbox_envelopes')}
           WHERE conversation_id = $1
           ORDER BY seq ASC, envelope_id ASC
           LIMIT $2`,
          [params.conversationId, params.limit],
        )
      : params.afterKey
        ? await this.pool.query<MailboxEnvelopeRow>(
          `SELECT
             envelope_id,
             conversation_id,
             conversation_type,
             target_domain,
         target_did,
             mailbox_key_id,
             sealed_header,
             seq::text AS seq,
             epoch,
             ciphertext,
             content_type,
             attachment_manifest_hash,
             sent_at_ms::text AS sent_at_ms,
             ttl_sec,
             provisional,
             idempotency_signature
           FROM ${this.table('mailbox_envelopes')}
           WHERE (sent_at_ms, conversation_id, seq, envelope_id) > ($1, $2, $3, $4)
           ORDER BY sent_at_ms ASC, conversation_id ASC, seq ASC, envelope_id ASC
           LIMIT $5`,
          [
            params.afterKey.sentAtMs,
            params.afterKey.conversationId,
            params.afterKey.seq.toString(),
            params.afterKey.envelopeId,
            params.limit,
          ],
        )
        : await this.pool.query<MailboxEnvelopeRow>(
          `SELECT
             envelope_id,
             conversation_id,
             conversation_type,
             target_domain,
         target_did,
             mailbox_key_id,
             sealed_header,
             seq::text AS seq,
             epoch,
             ciphertext,
             content_type,
             attachment_manifest_hash,
             sent_at_ms::text AS sent_at_ms,
             ttl_sec,
             provisional,
             idempotency_signature
           FROM ${this.table('mailbox_envelopes')}
           ORDER BY sent_at_ms ASC, conversation_id ASC, seq ASC, envelope_id ASC
           LIMIT $1`,
          [params.limit],
        );

    return result.rows.map((row) => this.toEnvelope(row));
  }

  async ensureDirectConversationParticipant(params: {
    conversationId: string;
    didHash: string;
    observedAtMs: number;
    maxParticipants?: number;
  }): Promise<DirectConversationParticipantCheckResult> {
    const maxParticipants = Math.max(2, params.maxParticipants ?? 2);
    return this.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO ${this.table('mailbox_direct_conversations')} (
          conversation_id, participant_a_hash, participant_b_hash, created_at_ms, updated_at_ms
        ) VALUES ($1, $2, NULL, $3, $4)
        ON CONFLICT(conversation_id) DO NOTHING`,
        [params.conversationId, params.didHash, params.observedAtMs, params.observedAtMs],
      );

      const found = await client.query<DirectConversationRow>(
        `SELECT participant_a_hash, participant_b_hash
         FROM ${this.table('mailbox_direct_conversations')}
         WHERE conversation_id = $1
         FOR UPDATE`,
        [params.conversationId],
      );

      if (!found.rowCount || !found.rows[0]) {
        throw new Error(`direct conversation row not found after upsert for conversation(${params.conversationId})`);
      }

      const row = found.rows[0];
      const participants = [row.participant_a_hash, row.participant_b_hash]
        .filter((item): item is string => typeof item === 'string' && item.length > 0);

      if (participants.includes(params.didHash)) {
        await client.query(
          `UPDATE ${this.table('mailbox_direct_conversations')}
           SET updated_at_ms = $2
           WHERE conversation_id = $1`,
          [params.conversationId, params.observedAtMs],
        );
        return {
          allowed: true,
          participants,
        };
      }

      if (participants.length >= maxParticipants || row.participant_b_hash) {
        return {
          allowed: false,
          participants,
        };
      }

      await client.query(
        `UPDATE ${this.table('mailbox_direct_conversations')}
         SET participant_b_hash = $2, updated_at_ms = $3
         WHERE conversation_id = $1`,
        [params.conversationId, params.didHash, params.observedAtMs],
      );
      return {
        allowed: true,
        participants: [...participants, params.didHash],
      };
    });
  }

  async listProvisionalGroupRecords(): Promise<StoredEnvelopeRecord[]> {
    const result = await this.pool.query<MailboxEnvelopeRow>(
      `SELECT
         envelope_id,
         conversation_id,
         conversation_type,
         target_domain,
         target_did,
         mailbox_key_id,
         sealed_header,
         seq::text AS seq,
         epoch,
         ciphertext,
         content_type,
         attachment_manifest_hash,
         sent_at_ms::text AS sent_at_ms,
         ttl_sec,
         provisional,
         idempotency_signature
       FROM ${this.table('mailbox_envelopes')}
       WHERE conversation_type = 'group' AND provisional = TRUE
       ORDER BY sent_at_ms ASC`,
    );

    return result.rows.map((row) => ({
      envelope: this.toEnvelope(row),
      idempotencySignature: row.idempotency_signature,
    }));
  }

  async retractEnvelope(params: {
    envelope: Envelope;
    idempotencySignature: string;
    retractedAtMs: number;
    reason: 'REORGED_BACK';
  }): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(
        `DELETE FROM ${this.table('mailbox_envelopes')}
         WHERE envelope_id = $1`,
        [params.envelope.envelopeId],
      );

      await client.query(
        `INSERT INTO ${this.table('mailbox_retractions')} (
          envelope_id, conversation_id, reason, retracted_at_ms, idempotency_signature
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(envelope_id) DO UPDATE SET
          conversation_id = EXCLUDED.conversation_id,
          reason = EXCLUDED.reason,
          retracted_at_ms = EXCLUDED.retracted_at_ms,
          idempotency_signature = EXCLUDED.idempotency_signature`,
        [
          params.envelope.envelopeId,
          params.envelope.conversationId,
          params.reason,
          params.retractedAtMs,
          params.idempotencySignature,
        ],
      );
    });
  }

  async listRetractions(limit: number): Promise<ProvisionalRetractionRecord[]> {
    const result = await this.pool.query<RetractionRow>(
      `SELECT
         envelope_id,
         conversation_id,
         reason,
         retracted_at_ms::text AS retracted_at_ms
       FROM ${this.table('mailbox_retractions')}
       ORDER BY retracted_at_ms DESC
       LIMIT $1`,
      [Math.max(1, limit)],
    );

    return result.rows.map((row) => ({
      envelopeId: row.envelope_id,
      conversationId: row.conversation_id,
      reason: row.reason,
      retractedAtMs: Number.parseInt(row.retracted_at_ms, 10),
    }));
  }

  async deleteExpired(nowMs: number): Promise<{ removed: number; remaining: number }> {
    const removed = await this.pool.query(
      `DELETE FROM ${this.table('mailbox_envelopes')}
       WHERE expires_at_ms <= $1`,
      [nowMs],
    );
    const remaining = await this.pool.query<{ count: string }>(
      `SELECT COUNT(1)::text AS count
       FROM ${this.table('mailbox_envelopes')}`,
    );

    return {
      removed: removed.rowCount ?? 0,
      remaining: Number.parseInt(remaining.rows[0]?.count ?? '0', 10),
    };
  }

  async setConversationPrivacy(params: {
    conversationId: string;
    isPrivate: boolean;
    updatedAtMs: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table('mailbox_conversations')} (
        conversation_id,
        private,
        updated_at_ms
      ) VALUES ($1, $2, $3)
      ON CONFLICT(conversation_id) DO UPDATE SET
        private = EXCLUDED.private,
        updated_at_ms = EXCLUDED.updated_at_ms`,
      [
        params.conversationId,
        params.isPrivate,
        params.updatedAtMs,
      ],
    );
  }

  async listPrivateConversationIds(limit = 5_000): Promise<string[]> {
    const result = await this.pool.query<{ conversation_id: string }>(
      `SELECT conversation_id
       FROM ${this.table('mailbox_conversations')}
       WHERE private = TRUE
       ORDER BY updated_at_ms DESC
       LIMIT $1`,
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => row.conversation_id);
  }

  async upsertConversationSummary(params: {
    conversationId: string;
    conversationType: 'direct' | 'group';
    peerDid?: string;
    groupId?: string;
    displayName: string;
    lastMessagePreview?: string | null;
    lastMessageAtMs: number;
    updatedAtMs: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table('mailbox_conversations')} (
        conversation_id, conversation_type, peer_did, group_id, display_name,
        last_message_preview, last_message_at_ms, updated_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(conversation_id) DO UPDATE SET
        last_message_preview = EXCLUDED.last_message_preview,
        last_message_at_ms = EXCLUDED.last_message_at_ms,
        updated_at_ms = EXCLUDED.updated_at_ms`,
      [
        params.conversationId,
        params.conversationType,
        params.peerDid ?? null,
        params.groupId ?? null,
        params.displayName,
        params.lastMessagePreview ?? null,
        params.lastMessageAtMs,
        params.updatedAtMs,
      ],
    );
  }

  async listConversationSummaries(params: {
    limit: number;
    afterMs?: number;
  }): Promise<ConversationSummary[]> {
    interface PgConversationRow {
      conversation_id: string;
      conversation_type: string;
      peer_did: string | null;
      group_id: string | null;
      display_name: string;
      last_message_preview: string | null;
      last_message_at_ms: string | null;
      unread_count: number;
      private: boolean;
      avatar_url: string | null;
    }

    const result = params.afterMs
      ? await this.pool.query<PgConversationRow>(
        `SELECT conversation_id, conversation_type, peer_did, group_id,
                display_name, last_message_preview, last_message_at_ms,
                unread_count, private, avatar_url
         FROM ${this.table('mailbox_conversations')}
         WHERE last_message_at_ms < $1
         ORDER BY last_message_at_ms DESC
         LIMIT $2`,
        [params.afterMs, params.limit],
      )
      : await this.pool.query<PgConversationRow>(
        `SELECT conversation_id, conversation_type, peer_did, group_id,
                display_name, last_message_preview, last_message_at_ms,
                unread_count, private, avatar_url
         FROM ${this.table('mailbox_conversations')}
         ORDER BY last_message_at_ms DESC
         LIMIT $1`,
        [params.limit],
      );

    return result.rows.map((row) => ({
      conversationId: row.conversation_id,
      conversationType: row.conversation_type as 'direct' | 'group',
      peerDid: row.peer_did ?? undefined,
      groupId: row.group_id ?? undefined,
      displayName: row.display_name,
      lastMessagePreview: row.last_message_preview,
      lastMessageAtMs: row.last_message_at_ms ? Number.parseInt(row.last_message_at_ms, 10) : undefined,
      unreadCount: row.unread_count,
      private: row.private,
      avatarUrl: row.avatar_url,
    }));
  }

  private toEnvelope(row: MailboxEnvelopeRow): Envelope {
    return {
      envelopeId: row.envelope_id,
      conversationId: row.conversation_id,
      conversationType: row.conversation_type,
      routeHint: {
        targetDomain: row.target_domain ?? undefined,
        targetDid: row.target_did,
        mailboxKeyId: row.mailbox_key_id,
      },
      sealedHeader: row.sealed_header,
      seq: BigInt(row.seq),
      epoch: row.epoch ?? undefined,
      ciphertext: row.ciphertext,
      contentType: row.content_type,
      attachmentManifestHash: row.attachment_manifest_hash ?? undefined,
      sentAtMs: Number.parseInt(row.sent_at_ms, 10),
      ttlSec: row.ttl_sec,
      provisional: row.provisional,
    };
  }

  private async withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private table(name: string): string {
    return `"${this.schema}"."${name}"`;
  }
}
