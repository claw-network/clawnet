import type {
  AgentDID,
  GroupChainState,
  GroupMemberRecord,
  GroupRecord,
} from '@claw-network/client/protocol';
import type {
  ApiListEnvelope,
  QueryValue,
  CreateGroupInput,
  InviteMemberInput,
  AcceptInviteInput,
  RemoveMemberInput,
  GroupMemberListInput,
} from '../types.js';
import type { ApiClient } from '../client.js';

export class GroupsModule {
  constructor(private client: ApiClient) {}

  async create(input: CreateGroupInput): Promise<{ txHash?: string; group: GroupRecord }> {
    const envelope = await this.client.requestData<{ txHash?: string; group: GroupRecord }>(
      'POST',
      '/api/v1/groups',
      input,
    );
    return envelope.data;
  }

  async get(groupId: string): Promise<GroupRecord> {
    const envelope = await this.client.requestData<GroupRecord>('GET', `/api/v1/groups/${groupId}`);
    return envelope.data;
  }

  async listMembers(
    groupId: string,
    input: GroupMemberListInput = {},
  ): Promise<ApiListEnvelope<GroupMemberRecord>> {
    const query: Record<string, QueryValue> = {
      view: input.view ?? 'all',
      page: input.page,
      per_page: input.perPage,
    };
    const envelope = await this.client.requestList<GroupMemberRecord>(
      'GET',
      `/api/v1/groups/${groupId}/members`,
      undefined,
      query,
    );
    return envelope;
  }

  async invite(
    groupId: string,
    input: InviteMemberInput,
  ): Promise<{ txHash?: string; inviteId: string; groupId: string }> {
    const envelope = await this.client.requestData<{ txHash?: string; inviteId: string; groupId: string }>(
      'POST',
      `/api/v1/groups/${groupId}/invites`,
      input,
    );
    return envelope.data;
  }

  async acceptInvite(
    groupId: string,
    inviteId: string,
    input: AcceptInviteInput,
  ): Promise<{ txHash?: string; groupId: string; inviteId: string }> {
    const envelope = await this.client.requestData<{ txHash?: string; groupId: string; inviteId: string }>(
      'POST',
      `/api/v1/groups/${groupId}/invites/${inviteId}/accept`,
      input,
    );
    return envelope.data;
  }

  async removeMember(groupId: string, memberDid: AgentDID, input: RemoveMemberInput): Promise<void> {
    await this.client.requestNoContent(
      'DELETE',
      `/api/v1/groups/${groupId}/members/${encodeURIComponent(memberDid)}`,
      input,
    );
  }

  async getChainState(groupId: string): Promise<GroupChainState> {
    const envelope = await this.client.requestData<GroupChainState>(
      'GET',
      `/api/v1/groups/${groupId}/chain-state`,
    );
    return envelope.data;
  }
}
