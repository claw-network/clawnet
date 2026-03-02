/**
 * Navigation bar component.
 */

import { store } from '../state/store.js';
import { clawLogoSvg } from './brand.js';
import { truncateAddr } from '../utils/format.js';

export function renderNav(): string {
  const s = store.getState();
  const { connected, did, network } = s.connection;

  if (!connected) return '';

  const navLinks = [
    { route: 'dashboard', label: '⌂ Dashboard' },
    { route: 'transfer', label: '↗ Transfer' },
    { route: 'history', label: '☰ History' },
    { route: 'escrow', label: '⊡ Escrow' },
  ] as const;

  return `
    <nav class="site-nav">
      <div class="container nav-inner">
        <a href="#" class="brand" data-nav="dashboard">
          ${clawLogoSvg}
          <span>ClawNet</span>
          <span class="brand-badge">Wallet</span>
        </a>

        <div class="nav-links">
          ${navLinks
            .map(
              (link) => `
            <a href="#" class="nav-link ${s.route === link.route ? 'active' : ''}" data-nav="${link.route}">
              ${link.label}
            </a>
          `,
            )
            .join('')}
        </div>

        <div style="display:flex;align-items:center;gap:0.75rem">
          <span class="nav-status">
            <span class="status-dot connected"></span>
            ${network || 'connected'}
          </span>
          <button class="copy-btn" data-copy-did title="${did}">
            ${truncateAddr(did, 10, 4)}
          </button>
          <button class="btn btn-sm btn-danger" data-action="disconnect">
            Disconnect
          </button>
        </div>
      </div>
    </nav>
  `;
}

export function bindNav(): void {
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const route = el.dataset.nav as 'dashboard' | 'transfer' | 'history' | 'escrow';
      store.navigate(route);
    });
  });

  document.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => {
    store.disconnect();
  });

  document.querySelector('[data-copy-did]')?.addEventListener('click', () => {
    const did = store.getState().connection.did;
    if (did) {
      navigator.clipboard.writeText(did).catch(() => {});
      const btn = document.querySelector('[data-copy-did]');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      }
    }
  });
}
