/**
 * Toast notification system.
 */

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export type ToastType = 'success' | 'error' | 'info';

const icons: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  info: 'ℹ',
};

export function showToast(message: string, type: ToastType = 'info', duration = 3500): void {
  const root = ensureContainer();

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span>${message}</span>
  `;

  root.appendChild(el);

  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}
