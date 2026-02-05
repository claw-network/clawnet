import { canonicalizeBytes } from '../crypto/jcs.js';
import { eventHashHex } from '../protocol/event-hash.js';
import { bytesToUtf8, utf8ToBytes } from '../utils/bytes.js';
import { KVStore } from './kv.js';

const PREFIX_EVENT = 'ev:';
const PREFIX_ISSUER_INDEX = 'ix:did:';
const PREFIX_ADDRESS_INDEX = 'ix:addr:';
const PREFIX_NONCE = 'ix:nonce:';
const KEY_SCHEMA_VERSION = 'meta:version';
const PREFIX_LOG_SEQ = 'log:seq:';
const PREFIX_LOG_HASH = 'log:hash:';
const KEY_LOG_SEQ = 'meta:logseq';
const PREFIX_EVENT_HEADER = 'evh:';

function encodeJson(value: unknown): Uint8Array {
  return utf8ToBytes(JSON.stringify(value));
}

function decodeJson<T>(value: Uint8Array | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  return JSON.parse(bytesToUtf8(value)) as T;
}

function encodeSeq(seq: number): string {
  return seq.toString(16).padStart(16, '0');
}

function decodeSeq(value: string): number {
  return Number.parseInt(value, 16);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function parseEventEnvelope(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractHash(envelope: Record<string, unknown>): string | null {
  const hash = envelope.hash;
  return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

function validateEventBytes(hash: string, eventBytes: Uint8Array): {
  envelope: Record<string, unknown>;
  canonical: Uint8Array;
} {
  const envelope = parseEventEnvelope(eventBytes);
  if (!envelope) {
    throw new Error('Invalid event bytes (not JSON)');
  }
  const envelopeHash = extractHash(envelope);
  if (!envelopeHash) {
    throw new Error('Event envelope missing hash');
  }
  const computed = eventHashHex(envelope);
  if (computed !== envelopeHash || envelopeHash !== hash) {
    throw new Error('Event hash mismatch');
  }
  const canonical = canonicalizeBytes(envelope);
  if (!bytesEqual(canonical, eventBytes)) {
    throw new Error('Event bytes are not canonical JCS');
  }
  return { envelope, canonical };
}

export class EventStore {
  constructor(private readonly store: KVStore) {}

  async putEvent(hash: string, eventBytes: Uint8Array): Promise<void> {
    validateEventBytes(hash, eventBytes);
    const key = `${PREFIX_EVENT}${hash}`;
    const existing = await this.store.get(key);
    if (existing) {
      if (!bytesEqual(existing, eventBytes)) {
        throw new Error('Event immutability violation');
      }
      return;
    }
    await this.store.put(key, eventBytes);
  }

  async appendEvent(hash: string, eventBytes: Uint8Array): Promise<boolean> {
    validateEventBytes(hash, eventBytes);
    const existingSeq = await this.store.get(`${PREFIX_LOG_HASH}${hash}`);
    if (existingSeq) {
      return false;
    }
    const exists = await this.hasEvent(hash);
    if (!exists) {
      await this.putEvent(hash, eventBytes);
    }
    const seq = await this.nextLogSeq();
    const seqKey = `${PREFIX_LOG_SEQ}${encodeSeq(seq)}`;
    await this.store.put(seqKey, utf8ToBytes(hash));
    await this.store.put(`${PREFIX_LOG_HASH}${hash}`, utf8ToBytes(encodeSeq(seq)));
    await this.store.put(KEY_LOG_SEQ, encodeJson(seq + 1));
    return true;
  }

  async getEventHeader(hash: string): Promise<Record<string, unknown> | null> {
    const data = await this.store.get(`${PREFIX_EVENT_HEADER}${hash}`);
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(bytesToUtf8(data)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async saveEventHeader(hash: string, header: Record<string, unknown>): Promise<void> {
    await this.store.put(`${PREFIX_EVENT_HEADER}${hash}`, encodeJson(header));
  }

  async getEvent(hash: string): Promise<Uint8Array | undefined> {
    return this.store.get(`${PREFIX_EVENT}${hash}`);
  }

  async hasEvent(hash: string): Promise<boolean> {
    return (await this.getEvent(hash)) !== undefined;
  }

  async appendIssuerIndex(issuer: string, hash: string): Promise<void> {
    const key = `${PREFIX_ISSUER_INDEX}${issuer}`;
    const existing = decodeJson<string[]>(await this.store.get(key), []);
    existing.push(hash);
    await this.store.put(key, encodeJson(existing));
  }

  async appendAddressIndex(address: string, hash: string): Promise<void> {
    const key = `${PREFIX_ADDRESS_INDEX}${address}`;
    const existing = decodeJson<string[]>(await this.store.get(key), []);
    existing.push(hash);
    await this.store.put(key, encodeJson(existing));
  }

  async getIssuerEvents(issuer: string): Promise<string[]> {
    return decodeJson(await this.store.get(`${PREFIX_ISSUER_INDEX}${issuer}`), []);
  }

  async getAddressEvents(address: string): Promise<string[]> {
    return decodeJson(await this.store.get(`${PREFIX_ADDRESS_INDEX}${address}`), []);
  }

  async getCommittedNonce(issuer: string): Promise<number> {
    return decodeJson(await this.store.get(`${PREFIX_NONCE}${issuer}`), 0);
  }

  async setCommittedNonce(issuer: string, nonce: number): Promise<void> {
    await this.store.put(`${PREFIX_NONCE}${issuer}`, encodeJson(nonce));
  }

  async getEventLogRange(
    from: string | null,
    limit: number,
    maxBytes?: number,
  ): Promise<{ events: Uint8Array[]; cursor: string }> {
    if (limit <= 0) {
      return { events: [], cursor: '' };
    }

    let startSeq = 0;
    if (from) {
      const seqBytes = await this.store.get(`${PREFIX_LOG_HASH}${from}`);
      if (seqBytes) {
        const seq = decodeSeq(bytesToUtf8(seqBytes));
        startSeq = seq + 1;
      }
    }

    const events: Uint8Array[] = [];
    let cursor = '';
    let totalBytes = 0;

    for await (const { key, value } of this.store.iterator(PREFIX_LOG_SEQ)) {
      const seqHex = key.slice(PREFIX_LOG_SEQ.length);
      const seq = decodeSeq(seqHex);
      if (seq < startSeq) {
        continue;
      }
      const hash = bytesToUtf8(value);
      const eventBytes = await this.getEvent(hash);
      if (!eventBytes) {
        continue;
      }
      if (maxBytes !== undefined && totalBytes + eventBytes.length > maxBytes) {
        break;
      }
      events.push(eventBytes);
      totalBytes += eventBytes.length;
      cursor = hash;
      if (events.length >= limit) {
        break;
      }
    }

    return { events, cursor };
  }

  async getLatestEventHash(): Promise<string | null> {
    const nextSeq = await this.nextLogSeq();
    if (nextSeq <= 0) {
      return null;
    }
    const key = `${PREFIX_LOG_SEQ}${encodeSeq(nextSeq - 1)}`;
    const value = await this.store.get(key);
    return value ? bytesToUtf8(value) : null;
  }

  async getLogLength(): Promise<number> {
    return this.nextLogSeq();
  }

  async getEventSeq(hash: string): Promise<number | null> {
    const seqBytes = await this.store.get(`${PREFIX_LOG_HASH}${hash}`);
    if (!seqBytes) {
      return null;
    }
    return decodeSeq(bytesToUtf8(seqBytes));
  }

  async verifyEventLog(): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    for await (const { key, value } of this.store.iterator(PREFIX_LOG_SEQ)) {
      const hash = bytesToUtf8(value);
      const eventBytes = await this.getEvent(hash);
      if (!eventBytes) {
        const header = await this.getEventHeader(hash);
        if (!header) {
          errors.push(`missing event bytes/header for ${hash}`);
        }
        continue;
      }
      try {
        validateEventBytes(hash, eventBytes);
      } catch (error) {
        errors.push(`${hash}: ${(error as Error).message}`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async rebuildIndexes(options: {
    rebuildIssuer?: boolean;
    rebuildNonce?: boolean;
    clearExisting?: boolean;
    indexer?: (envelope: Record<string, unknown>) => {
      issuer?: string;
      nonce?: number;
      addresses?: string[];
    };
  } = {}): Promise<void> {
    const { rebuildIssuer = true, rebuildNonce = true, clearExisting = true, indexer } = options;
    if (clearExisting) {
      if (rebuildIssuer) {
        for await (const entry of this.store.iterator(PREFIX_ISSUER_INDEX)) {
          await this.store.del(entry.key);
        }
      }
      if (rebuildNonce) {
        for await (const entry of this.store.iterator(PREFIX_NONCE)) {
          await this.store.del(entry.key);
        }
      }
      if (indexer) {
        for await (const entry of this.store.iterator(PREFIX_ADDRESS_INDEX)) {
          await this.store.del(entry.key);
        }
      }
    }

    for await (const { value } of this.store.iterator(PREFIX_LOG_SEQ)) {
      const hash = bytesToUtf8(value);
      const eventBytes = await this.getEvent(hash);
      if (!eventBytes) {
        continue;
      }
      const envelope = parseEventEnvelope(eventBytes);
      if (!envelope) {
        continue;
      }
      const issuer = (envelope.issuer as string) ?? '';
      const nonce = (envelope.nonce as number) ?? null;

      if (rebuildIssuer && issuer) {
        await this.appendIssuerIndex(issuer, hash);
      }
      if (rebuildNonce && issuer && typeof nonce === 'number') {
        await this.setCommittedNonce(issuer, nonce);
      }
      if (indexer) {
        const derived = indexer(envelope) ?? {};
        const addresses = derived.addresses ?? [];
        for (const address of addresses) {
          if (address) {
            await this.appendAddressIndex(address, hash);
          }
        }
      }
    }
  }

  async pruneEvents(options: {
    minAgeMs?: number;
    minEvents?: number;
    snapshotAt?: string | null;
    now?: number;
    shouldKeep?: (envelope: Record<string, unknown>) => boolean;
  } = {}): Promise<number> {
    const minAgeMs = options.minAgeMs ?? 30 * 24 * 60 * 60 * 1000;
    const minEvents = options.minEvents ?? 100_000;
    const now = options.now ?? Date.now();

    const logLength = await this.getLogLength();
    const keepFromSeq = Math.max(0, logLength - minEvents);
    const snapshotSeq = options.snapshotAt ? await this.getEventSeq(options.snapshotAt) : null;
    const protectedSeq = snapshotSeq !== null ? snapshotSeq + 1 : 0;
    const minSeqToKeep = Math.max(keepFromSeq, protectedSeq);

    let pruned = 0;
    for await (const { key, value } of this.store.iterator(PREFIX_LOG_SEQ)) {
      const seqHex = key.slice(PREFIX_LOG_SEQ.length);
      const seq = decodeSeq(seqHex);
      if (seq >= minSeqToKeep) {
        continue;
      }
      const hash = bytesToUtf8(value);
      const eventBytes = await this.getEvent(hash);
      if (!eventBytes) {
        continue;
      }
      const envelope = parseEventEnvelope(eventBytes);
      if (!envelope) {
        continue;
      }
      const ts = typeof envelope.ts === 'number' ? envelope.ts : 0;
      if (ts && now - ts < minAgeMs) {
        continue;
      }
      if (options.shouldKeep && options.shouldKeep(envelope)) {
        continue;
      }
      const header = {
        hash,
        ts,
        issuer: envelope.issuer ?? null,
        type: envelope.type ?? null,
      };
      await this.saveEventHeader(hash, header);
      await this.store.del(`${PREFIX_EVENT}${hash}`);
      pruned += 1;
    }
    return pruned;
  }

  async getSchemaVersion(): Promise<number | null> {
    return decodeJson(await this.store.get(KEY_SCHEMA_VERSION), null);
  }

  async setSchemaVersion(version: number): Promise<void> {
    await this.store.put(KEY_SCHEMA_VERSION, encodeJson(version));
  }

  private async nextLogSeq(): Promise<number> {
    return decodeJson(await this.store.get(KEY_LOG_SEQ), 0);
  }
}
