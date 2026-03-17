/**
 * Declarative assertion runner for Phase 3 acceptance testing.
 *
 * Evaluates JSONPath-like field expressions against parsed deliverable content
 * and applies comparison operators (eq, gt, lt, contains, matches).
 *
 * Spec: docs/implementation/deliverable-spec.md §3.1
 */

import type {
  AcceptanceTest,
  AcceptanceTestResult,
  Assertion,
  AssertionTestResult,
} from './types.js';

// ── JSONPath-like field resolution ──────────────────────────

/**
 * Resolve a simple JSONPath-like expression against an object.
 *
 * Supports dot notation and bracket notation for array indices:
 *   - `$.name`         → obj.name
 *   - `$.items[0].id`  → obj.items[0].id
 *   - `$.a.b.c`        → obj.a.b.c
 *
 * Returns `undefined` if the path doesn't resolve.
 */
export function resolveField(obj: unknown, field: string): unknown {
  if (obj == null) return undefined;

  // Strip leading "$." if present
  let path = field;
  if (path.startsWith('$.')) path = path.slice(2);
  else if (path === '$') return obj;

  const segments = tokenizePath(path);
  let current: unknown = obj;

  for (const seg of segments) {
    if (current == null) return undefined;

    if (typeof seg === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[seg];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}

/** Tokenize "a.b[0].c" → ['a', 'b', 0, 'c'] */
function tokenizePath(path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([^.[]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[2] !== undefined) {
      tokens.push(Number(m[2]));
    } else {
      tokens.push(m[1]);
    }
  }
  return tokens;
}

// ── Operator evaluation ─────────────────────────────────────

function evalAssertion(actual: unknown, assertion: Assertion): { passed: boolean; actual: unknown } {
  const { operator, value: expected } = assertion;

  switch (operator) {
    case 'eq':
      return { passed: actual === expected, actual };

    case 'gt':
      return {
        passed: typeof actual === 'number' && typeof expected === 'number' && actual > expected,
        actual,
      };

    case 'lt':
      return {
        passed: typeof actual === 'number' && typeof expected === 'number' && actual < expected,
        actual,
      };

    case 'contains': {
      if (typeof actual === 'string' && typeof expected === 'string') {
        return { passed: actual.includes(expected), actual };
      }
      if (Array.isArray(actual)) {
        return { passed: actual.includes(expected), actual };
      }
      return { passed: false, actual };
    }

    case 'matches': {
      if (typeof actual !== 'string' || typeof expected !== 'string') {
        return { passed: false, actual };
      }
      try {
        return { passed: new RegExp(expected).test(actual), actual };
      } catch {
        return { passed: false, actual };
      }
    }

    default:
      return { passed: false, actual };
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Run a single acceptance test's assertions against parsed content.
 *
 * - `assertion` type: evaluates each assertion in `test.assertions`.
 * - `script` type: not implemented here (WASM sandbox — see Phase 3.2).
 * - `manual` type: always returns passed = false (requires human review).
 */
export function runAcceptanceTest(
  test: AcceptanceTest,
  content: unknown,
): AcceptanceTestResult {
  if (test.type === 'manual') {
    return {
      passed: false,
      results: [{ testId: test.id, passed: false, error: 'Manual review required' }],
    };
  }

  if (test.type === 'script') {
    return {
      passed: false,
      results: [{ testId: test.id, passed: false, error: 'WASM script execution not yet implemented' }],
    };
  }

  // type === 'assertion'
  if (!test.assertions || test.assertions.length === 0) {
    return { passed: true, results: [] };
  }

  const results: AssertionTestResult[] = [];
  let allPassed = true;

  for (const assertion of test.assertions) {
    const actual = resolveField(content, assertion.field);
    const { passed, actual: resolvedActual } = evalAssertion(actual, assertion);

    if (!passed) allPassed = false;

    results.push({
      testId: test.id,
      passed,
      actual: resolvedActual,
      expected: assertion.value,
    });
  }

  return { passed: allPassed, results };
}

/**
 * Run all acceptance tests against content.
 *
 * Returns aggregate result: `passed` is true only when all
 * **required** tests pass (non-required failures are recorded but don't
 * fail the overall result).
 */
export function runAcceptanceTests(
  tests: AcceptanceTest[],
  content: unknown,
): AcceptanceTestResult {
  const allResults: AssertionTestResult[] = [];
  let overallPassed = true;

  for (const test of tests) {
    const result = runAcceptanceTest(test, content);
    allResults.push(...result.results);

    if (!result.passed && test.required) {
      overallPassed = false;
    }
  }

  return { passed: overallPassed, results: allResults };
}
