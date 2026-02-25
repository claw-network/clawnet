type WalletRole = 'treasury' | 'faucet' | 'riskReserve';

export interface LiquidityPolicyConfig {
  liquidityAddress: string;
  liquidityWalletControl: string;
  liquidityMonthlyBudgetCap: number;
  liquidityRecycleIntervalDays: number;
  liquidityRecycleToTreasury: boolean;
  treasuryAddress?: string;
  faucetVaultAddress?: string;
  riskReserveAddress?: string;
}

export interface LiquidityPolicyValidationResult {
  enabled: boolean;
  config?: LiquidityPolicyConfig;
  errors: string[];
}

function normalizeAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
}

function parsePositiveFloat(name: string, fallback: number, errors: string[]): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${name} must be a positive number`);
    return fallback;
  }
  return parsed;
}

function parsePositiveInt(name: string, fallback: number, errors: string[]): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${name} must be a positive integer`);
    return fallback;
  }
  return parsed;
}

function parseWalletControl(value: string, errors: string[]): string {
  const normalized = value.trim();
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized);
  if (!match) {
    errors.push('CLAW_LIQUIDITY_WALLET_CONTROL must be N/M format (example: 2/3)');
    return normalized;
  }
  const threshold = Number.parseInt(match[1], 10);
  const members = Number.parseInt(match[2], 10);
  if (threshold < 2 || members < 2 || threshold > members) {
    errors.push('CLAW_LIQUIDITY_WALLET_CONTROL must satisfy 2 <= N <= M');
  }
  return `${threshold}/${members}`;
}

function validateDistinctAddress(
  liquidityAddress: string,
  candidate: string | undefined,
  role: WalletRole,
  errors: string[],
): void {
  if (!candidate) return;
  if (candidate === liquidityAddress) {
    errors.push(`CLAW_LIQUIDITY_ADDRESS must not equal ${role} wallet address`);
  }
}

export function validateLiquidityPolicyFromEnv(): LiquidityPolicyValidationResult {
  const errors: string[] = [];
  const liquidityAddressRaw = process.env.CLAW_LIQUIDITY_ADDRESS;
  if (!liquidityAddressRaw) {
    return { enabled: false, errors };
  }

  const liquidityAddress = normalizeAddress(liquidityAddressRaw);
  if (!liquidityAddress) {
    errors.push('CLAW_LIQUIDITY_ADDRESS must be a valid 0x-prefixed address');
  }

  const treasuryAddress = normalizeAddress(process.env.CLAW_TREASURY_ADDRESS);
  const faucetVaultAddress = normalizeAddress(process.env.CLAW_FAUCET_VAULT_ADDRESS);
  const riskReserveAddress = normalizeAddress(process.env.CLAW_RISK_RESERVE_ADDRESS);

  if (process.env.CLAW_TREASURY_ADDRESS && !treasuryAddress) {
    errors.push('CLAW_TREASURY_ADDRESS must be a valid 0x-prefixed address');
  }
  if (process.env.CLAW_FAUCET_VAULT_ADDRESS && !faucetVaultAddress) {
    errors.push('CLAW_FAUCET_VAULT_ADDRESS must be a valid 0x-prefixed address');
  }
  if (process.env.CLAW_RISK_RESERVE_ADDRESS && !riskReserveAddress) {
    errors.push('CLAW_RISK_RESERVE_ADDRESS must be a valid 0x-prefixed address');
  }

  const liquidityWalletControl = parseWalletControl(
    process.env.CLAW_LIQUIDITY_WALLET_CONTROL ?? '2/3',
    errors,
  );
  const liquidityMonthlyBudgetCap = parsePositiveFloat(
    'CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP',
    2,
    errors,
  );
  const liquidityRecycleIntervalDays = parsePositiveInt(
    'CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS',
    30,
    errors,
  );
  const recycleToTreasuryRaw = (process.env.CLAW_LIQUIDITY_RECYCLE_TO_TREASURY ?? 'true')
    .trim()
    .toLowerCase();
  const liquidityRecycleToTreasury = recycleToTreasuryRaw === 'true';
  if (!['true', 'false'].includes(recycleToTreasuryRaw)) {
    errors.push('CLAW_LIQUIDITY_RECYCLE_TO_TREASURY must be true or false');
  }
  if (!liquidityRecycleToTreasury) {
    errors.push('CLAW_LIQUIDITY_RECYCLE_TO_TREASURY must remain true by policy');
  }

  if (liquidityAddress) {
    validateDistinctAddress(liquidityAddress, treasuryAddress, 'treasury', errors);
    validateDistinctAddress(liquidityAddress, faucetVaultAddress, 'faucet', errors);
    validateDistinctAddress(liquidityAddress, riskReserveAddress, 'riskReserve', errors);
  }

  if (errors.length > 0 || !liquidityAddress) {
    return { enabled: true, errors };
  }

  return {
    enabled: true,
    errors,
    config: {
      liquidityAddress,
      liquidityWalletControl,
      liquidityMonthlyBudgetCap,
      liquidityRecycleIntervalDays,
      liquidityRecycleToTreasury,
      treasuryAddress,
      faucetVaultAddress,
      riskReserveAddress,
    },
  };
}
