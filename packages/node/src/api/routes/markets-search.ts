/**
 * Cross-market search route — /api/v1/markets/search
 */

import { Router } from '../router.js';
import { badRequest, paginated, parsePagination } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { parseMarketSearchQuery } from '../legacy.js';

export function marketsSearchRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET / — unified cross-market search ───────────────────────
  r.get('/', async (_req, res, route) => {
    const { page, perPage } = parsePagination(route.query);

    if (!ctx.searchMarkets) {
      paginated(res, [], { page, perPage, total: 0, basePath: '/api/v1/markets/search' });
      return;
    }

    try {
      const query = parseMarketSearchQuery(route.query);
      // Override page/perPage from our standard pagination
      query.page = page;
      query.pageSize = perPage;

      const result = ctx.searchMarkets(query);
      const listings = result.listings ?? [];
      const total = result.total ?? listings.length;

      paginated(res, listings, {
        page,
        perPage,
        total,
        basePath: '/api/v1/markets/search',
        query: Object.fromEntries(
          [...route.query.entries()].filter(([k]) => k !== 'page' && k !== 'per_page'),
        ),
      });
    } catch (err) {
      badRequest(res, (err as Error).message, route.url.pathname);
    }
  });

  return r;
}
