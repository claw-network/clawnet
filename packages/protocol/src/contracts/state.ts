import { EventEnvelope, eventHashHex } from '@clawtoken/core/protocol';
import {
  ContractDispute,
  ContractMilestone,
  ContractMilestoneReview,
  ContractMilestoneSubmission,
  ContractParties,
  ContractSignature,
  ContractStatus,
  ServiceContract,
} from './types.js';
import {
  ContractActivatePayload,
  ContractCompletePayload,
  ContractCreatePayload,
  ContractDisputeOpenPayload,
  ContractDisputeResolvePayload,
  ContractMilestoneReviewPayload,
  ContractMilestoneSubmitPayload,
  ContractNegotiateAcceptPayload,
  ContractNegotiatePayload,
  ContractSettlementPayload,
  ContractSignPayload,
  ContractTerminatePayload,
  parseContractActivatePayload,
  parseContractCompletePayload,
  parseContractCreatePayload,
  parseContractDisputeOpenPayload,
  parseContractDisputeResolvePayload,
  parseContractMilestoneReviewPayload,
  parseContractMilestoneSubmitPayload,
  parseContractNegotiateAcceptPayload,
  parseContractNegotiatePayload,
  parseContractSettlementPayload,
  parseContractSignPayload,
  parseContractTerminatePayload,
} from './events.js';

export interface ContractHistoryEntry {
  hash: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface ContractState {
  contracts: Record<string, ServiceContract>;
  contractEvents: Record<string, string>;
  history: ContractHistoryEntry[];
}

export function createContractState(): ContractState {
  return {
    contracts: {},
    contractEvents: {},
    history: [],
  };
}

function cloneState(state: ContractState): ContractState {
  return {
    contracts: { ...state.contracts },
    contractEvents: { ...state.contractEvents },
    history: [...state.history],
  };
}

function requireResourcePrev(current: string | undefined, provided: string, field: string): void {
  if (!current) {
    throw new Error(`${field} has no previous event`);
  }
  if (current !== provided) {
    throw new Error(`${field} resourcePrev does not match`);
  }
}

function resolvePartyDids(parties: ContractParties): string[] {
  const list = [parties.client.did, parties.provider.did];
  const add = (entries?: { did: string }[]) => {
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      list.push(entry.did);
    }
  };
  add(parties.subcontractors);
  add(parties.auditors);
  add(parties.arbiters);
  add(parties.guarantors);
  add(parties.witnesses);
  return list;
}

function isEscrowRequired(payment: Record<string, unknown>): boolean {
  const value = payment.escrowRequired ?? payment.escrow?.required;
  if (typeof value === 'boolean') {
    return value;
  }
  return true;
}

