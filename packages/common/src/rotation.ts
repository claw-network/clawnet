export interface KeyRotationPolicy {
  maxAgeMs: number;
  maxUsage: number;
}

export const DEFAULT_KEY_ROTATION_POLICY: KeyRotationPolicy = {
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
  maxUsage: 100_000,
};

export type KeyRotationReason = 'age' | 'usage' | 'manual';

export interface KeyRotationState {
  createdAt: string;
  lastRotatedAt?: string;
  lastUsedAt?: string;
  usageCount: number;
}

export function initKeyRotationState(createdAt: string = new Date().toISOString()): KeyRotationState {
  return {
    createdAt,
    usageCount: 0,
  };
}
