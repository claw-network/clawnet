export interface MonitoringThresholds {
  errorRateWarnRatio: number;
  errorRateCriticalRatio: number;
  requestP95WarnMs: number;
  requestP95CriticalMs: number;
  maintenanceStaleWarnSec: number;
  maintenanceStaleCriticalSec: number;
}

export interface HttpRequestMetricInput {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  atMs?: number;
}

export interface MailboxMaintenanceMetricInput {
  cleanup: {
    removed: number;
    remaining: number;
    sweptAtMs: number;
  };
  retraction: {
    retracted: number;
    checkedAtMs: number;
  };
}

export interface MonitoringAlert {
  code: string;
  level: 'OK' | 'WARN' | 'CRITICAL';
  title: string;
  value: number;
  threshold: number;
  message: string;
}

export interface NodeMetricsSnapshot {
  generatedAt: string;
  uptimeSec: number;
  totals: {
    requests: number;
    status2xx: number;
    status4xx: number;
    status5xx: number;
    statusOther: number;
    errorRateRatio: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  routes: Array<{
    path: string;
    count: number;
    errorRateRatio: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    lastStatus: number;
    lastSeenAt: string;
  }>;
  mailboxMaintenance: {
    runs: number;
    totalCleanupRemoved: number;
    totalRetracted: number;
    lastRunAt?: string;
    lastCleanupRemoved: number;
    lastRemaining: number;
    lastRetracted: number;
    staleSec: number;
  };
  alerts: MonitoringAlert[];
}

export interface NodeMonitoringClock {
  nowMs(): number;
}

interface RouteStat {
  count: number;
  status4xx: number;
  status5xx: number;
  totalLatencyMs: number;
  latencySamples: number[];
  lastStatus: number;
  lastSeenAtMs: number;
}

const SYSTEM_CLOCK: NodeMonitoringClock = {
  nowMs: () => Date.now(),
};

const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  errorRateWarnRatio: 0.02,
  errorRateCriticalRatio: 0.05,
  requestP95WarnMs: 250,
  requestP95CriticalMs: 500,
  maintenanceStaleWarnSec: 180,
  maintenanceStaleCriticalSec: 300,
};

const MAX_GLOBAL_LATENCY_SAMPLES = 5_000;
const MAX_ROUTE_LATENCY_SAMPLES = 400;

export class NodeMonitoringService {
  private readonly startedAtMs: number;
  private readonly routeStats = new Map<string, RouteStat>();
  private readonly totalLatencySamples: number[] = [];

  private totalRequests = 0;
  private status2xx = 0;
  private status4xx = 0;
  private status5xx = 0;
  private statusOther = 0;
  private totalLatencyMs = 0;

  private mailboxRuns = 0;
  private totalCleanupRemoved = 0;
  private totalRetracted = 0;
  private lastMailboxRunAtMs = 0;
  private lastCleanupRemoved = 0;
  private lastRemaining = 0;
  private lastRetracted = 0;

  private readonly thresholds: MonitoringThresholds;
  private readonly clock: NodeMonitoringClock;

