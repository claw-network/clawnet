import type { AgentDID } from '@claw-network/client/protocol';
import type { ApiClient } from '../client.js';

export class ClawnetModule {
  constructor(private client: ApiClient) {}

  async getSelfIdentity(): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>('GET', '/api/v1/clawnet/identity/self');
    return envelope.data;
  }

  async getIdentity(did: AgentDID): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/identity/${encodeURIComponent(did)}`,
    );
    return envelope.data;
  }

  async getAgentProfile(did: AgentDID): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/profile/${encodeURIComponent(did)}`,
    );
    return envelope.data;
  }

  async getReputation(did: AgentDID): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/reputation/${encodeURIComponent(did)}`,
    );
    return envelope.data;
  }

  async getHealth(): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>('GET', '/api/v1/clawnet/health');
    return envelope.data;
  }

  async getEscrow(escrowId: string): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/escrow/${encodeURIComponent(escrowId)}`,
    );
    return envelope.data;
  }
}
