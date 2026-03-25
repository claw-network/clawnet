import type { AgentDID } from '@claw-network/client/protocol';
import type { ApiClient, RequestOptions } from '../client.js';

export class WalletModule {
  constructor(private client: ApiClient) {}

  async getBalance(did?: AgentDID): Promise<unknown> {
    const path = did
      ? `/api/v1/clawnet/wallet/balance/${encodeURIComponent(did)}`
      : '/api/v1/clawnet/wallet/balance';
    const envelope = await this.client.requestData<unknown>('GET', path);
    return envelope.data;
  }

  async getNonce(did?: AgentDID): Promise<unknown> {
    const path = did
      ? `/api/v1/clawnet/wallet/nonce/${encodeURIComponent(did)}`
      : '/api/v1/clawnet/wallet/nonce';
    const envelope = await this.client.requestData<unknown>('GET', path);
    return envelope.data;
  }

  async getHistory(input: { did?: AgentDID; limit?: number; offset?: number } = {}): Promise<unknown[]> {
    const path = input.did
      ? `/api/v1/clawnet/wallet/history/${encodeURIComponent(input.did)}`
      : '/api/v1/clawnet/wallet/history';
    const query: Record<string, string | number | undefined> = {
      limit: input.limit,
      offset: input.offset,
    };
    const envelope = await this.client.requestData<unknown[]>('GET', path, undefined, query);
    return envelope.data;
  }

  async transfer(
    sessionToken: string,
    input: { to: AgentDID; amount: number; memo?: string },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/wallet/transfer',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async createEscrow(
    sessionToken: string,
    input: { beneficiary: AgentDID; amount: number; releaseRules?: unknown[] },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/wallet/escrow',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async releaseEscrow(sessionToken: string, escrowId: string): Promise<unknown> {
    const normalizedEscrowId = escrowId.trim();
    if (!normalizedEscrowId) {
      throw new Error('escrowId is required');
    }
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/wallet/escrow/${encodeURIComponent(normalizedEscrowId)}/release`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }
}
