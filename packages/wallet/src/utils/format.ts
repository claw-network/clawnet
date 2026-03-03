/** Format a token amount with thousands separators. */
export function formatTokens(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

/** Format a timestamp to locale string. */
export function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Truncate a DID or address for display. */
export function truncateAddr(addr: string, head = 12, tail = 6): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
