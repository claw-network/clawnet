/**
 * Dashboard page — balance overview + recent transactions.
 */

import { store } from '../state/store.js';
import { formatTokens, formatTime, truncateAddr, esc } from '../utils/format.js';
import { showToast } from '../components/toast.js';

export function renderDashboard(): string {
  const s = store.getState();
  const { balance } = s;
  const { did } = s.connection;

  return `
    <div class="container page-content">
      <div class="identity-bar">
        <div class="identity-did">
          <span class="did-label">DID</span>
          ${esc(did)}
        </div>
        <button class="copy-btn" data-copy="${esc(did)}">Copy</button>
      </div>

      <div class="balance-grid">
        <div class="balance-card primary">
          <div class="balance-label">Total Balance</div>
          <div class="balance-value" id="bal-total">
            ${balance.loading ? '<div class="skeleton" style="width:120px;height:1.6rem"></div>' : `${formatTokens(balance.balance)}<span class="unit">Tokens</span>`}
          </div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Available</div>
          <div class="balance-value" id="bal-available">
            ${balance.loading ? '<div class="skeleton" style="width:100px;height:1.6rem"></div>' : `${formatTokens(balance.available)}<span class="unit">Tokens</span>`}
          </div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Pending</div>
          <div class="balance-value" id="bal-pending">
            ${balance.loading ? '<div class="skeleton" style="width:80px;height:1.6rem"></div>' : `${formatTokens(balance.pending)}<span class="unit">Tokens</span>`}
          </div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Locked</div>
          <div class="balance-value" id="bal-locked">
            ${balance.loading ? '<div class="skeleton" style="width:80px;height:1.6rem"></div>' : `${formatTokens(balance.locked)}<span class="unit">Tokens</span>`}
          </div>
        </div>
      </div>

      <div class="quick-actions">
        <button class="quick-action" data-nav="transfer">
          <span class="quick-action-icon">↗</span>
          Send Tokens
        </button>
        <button class="quick-action" data-nav="history">
          <span class="quick-action-icon">☰</span>
          View History
        </button>
        <button class="quick-action" data-nav="escrow">
          <span class="quick-action-icon">⊡</span>
          Escrow
        </button>
        <button class="quick-action" data-action="refresh-balance">
          <span class="quick-action-icon">↻</span>
          Refresh
        </button>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Transactions</span>
          <button class="btn btn-sm btn-secondary" data-nav="history">View All</button>
        </div>
        <div id="recent-tx-list">
          ${renderRecentTxList()}
        </div>
      </div>
    </div>
  `;
}

function renderRecentTxList(): string {
  const s = store.getState();
  const txs = s.history.transactions.slice(0, 5);

  if (s.history.loading) {
    return Array(3)
      .fill(0)
      .map(
        () => `
      <div class="tx-item">
        <div class="skeleton" style="width:2.2rem;height:2.2rem;border-radius:8px"></div>
        <div><div class="skeleton" style="width:140px;height:0.9rem;margin-bottom:0.3rem"></div><div class="skeleton" style="width:200px;height:0.7rem"></div></div>
        <div class="skeleton" style="width:80px;height:0.9rem"></div>
      </div>
    `,
      )
      .join('');
  }

  if (txs.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">↗</div>
        <div class="empty-state-text">No transactions yet</div>
        <div class="empty-state-hint">Send your first transfer to get started</div>
      </div>
    `;
  }

  const myDid = store.getState().connection.did;
  return `<div class="tx-list">${txs.map((tx) => renderTxItem(tx, myDid)).join('')}</div>`;
}

function renderTxItem(
  tx: { txHash: string; from: string; to: string; amount: number; type: string; timestamp: number; memo?: string },
  myDid: string,
): string {
  const isSent = tx.from === myDid;
  const isEscrow = tx.type?.includes('escrow');
  const direction = isEscrow ? 'escrow' : isSent ? 'sent' : 'received';
  const icon = isEscrow ? '⊡' : isSent ? '↗' : '↙';
  const label = isEscrow ? 'Escrow' : isSent ? 'Sent' : 'Received';
  const addr = isSent ? tx.to : tx.from;
  const sign = isSent ? '−' : '+';

  return `
    <div class="tx-item" title="${esc(tx.txHash)}">
      <div class="tx-icon ${direction}">${icon}</div>
      <div class="tx-details">
        <div class="tx-type">${label}</div>
        <div class="tx-addr">${truncateAddr(addr)}</div>
      </div>
      <div>
        <div class="tx-amount ${direction}">${sign}${formatTokens(tx.amount)} T</div>
        <div class="tx-time">${formatTime(tx.timestamp)}</div>
      </div>
    </div>
  `;
}

export function bindDashboard(): void {
  // Quick nav buttons
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const route = el.dataset.nav as 'transfer' | 'history' | 'escrow';
      store.navigate(route);
    });
  });

  // Copy button
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach((el) => {
    el.addEventListener('click', () => {
      const text = el.dataset.copy || '';
      navigator.clipboard.writeText(text).catch(() => {});
      const orig = el.textContent;
      el.textContent = 'Copied!';
      setTimeout(() => { el.textContent = orig; }, 1200);
    });
  });

  // Refresh
  document.querySelector('[data-action="refresh-balance"]')?.addEventListener('click', async () => {
    try {
      await Promise.all([store.fetchBalance(), store.fetchHistory()]);
      showToast('Refreshed', 'success');
    } catch {
      showToast('Refresh failed', 'error');
    }
  });

  // Load data
  store.fetchBalance().catch(() => showToast('Failed to load balance', 'error'));
  store.fetchHistory().catch(() => {});
}
