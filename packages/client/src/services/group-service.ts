import {
  ErrorCodes,
  TelagentError,
  hashDid,
  isDidClaw,
  type AgentDID,
  type GroupChainState,
  type GroupMemberRecord,
  type GroupRecord,
  type GroupState,
  type MembershipState,
} from '../protocol/index.js';

import type { ContractProvider } from './contract-provider.js';
import type { IdentityAdapterService } from './identity-adapter-service.js';
import type { GroupRepository } from '../storage/group-repository.js';

export interface CreateGroupInput {
  creatorDid: AgentDID;
  groupId: string;
  groupDomain: string;
  domainProofHash: string;
  initialMlsStateHash: string;
}

export interface InviteMemberInput {
  groupId: string;
  inviteId: string;
  inviterDid: AgentDID;
  inviteeDid: AgentDID;
  mlsCommitHash: string;
}

export interface AcceptInviteInput {
  groupId: string;
  inviteId: string;
  inviteeDid: AgentDID;
  mlsWelcomeHash: string;
}

export interface RemoveMemberInput {
  groupId: string;
  operatorDid: AgentDID;
  memberDid: AgentDID;
  mlsCommitHash: string;
}

export class GroupService {
  constructor(
    private readonly contracts: ContractProvider,
    private readonly identityAdapter: IdentityAdapterService,
    private readonly repo: GroupRepository,
  ) {}

