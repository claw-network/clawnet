const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type TurnstileVerifyResponse = {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  'error-codes'?: string[];
};

export type VerifyTurnstileTokenResult = {
  success: boolean;
  challengeTs: string | null;
  hostname: string | null;
  action: string | null;
  cdata: string | null;
  errorCodes: string[];
};

export function getTurnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAACqCItnNjID1lMqd';
}

function getTurnstileSecretKey(): string {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    throw new Error('TURNSTILE_SECRET_KEY is required for server-side validation.');
  }
  return secret;
}

export async function verifyTurnstileToken(params: {
  token: string;
  remoteIp?: string;
  idempotencyKey?: string;
  expectedAction?: string;
}): Promise<VerifyTurnstileTokenResult> {
  const body = new URLSearchParams({
    secret: getTurnstileSecretKey(),
    response: params.token,
  });

  if (params.remoteIp) {
    body.set('remoteip', params.remoteIp);
  }

  if (params.idempotencyKey) {
    body.set('idempotency_key', params.idempotencyKey);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Turnstile verification request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TurnstileVerifyResponse;
  const action = payload.action ?? null;
  const expectedAction = params.expectedAction?.trim();
  const actionMatched = !expectedAction || action === expectedAction;

  return {
    success: payload.success && actionMatched,
    challengeTs: payload.challenge_ts ?? null,
    hostname: payload.hostname ?? null,
    action,
    cdata: payload.cdata ?? null,
    errorCodes: payload['error-codes'] ?? [],
  };
}
