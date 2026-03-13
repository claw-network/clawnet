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
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '0x4AAAAAACqCItnNjID1lMqd';
const TURNSTILE_VERIFY_ENDPOINT =
  import.meta.env.VITE_TURNSTILE_VERIFY_ENDPOINT ??
  'https://docs.clawnetd.com/api/turnstile/verify';

function loadTurnstileScript(): Promise<void> {
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

function initMobileNavigation(): void {
  const nav = document.getElementById('site-nav');
  const navToggle = document.getElementById('site-nav-toggle') as HTMLButtonElement | null;
  const navLinks = document.getElementById('site-nav-links');

  if (!nav || !navToggle || !navLinks) {
    return;
  }

  const navDropdowns = Array.from(navLinks.querySelectorAll<HTMLDetailsElement>('[data-nav-dropdown]'));

  const closeMenu = (): void => {
    nav.classList.remove('is-open');
    navToggle.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navDropdowns.forEach((dropdown) => {
      dropdown.open = false;
    });
  };

  navToggle.addEventListener('click', () => {
    const opening = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', opening);
    navToggle.classList.toggle('is-open', opening);
    navToggle.setAttribute('aria-expanded', String(opening));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  navDropdowns.forEach((dropdown) => {
    dropdown.addEventListener('toggle', () => {
      if (!dropdown.open) {
        return;
      }

      navDropdowns.forEach((otherDropdown) => {
        if (otherDropdown !== dropdown) {
          otherDropdown.open = false;
        }
      });
    });
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node | null;
    if (!target) {
      return;
    }

    if (!navLinks.contains(target)) {
      navDropdowns.forEach((dropdown) => {
        dropdown.open = false;
      });
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      closeMenu();
    }
  });
}

function initSmoothScroll(): void {
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') {
        return;
      }

      const target = document.querySelector<HTMLElement>(href);
      if (!target) {
        return;
      }

      event.preventDefault();
      const navHeight = document.getElementById('site-nav')?.getBoundingClientRect().height ?? 72;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 8;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

function initCodeTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-code-tab]'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-code-panel]'));

  if (tabs.length === 0 || panels.length === 0) {
    return;
  }

  const activateTab = (language: string): void => {
    tabs.forEach((tab) => {
      const active = tab.dataset.codeTab === language;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    panels.forEach((panel) => {
      const active = panel.dataset.codePanel === language;
      panel.classList.toggle('is-active', active);
      panel.toggleAttribute('hidden', !active);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.codeTab) {
        activateTab(tab.dataset.codeTab);
      }
    });
  });
}

function initRevealAnimations(): void {
  const revealNodes = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
  if (revealNodes.length === 0) {
    return;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealNodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, self) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          self.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: '0px 0px -10% 0px',
    },
  );

  revealNodes.forEach((node) => observer.observe(node));
}

function initNavOnScroll(): void {
  const nav = document.getElementById('site-nav');
  if (!nav) {
    return;
  }

  const sync = (): void => {
    nav.classList.toggle('is-scrolled', window.scrollY > 20);
  };

  sync();
  window.addEventListener('scroll', sync, { passive: true });
}

function initCopyButton(): void {
  const copyButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-copy-target]'),
  );

  if (copyButtons.length === 0) {
    return;
  }

  copyButtons.forEach((button) => {
    const defaultLabel = button.textContent ?? 'Copy';
    button.addEventListener('click', async () => {
      const targetId = button.dataset.copyTarget;
      if (!targetId) {
        return;
      }

      const target = document.getElementById(targetId);
      const text = target?.textContent?.trim();
      if (!text) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
        button.classList.add('is-copied');
        window.setTimeout(() => {
          button.textContent = defaultLabel;
          button.classList.remove('is-copied');
        }, 1600);
      } catch {
        button.textContent = 'Unavailable';
        window.setTimeout(() => {
          button.textContent = defaultLabel;
        }, 1600);
      }
    });
  });
}

function initCardEffects(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card-fx]'));
  if (cards.length === 0) {
    return;
  }

  const supportsHover = window.matchMedia('(hover: hover)').matches;

  cards.forEach((card) => {
    if (supportsHover) {
      card.addEventListener('pointerenter', () => {
        card.classList.add('is-hovered');
      });

      card.addEventListener('pointerleave', () => {
        card.classList.remove('is-hovered');
        card.classList.remove('is-pressed');
      });
    }

    let releaseTimer: number | undefined;
    const releasePress = (): void => {
      card.classList.remove('is-pressed');
      if (releaseTimer) {
        window.clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
    };

    card.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      card.classList.add('is-pressed');
      if (event.pointerType === 'touch') {
        releaseTimer = window.setTimeout(releasePress, 160);
      }
    });

    card.addEventListener('pointerup', releasePress);
    card.addEventListener('pointercancel', releasePress);
  });
}

function initTurnstileForms(): void {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('[data-turnstile-form]'));
  if (forms.length === 0) {
    return;
  }

  forms.forEach((form) => {
    const widgetContainer = form.querySelector<HTMLElement>('[data-turnstile-widget]');
    const statusNode = form.querySelector<HTMLElement>('[data-turnstile-status]');
    const submitButton = form.querySelector<HTMLButtonElement>('[data-turnstile-submit]');
    const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]');

    if (!widgetContainer || !statusNode || !submitButton || !emailInput) {
      return;
    }

    let token = '';
    let widgetId: string | null = null;

    const setStatus = (message: string, mode: 'idle' | 'error' | 'success' = 'idle'): void => {
      statusNode.textContent = message;
      statusNode.dataset.mode = mode;
    };

    loadTurnstileScript()
      .then(() => {
        if (!window.turnstile) {
          throw new Error('Turnstile API is not available.');
        }

        widgetId = window.turnstile.render(widgetContainer, {
          sitekey: TURNSTILE_SITE_KEY,
          action: 'homepage-signup',
          theme: 'light',
          callback: (nextToken) => {
            token = nextToken;
            setStatus('Turnstile verification passed. You can submit now.');
          },
          'expired-callback': () => {
            token = '';
            setStatus('Verification expired. Please complete the challenge again.', 'error');
          },
          'error-callback': () => {
            token = '';
            setStatus('Turnstile encountered an error. Refresh and retry.', 'error');
          },
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize Turnstile.';
        setStatus(message, 'error');
      });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!token) {
        setStatus('Please complete Turnstile verification before submitting.', 'error');
        return;
      }

      submitButton.disabled = true;
      setStatus('Verifying token on server...');

      try {
        const response = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            action: 'homepage-signup',
            idempotencyKey: crypto.randomUUID(),
          }),
        });

        const payload = (await response.json()) as {
          data?: { success?: boolean };
          error?: string;
        };

        if (!response.ok || !payload.data?.success) {
          throw new Error(payload.error ?? 'Turnstile validation failed.');
        }

        setStatus(`Verification succeeded for ${emailInput.value}.`, 'success');
        form.reset();
        token = '';

        if (window.turnstile && widgetId) {
          window.turnstile.reset(widgetId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Validation request failed.';
        setStatus(message, 'error');
        token = '';

        if (window.turnstile && widgetId) {
          window.turnstile.reset(widgetId);
        }
      } finally {
        submitButton.disabled = false;
      }
    });
  });
}

export function bindHomepageInteractions(): void {
  initMobileNavigation();
  initSmoothScroll();
  initCodeTabs();
  initRevealAnimations();
  initNavOnScroll();
  initCopyButton();
  initCardEffects();
  initTurnstileForms();
}