  constructor(options?: { thresholds?: Partial<MonitoringThresholds>; clock?: NodeMonitoringClock }) {
    this.clock = options?.clock ?? SYSTEM_CLOCK;
    this.startedAtMs = this.clock.nowMs();
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(options?.thresholds ?? {}),
    };
  }

  recordHttpRequest(input: HttpRequestMetricInput): void {
    const nowMs = input.atMs ?? this.clock.nowMs();
    const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;
    const normalizedPath = this.normalizePath(input.path);

    this.totalRequests++;
    this.totalLatencyMs += durationMs;
    this.pushLimited(this.totalLatencySamples, durationMs, MAX_GLOBAL_LATENCY_SAMPLES);

    if (input.status >= 200 && input.status <= 299) {
      this.status2xx++;
    } else if (input.status >= 400 && input.status <= 499) {
      this.status4xx++;
    } else if (input.status >= 500 && input.status <= 599) {
      this.status5xx++;
    } else {
      this.statusOther++;
    }

    const current = this.routeStats.get(normalizedPath) ?? {
      count: 0,
      status4xx: 0,
      status5xx: 0,
      totalLatencyMs: 0,
      latencySamples: [],
      lastStatus: 0,
      lastSeenAtMs: nowMs,
    };

    current.count++;
    current.totalLatencyMs += durationMs;
    current.lastStatus = input.status;
    current.lastSeenAtMs = nowMs;
    this.pushLimited(current.latencySamples, durationMs, MAX_ROUTE_LATENCY_SAMPLES);

    if (input.status >= 400 && input.status <= 499) {
      current.status4xx++;
    } else if (input.status >= 500 && input.status <= 599) {
      current.status5xx++;
    }

    this.routeStats.set(normalizedPath, current);
  }

  recordMailboxMaintenance(input: MailboxMaintenanceMetricInput): void {
    const nowMs = this.clock.nowMs();
    this.mailboxRuns++;
    this.totalCleanupRemoved += Math.max(0, input.cleanup.removed);
    this.totalRetracted += Math.max(0, input.retraction.retracted);
    this.lastMailboxRunAtMs = nowMs;
    this.lastCleanupRemoved = Math.max(0, input.cleanup.removed);
    this.lastRemaining = Math.max(0, input.cleanup.remaining);
    this.lastRetracted = Math.max(0, input.retraction.retracted);
  }

  snapshot(options?: { nowMs?: number }): NodeMetricsSnapshot {
    const nowMs = options?.nowMs ?? this.clock.nowMs();
    const uptimeSec = Math.max(0, Math.floor((nowMs - this.startedAtMs) / 1000));
    const errorRateRatio = this.totalRequests > 0 ? this.status5xx / this.totalRequests : 0;
    const avgLatencyMs = this.totalRequests > 0 ? this.totalLatencyMs / this.totalRequests : 0;
    const p95LatencyMs = this.percentile(this.totalLatencySamples, 0.95);

    const routes = Array.from(this.routeStats.entries())
      .map(([path, stat]) => {
        const errors = stat.status4xx + stat.status5xx;
        return {
          path,
          count: stat.count,
          errorRateRatio: stat.count > 0 ? errors / stat.count : 0,
          avgLatencyMs: stat.count > 0 ? stat.totalLatencyMs / stat.count : 0,
          p95LatencyMs: this.percentile(stat.latencySamples, 0.95),
          lastStatus: stat.lastStatus,
          lastSeenAt: new Date(stat.lastSeenAtMs).toISOString(),
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const staleSec = this.lastMailboxRunAtMs > 0 ? Math.max(0, Math.floor((nowMs - this.lastMailboxRunAtMs) / 1000)) : uptimeSec;

    const alerts = this.evaluateAlerts({
      errorRateRatio,
      p95LatencyMs,
      staleSec,
    });

    return {
      generatedAt: new Date(nowMs).toISOString(),
      uptimeSec,
      totals: {
        requests: this.totalRequests,
        status2xx: this.status2xx,
        status4xx: this.status4xx,
        status5xx: this.status5xx,
        statusOther: this.statusOther,
        errorRateRatio,
        avgLatencyMs,
        p95LatencyMs,
      },
      routes,
      mailboxMaintenance: {
        runs: this.mailboxRuns,
        totalCleanupRemoved: this.totalCleanupRemoved,
        totalRetracted: this.totalRetracted,
        lastRunAt: this.lastMailboxRunAtMs > 0 ? new Date(this.lastMailboxRunAtMs).toISOString() : undefined,
        lastCleanupRemoved: this.lastCleanupRemoved,
        lastRemaining: this.lastRemaining,
        lastRetracted: this.lastRetracted,
        staleSec,
      },
      alerts,
    };
  }

  private evaluateAlerts(input: {
    errorRateRatio: number;
    p95LatencyMs: number;
    staleSec: number;
  }): MonitoringAlert[] {
    return [
      this.makeAlert(
        'HTTP_5XX_RATE',
        'HTTP 5xx rate',
        input.errorRateRatio,
        this.thresholds.errorRateWarnRatio,
        this.thresholds.errorRateCriticalRatio,
      ),
      this.makeAlert(
        'HTTP_P95_LATENCY',
        'HTTP p95 latency (ms)',
        input.p95LatencyMs,
        this.thresholds.requestP95WarnMs,
        this.thresholds.requestP95CriticalMs,
      ),
      this.makeAlert(
        'MAILBOX_MAINTENANCE_STALE',
        'Mailbox maintenance staleness (sec)',
        input.staleSec,
        this.thresholds.maintenanceStaleWarnSec,
        this.thresholds.maintenanceStaleCriticalSec,
      ),
    ];
  }

  private makeAlert(
    code: string,
    title: string,
    value: number,
    warn: number,
    critical: number,
  ): MonitoringAlert {
    let level: MonitoringAlert['level'] = 'OK';
    if (value >= critical) {
      level = 'CRITICAL';
    } else if (value >= warn) {
      level = 'WARN';
    }

    return {
      code,
      title,
      level,
      value,
      threshold: level === 'CRITICAL' ? critical : warn,
      message: `${title}=${value.toFixed(4)} (warn=${warn}, critical=${critical})`,
    };
  }

  private normalizePath(path: string): string {
    const safePath = path && path.startsWith('/') ? path : `/${path || ''}`;
    const segments = safePath.split('/').filter(Boolean).map((segment) => {
      const decoded = this.safeDecodeURIComponent(segment);
      if (/^did:claw:[A-Za-z0-9]+$/.test(decoded)) {
        return ':did';
      }
      if (/^0x[0-9a-fA-F]{64}$/.test(segment)) {
        return ':bytes32';
      }
      if (/^0x[0-9a-fA-F]{40}$/.test(segment)) {
        return ':address';
      }
      if (/^[0-9]+$/.test(segment)) {
        return ':id';
      }
      return segment;
    });
    return `/${segments.join('/')}`;
  }

  private safeDecodeURIComponent(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private pushLimited(target: number[], value: number, limit: number): void {
    target.push(value);
    if (target.length > limit) {
      target.shift();
    }
  }

  private percentile(samples: number[], ratio: number): number {
    if (samples.length === 0) {
      return 0;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
  }
}
