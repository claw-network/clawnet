import type { ConversationSummary, CreateConversationInput } from '@claw-network/client/protocol';
import type { ApiListEnvelope, QueryValue, ConversationListInput } from '../types.js';
import type { ApiClient } from '../client.js';

export class ConversationsModule {
  constructor(private client: ApiClient) {}

  async list(input: ConversationListInput = {}): Promise<ApiListEnvelope<ConversationSummary>> {
    const query: Record<string, QueryValue> = {
      page: input.page,
      per_page: input.perPage,
      sort: input.sort ?? 'last_message',
    };
    return this.client.requestList<ConversationSummary>('GET', '/api/v1/conversations', undefined, query);
  }

  async setPrivacy(
    conversationId: string,
    isPrivate: boolean,
  ): Promise<{ conversationId: string; private: boolean; updatedAtMs: number }> {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new Error('conversationId is required');
    }
    const envelope = await this.client.requestData<{ conversationId: string; private: boolean; updatedAtMs: number }>(
      'PUT',
      `/api/v1/conversations/${encodeURIComponent(normalizedConversationId)}/privacy`,
      { private: isPrivate },
    );
    return envelope.data;
  }

  async create(input: CreateConversationInput): Promise<ConversationSummary> {
    const envelope = await this.client.requestData<ConversationSummary>('POST', '/api/v1/conversations', input);
    return envelope.data;
  }

  async delete(conversationId: string): Promise<void> {
    await this.client.requestNoContent(
      'DELETE',
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
    );
  }
}
