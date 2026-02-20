import { multibaseEncode } from '@claw-network/core/encoding';
import { publicKeyFromDid } from '@claw-network/core/identity';
import { EventEnvelope, eventHashHex, signEvent } from '@claw-network/core/protocol';
import {
  ContractMilestone,
  ContractParties,
  ServiceContract,
} from './types.js';

function requireNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertValidDid(value: string, field: string): void {
  requireNonEmpty(value, field);
  if (!value.startsWith('did:claw:')) {
    throw new Error(`${field} must be a valid did`);
  }
}

function parseParties(value: unknown): ContractParties {
  const record = assertRecord(value, 'parties');
  const client = assertRecord(record.client, 'parties.client');
  const provider = assertRecord(record.provider, 'parties.provider');
  const clientDid = String(client.did ?? '');
  const providerDid = String(provider.did ?? '');
  assertValidDid(clientDid, 'parties.client.did');
  assertValidDid(providerDid, 'parties.provider.did');
  const parseOptionalParties = (entries: unknown, field: string) => {
    if (entries === undefined) {
      return undefined;
    }
    if (!Array.isArray(entries)) {
      throw new Error(`${field} must be an array`);
    }
    return entries.map((entry, index) => {
      const party = assertRecord(entry, `${field}[${index}]`);
      const did = String(party.did ?? '');
      assertValidDid(did, `${field}[${index}].did`);
      return {
        did,
        address: typeof party.address === 'string' ? party.address : undefined,
        name: typeof party.name === 'string' ? party.name : undefined,
        role: typeof party.role === 'string' ? party.role : undefined,
      };
    });
  };
  return {
    client: {
      did: clientDid,
      address: typeof client.address === 'string' ? client.address : undefined,
      name: typeof client.name === 'string' ? client.name : undefined,
      role: typeof client.role === 'string' ? client.role : undefined,
    },
    provider: {
      did: providerDid,
      address: typeof provider.address === 'string' ? provider.address : undefined,
      name: typeof provider.name === 'string' ? provider.name : undefined,
      role: typeof provider.role === 'string' ? provider.role : undefined,
    },
    subcontractors: parseOptionalParties(record.subcontractors, 'parties.subcontractors'),
    auditors: parseOptionalParties(record.auditors, 'parties.auditors'),
    arbiters: parseOptionalParties(record.arbiters, 'parties.arbiters'),
    guarantors: parseOptionalParties(record.guarantors, 'parties.guarantors'),
    witnesses: parseOptionalParties(record.witnesses, 'parties.witnesses'),
  };
}

function parseMilestones(value: unknown): ContractMilestone[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('milestones must be an array');
  }
  return value.map((entry, index) => {
    const record = assertRecord(entry, `milestones[${index}]`);
    const id = String(record.id ?? '');
    requireNonEmpty(id, `milestones[${index}].id`);
    return {
      ...record,
      id,
      status: (record.status as ContractMilestone['status']) ?? 'pending',
    };
  });
}

function buildEnvelope(
  type: string,
  issuer: string,
  publicKey: Uint8Array,
  payload: Record<string, unknown>,
  ts: number,
  nonce: number,
  prev?: string,
): EventEnvelope {
  return {
    v: 1,
    type,
    issuer,
    ts,
    nonce,
    payload,
    prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };
}

export interface ContractCreatePayload extends Record<string, unknown> {
  contractId: string;
  parties: ContractParties;
  service: Record<string, unknown>;
  terms: Record<string, unknown>;
  payment: Record<string, unknown>;
  timeline: Record<string, unknown>;
  milestones?: ContractMilestone[];
  attachments?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  resourcePrev?: null;
}

export interface ContractSignPayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  signer: string;
}

export interface ContractActivatePayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  escrowId?: string;
}

export interface ContractNegotiatePayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  terms: Record<string, unknown>;
  notes?: string;
}

export interface ContractNegotiateAcceptPayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  notes?: string;
}

export interface ContractMilestoneSubmitPayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  milestoneId: string;
  submissionId: string;
  notes?: string;
}

export interface ContractMilestoneReviewPayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  milestoneId: string;
  notes?: string;
}

export interface ContractCompletePayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
}

export interface ContractDisputeOpenPayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  reason: string;
  description?: string;
  evidence?: Record<string, unknown>[];
}

