import Database from 'better-sqlite3';

import type { ConversationSummary, Envelope } from '../protocol/index.js';

import type {
  DirectConversationParticipantCheckResult,
  EnvelopeCursorKey,
  MailboxStore,
  ProvisionalRetractionRecord,
  StoredEnvelopeRecord,
} from './mailbox-store.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mailbox_envelopes (
  envelope_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  conversation_type TEXT NOT NULL,
  target_domain TEXT,
  target_did TEXT NOT NULL,
  mailbox_key_id TEXT NOT NULL,
  sealed_header TEXT NOT NULL,
  seq TEXT NOT NULL,
  epoch INTEGER,
  ciphertext TEXT NOT NULL,
  content_type TEXT NOT NULL,
  attachment_manifest_hash TEXT,
  sent_at_ms INTEGER NOT NULL,
  ttl_sec INTEGER NOT NULL,
  provisional INTEGER NOT NULL DEFAULT 0,
  read INTEGER NOT NULL DEFAULT 0,
  idempotency_signature TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox_retractions (
  envelope_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  retracted_at_ms INTEGER NOT NULL,
  idempotency_signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox_sequences (
  conversation_id TEXT PRIMARY KEY,
  last_seq TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox_direct_conversations (
  conversation_id TEXT PRIMARY KEY,
  participant_a_hash TEXT NOT NULL,
  participant_b_hash TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox_conversations (
  conversation_id TEXT PRIMARY KEY,
  conversation_type TEXT NOT NULL DEFAULT 'direct',
  peer_did TEXT,
  group_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  last_message_preview TEXT,
  last_message_at_ms INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  private INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_sent ON mailbox_envelopes(sent_at_ms, conversation_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_conversation_seq ON mailbox_envelopes(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_pull_cursor ON mailbox_envelopes(sent_at_ms, conversation_id, seq, envelope_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_expires ON mailbox_envelopes(expires_at_ms);
CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_provisional ON mailbox_envelopes(conversation_type, provisional);
CREATE INDEX IF NOT EXISTS idx_mailbox_envelopes_read ON mailbox_envelopes(read);
CREATE INDEX IF NOT EXISTS idx_mailbox_retractions_time ON mailbox_retractions(retracted_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_direct_conversations_a ON mailbox_direct_conversations(participant_a_hash);
CREATE INDEX IF NOT EXISTS idx_mailbox_direct_conversations_b ON mailbox_direct_conversations(participant_b_hash);
CREATE INDEX IF NOT EXISTS idx_mailbox_conversations_private ON mailbox_conversations(private, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_conversations_last_msg ON mailbox_conversations(last_message_at_ms DESC);
`;

interface MailboxEnvelopeRow {
  envelopeId: string;
  conversationId: string;
  conversationType: 'direct' | 'group';
  targetDomain: string | null;
  targetDid: string;
  mailboxKeyId: string;
  sealedHeader: string;
  seq: string;
  epoch: number | null;
  ciphertext: string;
  contentType: 'text' | 'image' | 'file' | 'control';
  attachmentManifestHash: string | null;
  sentAtMs: number;
  ttlSec: number;
  provisional: 0 | 1;
  read: 0 | 1;
  idempotencySignature: string;
}

interface RetractionRow {
  envelopeId: string;
  conversationId: string;
  reason: 'REORGED_BACK';
  retractedAtMs: number;
}

interface DirectConversationRow {
  participantAHash: string;
  participantBHash: string | null;
}

interface ConversationRow {
  conversation_id: string;
  conversation_type: string;
  peer_did: string | null;
  group_id: string | null;
  display_name: string;
  last_message_preview: string | null;
  last_message_at_ms: number | null;
  unread_count: number;
  private: number;
  avatar_url: string | null;
}

function toConversationSummaryFromRow(row: ConversationRow): ConversationSummary {
  return {
    conversationId: row.conversation_id,
    conversationType: row.conversation_type as 'direct' | 'group',
    peerDid: row.peer_did ?? undefined,
    groupId: row.group_id ?? undefined,
    displayName: row.display_name,
    lastMessagePreview: row.last_message_preview,
    lastMessageAtMs: row.last_message_at_ms ?? undefined,
    unreadCount: row.unread_count,
    private: row.private === 1,
    avatarUrl: row.avatar_url,
  };
}

export class MessageRepository implements MailboxStore {
  private readonly db: Database.Database;
  private readonly nextSequenceTransaction: (conversationId: string) => string;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    // Add read column if missing (existing databases).
    try {
      this.db.exec('ALTER TABLE mailbox_envelopes ADD COLUMN read INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists — ignore.
    }

    this.nextSequenceTransaction = this.db.transaction((conversationId: string) => {
      const row = this.db
        .prepare('SELECT last_seq AS lastSeq FROM mailbox_sequences WHERE conversation_id = ?')
        .get(conversationId) as { lastSeq: string } | undefined;

      const nextSeq = row ? BigInt(row.lastSeq) + 1n : 1n;
      this.db
        .prepare(
          `INSERT INTO mailbox_sequences (conversation_id, last_seq)
           VALUES (?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             last_seq = excluded.last_seq`,
        )
        .run(conversationId, nextSeq.toString());

      return nextSeq.toString();
    });
  }

  async nextSequence(conversationId: string): Promise<bigint> {
    return BigInt(this.nextSequenceTransaction(conversationId));
  }

  async saveEnvelope(record: StoredEnvelopeRecord): Promise<void> {
    const envelope = record.envelope;
    const expiresAtMs = envelope.sentAtMs + envelope.ttlSec * 1000;

    this.db
      .prepare(
        `INSERT INTO mailbox_envelopes (
          envelope_id, conversation_id, conversation_type, target_domain, target_did, mailbox_key_id,
          sealed_header, seq, epoch, ciphertext, content_type, attachment_manifest_hash,
          sent_at_ms, ttl_sec, provisional, read, idempotency_signature, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
        envelope.provisional ? 1 : 0,
        envelope.read ? 1 : 0,
        record.idempotencySignature,
        expiresAtMs,
      );
  }

  async getEnvelopeRecord(envelopeId: string): Promise<StoredEnvelopeRecord | null> {
    const row = this.db
      .prepare(
        `SELECT
          envelope_id AS envelopeId,
          conversation_id AS conversationId,
          conversation_type AS conversationType,
          target_domain AS targetDomain,
          target_did AS targetDid,
          mailbox_key_id AS mailboxKeyId,
          sealed_header AS sealedHeader,
          seq,
          epoch,
          ciphertext,
          content_type AS contentType,
          attachment_manifest_hash AS attachmentManifestHash,
          sent_at_ms AS sentAtMs,
          ttl_sec AS ttlSec,
          provisional,
          read,
          idempotency_signature AS idempotencySignature
        FROM mailbox_envelopes
        WHERE envelope_id = ?`,
      )
      .get(envelopeId) as MailboxEnvelopeRow | undefined;

    if (!row) {
      return null;
    }

    return {
      envelope: this.toEnvelope(row),
      idempotencySignature: row.idempotencySignature,
    };
  }

  async getIdempotencySignature(envelopeId: string): Promise<string | null> {
    const active = this.db
      .prepare(
        `SELECT idempotency_signature AS idempotencySignature
         FROM mailbox_envelopes
         WHERE envelope_id = ?`,
      )
      .get(envelopeId) as { idempotencySignature: string } | undefined;
    if (active) {
      return active.idempotencySignature;
    }

    const retracted = this.db
      .prepare(
        `SELECT idempotency_signature AS idempotencySignature
         FROM mailbox_retractions
         WHERE envelope_id = ?`,
      )
      .get(envelopeId) as { idempotencySignature: string } | undefined;

    return retracted?.idempotencySignature ?? null;
  }

  async getRetraction(envelopeId: string): Promise<ProvisionalRetractionRecord | null> {
    const row = this.db
      .prepare(
        `SELECT
          envelope_id AS envelopeId,
          conversation_id AS conversationId,
          reason,
          retracted_at_ms AS retractedAtMs
        FROM mailbox_retractions
        WHERE envelope_id = ?`,
      )
      .get(envelopeId) as RetractionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      envelopeId: row.envelopeId,
      conversationId: row.conversationId,
      reason: row.reason,
      retractedAtMs: row.retractedAtMs,
    };
  }

  async countEnvelopes(conversationId?: string): Promise<number> {
    const row = conversationId
      ? (this.db
        .prepare(
          `SELECT COUNT(1) AS count
           FROM mailbox_envelopes
           WHERE conversation_id = ?`,
        )
        .get(conversationId) as { count: number })
      : (this.db
        .prepare(
          `SELECT COUNT(1) AS count
           FROM mailbox_envelopes`,
        )
        .get() as { count: number });

    return row.count;
  }

  async listEnvelopes(params: {
    conversationId?: string;
    limit: number;
    afterSeq?: bigint;
    afterKey?: EnvelopeCursorKey;
    unread?: boolean;
  }): Promise<Envelope[]> {
    const readFilter = typeof params.unread === 'boolean'
      ? (params.unread ? ' AND read = 0' : ' AND read = 1')
      : '';
    const readWhere = typeof params.unread === 'boolean'
      ? (params.unread ? ' WHERE read = 0' : ' WHERE read = 1')
      : '';

    const rows = params.conversationId
      ? (() => {
        if (typeof params.afterSeq !== 'undefined') {
          return this.db
            .prepare(
              `SELECT
                envelope_id AS envelopeId,
                conversation_id AS conversationId,
                conversation_type AS conversationType,
                target_domain AS targetDomain,
          target_did AS targetDid,
                mailbox_key_id AS mailboxKeyId,
                sealed_header AS sealedHeader,
                seq,
                epoch,
                ciphertext,
                content_type AS contentType,
                attachment_manifest_hash AS attachmentManifestHash,
                sent_at_ms AS sentAtMs,
                ttl_sec AS ttlSec,
                provisional,
                read,
                idempotency_signature AS idempotencySignature
              FROM mailbox_envelopes
              WHERE conversation_id = ?
                AND CAST(seq AS INTEGER) > CAST(? AS INTEGER)${readFilter}
              ORDER BY CAST(seq AS INTEGER) ASC, envelope_id ASC
              LIMIT ?`,
            )
            .all(params.conversationId, params.afterSeq.toString(), params.limit) as MailboxEnvelopeRow[];
        }

        return this.db
          .prepare(
            `SELECT
              envelope_id AS envelopeId,
              conversation_id AS conversationId,
              conversation_type AS conversationType,
              target_domain AS targetDomain,
          target_did AS targetDid,
              mailbox_key_id AS mailboxKeyId,
              sealed_header AS sealedHeader,
              seq,
              epoch,
              ciphertext,
              content_type AS contentType,
              attachment_manifest_hash AS attachmentManifestHash,
              sent_at_ms AS sentAtMs,
              ttl_sec AS ttlSec,
              provisional,
              read,
              idempotency_signature AS idempotencySignature
            FROM mailbox_envelopes
            WHERE conversation_id = ?${readFilter}
            ORDER BY CAST(seq AS INTEGER) ASC, envelope_id ASC
            LIMIT ?`,
          )
          .all(params.conversationId, params.limit) as MailboxEnvelopeRow[];
      })()
      : (() => {
        if (params.afterKey) {
          const key = params.afterKey;
          return this.db
            .prepare(
              `SELECT
                envelope_id AS envelopeId,
                conversation_id AS conversationId,
                conversation_type AS conversationType,
                target_domain AS targetDomain,
          target_did AS targetDid,
                mailbox_key_id AS mailboxKeyId,
                sealed_header AS sealedHeader,
                seq,
                epoch,
                ciphertext,
                content_type AS contentType,
                attachment_manifest_hash AS attachmentManifestHash,
                sent_at_ms AS sentAtMs,
                ttl_sec AS ttlSec,
                provisional,
                read,
                idempotency_signature AS idempotencySignature
              FROM mailbox_envelopes
              WHERE (
                sent_at_ms > ?
                OR (
                  sent_at_ms = ?
                  AND conversation_id > ?
                )
                OR (
                  sent_at_ms = ?
                  AND conversation_id = ?
                  AND CAST(seq AS INTEGER) > CAST(? AS INTEGER)
                )
                OR (
                  sent_at_ms = ?
                  AND conversation_id = ?
                  AND CAST(seq AS INTEGER) = CAST(? AS INTEGER)
                  AND envelope_id > ?
                )
              )${readFilter}
              ORDER BY sent_at_ms ASC, conversation_id ASC, CAST(seq AS INTEGER) ASC, envelope_id ASC
              LIMIT ?`,
            )
            .all(
              key.sentAtMs,
              key.sentAtMs,
              key.conversationId,
              key.sentAtMs,
              key.conversationId,
              key.seq.toString(),
              key.sentAtMs,
              key.conversationId,
              key.seq.toString(),
              key.envelopeId,
              params.limit,
            ) as MailboxEnvelopeRow[];
        }

        return this.db
          .prepare(
            `SELECT
              envelope_id AS envelopeId,
              conversation_id AS conversationId,
              conversation_type AS conversationType,
              target_domain AS targetDomain,
          target_did AS targetDid,
              mailbox_key_id AS mailboxKeyId,
              sealed_header AS sealedHeader,
              seq,
              epoch,
              ciphertext,
              content_type AS contentType,
              attachment_manifest_hash AS attachmentManifestHash,
              sent_at_ms AS sentAtMs,
              ttl_sec AS ttlSec,
              provisional,
              read,
              idempotency_signature AS idempotencySignature
            FROM mailbox_envelopes${readWhere}
            ORDER BY sent_at_ms ASC, conversation_id ASC, CAST(seq AS INTEGER) ASC, envelope_id ASC
            LIMIT ?`,
          )
          .all(params.limit) as MailboxEnvelopeRow[];
      })();

    return rows.map((row) => this.toEnvelope(row));
  }

  async ensureDirectConversationParticipant(params: {
    conversationId: string;
    didHash: string;
    observedAtMs: number;
    maxParticipants?: number;
  }): Promise<DirectConversationParticipantCheckResult> {
    const maxParticipants = Math.max(2, params.maxParticipants ?? 2);
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT
            participant_a_hash AS participantAHash,
            participant_b_hash AS participantBHash
           FROM mailbox_direct_conversations
           WHERE conversation_id = ?`,
        )
        .get(params.conversationId) as DirectConversationRow | undefined;

      if (!row) {
        this.db
          .prepare(
            `INSERT INTO mailbox_direct_conversations (
              conversation_id, participant_a_hash, participant_b_hash, created_at_ms, updated_at_ms
            ) VALUES (?, ?, NULL, ?, ?)`,
          )
          .run(params.conversationId, params.didHash, params.observedAtMs, params.observedAtMs);
        return {
          allowed: true,
          participants: [params.didHash],
        };
      }

      const participants = [row.participantAHash, row.participantBHash]
        .filter((item): item is string => typeof item === 'string' && item.length > 0);

      if (participants.includes(params.didHash)) {
        this.db
          .prepare(
            `UPDATE mailbox_direct_conversations
             SET updated_at_ms = ?
             WHERE conversation_id = ?`,
          )
          .run(params.observedAtMs, params.conversationId);
        return {
          allowed: true,
          participants,
        };
      }

      if (participants.length >= maxParticipants || row.participantBHash) {
        return {
          allowed: false,
          participants,
        };
      }

      this.db
        .prepare(
          `UPDATE mailbox_direct_conversations
           SET participant_b_hash = ?, updated_at_ms = ?
           WHERE conversation_id = ?`,
        )
        .run(params.didHash, params.observedAtMs, params.conversationId);
      return {
        allowed: true,
        participants: [...participants, params.didHash],
      };
    })();
  }

  async listProvisionalGroupRecords(): Promise<StoredEnvelopeRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT
          envelope_id AS envelopeId,
          conversation_id AS conversationId,
          conversation_type AS conversationType,
          target_domain AS targetDomain,
          target_did AS targetDid,
          mailbox_key_id AS mailboxKeyId,
          sealed_header AS sealedHeader,
          seq,
          epoch,
          ciphertext,
          content_type AS contentType,
          attachment_manifest_hash AS attachmentManifestHash,
          sent_at_ms AS sentAtMs,
          ttl_sec AS ttlSec,
          provisional,
          read,
          idempotency_signature AS idempotencySignature
        FROM mailbox_envelopes
        WHERE conversation_type = 'group' AND provisional = 1
        ORDER BY sent_at_ms ASC`,
      )
      .all() as MailboxEnvelopeRow[];

    return rows.map((row) => ({
      envelope: this.toEnvelope(row),
      idempotencySignature: row.idempotencySignature,
    }));
  }

  async retractEnvelope(params: {
    envelope: Envelope;
    idempotencySignature: string;
    retractedAtMs: number;
    reason: 'REORGED_BACK';
  }): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM mailbox_envelopes WHERE envelope_id = ?')
        .run(params.envelope.envelopeId);

      this.db
        .prepare(
          `INSERT INTO mailbox_retractions (
            envelope_id, conversation_id, reason, retracted_at_ms, idempotency_signature
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(envelope_id) DO UPDATE SET
            conversation_id = excluded.conversation_id,
            reason = excluded.reason,
            retracted_at_ms = excluded.retracted_at_ms,
            idempotency_signature = excluded.idempotency_signature`,
        )
        .run(
          params.envelope.envelopeId,
          params.envelope.conversationId,
          params.reason,
          params.retractedAtMs,
          params.idempotencySignature,
        );
    })();
  }

  async listRetractions(limit: number): Promise<ProvisionalRetractionRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT
          envelope_id AS envelopeId,
          conversation_id AS conversationId,
          reason,
          retracted_at_ms AS retractedAtMs
        FROM mailbox_retractions
        ORDER BY retracted_at_ms DESC
        LIMIT ?`,
      )
      .all(Math.max(1, limit)) as RetractionRow[];

    return rows.map((row) => ({
      envelopeId: row.envelopeId,
      conversationId: row.conversationId,
      reason: row.reason,
      retractedAtMs: row.retractedAtMs,
    }));
  }

  async deleteExpired(nowMs: number): Promise<{ removed: number; remaining: number }> {
    const removed = this.db
      .prepare('DELETE FROM mailbox_envelopes WHERE expires_at_ms <= ?')
      .run(nowMs).changes;
    const remaining = (this.db
      .prepare('SELECT COUNT(1) AS count FROM mailbox_envelopes')
      .get() as { count: number }).count;

    return {
      removed,
      remaining,
    };
  }

  async setConversationPrivacy(params: {
    conversationId: string;
    isPrivate: boolean;
    updatedAtMs: number;
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO mailbox_conversations (
          conversation_id,
          private,
          updated_at_ms
        ) VALUES (?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          private = excluded.private,
          updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        params.conversationId,
        params.isPrivate ? 1 : 0,
        params.updatedAtMs,
      );
  }

  async listPrivateConversationIds(limit = 5_000): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT conversation_id AS conversationId
         FROM mailbox_conversations
         WHERE private = 1
         ORDER BY updated_at_ms DESC
         LIMIT ?`,
      )
      .all(Math.max(1, limit)) as Array<{ conversationId: string }>;
    return rows.map((row) => row.conversationId);
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
    this.db
      .prepare(
        `INSERT INTO mailbox_conversations (
          conversation_id, conversation_type, peer_did, group_id, display_name,
          last_message_preview, last_message_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          last_message_preview = excluded.last_message_preview,
          last_message_at_ms = excluded.last_message_at_ms,
          updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        params.conversationId,
        params.conversationType,
        params.peerDid ?? null,
        params.groupId ?? null,
        params.displayName,
        params.lastMessagePreview ?? null,
        params.lastMessageAtMs,
        params.updatedAtMs,
      );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM mailbox_conversations WHERE conversation_id = ?')
      .run(conversationId);
    this.db
      .prepare('DELETE FROM mailbox_envelopes WHERE conversation_id = ?')
      .run(conversationId);
    this.db
      .prepare('DELETE FROM mailbox_sequences WHERE conversation_id = ?')
      .run(conversationId);
    this.db
      .prepare('DELETE FROM mailbox_direct_conversations WHERE conversation_id = ?')
      .run(conversationId);
  }

  async listConversationSummaries(params: {
    limit: number;
    afterMs?: number;
  }): Promise<ConversationSummary[]> {
    const rows = params.afterMs
      ? this.db
        .prepare(
          `SELECT
            conversation_id, conversation_type, peer_did, group_id,
            display_name, last_message_preview, last_message_at_ms,
            unread_count, private, avatar_url
          FROM mailbox_conversations
          WHERE last_message_at_ms < ?
          ORDER BY last_message_at_ms DESC
          LIMIT ?`,
        )
        .all(params.afterMs, params.limit) as ConversationRow[]
      : this.db
        .prepare(
          `SELECT
            conversation_id, conversation_type, peer_did, group_id,
            display_name, last_message_preview, last_message_at_ms,
            unread_count, private, avatar_url
          FROM mailbox_conversations
          ORDER BY last_message_at_ms DESC
          LIMIT ?`,
        )
        .all(params.limit) as ConversationRow[];

    return rows.map(toConversationSummaryFromRow);
  }

  async markAsRead(envelopeIds: string[]): Promise<number> {
    if (envelopeIds.length === 0) return 0;
    const placeholders = envelopeIds.map(() => '?').join(', ');
    const result = this.db
      .prepare(`UPDATE mailbox_envelopes SET read = 1 WHERE envelope_id IN (${placeholders}) AND read = 0`)
      .run(...envelopeIds);
    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private toEnvelope(row: MailboxEnvelopeRow): Envelope {
    return {
      envelopeId: row.envelopeId,
      conversationId: row.conversationId,
      conversationType: row.conversationType,
      routeHint: {
        targetDomain: row.targetDomain ?? undefined,
        targetDid: row.targetDid,
        mailboxKeyId: row.mailboxKeyId,
      },
      sealedHeader: row.sealedHeader,
      seq: BigInt(row.seq),
      epoch: row.epoch ?? undefined,
      ciphertext: row.ciphertext,
      contentType: row.contentType,
      attachmentManifestHash: row.attachmentManifestHash ?? undefined,
      sentAtMs: row.sentAtMs,
      ttlSec: row.ttlSec,
      provisional: row.provisional === 1,
      read: row.read === 1,
    };
  }
}
