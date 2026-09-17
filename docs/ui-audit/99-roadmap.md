# UI Audit — Roadmap (Batch 6 synthesis)

> **Update:** batches 4 and 5 are now done. Their findings, PR-00 and PR-19 to PR-23, and the final run order are in `99-roadmap-addendum.md`. Read both files together.


Sources: 00-baseline.md, batch-1.md (B1-01…60), batch-2.md (B2-01…69), batch-3.md (B3-01…50).
Batches 4 (auth/onboarding) and 5 (media-kit) were NOT run when this was written — re-run this
synthesis (or append) once batch-4.md / batch-5.md exist. Rule refs = design-direction.md §.
Root cause everywhere: no shared primitives, so 30+ files hand-roll buttons, chips, type, sheets
and press states. Nearly every fix is "build one primitive, route callers to it" — hence foundations first.

## 1. Top 15 changes (ranked by visual impact ÷ effort)
| # | Change | Effort | Resolves |
|---|---|---|---|
| 1 | Tab crossfade + warm `sceneStyle` on `(tabs)/_layout` (2 lines) | XS | B1-07 B1-08 |
| 2 | `PressableScale` primitive (kit §2.1), used by Button/Chip/Tab/Toggle/rows | S | B1-12 B1-28 B1-33 B2-09 B2-32 B2-38 B3-14 B3-34 B3-39 B3-45 |
| 3 | Nav bar glass recipe (§3) + animated active pill + fixed micro label | S | B1-09 B1-11 B1-13 B1-14 B1-17 B1-19 B1-20 B1-21 B1-22 B1-15 |
| 4 | Rebuild `ui/button`: secondary = glassFlush, 44pt default, disabled spec, drop positive/negative, ink focus ring | M | B1-23 B1-24 B1-25 B1-26 B1-27 B1-29 B1-30 B2-14 B2-40 B2-53 B2-59 B3-09 B3-21 B3-44 |
| 5 | Rebuild `EditSheet`: reanimated present/dismiss, keyboard avoidance, safe-area, sticky header hairline, 5pt grabber (fixes all 11 deal sheets + media-kit editors) | M | B1-45 B1-46 B1-47 B1-49 B1-50 B1-51 B2-43 B2-47 B3-22 B3-47 |
| 6 | Export `useTabBarInset()` (nav height + safe area); replace every `pb-16/24/32` guess | XS | B1-10 B3-02 B3-11 B3-28 B3-50 |
| 7 | Type-role sweep: kill every `text-[10–12.5px]` and uppercase kicker; roles only | M | B1-32 B2-06 B2-16 B2-20 B2-25 B2-35 B2-42 B2-46 B2-51 B2-57 B2-64 B2-69 B3-16 B3-19 B3-23 B3-33 B3-36 B3-42 B3-43 |
| 8 | Red-tint-fill sweep: `bg-status-critical-tint` → recess box + red dot/icon/label | S | B2-17 B2-26 B2-34 B2-48 B2-52 B2-58 B2-61 B2-63 B3-15 |
| 9 | `StageAdvance` on stage-progress-bar + success haptic on transitions | S | B2-60 B2-15 |
| 10 | `WinSpring` on deal closed / payment received / contract signed / request sent | S | B2-56 B2-27 B2-67 B3-46 |
| 11 | Sticky action bar → peek row + expandable scroll panel (chat keeps ≥40%) | M | B2-13 B2-50 B2-33 B2-22 |
| 12 | `Skeleton` primitive; replace every centred spinner | S | B2-07 B2-30 B2-68 B3-01 B3-26 B3-49 |
| 13 | Off-palette colour sweep + shared `GlassFlush` view (chat bubble, `LOGO_COLORS`, stage pills, `#F3EFE7 #5D5953 #7A7A7A #C9C4BA`) | S | B2-01 B2-10 B2-41 B2-65 B3-07 B3-15 B3-16 B3-32 B3-41 |
| 14 | Delete Expo template dead code (§4) | XS | B1-04 B1-05 B1-18 B1-52…58 B1-60 |
| 15 | Icon-set glyphs (`star`, `chevron-right` replace `★` `›`) + shared `EmptyState` with CTA | S | B2-10 B2-62 B2-66 B3-35 B3-42 B2-08 B3-06 B3-13 B3-30 |

