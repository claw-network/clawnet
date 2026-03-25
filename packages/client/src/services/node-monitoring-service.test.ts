import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeMonitoringService, type NodeMonitoringClock } from './node-monitoring-service.js';

interface MutableClock extends NodeMonitoringClock {
  tick(ms: number): void;
}

function createClock(startMs = 1_000_000): MutableClock {
  let nowMs = startMs;
  return {
    nowMs() {
      return nowMs;
    },
    tick(ms: number) {
      nowMs += ms;
    },
  };
}

test('TA-P5-002 monitoring snapshot normalizes dynamic route segments and records counters', () => {
  const clock = createClock();
  const monitoring = new NodeMonitoringService({ clock });

  monitoring.recordHttpRequest({
    method: 'POST',
    path: '/api/v1/groups/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/invites',
    status: 201,
    durationMs: 13,
  });
  monitoring.recordHttpRequest({
    method: 'POST',
    path: '/api/v1/groups/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/invites',
    status: 500,
    durationMs: 25,
  });

  const snapshot = monitoring.snapshot();
  assert.equal(snapshot.totals.requests, 2);
  assert.equal(snapshot.totals.status2xx, 1);
  assert.equal(snapshot.totals.status5xx, 1);
  assert.equal(snapshot.routes.length, 1);
  assert.equal(snapshot.routes[0].path, '/api/v1/groups/:bytes32/invites');
  assert.equal(snapshot.routes[0].count, 2);
});

test('TA-P5-002 monitoring emits warning/critical alerts when thresholds are exceeded', () => {
  const clock = createClock(2_000_000);
  const monitoring = new NodeMonitoringService({
    clock,
    thresholds: {
      errorRateWarnRatio: 0.2,
      errorRateCriticalRatio: 0.4,
      requestP95WarnMs: 20,
      requestP95CriticalMs: 50,
      maintenanceStaleWarnSec: 10,
      maintenanceStaleCriticalSec: 20,
    },
  });

  for (let i = 0; i < 10; i++) {
    monitoring.recordHttpRequest({
      method: 'GET',
      path: '/api/v1/messages/pull',
      status: i < 6 ? 200 : 500,
      durationMs: i < 8 ? 10 : 80,
    });
  }

  monitoring.recordMailboxMaintenance({
    cleanup: { removed: 1, remaining: 3, sweptAtMs: clock.nowMs() },
    retraction: { retracted: 0, checkedAtMs: clock.nowMs() },
  });

  clock.tick(25_000);
  const snapshot = monitoring.snapshot();
  const byCode = new Map(snapshot.alerts.map((item) => [item.code, item]));

  assert.equal(byCode.get('HTTP_5XX_RATE')?.level, 'CRITICAL');
  assert.equal(byCode.get('HTTP_P95_LATENCY')?.level, 'CRITICAL');
  assert.equal(byCode.get('MAILBOX_MAINTENANCE_STALE')?.level, 'CRITICAL');
});
