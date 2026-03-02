/**
 * ClawNet Wallet — main entry point.
 */

import './styles/main.css';

import { store } from './state/store.js';
import { renderNav, bindNav } from './components/nav.js';
import { renderConnect, bindConnect } from './pages/connect.js';
import { renderDashboard, bindDashboard } from './pages/dashboard.js';
import { renderTransfer, bindTransfer } from './pages/transfer.js';
import { renderHistory, bindHistory } from './pages/history.js';
import { renderEscrow, bindEscrow } from './pages/escrow.js';
import { showToast } from './components/toast.js';

const root = document.querySelector<HTMLElement>('#app')!;

let rendering = false;
let lastRoute = '';

/** Render current route. */
function render(): void {
  if (rendering) return;
  rendering = true;

  const s = store.getState();
  const routeChanged = lastRoute !== s.route;
  lastRoute = s.route;

  let pageHtml = '';
  let bindFn: (() => void) | null = null;

  switch (s.route) {
    case 'connect':
      pageHtml = renderConnect();
      bindFn = bindConnect;
      break;
    case 'dashboard':
      pageHtml = renderDashboard();
      bindFn = bindDashboard;
      break;
    case 'transfer':
      pageHtml = renderTransfer();
      bindFn = bindTransfer;
      break;
    case 'history':
      pageHtml = renderHistory();
      bindFn = bindHistory;
      break;
    case 'escrow':
      pageHtml = renderEscrow();
      bindFn = bindEscrow;
      break;
  }

  root.innerHTML = `${renderNav()}${pageHtml}`;

  // Bind navigation events from nav bar
  if (s.connection.connected) {
    bindNav();
  }

  // Bind page-specific events
  if (bindFn) bindFn();

  rendering = false;

  // Load data only on route entry (not on every re-render)
  if (routeChanged && s.connection.connected) {
    if (s.route === 'dashboard') {
      store.fetchBalance().catch(() => showToast('Failed to load balance', 'error'));
      store.fetchHistory().catch(() => {});
    } else if (s.route === 'history') {
      store.fetchHistory().catch(() => {});
    }
  }
}

// Subscribe to store changes and re-render
store.subscribe(render);

// Initial render
render();

// If we have saved credentials, try to reconnect
(async () => {
  const s = store.getState();
  if (s.route !== 'connect' && !s.connection.connected) {
    try {
      await store.connect(s.connection.baseUrl, s.connection.apiKey);
    } catch {
      showToast('Could not reconnect. Please connect again.', 'error');
      store.disconnect();
    }
  }
})();
