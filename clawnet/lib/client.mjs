/**
 * ClawNet Agent Client — HTTP wrapper for a single ClawNet node.
 * Each Agent instance represents one independent AI Agent with its own identity.
 */
import http from 'node:http';

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
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, data, raw: true });
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`${this.name}: timeout ${method} ${path}`)); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  get(path)       { return this.request(path, 'GET'); }
  post(path, body) { return this.request(path, 'POST', body); }

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
    const { data } = await this.get('/api/identity');
    this.did = data.did || data.identity?.did;
    if (!this.did) throw new Error(`${this.name}: cannot resolve DID`);
    // Derive address from status if available
    const status = await this.get('/api/node/status');
    this.address = status.data?.address || null;
    return this;
  }

  // ── Wallet ──────────────────────────────────────────────────────────

  async faucet(amount = 100000) {
    return this.post('/api/dev/faucet', { did: this.did, amount });
  }

  async balance(did = null) {
    const target = did || this.did;
    return this.get('/api/wallet/balance?did=' + encodeURIComponent(target));
  }

  async transfer(toDid, amount, memo = '') {
    return this.act('/api/wallet/transfer', { to: toDid, amount, fee: 1, memo });
  }

  async history() {
    return this.get('/api/wallet/history?did=' + encodeURIComponent(this.did));
  }

  // ── Escrow ──────────────────────────────────────────────────────────

  async createEscrow(beneficiaryDid, amount, conditions = [{ type: 'manual', ruleId: 'manual' }]) {
    return this.act('/api/wallet/escrow', {
      beneficiary: beneficiaryDid,
      amount,
      releaseConditions: conditions,
    });
  }

  async getEscrow(id) {
    return this.get('/api/wallet/escrow/' + encodeURIComponent(id));
  }

  async releaseEscrow(id, amount) {
    return this.act('/api/wallet/escrow/' + encodeURIComponent(id) + '/release', { amount });
  }

  async refundEscrow(id) {
    return this.act('/api/wallet/escrow/' + encodeURIComponent(id) + '/refund');
  }

  // ── Reputation ──────────────────────────────────────────────────────

  async submitReputation(targetDid, dimension, score, comment = '', ref = 'clawnet-scenario') {
    return this.act('/api/reputation/record', {
      target: targetDid,
      dimension,
      score,
      comment,
      ref,
    });
  }

  async getReputation(did) {
    return this.get('/api/reputation/' + encodeURIComponent(did));
  }

  // ── Info Market ─────────────────────────────────────────────────────

  async publishInfo(listing) {
    return this.act('/api/markets/info', listing);
  }

  async searchInfo(query = '') {
    const q = typeof query === 'string' ? query : (query?.query || '');
    return this.get('/api/markets/info?keyword=' + encodeURIComponent(q));
  }

  async getInfoListing(id) {
    return this.get('/api/markets/info/' + encodeURIComponent(id));
  }

  async purchaseInfo(id) {
    return this.act('/api/markets/info/' + encodeURIComponent(id) + '/purchase');
  }

  async deliverInfo(id, body = {}) {
    return this.act('/api/markets/info/' + encodeURIComponent(id) + '/deliver', body);
  }

  async confirmInfo(id) {
    return this.act('/api/markets/info/' + encodeURIComponent(id) + '/confirm');
  }

  async reviewInfo(id, rating, comment = '') {
    return this.act('/api/markets/info/' + encodeURIComponent(id) + '/review', {
      rating, comment,
    });
  }

  async removeInfo(id) {
    return this.act('/api/markets/info/' + encodeURIComponent(id) + '/remove');
  }

  // ── Task Market ─────────────────────────────────────────────────────

  async publishTask(listing) {
    return this.act('/api/markets/tasks', listing);
  }

  async searchTasks(query = '') {
    return this.get('/api/markets/tasks?keyword=' + encodeURIComponent(query));
  }

  async getTask(id) {
    return this.get('/api/markets/tasks/' + encodeURIComponent(id));
  }

  async getTaskBids(taskId) {
    return this.get('/api/markets/tasks/' + encodeURIComponent(taskId) + '/bids');
  }

  async submitBid(taskId, bid) {
    return this.act('/api/markets/tasks/' + encodeURIComponent(taskId) + '/bids', bid);
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
    return this.act('/api/markets/tasks/' + encodeURIComponent(taskId) + '/accept', {
      bidId,
      releaseRules: [{ type: 'manual', ruleId: 'task-complete' }],
    });
  }

  async rejectBid(taskId, bidId) {
    return this.act('/api/markets/tasks/' + encodeURIComponent(taskId) + '/reject', { bidId });
  }

  async deliverTask(taskId, { orderId, deliverables, deliveryNote, artifacts, notes, ...rest } = {}) {
    return this.act('/api/markets/tasks/' + encodeURIComponent(taskId) + '/deliver', {
      orderId: orderId || taskId,
      deliverables: deliverables || artifacts?.map(a => ({ ...a })) || [{ type: 'document', note: deliveryNote || 'Delivered' }],
      notes: notes || deliveryNote || '',
      ...rest,
    });
  }

  async confirmTask(taskId, { orderId, submissionId, approved, feedback, ...rest } = {}) {
    return this.act('/api/markets/tasks/' + encodeURIComponent(taskId) + '/confirm', {
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
    return this.act('/api/markets/tasks/' + encodeURIComponent(taskId) + '/review', {
      rating, comment,
    });
  }

  async removeTask(id) {
    return this.act('/api/markets/tasks/' + encodeURIComponent(id) + '/remove');
  }

  // ── Capability Market ───────────────────────────────────────────────

  async publishCapability(listing) {
    return this.act('/api/markets/capabilities', listing);
  }

  async searchCapabilities(query = '') {
    return this.get('/api/markets/capabilities?keyword=' + encodeURIComponent(query));
  }

  async getCapability(id) {
    return this.get('/api/markets/capabilities/' + encodeURIComponent(id));
  }

  async leaseCapability(id, plan = { type: 'pay_per_use' }) {
    return this.act('/api/markets/capabilities/' + encodeURIComponent(id) + '/lease', { plan });
  }

  async invokeLease(leaseId, body = {}) {
    return this.act('/api/markets/capabilities/leases/' + encodeURIComponent(leaseId) + '/invoke', body);
  }

  async terminateLease(leaseId) {
    return this.act('/api/markets/capabilities/leases/' + encodeURIComponent(leaseId) + '/terminate');
  }

  async removeCapability(id) {
    return this.act('/api/markets/capabilities/' + encodeURIComponent(id) + '/remove');
  }

  // ── Service Contracts ───────────────────────────────────────────────

  async createContract(contract) {
    return this.act('/api/contracts', contract);
  }

  async getContract(id) {
    return this.get('/api/contracts/' + encodeURIComponent(id));
  }

  async listContracts() {
    return this.get('/api/contracts');
  }

  async signContract(id) {
    return this.act('/api/contracts/' + encodeURIComponent(id) + '/sign');
  }

  async fundContract(id, amount) {
    return this.act('/api/contracts/' + encodeURIComponent(id) + '/fund', { amount });
  }

  async completeContract(id) {
    return this.act('/api/contracts/' + encodeURIComponent(id) + '/complete');
  }

  async submitMilestone(contractId, milestoneId, body = {}) {
    return this.act(`/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}/complete`, body);
  }

  async approveMilestone(contractId, milestoneId) {
    return this.act(`/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}/approve`);
  }

  async rejectMilestone(contractId, milestoneId, reason = '') {
    return this.act(`/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}/reject`, { reason });
  }

  async openDispute(contractId, reason = '') {
    return this.act('/api/contracts/' + encodeURIComponent(contractId) + '/dispute', { reason });
  }

  async resolveDispute(contractId, resolution = {}) {
    return this.act('/api/contracts/' + encodeURIComponent(contractId) + '/dispute/resolve', resolution);
  }

  // ── DAO ─────────────────────────────────────────────────────────────

  async depositTreasury(amount, source = 'agent contribution') {
    return this.act('/api/dao/treasury/deposit', { amount, source });
  }

  async createProposal(proposal) {
    return this.act('/api/dao/proposals', proposal);
  }

  async getProposal(id) {
    return this.get('/api/dao/proposals/' + encodeURIComponent(id));
  }

  async listProposals() {
    return this.get('/api/dao/proposals');
  }

  async advanceProposal(proposalId, newStatus, resourcePrev) {
    return this.act('/api/dao/proposals/' + encodeURIComponent(proposalId) + '/advance', { proposalId, newStatus, resourcePrev });
  }

  async getProposalVotes(proposalId) {
    return this.get('/api/dao/proposals/' + encodeURIComponent(proposalId) + '/votes');
  }

  async getDaoParams() {
    return this.get('/api/dao/params');
  }

  async getDelegations(did) {
    return this.get('/api/dao/delegations/' + encodeURIComponent(did));
  }

  async vote(proposalId, option, power = '100') {
    return this.act('/api/dao/vote', { proposalId, option, power });
  }

  async delegate(delegateDid, scope = { all: true }) {
    return this.act('/api/dao/delegate', { delegate: delegateDid, scope });
  }

  async revokeDelegate(delegateDid) {
    return this.act('/api/dao/delegate/revoke', { delegate: delegateDid });
  }

  async getTreasury() {
    return this.get('/api/dao/treasury');
  }

  // ── Node Info ───────────────────────────────────────────────────────

  async status() {
    return this.get('/api/node/status');
  }

  async peers() {
    return this.get('/api/node/peers');
  }

  toString() {
    return `[${this.name}] ${this.did || '(not init)'}`;
  }
}
