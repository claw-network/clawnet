import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { z } from 'zod';
import {
  addressFromDid,
  bytesToUtf8,
  didFromPublicKey,
  decryptKeyRecord,
  EventStore,
  keyIdFromPublicKey,
  listKeyRecords,
  loadKeyRecord,
  multibaseDecode,
  publicKeyFromDid,
  resolveStoragePaths,
  verifyCapabilityCredential,
} from '@clawtoken/core';
import {
  applyWalletEvent,
  applyReputationEvent,
  CapabilityCredential,
  buildReputationProfile,
  createIdentityCapabilityRegisterEnvelope,
  createReputationRecordEnvelope,
  createReputationState,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowRefundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletTransferEnvelope,
  createWalletState,
  getWalletBalance,
  getReputationRecords,
  isAccessMethodType,
  isContentFormat,
  isInfoType,
  isListingStatus,
  isListingVisibility,
  isMarketType,
  ReputationDimension,
  ReputationAspectKey,
  ReputationLevel,
  ReputationRecord,
  ReputationStore,
  ReputationState,
  SearchQuery,
  SearchResult,
  WalletState,
} from '@clawtoken/protocol';

const MAX_BODY_BYTES = 1_000_000;

const AmountSchema = z.union([z.number(), z.string()]);

const CapabilityRegisterSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    credential: z.unknown(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletTransferSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    to: z.string().min(1),
    amount: AmountSchema,
    fee: AmountSchema.optional(),
    memo: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletEscrowCreateSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    escrowId: z.string().optional(),
    beneficiary: z.string().min(1),
    amount: AmountSchema,
    releaseRules: z.array(z.record(z.unknown())).min(1),
    resourcePrev: z.union([z.string(), z.null()]).optional(),
    arbiter: z.string().optional(),
    refundRules: z.array(z.record(z.unknown())).optional(),
    expiresAt: z.number().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
    autoFund: z.boolean().optional(),
  })
  .passthrough();

const WalletEscrowActionSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    amount: AmountSchema,
    resourcePrev: z.string().min(1),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ReputationRecordSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    target: z.string().min(1),
    dimension: z.string().min(1),
    score: z.union([z.number(), z.string()]),
    ref: z.string().min(1),
    comment: z.string().optional(),
    aspects: z.record(z.union([z.number(), z.string()])).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletQuerySchema = z
  .object({
    did: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  })
  .refine((data) => data.did || data.address, { message: 'missing address' });

export interface ApiServerConfig {
  host: string;
  port: number;
  dataDir?: string;
}

