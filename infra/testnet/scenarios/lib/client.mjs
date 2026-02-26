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
    this.devApiKey = process.env.DEV_FAUCET_API_KEY || '';
    this.did = null;
    this._nonceCounter = Math.floor(Date.now() / 1000);
  }

  _nextNonce() {
    return ++this._nonceCounter;
  }

  // ── Low-level HTTP ──────────────────────────────────────────────────
  _rewritePath(path) {
    if (path === '/api/v1/wallet/balance') {
      const did = this.did || '';
      return did ? `/api/v1/wallets/${encodeURIComponent(did)}` : '/api/v1/wallets/unknown';
    }
    if (path.startsWith('/api/v1/wallet/balance/')) {
      const id = path.slice('/api/v1/wallet/balance/'.length);
      return `/api/v1/wallets/${encodeURIComponent(id)}`;
    }
    if (path.startsWith('/api/v1/wallet/history')) {
      const qs = path.includes('?') ? path.slice(path.indexOf('?')) : '';
      const did = this.did || '';
      return did
        ? `/api/v1/wallets/${encodeURIComponent(did)}/transactions${qs}`
        : '/api/v1/wallets/unknown/transactions';
    }
    if (path === '/api/v1/wallet/transfer') return '/api/v1/transfers';
    if (path === '/api/v1/wallet/faucet') return '/api/v1/dev/faucet';

    if (path.startsWith('/api/v1/info'))
      return path.replace('/api/v1/info', '/api/v1/markets/info');
    if (path.startsWith('/api/v1/tasks'))
      return path.replace('/api/v1/tasks', '/api/v1/markets/tasks');
    if (path.startsWith('/api/v1/capabilities')) {
      return path.replace('/api/v1/capabilities', '/api/v1/markets/capabilities');
    }
    if (path === '/api/v1/reputation' || path.startsWith('/api/v1/reputation/')) {
      return path.replace('/api/v1/reputation', '/api/v1/reputations');
    }
    if (path.startsWith('/api/v1/escrow')) return path.replace('/api/v1/escrow', '/api/v1/escrows');

    if (path.startsWith('/api/v1/dao/proposals/') && path.endsWith('/actions/vote')) {
      return path.replace('/actions/vote', '/votes');
    }
    if (path === '/api/v1/dao/delegate') return '/api/v1/dao/delegations';
    if (path === '/api/v1/dao/delegate/revoke') return '/api/v1/dao/delegations';
    if (path.startsWith('/api/v1/dao/delegations/')) return '/api/v1/dao/delegations';
    if (path === '/api/v1/dao/treasury/deposit') return '/api/v1/dao/treasury/deposits';

    return path;
  }

  async request(path, method = 'GET', body = null) {
    const rewrittenPath = this._rewritePath(path);
    const url = `${this.baseUrl}${rewrittenPath}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (rewrittenPath === '/api/v1/dev/faucet' && this.devApiKey) {
      opts.headers['X-Api-Key'] = this.devApiKey;
    }
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
    } catch {
      /* non-JSON response */
    }
    return { status: res.status, data };
  }

  async get(path) {
    return this.request(path);
  }
  async post(path, body) {
    return this.request(path, 'POST', body);
  }
  async del(path) {
    return this.request(path, 'DELETE');
  }

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
    return this.post('/api/v1/wallet/faucet', { amount, did: this.did });
  }

  async balance(did) {
    const path = did ? `/api/v1/wallet/balance/${did}` : '/api/v1/wallet/balance';
    return this.get(path);
  }

  async transfer(toDid, amount, memo = '') {
    return this.act('/api/v1/wallet/transfer', { to: toDid, amount, fee: 1, memo });
  }

  async history(page = 1, limit = 20) {
    return this.get(`/api/v1/wallet/history?page=${page}&limit=${limit}`);
  }

  // ── Escrow ──────────────────────────────────────────────────────────
  async createEscrow(params) {
    return this.act('/api/v1/escrow', params);
  }
  async listEscrows() {
    return this.get('/api/v1/escrow');
  }
  async getEscrow(id) {
    return this.get(`/api/v1/escrow/${id}`);
  }
  async releaseEscrow(id) {
    return this.act(`/api/v1/escrow/${id}/actions/release`);
  }
  async refundEscrow(id) {
    return this.act(`/api/v1/escrow/${id}/actions/refund`);
  }

  // ── Reputation ──────────────────────────────────────────────────────
  async submitReputation(targetDid, dimension, score, comment = '') {
    return this.act(`/api/v1/reputations/${encodeURIComponent(targetDid)}/reviews`, {
      target: targetDid,
      dimension,
      score,
      ref: `scenario-${Date.now()}`,
      comment,
    });
  }

  async getReputation(did) {
    return this.get(`/api/v1/reputation/${did}`);
  }

  // ── Info Market ─────────────────────────────────────────────────────
  async publishInfo(listing) {
    return this.act('/api/v1/info', listing);
  }
  async searchInfo(query) {
    return this.get(`/api/v1/info?q=${encodeURIComponent(query)}`);
  }
  async getInfoListing(id) {
    return this.get(`/api/v1/info/${id}`);
  }
  async purchaseInfo(id) {
    return this.act(`/api/v1/info/${id}/actions/purchase`);
  }
  async deliverInfo(id) {
    return this.act(`/api/v1/info/${id}/actions/deliver`);
  }
  async confirmDelivery(id) {
    return this.act(`/api/v1/info/${id}/actions/confirm`);
  }
  async reviewInfo(id, review) {
    return this.act(`/api/v1/info/${id}/actions/review`, review);
  }
  async removeInfo(id) {
    return this.act(`/api/v1/info/${id}/actions/remove`);
  }

  // ── Task Market ─────────────────────────────────────────────────────
  async publishTask(listing) {
    return this.act('/api/v1/tasks', listing);
  }
  async searchTasks(query) {
    return this.get(`/api/v1/tasks?q=${encodeURIComponent(query)}`);
  }
  async getTask(id) {
    return this.get(`/api/v1/tasks/${id}`);
  }
  async submitBid(taskId, bid) {
    return this.act(`/api/v1/tasks/${taskId}/bids`, bid);
  }
  async bidOnTask(taskId, bid) {
    return this.submitBid(taskId, bid);
  }
  async getTaskBids(taskId) {
    return this.get(`/api/v1/tasks/${taskId}/bids`);
  }
  async acceptBid(taskId, bidId) {
    return this.act(`/api/v1/tasks/${taskId}/bids/${bidId}/actions/accept`);
  }
  async deliverTask(taskId, delivery) {
    return this.act(`/api/v1/tasks/${taskId}/actions/deliver`, delivery);
  }
  async confirmTask(taskId) {
    return this.act(`/api/v1/tasks/${taskId}/actions/confirm`);
  }
  async removeTask(id) {
    return this.act(`/api/v1/tasks/${id}/actions/remove`);
  }

  // ── Capability Market ───────────────────────────────────────────────
  async publishCapability(listing) {
    return this.act('/api/v1/capabilities', listing);
  }
  async searchCapabilities(query) {
    return this.get(`/api/v1/capabilities?q=${encodeURIComponent(query)}`);
  }
  async getCapability(id) {
    return this.get(`/api/v1/capabilities/${id}`);
  }
  async leaseCapability(id) {
    const exists = await this.get(`/api/v1/capabilities/${id}`);
    if (exists.status !== 200) {
      return { status: 404, data: { detail: 'Listing not found on this node' } };
    }
    return this.act(`/api/v1/capabilities/${id}/leases`, {
      plan: { tier: 'standard' },
      credentials: {},
    });
  }
  async invokeCapability(id, payload) {
    return this.act(`/api/v1/capabilities/${id}/actions/invoke`, payload);
  }
  async terminateCapability(id) {
    return this.act(`/api/v1/capabilities/leases/${id}/actions/terminate`);
  }
  async removeCapability(id) {
    return this.act(`/api/v1/capabilities/${id}/actions/remove`);
  }

  // ── Service Contracts ───────────────────────────────────────────────
  async createContract(params) {
    return this.act('/api/v1/contracts', params);
  }
  async getContract(id) {
    return this.get(`/api/v1/contracts/${id}`);
  }
  async listContracts() {
    return this.get('/api/v1/contracts');
  }
  async signContract(id) {
    return this.act(`/api/v1/contracts/${id}/actions/sign`);
  }
  async fundContract(id, amount) {
    return this.act(`/api/v1/contracts/${id}/actions/activate`, { amount });
  }
  async submitMilestone(contractId, milestoneId, delivery) {
    return this.act(
      `/api/v1/contracts/${contractId}/milestones/${milestoneId}/actions/submit`,
      delivery,
    );
  }
  async approveMilestone(contractId, milestoneId) {
    return this.act(`/api/v1/contracts/${contractId}/milestones/${milestoneId}/actions/approve`);
  }
  async rejectMilestone(contractId, milestoneId, reason) {
    return this.act(
      `/api/v1/contracts/${contractId}/milestones/${milestoneId}/actions/reject`,
      reason,
    );
  }
  async completeContract(id) {
    return this.act(`/api/v1/contracts/${id}/actions/complete`);
  }
  async openDispute(contractId, params) {
    return this.act(`/api/v1/contracts/${contractId}/actions/dispute`, params);
  }
  async resolveDispute(contractId, resolution) {
    return this.act(`/api/v1/contracts/${contractId}/actions/resolve`, resolution);
  }

  // ── DAO Governance ──────────────────────────────────────────────────
  async createProposal(params) {
    return this.act('/api/v1/dao/proposals', params);
  }
  async getProposal(id) {
    return this.get(`/api/v1/dao/proposals/${id}`);
  }
  async listProposals() {
    return this.get('/api/v1/dao/proposals');
  }
  async getProposalVotes(id) {
    return this.get(`/api/v1/dao/proposals/${id}/votes`);
  }
  async advanceProposal(id, stage, hash) {
    return this.act(`/api/v1/dao/proposals/${id}/actions/advance`, {
      proposalId: id,
      newStatus: stage,
      resourcePrev: hash || '',
    });
  }
  async vote(proposalId, choice, amount) {
    return this.act(`/api/v1/dao/proposals/${proposalId}/actions/vote`, {
      proposalId,
      option:
        choice === 'for' || choice === true ? 'for' : choice === 'against' ? 'against' : 'abstain',
      power: amount ?? 1,
    });
  }
  async delegate(toDid) {
    return this.act('/api/v1/dao/delegate', { delegate: toDid });
  }
  async revokeDelegate(toDid) {
    return this.act(`/api/v1/dao/delegations/${encodeURIComponent(toDid)}`, { delegate: toDid });
  }
  async getDelegations(did) {
    return this.get(`/api/v1/dao/delegations?did=${encodeURIComponent(did)}`);
  }
  async getTreasury() {
    return this.get('/api/v1/dao/treasury');
  }
  async depositTreasury(amount, memo) {
    return this.act('/api/v1/dao/treasury/deposit', { amount, source: memo || 'scenario-test' });
  }
  async getDaoParams() {
    return this.get('/api/v1/dao/params');
  }

  // ── Node Info ───────────────────────────────────────────────────────
  async status() {
    return this.get('/api/v1/node');
  }
  async peers() {
    return this.get('/api/v1/node/peers');
  }
}
