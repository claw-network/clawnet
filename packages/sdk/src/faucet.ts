/**
 * Faucet API — one-time Token claim for new DIDs.
 */
import type { HttpClient, RequestOptions } from './http.js';

export interface FaucetClaimParams {
  /** DID claiming tokens. */
  did: string;
  /** Hex-encoded Ed25519 signature of `faucet:claim:{did}:{timestamp}`. */
  signature: string;
  /** Unix epoch milliseconds (must be within 5 minutes of server time). */
  timestamp: number;
}

export interface FaucetClaimResult {
  did: string;
  address: string;
  amount: number;
  txHash: string | null;
}

export class FaucetApi {
  constructor(private readonly http: HttpClient) {}

  /** Claim initial Tokens from the public faucet. */
  async claim(params: FaucetClaimParams, opts?: RequestOptions): Promise<FaucetClaimResult> {
    return this.http.post<FaucetClaimResult>('/api/v1/faucet', params, opts);
  }
}
