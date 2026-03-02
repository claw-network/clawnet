/**
 * Transaction history page.
 */

import { store, type Transaction } from '../state/store.js';
import { formatTokens, formatTime, truncateAddr, esc } from '../utils/format.js';
import { showToast } from '../components/toast.js';

export function renderHistory(): string {
  return `
    <div class="container page-content">
      <div class="section-header">
        <h1 class="section-title">Transaction History</h1>
        <button class="btn btn-sm btn-secondary" data-action="refresh-history">
          ↻ Refresh
        </button>
      </div>

      <div class="tab-bar" id="history-tabs">
        <button class="tab-btn active" data-filter="all">All</button>
        <button class="tab-btn" data-filter="sent">Sent</button>
        <button class="tab-btn" data-filter="received">Received</button>
        <button class="tab-btn" data-filter="escrow">Escrow</button>
      </div>

      <div class="card">
        <div id="history-list">
          ${renderHistoryList()}
        </div>

        <div id="history-pagination" class="pagination">
          ${renderPagination()}
        </div>
      </div>
    </div>
  `;
}

function renderHistoryList(): string {
  const s = store.getState();
  const { transactions, loading } = s.history;

  if (loading) {
    return Array(5)
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

  if (transactions.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">☰</div>
        <div class="empty-state-text">No transactions found</div>
        <div class="empty-state-hint">Transactions will appear here after your first transfer</div>
      </div>
    `;
  }

  const myDid = store.getState().connection.did;
  return `<div class="tx-list">${transactions.map((tx) => renderTxRow(tx, myDid)).join('')}</div>`;
}

function renderTxRow(tx: Transaction, myDid: string): string {
  const isSent = tx.from === myDid;
  const isEscrow = tx.type?.includes('escrow');
  const direction = isEscrow ? 'escrow' : isSent ? 'sent' : 'received';
  const icon = isEscrow ? '⊡' : isSent ? '↗' : '↙';
  const label = isEscrow ? 'Escrow' : isSent ? 'Sent' : 'Received';
  const addr = isSent ? tx.to : tx.from;
  const sign = isSent ? '−' : '+';
  const memo = tx.memo ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem">${esc(tx.memo)}</div>` : '';

  return `
    <div class="tx-item" title="TX: ${esc(tx.txHash)}">
      <div class="tx-icon ${direction}">${icon}</div>
      <div class="tx-details">
        <div class="tx-type">${label}</div>
        <div class="tx-addr">${truncateAddr(addr)}</div>
        ${memo}
      </div>
      <div>
        <div class="tx-amount ${direction}">${sign}${formatTokens(tx.amount)} T</div>
        <div class="tx-time">${formatTime(tx.timestamp)}</div>
      </div>
    </div>
  `;
}

function renderPagination(): string {
  const s = store.getState();
  const { page, total, hasMore } = s.history;

  if (total === 0) return '';

  return `
    <button class="btn btn-sm btn-secondary" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="pagination-info">Page ${page} · ${total} total</span>
    <button class="btn btn-sm btn-secondary" data-page="${page + 1}" ${!hasMore ? 'disabled' : ''}>Next →</button>
  `;
}

export function bindHistory(): void {
  // Tab filtering
  document.querySelectorAll<HTMLElement>('#history-tabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#history-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      // Re-fetch with filter (API supports type param)
      store.fetchHistory(1).then(() => {
        const listEl = document.getElementById('history-list');
        const pagEl = document.getElementById('history-pagination');
        if (listEl) listEl.innerHTML = renderHistoryList();
        if (pagEl) pagEl.innerHTML = renderPagination();
      });
    });
  });

  // Pagination
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page || '1', 10);
      if (page < 1) return;
      store.fetchHistory(page).then(() => {
        const listEl = document.getElementById('history-list');
        const pagEl = document.getElementById('history-pagination');
        if (listEl) listEl.innerHTML = renderHistoryList();
        if (pagEl) pagEl.innerHTML = renderPagination();
        bindHistoryPagination();
      });
    });
  });

  // Refresh
  document.querySelector('[data-action="refresh-history"]')?.addEventListener('click', async () => {
    try {
      await store.fetchHistory(1);
      const listEl = document.getElementById('history-list');
      const pagEl = document.getElementById('history-pagination');
      if (listEl) listEl.innerHTML = renderHistoryList();
      if (pagEl) pagEl.innerHTML = renderPagination();
      bindHistoryPagination();
      showToast('Refreshed', 'success');
    } catch {
      showToast('Failed to refresh', 'error');
    }
  });

  // Initial data is loaded by main.ts on route entry.
  // Just update DOM when store already has data.
  const listEl = document.getElementById('history-list');
  const pagEl = document.getElementById('history-pagination');
  if (listEl) listEl.innerHTML = renderHistoryList();
  if (pagEl) pagEl.innerHTML = renderPagination();
  bindHistoryPagination();
}

function bindHistoryPagination(): void {
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page || '1', 10);
      if (page < 1) return;
      store.fetchHistory(page).then(() => {
        const listEl = document.getElementById('history-list');
        const pagEl = document.getElementById('history-pagination');
        if (listEl) listEl.innerHTML = renderHistoryList();
        if (pagEl) pagEl.innerHTML = renderPagination();
        bindHistoryPagination();
      });
    });
  });
}
