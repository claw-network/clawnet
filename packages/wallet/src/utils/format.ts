/** Format a token amount with thousands separators. Handles both number and string inputs. */
export function formatTokens(amount: number | string | undefined | null): string {
  const n = typeof amount === 'string' ? parseInt(amount, 10) : (amount ?? 0);
  if (isNaN(n)) return '0';
  return new Intl.NumberFormat('en-US').format(n);
}

/**
 * Format a timestamp to a relative or absolute string.
 * Auto-detects seconds vs milliseconds (timestamps < 1e12 are treated as seconds).
 */
export function formatTime(ts: number | string | undefined | null): string {
  if (!ts) return '—';
  let ms = typeof ts === 'string' ? parseInt(ts, 10) : ts;
  if (isNaN(ms) || ms <= 0) return '—';

  // Auto-detect: if < 1e12 it's likely seconds (before year 2001 in ms, but plausible as seconds until 2286)
  if (ms < 1e12) ms *= 1000;

  const d = new Date(ms);
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 0) return 'just now'; // future timestamps
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