Cheap once #2/#4 land: TextField focus + stable error border (B1-39/40/41), Toggle knob (B1-35/36/37),
Chip 44pt (B1-31/34), chat auto-scroll guard (B2-04), URL truncation (B2-37), tabular figures
(B3-18/31/37), `Alert.alert` → sheet (B2-18/67), detail-route header (B3-48/49).

## 2. Motion kit (`frontend/src/components/motion/`) — one file each, reanimated 4 + expo-haptics
Shared: `useMotion()` → `{ reduce: useReducedMotion(), t: (ms) => reduce ? 0 : ms }`. Every
primitive reads it; under reduce-motion durations become 0 (instant) and springs become opacity-only.
Easing constants: `EASE_OUT = Easing.out(Easing.quad)`, `EASE_OUT_STRONG = Easing.out(Easing.cubic)`.

2.1 `PressableScale` — wraps `Pressable`; `Animated.View` transform scale + opacity.
  pressIn: `withTiming(0.97, {duration:120, easing:EASE_OUT})`, opacity → 0.9;
  pressOut: `withTiming(1, {duration:160, easing:EASE_OUT})`. Haptic on pressIn (same frame):
  prop `haptic: 'selection' | 'light' | 'none'` (default `selection`, iOS/Android only).
  Props pass through; `hitSlop` default 4. Used by Button, Chip, BottomNav tab, inbox row,
  creator/brand cards, deal buttons. No spring — press is not a win (§8).
2.2 `SheetTransition` — used inside `EditSheet` (`Modal animationType="none"`).
  Scrim: `entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}`.
  Panel: `entering={SlideInDown.duration(260).easing(EASE_OUT_STRONG)}`,
  `exiting={SlideOutDown.duration(220)}` (symmetric path). Pan on grab area via
  `react-native-gesture-handler` (needs `GestureHandlerRootView` at root, B1-06): rubber-band
  above rest (translate ÷ 3), dismiss past 120pt or velocity > 800; light haptic on dismiss.
  Reduce-motion: fade only, 150ms.
2.3 `ListItemFade` — `Animated.View` with `entering={FadeIn.duration(180).easing(EASE_OUT)}`,
  `exiting={FadeOut.duration(120)}`, `layout={LinearTransition.duration(200)}`; prop
  `initial={false}` so the first render never animates. Only for short lists (inbox, labels,
  discover results, submission history); dense lists (chat messages beyond the last item) stay still.
2.4 `StageAdvance` — `StageProgressBar` segment width `withTiming(target, {duration:280,
  easing:EASE_OUT_STRONG})` from previous index; current-node ring scale 0.8→1 + opacity 0→1 in
  160ms; `Haptics.impactAsync(Light)` when index increases. Static under reduce-motion.
2.5 `WinSpring` — the ONLY spring in the app (§8). Fires once per transition, never on re-render:
  `Haptics.notificationAsync(Success)` then scale `withSequence(withTiming(1.03,{duration:140}),
  withSpring(1,{damping:18, stiffness:220}))` (~350ms total), children `FadeIn.duration(200)`.
  Sites: close-status-card (deal closed), payment-tracking `paid_full`/`receipt_confirmed`,
  contract-sign success, connect-sheet "Request sent", rating final submit. Reduce-motion: haptic only.
2.6 `Skeleton` — `bg-surface-recess` blocks (radius 12/pill), opacity 0.6↔1 `withRepeat(withTiming(
  1, {duration:1200}))`; static 0.8 under reduce-motion. Presets: `InboxRows`, `CardGrid`, `Thread`,
  `Profile`. Rule: initial load only; on refetch keep stale content and dip card opacity to 0.6 for 150ms.
Config-only: tab crossfade `animation:'fade'` 180ms (`'none'` under reduce-motion); Stack `'default'`/web `'fade'`.