export interface ContractDisputeResolvePayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  resolution: string;
  notes?: string;
}

export interface ContractSettlementPayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  settlement: Record<string, unknown>;
  notes?: string;
}

export interface ContractTerminatePayload extends Record<string, unknown> {
  contractId: string;
  resourcePrev: string;
  reason: string;
}

export interface ContractCreateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  parties: ContractParties;
  service: Record<string, unknown>;
  terms: Record<string, unknown>;
  payment: Record<string, unknown>;
  timeline: Record<string, unknown>;
  milestones?: ContractMilestone[];
  attachments?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractSignEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  signer: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractActivateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  escrowId?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractNegotiateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  terms: Record<string, unknown>;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractNegotiateAcceptEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractMilestoneSubmitEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  milestoneId: string;
  submissionId: string;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractMilestoneReviewEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  milestoneId: string;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractCompleteEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractDisputeOpenEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  reason: string;
  description?: string;
  evidence?: Record<string, unknown>[];
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractDisputeResolveEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  resolution: string;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractSettlementEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  settlement: Record<string, unknown>;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface ContractTerminateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  contractId: string;
  resourcePrev: string;
  reason: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export function parseContractCreatePayload(payload: Record<string, unknown>): ContractCreatePayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const parties = parseParties(payload.parties);
  const service = assertRecord(payload.service, 'service');
  const terms = assertRecord(payload.terms, 'terms');
  const payment = assertRecord(payload.payment, 'payment');
  const timeline = assertRecord(payload.timeline, 'timeline');
  const milestones = parseMilestones(payload.milestones);
  const attachments = payload.attachments
    ? (Array.isArray(payload.attachments) ? payload.attachments.map((entry, index) => {
      return assertRecord(entry, `attachments[${index}]`);
    }) : (() => { throw new Error('attachments must be an array'); })())
    : undefined;
  const metadata = payload.metadata
    ? assertRecord(payload.metadata, 'metadata')
    : undefined;
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for contract create');
  }
  return {
    contractId,
    parties,
    service,
    terms,
    payment,
    timeline,
    milestones,
    attachments,
    metadata,
    resourcePrev: undefined,
  };
}

export function parseContractSignPayload(payload: Record<string, unknown>): ContractSignPayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const signer = String(payload.signer ?? '');
  assertValidDid(signer, 'signer');
  return {
    contractId,
    resourcePrev,
    signer,
  };
}

export function parseContractActivatePayload(payload: Record<string, unknown>): ContractActivatePayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const escrowId = payload.escrowId !== undefined ? String(payload.escrowId) : undefined;
  return {
    contractId,
    resourcePrev,
    escrowId,
  };
}

export function parseContractNegotiatePayload(payload: Record<string, unknown>): ContractNegotiatePayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const terms = assertRecord(payload.terms, 'terms');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    contractId,
    resourcePrev,
    terms,
    notes,
  };
}

export function parseContractNegotiateAcceptPayload(
  payload: Record<string, unknown>,
): ContractNegotiateAcceptPayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    contractId,
    resourcePrev,
    notes,
  };
}

export function parseContractMilestoneSubmitPayload(
  payload: Record<string, unknown>,
): ContractMilestoneSubmitPayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const milestoneId = String(payload.milestoneId ?? '');
  requireNonEmpty(milestoneId, 'milestoneId');
  const submissionId = String(payload.submissionId ?? '');
  requireNonEmpty(submissionId, 'submissionId');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    contractId,
    resourcePrev,
    milestoneId,
    submissionId,
    notes,
  };
}

export function parseContractMilestoneReviewPayload(
  payload: Record<string, unknown>,
): ContractMilestoneReviewPayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const milestoneId = String(payload.milestoneId ?? '');
  requireNonEmpty(milestoneId, 'milestoneId');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    contractId,
    resourcePrev,
    milestoneId,
    notes,
  };
}

export function parseContractCompletePayload(payload: Record<string, unknown>): ContractCompletePayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  return {
    contractId,
    resourcePrev,
  };
}

