import { bytesToUtf8, utf8ToBytes } from '../utils/bytes.js';
import { KVStore } from './kv.js';

const PREFIX_EVENT = 'ev:';
const PREFIX_ISSUER_INDEX = 'ix:did:';
const PREFIX_ADDRESS_INDEX = 'ix:addr:';
const PREFIX_NONCE = 'ix:nonce:';
const KEY_SCHEMA_VERSION = 'meta:version';

function encodeJson(value: unknown): Uint8Array {
  return utf8ToBytes(JSON.stringify(value));
}

function decodeJson<T>(value: Uint8Array | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  return JSON.parse(bytesToUtf8(value)) as T;
}

export class EventStore {
  constructor(private readonly store: KVStore) {}

  async putEvent(hash: string, eventBytes: Uint8Array): Promise<void> {
    await this.store.put(`${PREFIX_EVENT}${hash}`, eventBytes);
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

  async getSchemaVersion(): Promise<number | null> {
    return decodeJson(await this.store.get(KEY_SCHEMA_VERSION), null);
  }

  async setSchemaVersion(version: number): Promise<void> {
    await this.store.put(KEY_SCHEMA_VERSION, encodeJson(version));
  }
}