## 3. Glass recipe (nav + active states only — §3/§10)
Native bar (`bottom-nav.tsx`, also deal-room header B2-03 and detail header B3-48):
  1. `BlurView tint="light" intensity={40}` absolute-fill (`experimentalBlurMethod` Android only).
  2. Overlay `rgba(251,250,246,0.62)` (not 0.92 — let the blur show).
  3. Specular top edge: 1pt View `rgba(255,255,255,0.8)` at top:0; hairline `#EFEDE8` 1pt at top:1.
  4. Content scrolls under: bar is absolute; screens pad by `useTabBarInset()`; add 12pt bottom
     scroll-edge fade (`LinearGradient` transparent→`bg.app` 0.9) instead of a hard divider.
  5. Bar `pt-[10px]`; tab label Micro 11/500 +0.22 tracking, `allowFontScaling={false}` (the one
     sanctioned fixed label).
Active pill (`GlassSurface variant="pillow"`, always mounted, opacity/scale animated 160ms):
  gradient 165° `#FFFFFF→#EAE7DF`; border 1pt `rgba(28,27,24,.05)`; inset 1pt white highlight at
  `rgba(255,255,255,.9)` inset 1pt so the border still reads; two shadow layers on two nested Views
  (`0 1 2 /.05` contact + `0 5 12 /.09` far); `overflow:hidden` on the inner View only. Active =
  elevation, never colour (icons stay `currentColor` ink; inactive `#847F78`).
