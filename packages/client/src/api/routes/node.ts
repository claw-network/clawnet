import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ErrorCodes, TelagentError, isDidClaw } from '../../protocol/index.js';

import { Router } from '../router.js';
import { created, ok } from '../response.js';
import { handleError } from '../route-utils.js';
import type { RuntimeContext } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', '..', 'package.json');
const { version: PKG_VERSION } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const startedAt = Date.now();

export function nodeRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.get('/', async ({ res }) => {
    const self = ctx.identityService.getSelfDid();
    let profile: { nickname?: string; avatarUrl?: string } = {};
    try {
      profile = await ctx.selfProfileStore.loadPublic();
    } catch { /* best-effort */ }

    ok(res, {
      service: 'telagent-node',
      version: PKG_VERSION,
      did: self,
      nickname: profile.nickname ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
      publicUrl: ctx.config.publicUrl ?? undefined,
      tls: !!ctx.config.tls,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      now: new Date().toISOString(),
      links: {
        metrics: '/api/v1/node/metrics',
        profile: '/api/v1/profile',
      },
    }, { self: '/api/v1/node' });
  });

  router.get('/metrics', ({ res }) => {
    const snapshot = ctx.monitoringService.snapshot();
    ok(res, snapshot, { self: '/api/v1/node/metrics' });
  });

  router.post('/revocations', ({ res, body, url }) => {
    try {
      const payload = assertRecord(body, 'revocation payload');
      const did = assertDid(payload.did, 'did');
      const source = assertOptionalString(payload.source, 'source') ?? 'node-api';
      const revokedAtMs = parseOptionalPositiveInt(payload.revoked_at_ms, 'revoked_at_ms');

      const revocation = ctx.identityService.notifyDidRevoked(did, {
        source,
        revokedAtMs,
      });

      created(
        res,
        {
          revocation,
        },
        { self: `/api/v1/node/revocations?did_hash=${encodeURIComponent(revocation.didHash)}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/audit-snapshot', async ({ res, query, url }) => {
    try {
      const sampleSize = parsePositiveInt(query.get('sample_size'), 'sample_size', 20, 100);
      const retractionScanLimit = parsePositiveInt(query.get('retraction_scan_limit'), 'retraction_scan_limit', 2000, 100_000);

      const [selfIdentity, messageAudit] = await Promise.all([
        ctx.identityService.getSelf(),
        ctx.messageService.buildAuditSnapshot({
          sampleSize,
          retractionScanLimit,
        }),
      ]);

      const groups = ctx.groupService.listGroups();
      const groupStateCounts = {
        PENDING_ONCHAIN: 0,
        ACTIVE: 0,
        REORGED_BACK: 0,
      };
      const memberStateCounts = {
        PENDING: 0,
        FINALIZED: 0,
        REMOVED: 0,
      };
      const domainCounts = new Map<string, number>();

      for (const group of groups) {
        groupStateCounts[group.state] += 1;
        const domainHash = digestForAudit(group.groupDomain);
        domainCounts.set(domainHash, (domainCounts.get(domainHash) ?? 0) + 1);

        const members = ctx.groupService.listMembers(group.groupId);
        for (const member of members) {
          memberStateCounts[member.state] += 1;
        }
      }

      const monitoring = ctx.monitoringService.snapshot();
      const selfLink = `/api/v1/node/audit-snapshot?sample_size=${sampleSize}&retraction_scan_limit=${retractionScanLimit}`;

      ok(
        res,
        {
          generatedAt: new Date().toISOString(),
          actor: {
            didHash: selfIdentity.didHash,
            controllerHash: digestForAudit(selfIdentity.controller.toLowerCase()),
            isActive: selfIdentity.isActive,
          },
          groups: {
            total: groups.length,
            stateCounts: groupStateCounts,
            domainCount: domainCounts.size,
            domainSamples: [...domainCounts.entries()]
              .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
              .slice(0, sampleSize)
              .map(([domainHash, count]) => ({
                domainHash,
                groupCount: count,
              })),
            memberStateCounts,
          },
          messages: messageAudit,
          monitoring: {
            generatedAt: monitoring.generatedAt,
            uptimeSec: monitoring.uptimeSec,
            totals: monitoring.totals,
            alerts: monitoring.alerts,
            mailboxMaintenance: monitoring.mailboxMaintenance,
          },
        },
        { self: selfLink },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}

function parsePositiveInt(raw: string | null, field: string, fallback: number, max: number): number {
  if (!raw || !raw.trim()) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a positive integer`);
  }
  return Math.min(value, max);
}

function parseOptionalPositiveInt(value: unknown, field: string): number | undefined {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a positive integer`);
  }
  return value;
}

function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertDid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} is required`);
  }
  const did = value.trim();
  if (!isDidClaw(did)) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} must use did:claw format`);
  }
  return did;
}

function assertOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function digestForAudit(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
