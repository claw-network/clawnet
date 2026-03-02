/**
 * Modal dialog helper.
 */

export function openModal(title: string, bodyHtml: string, actions: string): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">${actions}</div>
    </div>
  `;

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay);
  });

  // Close on Escape
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal(overlay);
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  return overlay;
}

export function closeModal(overlay: HTMLElement): void {
  overlay.remove();
}
