/**
 * Legacy event-sourced helper functions.
 *
 * These power the fallback path when on-chain services are unavailable.
 * Extracted from the original server.ts monolith.
 */

import type { EventStore, EventEnvelope } from '@claw-network/core';
import {
  didFromPublicKey,
  listKeyRecords,
  multibaseDecode,
  resolveStoragePaths,
} from '@claw-network/core';
import {
  createWalletState,
  applyWalletEvent,
  type WalletState,
  type SearchQuery,
  isMarketType,
  isListingStatus,
  isListingVisibility,
  isTaskType,
  isInfoType,
  isContentFormat,
  isAccessMethodType,
  isCapabilityType,
} from '@claw-network/protocol';
import { parseCsv, parseBoolean } from './types.js';

// ─── Event Parsing ──────────────────────────────────────────────

export function parseEvent(bytes: unknown): EventEnvelope | null {
  try {
    if (bytes instanceof Uint8Array) {
      return JSON.parse(new TextDecoder().decode(bytes)) as EventEnvelope;
    }
    if (typeof bytes === 'string') return JSON.parse(bytes) as EventEnvelope;
    if (bytes && typeof bytes === 'object') return bytes as EventEnvelope;
    return null;
  } catch {
    return null;
  }
}

// ─── Identity Helpers ───────────────────────────────────────────

export interface IdentityView {
  did: string;
  publicKey: string;
  created: number;
  updated: number;
  displayName?: string;
  avatar?: string;
  bio?: string;
  platformLinks: Array<Record<string, unknown>>;
  capabilities: Array<Record<string, unknown>>;
}

export async function resolveLocalIdentity(dataDir?: string): Promise<IdentityView | null> {
  const paths = resolveStoragePaths(dataDir);
  const records = await listKeyRecords(paths);
  if (!records.length) return null;

  const sorted = records
    .map((record) => ({ record, createdAt: Date.parse(record.createdAt ?? '') }))
    .sort((a, b) => {
      const left = Number.isFinite(a.createdAt) ? a.createdAt : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.createdAt) ? b.createdAt : Number.MAX_SAFE_INTEGER;
      return left - right;
    });

  const primary = sorted[0]?.record;
  if (!primary?.publicKey) return null;

  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = multibaseDecode(primary.publicKey);
  } catch {
    return null;
  }

  const did = didFromPublicKey(publicKeyBytes);
  const created = Number.isFinite(sorted[0]?.createdAt ?? NaN)
    ? (sorted[0]?.createdAt as number)
    : Date.now();

  return { did, publicKey: primary.publicKey, created, updated: created, platformLinks: [], capabilities: [] };
}

export async function buildIdentityView(
  eventStore: EventStore,
  did: string,
): Promise<IdentityView | null> {
  let publicKey: string | null = null;
  let createdAt: number | null = null;
  let updatedAt: number | null = null;
  const platformLinks: Array<Record<string, unknown>> = [];
  const capabilities: Array<Record<string, unknown>> = [];

  let cursor: string | null = null;
  for (;;) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) break;

    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) continue;
      const type = envelope.type as string | undefined;
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) continue;
      const payloadDid = payload.did as string | undefined;
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();

      if (type === 'identity.create' && payloadDid === did) {
        publicKey = (payload.publicKey as string | undefined) ?? publicKey;
        if (createdAt === null) createdAt = ts;
        updatedAt = ts;
      } else if (type === 'identity.update' && payloadDid === did) {
        updatedAt = ts;
      } else if (type === 'identity.platform.link' && payloadDid === did) {
        const platform = payload.platformId as string | undefined;
        const handle = payload.platformUsername as string | undefined;
        if (platform && handle) {
          platformLinks.push({ platform, handle, verified: false, verifiedAt: ts });
        }
      } else if (type === 'identity.capability.register' && payloadDid === did) {
        const name = payload.name as string | undefined;
        const pricing = payload.pricing as Record<string, unknown> | undefined;
        if (name && pricing) {
          const cap: Record<string, unknown> = {
            id: typeof envelope.hash === 'string' ? envelope.hash : `cap-${ts}`,
            name, pricing, verified: false, registeredAt: ts,
          };
          if (payload.description) cap.description = payload.description;
          capabilities.push(cap);
        }
      }
    }
    if (!next) break;
    cursor = next;
  }

  if (!publicKey) return null;
  const created = createdAt ?? updatedAt ?? Date.now();
  return { did, publicKey, created, updated: updatedAt ?? created, platformLinks, capabilities };
}

