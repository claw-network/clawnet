import { randomBytes } from 'node:crypto';
import {
  blake3Hex,
  bytesToHex,
  bytesToUtf8,
  decryptAes256Gcm,
  EventEnvelope,
  EventStore,
  hexToBytes,
  hkdfSha256,
  KVStore,
  utf8ToBytes,
  x25519SharedSecret,
  generateX25519Keypair,
  encryptAes256Gcm,
} from '@clawnet/core';
import {
  parseMarketListingPublishPayload,
  parseMarketOrderUpdatePayload,
} from './events.js';
import { parseInfoMarketData } from './info.js';

const PREFIX_CONTENT = 'ix:info:content:';
const PREFIX_LISTING = 'ix:info:listing:';
const PREFIX_DELIVERY = 'ix:info:delivery:';
const PREFIX_ORDER = 'ix:info:order:';
const PREFIX_META = 'ix:info:meta:';
const KEY_LAST_EVENT = `${PREFIX_META}last_event`;
const KEY_VERSION = `${PREFIX_META}version`;
const STORE_VERSION = 1;
const INFO_KEY_INFO = utf8ToBytes('clawnet:info:content-key');

export interface EncryptedInfoContent {
  hash: string;
  listingId?: string;
  size: number;
  nonceHex: string;
  ciphertextHex: string;
  tagHex: string;
  createdAt: number;
}

export interface InfoListingContentLink {
  listingId: string;
  contentHash: string;
  updatedAt: number;
}

export interface InfoKeyEnvelope {
  algorithm: 'x25519-aes-256-gcm';
  senderPublicKeyHex: string;
  nonceHex: string;
  ciphertextHex: string;
  tagHex: string;
}

export interface InfoDeliveryRecord {
  deliveryId: string;
  orderId: string;
  listingId: string;
  contentHash: string;
  keyEnvelope?: InfoKeyEnvelope;
  accessToken?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface InfoOrderDeliveryLink {
  orderId: string;
  deliveryId: string;
  updatedAt: number;
}

function encodeJson(value: unknown): Uint8Array {
  return utf8ToBytes(JSON.stringify(value));
}

function decodeJson<T>(value: Uint8Array | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  return JSON.parse(bytesToUtf8(value)) as T;
}

export function generateInfoContentKey(): Uint8Array {
  return randomBytes(32);
}

export function encryptInfoContent(
  plaintext: Uint8Array,
  key: Uint8Array,
  createdAt: number = Date.now(),
): EncryptedInfoContent {
  const encrypted = encryptAes256Gcm(key, plaintext);
  const hash = blake3Hex(plaintext).toLowerCase();
  return {
    hash,
    size: plaintext.length,
    nonceHex: encrypted.nonceHex,
    ciphertextHex: encrypted.ciphertextHex,
    tagHex: encrypted.tagHex,
    createdAt,
  };
}

export function decryptInfoContent(
  encrypted: EncryptedInfoContent,
  key: Uint8Array,
): Uint8Array {
  return decryptAes256Gcm(key, {
    nonceHex: encrypted.nonceHex,
    ciphertextHex: encrypted.ciphertextHex,
    tagHex: encrypted.tagHex,
  });
}

export function sealInfoContentKey(
  contentKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): InfoKeyEnvelope {
  const sender = generateX25519Keypair();
  const shared = x25519SharedSecret(sender.privateKey, recipientPublicKey);
  const derived = hkdfSha256(shared, undefined, INFO_KEY_INFO, 32);
  const encrypted = encryptAes256Gcm(derived, contentKey);
  return {
    algorithm: 'x25519-aes-256-gcm',
    senderPublicKeyHex: bytesToHex(sender.publicKey),
    nonceHex: encrypted.nonceHex,
    ciphertextHex: encrypted.ciphertextHex,
    tagHex: encrypted.tagHex,
  };
}

export function openInfoContentKey(
  envelope: InfoKeyEnvelope,
  recipientPrivateKey: Uint8Array,
): Uint8Array {
  if (envelope.algorithm !== 'x25519-aes-256-gcm') {
    throw new Error('unsupported key envelope');
  }
  const senderPublicKey = hexToBytes(envelope.senderPublicKeyHex);
  const shared = x25519SharedSecret(recipientPrivateKey, senderPublicKey);
  const derived = hkdfSha256(shared, undefined, INFO_KEY_INFO, 32);
  return decryptAes256Gcm(derived, {
    nonceHex: envelope.nonceHex,
    ciphertextHex: envelope.ciphertextHex,
    tagHex: envelope.tagHex,
  });
}

export class InfoContentStore {
  private content = new Map<string, EncryptedInfoContent>();
  private listingLinks = new Map<string, InfoListingContentLink>();
  private deliveryRecords = new Map<string, InfoDeliveryRecord>();
  private orderLinks = new Map<string, InfoOrderDeliveryLink>();
  private lastEvent: string | null = null;
  private loaded = false;

