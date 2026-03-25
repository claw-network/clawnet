import type { ApiClient, RequestOptions } from '../client.js';

export class SessionModule {
  constructor(private client: ApiClient) {}

  async unlock(input: {
    passphrase: string;
    ttlSeconds?: number;
    scope?: Array<'transfer' | 'escrow' | 'market' | 'contract' | 'reputation' | 'identity'>;
    maxOperations?: number;
  }): Promise<{
    sessionToken: string;
    expiresAt: string;
    scope: string[];
    did: string;
    permissions: {
      mode: 'observer' | 'intervener';
      interventionScopes: string[];
    };
  }> {
    const envelope = await this.client.requestData<{
      sessionToken: string;
      expiresAt: string;
      scope: string[];
      did: string;
      permissions: {
        mode: 'observer' | 'intervener';
        interventionScopes: string[];
      };
    }>('POST', '/api/v1/session/unlock', input);
    return envelope.data;
  }

  async lock(sessionToken: string): Promise<void> {
    const options: RequestOptions = { authToken: sessionToken };
    await this.client.requestNoContent('POST', '/api/v1/session/lock', undefined, undefined, options);
  }

  async getInfo(sessionToken: string): Promise<{
    active: boolean;
    expiresAt: string;
    scope: string[];
    operationsUsed: number;
    createdAt: string;
  }> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<{
      active: boolean;
      expiresAt: string;
      scope: string[];
      operationsUsed: number;
      createdAt: string;
    }>('GET', '/api/v1/session', undefined, undefined, options);
    return envelope.data;
  }
}
