import type { SelfProfile, PeerProfile, AgentDID } from '@claw-network/client/protocol';
import { TelagentSdkError } from '../errors.js';
import type { ApiClient } from '../client.js';

export class ProfileModule {
  constructor(private client: ApiClient) {}

  async getSelf(): Promise<SelfProfile> {
    const envelope = await this.client.requestData<SelfProfile>('GET', '/api/v1/profile');
    return envelope.data;
  }

  async updateSelf(input: Partial<Pick<SelfProfile, 'nickname' | 'avatarUrl' | 'nodeUrl'>>): Promise<SelfProfile> {
    const envelope = await this.client.requestData<SelfProfile>('PUT', '/api/v1/profile', input);
    return envelope.data;
  }

  async uploadAvatar(data: string, mimeType: string): Promise<{ avatarUrl: string }> {
    const envelope = await this.client.requestData<{ avatarUrl: string }>(
      'POST',
      '/api/v1/profile/avatar',
      { data, mimeType },
    );
    return envelope.data;
  }

  async getPeer(did: AgentDID): Promise<PeerProfile | null> {
    try {
      const envelope = await this.client.requestData<PeerProfile>(
        'GET',
        `/api/v1/profile/${encodeURIComponent(did)}`,
      );
      return envelope.data;
    } catch (err) {
      if (err instanceof TelagentSdkError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }
}