export interface CapabilityRegisterRequest {
  did: string;
  passphrase: string;
  credential: CapabilityCredential;
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface WalletTransferRequest {
  did: string;
  passphrase: string;
  to: string;
  amount: string | number;
  fee?: string | number;
  memo?: string;
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface WalletBalanceQuery {
  did?: string;
  address?: string;
}

export interface WalletHistoryQuery extends WalletBalanceQuery {
  limit?: string;
  offset?: string;
  type?: string;
}

export interface WalletEscrowCreateRequest {
  did: string;
  passphrase: string;
  escrowId?: string;
  beneficiary: string;
  amount: string | number;
  releaseRules: Record<string, unknown>[];
  resourcePrev?: string | null;
  arbiter?: string;
  refundRules?: Record<string, unknown>[];
  expiresAt?: number;
  nonce: number;
  prev?: string;
  ts?: number;
  autoFund?: boolean;
}

export interface WalletEscrowActionRequest {
  did: string;
  passphrase: string;
  amount: string | number;
  resourcePrev: string;
  ruleId?: string;
  reason?: string;
  evidence?: Record<string, unknown>[];
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface ReputationRecordRequest {
  did: string;
  passphrase: string;
  target: string;
  dimension: string;
  score: number | string;
  ref: string;
  comment?: string;
  aspects?: Record<ReputationAspectKey, number>;
  nonce: number;
  prev?: string;
  ts?: number;
}

export class ApiServer {
  private server?: Server;

  constructor(
    private readonly config: ApiServerConfig,
    private readonly runtime: {
      publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
      eventStore?: EventStore;
      reputationStore?: ReputationStore;
      searchMarkets?: (query: SearchQuery) => SearchResult;
      getNodeStatus?: () => Promise<Record<string, unknown>>;
      getNodePeers?: () => Promise<{ peers: Record<string, unknown>[]; total: number }>;
      getNodeConfig?: () => Promise<Record<string, unknown>>;
    },
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = createServer((req, res) => {
      void this.route(req, res);
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = req.url ? new URL(req.url, `http://${this.config.host}`) : null;
      const method = req.method ?? 'GET';

      if (method === 'GET' && url?.pathname === '/api/node/status') {
        await this.handleNodeStatus(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/node/peers') {
        await this.handleNodePeers(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/node/config') {
        await this.handleNodeConfig(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/identity') {
        await this.handleIdentitySelf(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/identity/capabilities') {
        await this.handleIdentityCapabilities(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname?.startsWith('/api/identity/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 3) {
          const did = decodeURIComponent(segments[2]);
          await this.handleIdentityResolve(req, res, did);
          return;
        }
      }

      if (method === 'POST' && url?.pathname === '/api/identity/capabilities') {
        await this.handleCapabilityRegister(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname?.startsWith('/api/reputation/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 3) {
          const did = decodeURIComponent(segments[2]);
          await this.handleReputationProfile(req, res, did, url);
          return;
        }
        if (segments.length === 4 && segments[3] === 'reviews') {
          const did = decodeURIComponent(segments[2]);
          await this.handleReputationReviews(req, res, did, url);
          return;
        }
      }

      if (method === 'POST' && url?.pathname === '/api/reputation/record') {
        await this.handleReputationRecord(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/wallet/balance') {
        await this.handleWalletBalance(req, res, url);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/wallet/history') {
        await this.handleWalletHistory(req, res, url);
        return;
      }

      if (method === 'POST' && url?.pathname === '/api/wallet/transfer') {
        await this.handleWalletTransfer(req, res);
        return;
      }

      if (method === 'POST' && url?.pathname === '/api/wallet/escrow') {
        await this.handleWalletEscrowCreate(req, res);
        return;
      }

      if (url?.pathname?.startsWith('/api/wallet/escrow/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        const escrowId = segments[3];
        const action = segments[4];
        if (segments.length === 4 && method === 'GET') {
          await this.handleWalletEscrowGet(req, res, escrowId);
          return;
        }
        if (segments.length === 5 && method === 'POST') {
          if (action === 'fund') {
            await this.handleWalletEscrowFund(req, res, escrowId);
            return;
          }
          if (action === 'release') {
            await this.handleWalletEscrowRelease(req, res, escrowId);
            return;
          }
          if (action === 'refund') {
            await this.handleWalletEscrowRefund(req, res, escrowId);
            return;
          }
        }
      }

      if (method === 'GET' && url?.pathname === '/api/markets/search') {
        await this.handleMarketSearch(req, res, url);
        return;
      }

      sendError(res, 404, 'NOT_FOUND', 'route not found');
    } catch {
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', 'unexpected error');
      }
    }
  }

  private async handleNodeStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.runtime.getNodeStatus) {
      sendError(res, 500, 'INTERNAL_ERROR', 'node status unavailable');
      return;
    }
    try {
      const status = await this.runtime.getNodeStatus();
      sendJson(res, 200, status);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to read node status');
    }
  }

  private async handleNodePeers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.runtime.getNodePeers) {
      sendError(res, 500, 'INTERNAL_ERROR', 'node peers unavailable');
      return;
    }
    try {
      const peers = await this.runtime.getNodePeers();
      sendJson(res, 200, peers);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to read node peers');
    }
  }

  private async handleNodeConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.runtime.getNodeConfig) {
      sendError(res, 500, 'INTERNAL_ERROR', 'node config unavailable');
      return;
    }
    try {
      const config = await this.runtime.getNodeConfig();
      sendJson(res, 200, config);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to read node config');
    }
  }

  private async handleIdentitySelf(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const identity = await resolveLocalIdentity(this.config.dataDir);
    if (!identity) {
      sendError(res, 404, 'DID_NOT_FOUND', 'local identity not initialized');
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 200, identity);
      return;
    }
    const fromEvents = await buildIdentityView(eventStore, identity.did);
    if (fromEvents) {
      sendJson(res, 200, {
        ...identity,
        ...fromEvents,
        did: identity.did,
        publicKey: identity.publicKey,
      });
      return;
    }
    const capabilities = await buildIdentityCapabilities(eventStore, identity.did);
    sendJson(res, 200, { ...identity, capabilities });
  }

  private async handleIdentityResolve(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
  ): Promise<void> {
    try {
      publicKeyFromDid(did);
    } catch {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    const local = await resolveLocalIdentity(this.config.dataDir);
    if (local && local.did === did) {
      const eventStore = this.runtime.eventStore;
      if (!eventStore) {
        sendJson(res, 200, local);
        return;
      }
      const fromEvents = await buildIdentityView(eventStore, did);
      if (fromEvents) {
        sendJson(res, 200, {
          ...local,
          ...fromEvents,
          did: local.did,
          publicKey: local.publicKey,
        });
        return;
      }
      const capabilities = await buildIdentityCapabilities(eventStore, did);
      sendJson(res, 200, { ...local, capabilities });
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 404, 'DID_NOT_FOUND', 'did not found');
      return;
    }
    const resolved = await buildIdentityView(eventStore, did);
    if (!resolved) {
      sendError(res, 404, 'DID_NOT_FOUND', 'did not found');
      return;
    }
    sendJson(res, 200, resolved);
  }

  private async handleIdentityCapabilities(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 200, { capabilities: [] });
      return;
    }
    const capabilities = await buildIdentityCapabilities(eventStore);
    sendJson(res, 200, { capabilities });
  }

  private async handleCapabilityRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, CapabilityRegisterSchema);
    if (!body) {
      return;
    }
    const credential = body.credential as CapabilityCredential | undefined;
    if (!credential) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing credential');
      return;
    }
    if (!(await verifyCapabilityCredential(credential))) {
      sendError(res, 400, 'CAPABILITY_INVALID', 'invalid capability credential');
      return;
    }
    if (credential.credentialSubject?.id !== body.did) {
      sendError(res, 400, 'CAPABILITY_INVALID', 'credential subject mismatch');
      return;
    }