export async function buildIdentityCapabilities(
  eventStore: EventStore,
  did?: string,
): Promise<Array<Record<string, unknown>>> {
  const capabilities: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (;;) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) break;
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope || envelope.type !== 'identity.capability.register') continue;
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) continue;
      if (did && (payload.did as string) !== did) continue;
      const name = payload.name as string | undefined;
      const pricing = payload.pricing as Record<string, unknown> | undefined;
      if (!name || !pricing) continue;
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
      const cap: Record<string, unknown> = {
        id: typeof envelope.hash === 'string' ? envelope.hash : `cap-${ts}`,
        name, pricing, verified: false, registeredAt: ts,
      };
      if (payload.description) cap.description = payload.description;
      capabilities.push(cap);
    }
    if (!next) break;
    cursor = next;
  }
  return capabilities;
}

// ─── Wallet State Builder ───────────────────────────────────────

export async function buildWalletState(eventStore: EventStore): Promise<WalletState> {
  let state = createWalletState();
  let cursor: string | null = null;
  for (;;) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) break;
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (envelope) state = applyWalletEvent(state, envelope);
    }
    if (!next) break;
    cursor = next;
  }
  return state;
}

// ─── Market Search Query Parser ─────────────────────────────────

function safeParsePagination(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function parseTokenParam(value: string | null, field: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) throw new Error(`${field} must be an integer token amount`);
  return trimmed;
}

function parseNumberParam(value: string | null, field: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  return parsed;
}

export function parseMarketSearchQuery(params: URLSearchParams): SearchQuery {
  const markets = parseCsv(params.get('markets'));
  const tags = parseCsv(params.get('tags'));
  const skills = parseCsv(params.get('skills'));
  const taskTypes = parseCsv(params.get('taskTypes') ?? params.get('taskType'));
  const infoTypes = parseCsv(params.get('infoTypes') ?? params.get('infoType'));
  const contentFormats = parseCsv(params.get('contentFormats') ?? params.get('contentFormat'));
  const accessMethods = parseCsv(params.get('accessMethods') ?? params.get('accessMethod'));
  const capabilityTypeParam = params.get('capabilityType');
  const statuses = parseCsv(params.get('statuses') ?? params.get('status'));
  const visibility = parseCsv(params.get('visibility'));

  const marketTypes = markets?.map((e) => {
    if (!isMarketType(e)) throw new Error(`unknown market type: ${e}`);
    return e;
  });
  const listingStatuses = statuses?.map((e) => {
    if (!isListingStatus(e)) throw new Error(`unknown listing status: ${e}`);
    return e;
  });
  const listingVisibility = visibility?.map((e) => {
    if (!isListingVisibility(e)) throw new Error(`unknown visibility: ${e}`);
    return e;
  });
  const taskTypeValues = taskTypes?.map((e) => {
    if (!isTaskType(e)) throw new Error(`unknown task type: ${e}`);
    return e;
  });
  const infoTypeValues = infoTypes?.map((e) => {
    if (!isInfoType(e)) throw new Error(`unknown info type: ${e}`);
    return e;
  });
  const contentFormatValues = contentFormats?.map((e) => {
    if (!isContentFormat(e)) throw new Error(`unknown content format: ${e}`);
    return e;
  });
  const accessMethodValues = accessMethods?.map((e) => {
    if (!isAccessMethodType(e)) throw new Error(`unknown access method: ${e}`);
    return e;
  });
  let capabilityType: string | undefined;
  if (capabilityTypeParam) {
    if (!isCapabilityType(capabilityTypeParam)) throw new Error(`unknown capability type: ${capabilityTypeParam}`);
    capabilityType = capabilityTypeParam;
  }

  const page = safeParsePagination(params.get('page'), 1, 1_000_000);
  const pageSize = safeParsePagination(params.get('pageSize') ?? params.get('per_page'), 20, 1000);
  const includeFacets = parseBoolean(params.get('includeFacets'));

  const minPrice = parseTokenParam(params.get('minPrice') ?? params.get('priceMin'), 'minPrice');
  const maxPrice = parseTokenParam(params.get('maxPrice') ?? params.get('priceMax'), 'maxPrice');
  const minReputation = parseNumberParam(params.get('minReputation'), 'minReputation');
  const minRating = parseNumberParam(params.get('minRating'), 'minRating');
  const sort = params.get('sort') ?? undefined;

  return {
    keyword: params.get('keyword') ?? undefined,
    markets: marketTypes,
    category: params.get('category') ?? undefined,
    tags,
    priceRange: minPrice || maxPrice ? { min: minPrice, max: maxPrice } : undefined,
    minReputation,
    minRating,
    skills,
    taskTypes: taskTypeValues,
    capabilityType,
    infoTypes: infoTypeValues,
    contentFormats: contentFormatValues,
    accessMethods: accessMethodValues,
    sort: sort as SearchQuery['sort'],
    page,
    pageSize,
    includeFacets,
    statuses: listingStatuses,
    visibility: listingVisibility,
  };
}
