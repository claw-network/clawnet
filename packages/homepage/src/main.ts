/* ============================================================================
   ClawNet Homepage — JavaScript interactions
   ============================================================================ */

// ---------- Mobile nav toggle ----------
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');

navToggle?.addEventListener('click', () => {
  navLinks?.classList.toggle('open');
  const spans = navToggle.querySelectorAll('span');
  const isOpen = navLinks?.classList.contains('open');
  if (isOpen) {
    spans[0].style.transform = 'rotate(45deg) translate(4px, 4px)';
    spans[1].style.opacity = '0';
    spans[2].style.transform = 'rotate(-45deg) translate(4px, -4px)';
  } else {
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }
});

// Close nav on link click (mobile)
navLinks?.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    const spans = navToggle?.querySelectorAll('span');
    if (spans) {
      spans[0].style.transform = '';
      spans[1].style.opacity = '';
      spans[2].style.transform = '';
    }
  });
});

// ---------- Code tabs ----------
const tabs = document.querySelectorAll('.dev-tab');
const codeBlocks: Record<string, HTMLElement | null> = {
  typescript: document.getElementById('code-typescript'),
  python: document.getElementById('code-python'),
  curl: document.getElementById('code-curl'),
};

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const lang = (tab as HTMLElement).dataset.lang;
    if (!lang) return;

    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    Object.entries(codeBlocks).forEach(([key, el]) => {
      if (el) {
        el.classList.toggle('hidden', key !== lang);
      }
    });
  });
});

// ---------- Scroll-based fade-in ----------
const observerOptions: IntersectionObserverInit = {
  threshold: 0.1,
  rootMargin: '0px 0px -40px 0px',
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

// Apply fade-in classes to animated elements
function initAnimations() {
  const selectors = [
    '.problem-card',
    '.feature-card',
    '.market-card',
    '.protocol-layer',
    '.dev-code-block',
    '.dev-feature',
    '.governance-step',
    '.agent-info-card',
    '.section-eyebrow',
    '.section-title',
    '.section-desc',
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach((el, index) => {
      el.classList.add('fade-in');
      (el as HTMLElement).style.transitionDelay = `${Math.min(index * 0.06, 0.5)}s`;
      observer.observe(el);
    });
  });
}

// ---------- Smooth scroll for nav links ----------
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const href = (anchor as HTMLAnchorElement).getAttribute('href');
    if (!href || href === '#') return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      const navHeight = document.querySelector('.nav')?.getBoundingClientRect().height || 64;
      const targetPos = target.getBoundingClientRect().top + window.scrollY - navHeight;
      window.scrollTo({ top: targetPos, behavior: 'smooth' });
    }
  });
});

// ---------- Nav background on scroll ----------
const nav = document.getElementById('nav');

window.addEventListener('scroll', () => {
  if (nav) {
    if (window.scrollY > 100) {
      nav.style.background = 'rgba(10, 10, 10, 0.95)';
    } else {
      nav.style.background = 'rgba(10, 10, 10, 0.8)';
    }
  }
}, { passive: true });

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', initAnimations);
// Also run if DOM already parsed
if (document.readyState !== 'loading') {
  initAnimations();
}