    const subject = credential.credentialSubject;
    if (!subject?.name || !subject?.pricing) {
      sendError(res, 400, 'CAPABILITY_INVALID', 'credential subject incomplete');
      return;
    }

    let privateKey: Uint8Array;
    try {
      const publicKey = publicKeyFromDid(body.did);
      const keyId = keyIdFromPublicKey(publicKey);
      const paths = resolveStoragePaths(this.config.dataDir);
      const record = await loadKeyRecord(paths, keyId);
      privateKey = await decryptKeyRecord(record, body.passphrase);
    } catch {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const envelope = await createIdentityCapabilityRegisterEnvelope({
      did: body.did,
      privateKey,
      name: subject.name,
      pricing: subject.pricing,
      description: subject.description,
      credential,
      ts: body.ts ?? Date.now(),
      nonce: body.nonce,
      prev: body.prev,
    });

    try {
      const hash = await this.runtime.publishEvent(envelope);
      const response: Record<string, unknown> = {
        id: hash,
        name: subject.name,
        pricing: subject.pricing,
        verified: false,
        registeredAt: body.ts ?? Date.now(),
      };
      if (subject.description) {
        response.description = subject.description;
      }
      sendJson(res, 201, response);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleReputationProfile(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
    url: URL,
  ): Promise<void> {
    if (!isValidDid(did)) {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    const source = parseReputationSource(url.searchParams.get('source'));
    if (source === 'invalid') {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid source');
      return;
    }
    const store = this.runtime.reputationStore;
    if (source !== 'log' && store) {
      const records = await store.getRecords(did);
      if (!records.length) {
        sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
        return;
      }
      const profile = await store.getProfile(did);
      const qualityRecords = records.filter((record) => record.dimension === 'quality');
      const averageRating = computeAverageRating(qualityRecords);
      const levelInfo = mapReputationLevel(profile.level);
      sendJson(res, 200, {
        did,
        score: profile.overallScore,
        level: levelInfo.label,
        levelNumber: levelInfo.levelNumber,
        dimensions: {
          transaction: profile.dimensions.transaction.score,
          delivery: profile.dimensions.fulfillment.score,
          quality: profile.dimensions.quality.score,
          social: profile.dimensions.social.score,
          behavior: profile.dimensions.behavior.score,
        },
        totalTransactions: profile.dimensions.transaction.recordCount,
        successRate: 0,
        averageRating,
        badges: [],
        updatedAt: profile.updatedAt ?? Date.now(),
      });
      return;
    }
    if (source === 'store' && !store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'reputation store unavailable');
      return;
    }

    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildReputationState(eventStore);
    const records = getReputationRecords(state, did);
    if (!records.length) {
      sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
      return;
    }
    const profile = buildReputationProfile(state, did);
    const qualityRecords = records.filter((record) => record.dimension === 'quality');
    const averageRating = computeAverageRating(qualityRecords);
    const levelInfo = mapReputationLevel(profile.level);
    sendJson(res, 200, {
      did,
      score: profile.overallScore,
      level: levelInfo.label,
      levelNumber: levelInfo.levelNumber,
      dimensions: {
        transaction: profile.dimensions.transaction.score,
        delivery: profile.dimensions.fulfillment.score,
        quality: profile.dimensions.quality.score,
        social: profile.dimensions.social.score,
        behavior: profile.dimensions.behavior.score,
      },
      totalTransactions: profile.dimensions.transaction.recordCount,
      successRate: 0,
      averageRating,
      badges: [],
      updatedAt: profile.updatedAt ?? Date.now(),
    });
  }

  private async handleReputationReviews(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
    url: URL,
  ): Promise<void> {
    if (!isValidDid(did)) {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    const source = parseReputationSource(url.searchParams.get('source'));
    if (source === 'invalid') {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid source');
      return;
    }
    const limit = parsePagination(url.searchParams.get('limit'), 20, 100);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000);

    const store = this.runtime.reputationStore;
    if (source !== 'log' && store) {
      const allRecords = await store.getRecords(did);
      if (!allRecords.length) {
        sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
        return;
      }
      const records = allRecords.filter((record) => record.dimension === 'quality');
      const sorted = [...records].sort((a, b) => b.ts - a.ts);
      const sliced = sorted.slice(offset, offset + limit);
      const reviews = sliced.map((record) => ({
        id: record.hash,
        contractId: record.ref,
        reviewer: record.issuer,
        reviewee: record.target,
        rating: ratingFromScore(record.score),
        comment: record.comment,
        aspects: record.aspects,
        createdAt: record.ts,
      }));
      const averageRating = computeAverageRating(records);
      sendJson(res, 200, {
        reviews,
        total: records.length,
        averageRating,
        pagination: {
          total: records.length,
          limit,
          offset,
          hasMore: offset + limit < records.length,
        },
      });
      return;
    }
    if (source === 'store' && !store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'reputation store unavailable');
      return;
    }

    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildReputationState(eventStore);
    const allRecords = getReputationRecords(state, did);
    if (!allRecords.length) {
      sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
      return;
    }
    const records = allRecords.filter((record) => record.dimension === 'quality');
    const sorted = [...records].sort((a, b) => b.ts - a.ts);
    const sliced = sorted.slice(offset, offset + limit);
    const reviews = sliced.map((record) => ({
      id: record.hash,
      contractId: record.ref,
      reviewer: record.issuer,
      reviewee: record.target,
      rating: ratingFromScore(record.score),
      comment: record.comment,
      aspects: record.aspects,
      createdAt: record.ts,
    }));
    const averageRating = computeAverageRating(records);
    sendJson(res, 200, {
      reviews,
      total: records.length,
      averageRating,
      pagination: {
        total: records.length,
        limit,
        offset,
        hasMore: offset + limit < records.length,
      },
    });
  }

  private async handleReputationRecord(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, ReputationRecordSchema);
    if (!body) {
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'REPUTATION_INVALID', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      const scoreValue = typeof body.score === 'string' ? Number(body.score) : body.score;
      const aspects = body.aspects
        ? (Object.fromEntries(
            Object.entries(body.aspects).map(([key, value]) => [
              key,
              typeof value === 'number' ? value : Number(value),
            ]),
          ) as Record<ReputationAspectKey, number>)
        : undefined;
      envelope = await createReputationRecordEnvelope({
        issuer: body.did,
        privateKey,
        target: body.target,
        dimension: body.dimension as ReputationDimension,
        score: scoreValue,
        ref: body.ref,
        comment: body.comment,
        aspects,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'REPUTATION_INVALID', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletBalance(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const query = parseWalletQuery(url, res);
    if (!query) {
      return;
    }
    const resolved = resolveAddressFromQuery(query);
    if (!resolved) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing address');
      return;
    }
    const state = await buildWalletState(eventStore);
    const balance = getWalletBalance(state, resolved);
    const total =
      BigInt(balance.available) +
      BigInt(balance.pending) +
      BigInt(balance.locked.escrow) +
      BigInt(balance.locked.governance);
    sendJson(res, 200, {
      balance: Number(total),
      available: Number(balance.available),
      pending: Number(balance.pending),
      locked: Number(balance.locked.escrow),
    });
  }

  private async handleWalletHistory(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const query = parseWalletQuery(url, res);
    if (!query) {
      return;
    }
    const resolved = resolveAddressFromQuery(query);
    if (!resolved) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing address');
      return;
    }
    const typeFilter = url.searchParams.get('type') ?? 'all';
    const limit = parsePagination(url.searchParams.get('limit'), 20, 100);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000);

    const state = await buildWalletState(eventStore);
    const transactions = buildWalletTransactions(state, resolved).filter((tx) =>
      filterWalletTransaction(typeFilter, resolved, tx),
    );
    const sliced = transactions.slice(offset, offset + limit);
    sendJson(res, 200, {
      transactions: sliced,
      total: transactions.length,
      hasMore: offset + limit < transactions.length,
      pagination: { limit, offset },
    });
  }

  private async handleWalletTransfer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, WalletTransferSchema);
    if (!body) {
      return;
    }
    const to = resolveAddress(body.to);
    if (!to) {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid recipient');
      return;
    }
    const from = addressFromDid(body.did);
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletTransferEnvelope({
        issuer: body.did,
        privateKey,
        from,
        to,
        amount: body.amount,
        fee: body.fee ?? 1,
        memo: body.memo,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        from,
        to,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowCreateSchema);
    if (!body) {
      return;
    }
    const beneficiary = resolveAddress(body.beneficiary);
    if (!beneficiary) {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid beneficiary');
      return;
    }
    const depositor = addressFromDid(body.did);
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const escrowId = body.escrowId ?? `escrow-${Date.now()}`;

    let createEnvelope: Record<string, unknown>;
    try {
      createEnvelope = await createWalletEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        depositor,
        beneficiary,
        amount: body.amount,
        releaseRules: body.releaseRules,
        resourcePrev: body.resourcePrev,
        arbiter: body.arbiter,
        refundRules: body.refundRules,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const createHash = await this.runtime.publishEvent(createEnvelope);
      if (body.autoFund !== false) {
        const fundEnvelope = await createWalletEscrowFundEnvelope({
          issuer: body.did,
          privateKey,
          escrowId,
          resourcePrev: createHash,
          amount: body.amount,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce + 1,
          prev: createHash,
        });
        await this.runtime.publishEvent(fundEnvelope);
      }
      const total = Number(body.amount);
      sendJson(res, 201, {
        id: escrowId,
        amount: total,
        released: 0,
        remaining: total,
        status: mapEscrowStatus(body.autoFund === false ? 'pending' : 'funded'),
        releaseConditions: body.releaseRules,
        createdAt: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowGet(
    _req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildWalletState(eventStore);
    const escrow = state.escrows[escrowId];
    if (!escrow) {
      sendError(res, 404, 'ESCROW_NOT_FOUND', 'escrow not found');
      return;
    }
    const escrowView = buildEscrowView(state, escrow);
    sendJson(res, 200, {
      id: escrow.escrowId,
      amount: escrowView.amount,
      released: escrowView.released,
      remaining: escrowView.remaining,
      status: escrowView.status,
      releaseConditions: escrowView.releaseConditions,
      createdAt: escrowView.createdAt,
    });
  }

  private async handleWalletEscrowFund(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowActionSchema);
    if (!body) {
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: body.resourcePrev,
        amount: body.amount,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowRelease(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowActionSchema);
    if (!body) {
      return;
    }
    if (!body.ruleId) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing rule id');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletEscrowReleaseEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: body.resourcePrev,
        amount: body.amount,
        ruleId: body.ruleId,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowRefund(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowActionSchema);
    if (!body) {
      return;
    }
    if (!body.reason) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing reason');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletEscrowRefundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: body.resourcePrev,
        amount: body.amount,
        reason: body.reason ?? 'refund',
        evidence: body.evidence,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleMarketSearch(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (!this.runtime.searchMarkets) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market search unavailable');
      return;
    }
    let query: SearchQuery;
    try {
      query = parseMarketSearchQuery(url.searchParams);
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const result = this.runtime.searchMarkets(query);
      sendJson(res, 200, result);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to search markets');
    }
  }
}

async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      sendError(res, 413, 'INVALID_REQUEST', 'payload too large');
      return null;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    sendError(res, 400, 'INVALID_REQUEST', 'empty body');
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    sendError(res, 400, 'INVALID_REQUEST', 'invalid json');
    return null;
  }
}

async function parseBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await readJsonBody(req, res);
  if (!raw) {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid request';
    sendError(res, 400, 'INVALID_REQUEST', message);
    return null;
  }
  return parsed.data;
}

function parseWalletQuery(url: URL, res: ServerResponse): WalletBalanceQuery | null {
  const data = {
    did: url.searchParams.get('did') ?? undefined,
    address: url.searchParams.get('address') ?? undefined,
  };
  const parsed = WalletQuerySchema.safeParse(data);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid request';
    sendError(res, 400, 'INVALID_REQUEST', message);
    return null;
  }
  return parsed.data;
}

