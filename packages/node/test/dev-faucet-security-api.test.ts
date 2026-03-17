import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';

const ORIGINAL_ENV = {
  CLAW_DEV_FAUCET_API_KEY: process.env.CLAW_DEV_FAUCET_API_KEY,
  CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM: process.env.CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM,
  CLAW_DEV_FAUCET_COOLDOWN_HOURS: process.env.CLAW_DEV_FAUCET_COOLDOWN_HOURS,
  CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH:
    process.env.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH,
  CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY: process.env.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY,
};

function restoreEnv(): void {
  process.env.CLAW_DEV_FAUCET_API_KEY = ORIGINAL_ENV.CLAW_DEV_FAUCET_API_KEY;
  process.env.CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM =
    ORIGINAL_ENV.CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM;
  process.env.CLAW_DEV_FAUCET_COOLDOWN_HOURS = ORIGINAL_ENV.CLAW_DEV_FAUCET_COOLDOWN_HOURS;
  process.env.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH =
    ORIGINAL_ENV.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH;
  process.env.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY =
    ORIGINAL_ENV.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY;
}

function setPolicyEnv(overrides: Record<string, string | undefined>): void {
  process.env.CLAW_DEV_FAUCET_API_KEY = overrides.CLAW_DEV_FAUCET_API_KEY ?? 'test-dev-key';
  process.env.CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM =
    overrides.CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM ?? '50';
  process.env.CLAW_DEV_FAUCET_COOLDOWN_HOURS = overrides.CLAW_DEV_FAUCET_COOLDOWN_HOURS ?? '24';
  process.env.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH =
    overrides.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH ?? '4';
  process.env.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY =
    overrides.CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY ?? '3';
}

describe('dev faucet security api', () => {
  let api: ApiServer;
  let baseUrl: string;

  beforeEach(() => {
    restoreEnv();
  });

  afterEach(async () => {
    if (api) {
      await api.stop();
    }
    restoreEnv();
  });

  async function startServer(envOverrides: Record<string, string | undefined> = {}): Promise<void> {
    setPolicyEnv(envOverrides);

    const walletService = {
      mint: async (_to: string, amount: number) => ({ txHash: '0xtest', amount }),
      resolveDidToAddress: async () => null,
    };

    api = new ApiServer(
      { host: '127.0.0.1', port: 0 },
      {
        publishEvent: async () => 'event-hash',
        walletService: walletService as never,
      },
    );

    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  }

  it('requires API key auth for /api/v1/dev/faucet', async () => {
    await startServer();

    const missingKeyRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x' + 'ab'.repeat(20), amount: 1 }),
    });
    expect(missingKeyRes.status).toBe(401);

    const badKeyRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'wrong-key' },
      body: JSON.stringify({ address: '0x' + 'ab'.repeat(20), amount: 1 }),
    });
    expect(badKeyRes.status).toBe(401);

    const okRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
      body: JSON.stringify({ address: '0x' + 'ab'.repeat(20), amount: 1 }),
    });
    expect(okRes.status).toBe(200);
  });

  it('enforces per-claim cap and per-IP daily limit', async () => {
    await startServer();

    const overAmountRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
      body: JSON.stringify({ address: '0x' + 'ff'.repeat(20), amount: 51 }),
    });
    expect(overAmountRes.status).toBe(400);

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
        body: JSON.stringify({ address: '0x' + (i + 1).toString(16).padStart(40, '0'), amount: 1 }),
      });
      expect(res.status).toBe(200);
    }

    const limitedRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
      body: JSON.stringify({ address: '0x' + '00'.repeat(19) + '04', amount: 1 }),
    });
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get('retry-after')).toBeTruthy();
  });

  it('enforces DID monthly cap and recipient cooldown', async () => {
    await startServer({
      CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY: '10',
      CLAW_DEV_FAUCET_COOLDOWN_HOURS: '0',
    });

    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
        body: JSON.stringify({ did: 'did:claw:monthly-cap', address: '0x' + (i + 10).toString(16).padStart(40, '0'), amount: 1 }),
      });
      expect(res.status).toBe(200);
    }

    const didLimitedRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
      body: JSON.stringify({ did: 'did:claw:monthly-cap', address: '0x' + '00'.repeat(19) + '15', amount: 1 }),
    });
    expect(didLimitedRes.status).toBe(429);

    await api.stop();

    await startServer({
      CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY: '10',
      CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH: '10',
      CLAW_DEV_FAUCET_COOLDOWN_HOURS: '24',
    });

    const firstRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
      body: JSON.stringify({ address: '0x' + 'cc'.repeat(20), amount: 1 }),
    });
    expect(firstRes.status).toBe(200);

    const cooldownRes = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-dev-key' },
      body: JSON.stringify({ address: '0x' + 'cc'.repeat(20), amount: 1 }),
    });
    expect(cooldownRes.status).toBe(429);
  });
});
