import { api } from './api';

interface VerifyResult {
  valid: boolean;
  did?: string;
  sessionToken?: string;
  /** When true, 2FA is required — use pendingToken to complete TOTP verification. */
  requireTotp?: boolean;
  pendingToken?: string;
}

export async function verifyPassphrase(passphrase: string): Promise<VerifyResult> {
  return api.post<VerifyResult>('/auth/verify-passphrase', { passphrase });
}

export interface TotpVerifyResult {
  valid: boolean;
  sessionToken?: string;
}

export async function verifyTotp(code: string, pendingToken: string): Promise<TotpVerifyResult> {
  return api.post<TotpVerifyResult>('/auth/totp/verify', { code, pendingToken });
}

export function isAuthenticated(): boolean {
  return !!sessionStorage.getItem('console-token');
}

export function setAuthenticated(did: string, sessionToken: string) {
  sessionStorage.setItem('console-token', sessionToken);
  sessionStorage.setItem('console-did', did);
}

export function setPendingToken(token: string) {
  sessionStorage.setItem('console-pending-token', token);
}

export function getPendingToken(): string | null {
  return sessionStorage.getItem('console-pending-token');
}

export function clearPendingToken() {
  sessionStorage.removeItem('console-pending-token');
}

export function getSessionToken(): string | null {
  return sessionStorage.getItem('console-token');
}

export function getDid(): string | null {
  return sessionStorage.getItem('console-did');
}

export function logout() {
  sessionStorage.removeItem('console-token');
  sessionStorage.removeItem('console-did');
  sessionStorage.removeItem('console-pending-token');
}
