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

/** 4.6 → "4.6%"; null → "—". */
export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n}%`;
}
