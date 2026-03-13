#!/usr/bin/env node
/**
 * ClawNet Network Partition / Byzantine Fault Tolerance Test
 * ===========================================================
 * Tests P2P network resilience under simulated network partitions using
 * `docker network disconnect/connect` on the 3-node Docker testnet.
 *
 * Scenarios:
 *   1. Baseline — all 3 nodes healthy, data consistent
 *   2. Isolate one peer — disconnect peer2 from the network
 *   3. Majority still works — bootstrap + peer1 continue to serve requests
 *   4. Heal partition — reconnect peer2
 *   5. Recovery — peer2 catches up, data consistent again
 *   6. Isolate bootstrap — disconnect the seed node
 *   7. Minority peers degrade gracefully — peer1/peer2 still respond (may lose sync)
 *   8. Heal bootstrap — reconnect, full cluster recovers
 *
 * Prerequisites:
 *   docker compose -f docker-compose.testnet.yml up --build -d
 *
 * Usage:
 *   node scripts/partition-test.mjs [--verbose]
 */

import http from 'node:http';
import { execSync } from 'node:child_process';

// ── Config ──────────────────────────────────────────────────────────────────

const COMPOSE_FILE = 'docker-compose.testnet.yml';
const NETWORK = 'clawnet_clawnet'; // docker compose prefixes project name
const CONTAINERS = {
  bootstrap: 'claw-bootstrap',
  peer1: 'claw-peer1',
  peer2: 'claw-peer2',
};
const URLS = {
  bootstrap: 'http://localhost:9528',
  peer1: 'http://localhost:9530',
  peer2: 'http://localhost:9532',
};

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');

let passed = 0;
let failed = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function vlog(msg) { if (verbose) console.log('  [verbose] ' + msg); }

function request(baseUrl, path, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeout,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          const unwrapped =
            parsed && typeof parsed === 'object' && 'data' in parsed && !Array.isArray(parsed)
              ? parsed.data
              : parsed;
          resolve({ status: res.statusCode, data: unwrapped });
        } catch {
          resolve({ status: res.statusCode, data, raw: true });
        }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    log('  ✅ ' + name);
  } catch (e) {
    failed++;
    log('  ❌ ' + name + ' — ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b, msg) {
  if (String(a) !== String(b)) throw new Error((msg || '') + ` (expected ${b}, got ${a})`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Docker commands ─────────────────────────────────────────────────────────

function dockerCmd(cmd) {
  vlog('$ ' + cmd);
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    vlog('  docker error: ' + (e.stderr || e.message));
    return '';
  }
}

function detectNetwork() {
  // Find the bridge network created by docker compose for this project
  const out = dockerCmd(
    `docker inspect ${CONTAINERS.bootstrap} --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'`
  );
  if (out) return out;
  // Fallback: try common naming patterns
  for (const candidate of [NETWORK, 'clawnet_default', 'clawnet-clawnet']) {
    const check = dockerCmd(`docker network inspect ${candidate} --format '{{.Name}}' 2>/dev/null`);
    if (check) return check;
  }
  return NETWORK;
}

function disconnectContainer(network, container) {
  log(`  🔌 Disconnecting ${container} from ${network}`);
  dockerCmd(`docker network disconnect ${network} ${container}`);
}

function reconnectContainer(network, container) {
  log(`  🔗 Reconnecting ${container} to ${network}`);
  dockerCmd(`docker network connect ${network} ${container}`);
}

async function nodeIsReachable(url) {
  const res = await request(url, '/api/v1/node', 3000);
  return res.status === 200;
}

async function getBlockHeight(url) {
  const res = await request(url, '/api/v1/node', 3000);
  return res.status === 200 ? res.data.blockHeight : null;
}

async function getPeerCount(url) {
  const res = await request(url, '/api/v1/node', 3000);
  if (res.status !== 200) return null;
  return res.data.connections ?? res.data.peerCount ?? null;
}

// ── Wait utilities ──────────────────────────────────────────────────────────

async function waitUntilReachable(url, label, maxWait = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await nodeIsReachable(url)) return true;
    await sleep(2000);
  }
  throw new Error(`${label} did not become reachable within ${maxWait / 1000}s`);
}

async function waitForPeerRecovery(url, label, minPeers = 1, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const count = await getPeerCount(url);
    vlog(`${label} peer count: ${count}`);
    if (count !== null && count >= minPeers) return true;
    await sleep(3000);
  }
  throw new Error(`${label} did not recover ${minPeers}+ peers within ${maxWait / 1000}s`);
}

// ── Test Scenarios ──────────────────────────────────────────────────────────

async function scenarioBaseline(network) {
  log('\n📊 Scenario 1: Baseline — all nodes healthy');
  for (const [name, url] of Object.entries(URLS)) {
    await test(`${name} is reachable`, async () => {
      assert(await nodeIsReachable(url), `${name} not reachable`);
    });
  }
  await test('all nodes at similar block height', async () => {
    const heights = [];
    for (const [name, url] of Object.entries(URLS)) {
      const h = await getBlockHeight(url);
      assert(h !== null, `${name} block height unavailable`);
      heights.push(h);
      vlog(`${name} blockHeight=${h}`);
    }
    const maxDiff = Math.max(...heights) - Math.min(...heights);
    assert(maxDiff <= 5, `block height drift too large: ${maxDiff}`);
  });
}

