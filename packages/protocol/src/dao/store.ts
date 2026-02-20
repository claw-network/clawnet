/**
 * DAO Governance — Store
 *
 * Wraps the pure DAO state reducer behind an async interface
 * for future persistence compatibility.
 */

import { EventEnvelope } from '@clawnet/core/protocol';
import type {
  Proposal,
  ProposalStatus,
  Vote,
  Delegation,
  TimelockEntry,
  Treasury,
} from './types.js';
import {
  applyDaoEvent,
  checkProposalResult,
  createDaoState,
  DaoState,
  getDelegationsFrom,
  getDelegationsTo,
  getProposal,
  getProposalVotes,
  getTimelockEntry,
  getTreasury,
  listProposals,
  listTimelockEntries,
} from './state.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DaoStore {
  applyEvent(envelope: EventEnvelope): Promise<void>;
  applyEvents(envelopes: EventEnvelope[]): Promise<void>;
  getProposal(proposalId: string): Promise<Proposal | undefined>;
  listProposals(status?: ProposalStatus): Promise<Proposal[]>;
  getVotes(proposalId: string): Promise<Vote[]>;
  getDelegationsFrom(delegator: string): Promise<Delegation[]>;
  getDelegationsTo(delegate: string): Promise<Delegation[]>;
  getTimelockEntry(actionId: string): Promise<TimelockEntry | undefined>;
  listTimelockEntries(): Promise<TimelockEntry[]>;
  getTreasury(): Promise<Treasury>;
  checkProposalResult(
    proposalId: string,
    totalSupply: string,
  ): Promise<{ passed: boolean; forPct: number; quorumMet: boolean }>;
  getState(): Promise<DaoState>;
}

// ---------------------------------------------------------------------------
// Memory Implementation
// ---------------------------------------------------------------------------

export class MemoryDaoStore implements DaoStore {
  private state: DaoState = createDaoState();

  async applyEvent(envelope: EventEnvelope): Promise<void> {
    this.state = applyDaoEvent(this.state, envelope);
  }

  async applyEvents(envelopes: EventEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      this.state = applyDaoEvent(this.state, envelope);
    }
  }

  async getProposal(proposalId: string): Promise<Proposal | undefined> {
    return getProposal(this.state, proposalId);
  }

  async listProposals(status?: ProposalStatus): Promise<Proposal[]> {
    return listProposals(this.state, status);
  }

  async getVotes(proposalId: string): Promise<Vote[]> {
    return getProposalVotes(this.state, proposalId);
  }

  async getDelegationsFrom(delegator: string): Promise<Delegation[]> {
    return getDelegationsFrom(this.state, delegator);
  }

  async getDelegationsTo(delegate: string): Promise<Delegation[]> {
    return getDelegationsTo(this.state, delegate);
  }

  async getTimelockEntry(actionId: string): Promise<TimelockEntry | undefined> {
    return getTimelockEntry(this.state, actionId);
  }

  async listTimelockEntries(): Promise<TimelockEntry[]> {
    return listTimelockEntries(this.state);
  }

  async getTreasury(): Promise<Treasury> {
    return getTreasury(this.state);
  }

  async checkProposalResult(
    proposalId: string,
    totalSupply: string,
  ): Promise<{ passed: boolean; forPct: number; quorumMet: boolean }> {
    return checkProposalResult(this.state, proposalId, totalSupply);
  }

  async getState(): Promise<DaoState> {
    return this.state;
  }
}