  async createGroup(input: CreateGroupInput): Promise<{ txHash: string; group: GroupRecord }> {
    this.assertBytes32(input.groupId, 'groupId');
    this.assertBytes32(input.domainProofHash, 'domainProofHash');
    this.assertBytes32(input.initialMlsStateHash, 'initialMlsStateHash');

    const identity = await this.identityAdapter.assertControllerBySigner(input.creatorDid);

    const pendingGroup: GroupRecord = {
      groupId: input.groupId,
      creatorDid: input.creatorDid,
      creatorDidHash: identity.didHash,
      groupDomain: input.groupDomain,
      domainProofHash: input.domainProofHash,
      initialMlsStateHash: input.initialMlsStateHash,
      state: 'PENDING_ONCHAIN',
      createdAtMs: Date.now(),
    };
    this.repo.saveGroup(pendingGroup);
    this.repo.saveChainState({
      groupId: input.groupId,
      state: 'PENDING_ONCHAIN',
      updatedAtMs: Date.now(),
    });

    const tx = await this.contracts.telagentGroupRegistry.createGroup(
      input.groupId,
      identity.didHash,
      input.groupDomain,
      input.domainProofHash,
      input.initialMlsStateHash,
    );

    const receipt = await tx.wait();
    if (receipt?.status !== 1) {
      this.repo.updateGroupState(input.groupId, 'REORGED_BACK');
      this.repo.saveChainState({
        groupId: input.groupId,
        state: 'REORGED_BACK',
        pendingTxHash: tx.hash,
        updatedAtMs: Date.now(),
      });
      throw new TelagentError(ErrorCodes.CONFLICT, 'createGroup transaction failed');
    }

    const finalizedGroup: GroupRecord = {
      ...pendingGroup,
      state: 'ACTIVE',
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
    this.repo.saveGroup(finalizedGroup);
    this.repo.saveMember({
      groupId: input.groupId,
      did: input.creatorDid,
      didHash: identity.didHash,
      state: 'FINALIZED',
      joinedAtMs: Date.now(),
      txHash: receipt.hash,
    });
    this.repo.saveChainState({
      groupId: input.groupId,
      state: 'ACTIVE',
      pendingTxHash: tx.hash,
      finalizedTxHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      updatedAtMs: Date.now(),
    });
    this.repo.recordEvent({
      groupId: input.groupId,
      eventName: 'GroupCreated',
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      payload: {
        creatorDid: input.creatorDid,
        creatorDidHash: identity.didHash,
      },
    });

    return {
      txHash: receipt.hash,
      group: finalizedGroup,
    };
  }

  async inviteMember(input: InviteMemberInput): Promise<{ txHash: string }> {
    this.assertBytes32(input.groupId, 'groupId');
    this.assertBytes32(input.inviteId, 'inviteId');
    this.assertBytes32(input.mlsCommitHash, 'mlsCommitHash');

    const group = this.requireGroup(input.groupId);
    if (group.state !== 'ACTIVE') {
      throw new TelagentError(ErrorCodes.CONFLICT, 'Group is not active');
    }

    const inviter = await this.identityAdapter.assertControllerBySigner(input.inviterDid);
    if (inviter.didHash.toLowerCase() !== group.creatorDidHash.toLowerCase()) {
      throw new TelagentError(ErrorCodes.FORBIDDEN, 'Only group owner can invite members');
    }

    const invitee = await this.identityAdapter.assertActiveDid(input.inviteeDid);

    this.repo.saveMember({
      groupId: input.groupId,
      did: input.inviteeDid,
      didHash: invitee.didHash,
      state: 'PENDING',
      joinedAtMs: Date.now(),
      inviteId: input.inviteId,
    });

    const tx = await this.contracts.telagentGroupRegistry.inviteMember(
      input.groupId,
      input.inviteId,
      inviter.didHash,
      invitee.didHash,
      input.mlsCommitHash,
    );

    const receipt = await tx.wait();
    if (receipt?.status !== 1) {
      this.repo.saveMember({
        groupId: input.groupId,
        did: input.inviteeDid,
        didHash: invitee.didHash,
        state: 'REMOVED',
        joinedAtMs: Date.now(),
        inviteId: input.inviteId,
      });
      throw new TelagentError(ErrorCodes.CONFLICT, 'inviteMember transaction failed');
    }

    this.repo.recordEvent({
      groupId: input.groupId,
      eventName: 'MemberInvited',
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      payload: {
        inviteId: input.inviteId,
        inviterDid: input.inviterDid,
        inviteeDid: input.inviteeDid,
      },
    });

    return { txHash: receipt.hash };
  }

  async acceptInvite(input: AcceptInviteInput): Promise<{ txHash: string }> {
    this.assertBytes32(input.groupId, 'groupId');
    this.assertBytes32(input.inviteId, 'inviteId');
    this.assertBytes32(input.mlsWelcomeHash, 'mlsWelcomeHash');

    this.requireGroup(input.groupId);
    const invitee = await this.identityAdapter.assertControllerBySigner(input.inviteeDid);

    const tx = await this.contracts.telagentGroupRegistry.acceptInvite(
      input.groupId,
      input.inviteId,
      invitee.didHash,
      input.mlsWelcomeHash,
    );

    const receipt = await tx.wait();
    if (receipt?.status !== 1) {
      throw new TelagentError(ErrorCodes.CONFLICT, 'acceptInvite transaction failed');
    }

    this.repo.saveMember({
      groupId: input.groupId,
      did: input.inviteeDid,
      didHash: invitee.didHash,
      state: 'FINALIZED',
      joinedAtMs: Date.now(),
      inviteId: input.inviteId,
      txHash: receipt.hash,
    });

    this.repo.recordEvent({
      groupId: input.groupId,
      eventName: 'MemberAccepted',
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      payload: {
        inviteId: input.inviteId,
        inviteeDid: input.inviteeDid,
      },
    });

    return { txHash: receipt.hash };
  }

  async removeMember(input: RemoveMemberInput): Promise<{ txHash: string }> {
    this.assertBytes32(input.groupId, 'groupId');
    this.assertBytes32(input.mlsCommitHash, 'mlsCommitHash');

    const group = this.requireGroup(input.groupId);

    const operator = await this.identityAdapter.assertControllerBySigner(input.operatorDid);
    if (operator.didHash.toLowerCase() !== group.creatorDidHash.toLowerCase()) {
      throw new TelagentError(ErrorCodes.FORBIDDEN, 'Only group owner can remove members');
    }

    if (!isDidClaw(input.memberDid)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'memberDid must use did:claw format');
    }

    const memberDidHash = hashDid(input.memberDid);

    const tx = await this.contracts.telagentGroupRegistry.removeMember(
      input.groupId,
      operator.didHash,
      memberDidHash,
      input.mlsCommitHash,
    );

    const receipt = await tx.wait();
    if (receipt?.status !== 1) {
      throw new TelagentError(ErrorCodes.CONFLICT, 'removeMember transaction failed');
    }

    this.repo.saveMember({
      groupId: input.groupId,
      did: input.memberDid,
      didHash: memberDidHash,
      state: 'REMOVED',
      joinedAtMs: Date.now(),
      txHash: receipt.hash,
    });

    this.repo.recordEvent({
      groupId: input.groupId,
      eventName: 'MemberRemoved',
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      payload: {
        memberDid: input.memberDid,
      },
    });

    return { txHash: receipt.hash };
  }

  getGroup(groupId: string): GroupRecord {
    return this.requireGroup(groupId);
  }

  listGroups(state?: GroupState): GroupRecord[] {
    const groups = this.repo.listGroups();
    if (!state) {
      return groups;
    }
    return groups.filter((group) => group.state === state);
  }

  listMembers(groupId: string, state?: MembershipState): GroupMemberRecord[] {
    this.requireGroup(groupId);
    return this.repo.listMembers(groupId, state);
  }

  getChainState(groupId: string): GroupChainState {
    const state = this.repo.getChainState(groupId);
    if (state) {
      return state;
    }

    const group = this.requireGroup(groupId);
    return {
      groupId,
      state: group.state,
      finalizedTxHash: group.txHash,
      blockNumber: group.blockNumber,
      updatedAtMs: Date.now(),
    };
  }

  private requireGroup(groupId: string): GroupRecord {
    this.assertBytes32(groupId, 'groupId');
    const group = this.repo.getGroup(groupId);
    if (!group) {
      throw new TelagentError(ErrorCodes.NOT_FOUND, 'Group not found');
    }
    return group;
  }

  private assertBytes32(value: string, name: string): void {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${name} must be bytes32 hex string`);
    }
  }
}
