'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'light' | 'dark' | 'auto';
    },
  ) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const DEFAULT_SITE_KEY = '0x4AAAAAACqCItnNjID1lMqd';

type StatusKind = 'idle' | 'pending' | 'success' | 'error';

function ensureTurnstileScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }

    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile script.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load Turnstile script.')), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

export function TurnstileFeedback() {
  const siteKey = useMemo(
    () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? DEFAULT_SITE_KEY,
    [],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<StatusKind>('idle');
  const [message, setMessage] = useState('Complete the challenge, then submit.');
  const [email, setEmail] = useState('');

  const renderWidget = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: 'docs-feedback',
      theme: 'dark',
      callback: (nextToken) => {
        setToken(nextToken);
        setStatus('idle');
        setMessage('Turnstile verification passed. You can submit now.');
      },
      'expired-callback': () => {
        setToken('');
        setStatus('error');
        setMessage('Challenge expired. Please complete verification again.');
      },
      'error-callback': () => {
        setToken('');
        setStatus('error');
        setMessage('Turnstile failed to load correctly. Refresh and retry.');
      },
    });
  }, [siteKey]);

  useEffect(() => {
    let mounted = true;

    ensureTurnstileScript()
      .then(() => {
        if (!mounted) {
          return;
        }
        renderWidget();
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Failed to initialize Turnstile.');
      });

    return () => {
      mounted = false;
    };
  }, [renderWidget]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      setStatus('error');
      setMessage('Please complete Turnstile verification before submitting.');
      return;
    }

    try {
      setStatus('pending');
      setMessage('Verifying token...');

      const response = await fetch('/api/turnstile/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          action: 'docs-feedback',
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      const payload = (await response.json()) as {
        data?: { success?: boolean };
        error?: string;
      };
      if (!response.ok || !payload.data?.success) {
        throw new Error(payload.error ?? 'Turnstile verification failed.');
      }

      setStatus('success');
      setMessage(`Verification succeeded for ${email}. We will follow up if needed.`);
      setToken('');
      setEmail('');

      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
      }
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Request failed. Please retry.');
      setToken('');
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  }

  return (
    <section className="mt-10 rounded-2xl border border-fd-border/70 bg-fd-card/80 p-5">
      <h3 className="text-base font-semibold">Human Verification Demo</h3>
      <p className="mt-2 text-sm text-fd-muted-foreground">
        This form demonstrates Cloudflare Turnstile client rendering and server validation.
      </p>
      <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
        <label className="grid gap-1 text-sm font-medium" htmlFor="turnstile-email">
          Email
          <input
            id="turnstile-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="rounded-xl border border-fd-border bg-fd-background px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
        </label>
        <div ref={containerRef} />
        <button
          type="submit"
          className="inline-flex w-fit items-center rounded-xl bg-fd-primary px-4 py-2 text-sm font-semibold text-fd-primary-foreground disabled:opacity-60"
          disabled={status === 'pending'}
        >
          {status === 'pending' ? 'Verifying...' : 'Submit'}
        </button>
        <p
          className={`text-sm ${
            status === 'error'
              ? 'text-red-500'
              : status === 'success'
                ? 'text-emerald-500'
                : 'text-fd-muted-foreground'
          }`}
        >
          {message}
        </p>
      </form>
    </section>
  );
}