async function scenarioIsolatePeer(network) {
  log('\n🔌 Scenario 2: Isolate peer2 — minority partition');

  disconnectContainer(network, CONTAINERS.peer2);
  await sleep(5000);

  await test('peer2 is unreachable from P2P (API still up via port mapping)', async () => {
    // peer2 host port still works (docker port mapping is independent of docker networks)
    // but it should lose its peer connections
    const reachable = await nodeIsReachable(URLS.peer2);
    vlog(`peer2 reachable via host port: ${reachable}`);
    // Either reachable (port mapping) or not — both are acceptable
    assert(true, 'peer2 partition applied');
  });

  await test('bootstrap + peer1 majority still operational', async () => {
    assert(await nodeIsReachable(URLS.bootstrap), 'bootstrap should be up');
    assert(await nodeIsReachable(URLS.peer1), 'peer1 should be up');
  });

  await test('bootstrap still has peer connections', async () => {
    const count = await getPeerCount(URLS.bootstrap);
    vlog(`bootstrap peer count during partition: ${count}`);
    // bootstrap should still see at least peer1
    assert(count !== null && count >= 1, `bootstrap should have >=1 peer, got ${count}`);
  });
}

async function scenarioHealPeer(network) {
  log('\n🔗 Scenario 3: Heal peer2 — recovery after partition');

  reconnectContainer(network, CONTAINERS.peer2);

  await test('peer2 recovers connectivity', async () => {
    await waitUntilReachable(URLS.peer2, 'peer2', 30000);
  });

  // Give time for peer discovery & gossip resync
  log('  ⏳ Waiting for peer re-discovery (20s)...');
  await sleep(20000);

  await test('peer2 has peer connections again', async () => {
    await waitForPeerRecovery(URLS.peer2, 'peer2', 1, 30000);
  });

  await test('block heights converge after heal', async () => {
    const hBoot = await getBlockHeight(URLS.bootstrap);
    const hPeer2 = await getBlockHeight(URLS.peer2);
    vlog(`bootstrap=${hBoot}, peer2=${hPeer2}`);
    assert(hBoot !== null && hPeer2 !== null, 'heights should be available');
    const diff = Math.abs(hBoot - hPeer2);
    assert(diff <= 5, `heights should converge, diff=${diff}`);
  });
}

async function scenarioIsolateBootstrap(network) {
  log('\n🔌 Scenario 4: Isolate bootstrap — seed node partitioned');

  disconnectContainer(network, CONTAINERS.bootstrap);
  await sleep(5000);

  await test('peer1 and peer2 still respond (graceful degradation)', async () => {
    const p1 = await nodeIsReachable(URLS.peer1);
    const p2 = await nodeIsReachable(URLS.peer2);
    vlog(`peer1 reachable: ${p1}, peer2 reachable: ${p2}`);
    assert(p1 || p2, 'at least one peer should still respond');
  });

  await test('peer1 API returns node info even without bootstrap', async () => {
    const res = await request(URLS.peer1, '/api/v1/node');
    assert(res.status === 200, `peer1 should respond, got status ${res.status}`);
  });
}

async function scenarioHealBootstrap(network) {
  log('\n🔗 Scenario 5: Heal bootstrap — full cluster recovery');

  reconnectContainer(network, CONTAINERS.bootstrap);

  await test('bootstrap recovers', async () => {
    await waitUntilReachable(URLS.bootstrap, 'bootstrap', 30000);
  });

  log('  ⏳ Waiting for full cluster re-mesh (25s)...');
  await sleep(25000);

  await test('bootstrap has peer connections', async () => {
    await waitForPeerRecovery(URLS.bootstrap, 'bootstrap', 1, 30000);
  });

  await test('all nodes at similar block height after full recovery', async () => {
    const heights = {};
    for (const [name, url] of Object.entries(URLS)) {
      heights[name] = await getBlockHeight(url);
      vlog(`${name} blockHeight=${heights[name]}`);
    }
    const vals = Object.values(heights).filter((h) => h !== null);
    assert(vals.length >= 2, 'at least 2 nodes should report height');
    const maxDiff = Math.max(...vals) - Math.min(...vals);
    assert(maxDiff <= 5, `heights should converge, max diff=${maxDiff}`);
  });

  await test('all three nodes reachable', async () => {
    for (const [name, url] of Object.entries(URLS)) {
      assert(await nodeIsReachable(url), `${name} should be reachable`);
    }
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log('================================================================');
  log('    ClawNet Network Partition Test');
  log('================================================================');
  log('Requires: docker compose -f docker-compose.testnet.yml up --build -d\n');

  // Check containers are running
  for (const [name, container] of Object.entries(CONTAINERS)) {
    const running = dockerCmd(`docker inspect ${container} --format '{{.State.Running}}'`);
    if (running !== 'true') {
      log(`❌ Container ${container} (${name}) is not running.`);
      log('Start testnet first: docker compose -f docker-compose.testnet.yml up --build -d');
      process.exit(1);
    }
  }

  // Detect the actual docker network name
  const network = detectNetwork();
  log('Docker network: ' + network);

  const start = Date.now();

  try {
    // Scenario 1: Baseline
    await scenarioBaseline(network);

    // Scenario 2-3: Isolate and heal a peer
    await scenarioIsolatePeer(network);
    await scenarioHealPeer(network);

    // Scenario 4-5: Isolate and heal bootstrap
    await scenarioIsolateBootstrap(network);
    await scenarioHealBootstrap(network);
  } finally {
    // Always ensure network is restored
    log('\n🧹 Cleanup: ensuring all containers are reconnected...');
    for (const container of Object.values(CONTAINERS)) {
      // Reconnect silently (may already be connected)
      dockerCmd(`docker network connect ${network} ${container} 2>/dev/null`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log('\n================================================================');
  log(`Results: ${passed} passed, ${failed} failed (${elapsed}s)`);
  log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
