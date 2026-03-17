/**
 * Identity (DID) API.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  Identity,
  Capability,
  CapabilitiesResponse,
  RegisterCapabilityParams,
} from './types.js';

export class IdentityApi {
  constructor(private readonly http: HttpClient) {}

  /** Get this node's identity. */
  async get(opts?: RequestOptions): Promise<Identity> {
    return this.http.get<Identity>('/api/v1/identities/self', undefined, opts);
  }

  /** Resolve another agent's identity by DID. */
  async resolve(did: string, source?: 'store' | 'log', opts?: RequestOptions): Promise<Identity> {
    return this.http.get<Identity>(
      `/api/v1/identities/${encodeURIComponent(did)}`,
      source ? { source } : undefined,
      opts,
    );
  }

  /** List registered capabilities. */
  async listCapabilities(opts?: RequestOptions): Promise<CapabilitiesResponse> {
    const identity = await this.http.get<Record<string, unknown>>(
      '/api/v1/identities/self',
      undefined,
      opts,
    );
    const capabilities = Array.isArray(identity.capabilities) ? identity.capabilities : [];
    return { capabilities } as CapabilitiesResponse;
  }

  /** Register a new capability credential. */
  async registerCapability(
    params: RegisterCapabilityParams,
    opts?: RequestOptions,
  ): Promise<Capability> {
    return this.http.post<Capability>(
      `/api/v1/identities/${encodeURIComponent(params.did)}/capabilities`,
      params,
      opts,
    );
  }
}
