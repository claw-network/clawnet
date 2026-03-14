import { api } from './api';

interface VerifyResult {
  valid: boolean;
  did?: string;
  sessionToken?: string;
}

export async function verifyPassphrase(passphrase: string): Promise<VerifyResult> {
  return api.post<VerifyResult>('/auth/verify-passphrase', { passphrase });
}

export function isAuthenticated(): boolean {
  return !!sessionStorage.getItem('console-token');
}

export function setAuthenticated(did: string, sessionToken: string) {
  sessionStorage.setItem('console-token', sessionToken);
  sessionStorage.setItem('console-did', did);
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
}
