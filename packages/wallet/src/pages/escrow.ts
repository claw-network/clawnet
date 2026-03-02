/**
 * Escrow management page.
 */

import { store } from '../state/store.js';
import { formatTokens, esc } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';

export function renderEscrow(): string {
  return `
    <div class="container page-content">
      <div class="section-header">
        <h1 class="section-title">Escrow</h1>
        <button class="btn btn-sm btn-primary" data-action="create-escrow">
          + New Escrow
        </button>
      </div>

      <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1.5rem">
        Escrow accounts hold Tokens in trust until release conditions are met.
        Use escrow for service contracts, milestone payments, and dispute resolution.
      </p>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Your Escrows</span>
          <button class="btn btn-sm btn-secondary" data-action="refresh-escrow">↻</button>
        </div>

        <div id="escrow-list">
          <div class="empty-state">
            <div class="empty-state-icon">⊡</div>
            <div class="empty-state-text">No escrow accounts</div>
            <div class="empty-state-hint">Create an escrow to hold Tokens for a service contract</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:1.5rem">
        <div class="card-header">
          <span class="card-title">Lookup Escrow</span>
        </div>
        <form id="escrow-lookup-form" style="display:flex;gap:0.75rem;align-items:flex-end">
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label class="form-label" for="escrow-lookup-id">Escrow ID</label>
            <input class="form-input mono" id="escrow-lookup-id" type="text" placeholder="Enter escrow ID" />
          </div>
          <button class="btn btn-secondary" type="submit" style="flex-shrink:0">
            Look Up
          </button>
        </form>
        <div id="escrow-detail" style="margin-top:1rem"></div>
      </div>
    </div>
  `;
}

export function bindEscrow(): void {
  // Create escrow modal
  document.querySelector('[data-action="create-escrow"]')?.addEventListener('click', () => {
    const overlay = openModal(
      'Create Escrow',
      `
        <form id="create-escrow-form">
          <div class="form-group">
            <label class="form-label" for="esc-beneficiary">Beneficiary</label>
            <input class="form-input mono" id="esc-beneficiary" type="text" placeholder="did:claw:… or address" required />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="esc-amount">Amount (Tokens)</label>
              <input class="form-input" id="esc-amount" type="number" min="1" step="1" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="esc-arbiter">Arbiter <span style="color:var(--text-muted)">(optional)</span></label>
              <input class="form-input mono" id="esc-arbiter" type="text" placeholder="did:claw:…" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="esc-passphrase">Passphrase</label>
            <input class="form-input" id="esc-passphrase" type="password" placeholder="Your local key passphrase" required />
          </div>
        </form>
      `,
      `
        <button class="btn btn-secondary" data-action="cancel-modal">Cancel</button>
        <button class="btn btn-primary" data-action="submit-escrow">Create Escrow</button>
      `,
    );

    overlay.querySelector('[data-action="cancel-modal"]')?.addEventListener('click', () => {
      closeModal(overlay);
    });

    overlay.querySelector('[data-action="submit-escrow"]')?.addEventListener('click', async () => {
      const beneficiary = (overlay.querySelector('#esc-beneficiary') as HTMLInputElement).value.trim();
      const amount = parseInt((overlay.querySelector('#esc-amount') as HTMLInputElement).value, 10);
      const arbiter = (overlay.querySelector('#esc-arbiter') as HTMLInputElement).value.trim() || undefined;
      const passphrase = (overlay.querySelector('#esc-passphrase') as HTMLInputElement).value;
      const did = store.getState().connection.did;

      if (!beneficiary || !amount || !passphrase) {
        showToast('Please fill all required fields', 'error');
        return;
      }

      try {
        await store.api.createEscrow({
          did,
          passphrase,
          nonce: Date.now(),
          beneficiary,
          amount,
          arbiter,
          releaseRules: [],
          autoFund: true,
        });
        closeModal(overlay);
        showToast('Escrow created successfully!', 'success');
        store.fetchBalance().catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create escrow';
        showToast(msg, 'error');
      }
    });
  });

  // Lookup escrow
  const lookupForm = document.getElementById('escrow-lookup-form');
  lookupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInput = document.getElementById('escrow-lookup-id') as HTMLInputElement;
    const escrowId = idInput.value.trim();
    const detailDiv = document.getElementById('escrow-detail')!;

    if (!escrowId) {
      showToast('Please enter an escrow ID', 'error');
      return;
    }

    detailDiv.innerHTML = '<div style="text-align:center;padding:1rem"><span class="spinner"></span></div>';

    try {
      const escrow = (await store.api.getEscrow(escrowId)) as Record<string, unknown>;
      detailDiv.innerHTML = `
        <div style="padding:1rem;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;margin-bottom:0.75rem">
            <span style="font-weight:600">Escrow ${esc(String(escrow.id || escrowId))}</span>
            <span class="escrow-status ${String(escrow.status || 'pending').toLowerCase()}">${esc(String(escrow.status || 'unknown'))}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem">
            <div><span style="color:var(--text-muted)">Amount:</span> <strong>${formatTokens(Number(escrow.amount || 0))} T</strong></div>
            <div><span style="color:var(--text-muted)">Funded:</span> <strong>${formatTokens(Number(escrow.funded || 0))} T</strong></div>
            <div style="grid-column:span 2"><span style="color:var(--text-muted)">Depositor:</span> <span style="font-family:var(--font-mono);font-size:0.78rem">${esc(String(escrow.depositor || '—'))}</span></div>
            <div style="grid-column:span 2"><span style="color:var(--text-muted)">Beneficiary:</span> <span style="font-family:var(--font-mono);font-size:0.78rem">${esc(String(escrow.beneficiary || '—'))}</span></div>
          </div>
        </div>
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Escrow not found';
      detailDiv.innerHTML = `<div style="color:var(--red);font-size:0.85rem;padding:0.5rem">${esc(msg)}</div>`;
    }
  });

  // Refresh
  document.querySelector('[data-action="refresh-escrow"]')?.addEventListener('click', () => {
    showToast('Escrow list refreshed', 'info');
  });
}
