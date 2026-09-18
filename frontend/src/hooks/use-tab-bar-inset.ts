import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** One tab: py-1.5 (12) + pill (30) + gap (3) + fixed micro label line (15). */
export const TAB_BAR_ROW_HEIGHT = 60;
/** Glass padding between the capsule's edge and the tab row, top and bottom. */
export const DOCK_PADDING_Y = 5;
/** Full height of the floating capsule dock. */
export const DOCK_HEIGHT = TAB_BAR_ROW_HEIGHT + DOCK_PADDING_Y * 2;
/** Breathing room between the last scrolled item and the top of the dock. */
const DOCK_CONTENT_GAP = 8;

/** Gap under the floating dock: clears the home indicator, or 12pt on phones without one. */
export function dockBottomOffset(safeBottom: number) {
  return Math.max(safeBottom, 12);
}

/**
 * useTabBarInset — how much of the screen bottom the floating dock occupies (content
 * scrolls under it). Tab screens pad their scroll content by this plus a 16pt gap
 * instead of guessing with `pb-24`/`pb-32`. The label never scales, so it's exact.
 */
export function useTabBarInset() {
  const { bottom } = useSafeAreaInsets();
  return DOCK_HEIGHT + dockBottomOffset(bottom) + DOCK_CONTENT_GAP;
}
