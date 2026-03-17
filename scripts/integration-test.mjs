#!/usr/bin/env node
/**
 * ClawNet Integration Test Suite
 * =================================
 * Runs against a live multi-node testnet (Docker or local).
 *
 * Usage:
 *   node scripts/integration-test.mjs                     # default: 3 nodes
 *   node scripts/integration-test.mjs --nodes http://localhost:9528,http://localhost:9530
 *   node scripts/integration-test.mjs --verbose
 */

import http from 'node:http';
import https from 'node:https';

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
      path: url.pathname + url.search, method,
      headers,
      timeout: 10000,
    };
    const req = transport.request(opts, (res) => {
      // Follow redirects (301, 302, 307, 308) up to 5 times
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
          // Unwrap API response envelope { data: T, meta?, links? }
          const unwrapped = (parsed && typeof parsed === 'object' && 'data' in parsed && !Array.isArray(parsed))
            ? parsed.data : parsed;
          resolve({ status: res.statusCode, data: unwrapped, meta: parsed?.meta, links: parsed?.links, _raw: parsed });
        }
        catch { resolve({ status: res.statusCode, data, raw: true }); }
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
function vlog(msg) { if (verbose) console.log('  [verbose] ' + msg); }

async function test(name, fn) {
  try { await fn(); passed++; log('  \u2705 ' + name); }
  catch (error) { failed++; log('  \u274C ' + name); log('     ' + error.message); }
}

function skip(name, reason) { skipped++; log('  \u23ED\uFE0F  ' + name + ' (' + reason + ')'); }

function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEqual(a, e, m) {
  if (a !== e) throw new Error((m||'mismatch') + ': expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a));
}
function assertGte(a, min, m) {
  if (a < min) throw new Error((m||'too low') + ': expected >= ' + min + ', got ' + a);
}

const nodeDids = [];
function getNodeDid(i = 0) {
  if (nodeDids.length === 0) throw new Error('call testIdentity() first');
  return nodeDids[Math.min(i, nodeDids.length - 1)];
}

async function testIdentity() {
  log('\n\uD83C\uDD94 Identity');
  for (let i = 0; i < NODES.length; i++) {
    const url = NODES[i];
    await test('node ' + i + ' has identity', async () => {
      const { status, data } = await get(url, '/api/v1/identities/self');
      assertEqual(status, 200, 'status code');
      assert(typeof data.did === 'string' && data.did.startsWith('did:claw:'), 'valid DID');
      nodeDids.push(data.did);
      vlog('Node ' + i + ' DID: ' + data.did);
    });
  }
  if (nodeDids.length >= 2) {
    await test('all node DIDs are unique', async () => {
      assertEqual(new Set(nodeDids).size, nodeDids.length, 'unique DIDs');
    });
    await test('resolve node 0 DID from node 1', async () => {
      const did = nodeDids[0];
      const { status, data } = await get(NODES[1], '/api/v1/identities/' + encodeURIComponent(did));
      assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
      if (status === 200) assertEqual(data.did, did, 'resolved DID matches');
      vlog('Resolve from peer: status=' + status);
    });
  }
  await test('identity capabilities', async () => {
    const did = getNodeDid(0);
    const { status } = await get(NODES[0], '/api/v1/identities/' + encodeURIComponent(did) + '/capabilities');
    assertEqual(status, 200, 'status code');
  });
}

async function testNodeStatus() {
  log('\n\uD83D\uDCE1 Node Status & Connectivity');
  for (let i = 0; i < NODES.length; i++) {
    const url = NODES[i];
    await test('node ' + i + ' status responds', async () => {
      const { status, data } = await get(url, '/api/v1/node');
      assertEqual(status, 200, 'status code');
      assert(data.synced === true, 'expected synced=true');
      assert(typeof data.peerId === 'string' && data.peerId.length > 0, 'peerId non-empty');
      vlog('Peer ' + i + ': ' + data.peerId + ', uptime=' + data.uptime + 's');
    });
  }
  if (NODES.length >= 2) {
    await test('nodes have unique peer IDs', async () => {
      const ids = new Set();
      for (const url of NODES) { const { data } = await get(url, '/api/v1/node'); ids.add(data.peerId); }
      assertEqual(ids.size, NODES.length, 'peer ID uniqueness');
    });
    await test('bootstrap has peer connections', async () => {
      const { data } = await get(NODES[0], '/api/v1/node');
      assertGte(data.peers, 1, 'bootstrap peer count');
      vlog('Peers: ' + data.peers);
    });
    await test('peers list endpoint works', async () => {
      const { status } = await get(NODES[0], '/api/v1/node/peers');
      assertEqual(status, 200, 'status code');
    });
  }
}

async function testNodeConfig() {
  log('\n\u2699\uFE0F  Node Configuration');
  await test('config endpoint responds', async () => {
    const { status, data } = await get(NODES[0], '/api/v1/node/config');
    assertEqual(status, 200, 'status code');
    assert(typeof data === 'object', 'config should be object');
  });
}

async function testWallet() {
  log('\n\uD83D\uDCB0 Wallet Operations');
  const node = NODES[0];
  const did = getNodeDid(0);
  await test('get balance (own wallet)', async () => {
    const { status, data } = await get(node, '/api/v1/wallets/' + encodeURIComponent(did));
    assertEqual(status, 200, 'status code');
    assert(typeof data.balance === 'number' || typeof data.balance === 'string', 'balance should be number or string');
    vlog('Balance: ' + JSON.stringify(data));
  });
  await test('transfer tokens (requires passphrase)', async () => {
    const to = nodeDids.length >= 2 ? getNodeDid(1) : did;
    const { status, data } = await post(node, '/api/v1/transfers', {
      from: did, to, amount: 100, memo: 'integration-test',
    });
    vlog('Transfer: status=' + status + ', ' + JSON.stringify(data).slice(0, 200));
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  await test('get transaction history', async () => {
    const { status, data } = await get(node, '/api/v1/wallets/' + encodeURIComponent(did) + '/transactions');
    assertEqual(status, 200, 'status code');
    assert(Array.isArray(data), 'transactions should be array');
  });
}

async function testEscrow() {
  log('\n\uD83D\uDD10 Escrow Operations');
  const node = NODES[0];
  const did = getNodeDid(0);
  const beneficiary = nodeDids.length >= 2 ? getNodeDid(1) : did;
  await test('create escrow', async () => {
    const { status } = await post(node, '/api/v1/escrows', {
      depositor: did, beneficiary, amount: 50,
      releaseConditions: [{ type: 'manual' }],
    });
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  await test('get escrow by id', async () => {
    const { status } = await get(node, '/api/v1/escrows/nonexistent-id');
    assert(status === 200 || status === 404 || status === 400, 'expected 200/404/400, got ' + status);
  });
}

async function testReputation() {
  log('\n\u2B50 Reputation System');
  const node = NODES[0];
  const did = getNodeDid(0);
  await test('get reputation (own DID)', async () => {
    const { status } = await get(node, '/api/v1/reputations/' + encodeURIComponent(did));
    assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
  });
  await test('submit reputation review', async () => {
    const subject = nodeDids.length >= 2 ? getNodeDid(1) : did;
    const { status } = await post(node, '/api/v1/reputations/' + encodeURIComponent(subject) + '/reviews', {
      reviewer: did, dimension: 'quality',
      score: 5, evidence: 'integration-test',
    });
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  if (nodeDids.length >= 2) {
    await test('get reputation of peer from different node', async () => {
      const { status } = await get(NODES[1], '/api/v1/reputations/' + encodeURIComponent(getNodeDid(0)));
      assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
    });
  }
}

async function testContracts() {
  log('\n\uD83D\uDCDD Service Contracts');
  const node = NODES[0];
  const did = getNodeDid(0);
  const providerDid = nodeDids.length >= 2 ? getNodeDid(1) : did;
  await test('list contracts (empty)', async () => {
    const { status, data } = await get(node, '/api/v1/contracts');
    assertEqual(status, 200, 'status code');
    assert(Array.isArray(data.contracts ?? data), 'expected contract list');
  });
  await test('create contract', async () => {
    const { status } = await post(node, '/api/v1/contracts', {
      client: did, provider: providerDid,
      terms: { description: 'Integration test contract', deliverables: ['Test'] },
      payment: { totalAmount: '100', currency: 'Token' },
    });
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  await test('get contract (not found)', async () => {
    const { status } = await get(node, '/api/v1/contracts/nonexistent-id');
    assert(status === 404 || status === 400, 'expected 404/400, got ' + status);
  });
}

async function testMarkets() {
  log('\n\uD83C\uDFEA Markets');
  const node = NODES[0];
  const did = getNodeDid(0);
  await test('search markets', async () => {
    const { status } = await get(node, '/api/v1/markets/search');
    assertEqual(status, 200, 'status code');
  });
  await test('list info market', async () => {
    const { status } = await get(node, '/api/v1/markets/info');
    assertEqual(status, 200, 'status code');
  });
  await test('publish info listing', async () => {
    const { status } = await post(node, '/api/v1/markets/info', {
      provider: did, title: 'Test Info',
      description: 'Integration test', pricing: { model: 'fixed', price: '10' },
      category: 'data', tags: ['test'],
    });
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  await test('list task market', async () => {
    const { status } = await get(node, '/api/v1/markets/tasks');
    assertEqual(status, 200, 'status code');
  });
  await test('publish task listing', async () => {
    const { status } = await post(node, '/api/v1/markets/tasks', {
      client: did, title: 'Test Task',
      description: 'Integration test task', budget: '200',
      deadline: new Date(Date.now() + 86400000).toISOString(),
      skills: ['testing'],
    });
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  await test('list capability market', async () => {
    const { status } = await get(node, '/api/v1/markets/capabilities');
    assertEqual(status, 200, 'status code');
  });
}

async function testDAO() {
  log('\n\uD83C\uDFDB\uFE0F  DAO Governance');
  const node = NODES[0];
  const did = getNodeDid(0);
  await test('get DAO parameters', async () => {
    const { status } = await get(node, '/api/v1/dao/params');
    assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
  });
  await test('list proposals', async () => {
    const { status } = await get(node, '/api/v1/dao/proposals');
    assertEqual(status, 200, 'status code');
  });
  await test('get treasury', async () => {
    const { status } = await get(node, '/api/v1/dao/treasury');
    assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
  });
  await test('create proposal', async () => {
    const { status } = await post(node, '/api/v1/dao/proposals', {
      proposer: did, title: 'Test Proposal',
      description: 'This is a test proposal', category: 'parameter_change',
      actions: [],
    });
    assert(status >= 200 && status < 500, 'unexpected status: ' + status);
  });
  await test('list timelock items', async () => {
    const { status } = await get(node, '/api/v1/dao/timelock');
    assertEqual(status, 200, 'status code');
  });
  await test('get delegations', async () => {
    const { status } = await get(node, '/api/v1/dao/delegations?did=' + encodeURIComponent(did));
    assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
  });
}

async function testCrossNodePropagation() {
  log('\n\uD83D\uDD04 Cross-Node Event Propagation');
  if (NODES.length < 2) { skip('event propagation', 'requires >= 2 nodes'); return; }
  const nodeA = NODES[0];
  const nodeB = NODES[1];
  const didA = getNodeDid(0);
  await test('identity visible on peer node', async () => {
    const { status } = await get(nodeB, '/api/v1/identities/' + encodeURIComponent(didA));
    assert(status === 200 || status === 404, 'expected 200/404, got ' + status);
    vlog('Resolve A from B: status=' + status);
  });
  await test('wallet balance consistent across nodes', async () => {
    const balA = await get(nodeA, '/api/v1/wallets/' + encodeURIComponent(didA));
    const balB = await get(nodeB, '/api/v1/wallets/' + encodeURIComponent(didA));
    assertEqual(balA.status, 200, 'balance on A');
    assertEqual(balB.status, 200, 'balance on B');
    assertEqual(String(balA.data.balance), String(balB.data.balance), 'balance should match');
    vlog('Balance A=' + balA.data.balance + ', B=' + balB.data.balance);
  });
  await test('block height similar across nodes', async () => {
    const sA = await get(nodeA, '/api/v1/node');
    const sB = await get(nodeB, '/api/v1/node');
    const diff = Math.abs(sA.data.blockHeight - sB.data.blockHeight);
    assert(diff <= 5, 'block height diff too large: ' + diff);
    vlog('Heights: A=' + sA.data.blockHeight + ', B=' + sB.data.blockHeight);
  });
}

async function testErrorHandling() {
  log('\n\uD83D\uDEA8 Error Handling');
  const node = NODES[0];
  await test('404 on unknown endpoint', async () => {
    const { status } = await get(node, '/api/v1/nonexistent');
    assertEqual(status, 404, 'expected 404');
  });
  await test('400 on invalid POST body', async () => {
    const { status } = await post(node, '/api/v1/transfers', { invalid: true });
    assert(status === 400 || status === 422, 'expected 400/422, got ' + status);
  });
  await test('GET on POST-only endpoint returns 405 or 404', async () => {
    const { status } = await get(node, '/api/v1/transfers');
    assert(status === 404 || status === 405, 'expected 404/405, got ' + status);
  });
}

async function main() {
  log('================================================================');
  log('         ClawNet Integration Test Suite');
  log('================================================================');
  log('Nodes: ' + NODES.join(', '));
  log('\nConnectivity Check');
  for (const url of NODES) {
    try {
      const { status } = await get(url, '/api/v1/node');
      if (status === 200) { log('  OK ' + url); }
      else { log('  WARN ' + url + ' responded with ' + status); }
    } catch (e) {
      log('  FAIL ' + url + ' unreachable: ' + e.message);
      log('\nCannot reach testnet. Start with:');
      log('  docker compose -f docker-compose.testnet.yml up --build -d');
      process.exit(1);
    }
  }
  const start = Date.now();
  await testIdentity();
  await testNodeStatus();
  await testNodeConfig();
  await testWallet();
  await testEscrow();
  await testReputation();
  await testContracts();
  await testMarkets();
  await testDAO();
  await testCrossNodePropagation();
  await testErrorHandling();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log('\n================================================================');
  log('Results: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped (' + elapsed + 's)');
  log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error('Fatal error:', error); process.exit(2); });
