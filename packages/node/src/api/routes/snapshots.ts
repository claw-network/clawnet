/**
 * Snapshot routes — /api/v1/snapshots
 *
 * Exposes snapshot-related operations for the console:
 *   GET  /latest — latest snapshot metadata
 *   POST /       — trigger a manual snapshot
 */

import { Router } from '../router.js';
import { ok, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';

export function snapshotRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // GET /latest — load latest snapshot metadata + summary
  r.get('/latest', async (_req, res) => {
    if (!ctx.snapshotStore) {
      ok(res, null, { self: '/api/v1/snapshots/latest' });
      return;
    }
    try {
      const meta = await ctx.snapshotStore.loadLatestSnapshotMeta();
      const snapshot = await ctx.snapshotStore.loadLatestSnapshot();
      if (!meta || !snapshot) {
        ok(res, null, { self: '/api/v1/snapshots/latest' });
        return;
      }
      ok(
        res,
        {
          hash: meta.hash,
          createdAt: meta.createdAt,
          version: snapshot.v,
          eventId: snapshot.at,
          prev: snapshot.prev,
          signatures: snapshot.signatures?.length ?? 0,
          stateKeys: Object.keys(snapshot.state ?? {}),
        },
        { self: '/api/v1/snapshots/latest' },
      );
    } catch {
      internalError(res, 'Failed to load snapshot');
    }
  });

  // POST / — trigger a manual snapshot
  r.post('/', async (_req, res) => {
    if (!ctx.takeSnapshot) {
      internalError(res, 'Snapshot creation not available');
      return;
    }
    try {
      const snapshot = await ctx.takeSnapshot();
      if (!snapshot) {
        ok(res, { created: false, reason: 'No events to snapshot' }, { self: '/api/v1/snapshots' });
        return;
      }
      ok(
        res,
        {
          created: true,
          hash: snapshot.hash,
          createdAt: new Date().toISOString(),
          version: snapshot.v,
          eventId: snapshot.at,
          prev: snapshot.prev,
          signatures: snapshot.signatures?.length ?? 0,
          stateKeys: Object.keys(snapshot.state ?? {}),
        },
        { self: '/api/v1/snapshots' },
      );
    } catch (err) {
      internalError(res, `Snapshot failed: ${(err as Error).message}`);
    }
  });

  return r;
}