function mapEscrowStatus(
  status: WalletState['escrows'][string]['status'],
): 'active' | 'released' | 'refunded' | 'disputed' {
  switch (status) {
    case 'released':
      return 'released';
    case 'refunded':
      return 'refunded';
    case 'disputed':
      return 'disputed';
    case 'pending':
    case 'funded':
    case 'releasing':
    default:
      return 'active';
  }
}

function parseBigInt(value: string | undefined): bigint {
  if (!value) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function buildEscrowView(
  state: WalletState,
  escrow: WalletState['escrows'][string],
): {
  amount: number;
  released: number;
  remaining: number;
  status: 'active' | 'released' | 'refunded' | 'disputed';
  releaseConditions: Record<string, unknown>[];
  createdAt: number;
} {
  let createdAt = Date.now();
  let totalAmount: bigint | null = null;
  let releaseConditions: Record<string, unknown>[] = [];

  for (const entry of state.history) {
    if (entry.type !== 'wallet.escrow.create') {
      continue;
    }
    const payload = entry.payload as Record<string, unknown>;
    if (payload.escrowId !== escrow.escrowId) {
      continue;
    }
    createdAt = entry.ts;
    totalAmount = parseBigInt(payload.amount as string | undefined);
    const rules = payload.releaseRules as Record<string, unknown>[] | undefined;
    if (Array.isArray(rules)) {
      releaseConditions = rules;
    }
    break;
  }

  const remaining = parseBigInt(escrow.balance);
  const total = totalAmount ?? remaining;
  const released = total - remaining >= 0n ? total - remaining : 0n;

  return {
    amount: Number(total),
    released: Number(released),
    remaining: Number(remaining),
    status: mapEscrowStatus(escrow.status),
    releaseConditions,
    createdAt,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function isValidDid(value: string): boolean {
  if (!value) {
    return false;
  }
  try {
    publicKeyFromDid(value);
    return true;
  } catch {
    return false;
  }
}

function resolveAddress(input: string): string | null {
  if (!input) {
    return null;
  }
  if (input.startsWith('did:claw:')) {
    try {
      return addressFromDid(input);
    } catch {
      return null;
    }
  }
  return input;
}

function resolveAddressFromQuery(query: WalletBalanceQuery): string | null {
  if (query.address) {
    return query.address;
  }
  if (query.did) {
    return resolveAddress(query.did);
  }
  return null;
}

async function resolvePrivateKey(
  dataDir: string | undefined,
  did: string,
  passphrase: string,
): Promise<Uint8Array | null> {
  try {
    const publicKey = publicKeyFromDid(did);
    const keyId = keyIdFromPublicKey(publicKey);
    const paths = resolveStoragePaths(dataDir);
    const record = await loadKeyRecord(paths, keyId);
    return await decryptKeyRecord(record, passphrase);
  } catch {
    return null;
  }
}

function parsePagination(value: string | null, fallback: number, max: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseCsv(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length ? items : undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error('invalid boolean value');
}

function parseTokenParam(value: string | null, field: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${field} must be an integer token amount`);
  }
  return trimmed;
}

function parseNumberParam(value: string | null, field: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a number`);
  }
  return parsed;
}

function parseMarketSearchQuery(params: URLSearchParams): SearchQuery {
  const markets = parseCsv(params.get('markets'));
  const tags = parseCsv(params.get('tags'));
  const skills = parseCsv(params.get('skills'));
  const infoTypes = parseCsv(params.get('infoTypes') ?? params.get('infoType'));
  const contentFormats = parseCsv(params.get('contentFormats') ?? params.get('contentFormat'));
  const accessMethods = parseCsv(params.get('accessMethods') ?? params.get('accessMethod'));
  const statuses = parseCsv(params.get('statuses') ?? params.get('status'));
  const visibility = parseCsv(params.get('visibility'));

  const marketTypes = markets?.map((entry) => {
    if (!isMarketType(entry)) {
      throw new Error(`unknown market type: ${entry}`);
    }
    return entry;
  });
  const listingStatuses = statuses?.map((entry) => {
    if (!isListingStatus(entry)) {
      throw new Error(`unknown listing status: ${entry}`);
    }
    return entry;
  });
  const listingVisibility = visibility?.map((entry) => {
    if (!isListingVisibility(entry)) {
      throw new Error(`unknown visibility: ${entry}`);
    }
    return entry;
  });
  const infoTypeValues = infoTypes?.map((entry) => {
    if (!isInfoType(entry)) {
      throw new Error(`unknown info type: ${entry}`);
    }
    return entry;
  });
  const contentFormatValues = contentFormats?.map((entry) => {
    if (!isContentFormat(entry)) {
      throw new Error(`unknown content format: ${entry}`);
    }
    return entry;
  });
  const accessMethodValues = accessMethods?.map((entry) => {
    if (!isAccessMethodType(entry)) {
      throw new Error(`unknown access method: ${entry}`);
    }
    return entry;
  });

  const page = parsePagination(params.get('page'), 1, 1_000_000);
  const pageSize = parsePagination(params.get('pageSize'), 20, 1000);
  const includeFacets = parseBoolean(params.get('includeFacets'));

  const minPrice = parseTokenParam(params.get('minPrice') ?? params.get('priceMin'), 'minPrice');
  const maxPrice = parseTokenParam(params.get('maxPrice') ?? params.get('priceMax'), 'maxPrice');

  const minReputation = parseNumberParam(params.get('minReputation'), 'minReputation');
  const minRating = parseNumberParam(params.get('minRating'), 'minRating');

  const sort = params.get('sort') ?? undefined;

  const query: SearchQuery = {
    keyword: params.get('keyword') ?? undefined,
    markets: marketTypes,
    category: params.get('category') ?? undefined,
    tags,
    priceRange: minPrice || maxPrice ? { min: minPrice, max: maxPrice } : undefined,
    minReputation,
    minRating,
    skills,
    capabilityType: params.get('capabilityType') ?? undefined,
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

  return query;
}

type ReputationSource = 'store' | 'log';

function parseReputationSource(value: string | null): ReputationSource | null | 'invalid' {
  if (!value) {
    return null;
  }
  if (value === 'store' || value === 'log') {
    return value;
  }
  return 'invalid';
}

interface IdentityView {
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

async function resolveLocalIdentity(dataDir?: string): Promise<IdentityView | null> {
  const paths = resolveStoragePaths(dataDir);
  const records = await listKeyRecords(paths);
  if (!records.length) {
    return null;
  }
  const sorted = records
    .map((record) => ({
      record,
      createdAt: Date.parse(record.createdAt ?? ''),
    }))
    .sort((a, b) => {
      const left = Number.isFinite(a.createdAt) ? a.createdAt : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.createdAt) ? b.createdAt : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  const primary = sorted[0]?.record;
  if (!primary?.publicKey) {
    return null;
  }
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
  return {
    did,
    publicKey: primary.publicKey,
    created,
    updated: created,
    platformLinks: [],
    capabilities: [],
  };
}

async function buildIdentityView(
  eventStore: EventStore,
  did: string,
): Promise<IdentityView | null> {
  let publicKey: string | null = null;
  let createdAt: number | null = null;
  let updatedAt: number | null = null;
  const platformLinks: Array<Record<string, unknown>> = [];
  const capabilities: Array<Record<string, unknown>> = [];

  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      const type = envelope.type as string | undefined;
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) {
        continue;
      }
      const payloadDid = payload.did as string | undefined;
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
      if (type === 'identity.create' && payloadDid === did) {
        publicKey = (payload.publicKey as string | undefined) ?? publicKey;
        if (createdAt === null) {
          createdAt = ts;
        }
        updatedAt = ts;
        continue;
      }
      if (type === 'identity.update' && payloadDid === did) {
        updatedAt = ts;
        continue;
      }
      if (type === 'identity.platform.link' && payloadDid === did) {
        const platform = payload.platformId as string | undefined;
        const handle = payload.platformUsername as string | undefined;
        if (platform && handle) {
          platformLinks.push({
            platform,
            handle,
            verified: false,
            verifiedAt: ts,
          });
        }
        continue;
      }
      if (type === 'identity.capability.register' && payloadDid === did) {
        const name = payload.name as string | undefined;
        const pricing = payload.pricing as Record<string, unknown> | undefined;
        if (!name || !pricing) {
          continue;
        }
        const capability: Record<string, unknown> = {
          id: typeof envelope.hash === 'string' ? envelope.hash : `cap-${ts}`,
          name,
          pricing,
          verified: false,
          registeredAt: ts,
        };
        if (payload.description) {
          capability.description = payload.description;
        }
        capabilities.push(capability);
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }

  if (!publicKey) {
    return null;
  }
  const created = createdAt ?? updatedAt ?? Date.now();
  const updated = updatedAt ?? created;
  return {
    did,
    publicKey,
    created,
    updated,
    platformLinks,
    capabilities,
  };
}

async function buildIdentityCapabilities(
  eventStore: EventStore,
  did?: string,
): Promise<Array<Record<string, unknown>>> {
  const capabilities: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope || envelope.type !== 'identity.capability.register') {
        continue;
      }
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) {
        continue;
      }
      const payloadDid = payload.did as string | undefined;
      if (did && payloadDid !== did) {
        continue;
      }
      const name = payload.name as string | undefined;
      const pricing = payload.pricing as Record<string, unknown> | undefined;
      if (!name || !pricing) {
        continue;
      }
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
      const capability: Record<string, unknown> = {
        id: typeof envelope.hash === 'string' ? envelope.hash : `cap-${ts}`,
        name,
        pricing,
        verified: false,
        registeredAt: ts,
      };
      if (payload.description) {
        capability.description = payload.description;
      }
      capabilities.push(capability);
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return capabilities;
}

async function buildWalletState(eventStore: EventStore): Promise<WalletState> {
  let state = createWalletState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      state = applyWalletEvent(state, envelope);
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

async function buildReputationState(eventStore: EventStore): Promise<ReputationState> {
  let state = createReputationState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      try {
        state = applyReputationEvent(state, envelope);
      } catch {
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

function parseEvent(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapReputationLevel(level: ReputationLevel): { label: string; levelNumber: number } {
  switch (level) {
    case 'legend':
      return { label: 'Legend', levelNumber: 7 };
    case 'elite':
      return { label: 'Master', levelNumber: 6 };
    case 'expert':
      return { label: 'Expert', levelNumber: 5 };
    case 'trusted':
      return { label: 'Advanced', levelNumber: 4 };
    case 'newcomer':
      return { label: 'Intermediate', levelNumber: 3 };
    case 'observed':
      return { label: 'Beginner', levelNumber: 2 };
    case 'risky':
    default:
      return { label: 'Newcomer', levelNumber: 1 };
  }
}

function ratingFromScore(score: number): number {
  const rating = Math.round(score / 200);
  return Math.max(1, Math.min(5, rating));
}

function computeAverageRating(records: ReputationRecord[]): number {
  if (!records.length) {
    return 0;
  }
  const total = records.reduce((sum, record) => sum + ratingFromScore(record.score), 0);
  return Number((total / records.length).toFixed(2));
}

function buildWalletTransactions(
  state: WalletState,
  address: string,
): Array<Record<string, unknown>> {
  const transactions: Array<Record<string, unknown>> = [];
  for (const entry of state.history) {
    if (entry.type === 'wallet.transfer') {
      const payload = entry.payload as {
        from: string;
        to: string;
        amount: string;
        memo?: string;
      };
      transactions.push({
        txHash: entry.hash,
        type: 'transfer',
        from: payload.from,
        to: payload.to,
        amount: Number(payload.amount),
        status: 'confirmed',
        memo: payload.memo,
        timestamp: entry.ts,
      });
      continue;
    }
    if (entry.type === 'wallet.escrow.fund') {
      const payload = entry.payload as { escrowId: string; amount: string };
      const escrow = state.escrows[payload.escrowId];
      transactions.push({
        txHash: entry.hash,
        type: 'escrow_lock',
        from: escrow?.depositor,
        to: escrow?.beneficiary,
        amount: Number(payload.amount),
        status: 'confirmed',
        timestamp: entry.ts,
      });
      continue;
    }
    if (entry.type === 'wallet.escrow.release') {
      const payload = entry.payload as { escrowId: string; amount: string };
      const escrow = state.escrows[payload.escrowId];
      transactions.push({
        txHash: entry.hash,
        type: 'escrow_release',
        from: escrow?.depositor,
        to: escrow?.beneficiary,
        amount: Number(payload.amount),
        status: 'confirmed',
        timestamp: entry.ts,
      });
      continue;
    }
    if (entry.type === 'wallet.escrow.refund') {
      const payload = entry.payload as { escrowId: string; amount: string };
      const escrow = state.escrows[payload.escrowId];
      transactions.push({
        txHash: entry.hash,
        type: 'escrow_release',
        from: escrow?.depositor,
        to: escrow?.depositor,
        amount: Number(payload.amount),
        status: 'confirmed',
        timestamp: entry.ts,
      });
      continue;
    }
  }
  return transactions.filter((tx) => tx.from === address || tx.to === address);
}

function filterWalletTransaction(
  type: string,
  address: string,
  tx: Record<string, unknown>,
): boolean {
  if (type === 'all') {
    return true;
  }
  const from = tx.from as string | undefined;
  const to = tx.to as string | undefined;
  if (type === 'sent') {
    return from === address;
  }
  if (type === 'received') {
    return to === address;
  }
  if (type === 'escrow') {
    return tx.type === 'escrow_lock' || tx.type === 'escrow_release';
  }
  return true;
}
