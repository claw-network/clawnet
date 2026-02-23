/**
 * Service contract routes — /api/v1/contracts
 */

import { Router } from '../router.js';
import {
  ok, created, badRequest, notFound, internalError,
  paginated, parsePagination,
} from '../response.js';
import { validate } from '../schemas/common.js';
import {
  ContractCreateSchema, ContractSignSchema, ContractFundSchema,
  ContractCompleteSchema, ContractMilestoneSubmitSchema,
  ContractMilestoneReviewSchema, ContractDisputeSchema,
  ContractDisputeResolveSchema, ContractSettlementSchema,
} from '../schemas/contracts.js';
import type { RuntimeContext } from '../types.js';
import {
  resolveAddress, resolvePrivateKey, addressFromDid, buildContractView,
} from '../types.js';
import {
  createContractCreateEnvelope,
  createContractSignEnvelope,
  createContractActivateEnvelope,
  createContractCompleteEnvelope,
  createContractDisputeOpenEnvelope,
  createContractDisputeResolveEnvelope,
  createContractMilestoneSubmitEnvelope,
  createContractMilestoneApproveEnvelope,
  createContractMilestoneRejectEnvelope,
  createContractSettlementExecuteEnvelope,
  applyContractEvent,
  createContractState,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  type ServiceContract,
  type ContractParties,
  type ContractMilestone,
} from '@claw-network/protocol';