function applyContractCreate(
  state: ContractState,
  payload: ContractCreatePayload,
  hash: string,
  ts: number,
): void {
  if (state.contracts[payload.contractId]) {
    throw new Error('contract already exists');
  }
  const contract: ServiceContract = {
    id: payload.contractId,
    version: '1.0.0',
    parties: payload.parties,
    service: payload.service,
    terms: payload.terms,
    payment: payload.payment,
    timeline: payload.timeline,
    milestones: payload.milestones ?? [],
    status: 'draft',
    signatures: [],
    metadata: payload.metadata,
    attachments: payload.attachments,
    createdAt: ts,
    updatedAt: ts,
  };
  state.contracts[payload.contractId] = contract;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractNegotiate(
  state: ContractState,
  payload: ContractNegotiatePayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  contract.terms = payload.terms;
  contract.status = 'negotiating';
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractNegotiateAccept(
  state: ContractState,
  payload: ContractNegotiateAcceptPayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  contract.status = 'pending_signature';
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractSign(
  state: ContractState,
  payload: ContractSignPayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');

  const allowedSigners = new Set(resolvePartyDids(contract.parties));
  if (!allowedSigners.has(payload.signer)) {
    throw new Error('signer not authorized');
  }

  const existing = contract.signatures.find((sig) => sig.signer === payload.signer);
  if (!existing) {
    const signature: ContractSignature = {
      signer: payload.signer,
      signature: hash,
      signedAt: ts,
    };
    contract.signatures = [...contract.signatures, signature];
  }

  const clientSigned = contract.signatures.some((sig) => sig.signer === contract.parties.client.did);
  const providerSigned = contract.signatures.some(
    (sig) => sig.signer === contract.parties.provider.did,
  );
  if (clientSigned && providerSigned) {
    contract.status = isEscrowRequired(contract.payment) ? 'pending_funding' : 'active';
    if (contract.status === 'active' && !contract.activatedAt) {
      contract.activatedAt = ts;
    }
  } else {
    contract.status = 'pending_signature';
  }
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractActivate(
  state: ContractState,
  payload: ContractActivatePayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  contract.status = 'active';
  contract.activatedAt = ts;
  if (payload.escrowId) {
    contract.escrowId = payload.escrowId;
  }
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyMilestoneSubmit(
  state: ContractState,
  payload: ContractMilestoneSubmitPayload,
  hash: string,
  ts: number,
  actor: string,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  const milestone = contract.milestones.find((entry) => entry.id === payload.milestoneId);
  if (!milestone) {
    throw new Error('milestone not found');
  }
  milestone.status = 'submitted';
  milestone.submittedAt = ts;
  const submission: ContractMilestoneSubmission = {
    id: payload.submissionId,
    submittedBy: actor,
    submittedAt: ts,
    notes: payload.notes,
    status: 'pending',
  };
  milestone.submissions = [...(milestone.submissions ?? []), submission];
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyMilestoneReview(
  state: ContractState,
  payload: ContractMilestoneReviewPayload,
  hash: string,
  ts: number,
  actor: string,
  decision: ContractMilestoneReview['decision'],
  nextStatus: ContractMilestone['status'],
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  const milestone = contract.milestones.find((entry) => entry.id === payload.milestoneId);
  if (!milestone) {
    throw new Error('milestone not found');
  }
  milestone.status = nextStatus;
  if (nextStatus === 'approved') {
    milestone.approvedAt = ts;
  }
  const lastSubmission = milestone.submissions?.[milestone.submissions.length - 1];
  const review: ContractMilestoneReview = {
    id: `${payload.milestoneId}:${ts}`,
    submissionId: lastSubmission?.id ?? payload.milestoneId,
    reviewedBy: actor,
    reviewedAt: ts,
    decision,
    comments: payload.notes,
  };
  milestone.reviews = [...(milestone.reviews ?? []), review];

  if (contract.milestones.length > 0) {
    const allApproved = contract.milestones.every((entry) => entry.status === 'approved');
    if (allApproved) {
      contract.status = 'completed';
      contract.completedAt = ts;
    }
  }
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractComplete(
  state: ContractState,
  payload: ContractCompletePayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  contract.status = 'completed';
  contract.completedAt = ts;
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractDisputeOpen(
  state: ContractState,
  payload: ContractDisputeOpenPayload,
  hash: string,
  ts: number,
  actor: string,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  if (contract.dispute && contract.dispute.status !== 'resolved') {
    throw new Error('contract already disputed');
  }
  const dispute: ContractDispute = {
    reason: payload.reason,
    description: payload.description,
    evidence: payload.evidence,
    status: 'open',
    initiator: actor,
    openedAt: ts,
    prevStatus: contract.status,
  };
  contract.dispute = dispute;
  contract.status = 'disputed';
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractDisputeResolve(
  state: ContractState,
  payload: ContractDisputeResolvePayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  if (!contract.dispute || contract.dispute.status !== 'open') {
    throw new Error('contract dispute not open');
  }
  contract.dispute.status = 'resolved';
  contract.dispute.resolution = payload.resolution;
  contract.dispute.notes = payload.notes;
  contract.dispute.resolvedAt = ts;
  contract.status = contract.dispute.prevStatus ?? contract.status;
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractSettlement(
  state: ContractState,
  payload: ContractSettlementPayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  contract.metadata = {
    ...(contract.metadata ?? {}),
    settlement: payload.settlement,
    settlementNotes: payload.notes,
  };
  contract.updatedAt = ts;
  state.contractEvents[payload.contractId] = hash;
}

function applyContractTerminate(
  state: ContractState,
  payload: ContractTerminatePayload,
  hash: string,
  ts: number,
): void {
  const contract = state.contracts[payload.contractId];
  if (!contract) {
    throw new Error('contract not found');
  }
  requireResourcePrev(state.contractEvents[payload.contractId], payload.resourcePrev, 'contract');
  contract.status = 'terminated';
  contract.updatedAt = ts;
  contract.metadata = {
    ...(contract.metadata ?? {}),
    terminationReason: payload.reason,
  };
  state.contractEvents[payload.contractId] = hash;
}

export function applyContractEvent(state: ContractState, envelope: EventEnvelope): ContractState {
  const next = cloneState(state);
  const type = String(envelope.type ?? '');
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
  const hash =
    typeof envelope.hash === 'string' && envelope.hash.length > 0
      ? envelope.hash
      : eventHashHex(envelope);
  const issuer = typeof envelope.issuer === 'string' ? envelope.issuer : '';

  let applied = false;

  switch (type) {
    case 'contract.create': {
      const parsed = parseContractCreatePayload(payload);
      applyContractCreate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.negotiate.offer': {
      const parsed = parseContractNegotiatePayload(payload);
      applyContractNegotiate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.negotiate.counter': {
      const parsed = parseContractNegotiatePayload(payload);
      applyContractNegotiate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.negotiate.accept': {
      const parsed = parseContractNegotiateAcceptPayload(payload);
      applyContractNegotiateAccept(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.sign': {
      const parsed = parseContractSignPayload(payload);
      applyContractSign(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.activate': {
      const parsed = parseContractActivatePayload(payload);
      applyContractActivate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.milestone.submit': {
      const parsed = parseContractMilestoneSubmitPayload(payload);
      applyMilestoneSubmit(next, parsed, hash, ts, issuer);
      applied = true;
      break;
    }
    case 'contract.milestone.approve': {
      const parsed = parseContractMilestoneReviewPayload(payload);
      applyMilestoneReview(next, parsed, hash, ts, issuer, 'approve', 'approved');
      applied = true;
      break;
    }
    case 'contract.milestone.reject': {
      const parsed = parseContractMilestoneReviewPayload(payload);
      applyMilestoneReview(next, parsed, hash, ts, issuer, 'reject', 'rejected');
      applied = true;
      break;
    }
    case 'contract.complete': {
      const parsed = parseContractCompletePayload(payload);
      applyContractComplete(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.dispute.open': {
      const parsed = parseContractDisputeOpenPayload(payload);
      applyContractDisputeOpen(next, parsed, hash, ts, issuer);
      applied = true;
      break;
    }
    case 'contract.dispute.resolve': {
      const parsed = parseContractDisputeResolvePayload(payload);
      applyContractDisputeResolve(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.settlement.execute': {
      const parsed = parseContractSettlementPayload(payload);
      applyContractSettlement(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'contract.terminate': {
      const parsed = parseContractTerminatePayload(payload);
      applyContractTerminate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    default: {
      return next;
    }
  }

  if (applied) {
    next.history.push({
      hash,
      type,
      ts,
      payload,
    });
  }

  return next;
}
