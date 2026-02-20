/**
 * P2P Sync Wait Utilities
 *
 * Events propagate via GossipSub (instant when mesh is healthy) + range sync
 * (fallback every 30s). In Docker, GossipSub mesh can be sparse, so we use
 * short timeouts with fast polling and graceful fallbacks.
 */
import { vlog, sleep } from './helpers.mjs';

/**
 * Wait until a condition returns truthy, polling at `intervalMs`.
 * @param {string}    label       Description for logging
 * @param {Function}  fn          Async function returning truthy when done
 * @param {number}    timeoutMs   Max wait (default 5s — GossipSub should be instant)
 * @param {number}    intervalMs  Poll interval (default 500ms for fast detection)
 * @returns {*}       The truthy value returned by fn
 */
export async function waitFor(label, fn, timeoutMs = 5000, intervalMs = 500) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await fn();
      if (last) {
        vlog(`${label}: ready after ${Date.now() - start}ms`);
        return last;
      }
    } catch { /* retry */ }
    await sleep(intervalMs);
  }
  vlog(`${label}: timeout after ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
  return null;
}

/**
 * Wait until an Agent can see a resource via GET (status 200).
 * @param {import('./client.mjs').Agent} agent
 * @param {string} path   e.g. /api/contracts/xxx
 * @param {number} timeoutMs
 * @returns {object|null} response data or null
 */
export async function waitForResource(agent, path, timeoutMs = 5000) {
  return waitFor(
    `${agent.name} sees ${path}`,
    async () => {
      const r = await agent.get(path);
      return r.status === 200 ? r.data : null;
    },
    timeoutMs,
  );
}

/**
 * Wait until an Agent can see a market listing by ID.
 */
export async function waitForListing(agent, marketType, listingId, timeoutMs = 5000) {
  const path = `/api/markets/${marketType}/${encodeURIComponent(listingId)}`;
  return waitForResource(agent, path, timeoutMs);
}

/**
 * Wait until an Agent's balance for a DID reaches at least `minBalance`.
 */
export async function waitForBalance(agent, did, minBalance, timeoutMs = 5000) {
  return waitFor(
    `${agent.name} balance(${did}) >= ${minBalance}`,
    async () => {
      const r = await agent.balance(did);
      if (r.status !== 200) return null;
      const bal = Number(r.data?.balance ?? r.data?.available ?? 0);
      return bal >= minBalance ? bal : null;
    },
    timeoutMs,
  );
}

/**
 * Wait until an Agent can see a contract in a specific state.
 */
export async function waitForContractState(agent, contractId, expectedState, timeoutMs = 5000) {
  return waitFor(
    `${agent.name} contract(${contractId}) state=${expectedState}`,
    async () => {
      const r = await agent.getContract(contractId);
      if (r.status !== 200) return null;
      const state = r.data?.status || r.data?.state;
      return state === expectedState ? r.data : null;
    },
    timeoutMs,
  );
}

/**
 * Wait for all agents to become healthy / responsive.
 * @param {import('./client.mjs').Agent[]} agents
 * @param {number} timeoutMs
 */
export async function waitForAllNodes(agents, timeoutMs = 20000) {
  const start = Date.now();
  for (const agent of agents) {
    const ready = await waitFor(
      `${agent.name} healthy`,
      async () => {
        const r = await agent.get('/api/node/status');
        return r.status === 200;
      },
      Math.max(5000, timeoutMs - (Date.now() - start)),
      1000,
    );
    if (!ready) throw new Error(`${agent.name} (${agent.baseUrl}) not healthy after ${timeoutMs}ms`);
  }
}
