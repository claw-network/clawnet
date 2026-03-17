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

export function recordKeyUsage(
  state: KeyRotationState,
  increment = 1,
  now: number = Date.now(),
): KeyRotationState {
  return {
    ...state,
    usageCount: state.usageCount + Math.max(0, increment),
    lastUsedAt: new Date(now).toISOString(),
  };
}

export function shouldRotateKey(
  state: KeyRotationState,
  policy: KeyRotationPolicy = DEFAULT_KEY_ROTATION_POLICY,
  now: number = Date.now(),
): { rotate: boolean; reason: KeyRotationReason | null } {
  if (state.usageCount >= policy.maxUsage) {
    return { rotate: true, reason: 'usage' };
  }
  const base = state.lastRotatedAt ?? state.createdAt;
  const ageMs = now - Date.parse(base);
  if (ageMs >= policy.maxAgeMs) {
    return { rotate: true, reason: 'age' };
  }
  return { rotate: false, reason: null };
}

export function markKeyRotated(
  state: KeyRotationState,
  now: number = Date.now(),
): KeyRotationState {
  return {
    ...state,
    lastRotatedAt: new Date(now).toISOString(),
    lastUsedAt: new Date(now).toISOString(),
    usageCount: 0,
  };
}
