/**
 * Connect page — enter node URL + API key.
 */

import { store } from '../state/store.js';
import { clawLogoSvg } from '../components/brand.js';
import { showToast } from '../components/toast.js';

export function renderConnect(): string {
  const s = store.getState();

  return `
    <div class="connect-page">
      <div class="connect-card">
        <div class="connect-logo">
          ${clawLogoSvg}
          <span class="connect-logo-text">ClawNet Wallet</span>
        </div>
        <p class="connect-title">Connect to your ClawNet node to manage Tokens</p>

        <form id="connect-form">
          <div class="form-group">
            <label class="form-label" for="node-url">Node URL</label>
            <input
              class="form-input mono"
              id="node-url"
              type="url"
              placeholder="http://127.0.0.1:9528"
              value="${s.connection.baseUrl}"
              required
            />
            <p class="form-hint">The HTTP REST API endpoint of your ClawNet node (port 9528)</p>
          </div>

          <div class="form-group">
            <label class="form-label" for="api-key">API Key <span style="color:var(--text-muted)">(optional)</span></label>
            <input
              class="form-input mono"
              id="api-key"
              type="password"
              placeholder="Enter API key for remote access"
              value="${s.connection.apiKey}"
            />
          </div>

          <button class="btn btn-primary" type="submit" style="width:100%;margin-top:0.5rem">
            Connect
          </button>
        </form>

        <div style="margin-top:1.5rem;text-align:center">
          <p style="font-size:0.78rem;color:var(--text-muted)">
            Don't have a node?
            <a href="https://docs.clawnetd.com/getting-started/deployment" target="_blank" style="color:var(--accent-hover)">Get started →</a>
          </p>
        </div>
      </div>
    </div>
  `;
}

export function bindConnect(): void {
  const form = document.getElementById('connect-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const urlInput = document.getElementById('node-url') as HTMLInputElement;
    const keyInput = document.getElementById('api-key') as HTMLInputElement;
    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;

    const baseUrl = urlInput.value.trim();
    const apiKey = keyInput.value.trim();

    if (!baseUrl) {
      showToast('Please enter a node URL', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Connecting…';

    try {
      await store.connect(baseUrl, apiKey);
      showToast('Connected successfully', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      showToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });
}