export function parseContractDisputeOpenPayload(
  payload: Record<string, unknown>,
): ContractDisputeOpenPayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const reason = String(payload.reason ?? '').trim();
  requireNonEmpty(reason, 'reason');
  const description = typeof payload.description === 'string' ? payload.description : undefined;
  let evidence: Record<string, unknown>[] | undefined;
  if (payload.evidence !== undefined) {
    if (!Array.isArray(payload.evidence)) {
      throw new Error('evidence must be an array');
    }
    evidence = payload.evidence.map((entry, index) => assertRecord(entry, `evidence[${index}]`));
  }
  return {
    contractId,
    resourcePrev,
    reason,
    description,
    evidence,
  };
}

export function parseContractDisputeResolvePayload(
  payload: Record<string, unknown>,
): ContractDisputeResolvePayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const resolution = String(payload.resolution ?? '').trim();
  requireNonEmpty(resolution, 'resolution');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    contractId,
    resourcePrev,
    resolution,
    notes,
  };
}

export function parseContractSettlementPayload(
  payload: Record<string, unknown>,
): ContractSettlementPayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const settlement = assertRecord(payload.settlement, 'settlement');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    contractId,
    resourcePrev,
    settlement,
    notes,
  };
}

export function parseContractTerminatePayload(
  payload: Record<string, unknown>,
): ContractTerminatePayload {
  const contractId = String(payload.contractId ?? '');
  requireNonEmpty(contractId, 'contractId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const reason = String(payload.reason ?? '').trim();
  requireNonEmpty(reason, 'reason');
  return {
    contractId,
    resourcePrev,
    reason,
  };
}

export async function createContractCreateEnvelope(
  params: ContractCreateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  if (params.parties.client.did !== params.issuer) {
    throw new Error('issuer must match parties.client.did');
  }
  const payload = parseContractCreatePayload({
    contractId: params.contractId,
    parties: params.parties,
    service: params.service,
    terms: params.terms,
    payment: params.payment,
    timeline: params.timeline,
    milestones: params.milestones,
    attachments: params.attachments,
    metadata: params.metadata,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.create',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractSignEnvelope(
  params: ContractSignEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  if (params.signer !== params.issuer) {
    throw new Error('issuer must match signer');
  }
  const payload = parseContractSignPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    signer: params.signer,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.sign',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractActivateEnvelope(
  params: ContractActivateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractActivatePayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    escrowId: params.escrowId,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.activate',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractNegotiateOfferEnvelope(
  params: ContractNegotiateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractNegotiatePayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    terms: params.terms,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.negotiate.offer',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractNegotiateCounterEnvelope(
  params: ContractNegotiateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractNegotiatePayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    terms: params.terms,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.negotiate.counter',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractNegotiateAcceptEnvelope(
  params: ContractNegotiateAcceptEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractNegotiateAcceptPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.negotiate.accept',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractMilestoneSubmitEnvelope(
  params: ContractMilestoneSubmitEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractMilestoneSubmitPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    milestoneId: params.milestoneId,
    submissionId: params.submissionId,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.milestone.submit',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractMilestoneApproveEnvelope(
  params: ContractMilestoneReviewEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractMilestoneReviewPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    milestoneId: params.milestoneId,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.milestone.approve',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractMilestoneRejectEnvelope(
  params: ContractMilestoneReviewEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractMilestoneReviewPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    milestoneId: params.milestoneId,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.milestone.reject',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractCompleteEnvelope(
  params: ContractCompleteEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractCompletePayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.complete',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractDisputeOpenEnvelope(
  params: ContractDisputeOpenEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractDisputeOpenPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    reason: params.reason,
    description: params.description,
    evidence: params.evidence,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.dispute.open',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractDisputeResolveEnvelope(
  params: ContractDisputeResolveEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractDisputeResolvePayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    resolution: params.resolution,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.dispute.resolve',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractSettlementExecuteEnvelope(
  params: ContractSettlementEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractSettlementPayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    settlement: params.settlement,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.settlement.execute',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createContractTerminateEnvelope(
  params: ContractTerminateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseContractTerminatePayload({
    contractId: params.contractId,
    resourcePrev: params.resourcePrev,
    reason: params.reason,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'contract.terminate',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export function buildContractSnapshot(
  contract: ServiceContract,
): ServiceContract {
  return JSON.parse(JSON.stringify(contract)) as ServiceContract;
}
