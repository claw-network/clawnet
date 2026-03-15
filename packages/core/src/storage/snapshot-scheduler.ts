import { EventStore } from './event-store.js';
import { SnapshotStore } from './snapshots.js';

export interface SnapshotSchedulePolicy {
  maxEvents: number;
  maxAgeMs: number;
}

export const DEFAULT_SNAPSHOT_POLICY: SnapshotSchedulePolicy = {
  maxEvents: 10_000,
  maxAgeMs: 60 * 60 * 1000,
};

export class SnapshotScheduler {
  private readonly startedAt: number;

  constructor(
    private readonly eventStore: EventStore,
    private readonly snapshotStore: SnapshotStore,
    private readonly policy: SnapshotSchedulePolicy = DEFAULT_SNAPSHOT_POLICY,
  ) {
    this.startedAt = Date.now();
  }

  async shouldSnapshot(now: number = Date.now()): Promise<boolean> {
    const logLength = await this.eventStore.getLogLength();
    if (logLength <= 0) {
      return false;
    }

    const latestSnapshot = await this.snapshotStore.loadLatestSnapshot();
    if (!latestSnapshot) {
      const ageMs = now - this.startedAt;
      return logLength >= this.policy.maxEvents || ageMs >= this.policy.maxAgeMs;
    }

    const seq = await this.eventStore.getEventSeq(latestSnapshot.at);
    if (seq !== null) {
      const eventsSince = logLength - (seq + 1);
      if (eventsSince >= this.policy.maxEvents) {
        return true;
      }
    }

    const meta = await this.snapshotStore.loadLatestSnapshotMeta();
    if (meta?.createdAt) {
      const ageMs = now - Date.parse(meta.createdAt);
      if (ageMs >= this.policy.maxAgeMs) {
        return true;
      }
    }

    return false;
  }
}
