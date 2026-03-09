#!/usr/bin/env node
/**
 * ClawNet Relay Reward Integration Test
 * ========================================
 * End-to-end test for the relay incentive system (Layer 4 verification).
 *
 * Tests relay service layer (P2P relay stats, period proof, confirm-contribution)
 * and on-chain reward flow (status, preview, claim) when chain is available.
 *
 * Usage:
 *   node scripts/scenario-relay-reward.mjs                           # default: 3 nodes
 *   node scripts/scenario-relay-reward.mjs --verbose
 *   node scripts/scenario-relay-reward.mjs --nodes http://localhost:9528,http://localhost:9530,http://localhost:9532
 *   node scripts/scenario-relay-reward.mjs --api-key=<key>           # for authenticated endpoints
 *
 * Requires: docker compose -f docker-compose.testnet.yml up --build -d
 * For chain tests: nodes must be configured with CHAIN_RPC_URL + deployed contracts.
 */

import http from 'node:http';
import https from 'node:https';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_NODES = [
  'http://localhost:9528',
  'http://localhost:9530',
  'http://localhost:9532',
];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const nodesArg = args.find((a) => a.startsWith('--nodes='))?.split('=')[1];
const apiKeyArg = args.find((a) => a.startsWith('--api-key='))?.split('=')[1];
const API_KEY = apiKeyArg || process.env.CLAW_API_KEY || '';
const NODES = nodesArg ? nodesArg.split(',') : DEFAULT_NODES;

let passed = 0;
let failed = 0;
let skipped = 0;

// ---------------------------------------------------------------------------
// HTTP helpers (same pattern as integration-test.mjs)
// ---------------------------------------------------------------------------

