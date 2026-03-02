/**
 * Transfer page — send Tokens to another agent.
 */

import { store } from '../state/store.js';
import { formatTokens, esc } from '../utils/format.js';
import { showToast } from '../components/toast.js';

export function renderTransfer(): string {
  const s = store.getState();
  const { balance } = s;

  return `
    <div class="container page-content">
      <div class="section-header">
        <h1 class="section-title">Send Tokens</h1>
        <span style="font-size:0.85rem;color:var(--text-muted)">
          Available: <strong style="color:var(--text-primary)">${formatTokens(balance.available)}</strong> Tokens
        </span>
      </div>

      <div class="card" style="max-width:560px;margin:0 auto">
        <form id="transfer-form">
          <div class="form-group">
            <label class="form-label" for="tx-to">Recipient</label>
            <input
              class="form-input mono"
              id="tx-to"
              type="text"
              placeholder="did:claw:… or wallet address"
              required
            />
            <p class="form-hint">DID or wallet address of the recipient agent</p>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="tx-amount">Amount</label>
              <input
                class="form-input"
                id="tx-amount"
                type="number"
                min="1"
                step="1"
                placeholder="0"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="tx-fee">Fee <span style="color:var(--text-muted)">(optional)</span></label>
              <input
                class="form-input"
                id="tx-fee"
                type="number"
                min="0"
                step="1"
                placeholder="Auto"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="tx-memo">Memo <span style="color:var(--text-muted)">(optional)</span></label>
            <input
              class="form-input"
              id="tx-memo"
              type="text"
              maxlength="256"
              placeholder="Payment note"
            />
            <p class="form-hint">Max 256 characters</p>
          </div>

          <div class="form-group">
            <label class="form-label" for="tx-passphrase">Passphrase</label>
            <input
              class="form-input"
              id="tx-passphrase"
              type="password"
              placeholder="Your local key passphrase"
              required
            />
          </div>

          <div id="tx-preview" style="display:none;margin-bottom:1.25rem;">
            <div class="card" style="background:var(--bg-surface);padding:1rem">
              <div style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.75rem">Transfer Preview</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem">
                <span style="color:var(--text-muted);font-size:0.85rem">To</span>
                <span id="preview-to" style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text-secondary)"></span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem">
                <span style="color:var(--text-muted);font-size:0.85rem">Amount</span>
                <span id="preview-amount" style="font-weight:600;font-size:0.92rem"></span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--text-muted);font-size:0.85rem">Fee</span>
                <span id="preview-fee" style="font-size:0.85rem;color:var(--text-secondary)"></span>
              </div>
            </div>
          </div>

          <div style="display:flex;gap:0.75rem">
            <button class="btn btn-primary" type="submit" id="tx-submit" style="flex:1">
              Send Tokens
            </button>
            <button class="btn btn-secondary" type="button" data-nav="dashboard">
              Cancel
            </button>
          </div>
        </form>

        <div id="tx-result" style="display:none;margin-top:1.5rem">
          <div class="card" style="background:var(--green-soft);border-color:rgba(34,197,94,0.2);padding:1.25rem;text-align:center">
            <div style="font-size:1.5rem;margin-bottom:0.5rem">✓</div>
            <div style="font-weight:600;margin-bottom:0.3rem">Transfer Sent</div>
            <div id="tx-result-hash" style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-secondary);word-break:break-all;margin-bottom:0.75rem"></div>
            <button class="btn btn-sm btn-secondary" data-action="new-transfer">Send Another</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindTransfer(): void {
  const form = document.getElementById('transfer-form') as HTMLFormElement | null;
  if (!form) return;

  // Live preview
  const toInput = document.getElementById('tx-to') as HTMLInputElement;
  const amountInput = document.getElementById('tx-amount') as HTMLInputElement;
  const feeInput = document.getElementById('tx-fee') as HTMLInputElement;
  const preview = document.getElementById('tx-preview') as HTMLElement;

  function updatePreview() {
    const to = toInput.value.trim();
    const amount = parseInt(amountInput.value, 10);
    if (to && amount > 0) {
      preview.style.display = 'block';
      const previewTo = document.getElementById('preview-to');
      const previewAmount = document.getElementById('preview-amount');
      const previewFee = document.getElementById('preview-fee');
      if (previewTo) previewTo.textContent = to.length > 30 ? to.slice(0, 14) + '…' + to.slice(-8) : to;
      if (previewAmount) previewAmount.textContent = `${formatTokens(amount)} Tokens`;
      if (previewFee) previewFee.textContent = feeInput.value ? `${feeInput.value} Tokens` : 'Auto';
    } else {
      preview.style.display = 'none';
    }
  }

  toInput.addEventListener('input', updatePreview);
  amountInput.addEventListener('input', updatePreview);
  feeInput.addEventListener('input', updatePreview);

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const to = toInput.value.trim();
    const amount = parseInt(amountInput.value, 10);
    const fee = feeInput.value ? parseInt(feeInput.value, 10) : undefined;
    const memo = (document.getElementById('tx-memo') as HTMLInputElement).value.trim() || undefined;
    const passphrase = (document.getElementById('tx-passphrase') as HTMLInputElement).value;

    if (!to || !amount || amount <= 0) {
      showToast('Please fill in recipient and amount', 'error');
      return;
    }

    if (!passphrase) {
      showToast('Passphrase is required', 'error');
      return;
    }

    const btn = document.getElementById('tx-submit') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';

    try {
      const result = await store.sendTransfer({ to, amount, passphrase, memo, fee });
      showToast('Transfer sent successfully!', 'success');

      // Show result
      form.style.display = 'none';
      const resultDiv = document.getElementById('tx-result') as HTMLElement;
      const hashDiv = document.getElementById('tx-result-hash') as HTMLElement;
      resultDiv.style.display = 'block';
      hashDiv.textContent = `TX: ${result.txHash}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed';
      showToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = 'Send Tokens';
    }
  });

  // New transfer button
  document.querySelector('[data-action="new-transfer"]')?.addEventListener('click', () => {
    store.navigate('transfer');
  });

  // Nav buttons
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      store.navigate(el.dataset.nav as 'dashboard');
    });
  });

  // Fetch balance for display
  store.fetchBalance().catch(() => {});
}
