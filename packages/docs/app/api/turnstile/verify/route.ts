import { NextRequest, NextResponse } from 'next/server';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'nodejs';

function getAllowedOrigins(): string[] {
  const fromEnv = process.env.TURNSTILE_ALLOWED_ORIGINS;
  if (!fromEnv) {
    return ['https://clawnetd.com', 'https://docs.clawnetd.com'];
  }

  return fromEnv
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  const allowedOrigins = getAllowedOrigins();
  if (!origin) {
    return headers;
  }

  if (allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    return headers;
  }

  if (process.env.NODE_ENV !== 'production') {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function getRemoteIp(request: NextRequest): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (!forwardedFor) {
    return undefined;
  }

  return forwardedFor.split(',')[0]?.trim() || undefined;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: createCorsHeaders(request.headers.get('origin')),
  });
}

export async function POST(request: NextRequest) {
  const corsHeaders = createCorsHeaders(request.headers.get('origin'));

  try {
    const body = (await request.json()) as {
      token?: string;
      action?: string;
      idempotencyKey?: string;
    };
    const token = body.token?.trim();

    if (!token) {
      return NextResponse.json(
        {
          error: 'token is required',
        },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const result = await verifyTurnstileToken({
      token,
      remoteIp: getRemoteIp(request),
      idempotencyKey: body.idempotencyKey,
      expectedAction: body.action,
    });

    return NextResponse.json(
      {
        data: result,
      },
      {
        status: result.success ? 200 : 400,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Turnstile verification failed',
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}
