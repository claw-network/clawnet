import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  addressFromDid,
  bytesToUtf8,
  decryptKeyRecord,
  EventStore,
  keyIdFromPublicKey,
  loadKeyRecord,
  publicKeyFromDid,
  resolveStoragePaths,
  verifyCapabilityCredential,
} from '@clawtoken/core';
import {
  applyWalletEvent,
  CapabilityCredential,
  createIdentityCapabilityRegisterEnvelope,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowRefundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletTransferEnvelope,
  createWalletState,
  getWalletBalance,
  WalletState,
} from '@clawtoken/protocol';

const MAX_BODY_BYTES = 1_000_000;

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

export class ApiServer {
  private server?: Server;

  constructor(
    private readonly config: ApiServerConfig,
    private readonly runtime: {
      publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
      eventStore?: EventStore;
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
    const url = req.url ? new URL(req.url, `http://${this.config.host}`) : null;
    const method = req.method ?? 'GET';

    if (method === 'POST' && url?.pathname === '/api/identity/capabilities') {
      await this.handleCapabilityRegister(req, res);
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

    sendJson(res, 404, { error: 'not_found' });
  }

  private async handleCapabilityRegister(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody<CapabilityRegisterRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || !body.credential) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    const credential = body.credential;
    if (!(await verifyCapabilityCredential(credential))) {
      sendJson(res, 400, { error: 'invalid_credential' });
      return;
    }
    if (credential.credentialSubject?.id !== body.did) {
      sendJson(res, 400, { error: 'credential_subject_mismatch' });
      return;
    }

    const subject = credential.credentialSubject;
    if (!subject?.name || !subject?.pricing) {
      sendJson(res, 400, { error: 'credential_subject_incomplete' });
      return;
    }

    let privateKey: Uint8Array;
    try {
      const publicKey = publicKeyFromDid(body.did);
      const keyId = keyIdFromPublicKey(publicKey);
      const paths = resolveStoragePaths(this.config.dataDir);
      const record = await loadKeyRecord(paths, keyId);
      privateKey = await decryptKeyRecord(record, body.passphrase);
    } catch (error) {
      sendJson(res, 400, { error: 'key_unavailable' });
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
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }

  private async handleWalletBalance(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 500, { error: 'event_store_unavailable' });
      return;
    }
    const did = url.searchParams.get('did') ?? undefined;
    const address = url.searchParams.get('address') ?? undefined;
    const resolved = resolveAddressFromQuery({ did, address });
    if (!resolved) {
      sendJson(res, 400, { error: 'missing_address' });
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
      locked: Number(balance.locked.escrow) + Number(balance.locked.governance),
    });
  }

  private async handleWalletHistory(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 500, { error: 'event_store_unavailable' });
      return;
    }
    const did = url.searchParams.get('did') ?? undefined;
    const address = url.searchParams.get('address') ?? undefined;
    const resolved = resolveAddressFromQuery({ did, address });
    if (!resolved) {
      sendJson(res, 400, { error: 'missing_address' });
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

  private async handleWalletTransfer(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody<WalletTransferRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || !body.to) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    const to = resolveAddress(body.to);
    if (!to) {
      sendJson(res, 400, { error: 'invalid_to' });
      return;
    }
    const from = addressFromDid(body.did);
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendJson(res, 400, { error: 'key_unavailable' });
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
      sendJson(res, 400, { error: (error as Error).message });
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
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }

  private async handleWalletEscrowCreate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody<WalletEscrowCreateRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || !body.beneficiary || body.amount === undefined) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    if (!body.releaseRules?.length) {
      sendJson(res, 400, { error: 'release_rules_required' });
      return;
    }
    const beneficiary = resolveAddress(body.beneficiary);
    if (!beneficiary) {
      sendJson(res, 400, { error: 'invalid_beneficiary' });
      return;
    }
    const depositor = addressFromDid(body.did);
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendJson(res, 400, { error: 'key_unavailable' });
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
      sendJson(res, 400, { error: (error as Error).message });
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
      sendJson(res, 201, {
        id: escrowId,
        amount: Number(body.amount),
        released: 0,
        remaining: Number(body.amount),
        status: body.autoFund === false ? 'pending' : 'funded',
        releaseConditions: body.releaseRules,
        createdAt: body.ts ?? Date.now(),
      });
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }

  private async handleWalletEscrowGet(
    _req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 500, { error: 'event_store_unavailable' });
      return;
    }
    const state = await buildWalletState(eventStore);
    const escrow = state.escrows[escrowId];
    if (!escrow) {
      sendJson(res, 404, { error: 'escrow_not_found' });
      return;
    }
    sendJson(res, 200, {
      id: escrow.escrowId,
      amount: Number(escrow.balance),
      released: 0,
      remaining: Number(escrow.balance),
      status: escrow.status,
      createdAt: Date.now(),
    });
  }

  private async handleWalletEscrowFund(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await readJsonBody<WalletEscrowActionRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || body.amount === undefined || !body.resourcePrev) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendJson(res, 400, { error: 'key_unavailable' });
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
      sendJson(res, 400, { error: (error as Error).message });
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, status: 'broadcast' });
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }

  private async handleWalletEscrowRelease(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await readJsonBody<WalletEscrowActionRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || body.amount === undefined || !body.resourcePrev) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!body.ruleId) {
      sendJson(res, 400, { error: 'missing_rule_id' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendJson(res, 400, { error: 'key_unavailable' });
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
      sendJson(res, 400, { error: (error as Error).message });
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, status: 'broadcast' });
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }

  private async handleWalletEscrowRefund(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await readJsonBody<WalletEscrowActionRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || body.amount === undefined || !body.resourcePrev) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!body.reason) {
      sendJson(res, 400, { error: 'missing_reason' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendJson(res, 400, { error: 'key_unavailable' });
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
      sendJson(res, 400, { error: (error as Error).message });
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, status: 'broadcast' });
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }
}

async function readJsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<T | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'payload_too_large' });
      return null;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    sendJson(res, 400, { error: 'empty_body' });
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    sendJson(res, 400, { error: 'invalid_json' });
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
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

function parseEvent(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildWalletTransactions(
  state: WalletState,
  address: string,
): Array<Record<string, unknown>> {
  const transactions: Array<Record<string, unknown>> = [];
  for (const entry of state.history) {
    if (entry.type === 'wallet.transfer') {
      const payload = entry.payload as { from: string; to: string; amount: string };
      transactions.push({
        txHash: entry.hash,
        type: 'transfer',
        from: payload.from,
        to: payload.to,
        amount: Number(payload.amount),
        status: 'confirmed',
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
  return transactions.filter(
    (tx) => tx.from === address || tx.to === address,
  );
}

function filterWalletTransaction(type: string, address: string, tx: Record<string, unknown>): boolean {
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
