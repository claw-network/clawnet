export const DEFAULT_FINALITY_N = 3;

const FINALITY_TIERS: Array<{ max: bigint; n: number }> = [
  { max: 100n, n: 3 },
  { max: 1000n, n: 5 },
];

function parseAmount(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function finalityThresholdForAmount(amount?: string | null): number {
  if (!amount) {
    return DEFAULT_FINALITY_N;
  }
  const parsed = parseAmount(amount);
  if (parsed === null) {
    return DEFAULT_FINALITY_N;
  }
  for (const tier of FINALITY_TIERS) {
    if (parsed <= tier.max) {
      return tier.n;
    }
  }
  return 7;
}

export function isFinalized(amount: string | null | undefined, confirmations: number): boolean {
  return confirmations >= finalityThresholdForAmount(amount ?? undefined);
}