  constructor(private readonly store: KVStore) {}

  async loadFromStore(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    const version = decodeJson<number | null>(await this.store.get(KEY_VERSION), null);
    if (version !== null && version !== STORE_VERSION) {
      await this.clearStore();
      this.content.clear();
      this.listingLinks.clear();
      this.deliveryRecords.clear();
      this.orderLinks.clear();
      this.lastEvent = null;
    }

    const lastEvent = await this.store.get(KEY_LAST_EVENT);
    this.lastEvent = lastEvent ? bytesToUtf8(lastEvent) : null;

    for await (const { value } of this.store.iterator(PREFIX_CONTENT)) {
      const record = decodeJson<EncryptedInfoContent | null>(value, null);
      if (!record || !record.hash) {
        continue;
      }
      this.content.set(record.hash, record);
    }

    for await (const { value } of this.store.iterator(PREFIX_LISTING)) {
      const record = decodeJson<InfoListingContentLink | null>(value, null);
      if (!record || !record.listingId || !record.contentHash) {
        continue;
      }
      this.listingLinks.set(record.listingId, record);
    }

    for await (const { value } of this.store.iterator(PREFIX_DELIVERY)) {
      const record = decodeJson<InfoDeliveryRecord | null>(value, null);
      if (!record || !record.deliveryId) {
        continue;
      }
      this.deliveryRecords.set(record.deliveryId, record);
    }

    for await (const { value } of this.store.iterator(PREFIX_ORDER)) {
      const record = decodeJson<InfoOrderDeliveryLink | null>(value, null);
      if (!record || !record.orderId || !record.deliveryId) {
        continue;
      }
      this.orderLinks.set(record.orderId, record);
    }

    await this.store.put(KEY_VERSION, encodeJson(STORE_VERSION));
  }

  async rebuildFromEventLog(eventStore: EventStore): Promise<number> {
    await this.clearStore();
    this.content.clear();
    this.listingLinks.clear();
    this.deliveryRecords.clear();
    this.orderLinks.clear();
    this.lastEvent = null;
    this.loaded = true;
    await this.store.put(KEY_VERSION, encodeJson(STORE_VERSION));
    return this.syncFromEventLog(eventStore, { from: null });
  }

  async syncFromEventLog(
    eventStore: EventStore,
    options: { from?: string | null; batchSize?: number } = {},
  ): Promise<number> {
    if (!this.loaded) {
      await this.loadFromStore();
    }

    let cursor = options.from ?? this.lastEvent ?? null;
    const batchSize = options.batchSize ?? 200;
    let applied = 0;
    let lastSeen: string | null = cursor;

    while (true) {
      const { events, cursor: next } = await eventStore.getEventLogRange(cursor, batchSize);
      if (!events.length) {
        break;
      }
      for (const bytes of events) {
        const envelope = this.parseEvent(bytes);
        if (!envelope) {
          continue;
        }
        const hash = typeof envelope.hash === 'string' && envelope.hash.length ? envelope.hash : null;
        if (hash) {
          lastSeen = hash;
        }
        try {
          const didApply = await this.applyEvent(envelope as EventEnvelope, {
            persist: true,
            updateCursor: false,
          });
          if (didApply) {
            applied += 1;
          }
        } catch {
          continue;
        }
      }
      if (!next) {
        break;
      }
      cursor = next;
      lastSeen = next;
    }

    if (lastSeen !== this.lastEvent) {
      this.lastEvent = lastSeen;
      await this.persistLastEvent();
    }

    return applied;
  }

