import {
  bytesToUtf8,
  EventEnvelope,
  EventStore,
  utf8ToBytes,
} from '@claw-network/core';
import { KVStore } from '@claw-network/core/storage';
import {
  MarketListing,
  ListingStats,
  OrderStatus,
  TokenAmount,
} from './types.js';
import {
  MarketSearchIndex,
  SearchQuery,
  SearchResult,
} from './search.js';
import {
  MarketListingPublishPayload,
  MarketListingUpdatePayload,
  MarketOrderCreatePayload,
  MarketOrderUpdatePayload,
  parseMarketListingPublishPayload,
  parseMarketListingUpdatePayload,
  parseMarketOrderCreatePayload,
  parseMarketOrderUpdatePayload,
} from './events.js';

const PREFIX_LISTING = 'ix:market:listing:';
const PREFIX_ORDER = 'ix:market:order:';
const PREFIX_META = 'ix:market:meta:';
const KEY_LAST_EVENT = `${PREFIX_META}last_event`;
const KEY_VERSION = `${PREFIX_META}version`;
const STORE_VERSION = 2;

interface StoredListingRecord {
  listing: MarketListing;
  lastEvent: string;
}

interface StoredOrderRecord {
  orderId: string;
  listingId: string;
  status: OrderStatus;
  total: TokenAmount;
  lastEvent: string;
  buyerRating?: number;
  completedCounted?: boolean;
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

function buildListingStats(): ListingStats {
  return {
    views: 0,
    favorites: 0,
    inquiries: 0,
    orders: 0,
    completedOrders: 0,
    totalRevenue: '0',
    averageRating: 0,
    ratingCount: 0,
  };
}

export class MarketSearchStore {
  private index = new MarketSearchIndex();
  private listings = new Map<string, StoredListingRecord>();
  private orders = new Map<string, StoredOrderRecord>();
  private lastEvent: string | null = null;
  private loaded = false;

  constructor(private readonly store: KVStore) {}

  getIndex(): MarketSearchIndex {
    return this.index;
  }

  search(query: SearchQuery): SearchResult {
    return this.index.search(query);
  }

  async loadFromStore(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    const version = decodeJson<number | null>(await this.store.get(KEY_VERSION), null);
    if (version !== null && version !== STORE_VERSION) {
      await this.clearStore();
      this.index = new MarketSearchIndex();
      this.listings.clear();
      this.orders.clear();
      this.lastEvent = null;
    }

    const lastEvent = await this.store.get(KEY_LAST_EVENT);
    this.lastEvent = lastEvent ? bytesToUtf8(lastEvent) : null;

    for await (const { value } of this.store.iterator(PREFIX_LISTING)) {
      const record = decodeJson<StoredListingRecord | null>(value, null);
      if (!record || !record.listing || !record.lastEvent) {
        continue;
      }
      this.listings.set(record.listing.id, record);
      this.index.indexListing(record.listing);
    }

    for await (const { value } of this.store.iterator(PREFIX_ORDER)) {
      const record = decodeJson<StoredOrderRecord | null>(value, null);
      if (!record || !record.orderId || !record.listingId || !record.lastEvent) {
        continue;
      }
      this.orders.set(record.orderId, record);
    }

    await this.store.put(KEY_VERSION, encodeJson(STORE_VERSION));
  }

