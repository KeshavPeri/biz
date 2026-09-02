/**
 * Display formatters (Phase 8). Small, pure, shared across the media-kit view and
 * editors (and later the brand-facing screen, 8.3).
 */

/** 48200 → "48.2K", 1_200_000 → "1.2M", 940 → "940". */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** 35000 → "₹35,000" using the Indian digit grouping. */
export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/**
 * Groups an exact server decimal for display without converting it to a JS
 * number. That preserves every digit and never rounds or performs currency
 * conversion. The currency code stays visible for an unambiguous ledger label.
 */
export function formatExactMoney(amount: string, currency: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(amount);
  if (!match) return `${currency} ${amount}`;
  const [, sign, integer, fraction = ''] = match;
  return `${currency} ${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}

/** 4.6 → "4.6%"; null → "—". */
export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n}%`;
}

/**
 * A compact relative-time label for chat timestamps: "now", "5m", "3h",
 * "2d", else a short date. Kept coarse — chat previews don't need seconds.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** A clock time for message bubbles, e.g. "11:42 AM". */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
