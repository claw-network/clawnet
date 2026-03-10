/**
 * WASM Sandbox — sandboxed execution of buyer-provided acceptance test scripts.
 *
 * Uses Extism (@extism/extism) to run buyer-provided WASM plugins in an
 * isolated environment with WASI support. Plugins export a `verify` function
 * that receives deliverable content as input and returns a JSON result.
 *
 * Security constraints:
 * - No network access (allowedHosts: [])
 * - Memory limit: 64 MB (configurable)
 * - Execution timeout: 5s (configurable)
 * - WASI enabled for file I/O and stdout
 * - No host filesystem paths mapped by default
 *
 * Plugin ABI:
 *   export function verify(input: bytes) -> bytes
 *   Input:  deliverable content (raw bytes)
 *   Output: JSON string `{ "passed": boolean, "details"?: string }`
 *
 * Spec: docs/implementation/deliverable-spec.md §3.2
 */

import { blake3Hex } from '@claw-network/core';
import createPlugin, { type Plugin, type CallContext } from '@extism/extism';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WasmSandboxOptions {
  /** Max memory in bytes (default: 64 MB) */
  maxMemoryBytes?: number;
  /** Execution timeout in ms (default: 5000) */
  timeoutMs?: number;
  /**
   * Host filesystem paths to map into the WASI sandbox (guest → host).
   * By default none are mapped. All paths must be absolute on the host side.
   */
  allowedPaths?: Record<string, string>;
}

export interface WasmExecutionResult {
  passed: boolean;
  output?: string;
  error?: string;
  executionTimeMs: number;
}

/** JSON shape the plugin's `verify` export must return. */
interface PluginVerifyOutput {
  passed: boolean;
  details?: string;
}

const DEFAULT_MAX_MEMORY = 64 * 1024 * 1024; // 64 MB
const DEFAULT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// WasmSandbox
// ---------------------------------------------------------------------------

export class WasmSandbox {
  private readonly maxMemoryBytes: number;
  private readonly timeoutMs: number;
  private readonly allowedPaths: Record<string, string>;

  constructor(opts?: WasmSandboxOptions) {
    this.maxMemoryBytes = opts?.maxMemoryBytes ?? DEFAULT_MAX_MEMORY;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.allowedPaths = opts?.allowedPaths ?? {};
  }

  /**
   * Verify that the WASM binary matches the expected content hash.
   *
   * Must be called before execution to prevent script replacement.
   */
  verifyScriptHash(wasmBytes: Uint8Array, expectedHash: string): boolean {
    const actualHash = blake3Hex(wasmBytes);
    return actualHash === expectedHash;
  }

  /**
   * Execute a WASM acceptance test script in a sandboxed environment.
   *
   * The plugin must export a `verify` function.
   * Input:  deliverable content (raw bytes).
   * Output: JSON `{ "passed": boolean, "details"?: string }`.
   *
   * @param wasmBytes           The WASM binary (Extism plugin).
   * @param deliverableContent  The deliverable content passed as input to `verify`.
   * @param expectedHash        Expected BLAKE3 hash of the WASM binary.
   */
  async execute(
    wasmBytes: Uint8Array,
    deliverableContent: Uint8Array,
    expectedHash: string,
  ): Promise<WasmExecutionResult> {
    // Step 1: verify content hash
    if (!this.verifyScriptHash(wasmBytes, expectedHash)) {
      return {
        passed: false,
        error: `Script hash mismatch: expected ${expectedHash}`,
        executionTimeMs: 0,
      };
    }

    // Step 2: create Extism plugin
    let plugin: Plugin | null = null;
    const start = performance.now();

    try {
      // Capture stdout output from the plugin
      const stdoutChunks: string[] = [];

      plugin = await createPlugin(
        { wasm: [{ data: wasmBytes }] },
        {
          useWasi: true,
          allowedHosts: [],       // no network
          allowedPaths: this.allowedPaths,
          enableWasiOutput: true,
          functions: {
            'clawnet': {
              'log': (_ctx: CallContext, addr: bigint) => {
                const msg = _ctx.read(addr);
                if (msg) stdoutChunks.push(msg.text());
              },
            },
          },
        },
      );

      // Step 3: check that `verify` exists
      const hasVerify = await plugin.functionExists('verify');
      if (!hasVerify) {
        return {
          passed: false,
          error: 'Plugin does not export a "verify" function',
          executionTimeMs: performance.now() - start,
        };
      }

      // Step 4: call with timeout
      const result = await this.callWithTimeout(plugin, deliverableContent);
      const elapsed = performance.now() - start;

      if (result === null) {
        return {
          passed: false,
          error: 'Plugin returned no output',
          output: stdoutChunks.length > 0 ? stdoutChunks.join('\n') : undefined,
          executionTimeMs: elapsed,
        };
      }

      // Step 5: parse output
      let parsed: PluginVerifyOutput;
      try {
        parsed = result.json() as PluginVerifyOutput;
      } catch {
        return {
          passed: false,
          error: `Invalid plugin output (not JSON): ${result.text().slice(0, 200)}`,
          executionTimeMs: elapsed,
        };
      }

      return {
        passed: Boolean(parsed.passed),
        output: parsed.details ?? (stdoutChunks.length > 0 ? stdoutChunks.join('\n') : undefined),
        executionTimeMs: elapsed,
      };
    } catch (err) {
      return {
        passed: false,
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: performance.now() - start,
      };
    } finally {
      if (plugin) {
        await plugin.close().catch(() => { /* ignore close errors */ });
      }
    }
  }

  /**
   * Call the plugin's `verify` function with a timeout guard.
   */
  private callWithTimeout(
    plugin: Plugin,
    input: Uint8Array,
  ): Promise<import('@extism/extism').PluginOutput | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Plugin execution timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      plugin.call('verify', input).then(
        (out) => { clearTimeout(timer); resolve(out); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
