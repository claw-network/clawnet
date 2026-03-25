import type { AgentDID, OwnerPermissions } from '@claw-network/client/protocol';
import type { AgentIdentityView } from '../types.js';
import type { ApiClient } from '../client.js';

export class IdentityModule {
  constructor(private client: ApiClient) {}

  async getSelfIdentity(): Promise<AgentIdentityView> {
    const envelope = await this.client.requestData<AgentIdentityView>('GET', '/api/v1/identities/self');
    return envelope.data;
  }

  async getIdentity(did: AgentDID): Promise<AgentIdentityView> {
    const envelope = await this.client.requestData<AgentIdentityView>(
      'GET',
      `/api/v1/identities/${encodeURIComponent(did)}`,
    );
    return envelope.data;
  }

  async getOwnerPermissions(): Promise<OwnerPermissions> {
    const envelope = await this.client.requestData<OwnerPermissions>('GET', '/api/v1/owner/permissions');
    return envelope.data;
  }
}