  async applyEvent(
    envelope: EventEnvelope,
    options: { persist?: boolean; updateCursor?: boolean } = {},
  ): Promise<boolean> {
    const type = typeof envelope.type === 'string' ? envelope.type : '';
    if (!type.startsWith('market.')) {
      return false;
    }
    const hash = typeof envelope.hash === 'string' && envelope.hash.length ? envelope.hash : null;
    if (!hash) {
      throw new Error('market event missing hash');
    }
    const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
    const persist = options.persist !== false;

    let applied = false;
    switch (type) {
      case 'market.listing.publish': {
        const payload = parseMarketListingPublishPayload(
          (envelope.payload ?? {}) as Record<string, unknown>,
        );
        applied = await this.applyListingPublish(payload, ts, persist);
        break;
      }
      case 'market.listing.remove': {
        const payload = this.parseListingRemovePayload(envelope.payload);
        applied = await this.applyListingRemove(payload, persist);
        break;
      }
      case 'market.order.update': {
        const payload = parseMarketOrderUpdatePayload(
          (envelope.payload ?? {}) as Record<string, unknown>,
        );
        applied = await this.applyOrderUpdate(payload, ts, persist);
        break;
      }
      default: {
        return false;
      }
    }

    if (options.updateCursor !== false) {
      this.lastEvent = hash;
      if (persist) {
        await this.persistLastEvent();
      }
    }

    return applied;
  }

  async storeEncryptedContent(
    listingId: string,
    plaintext: Uint8Array,
    key: Uint8Array,
    createdAt: number = Date.now(),
  ): Promise<EncryptedInfoContent> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    const encrypted = encryptInfoContent(plaintext, key, createdAt);
    const record: EncryptedInfoContent = {
      ...encrypted,
      listingId,
    };
    this.content.set(record.hash, record);
    await this.store.put(`${PREFIX_CONTENT}${record.hash}`, encodeJson(record));
    await this.linkListingContent(listingId, record.hash, createdAt, true);
    return record;
  }

