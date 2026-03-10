/**
 * JSON Schema validator for DeliverableEnvelope content (Phase 2B).
 *
 * Uses ajv@8 with the JSON Schema draft-07 dialect.
 * Schema references are resolved via a SSRF-safe fetch (RFC1918 blocked).
 *
 * Spec: docs/implementation/deliverable-spec.md §5.2
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
type AjvInstance = { compile(schema: unknown): AnyFn & { errors?: Array<{ instancePath?: string; message?: string }> } };

// Lazy-loaded to avoid top-level await in ESM
let _ajv: AjvInstance | null = null;

async function getAjv(): Promise<AjvInstance> {
  if (_ajv) return _ajv;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('ajv') as any;
  // ajv@8 CJS/ESM compat — may be .default or direct export
  const Ctor = (mod.default?.default ?? mod.default ?? mod) as new (opts: object) => AjvInstance;
  _ajv = new Ctor({ strict: false, allErrors: true });
  return _ajv;
}

import type { DeliverableEnvelope } from '@claw-network/protocol';
import { ssrfSafeFetch } from './ssrf-guard.js';

// ── SSRF-safe schema fetcher (delegates to shared guard) ──────────

async function safeFetchSchema(uri: string): Promise<Record<string, unknown>> {
  const resp = await ssrfSafeFetch(uri, { allowedSchemes: ['https:', 'http:'] });
  if (!resp.ok) throw new Error(`Schema fetch failed: HTTP ${resp.status}`);
  const json = await resp.json() as Record<string, unknown>;
  return json;
}

// ── Schema cache ────────────────────────────────────────────────

const schemaCache = new Map<string, AnyFn & { errors?: Array<{ instancePath?: string; message?: string }> }>();

// ── Validator ────────────────────────────────────────────────────

export interface SchemaCheckResult {
  passed: boolean;
  errors: string[];
}

export class SchemaValidator {
  /**
   * Validate `content` against the JSON Schema referenced in `envelope.schema.ref`.
   *
   * @param envelope  The DeliverableEnvelope (must have schema.ref).
   * @param content   Parsed JSON content to validate.
   */
  async validate(
    envelope: DeliverableEnvelope,
    content: unknown,
  ): Promise<SchemaCheckResult> {
    const schemaRef = envelope.schema?.ref;
    if (!schemaRef) {
      return { passed: true, errors: [] };
    }

    // Layer 2 JSON Schema validation only applies to JSON content.
    // Skip gracefully for other MIME types.
    const fmt = String(envelope.format ?? '');
    const isJson = fmt === 'application/json' || fmt === 'json' || fmt.includes('/json');
    if (!isJson) {
      return { passed: true, errors: [] };
    }

    let validate = schemaCache.get(schemaRef);
    if (!validate) {
      const ajv = await getAjv();
      const schema = await safeFetchSchema(schemaRef);
      validate = ajv.compile(schema);
      schemaCache.set(schemaRef, validate);
    }

    const valid = validate(content) as boolean;
    if (valid) {
      return { passed: true, errors: [] };
    }

    const errors = (validate.errors ?? []).map((e) => {
      const path = e.instancePath || '/';
      return `${path}: ${e.message ?? 'unknown error'}`;
    });
    return { passed: false, errors };
  }
}
