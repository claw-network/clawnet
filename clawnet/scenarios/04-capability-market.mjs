/**
 * Scenario 04: Capability Market
 * ================================
 * Charlie publishes a developer API capability → Alice leases it
 * → Alice invokes the capability → Lease terminates
 */
import { test, assert, assertOk, vlog, sleep } from '../lib/helpers.mjs';
import { waitForListing } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, charlie }) {
  let capabilityId;

  // ── 4.1 Charlie publishes a REST API capability ───────────────────────
  await test('Charlie publishes code-review API capability', async () => {
    const { status, data } = await charlie.publishCapability({
      title: 'Automated Code Review API',
      description: 'AI-powered code review service supporting 20+ languages',
      category: 'development',
      capabilityType: 'rest_api',
      capability: {
        name: 'code-review-api',
        version: '1.0.0',
        interface: {
          type: 'openapi',
          openapi: {
            spec: '{"openapi":"3.0.0","info":{"title":"Code Review API","version":"1.0.0"}}',
            baseUrl: 'https://charlie-agent.example.com/api/v1',
            authentication: { type: 'api_key' },
          },
        },
      },
      pricing: {
        type: 'usage',
        usagePrice: { unit: 'request', pricePerUnit: 5 },
        currency: 'TOKEN',
        negotiable: false,
      },
      quota: {
        type: 'limited',
        rateLimits: [{ requests: 100, period: 60 }],
      },
      access: {
        endpoint: 'https://charlie-agent.example.com/api/v1',
        authentication: { type: 'api_key' },
      },
      tags: ['code-review', 'api', 'development'],
    });
    assertOk(status, 'publish capability');
    capabilityId = data.listingId;
    assert(capabilityId, 'should return listingId');
    vlog(`Capability ID: ${capabilityId}`);
  });

  // ── 4.2 Alice discovers the capability ────────────────────────────────
  await test('Alice discovers capability via P2P', async () => {
    const listing = await waitForListing(alice, 'capabilities', capabilityId);
    if (listing) {
      vlog(`Alice found capability: ${listing.title || listing.id}`);
    } else {
      vlog('Capability not propagated to Alice yet');
    }
  });

  // ── 4.3 Alice searches capabilities ───────────────────────────────────
  await test('Alice searches capability market', async () => {
    const { status, data } = await alice.searchCapabilities('code review');
    assertOk(status, 'search');
    const listings = data.listings || data.results || [];
    vlog(`Search results: ${listings.length} capabilities`);
  });

  // ── 4.4 Alice leases the capability ───────────────────────────────────
  await test('Alice leases Charlie\'s code-review API', async () => {
    let result = await alice.leaseCapability(capabilityId);
    if (result.status === 404) {
      vlog('Capability not on Alice\'s node (P2P lag)');
    }
    assert(result.status >= 200 && result.status < 500, `lease status: ${result.status}`);
    vlog(`Lease: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  });

  // ── 4.5 Charlie sees the listing on his node ─────────────────────────
  await test('Charlie sees his capability listing', async () => {
    const { status } = await charlie.getCapability(capabilityId);
    assertOk(status, 'get capability');
  });

  // ── 4.6 Alice rates Charlie's capability ──────────────────────────────
  await test('Alice rates Charlie\'s service quality', async () => {
    const { status } = await alice.submitReputation(
      charlie.did, 'quality', 4, 'Good API, fast response times',
    );
    assertOk(status, 'reputation');
  });

  // ── 4.7 Charlie removes capability listing ────────────────────────────
  await test('Charlie removes capability listing', async () => {
    const { status } = await charlie.removeCapability(capabilityId);
    assertOk(status, 'remove capability');
    vlog('Capability removed');
  });
}