  async linkListingContent(
    listingId: string,
    contentHash: string,
    updatedAt: number = Date.now(),
    persist: boolean = true,
  ): Promise<void> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    const record: InfoListingContentLink = { listingId, contentHash, updatedAt };
    this.listingLinks.set(listingId, record);
    if (persist) {
      await this.store.put(`${PREFIX_LISTING}${listingId}`, encodeJson(record));
    }
  }

  async removeListingContent(listingId: string, persist: boolean = true): Promise<void> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    this.listingLinks.delete(listingId);
    if (persist) {
      await this.store.del(`${PREFIX_LISTING}${listingId}`);
    }
  }

  async getListingContentHash(listingId: string): Promise<string | null> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    return this.listingLinks.get(listingId)?.contentHash ?? null;
  }

  async getEncryptedContent(hash: string): Promise<EncryptedInfoContent | null> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    return this.content.get(hash) ?? null;
  }

  async getEncryptedContentForListing(listingId: string): Promise<EncryptedInfoContent | null> {
    const hash = await this.getListingContentHash(listingId);
    if (!hash) {
      return null;
    }
    return this.getEncryptedContent(hash);
  }

  async storeDeliveryRecord(record: InfoDeliveryRecord): Promise<void> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    this.deliveryRecords.set(record.deliveryId, record);
    await this.store.put(`${PREFIX_DELIVERY}${record.deliveryId}`, encodeJson(record));
    await this.linkOrderDelivery(record.orderId, record.deliveryId, record.createdAt, true);
  }

  async getDeliveryRecord(deliveryId: string): Promise<InfoDeliveryRecord | null> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    return this.deliveryRecords.get(deliveryId) ?? null;
  }

  async getDeliveryForOrder(orderId: string): Promise<InfoDeliveryRecord | null> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    const link = this.orderLinks.get(orderId);
    if (!link) {
      return null;
    }
    return this.deliveryRecords.get(link.deliveryId) ?? null;
  }

  private async linkOrderDelivery(
    orderId: string,
    deliveryId: string,
    updatedAt: number,
    persist: boolean,
  ): Promise<void> {
    const record: InfoOrderDeliveryLink = { orderId, deliveryId, updatedAt };
    this.orderLinks.set(orderId, record);
    if (persist) {
      await this.store.put(`${PREFIX_ORDER}${orderId}`, encodeJson(record));
    }
  }

  private async applyListingPublish(
    payload: ReturnType<typeof parseMarketListingPublishPayload>,
    ts: number,
    persist: boolean,
  ): Promise<boolean> {
    if (payload.marketType !== 'info') {
      return false;
    }
    const infoData = parseInfoMarketData(payload.marketData);
    const contentHash = infoData.content?.hash;
    if (!contentHash) {
      return false;
    }
    await this.linkListingContent(payload.listingId, contentHash, ts, persist);
    return true;
  }

  private async applyListingRemove(
    payload: { listingId: string; resourcePrev: string },
    persist: boolean,
  ): Promise<boolean> {
    if (!this.listingLinks.has(payload.listingId)) {
      return false;
    }
    await this.removeListingContent(payload.listingId, persist);
    return true;
  }

  private async applyOrderUpdate(
    payload: ReturnType<typeof parseMarketOrderUpdatePayload>,
    ts: number,
    persist: boolean,
  ): Promise<boolean> {
    const tracking = payload.delivery?.tracking as { deliveryId?: unknown } | undefined;
    const deliveryId = tracking && typeof tracking.deliveryId === 'string' ? tracking.deliveryId : null;
    if (!deliveryId) {
      return false;
    }
    await this.linkOrderDelivery(payload.orderId, deliveryId, ts, persist);
    return true;
  }

  private parseListingRemovePayload(payload: unknown): { listingId: string; resourcePrev: string } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('listing remove payload must be an object');
    }
    const record = payload as Record<string, unknown>;
    const listingId = String(record.listingId ?? '');
    const resourcePrev = String(record.resourcePrev ?? '');
    if (!listingId.trim()) {
      throw new Error('listingId is required');
    }
    if (!resourcePrev.trim()) {
      throw new Error('resourcePrev is required');
    }
    return { listingId, resourcePrev };
  }

  private async persistLastEvent(): Promise<void> {
    if (!this.lastEvent) {
      await this.store.del(KEY_LAST_EVENT);
      return;
    }
    await this.store.put(KEY_LAST_EVENT, utf8ToBytes(this.lastEvent));
  }

  private async clearStore(): Promise<void> {
    for await (const { key } of this.store.iterator(PREFIX_CONTENT)) {
      await this.store.del(key);
    }
    for await (const { key } of this.store.iterator(PREFIX_LISTING)) {
      await this.store.del(key);
    }
    for await (const { key } of this.store.iterator(PREFIX_DELIVERY)) {
      await this.store.del(key);
    }
    for await (const { key } of this.store.iterator(PREFIX_ORDER)) {
      await this.store.del(key);
    }
    await this.store.del(KEY_LAST_EVENT);
    await this.store.del(KEY_VERSION);
  }

  private parseEvent(bytes: Uint8Array): Record<string, unknown> | null {
    try {
      return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
