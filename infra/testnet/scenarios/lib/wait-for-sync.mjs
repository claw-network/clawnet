/**
 * P2P Sync Wait Utilities — Testnet Edition
 * ==========================================
 * Polls until a condition is met or timeout expires.
 * Default timeouts are longer than the Docker version to accommodate
 * real-world network latency on the testnet.
 */

import { vlog } from './helpers.mjs';

// Defaults can be overridden per-call or globally via env.
const DEFAULT_TIMEOUT  = parseInt(process.env.SYNC_TIMEOUT  || '30000', 10);
const DEFAULT_INTERVAL = parseInt(process.env.SYNC_INTERVAL || '2000',  10);

/**
 * Generic poll-until helper.
 * @param {string}   label     Human-readable description for logs
 * @param {Function} fn        Async function that returns truthy when done
 * @param {number}   [timeout] Max wait in ms
 * @param {number}   [interval] Poll interval in ms
 */
export async function waitFor(label, fn, timeout = DEFAULT_TIMEOUT, interval = DEFAULT_INTERVAL) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch { /* ignore poll errors */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  vlog(`waitFor(${label}) timed out after ${timeout}ms`);
  return null;
}

/**
 * Wait until a specific REST resource is reachable (GET 200).
 */
export async function waitForResource(agent, path, timeout = DEFAULT_TIMEOUT) {
  return waitFor(`${agent.name}:${path}`, async () => {
    const { status, data } = await agent.get(path);
    return status === 200 ? data : null;
  }, timeout);
}

/**
 * Wait until a market listing is visible on an agent's node.
 */
export async function waitForListing(agent, market, listingId, timeout = DEFAULT_TIMEOUT) {
  const path = `/api/v1/${market}/${listingId}`;
  return waitFor(`${agent.name} listing ${listingId}`, async () => {
    const { status, data } = await agent.get(path);
    return status === 200 ? data : null;
  }, timeout);
}

/**
 * Wait until a DID's balance (on the given agent's node) reaches `minBalance`.
 */
export async function waitForBalance(agent, did, minBalance, timeout = DEFAULT_TIMEOUT) {
  return waitFor(`${agent.name} balance ≥ ${minBalance}`, async () => {
    const { status, data } = await agent.balance(did);
    if (status !== 200) return null;
    const bal = Number(data?.balance ?? data?.available ?? 0);
    return bal >= minBalance ? bal : null;
  }, timeout);
}

/**
 * Wait until a contract reaches a given state.
 */
export async function waitForContractState(agent, contractId, state, timeout = DEFAULT_TIMEOUT) {
  return waitFor(`${agent.name} contract ${contractId} → ${state}`, async () => {
    const { status, data } = await agent.getContract(contractId);
    if (status !== 200) return null;
    const current = (data?.status || data?.state || '').toLowerCase();
    return current.includes(state.toLowerCase()) ? data : null;
  }, timeout);
}

/**
 * Wait until all agents report healthy (GET /api/v1/node → 200).
 */
export async function waitForAllNodes(agents, timeout = DEFAULT_TIMEOUT) {
  return waitFor('all nodes healthy', async () => {
    for (const a of agents) {
      const { status } = await a.status();
      if (status !== 200) return false;
    }
    return true;
  }, timeout);
}