Flush variant (secondary button, chat "mine" bubble, chart bars): same gradient, border `.07`, inset
highlight, NO outer shadow. Ship as `GlassFlush` and reuse in three places.
iOS 26 option: `expo-glass-effect` `GlassView` for the bar and active pill, gated by
`isLiquidGlassAvailable()`, with the BlurView recipe above as the fallback. Free, but a new
dependency → needs a call (RULE-CONFLICT list #4). Not installed today.
Web fallback: expo-blur renders `backdrop-filter` on modern browsers; if unsupported, raise the
overlay to `0.92` on `Platform.OS==='web'` only, keep highlight + hairline.

## 4. Template / dead code to delete (one PR, B1-53…60)
`components/hello-wave.tsx`, `parallax-scroll-view.tsx`, `themed-text.tsx`, `themed-view.tsx`,
`external-link.tsx`, `haptic-tab.tsx`, `ui/collapsible.tsx`, `ui/icon-symbol.tsx`,
`ui/icon-symbol.ios.tsx`, `app/modal.tsx` (+ its `Stack.Screen` in `_layout.tsx`),
`hooks/use-theme-color.ts`, `constants/theme.ts`. Keep `hooks/use-color-scheme` and
`tab-placeholder.tsx` (still used by Track/Account until Phase 11). After deletion grep for
`expo-symbols`, `@expo/vector-icons`, `GeistMono_400Regular` (+ `geist-mono` family) and remove
if unreferenced. In `ui/button`: remove `ButtonGroup`, `link` variant, `positive`/`negative` actions.

## 5. RULE-CONFLICT list — decisions for Keshav + Devasri
1. **Field error outline in red** (B1-42): platform convention vs §5 "red = dot/icon/label only".
   Proposal: ink outline + red dot before red error text.
2. **Sheet top radius 24** (B1-48): not in the radius set {14,12,16,pill}; iOS convention and the
   mockup use ~24. Proposal: add a `sheet: 24` token to design-tokens.md.
3. **Warning/critical washed fills** (B2-17 family, 15+ sites; also `bg-status-good-tint` card wash
   in contract-alignment-card): the code clearly wants a "warning panel". Either add a sanctioned
   neutral warning panel (recess box + icon) or allow the tint at low opacity. Proposal: neutral.
4. **`expo-glass-effect` dependency** (B1-09): free, native iOS 26 glass; needs a new-dependency
   call under the "flag additions" rule.
5. **Stage-pill colours** (B3-15): current code gives each stage its own hue; palette says
   neutral-first. Proposal: neutral pills, green tint only for Posted, red dot only for Disputed.
6. **Spring on "Request sent" / rating submit** (B3-46, B2-66): are these "genuine wins" under §8,
   or only deal closed / payment received? Proposal: yes for request sent, no for rating.
7. **L1 shadow on every inbox row** (B3-20): tokens say dense lists are L0. Proposal: L0 hairline
   rows, L1 only on the row with a pending action.
8. **Chat bubble tail radius 6** (B2-01): not in the set. Proposal: 14 all corners, or add `tail: 6`.

## 6. Implementation order — PR-sized tasks for a cheaper model (one at a time, commit each)
Each PR: touch only the listed files, no new dependencies unless stated, run `tsc` + lint, no scope creep.
PR-01 Delete dead template code (§4). Files listed above + `_layout.tsx` route removal.
PR-02 Tab crossfade + `sceneStyle` + root Stack animation; `GestureHandlerRootView` at root;
      `StatusBar style="dark"`, warm frame instead of `null` while loading. (B1-01/02/03/06/07/08)
PR-03 `useMotion()` + `PressableScale` in `components/motion/`; adopt in `ui/button`, `ui/chip`,
      `bottom-nav` tabs (haptic moves to pressIn). No visual changes beyond press.
PR-04 Rebuild `ui/button` per §1 #4 (tiers, 44/48pt, disabled spec, focus ring, role labels).
      Add `GlassFlush` view. Do not yet migrate callers.
PR-05 Migrate deal/* hand-rolled buttons (`PrimaryButton/GhostButton/InlineButton/ActionButton/
      SmallButton/SecondaryButton`) + account/brand-profile/label-sheet CTAs to `ui/button`.
PR-06 Nav glass recipe (§3): `bottom-nav.tsx`, `glass-surface.tsx`; animated always-mounted pill;
      micro label fix; unread-bound dot; `useTabBarInset()` exported and applied to all tab screens.
PR-07 `EditSheet` rebuild with `SheetTransition`, `KeyboardAvoidingView`, safe-area bottom, sticky
      header hairline on scroll, 5pt grabber, `accessibilityViewIsModal`.
PR-08 Type-role sweep, deal/* (largest: sticky-action-bar, payment-tracking-card, deliverables-card,
      terms-review-card). Replace `text-[10–12px]` and kickers; `tnum` on money/dates/counts.
PR-09 Type-role sweep, chat/* + discovery/* + (tabs). Same rules; include `text-status-bad` fix.
PR-10 Red-tint-fill sweep across deal/* + `lib/deals.ts` stage pills (per decision §5 #3/#5).
PR-11 Off-palette colour sweep + `GlassFlush` chat bubble + `LogoTile` component replacing
      `LOGO_COLORS` in brand-card and brand-profile-view.
PR-12 `Skeleton` primitive + presets; replace spinners in chat.tsx, discover-screen, deal/[id],
      brand/[id], creator/[id], participant-sheet, post-close-card. Keep stale rows on refetch.
PR-13 `StageAdvance` in stage-progress-bar + light haptic; success haptic in sticky-action-bar
      transition handlers; contract-sign success haptic.
PR-14 `WinSpring` at close-status-card, payment-tracking `paid_full`, connect-sheet done state.
PR-15 Sticky action bar peek/expand (`LinearTransition` 240ms, `maxHeight` 60%, inner ScrollView);
      terms-review gets its own sheet with a sticky approve bar; deliverables: one primary per row
      + overflow. Largest PR; do last among structural work.
PR-16 `ListItemFade` on inbox rows, label sheet rows, discover results, submission history.
PR-17 Polish batch: TextField focus/error-border/a11y label; Toggle knob + hitSlop; Chip 44pt; icon
      glyph swaps; `EmptyState` + CTAs; chat auto-scroll guard; URL truncation; `Alert.alert` → sheet.
PR-18 Detail-route header (`brand/[id]`, `creator/[id]`, deal header): 44pt back, scroll-reveal
      title + glass background; safe-area bottom instead of `pb-16`.
After batches 4 and 5 run: append their findings to §1/§6 before starting PR-08 onward.
