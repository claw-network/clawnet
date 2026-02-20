/**
 * ClawNet Test Helpers — assertion, logging, test runner utilities.
 */

// ── Logging ─────────────────────────────────────────────────────────────

let _verbose = false;
export function setVerbose(v) { _verbose = v; }

export function log(msg)  { console.log(msg); }
export function vlog(msg) { if (_verbose) console.log('  [v] ' + msg); }

// ── Assertions ──────────────────────────────────────────────────────────

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      (msg || 'mismatch') +
      ': expected ' + JSON.stringify(expected) +
      ', got ' + JSON.stringify(actual),
    );
  }
}

export function assertIn(value, list, msg) {
  if (!list.includes(value)) {
    throw new Error(
      (msg || 'not in list') +
      ': ' + JSON.stringify(value) +
      ' not in ' + JSON.stringify(list),
    );
  }
}

export function assertOk(status, msg) {
  assert(status >= 200 && status < 300, (msg || 'HTTP') + ': status ' + status);
}

export function assertOkOrConflict(status, msg) {
  assert(
    (status >= 200 && status < 300) || status === 409,
    (msg || 'HTTP') + ': status ' + status,
  );
}

// ── Test runner ─────────────────────────────────────────────────────────

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const failedTests = [];

export async function test(name, fn) {
  try {
    await fn();
    totalPassed++;
    log('  \u2705 ' + name);
  } catch (error) {
    totalFailed++;
    failedTests.push({ name, error: error.message || String(error) });
    log('  \u274C ' + name);
    log('     ' + (error.message || error));
    if (_verbose && error.stack) {
      log('     ' + error.stack.split('\n').slice(1, 3).join('\n     '));
    }
  }
}

export function skip(name, reason) {
  totalSkipped++;
  log('  \u23ED\uFE0F  ' + name + ' (' + reason + ')');
}

export function getResults() {
  return { passed: totalPassed, failed: totalFailed, skipped: totalSkipped, failedTests };
}

export function resetResults() {
  totalPassed = 0;
  totalFailed = 0;
  totalSkipped = 0;
  failedTests.length = 0;
}

export function printResults() {
  log('');
  log('================================================================');
  log(`Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
  log('================================================================');
  if (failedTests.length > 0) {
    log('');
    log('Failed tests:');
    for (const { name, error } of failedTests) {
      log('  - ' + name + ': ' + error);
    }
  }
}

// ── Async helpers ───────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
