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

export function bindHomepageInteractions(): void {
  initMobileNavigation();
  initSmoothScroll();
  initCodeTabs();
  initRevealAnimations();
  initNavOnScroll();
  initCopyButton();
  initCardEffects();
}
