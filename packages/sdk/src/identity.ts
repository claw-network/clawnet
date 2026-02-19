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
    return this.http.get<Identity>('/api/identity', undefined, opts);
  }

  /** Resolve another agent's identity by DID. */
  async resolve(did: string, source?: 'store' | 'log', opts?: RequestOptions): Promise<Identity> {
    return this.http.get<Identity>(
      `/api/identity/${encodeURIComponent(did)}`,
      source ? { source } : undefined,
      opts,
    );
  }

  /** List registered capabilities. */
  async listCapabilities(opts?: RequestOptions): Promise<CapabilitiesResponse> {
    return this.http.get<CapabilitiesResponse>('/api/identity/capabilities', undefined, opts);
  }

  /** Register a new capability credential. */
  async registerCapability(params: RegisterCapabilityParams, opts?: RequestOptions): Promise<Capability> {
    return this.http.post<Capability>('/api/identity/capabilities', params, opts);
  }
}