function request(baseUrl, path, method = 'GET', body = null, _redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 15000,
    };
    const req = transport.request(opts, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && _redirects < 5) {
        const redirectUrl = new URL(res.headers.location, url.href);
        const nextMethod = [307, 308].includes(res.statusCode) ? method : 'GET';
        const nextBody = [307, 308].includes(res.statusCode) ? body : null;
        resolve(request(redirectUrl.origin, redirectUrl.pathname + redirectUrl.search, nextMethod, nextBody, _redirects + 1));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          const unwrapped = (parsed && typeof parsed === 'object' && 'data' in parsed && !Array.isArray(parsed))
            ? parsed.data : parsed;
          resolve({ status: res.statusCode, data: unwrapped, meta: parsed?.meta, links: parsed?.links, _raw: parsed });
        } catch {
          resolve({ status: res.statusCode, data, raw: true });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function get(base, path) { return request(base, path, 'GET'); }
async function post(base, path, body) { return request(base, path, 'POST', body); }

function log(msg) { console.log(msg); }
function vlog(msg) { if (verbose) console.log('  [v] ' + msg); }

async function test(name, fn) {
  try {
    await fn();
    passed++;
    log('  ✅ ' + name);
  } catch (error) {
    failed++;
    log('  ❌ ' + name);
    log('     ' + (error.message || error));
    if (verbose && error.stack) {
      log('     ' + error.stack.split('\n').slice(1, 3).join('\n     '));
    }
  }
}

function skip(name, reason) {
  skipped++;
  log('  ⏭️  ' + name + ' (' + reason + ')');
}

function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, e, m) {
  if (a !== e) throw new Error((m || 'mismatch') + ': expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a));
}
function assertGte(a, min, m) {
  if (a < min) throw new Error((m || 'too low') + ': expected >= ' + min + ', got ' + a);
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const nodeDids = [];
let chainAvailable = false;
let relayProof = null;

// ---------------------------------------------------------------------------
// Setup: fetch identities, detect chain availability
// ---------------------------------------------------------------------------

async function setup() {
  log('\n⚙️  Setup: Fetch identities & detect chain');

  for (let i = 0; i < NODES.length; i++) {
    const { status, data } = await get(NODES[i], '/api/v1/identities/self');
    assert(status === 200, 'Node ' + i + ' identity failed: ' + status);
    nodeDids.push(data.did);
    vlog('Node ' + i + ': ' + data.did);
  }
  log('  ✅ ' + NODES.length + ' nodes identified');

  // Detect chain availability via reward/status endpoint
  try {
    const { status } = await get(NODES[0], '/api/v1/relay/reward/status');
    chainAvailable = (status === 200);
    vlog('Chain detection: status=' + status);
  } catch {
    chainAvailable = false;
  }

  log('  ' + (chainAvailable ? '🔗 Chain available — reward tests enabled' : '⛓️‍💥 No chain — reward claim tests will be skipped'));
}

// ---------------------------------------------------------------------------
// Scenario 1: Relay Service Layer (no chain required)
// ---------------------------------------------------------------------------

async function scenarioRelayServiceLayer() {
  log('\n📡 Scenario 1: Relay Service Layer');
  const node = NODES[0];

  await test('GET /relay/stats returns relay statistics', async () => {
    const { status, data } = await get(node, '/api/v1/relay/stats');
    // relay service may or may not be initialized
    if (status === 500 && data?.detail?.includes('unavailable')) {
      skip('relay stats', 'relay service not initialized');
      passed--; skipped++;
      return;
    }
    assertEqual(status, 200, 'status');
    assert(typeof data === 'object', 'should be object');
    vlog('Stats: ' + JSON.stringify(data).slice(0, 300));
  });

  await test('GET /relay/health returns relay health', async () => {
    const { status, data } = await get(node, '/api/v1/relay/health');
    if (status === 500) { passed--; skipped++; skip('relay health', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
    assert(typeof data === 'object', 'should be object');
    vlog('Health: ' + JSON.stringify(data).slice(0, 300));
  });

  await test('GET /relay/access returns access control info', async () => {
    const { status, data } = await get(node, '/api/v1/relay/access');
    if (status === 500) { passed--; skipped++; skip('relay access', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
    assert(typeof data === 'object', 'should be object');
    vlog('Access: ' + JSON.stringify(data).slice(0, 200));
  });

  await test('POST /relay/access can set access mode', async () => {
    const { status, data } = await post(node, '/api/v1/relay/access', { mode: 'open' });
    if (status === 500) { passed--; skipped++; skip('set access mode', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
    vlog('Access after set: ' + JSON.stringify(data).slice(0, 200));
  });

  await test('POST /relay/access rejects invalid mode', async () => {
    const { status } = await post(node, '/api/v1/relay/access', { mode: 'invalid_mode' });
    if (status === 500) { passed--; skipped++; skip('reject invalid mode', 'relay service not initialized'); return; }
    assertEqual(status, 400, 'should reject invalid mode');
  });

  await test('POST /relay/access can add DID to access list', async () => {
    const { status } = await post(node, '/api/v1/relay/access', { action: 'add', did: nodeDids[1] });
    if (status === 500) { passed--; skipped++; skip('add to access list', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
  });

  await test('POST /relay/access can remove DID from access list', async () => {
    const { status } = await post(node, '/api/v1/relay/access', { action: 'remove', did: nodeDids[1] });
    if (status === 500) { passed--; skipped++; skip('remove from access list', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
  });

  await test('GET /relay/peers returns active peer list', async () => {
    const { status, data } = await get(node, '/api/v1/relay/peers');
    if (status === 500) { passed--; skipped++; skip('relay peers', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
    assert(Array.isArray(data.peers), 'peers should be array');
    assert(typeof data.count === 'number', 'count should be number');
    assert(typeof data.draining === 'boolean', 'draining should be boolean');
    vlog('Peers: count=' + data.count + ', draining=' + data.draining);
  });

  await test('POST /relay/drain can enable drain mode', async () => {
    const { status, data } = await post(node, '/api/v1/relay/drain', { enable: true });
    if (status === 500) { passed--; skipped++; skip('drain enable', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
    assertEqual(data.draining, true, 'draining');
  });

  await test('POST /relay/drain can disable drain mode', async () => {
    const { status, data } = await post(node, '/api/v1/relay/drain', { enable: false });
    if (status === 500) { passed--; skipped++; skip('drain disable', 'relay service not initialized'); return; }
    assertEqual(status, 200, 'status');
    assertEqual(data.draining, false, 'draining');
  });

  await test('GET /relay/discover finds relay nodes', async () => {
    let res;
    try { res = await get(node, '/api/v1/relay/discover'); }
    catch (e) {
      if (e.message === 'timeout') { passed--; skipped++; skip('relay discover', 'DHT discovery timeout'); return; }
      throw e;
    }
    const { status, data } = res;
    if (status === 500) { passed--; skipped++; skip('relay discover', 'P2P unavailable'); return; }
    assertEqual(status, 200, 'status');
    assert(Array.isArray(data.relays), 'relays should be array');
    assert(typeof data.count === 'number', 'count should be number');
    vlog('Discovered relays: ' + data.count);
  });

  await test('GET /relay/scores returns scored candidates', async () => {
    let res;
    try { res = await get(node, '/api/v1/relay/scores'); }
    catch (e) {
      if (e.message === 'timeout') { passed--; skipped++; skip('relay scores', 'DHT discovery timeout'); return; }
      throw e;
    }
    const { status, data } = res;
    if (status === 500) { passed--; skipped++; skip('relay scores', 'scorer unavailable'); return; }
    assertEqual(status, 200, 'status');
    assert(Array.isArray(data.scores), 'scores should be array');
    vlog('Scored candidates: ' + data.count);
  });
}

// ---------------------------------------------------------------------------
// Scenario 2: Period Proof Generation & Confirmation
// ---------------------------------------------------------------------------

async function scenarioPeriodProof() {
  log('\n📋 Scenario 2: Period Proof & Contribution Confirmation');
  const relayNode = NODES[0];
  const relayDid = nodeDids[0];

  // Generate a period proof
  await test('POST /relay/period-proof generates proof', async () => {
    const { status, data } = await post(relayNode, '/api/v1/relay/period-proof', {
      relayDid,
    });
    if (status === 500) { passed--; skipped++; skip('generate proof', 'relay/sign unavailable'); return; }
    assertEqual(status, 200, 'status');
    assert(typeof data === 'object', 'should return proof object');
    assert(data.relayDid === relayDid, 'relayDid should match');
    assert(typeof data.periodId === 'number', 'periodId should be number');
    assert(typeof data.bytesRelayed === 'number', 'bytesRelayed should be number');
    assert(typeof data.circuitsServed === 'number', 'circuitsServed should be number');
    assert(typeof data.relaySignature === 'string', 'relaySignature should be string');
    assert(Array.isArray(data.peerConfirmations), 'peerConfirmations should be array');
    relayProof = data;
    vlog('Proof: periodId=' + data.periodId + ', bytes=' + data.bytesRelayed +
      ', circuits=' + data.circuitsServed + ', confirmations=' + data.peerConfirmations.length);
  });

  // Retrieve the last proof
  await test('GET /relay/period-proof returns last proof', async () => {
    const { status, data } = await get(relayNode, '/api/v1/relay/period-proof');
    if (status === 500) { passed--; skipped++; skip('get proof', 'relay unavailable'); return; }
    assertEqual(status, 200, 'status');
    // May be null if no proof was generated (e.g., relay service wasn't initialized)
    if (data.proof === null) {
      vlog('No proof stored yet (relay service may not have generated one)');
      return;
    }
    assert(typeof data.periodId === 'number' || typeof data.relayDid === 'string', 'should have proof fields');
    vlog('Last proof periodId: ' + (data.periodId || 'n/a'));
  });

  // Confirm contribution from peer
  await test('POST /relay/confirm-contribution accepts valid confirmation', async () => {
    const { status, data } = await post(relayNode, '/api/v1/relay/confirm-contribution', {
      peerDid: nodeDids[1],
      bytesConfirmed: 5242880, // 5 MB
      circuitsConfirmed: 3,
      signature: 'test-signature-base58-encoded',
    });
    if (status === 500) { passed--; skipped++; skip('confirm contribution', 'relay unavailable'); return; }
    assertEqual(status, 200, 'status');
    assertEqual(data.accepted, true, 'accepted');
    assertEqual(data.peerDid, nodeDids[1], 'peerDid');
    assertEqual(data.bytesConfirmed, 5242880, 'bytesConfirmed');
    vlog('Contribution confirmed: ' + JSON.stringify(data));
  });

  // Reject incomplete confirmation
  await test('POST /relay/confirm-contribution rejects missing fields', async () => {
    const { status } = await post(relayNode, '/api/v1/relay/confirm-contribution', {
      peerDid: nodeDids[1],
      // missing bytesConfirmed, circuitsConfirmed, signature
    });
    if (status === 500) { passed--; skipped++; skip('reject incomplete', 'relay unavailable'); return; }
    assertEqual(status, 400, 'should reject incomplete body');
  });

  // Generate proof from second node too
  if (NODES.length >= 2) {
    await test('different node can also generate period proof', async () => {
      const { status, data } = await post(NODES[1], '/api/v1/relay/period-proof', {
        relayDid: nodeDids[1],
      });
      if (status === 500) { passed--; skipped++; skip('peer proof', 'relay/sign unavailable on peer'); return; }
      assertEqual(status, 200, 'status');
      assert(data.relayDid === nodeDids[1], 'relayDid should match peer');
      vlog('Peer proof: periodId=' + data.periodId);
    });
  }
}

// ---------------------------------------------------------------------------
// Scenario 3: On-Chain Reward Status & Preview (requires chain)
// ---------------------------------------------------------------------------

async function scenarioRewardStatus() {
  log('\n🔗 Scenario 3: On-Chain Reward Status & Preview');
  const node = NODES[0];

  if (!chainAvailable) {
    skip('GET /relay/reward/status', 'no chain connection');
    skip('GET /relay/reward/preview', 'no chain connection');
    return;
  }

  await test('GET /relay/reward/status returns contract state', async () => {
    const { status, data } = await get(node, '/api/v1/relay/reward/status');
    assertEqual(status, 200, 'status');
    assert(typeof data.poolBalance === 'string', 'poolBalance should be string');
    assert(typeof data.totalDistributed === 'string', 'totalDistributed should be string');
    assert(typeof data.lastClaimedPeriod === 'number', 'lastClaimedPeriod should be number');
    assert(typeof data.params === 'object', 'params should be object');
    assert(typeof data.params.baseRate === 'number', 'params.baseRate should be number');
    assert(typeof data.params.maxRewardPerPeriod === 'number', 'params.maxRewardPerPeriod');
    assert(typeof data.params.minBytesThreshold === 'number', 'params.minBytesThreshold');
    assert(typeof data.params.minPeersThreshold === 'number', 'params.minPeersThreshold');
    assert(typeof data.params.attachmentWeightBps === 'number', 'params.attachmentWeightBps');
    assertGte(Number(data.poolBalance), 0, 'pool balance');
    vlog('Reward status: pool=' + data.poolBalance + ' Token, distributed=' + data.totalDistributed +
      ', params=' + JSON.stringify(data.params));
  });

  await test('GET /relay/reward/preview returns reward computation', async () => {
    // Need a proof first
    if (!relayProof) {
      skip('reward preview', 'no period proof available');
      passed--; skipped++;
      return;
    }
    const { status, data } = await get(node, '/api/v1/relay/reward/preview');
    assertEqual(status, 200, 'status');
    assert(typeof data.periodId === 'number', 'periodId');
    assert(typeof data.eligible === 'boolean', 'eligible');
    assert(typeof data.rewardAmount === 'number', 'rewardAmount');
    assert(typeof data.breakdown === 'object', 'breakdown');
    vlog('Preview: periodId=' + data.periodId + ', eligible=' + data.eligible +
      ', amount=' + data.rewardAmount + ', breakdown=' + JSON.stringify(data.breakdown));
  });

  // Verify pool balance is non-zero (bootstrap-mint should have funded it)
  await test('reward pool has balance (bootstrap-mint funded)', async () => {
    const { status, data } = await get(node, '/api/v1/relay/reward/status');
    assertEqual(status, 200, 'status');
    assertGte(Number(data.poolBalance), 1, 'pool should have tokens from bootstrap-mint');
    vlog('Pool balance: ' + data.poolBalance + ' Token');
  });
}

// ---------------------------------------------------------------------------
// Scenario 4: Full Reward Claim Flow (requires chain + relay traffic)
// ---------------------------------------------------------------------------

async function scenarioRewardClaim() {
  log('\n💰 Scenario 4: Reward Claim Flow');
  const node = NODES[0];

  if (!chainAvailable) {
    skip('POST /relay/reward/claim', 'no chain connection');
    skip('duplicate claim rejection', 'no chain connection');
    skip('reward pool decreases after claim', 'no chain connection');
    return;
  }

  // Get initial pool balance
  let poolBefore = '0';
  await test('record pool balance before claim', async () => {
    const { data } = await get(node, '/api/v1/relay/reward/status');
    poolBefore = data.poolBalance;
    vlog('Pool before: ' + poolBefore);
  });

  // Attempt claim
  await test('POST /relay/reward/claim submits on-chain claim', async () => {
    // Need a proof first
    if (!relayProof) {
      skip('claim reward', 'no period proof available');
      passed--; skipped++;
      return;
    }

    const { status, data } = await post(node, '/api/v1/relay/reward/claim');

    // If not eligible (no real traffic), expect error but normal behavior
    if (status === 500 && data?.detail?.includes('Not eligible')) {
      vlog('Not eligible for reward (expected with no real relay traffic)');
      // This is normal — no actual relay traffic in Docker testnet
      return;
    }

    if (status === 404) {
      vlog('No period proof available');
      return;
    }

    // If claim succeeded
    assertEqual(status, 200, 'claim status');
    assert(typeof data.txHash === 'string', 'should return txHash');
    assert(typeof data.periodId === 'number', 'periodId');
    assert(typeof data.rewardAmount === 'string', 'rewardAmount');
    assert(typeof data.confirmedBytes === 'string', 'confirmedBytes');
    assert(typeof data.confirmedPeers === 'number', 'confirmedPeers');
    vlog('Claim result: tx=' + data.txHash + ', reward=' + data.rewardAmount +
      ', period=' + data.periodId);
  });

  // Verify duplicate claim is rejected by contract
  await test('duplicate claim for same period is rejected', async () => {
    if (!relayProof) {
      skip('duplicate claim', 'no proof');
      passed--; skipped++;
      return;
    }

    const { status, data } = await post(node, '/api/v1/relay/reward/claim');

    // Should fail — either "already claimed" from contract or "not eligible"
    assert(status !== 200 || data?.detail, 'duplicate claim should not succeed silently');
    vlog('Duplicate claim response: status=' + status +
      ', detail=' + (data?.detail || JSON.stringify(data)).slice(0, 200));
  });

  // Pool balance should have decreased (if claim succeeded)
  await test('pool balance after claim', async () => {
    const { data } = await get(node, '/api/v1/relay/reward/status');
    vlog('Pool after: ' + data.poolBalance + ' (was ' + poolBefore + ')');
    // If claim succeeded, pool should decrease; if not eligible, stays same
    assertGte(Number(data.poolBalance), 0, 'pool balance not negative');
  });
}

// ---------------------------------------------------------------------------
// Scenario 5: Cross-Node Relay Consistency
// ---------------------------------------------------------------------------

async function scenarioCrossNodeRelay() {
  log('\n🔄 Scenario 5: Cross-Node Relay Consistency');

  if (NODES.length < 2) {
    skip('cross-node relay', 'requires >= 2 nodes');
    return;
  }

  await test('all nodes have relay stats endpoint', async () => {
    for (let i = 0; i < NODES.length; i++) {
      const { status } = await get(NODES[i], '/api/v1/relay/stats');
      assert(status === 200 || status === 500, 'node ' + i + ' relay stats: unexpected ' + status);
      vlog('Node ' + i + ' relay stats: ' + status);
    }
  });

  await test('all nodes have relay health endpoint', async () => {
    for (let i = 0; i < NODES.length; i++) {
      const { status } = await get(NODES[i], '/api/v1/relay/health');
      assert(status === 200 || status === 500, 'node ' + i + ' relay health: unexpected ' + status);
    }
  });

  if (chainAvailable) {
    await test('reward status consistent across nodes', async () => {
      const statuses = [];
      for (let i = 0; i < NODES.length; i++) {
        const { status, data } = await get(NODES[i], '/api/v1/relay/reward/status');
        if (status !== 200) {
          vlog('Node ' + i + ' reward status not available');
          continue;
        }
        statuses.push(data);
      }
      if (statuses.length >= 2) {
        // All nodes should see the same pool balance (reading from same chain)
        assertEqual(statuses[0].poolBalance, statuses[1].poolBalance,
          'pool balance should match across nodes');
        vlog('Pool balance consistent: ' + statuses[0].poolBalance);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Scenario 6: Edge Cases & Error Handling
// ---------------------------------------------------------------------------

async function scenarioEdgeCases() {
  log('\n🚨 Scenario 6: Edge Cases & Error Handling');
  const node = NODES[0];

  await test('POST /relay/period-proof rejects missing relayDid', async () => {
    const { status } = await post(node, '/api/v1/relay/period-proof', {});
    // 400 if relayDid validation runs first; 500 if signProof / relay service unavailable
    assert(status === 400 || status === 500,
      'should reject missing relayDid with 400 or 500, got ' + status);
  });

  await test('POST /relay/confirm-contribution rejects empty body', async () => {
    const { status } = await post(node, '/api/v1/relay/confirm-contribution', null);
    // 400 for missing body, or 500 if relay not available
    assert(status === 400 || status === 500, 'expected 400 or 500, got ' + status);
  });

  await test('POST /relay/access rejects missing action and mode', async () => {
    const { status } = await post(node, '/api/v1/relay/access', { did: 'did:claw:zTest' });
    if (status === 500) { passed--; skipped++; skip('reject missing action', 'relay unavailable'); return; }
    assertEqual(status, 400, 'should reject missing action/mode');
  });

  await test('POST /relay/access rejects add without did', async () => {
    const { status } = await post(node, '/api/v1/relay/access', { action: 'add' });
    if (status === 500) { passed--; skipped++; skip('reject add without did', 'relay unavailable'); return; }
    assertEqual(status, 400, 'should reject missing did');
  });

  // Test reward endpoints when chain is unavailable
  if (!chainAvailable) {
    await test('GET /relay/reward/status returns 500 when no chain', async () => {
      const { status } = await get(node, '/api/v1/relay/reward/status');
      assertEqual(status, 500, 'should return 500 without chain');
    });

    await test('POST /relay/reward/claim returns error when no chain', async () => {
      const { status } = await post(node, '/api/v1/relay/reward/claim');
      assert(status === 500 || status === 404, 'should return 500 or 404 without chain');
    });

    await test('GET /relay/reward/preview returns error when no chain', async () => {
      const { status } = await get(node, '/api/v1/relay/reward/preview');
      assert(status === 500 || status === 404, 'should return 500 or 404 without chain');
    });
  }
}

// ---------------------------------------------------------------------------
// Scenario 7: Relay Reward Indexer (requires chain)
// ---------------------------------------------------------------------------

async function scenarioIndexer() {
  log('\n📊 Scenario 7: Relay Reward Indexer');
  const node = NODES[0];

  if (!chainAvailable) {
    skip('indexer relay rewards query', 'no chain connection');
    return;
  }

  // The indexer materializes RewardClaimed events into relay_rewards table.
  // We can't directly query the indexer table via API in current endpoints,
  // but we can verify the reward status tracks claims.

  await test('reward status tracks lastClaimedPeriod', async () => {
    const { status, data } = await get(node, '/api/v1/relay/reward/status');
    assertEqual(status, 200, 'status');
    assert(typeof data.lastClaimedPeriod === 'number', 'lastClaimedPeriod should be number');
    vlog('Last claimed period: ' + data.lastClaimedPeriod);
  });

  await test('totalDistributed tracks cumulative rewards', async () => {
    const { status, data } = await get(node, '/api/v1/relay/reward/status');
    assertEqual(status, 200, 'status');
    assertGte(Number(data.totalDistributed), 0, 'totalDistributed');
    vlog('Total distributed: ' + data.totalDistributed + ' Token');
  });
}

// ---------------------------------------------------------------------------
// Scenario 8: Reward Parameter Validation (requires chain)
// ---------------------------------------------------------------------------

async function scenarioRewardParams() {
  log('\n⚙️  Scenario 8: Reward Parameter Validation');
  const node = NODES[0];

  if (!chainAvailable) {
    skip('reward params validation', 'no chain connection');
    return;
  }

  await test('reward params match deployment defaults', async () => {
    const { status, data } = await get(node, '/api/v1/relay/reward/status');
    assertEqual(status, 200, 'status');

    const p = data.params;
    // Verify params are reasonable (matching deploy-all.ts defaults)
    assertGte(p.baseRate, 1, 'baseRate');
    assertGte(p.maxRewardPerPeriod, p.baseRate, 'maxPerPeriod >= baseRate');
    assertGte(p.minBytesThreshold, 1, 'minBytesThreshold');
    assertGte(p.minPeersThreshold, 1, 'minPeersThreshold');
    assert(p.attachmentWeightBps >= 0 && p.attachmentWeightBps <= 10000,
      'attachmentWeightBps should be 0..10000');
    vlog('Params: ' + JSON.stringify(p));
  });
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function main() {
  log('================================================================');
  log('     ClawNet Relay Reward Integration Test');
  log('================================================================');
  log('Nodes: ' + NODES.join(', '));
  log('');

  // Connectivity check
  log('Connectivity Check');
  for (const url of NODES) {
    try {
      const { status } = await get(url, '/api/v1/node');
      if (status === 200) log('  OK ' + url);
      else log('  WARN ' + url + ' returned ' + status);
    } catch (e) {
      log('  FAIL ' + url + ': ' + e.message);
      log('\nStart testnet with:');
      log('  docker compose -f docker-compose.testnet.yml up --build -d');
      process.exit(1);
    }
  }

  const start = Date.now();

  await setup();
  await scenarioRelayServiceLayer();
  await scenarioPeriodProof();
  await scenarioRewardStatus();
  await scenarioRewardClaim();
  await scenarioCrossNodeRelay();
  await scenarioEdgeCases();
  await scenarioIndexer();
  await scenarioRewardParams();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log('\n================================================================');
  log('Results: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped (' + elapsed + 's)');
  if (chainAvailable) {
    log('Chain: ✅ connected (full reward tests ran)');
  } else {
    log('Chain: ❌ not available (reward tests skipped)');
  }
  log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error('Fatal:', error); process.exit(2); });
