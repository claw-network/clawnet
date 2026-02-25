/**
 * Test Helpers — assertion utilities and test runner
 * ===================================================
 */

let _verbose = false;
let _passed = 0;
let _failed = 0;
let _skipped = 0;

export function setVerbose(v) { _verbose = v; }

export function vlog(msg) {
  if (_verbose) console.log('  [v] ' + msg);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Assertions ────────────────────────────────────────────────────────
export function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

export function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label || 'mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

export function assertIn(value, list, label) {
  if (!list.includes(value)) {
    throw new Error(`${label || 'not in list'}: ${value} not in [${list}]`);
  }
}

export function assertOk(status, label) {
  if (status < 200 || status >= 300) {
    throw new Error(`${label || 'HTTP'}: expected 2xx, got ${status}`);
  }
}

export function assertOkOrConflict(status, label) {
  if ((status < 200 || status >= 300) && status !== 409) {
    throw new Error(`${label || 'HTTP'}: expected 2xx or 409, got ${status}`);
  }
}

// ── Test Runner ───────────────────────────────────────────────────────
export async function test(name, fn) {
  try {
    await fn();
    _passed++;
    console.log('  \u2705 ' + name);
  } catch (error) {
    _failed++;
    console.log('  \u274C ' + name);
    console.log('     ' + (error.message || error));
    if (_verbose && error.stack) {
      console.log('     ' + error.stack.split('\n').slice(1, 3).join('\n     '));
    }
  }
}

export function skip(name, reason) {
  _skipped++;
  console.log('  \u23ED\uFE0F  ' + name + ' (' + reason + ')');
}

export function getResults() {
  return { passed: _passed, failed: _failed, skipped: _skipped };
}

export function resetResults() {
  _passed = 0;
  _failed = 0;
  _skipped = 0;
}

export function printResults() {
  const total = _passed + _failed + _skipped;
  console.log('');
  console.log('══════════════════════════════════════════');
  console.log(`  Results: ${_passed} passed, ${_failed} failed, ${_skipped} skipped / ${total} total`);
  console.log('══════════════════════════════════════════');
}
