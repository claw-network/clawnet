import { afterEach, describe, expect, it } from 'vitest';
import { validateLiquidityPolicyFromEnv } from '../src/policy/liquidity-policy.js';

const SNAPSHOT = {
  CLAW_LIQUIDITY_ADDRESS: process.env.CLAW_LIQUIDITY_ADDRESS,
  CLAW_TREASURY_ADDRESS: process.env.CLAW_TREASURY_ADDRESS,
  CLAW_FAUCET_VAULT_ADDRESS: process.env.CLAW_FAUCET_VAULT_ADDRESS,
  CLAW_RISK_RESERVE_ADDRESS: process.env.CLAW_RISK_RESERVE_ADDRESS,
  CLAW_LIQUIDITY_WALLET_CONTROL: process.env.CLAW_LIQUIDITY_WALLET_CONTROL,
  CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP: process.env.CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP,
  CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS: process.env.CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS,
  CLAW_LIQUIDITY_RECYCLE_TO_TREASURY: process.env.CLAW_LIQUIDITY_RECYCLE_TO_TREASURY,
};

function restoreEnv(): void {
  process.env.CLAW_LIQUIDITY_ADDRESS = SNAPSHOT.CLAW_LIQUIDITY_ADDRESS;
  process.env.CLAW_TREASURY_ADDRESS = SNAPSHOT.CLAW_TREASURY_ADDRESS;
  process.env.CLAW_FAUCET_VAULT_ADDRESS = SNAPSHOT.CLAW_FAUCET_VAULT_ADDRESS;
  process.env.CLAW_RISK_RESERVE_ADDRESS = SNAPSHOT.CLAW_RISK_RESERVE_ADDRESS;
  process.env.CLAW_LIQUIDITY_WALLET_CONTROL = SNAPSHOT.CLAW_LIQUIDITY_WALLET_CONTROL;
  process.env.CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP = SNAPSHOT.CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP;
  process.env.CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS = SNAPSHOT.CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS;
  process.env.CLAW_LIQUIDITY_RECYCLE_TO_TREASURY = SNAPSHOT.CLAW_LIQUIDITY_RECYCLE_TO_TREASURY;
}

function setValidBaseEnv(): void {
  process.env.CLAW_LIQUIDITY_ADDRESS = '0x1111111111111111111111111111111111111111';
  process.env.CLAW_TREASURY_ADDRESS = '0x2222222222222222222222222222222222222222';
  process.env.CLAW_FAUCET_VAULT_ADDRESS = '0x3333333333333333333333333333333333333333';
  process.env.CLAW_RISK_RESERVE_ADDRESS = '0x4444444444444444444444444444444444444444';
  process.env.CLAW_LIQUIDITY_WALLET_CONTROL = '2/3';
  process.env.CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP = '2';
  process.env.CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS = '30';
  process.env.CLAW_LIQUIDITY_RECYCLE_TO_TREASURY = 'true';
}

describe('liquidity policy env validation', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('is disabled when liquidity address is absent', () => {
    restoreEnv();
    delete process.env.CLAW_LIQUIDITY_ADDRESS;

    const result = validateLiquidityPolicyFromEnv();

    expect(result.enabled).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.config).toBeUndefined();
  });

  it('accepts a valid dedicated liquidity configuration', () => {
    setValidBaseEnv();

    const result = validateLiquidityPolicyFromEnv();

    expect(result.enabled).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.config?.liquidityAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(result.config?.liquidityWalletControl).toBe('2/3');
  });

  it('rejects reused liquidity and treasury address', () => {
    setValidBaseEnv();
    process.env.CLAW_TREASURY_ADDRESS = '0x1111111111111111111111111111111111111111';

    const result = validateLiquidityPolicyFromEnv();

    expect(result.enabled).toBe(true);
    expect(result.errors.join('\n')).toContain('must not equal treasury wallet address');
  });

  it('rejects non-multisig wallet control and recycle=false', () => {
    setValidBaseEnv();
    process.env.CLAW_LIQUIDITY_WALLET_CONTROL = '1/1';
    process.env.CLAW_LIQUIDITY_RECYCLE_TO_TREASURY = 'false';

    const result = validateLiquidityPolicyFromEnv();

    expect(result.enabled).toBe(true);
    expect(result.errors.join('\n')).toContain('must satisfy 2 <= N <= M');
    expect(result.errors.join('\n')).toContain('must remain true by policy');
  });
});
