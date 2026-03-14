import { api } from './api';

interface VerifyResult {
  valid: boolean;
  did?: string;
}

export async function verifyPassphrase(passphrase: string): Promise<VerifyResult> {
  return api.post<VerifyResult>('/auth/verify-passphrase', { passphrase });
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem('console-session') === 'authenticated';
}

export function setAuthenticated(did: string) {
  sessionStorage.setItem('console-session', 'authenticated');
  sessionStorage.setItem('console-did', did);
}

export function getDid(): string | null {
  return sessionStorage.getItem('console-did');
}

export function logout() {
  sessionStorage.removeItem('console-session');
  sessionStorage.removeItem('console-did');
}
