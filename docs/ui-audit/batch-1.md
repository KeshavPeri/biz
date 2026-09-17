# UI Audit — Batch 1: Foundations & navigation

IDs: B1-NN. Rule refs = docs/design-direction.md §, tokens = docs/design-tokens.md Part 2.
Assumption: `expo-glass-effect` is NOT installed (not in package.json) — flagged as option only.

### frontend/src/app/_layout.tsx
- B1-01 [P2][MOTION] L79 · Root `Stack` uses default per-platform transitions; on web that is
  no transition at all, and no `animation`/`gestureEnabled` is set for the deal/creator/brand
  sibling routes. Fix: `screenOptions={{ headerShown:false, animation:'default' }}` on native,
  `animation:'fade'` (≈200ms) on web via `Platform.select`; keep the iOS edge-swipe alive.
- B1-02 [P2][POLISH] L68–70 · `return null` while fonts/auth load leaves a blank white frame
  between splash hide and first paint on web (splash is native-only). Fix: render a
  `bg-app` (#FBFAF6) View instead of null so the first web frame is the warm ground.
- B1-03 [P2][POLISH] L73–74 · `GluestackUIProvider mode="light"` is hard-wired while
  `ThemeProvider` follows `colorScheme` → React Navigation chrome (modal sheet bg, status bar
  content) can flip dark while the app stays light. Fix: pass `mode="light"` to both (dark is
  fast-follow) or `mode={colorScheme}` to both; also set `StatusBar style="dark"` explicitly
  rather than `auto`.
- B1-04 [P3][SLOP] L82 · Template `modal` route with `title:'Modal'` still registered — see
  template section.
- B1-05 [P3][SLOP] L17,54 · `GeistMono_400Regular` loaded on every launch; no usage in `src/`
  (grep). Tokens call for Geist + tabular figures, not a mono face. Drop the font (and the
  `geist-mono` tailwind family) unless a ledger view needs it.
- B1-06 [P3][POLISH] L1–30 · No `GestureHandlerRootView` at the root; any sheet/drag work in
  later batches (sticky action bar, edit sheets) needs it. Not a defect today; note for roadmap.

### frontend/src/app/(tabs)/_layout.tsx
- B1-07 [P1][MOTION] L10–13 · No tab crossfade: `Tabs` gets no `animation`/`sceneStyle` and
  no `lazy` decision; switching tabs is a hard cut, which is the single most-felt motion in
  the app (§8 "tab crossfade" is a build-now item). Fix (bottom-tabs v7):
  ```tsx
  <Tabs screenOptions={{
    headerShown: false,
    animation: 'fade',                 // v7 opacity crossfade, ~150–200ms
    sceneStyle: { backgroundColor: '#FBFAF6' },
    transitionSpec: { animation: 'timing', config: { duration: 180 } },
  }} tabBar={(p) => <BottomNav {...p} />}>
  ```
  Under reduce-motion swap `animation:'none'`. Rule §8: 120–200ms micro, opacity only.
- B1-08 [P2][POLISH] L10 · Tab scenes default to React Navigation's theme background
  (`DefaultTheme.colors.background` = #F2F2F2, a cold grey) during lazy mount/transitions;
  visible as a grey flash behind translucent nav. Fix: `sceneStyle:{backgroundColor:'#FBFAF6'}`
  (covered by B1-07 snippet).

### frontend/src/components/bottom-nav.tsx
- B1-09 [P1][GLASS] L52–67 · Bar is 92% opaque warm fill over a `intensity=20` blur → the
  blur is invisible; reads as a flat opaque strip with a hard 1px top border, not Liquid
  Glass. No inner top highlight, no soft fade for content scrolling under. Fix:
  ```tsx
  <BlurView tint="light" intensity={40} style={StyleSheet.absoluteFill} />
  <View style={{ backgroundColor: 'rgba(251,250,246,0.62)' }} />   // let blur show
  {/* 1px specular top edge */}
  <View pointerEvents="none" style={{ position:'absolute', top:0, left:0, right:0,
        height:1, backgroundColor:'rgba(255,255,255,0.8)' }} />
  {/* hairline BELOW the highlight, not border-t (border-t sits on the highlight) */}
  ```
  Web fallback: `backdrop-filter` works via expo-blur on web; if not, keep 0.92 fill only on
  `Platform.OS==='web'`. Option: `expo-glass-effect` `GlassView` (iOS 26, SDK 54) for the bar
  with `BlurView` fallback below iOS 26 — not installed; needs a call (free, no cost).
  Rule §3/§10, tokens "Material signatures".
- B1-10 [P1][POLISH] L52 · Bar is `absolute` but no consumer accounts for its height:
  `useBottomTabBarHeight` is never used and only `chat.tsx` pads `pb-24` by hand (magic
  number). Track/Discover/You content can end under the bar. Fix: export a `NAV_HEIGHT`
  constant (or use `useBottomTabBarHeight()`) and apply `contentContainerStyle={{paddingBottom:
  navHeight + 16}}` in every tab screen; also `scrollIndicatorInsets`.
- B1-11 [P2][MOTION] L102–113 · Active pill mounts/unmounts (`isActive ? <GlassSurface> :
  <View>`), so the pillow-glass appears with a hard pop and the highlighted icon jumps
  between two different parent trees. Fix: always render one `GlassSurface` wrapper and animate
  its opacity/scale with reanimated (`withTiming(isActive?1:0,{duration:160,
  easing:Easing.out(Easing.quad)})`, from scale 0.95), which also removes the shadow-class
  race that forced the inline-style workaround in glass-surface.tsx. §8 "pillow-glass nav".
- B1-12 [P2][MOTION] L93–99 · No press feedback on tabs (no `onPressIn` scale 0.97/opacity,
  ~120ms). Haptic fires on `onPress` (release), not on `onPressIn`, so the haptic lags the
  touch. Fix: reanimated pressed scale + move `Haptics.selectionAsync()` to `onPressIn`.
- B1-13 [P2][POLISH] L119–125 · Tab label `text-[11px]` has no `allowFontScaling={false}`
  (tokens: tab-bar micro label is the ONE sanctioned "fixed" override) and no
  `letterSpacing:0.22`/`lineHeight:15` from the Micro role. At 200% Dynamic Type labels wrap
  and the bar doubles in height. Fix: `allowFontScaling={false}` + Micro role tracking.
- B1-14 [P2][POLISH] L99,105 · Touch target: pill `h-[30px]` + label ~15 + `py-1.5` (12) =
  ~57pt tall — fine — but the pill is `w-11` (44) inside `flex-1` so the whole column is
  tappable; OK. However `hitSlop` is absent on the bar's top edge and the bar's `pt-2` +
  `border-t` put the pill 1px off the highlight; use `pt-[10px]` so the pill sits on the
  4px grid clear of the hairline.
- B1-15 [P2][POLISH] L114–117 · Notification dot is hard-coded `dot:true` on Chat
  ("placeholder per the mockup") → always-on green dot in production is false signal, and
  §5 rations green for real "good". Fix: bind to unread count (or remove until wired).
- B1-16 [P3][SLOP] L21–22 · Local `INK`/`TERTIARY` hex constants duplicate tokens already in
  `tailwind.config.js`; fine for SVG `color`, but source them from one shared `tokens.ts`.
- B1-17 [P3][POLISH] L57–58 · `experimentalBlurMethod="dimezisBlurView"` is Android-only and
  costly; set only when `Platform.OS==='android'`.

### frontend/src/components/haptic-tab.tsx
- B1-18 [P2][SLOP] L1–18 · Dead Expo-template file: `HapticTab` is imported nowhere (grep);
  the custom `BottomNav` owns haptics. Uses `process.env.EXPO_OS` and `PlatformPressable`
  (stock Android ripple). Delete. If kept, fold the `onPressIn` haptic idea into BottomNav
  (B1-12).

### frontend/src/components/ui/glass-surface.tsx
- B1-19 [P2][GLASS] L47–56 · Pillow lift is a single shadow (`0 5 / .09 / radius 6`) — the
  token spec is two layers (`0 1px 2px .05` + `0 5px 12px .09`) and `shadowRadius` should be
  ~12/2 = 6 only for the far layer; the near contact shadow is missing so the pill floats
  rather than sits. Fix: nest two Views (outer far shadow, inner contact shadow) or on iOS
  use two `shadow*` layers; on web set `boxShadow` string with both layers via `Platform`.
- B1-20 [P2][RULE] L60 · Border is `rgba(28,27,24,0.07)` for BOTH variants; tokens say
  pillow = `.05`, flush = `.07`. Minor, but the nav-active pill reads a touch heavier than
  spec. Fix: `variant==='pillow' ? 0.05 : 0.07`. Tokens "Material signatures".
- B1-21 [P2][POLISH] L59–74 · `overflow-hidden` clips the outer shadow on Android
  (`elevation`) and clips any child that wants to bleed; and the LinearGradient `end`
  (x .35, y 1) ≈ 160° — fine. Also no `borderCurve:'continuous'` is correct (squircle
  rejected). Fix: move `overflow:hidden` to an inner View so shadow/elevation survives.
- B1-22 [P3][POLISH] L86–93 · Top highlight is a 1px opaque-white View; on the `flush`
  variant it also sits over the border, so the hairline disappears at the top edge. Inset it
  by 1px (`top:1, left:1, right:1`) so border + highlight both read.
- B1-23 [P3][GLASS] · `GlassSurface` is only used by BottomNav; secondary buttons (see
  button/index.tsx) don't use it, so "flush glass" exists as a component but not in the
  button tier — fix lives in B1-2x.

### frontend/src/components/ui/button/index.tsx
- B1-24 [P1][RULE] L41–52 · Button is still gluestack's stock recipe: `action="positive"`
  fills green (`bg-success-500`) and `action="negative"` fills red (`bg-error-500` = #C0392B),
  and the focus ring is `ring-indicator-info` (blue). §5: red is never a fill, green rationed,
  no blue chrome. Nobody uses positive/negative yet (grep: only `action="primary"` in 8
  call-sites), so the risk is a cheaper model reaching for them later. Fix: delete the
  `positive`/`negative` actions (or map both to the neutral ghost + confirm pattern) and set
  the focus ring to ink: `data-[focus-visible=true]:web:ring-ink/40`.
- B1-25 [P1][RULE] L41–60, 122–160 · No Inflo secondary tier. `action="secondary"` is
  gluestack grey (`--color-secondary-500` = #D9D9DB, a cold grey off-palette) and `outline`
  is a bare border. Tokens define secondary = `glassFlush` (gradient #FFFFFF→#EAE7DF,
  hairline .07, 1px inner highlight, ink label, NO outer shadow). Result: 29 screen files
  hand-roll their own `Pressable` + `bg-ink` buttons instead of using this component, so
  press states/heights drift screen to screen. Fix: add variants and route screens to them:
  ```tsx
  // action: 'primary' | 'secondary' | 'tertiary' | 'ghost'
  primary:   'bg-ink',                                   // label text-white
  secondary: 'bg-transparent border border-[rgba(28,27,24,0.07)]', // wrap children in
             //   <GlassSurface variant="flush" className="rounded-button" />
  tertiary:  'bg-[#EDEAE3]',                             // label text-ink
  ghost:     'bg-transparent',                           // label text-ink-2
  ```
  Rule §10 / tokens "Buttons", "Material signatures".
- B1-26 [P2][RULE] L62–68 · Sizes `xs h-8 / sm h-9 / md h-10` are 32/36/40pt — below the
  44pt floor — and `md` is the default. `size` text maps to Tailwind `text-xs…text-xl`
  (12/14/16/18/20) instead of the 6 Geist roles (Body 15 / Subtitle 17). Fix: `md: 'h-11'`
  (44) default, `lg: 'h-12'` (48), drop xs/sm for touch surfaces; label = `text-body`
  (15/600) for md, `text-subtitle` (17/600) for lg; add `allowFontScaling` cap 125%.
- B1-27 [P2][RULE] L41 · Disabled = `opacity-40` on whatever fill. Tokens: disabled bg
  `#ECEAE3`, label `#B6B0A6`, same in both modes. Opacity-40 ink on the warm ground gives a
  muddy translucent grey and lets underlying content bleed through. Fix:
  `data-[disabled=true]:bg-[#ECEAE3] data-[disabled=true]:opacity-100` + text `#B6B0A6`.
- B1-28 [P2][MOTION] L16,41–46 · Press feedback is a colour darken (`active:bg-primary-700`)
  only; no scale 0.97 + opacity ~120ms, no haptic. This is the highest-frequency
  interaction in the app. Fix: wrap `Root` in a shared `PressableScale` (reanimated
  `withTiming(0.97,{duration:120, easing:Easing.out(Easing.quad)})` on pressIn, back on
  pressOut, `Haptics.selectionAsync()` on pressIn for iOS) and use it for Chip/Tab too.
- B1-29 [P3][POLISH] L41 · `web:ring-2` focus ring has no `ring-offset`, so on the ink fill
  it is invisible; `gap-2` (8) between icon and label is right, but `ButtonIcon` sizes
  `h-[18px]` for md/lg break the 1.6-stroke icon grid (icons are 24-grid; use 20 or 24).
- B1-30 [P3][SLOP] L258–290 · `ButtonGroup` + `link` variant with `underline` hover are
  gluestack web idioms (hover-only affordance). Unused; remove or keep out of the API.

### frontend/src/components/ui/chip.tsx
- B1-31 [P2][POLISH] L22 · Height ≈ 38pt (`py-2.5` 10+10 + 18 lh) — under the 44pt floor
  and the pill has no `hitSlop`. Fix: `py-3` (→ 42) + `hitSlop={{top:4,bottom:4}}`, or
  `min-h-11`.
- B1-32 [P2][RULE] L27 · `text-[13.5px]` is not a type role (Secondary is 13, Body 15).
  Also `px-[15px]` is off the 4px grid. Fix: `text-secondary font-geist-medium` + `px-4`.
  Rule §4 (6 roles) / tokens "Spacing".
- B1-33 [P2][MOTION] L18–33 · Selection toggles with a hard cut (fill + text colour swap)
  and no press feedback/haptic. Filter chips are tapped constantly on Discover. Fix: use the
  shared `PressableScale` (B1-28) and animate the fill with `withTiming` 150ms on
  backgroundColor of an absolutely-filled inner View (opacity 0→1 of an ink layer keeps it
  transform/opacity-only), `Haptics.selectionAsync()` on select.
- B1-34 [P3][POLISH] L26–32 · No `numberOfLines={1}`; long niche names wrap the pill into
  two lines. Add `numberOfLines={1}` + `maxFontSizeMultiplier={1.25}`.

### frontend/src/components/ui/toggle.tsx
- B1-35 [P2][MOTION] L30–33 · Knob jumps (`marginLeft: value ? 22 : 3`, no animation). A
  switch is the canonical "must animate" control. Fix: reanimated
  `translateX: withTiming(value ? 19 : 0, {duration:160, easing:Easing.out(Easing.quad)})`
  on an `Animated.View` with `left:3`; track colour crossfade via an ink overlay opacity
  0→1 (transform/opacity only); `Haptics.impactAsync(Light)` on change; instant under
  reduce-motion. §8 micro band 120–200ms.
- B1-36 [P2][POLISH] L20–28 · Touch target is 48×29pt; below 44pt vertically. Fix:
  `hitSlop={{top:8,bottom:8}}`. Also `shadow-recessInset` (inset) is a no-op on native, so
  the track reads flat on iOS — acceptable, but on web it does render; keep consistent by
  dropping it or adding a 1px inner top shade View like GlassSurface does.
- B1-37 [P3][RULE] L31 · Knob uses `shadow-liftIn` (the "subsection lift" token, 8px/18px
  blur) — heavy for a 23pt knob and outside its documented use. Use a contact shadow only:
  `0 1px 2px rgba(28,27,24,.12)`.
- B1-38 [P3][POLISH] L27 · Disabled = `opacity-40` (same drift as B1-27); knob offset 22
  vs 3 gives asymmetric 3pt inset only on the on side visually because the knob shadow
  bleeds right — check optically after B1-35.

### frontend/src/components/ui/text-field.tsx
- B1-39 [P2][POLISH] L46–57 · No focus state: focused and idle fields look identical
  (recess bg, no ring/border/label change). Fix: track `onFocus/onBlur`, animate a 1px ink
  border at `rgba(28,27,24,0.35)` (opacity 0→1, 150ms) and shift the label to `text-ink`;
  visible focus is an accessibility rule in the baseline.
- B1-40 [P2][POLISH] L47–49 · Error toggles `border border-status-critical` on/off → the
  field grows by 2px and shifts content when an error appears/disappears. Fix: always render
  `border` with `border-transparent` and only change the colour.
- B1-41 [P2][POLISH] L52–56 · `TextInput` gets no `accessibilityLabel={label}` (the visual
  label is a sibling), no `maxFontSizeMultiplier`, and `mb-[7px]`/`mt-[6px]` are off-grid.
  Fix: pass the label through, cap at 1.25, use `mb-2`/`mt-1`.
- B1-42 [P3][RULE-CONFLICT] L48,75 · Error styling paints the full 1px field outline in
  `#C0392B`. §5 says red only as "a small dot/icon/label" for real financial harm; a
  validation error is neither harm nor a dot. Trade-off: red outline is the platform
  convention users expect vs. the rule. Suggested compromise for Devasri/Keshav: keep the
  red error *text* + a small red dot before it, and use an ink outline for the field.
- B1-43 [P3][POLISH] L10,54 · Placeholder `#847F78` on recess `#EFEAE2` ≈ 3.2:1 — tokens
  reserve tertiary for large text/icons. Placeholders are exempt-ish, but at 15px this reads
  faint on device; consider `#5E574E` at 70% opacity.
- B1-44 [P3][POLISH] L59–64 · Eye toggle: 20pt icon + `hitSlop={10}` = 40pt; use 12 for 44.

### frontend/src/components/ui/edit-sheet.tsx
- B1-45 [P1][MOTION] L30–36 · RN `Modal animationType="slide"` slides the WHOLE tree — the
  scrim slides up with the panel instead of fading, the duration is the OS default (~350ms
  on iOS, none on web), there is no exit symmetry control, and no drag-to-dismiss. This is
  the presentation for every media-kit editor and (per batch 2 grep) likely the deal
  sheets. Fix: `animationType="none"` + reanimated:
  ```tsx
  <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} /> // scrim
  <Animated.View entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
                 exiting={SlideOutDown.duration(220)} />                              // panel
  ```
  Add a pan gesture on the grab area (`react-native-gesture-handler`) with rubber-banding
  above the rest position and dismiss past ~120pt; `useReducedMotion()` → fade only. §8.
- B1-46 [P1][POLISH] L44–62 · No keyboard avoidance: the panel is `absolute bottom-0` and
  the body is a plain `ScrollView`, so on iOS the keyboard covers the input the user just
  tapped (every editor is a form). Fix: wrap the panel in
  `KeyboardAvoidingView behavior="padding"` (iOS) or use `react-native-keyboard-controller`'s
  `KeyboardStickyView` for the footer; keep `keyboardShouldPersistTaps="handled"`.
- B1-47 [P2][POLISH] L45 · `pb-8` is fixed; no `useSafeAreaInsets().bottom`, so on
  home-indicator phones the footer button sits on the indicator, and on older devices there
  is 32pt of dead space. Fix: `paddingBottom: Math.max(insets.bottom, 16) + 8`.
- B1-48 [P2][RULE-CONFLICT] L45 · `rounded-t-[24px]` is not in the radius set (14/12/16/
  pill). iOS sheets conventionally use a large top radius (~24–38) and the mockup used 24,
  so this is probably intended — but it needs a `sheet` token so the deal sheets don't
  pick 20 or 28. Decision for the co-founders; log the value in design-tokens.md.
- B1-49 [P2][GLASS] L47–53 · Sheet header (grabber + title) is a plain `bg-app` block;
  body content scrolls straight into the title with no fade or hairline. In scope for glass
  ("sheets' grab area/headers"). Fix: make the header sticky with a bottom hairline
  `#EFEDE8` that fades in only after `contentOffset.y > 0` (reanimated
  `useAnimatedScrollHandler`), and a 12pt top scroll-edge fade mask. Blur is optional here
  (keep glass rationed); a hairline + fade is enough.
- B1-50 [P3][POLISH] L47 · Grabber `h-1 w-9` (4×36) on `bg-cane-3` — iOS uses 5×36 at
  ~30% ink; use `h-[5px]` + `bg-[rgba(28,27,24,0.18)]`, and give the grab area `hitSlop`
  so the pan gesture (B1-45) has a 44pt zone.
- B1-51 [P3][POLISH] L50 · Subtitle `leading-[19px]` overrides the Secondary role's 18px
  line-height; drop the override. Also add `accessibilityViewIsModal` on the panel so
  VoiceOver doesn't read the tab shell behind the scrim.

### frontend/src/components/ui/collapsible.tsx
- B1-52 [P2][SLOP] L1–45 · Pure Expo-template leftover: `ThemedText`/`ThemedView`,
  `IconSymbol` (SF Symbols / MaterialIcons — a foreign icon set, mixes stroke weights),
  `TouchableOpacity activeOpacity 0.8`, chevron rotates with no animation, hard-coded
  `gap:6`/`marginLeft:24`, `Colors.light.icon` from the template theme. Zero importers
  (grep). Delete. If a collapsible is ever needed, build it on `chevron` from
  `assets/icons/` with `LinearTransition` (200ms) + rotate `withTiming(90, 160ms)`.

### Template leftovers (skim; keep/delete)
- B1-53 [P2][SLOP] `components/hello-wave.tsx` — 👋 emoji wiggle, unused → **delete**.
- B1-54 [P2][SLOP] `components/parallax-scroll-view.tsx` — decorative parallax header
  (banned by §8 "no parallax/decorative motion"), unused → **delete**.
- B1-55 [P2][SLOP] `components/themed-text.tsx`, `themed-view.tsx` — template theming with
  hard-coded 16/32px type, `#0a7ea4` link blue; only importers are `app/modal.tsx` and
  `collapsible.tsx` → **delete** together with them, plus `hooks/use-theme-color.ts` and
  `constants/theme.ts` (only used by these). Keep `hooks/use-color-scheme` (root layout).
- B1-56 [P3][SLOP] `components/external-link.tsx` — unused → **delete** (re-add with
  `expo-web-browser` only when Terms/Privacy links land in Account).
- B1-57 [P2][SLOP] `app/modal.tsx` — "This is a modal" template screen, still registered in
  the root Stack with `title:'Modal'` (B1-04), unreachable (no `/modal` push) → **delete** +
  remove the `Stack.Screen`.
- B1-58 [P2][SLOP] `ui/icon-symbol.tsx` + `icon-symbol.ios.tsx` — SF Symbols/MaterialIcons
  bridge; a second icon set violates "custom set only"; only importer is `collapsible.tsx`
  → **delete**, and drop `expo-symbols` / `@expo/vector-icons` from package.json if nothing
  else imports them (not verified — one grep for a later PR).
- B1-59 [P3][POLISH] `components/tab-placeholder.tsx` — Inflo-authored shell, still used by
  `(tabs)/track.tsx` and `account.tsx` → **keep** until those screens are built (batch 3),
  then delete. Not a template file.
- B1-60 [P2][SLOP] `components/haptic-tab.tsx` — see B1-18 → **delete**.
