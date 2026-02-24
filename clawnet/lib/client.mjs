/**
 * ClawNet Agent Client — HTTP wrapper for a single ClawNet node.
 * Each Agent instance represents one independent AI Agent with its own identity.
 *
 * All endpoints target the v1 RESTful API:
 *   /api/v1/<resources>/:id/actions/<verb>
 */
import http from 'node:http';

const API = '/api/v1';

export class Agent {
  /**
   * @param {string} name       Human-readable name (alice, bob, ...)
   * @param {string} baseUrl    Node API URL (http://localhost:9600)
   * @param {string} passphrase Node CLAW_PASSPHRASE
   */
  constructor(name, baseUrl, passphrase) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.passphrase = passphrase;
    this.did = null;    // resolved on init
    this.address = null;
  }

  // ── HTTP primitives ─────────────────────────────────────────────────

  request(path, method = 'GET', body = null, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs,
      };
      const req = http.request(opts, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : null;
            // Auto-unwrap the v1 response envelope { data, meta?, links? }
            // so callers see the inner payload directly, with meta/links as extras.
            if (parsed && typeof parsed === 'object' && 'data' in parsed) {
              resolve({
                status: res.statusCode,
                data: parsed.data,
                meta: parsed.meta || null,
                links: parsed.links || null,
              });
            } else {
              resolve({ status: res.statusCode, data: parsed });
            }
          } catch {
            resolve({ status: res.statusCode, data: body, raw: true });
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`${this.name}: timeout ${method} ${path}`)); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  get(path)              { return this.request(path, 'GET'); }
  post(path, body)       { return this.request(path, 'POST', body); }
  del(path, body = null) { return this.request(path, 'DELETE', body); }

  /** POST with DID + passphrase auto-injected */
  act(path, body = {}) {
    return this.post(path, {
      did: this.did,
      passphrase: this.passphrase,
      nonce: Date.now(),
      ...body,
    });
  }

  // ── Identity ────────────────────────────────────────────────────────

  async init() {
    const { data } = await this.get(`${API}/identities/self`);
    this.did = data?.did || data?.identity?.did;
    if (!this.did) throw new Error(`${this.name}: cannot resolve DID`);
    // Derive address from node status if available
    const status = await this.get(`${API}/node`);
    this.address = status.data?.address || null;
    return this;
  }

  // ── Wallet ──────────────────────────────────────────────────────────

  async faucet(amount = 100000) {
    return this.post(`${API}/dev/faucet`, { did: this.did, amount });
  }

  async balance(did = null) {
    const target = did || this.did;
    return this.get(`${API}/wallets/${encodeURIComponent(target)}`);
  }

  async transfer(toDid, amount, memo = '') {
    return this.act(`${API}/transfers`, { to: toDid, amount, fee: 1, memo });
  }

  async history(page = 1, perPage = 50) {
    const addr = encodeURIComponent(this.did);
    return this.get(`${API}/wallets/${addr}/transactions?page=${page}&per_page=${perPage}`);
  }

  // ── Escrow ──────────────────────────────────────────────────────────

  async createEscrow(beneficiaryDid, amount, releaseRules = [{ type: 'manual', ruleId: 'manual' }]) {
    return this.act(`${API}/escrows`, {
      beneficiary: beneficiaryDid,
      amount,
      releaseRules,
      autoFund: true,
    });
  }

  async listEscrows() {
    return this.get(`${API}/escrows?did=${encodeURIComponent(this.did)}`);
  }

  async getEscrow(id) {
    return this.get(`${API}/escrows/${encodeURIComponent(id)}`);
  }

  async releaseEscrow(id, amount) {
    return this.act(`${API}/escrows/${encodeURIComponent(id)}/actions/release`, { amount });
  }

  async refundEscrow(id) {
    return this.act(`${API}/escrows/${encodeURIComponent(id)}/actions/refund`);
  }

  // ── Reputation ──────────────────────────────────────────────────────

  async submitReputation(targetDid, dimension, score, comment = '', ref = 'clawnet-scenario') {
    return this.act(`${API}/reputations/${encodeURIComponent(targetDid)}/reviews`, {
      target: targetDid,
      dimension,
      score,
      comment,
      ref,
    });
  }

  async getReputation(did) {
    return this.get(`${API}/reputations/${encodeURIComponent(did)}`);
  }

  async getReviews(did, page = 1) {
    return this.get(`${API}/reputations/${encodeURIComponent(did)}/reviews?page=${page}`);
  }

  // ── Info Market ─────────────────────────────────────────────────────

  async publishInfo(listing) {
    return this.act(`${API}/markets/info`, listing);
  }

  async searchInfo(query = '') {
    const q = typeof query === 'string' ? query : (query?.query || '');
    return this.get(`${API}/markets/info?keyword=${encodeURIComponent(q)}`);
  }

  async getInfoListing(id) {
    return this.get(`${API}/markets/info/${encodeURIComponent(id)}`);
  }

  async purchaseInfo(id) {
    return this.act(`${API}/markets/info/${encodeURIComponent(id)}/actions/purchase`);
  }

  async deliverInfo(id, body = {}) {
    return this.act(`${API}/markets/info/${encodeURIComponent(id)}/actions/deliver`, body);
  }

  async confirmInfo(id) {
    return this.act(`${API}/markets/info/${encodeURIComponent(id)}/actions/confirm`);
  }

  async reviewInfo(id, rating, comment = '') {
    return this.act(`${API}/markets/info/${encodeURIComponent(id)}/actions/review`, {
      rating, comment,
    });
  }

  async removeInfo(id) {
    return this.act(`${API}/markets/info/${encodeURIComponent(id)}/actions/remove`);
  }

  // ── Task Market ─────────────────────────────────────────────────────

  async publishTask(listing) {
    return this.act(`${API}/markets/tasks`, listing);
  }

  async searchTasks(query = '') {
    return this.get(`${API}/markets/tasks?keyword=${encodeURIComponent(query)}`);
  }

  async getTask(id) {
    return this.get(`${API}/markets/tasks/${encodeURIComponent(id)}`);
  }

  async getTaskBids(taskId) {
    return this.get(`${API}/markets/tasks/${encodeURIComponent(taskId)}/bids`);
  }

  async submitBid(taskId, bid) {
    return this.act(`${API}/markets/tasks/${encodeURIComponent(taskId)}/bids`, bid);
  }

  /** Alias with friendly params */
  async bidOnTask(taskId, { price, amount, timeline, approach, proposal, ...rest } = {}) {
    return this.submitBid(taskId, {
      price: price ?? amount,
      timeline: typeof timeline === 'number' ? timeline : 48,
      approach: approach || proposal || 'Proposed approach',
      ...rest,
    });
  }

  async acceptBid(taskId, bidId) {
    return this.act(
      `${API}/markets/tasks/${encodeURIComponent(taskId)}/bids/${encodeURIComponent(bidId)}/actions/accept`,
      { bidId, releaseRules: [{ type: 'manual', ruleId: 'task-complete' }] },
    );
  }

  async rejectBid(taskId, bidId) {
    return this.act(
      `${API}/markets/tasks/${encodeURIComponent(taskId)}/bids/${encodeURIComponent(bidId)}/actions/reject`,
      { bidId },
    );
  }

  async deliverTask(taskId, { orderId, deliverables, deliveryNote, artifacts, notes, ...rest } = {}) {
    return this.act(`${API}/markets/tasks/${encodeURIComponent(taskId)}/actions/deliver`, {
      orderId: orderId || taskId,
      deliverables: deliverables || artifacts?.map(a => ({ ...a })) || [{ type: 'document', note: deliveryNote || 'Delivered' }],
      notes: notes || deliveryNote || '',
      ...rest,
    });
  }

  async confirmTask(taskId, { orderId, submissionId, approved, feedback, ...rest } = {}) {
    return this.act(`${API}/markets/tasks/${encodeURIComponent(taskId)}/actions/confirm`, {
      orderId: orderId || taskId,
      submissionId: submissionId || 'submission-default',
      approved: approved !== false,
      feedback: feedback || 'Confirmed',
      ...rest,
    });
  }

  /** Alias */
  async confirmDelivery(taskId, opts = {}) {
    return this.confirmTask(taskId, opts);
  }

  async reviewTask(taskId, rating, comment = '') {
    return this.act(`${API}/markets/tasks/${encodeURIComponent(taskId)}/actions/review`, {
      rating, comment,
    });
  }

  async removeTask(id) {
    return this.act(`${API}/markets/tasks/${encodeURIComponent(id)}/actions/remove`);
  }

  // ── Capability Market ───────────────────────────────────────────────

  async publishCapability(listing) {
    return this.act(`${API}/markets/capabilities`, listing);
  }

  async searchCapabilities(query = '') {
    return this.get(`${API}/markets/capabilities?keyword=${encodeURIComponent(query)}`);
  }

  async getCapability(id) {
    return this.get(`${API}/markets/capabilities/${encodeURIComponent(id)}`);
  }

  async leaseCapability(id, plan = { type: 'pay_per_use' }) {
    return this.act(`${API}/markets/capabilities/${encodeURIComponent(id)}/leases`, { plan });
  }

  async invokeLease(leaseId, body = {}) {
    return this.act(`${API}/markets/capabilities/leases/${encodeURIComponent(leaseId)}/actions/invoke`, body);
  }

  async terminateLease(leaseId) {
    return this.act(`${API}/markets/capabilities/leases/${encodeURIComponent(leaseId)}/actions/terminate`);
  }

  async removeCapability(id) {
    return this.act(`${API}/markets/capabilities/${encodeURIComponent(id)}/actions/remove`);
  }

  // ── Service Contracts ───────────────────────────────────────────────

  async createContract(contract) {
    return this.act(`${API}/contracts`, contract);
  }

  async getContract(id) {
    return this.get(`${API}/contracts/${encodeURIComponent(id)}`);
  }

  async listContracts() {
    return this.get(`${API}/contracts?did=${encodeURIComponent(this.did)}`);
  }

  async signContract(id) {
    return this.act(`${API}/contracts/${encodeURIComponent(id)}/actions/sign`);
  }

  async fundContract(id, amount) {
    return this.act(`${API}/contracts/${encodeURIComponent(id)}/actions/activate`, { amount });
  }

  async completeContract(id) {
    return this.act(`${API}/contracts/${encodeURIComponent(id)}/actions/complete`);
  }

  async submitMilestone(contractId, milestoneIdx, body = {}) {
    return this.act(
      `${API}/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneIdx)}/actions/submit`,
      body,
    );
  }

  async approveMilestone(contractId, milestoneIdx) {
    return this.act(
      `${API}/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneIdx)}/actions/approve`,
    );
  }

  async rejectMilestone(contractId, milestoneIdx, body = {}) {
    const data = typeof body === 'string' ? { reason: body } : body;
    return this.act(
      `${API}/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneIdx)}/actions/reject`,
      data,
    );
  }

  async openDispute(contractId, body = {}) {
    const data = typeof body === 'string' ? { reason: body } : body;
    return this.act(`${API}/contracts/${encodeURIComponent(contractId)}/actions/dispute`, data);
  }

  async resolveDispute(contractId, resolution = {}) {
    return this.act(`${API}/contracts/${encodeURIComponent(contractId)}/actions/resolve`, resolution);
  }

  // ── DAO ─────────────────────────────────────────────────────────────

  async depositTreasury(amount, source = 'agent contribution') {
    return this.act(`${API}/dao/treasury/deposits`, { amount, source });
  }

  async createProposal(proposal) {
    return this.act(`${API}/dao/proposals`, proposal);
  }

  async getProposal(id) {
    return this.get(`${API}/dao/proposals/${encodeURIComponent(id)}`);
  }

  async listProposals() {
    return this.get(`${API}/dao/proposals`);
  }

  async advanceProposal(proposalId, newStatus, resourcePrev) {
    return this.act(`${API}/dao/proposals/${encodeURIComponent(proposalId)}/actions/advance`, {
      proposalId, newStatus, resourcePrev,
    });
  }

  async getProposalVotes(proposalId) {
    return this.get(`${API}/dao/proposals/${encodeURIComponent(proposalId)}/votes`);
  }

  async getDaoParams() {
    return this.get(`${API}/dao/params`);
  }

  async getDelegations(did) {
    return this.get(`${API}/dao/delegations?did=${encodeURIComponent(did)}`);
  }

  async vote(proposalId, option, power = '100') {
    return this.act(`${API}/dao/proposals/${encodeURIComponent(proposalId)}/votes`, {
      proposalId, option, power,
    });
  }

  async delegate(delegateDid, scope = { all: true }) {
    return this.act(`${API}/dao/delegations`, { delegate: delegateDid, scope });
  }

  async revokeDelegate(delegateDid) {
    // Server supports both DELETE and POST compat alias on /api/v1/dao/delegations/:delegate
    return this.act(`${API}/dao/delegations/${encodeURIComponent(delegateDid)}`, {
      delegate: delegateDid,
    });
  }

  async getTreasury() {
    return this.get(`${API}/dao/treasury`);
  }

  // ── Node Info ───────────────────────────────────────────────────────

  async status() {
    return this.get(`${API}/node`);
  }

  async peers() {
    return this.get(`${API}/node/peers`);
  }

  toString() {
    return `[${this.name}] ${this.did || '(not init)'}`;
  }
}
