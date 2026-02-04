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

export class EventStore {
  constructor(private readonly store: KVStore) {}

  async putEvent(hash: string, eventBytes: Uint8Array): Promise<void> {
    await this.store.put(`${PREFIX_EVENT}${hash}`, eventBytes);
  }

  async appendEvent(hash: string, eventBytes: Uint8Array): Promise<boolean> {
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
