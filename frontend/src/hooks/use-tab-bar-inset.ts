import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Bar top padding (10pt keeps the pill on the 4pt grid, clear of the hairline). */
export const TAB_BAR_TOP_PADDING = 10;
/** One tab: py-1.5 (12) + pill (30) + gap (3) + fixed micro label line (15). */
export const TAB_BAR_ROW_HEIGHT = 60;

/** Bottom padding under the tabs: the home indicator, or 12pt on phones without one. */
export function tabBarBottomPadding(safeBottom: number) {
  return Math.max(safeBottom, 12);
}

/**
 * useTabBarInset — the full height of the floating BottomNav (content scrolls under
 * it). Tab screens pad their scroll content by this plus a 16pt gap instead of
 * guessing with `pb-24`/`pb-32`. The label never scales, so the height is exact.
 */
export function useTabBarInset() {
  const { bottom } = useSafeAreaInsets();
  return TAB_BAR_TOP_PADDING + TAB_BAR_ROW_HEIGHT + tabBarBottomPadding(bottom);
}