export function contractRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── Helper: rebuild contract state from eventStore ────────────
  async function getContractFromStore(contractId: string): Promise<ServiceContract | null> {
    if (!ctx.contractStore) return null;
    return (await ctx.contractStore.getContract(contractId)) ?? null;
  }

  // ── POST / — create contract ──────────────────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(ContractCreateSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;
    const contractId = body.contractId ?? `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const providerAddr = resolveAddress(body.provider);
    if (!providerAddr) { badRequest(res, 'Invalid provider', route.url.pathname); return; }

    // On-chain
    if (ctx.contractsService) {
      try {
        const terms = (body.terms ?? {}) as Record<string, unknown>;
        const payment = (body.payment ?? {}) as Record<string, unknown>;
        const milestones = (body.milestones ?? []) as Record<string, unknown>[];
        const result = await ctx.contractsService.createContract({
          contractId, provider: providerAddr,
          arbiter: resolveAddress(body.did) ?? '',
          totalAmount: Number(payment.total ?? terms.total ?? 0),
          termsHash: JSON.stringify(terms),
          deadline: ((body.timeline as Record<string, unknown> | undefined)?.deadline as number) ?? 0,
          milestoneAmounts: milestones.map((m) => Number(m.amount ?? 0)),
          milestoneDeadlines: milestones.map((m) => Number(m.deadline ?? 0)),
        });
        created(res, result, { self: `/api/v1/contracts/${contractId}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    // Legacy
    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const parties = (body.parties ?? { client: { did: body.did }, provider: { did: body.provider } }) as unknown as ContractParties;
      const envelope = await createContractCreateEnvelope({
        issuer: body.did, privateKey, contractId,
        parties,
        service: (body.service ?? {}) as Record<string, unknown>,
        terms: (body.terms ?? {}) as Record<string, unknown>,
        payment: (body.payment ?? {}) as Record<string, unknown>,
        timeline: (body.timeline ?? {}) as Record<string, unknown>,
        milestones: body.milestones as ContractMilestone[] | undefined,
        attachments: body.attachments as Record<string, unknown>[] | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      const state = applyContractEvent(createContractState(), envelope as never);
      const resultContract = state.contracts[contractId];
      const view = resultContract ? buildContractView(resultContract) : { contractId, txHash: hash };
      created(res, view, { self: `/api/v1/contracts/${contractId}` });
    } catch { internalError(res, 'Contract creation failed'); }
  });

  // ── GET / — list contracts ────────────────────────────────────
  r.get('/', async (_req, res, route) => {
    const { page, perPage, offset } = parsePagination(route.query);
    const party = route.query.get('party') ?? route.query.get('did');
    const status = route.query.get('status');

    if (ctx.contractStore) {
      try {
        const all = await ctx.contractStore.listContracts();
        let filtered = all;
        if (party) filtered = filtered.filter((c) => c.parties.client.did === party || c.parties.provider.did === party);
        if (status) filtered = filtered.filter((c) => c.status === status);
        const total = filtered.length;
        const sliced = filtered.slice(offset, offset + perPage);
        paginated(res, sliced.map(buildContractView), {
          page, perPage, total, basePath: '/api/v1/contracts',
        });
        return;
      } catch { /* fallthrough */ }
    }

    // If no store, return empty
    paginated(res, [], { page, perPage, total: 0, basePath: '/api/v1/contracts' });
  });

  // ── GET /:id — single contract ────────────────────────────────
  r.get('/:id', async (_req, res, route) => {
    const { id } = route.params;
    const contract = await getContractFromStore(id);
    if (!contract) { notFound(res, `Contract ${id} not found`); return; }
    ok(res, buildContractView(contract), { self: `/api/v1/contracts/${id}` });
  });

  // ── POST /:id/actions/sign — sign contract ────────────────────
  r.post('/:id/actions/sign', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ContractSignSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const result = await ctx.contractsService.signContract(id);
        ok(res, result, { self: `/api/v1/contracts/${id}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractSignEnvelope({
        issuer: body.did, privateKey, contractId: id,
        resourcePrev: body.prev ?? '', signer: body.did,
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, status: 'signed', timestamp: body.ts ?? Date.now() },
        { self: `/api/v1/contracts/${id}` });
    } catch { internalError(res, 'Contract sign failed'); }
  });

  // ── POST /:id/actions/activate — fund & activate ──────────────
  r.post('/:id/actions/activate', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ContractFundSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const result = await ctx.contractsService.activateContract(id);
        ok(res, result, { self: `/api/v1/contracts/${id}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      // 3 envelopes: escrow create → escrow fund → activate
      const escrowId = body.escrowId ?? `escrow-${id}-${Date.now()}`;
      const ts = body.ts ?? Date.now();
      const nonce = body.nonce ?? 0;
      const e1 = await createWalletEscrowCreateEnvelope({
        issuer: body.did, privateKey, escrowId,
        depositor: body.did, beneficiary: body.did,
        amount: String(body.amount),
        releaseRules: body.releaseRules ?? [{ type: 'manual' }],
        ts, nonce, prev: body.prev,
      });
      const h1 = await ctx.publishEvent(e1);

      const e2 = await createWalletEscrowFundEnvelope({
        issuer: body.did, privateKey, escrowId, amount: String(body.amount),
        resourcePrev: h1, ts: ts + 1,
        nonce: nonce + 1,
        prev: h1,
      });
      const h2 = await ctx.publishEvent(e2);

      const e3 = await createContractActivateEnvelope({
        issuer: body.did, privateKey, contractId: id,
        escrowId, resourcePrev: h2, ts: ts + 2,
        nonce: nonce + 2,
        prev: h2,
      });
      const h3 = await ctx.publishEvent(e3);
      ok(res, {
        txHash: h3, contractId: id, escrowId, status: 'activated',
        timestamp: ts,
      }, { self: `/api/v1/contracts/${id}` });
    } catch { internalError(res, 'Contract activation failed'); }
  });

  // ── POST /:id/actions/complete ────────────────────────────────
  r.post('/:id/actions/complete', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ContractCompleteSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const result = await ctx.contractsService.completeContract(id);
        ok(res, result, { self: `/api/v1/contracts/${id}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractCompleteEnvelope({
        issuer: body.did, privateKey, contractId: id,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, status: 'completed', timestamp: body.ts ?? Date.now() },
        { self: `/api/v1/contracts/${id}` });
    } catch { internalError(res, 'Contract complete failed'); }
  });

  // ── POST /:id/actions/terminate ───────────────────────────────
  r.post('/:id/actions/terminate', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ContractSettlementSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const result = await ctx.contractsService.terminateContract(id, body.notes ?? '');
        ok(res, result, { self: `/api/v1/contracts/${id}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractSettlementExecuteEnvelope({
        issuer: body.did, privateKey, contractId: id,
        settlement: body.settlement, notes: body.notes,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, status: 'terminated', timestamp: body.ts ?? Date.now() },
        { self: `/api/v1/contracts/${id}` });
    } catch { internalError(res, 'Contract terminate failed'); }
  });

  // ── POST /:id/actions/dispute ─────────────────────────────────
  r.post('/:id/actions/dispute', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ContractDisputeSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const result = await ctx.contractsService.disputeContract(
          id, body.evidence ? JSON.stringify(body.evidence) : (body.reason ?? ''),
        );
        ok(res, result, { self: `/api/v1/contracts/${id}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractDisputeOpenEnvelope({
        issuer: body.did, privateKey, contractId: id,
        reason: body.reason, description: body.description,
        evidence: body.evidence, resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, {
        id: `dispute-${id}`, contractId: id, initiator: body.did,
        reason: body.reason, status: 'open', txHash: hash,
        createdAt: body.ts ?? Date.now(),
      }, { self: `/api/v1/contracts/${id}` });
    } catch { internalError(res, 'Contract dispute failed'); }
  });

  // ── POST /:id/actions/resolve ─────────────────────────────────
  r.post('/:id/actions/resolve', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ContractDisputeResolveSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const resolutionMap: Record<string, number> = {
          favor_provider: 0, favor_client: 1, resume: 2,
        };
        const result = await ctx.contractsService.resolveDispute(
          id, resolutionMap[body.resolution] ?? 0,
        );
        ok(res, result, { self: `/api/v1/contracts/${id}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractDisputeResolveEnvelope({
        issuer: body.did, privateKey, contractId: id,
        resolution: body.resolution, notes: body.notes,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, resolution: body.resolution, status: 'resolved',
        timestamp: body.ts ?? Date.now() }, { self: `/api/v1/contracts/${id}` });
    } catch { internalError(res, 'Contract dispute resolve failed'); }
  });

  // ── GET /:id/milestones — list milestones ─────────────────────
  r.get('/:id/milestones', async (_req, res, route) => {
    const { id } = route.params;
    const contract = await getContractFromStore(id);
    if (!contract) { notFound(res, `Contract ${id} not found`); return; }
    ok(res, contract.milestones ?? [], { self: `/api/v1/contracts/${id}/milestones` });
  });

  // ── GET /:id/milestones/:idx ──────────────────────────────────
  r.get('/:id/milestones/:idx', async (_req, res, route) => {
    const { id, idx } = route.params;
    const index = Number(idx);
    const contract = await getContractFromStore(id);
    if (!contract) { notFound(res, `Contract ${id} not found`); return; }
    const ms = contract.milestones?.[index];
    if (!ms) { notFound(res, `Milestone ${idx} not found`); return; }
    ok(res, ms, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
  });

  // ── POST /:id/milestones/:idx/actions/submit ──────────────────
  r.post('/:id/milestones/:idx/actions/submit', async (_req, res, route) => {
    const { id, idx } = route.params;
    const index = Number(idx);
    const v = validate(ContractMilestoneSubmitSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const deliverable = body.deliverables ? JSON.stringify(body.deliverables) : (body.notes ?? '');
        const result = await ctx.contractsService.submitMilestone(id, index, deliverable);
        ok(res, result, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractMilestoneSubmitEnvelope({
        issuer: body.did, privateKey, contractId: id,
        milestoneId: String(index), submissionId: body.submissionId ?? '',
        notes: body.notes,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, milestoneIndex: index, status: 'submitted',
        timestamp: body.ts ?? Date.now() }, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
    } catch { internalError(res, 'Milestone submit failed'); }
  });

  // ── POST /:id/milestones/:idx/actions/approve ─────────────────
  r.post('/:id/milestones/:idx/actions/approve', async (_req, res, route) => {
    const { id, idx } = route.params;
    const index = Number(idx);
    const v = validate(ContractMilestoneReviewSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const result = await ctx.contractsService.approveMilestone(id, index);
        ok(res, result, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractMilestoneApproveEnvelope({
        issuer: body.did, privateKey, contractId: id,
        milestoneId: String(index), notes: body.notes,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, milestoneIndex: index, status: 'approved',
        timestamp: body.ts ?? Date.now() }, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
    } catch { internalError(res, 'Milestone approve failed'); }
  });

  // ── POST /:id/milestones/:idx/actions/reject ──────────────────
  r.post('/:id/milestones/:idx/actions/reject', async (_req, res, route) => {
    const { id, idx } = route.params;
    const index = Number(idx);
    const v = validate(ContractMilestoneReviewSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    if (ctx.contractsService) {
      try {
        const reason = body.feedback ?? body.notes ?? '';
        const result = await ctx.contractsService.rejectMilestone(id, index, reason);
        ok(res, result, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createContractMilestoneRejectEnvelope({
        issuer: body.did, privateKey, contractId: id,
        milestoneId: String(index), notes: body.feedback ?? body.notes,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, contractId: id, milestoneIndex: index, status: 'rejected',
        timestamp: body.ts ?? Date.now() }, { self: `/api/v1/contracts/${id}/milestones/${idx}` });
    } catch { internalError(res, 'Milestone reject failed'); }
  });

  return r;
}