  async rebuildFromEventLog(eventStore: EventStore): Promise<number> {
    await this.clearStore();
    this.index = new MarketSearchIndex();
    this.listings.clear();
    this.orders.clear();
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
        applied = await this.applyListingPublish(payload, hash, ts, persist);
        break;
      }
      case 'market.listing.update': {
        const payload = parseMarketListingUpdatePayload(
          (envelope.payload ?? {}) as Record<string, unknown>,
        );
        applied = await this.applyListingUpdate(payload, hash, ts, persist);
        break;
      }
      case 'market.listing.remove': {
        const payload = this.parseListingRemovePayload(envelope.payload);
        applied = await this.applyListingRemove(payload, hash, persist);
        break;
      }
      case 'market.order.create': {
        const payload = parseMarketOrderCreatePayload(
          (envelope.payload ?? {}) as Record<string, unknown>,
        );
        applied = await this.applyOrderCreate(payload, hash, persist);
        break;
      }
      case 'market.order.update': {
        const payload = parseMarketOrderUpdatePayload(
          (envelope.payload ?? {}) as Record<string, unknown>,
        );
        applied = await this.applyOrderUpdate(payload, hash, persist);
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

  async getListing(listingId: string): Promise<MarketListing | null> {
    if (!this.loaded) {
      await this.loadFromStore();
    }
    return this.listings.get(listingId)?.listing ?? null;
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

  private async applyListingPublish(
    payload: MarketListingPublishPayload,
    hash: string,
    ts: number,
    persist: boolean,
  ): Promise<boolean> {
    const existing = this.listings.get(payload.listingId);
    if (existing) {
      if (existing.lastEvent === hash) {
        return false;
      }
      throw new Error('listing already exists');
    }

    const listing: MarketListing = {
      id: payload.listingId,
      marketType: payload.marketType,
      seller: {
        did: payload.seller.did,
        name: payload.seller.name,
        reputation: 0,
        verified: false,
      },
      title: payload.title,
      description: payload.description,
      category: payload.category,
      tags: payload.tags,
      pricing: payload.pricing,
      status: payload.status ?? 'active',
      visibility: payload.visibility,
      restrictions: payload.restrictions,
      stats: buildListingStats(),
      createdAt: ts,
      updatedAt: ts,
      expiresAt: payload.expiresAt,
      metadata: payload.metadata ?? {},
      marketData: payload.marketData,
    };

    await this.upsertListing(payload.listingId, listing, hash, persist);

    return true;
  }

  private async applyListingUpdate(
    payload: MarketListingUpdatePayload,
    hash: string,
    ts: number,
    persist: boolean,
  ): Promise<boolean> {
    const record = this.listings.get(payload.listingId);
    if (!record) {
      throw new Error('listing not found');
    }
    if (record.lastEvent === hash) {
      return false;
    }
    if (record.lastEvent !== payload.resourcePrev) {
      throw new Error('listing resourcePrev does not match');
    }

    const listing = {
      ...record.listing,
      status: payload.status,
      metadata: payload.metadata
        ? { ...record.listing.metadata, ...payload.metadata }
        : record.listing.metadata,
      updatedAt: ts,
    };

    await this.upsertListing(payload.listingId, listing, hash, persist);

    return true;
  }

  private async applyListingRemove(
    payload: { listingId: string; resourcePrev: string },
    hash: string,
    persist: boolean,
  ): Promise<boolean> {
    const record = this.listings.get(payload.listingId);
    if (!record) {
      return false;
    }
    if (record.lastEvent === hash) {
      return false;
    }
    if (record.lastEvent !== payload.resourcePrev) {
      throw new Error('listing resourcePrev does not match');
    }
    this.listings.delete(payload.listingId);
    this.index.removeListing(payload.listingId);
    await this.removeOrdersForListing(payload.listingId, persist);

    if (persist) {
      await this.store.del(`${PREFIX_LISTING}${payload.listingId}`);
    }

    return true;
  }

  private async applyOrderCreate(
    payload: MarketOrderCreatePayload,
    hash: string,
    persist: boolean,
  ): Promise<boolean> {
    const existing = this.orders.get(payload.orderId);
    if (existing) {
      if (existing.lastEvent === hash) {
        return false;
      }
      throw new Error('order already exists');
    }
    const listingRecord = this.listings.get(payload.listingId);
    if (!listingRecord) {
      throw new Error('listing not found');
    }

    const record: StoredOrderRecord = {
      orderId: payload.orderId,
      listingId: payload.listingId,
      status: payload.status ?? 'pending',
      total: payload.pricing.total,
      lastEvent: hash,
    };

    const listing = { ...listingRecord.listing };
    listing.stats = { ...listing.stats };
    listing.stats.orders += 1;
    this.applyCompletionDelta(listing.stats, record, record.status, record.total);

    this.orders.set(payload.orderId, record);
    await this.upsertListing(payload.listingId, listing, listingRecord.lastEvent, persist);
    if (persist) {
      await this.persistOrder(payload.orderId);
    }

    return true;
  }

  private async applyOrderUpdate(
    payload: MarketOrderUpdatePayload,
    hash: string,
    persist: boolean,
  ): Promise<boolean> {
    const record = this.orders.get(payload.orderId);
    if (!record) {
      throw new Error('order not found');
    }
    if (record.lastEvent === hash) {
      return false;
    }
    if (record.lastEvent !== payload.resourcePrev) {
      throw new Error('order resourcePrev does not match');
    }

    const listingRecord = this.listings.get(record.listingId);
    if (!listingRecord) {
      throw new Error('listing not found');
    }

    const listing = { ...listingRecord.listing };
    listing.stats = { ...listing.stats };

    const effectiveStatus = this.resolveEffectiveOrderStatus(payload);
    this.applyCompletionDelta(listing.stats, record, effectiveStatus, record.total);
    this.applyBuyerRatingDelta(listing.stats, record, payload);

    record.status = payload.status;
    record.lastEvent = hash;

    this.orders.set(record.orderId, record);
    await this.upsertListing(record.listingId, listing, listingRecord.lastEvent, persist);
    if (persist) {
      await this.persistOrder(record.orderId);
    }

    return true;
  }

  private applyCompletionDelta(
    stats: ListingStats,
    record: StoredOrderRecord,
    nextStatus: OrderStatus,
    total: TokenAmount,
  ): void {
    const wasCompleted = record.completedCounted === true;
    const isCompleted = nextStatus === 'completed';

    if (!wasCompleted && isCompleted) {
      stats.completedOrders += 1;
      stats.totalRevenue = addTokenAmount(stats.totalRevenue, total);
      record.completedCounted = true;
    } else if (wasCompleted && !isCompleted) {
      stats.completedOrders = Math.max(0, stats.completedOrders - 1);
      stats.totalRevenue = subtractTokenAmount(stats.totalRevenue, total);
      record.completedCounted = false;
    }
  }

  private applyBuyerRatingDelta(
    stats: ListingStats,
    record: StoredOrderRecord,
    payload: MarketOrderUpdatePayload,
  ): void {
    const ratingValue =
      payload.review?.byBuyer?.rating ?? payload.review?.bySeller?.rating ?? null;
    if (ratingValue === null || ratingValue === undefined) {
      return;
    }
    const nextRating = typeof ratingValue === 'number' ? ratingValue : Number(ratingValue);
    if (!Number.isFinite(nextRating)) {
      return;
    }

    const prevRating = record.buyerRating;
    if (prevRating === undefined) {
      const count = stats.ratingCount + 1;
      stats.averageRating =
        stats.ratingCount === 0
          ? nextRating
          : (stats.averageRating * stats.ratingCount + nextRating) / count;
      stats.ratingCount = count;
      record.buyerRating = nextRating;
      return;
    }

    if (prevRating !== nextRating && stats.ratingCount > 0) {
      stats.averageRating =
        (stats.averageRating * stats.ratingCount - prevRating + nextRating) / stats.ratingCount;
      record.buyerRating = nextRating;
    }
  }

  private resolveEffectiveOrderStatus(payload: MarketOrderUpdatePayload): OrderStatus {
    if (payload.payment?.status === 'refunded') {
      return 'refunded';
    }
    if (payload.payment?.status === 'disputed') {
      return 'disputed';
    }
    return payload.status;
  }

  private async upsertListing(
    listingId: string,
    listing: MarketListing,
    lastEvent: string,
    persist: boolean,
  ): Promise<void> {
    this.listings.set(listingId, { listing, lastEvent });
    this.index.removeListing(listingId);
    this.index.indexListing(listing);
    if (persist) {
      await this.persistListing(listingId);
    }
  }

  private async persistOrder(orderId: string): Promise<void> {
    const record = this.orders.get(orderId);
    if (!record) {
      return;
    }
    await this.store.put(`${PREFIX_ORDER}${orderId}`, encodeJson(record));
  }

  private async removeOrdersForListing(listingId: string, persist: boolean): Promise<void> {
    for (const [orderId, record] of this.orders.entries()) {
      if (record.listingId === listingId) {
        this.orders.delete(orderId);
        if (persist) {
          await this.store.del(`${PREFIX_ORDER}${orderId}`);
        }
      }
    }
  }

  private async persistListing(listingId: string): Promise<void> {
    const record = this.listings.get(listingId);
    if (!record) {
      return;
    }
    await this.store.put(`${PREFIX_LISTING}${listingId}`, encodeJson(record));
  }

  private async persistLastEvent(): Promise<void> {
    if (!this.lastEvent) {
      await this.store.del(KEY_LAST_EVENT);
      return;
    }
    await this.store.put(KEY_LAST_EVENT, utf8ToBytes(this.lastEvent));
  }

  private async clearStore(): Promise<void> {
    for await (const { key } of this.store.iterator(PREFIX_LISTING)) {
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

function addTokenAmount(current: TokenAmount, delta: TokenAmount): TokenAmount {
  const base = BigInt(current);
  const change = BigInt(delta);
  return (base + change).toString();
}

function subtractTokenAmount(current: TokenAmount, delta: TokenAmount): TokenAmount {
  const base = BigInt(current);
  const change = BigInt(delta);
  const next = base - change;
  return (next < 0n ? 0n : next).toString();
}
