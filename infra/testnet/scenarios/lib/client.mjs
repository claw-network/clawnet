/**
 * Agent HTTP Client — Testnet Edition
 * ====================================
 * Uses native fetch() for HTTPS support.  Each instance represents
 * one testnet node with a fixed DID / passphrase pair.
 *
 * Compatible with ClawNet REST API v1.
 */

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------
export class Agent {
  /**
   * @param {string} name      Human-readable label (e.g. "alice")
   * @param {string} baseUrl   Node API endpoint, e.g. "https://node-a.clawnetd.com"
   * @param {string} passphrase  CLAW_PASSPHRASE configured on that node
   */
  constructor(name, baseUrl, passphrase) {
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.passphrase = passphrase;
    this.did = null;
    this._nonceCounter = Math.floor(Date.now() / 1000);
  }

  _nextNonce() { return ++this._nonceCounter; }

  // ── Low-level HTTP ──────────────────────────────────────────────────
  async request(path, method = 'GET', body = null) {
    const url = `${this.baseUrl}${path}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      return { status: 0, data: null, error: err.message };
    }

    let data = null;
    try {
      const text = await res.text();
      if (text) {
        const json = JSON.parse(text);
        // Unwrap standard envelope { data, meta, links }
        data = json.data !== undefined ? json.data : json;
      }
    } catch { /* non-JSON response */ }
    return { status: res.status, data };
  }

  async get(path) { return this.request(path); }
  async post(path, body) { return this.request(path, 'POST', body); }
  async del(path) { return this.request(path, 'DELETE'); }

  /** Authenticated action — injects { did, passphrase, nonce }. */
  async act(path, body = {}) {
    return this.post(path, {
      ...body,
      did: this.did,
      passphrase: this.passphrase,
      nonce: this._nextNonce(),
    });
  }

  // ── Identity ────────────────────────────────────────────────────────
  async init() {
    const { status, data } = await this.get('/api/v1/identities/self');
    if (data?.did) this.did = data.did;
    return { status, data };
  }

  // ── Wallet ──────────────────────────────────────────────────────────
  async faucet(amount = 100000) {
    return this.post('/api/v1/wallet/faucet', { amount });
  }

  async balance(did) {
    const path = did ? `/api/v1/wallet/balance/${did}` : '/api/v1/wallet/balance';
    return this.get(path);
  }

  async transfer(toDid, amount, memo = '') {
    return this.act('/api/v1/wallet/transfer', { to: toDid, amount, memo });
  }

  async history(page = 1, limit = 20) {
    return this.get(`/api/v1/wallet/history?page=${page}&limit=${limit}`);
  }

  // ── Escrow ──────────────────────────────────────────────────────────
  async createEscrow(params) { return this.act('/api/v1/escrow', params); }
  async listEscrows() { return this.get('/api/v1/escrow'); }
  async getEscrow(id) { return this.get(`/api/v1/escrow/${id}`); }
  async releaseEscrow(id) { return this.act(`/api/v1/escrow/${id}/actions/release`); }
  async refundEscrow(id) { return this.act(`/api/v1/escrow/${id}/actions/refund`); }

  // ── Reputation ──────────────────────────────────────────────────────
  async submitReputation(targetDid, dimension, score, comment = '') {
    return this.act('/api/v1/reputation', {
      target: targetDid,
      dimension,
      score,
      comment,
    });
  }

  async getReputation(did) {
    return this.get(`/api/v1/reputation/${did}`);
  }

  // ── Info Market ─────────────────────────────────────────────────────
  async publishInfo(listing) { return this.act('/api/v1/info', listing); }
  async searchInfo(query) { return this.get(`/api/v1/info?q=${encodeURIComponent(query)}`); }
  async getInfoListing(id) { return this.get(`/api/v1/info/${id}`); }
  async purchaseInfo(id) { return this.act(`/api/v1/info/${id}/actions/purchase`); }
  async deliverInfo(id) { return this.act(`/api/v1/info/${id}/actions/deliver`); }
  async confirmDelivery(id) { return this.act(`/api/v1/info/${id}/actions/confirm`); }
  async reviewInfo(id, review) { return this.act(`/api/v1/info/${id}/actions/review`, review); }
  async removeInfo(id) { return this.del(`/api/v1/info/${id}`); }

  // ── Task Market ─────────────────────────────────────────────────────
  async publishTask(listing) { return this.act('/api/v1/tasks', listing); }
  async searchTasks(query) { return this.get(`/api/v1/tasks?q=${encodeURIComponent(query)}`); }
  async getTask(id) { return this.get(`/api/v1/tasks/${id}`); }
  async submitBid(taskId, bid) { return this.act(`/api/v1/tasks/${taskId}/bids`, bid); }
  async bidOnTask(taskId, bid) { return this.submitBid(taskId, bid); }
  async getTaskBids(taskId) { return this.get(`/api/v1/tasks/${taskId}/bids`); }
  async acceptBid(taskId, bidId) { return this.act(`/api/v1/tasks/${taskId}/bids/${bidId}/actions/accept`); }
  async deliverTask(taskId, delivery) { return this.act(`/api/v1/tasks/${taskId}/actions/deliver`, delivery); }
  async confirmTask(taskId) { return this.act(`/api/v1/tasks/${taskId}/actions/confirm`); }
  async removeTask(id) { return this.del(`/api/v1/tasks/${id}`); }

  // ── Capability Market ───────────────────────────────────────────────
  async publishCapability(listing) { return this.act('/api/v1/capabilities', listing); }
  async searchCapabilities(query) { return this.get(`/api/v1/capabilities?q=${encodeURIComponent(query)}`); }
  async getCapability(id) { return this.get(`/api/v1/capabilities/${id}`); }
  async leaseCapability(id) { return this.act(`/api/v1/capabilities/${id}/actions/lease`); }
  async invokeCapability(id, payload) { return this.act(`/api/v1/capabilities/${id}/actions/invoke`, payload); }
  async terminateCapability(id) { return this.act(`/api/v1/capabilities/${id}/actions/terminate`); }
  async removeCapability(id) { return this.del(`/api/v1/capabilities/${id}`); }

  // ── Service Contracts ───────────────────────────────────────────────
  async createContract(params) { return this.act('/api/v1/contracts', params); }
  async getContract(id) { return this.get(`/api/v1/contracts/${id}`); }
  async listContracts() { return this.get('/api/v1/contracts'); }
  async signContract(id) { return this.act(`/api/v1/contracts/${id}/actions/sign`); }
  async fundContract(id, amount) { return this.act(`/api/v1/contracts/${id}/actions/activate`, { amount }); }
  async submitMilestone(contractId, milestoneId, delivery) {
    return this.act(`/api/v1/contracts/${contractId}/milestones/${milestoneId}/actions/submit`, delivery);
  }
  async approveMilestone(contractId, milestoneId) {
    return this.act(`/api/v1/contracts/${contractId}/milestones/${milestoneId}/actions/approve`);
  }
  async rejectMilestone(contractId, milestoneId, reason) {
    return this.act(`/api/v1/contracts/${contractId}/milestones/${milestoneId}/actions/reject`, reason);
  }
  async completeContract(id) { return this.act(`/api/v1/contracts/${id}/actions/complete`); }
  async openDispute(contractId, params) {
    return this.act(`/api/v1/contracts/${contractId}/actions/dispute`, params);
  }
  async resolveDispute(contractId, resolution) {
    return this.act(`/api/v1/contracts/${contractId}/actions/resolve`, resolution);
  }

  // ── DAO Governance ──────────────────────────────────────────────────
  async createProposal(params) { return this.act('/api/v1/dao/proposals', params); }
  async getProposal(id) { return this.get(`/api/v1/dao/proposals/${id}`); }
  async listProposals() { return this.get('/api/v1/dao/proposals'); }
  async getProposalVotes(id) { return this.get(`/api/v1/dao/proposals/${id}/votes`); }
  async advanceProposal(id, stage, hash) {
    return this.act(`/api/v1/dao/proposals/${id}/actions/advance`, { stage, hash });
  }
  async vote(proposalId, choice, amount) {
    return this.act(`/api/v1/dao/proposals/${proposalId}/actions/vote`, { choice, amount });
  }
  async delegate(toDid) { return this.act('/api/v1/dao/delegate', { to: toDid }); }
  async revokeDelegate(toDid) { return this.act('/api/v1/dao/delegate/revoke', { to: toDid }); }
  async getDelegations(did) { return this.get(`/api/v1/dao/delegations/${did}`); }
  async getTreasury() { return this.get('/api/v1/dao/treasury'); }
  async depositTreasury(amount, memo) {
    return this.act('/api/v1/dao/treasury/deposit', { amount, memo });
  }
  async getDaoParams() { return this.get('/api/v1/dao/params'); }

  // ── Node Info ───────────────────────────────────────────────────────
  async status() { return this.get('/api/v1/node'); }
  async peers() { return this.get('/api/v1/node/peers'); }
}
