/**
 * Tests for assertion-runner.ts — Phase 3 declarative acceptance testing.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveField,
  runAcceptanceTest,
  runAcceptanceTests,
  type AcceptanceTest,
} from '../src/deliverables/assertion-runner.js';

// ── resolveField ─────────────────────────────────────────────

describe('resolveField', () => {
  const obj = {
    name: 'alice',
    nested: { value: 42, arr: [10, 20, 30] },
    items: [{ id: 'a' }, { id: 'b' }],
  };

  it('resolves top-level field', () => {
    expect(resolveField(obj, '$.name')).toBe('alice');
  });

  it('resolves nested dotted path', () => {
    expect(resolveField(obj, '$.nested.value')).toBe(42);
  });

  it('resolves array index', () => {
    expect(resolveField(obj, '$.nested.arr[1]')).toBe(20);
  });

  it('resolves nested array object', () => {
    expect(resolveField(obj, '$.items[0].id')).toBe('a');
  });

  it('returns undefined for missing path', () => {
    expect(resolveField(obj, '$.nonexistent.field')).toBeUndefined();
  });

  it('returns the root object for "$"', () => {
    expect(resolveField(obj, '$')).toBe(obj);
  });

  it('works without $. prefix', () => {
    expect(resolveField(obj, 'name')).toBe('alice');
  });

  it('returns undefined for null input', () => {
    expect(resolveField(null, '$.x')).toBeUndefined();
  });
});

// ── runAcceptanceTest ────────────────────────────────────────

describe('runAcceptanceTest', () => {
  const content = {
    status: 'complete',
    score: 85,
    tags: ['ml', 'nlp'],
    output: 'Hello world from the model',
  };

  it('eq operator passes', () => {
    const test: AcceptanceTest = {
      id: 't1', name: 'check status', type: 'assertion', required: true,
      assertions: [{ field: '$.status', operator: 'eq', value: 'complete' }],
    };
    const result = runAcceptanceTest(test, content);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].passed).toBe(true);
  });

  it('eq operator fails', () => {
    const test: AcceptanceTest = {
      id: 't2', name: 'check status', type: 'assertion', required: true,
      assertions: [{ field: '$.status', operator: 'eq', value: 'pending' }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(false);
  });

  it('gt operator passes', () => {
    const test: AcceptanceTest = {
      id: 't3', name: 'score above 80', type: 'assertion', required: true,
      assertions: [{ field: '$.score', operator: 'gt', value: 80 }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(true);
  });

  it('lt operator passes', () => {
    const test: AcceptanceTest = {
      id: 't4', name: 'score below 90', type: 'assertion', required: true,
      assertions: [{ field: '$.score', operator: 'lt', value: 90 }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(true);
  });

  it('contains operator on string', () => {
    const test: AcceptanceTest = {
      id: 't5', name: 'output has hello', type: 'assertion', required: true,
      assertions: [{ field: '$.output', operator: 'contains', value: 'Hello' }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(true);
  });

  it('contains operator on array', () => {
    const test: AcceptanceTest = {
      id: 't6', name: 'tags include ml', type: 'assertion', required: true,
      assertions: [{ field: '$.tags', operator: 'contains', value: 'ml' }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(true);
  });

  it('matches operator with regex', () => {
    const test: AcceptanceTest = {
      id: 't7', name: 'output matches pattern', type: 'assertion', required: true,
      assertions: [{ field: '$.output', operator: 'matches', value: '^Hello.*model$' }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(true);
  });

  it('matches operator fails on invalid regex gracefully', () => {
    const test: AcceptanceTest = {
      id: 't8', name: 'bad regex', type: 'assertion', required: true,
      assertions: [{ field: '$.output', operator: 'matches', value: '[invalid' }],
    };
    expect(runAcceptanceTest(test, content).passed).toBe(false);
  });

  it('multiple assertions — all pass', () => {
    const test: AcceptanceTest = {
      id: 't9', name: 'multi check', type: 'assertion', required: true,
      assertions: [
        { field: '$.status', operator: 'eq', value: 'complete' },
        { field: '$.score', operator: 'gt', value: 50 },
      ],
    };
    const result = runAcceptanceTest(test, content);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('multiple assertions — one fails', () => {
    const test: AcceptanceTest = {
      id: 't10', name: 'partial fail', type: 'assertion', required: true,
      assertions: [
        { field: '$.status', operator: 'eq', value: 'complete' },
        { field: '$.score', operator: 'gt', value: 100 },
      ],
    };
    const result = runAcceptanceTest(test, content);
    expect(result.passed).toBe(false);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
  });

  it('manual type always returns not passed', () => {
    const test: AcceptanceTest = { id: 'm1', name: 'manual', type: 'manual', required: true };
    expect(runAcceptanceTest(test, content).passed).toBe(false);
  });

  it('script type returns not implemented', () => {
    const test: AcceptanceTest = { id: 's1', name: 'script', type: 'script', required: true, scriptHash: 'abc' };
    const result = runAcceptanceTest(test, content);
    expect(result.passed).toBe(false);
    expect(result.results[0].error).toContain('not yet implemented');
  });

  it('empty assertions pass', () => {
    const test: AcceptanceTest = { id: 'e1', name: 'empty', type: 'assertion', required: true, assertions: [] };
    expect(runAcceptanceTest(test, content).passed).toBe(true);
  });
});

// ── runAcceptanceTests (aggregate) ───────────────────────────

describe('runAcceptanceTests', () => {
  const content = { value: 10 };

  it('all required tests pass → passed', () => {
    const tests: AcceptanceTest[] = [
      { id: 'r1', name: 'check', type: 'assertion', required: true, assertions: [{ field: '$.value', operator: 'eq', value: 10 }] },
    ];
    expect(runAcceptanceTests(tests, content).passed).toBe(true);
  });

  it('required test fails → not passed', () => {
    const tests: AcceptanceTest[] = [
      { id: 'r2', name: 'check', type: 'assertion', required: true, assertions: [{ field: '$.value', operator: 'eq', value: 99 }] },
    ];
    expect(runAcceptanceTests(tests, content).passed).toBe(false);
  });

  it('non-required test fails → still passed', () => {
    const tests: AcceptanceTest[] = [
      { id: 'o1', name: 'optional', type: 'assertion', required: false, assertions: [{ field: '$.value', operator: 'eq', value: 99 }] },
    ];
    expect(runAcceptanceTests(tests, content).passed).toBe(true);
  });

  it('mixed: required passes + optional fails → passed', () => {
    const tests: AcceptanceTest[] = [
      { id: 'r3', name: 'required', type: 'assertion', required: true, assertions: [{ field: '$.value', operator: 'eq', value: 10 }] },
      { id: 'o2', name: 'optional', type: 'assertion', required: false, assertions: [{ field: '$.value', operator: 'gt', value: 100 }] },
    ];
    const result = runAcceptanceTests(tests, content);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
  });
});
