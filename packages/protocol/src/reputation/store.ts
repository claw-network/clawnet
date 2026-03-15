import { EventEnvelope } from '@claw-network/core/protocol';
import { ReputationDimension } from './scoring.js';
import {
  addReputationRecord,
  applyReputationEvent,
  buildReputationProfile,
  createReputationState,
  getReputationRecords,
  mergeReputationRecords,
  ReputationProfile,
  ReputationProfileOptions,
  ReputationRecord,
  ReputationState,
} from './state.js';

export interface ReputationStore {
  applyEvent(envelope: EventEnvelope): Promise<void>;
  applyEvents(envelopes: EventEnvelope[]): Promise<void>;
  addRecord(record: ReputationRecord): Promise<void>;
  mergeRecords(records: ReputationRecord[]): Promise<number>;
  getRecords(target?: string, dimension?: ReputationDimension): Promise<ReputationRecord[]>;
  getProfile(target: string, options?: ReputationProfileOptions): Promise<ReputationProfile>;
  listTargets(): Promise<string[]>;
}

export class MemoryReputationStore implements ReputationStore {
  private state: ReputationState = createReputationState();

  async applyEvent(envelope: EventEnvelope): Promise<void> {
    this.state = applyReputationEvent(this.state, envelope);
  }

  async applyEvents(envelopes: EventEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      this.state = applyReputationEvent(this.state, envelope);
    }
  }

  async addRecord(record: ReputationRecord): Promise<void> {
    this.state = addReputationRecord(this.state, record);
  }

  async mergeRecords(records: ReputationRecord[]): Promise<number> {
    const result = mergeReputationRecords(this.state, records);
    this.state = result.state;
    return result.added;
  }

  async getRecords(
    target?: string,
    dimension?: ReputationDimension,
  ): Promise<ReputationRecord[]> {
    if (!target) {
      return [...this.state.records];
    }
    return getReputationRecords(this.state, target, dimension);
  }

  async getProfile(
    target: string,
    options?: ReputationProfileOptions,
  ): Promise<ReputationProfile> {
    return buildReputationProfile(this.state, target, options);
  }

  async listTargets(): Promise<string[]> {
    return Object.keys(this.state.recordsByTarget);
  }
}
