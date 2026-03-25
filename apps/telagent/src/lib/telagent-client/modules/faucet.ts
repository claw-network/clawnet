import type { ApiClient, RequestOptions } from '../client.js';

export class FaucetModule {
  constructor(private client: ApiClient) {}

  async claim(sessionToken: string): Promise<{
    did: string;
    address: string;
    amount: number;
    txHash: string | null;
  }> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<{
      did: string;
      address: string;
      amount: number;
      txHash: string | null;
    }>('POST', '/api/v1/clawnet/faucet/claim', undefined, undefined, options);
    return envelope.data;
  }
}
