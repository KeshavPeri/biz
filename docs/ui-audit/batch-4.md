# UI Audit — Batch 4: Auth & onboarding

Baseline: `00-baseline.md`. IDs `B4-NN`. "same as B1-xx" = already logged in batch 1.
Context: nothing in `(auth)/`, `(onboarding)/`, `auth-shell`, `signature-pad` or
`onboarding-progress` imports `react-native-reanimated`, `expo-haptics` or `maxFontSizeMultiplier`
(grep) — the whole first-run flow is static, with no haptic and no Dynamic-Type cap.
`expo-haptics` + `expo-linear-gradient` + reanimated 4 are installed (package.json), so every fix
below is dependency-free.

### frontend/src/components/ui/auth-shell.tsx
- B4-01 [P2][POLISH] L65–75 · Back button is a 36pt box (`h-9 w-9`) in a `px-[10px] pt-1.5`
  row; the icon's left edge lands at x≈17 while the title starts at 22 — visibly mis-registered.
  Fix: 44×44 target, `pl-[11px]` so the 22pt icon centres on x=22; drop hitSlop reliance.
- B4-02 [P2][RULE] L83, L98 · Screen gutter is `px-[22px]` on every auth/onboarding screen;
  the token is 16 (screen/card padding) with 20/24 as section gaps. `mb-[7px]`, `pb-[18px]`,
  `pt-1.5` are also off the 4px scale. Mockup value (22) loses to tokens (canonical order).
  Fix: `px-5` (20) or `px-4`; `mb-2`, `pb-4`, `pt-2`. One change here fixes 10 screens.
- B4-03 [P2][RULE] L88–90 · Eyebrow is `text-micro uppercase tracking-[0.7px]`; the Micro
  role is 11/500 **sentence case, +0.22px** (tokens §Type). Repeated in role.tsx L78 and
  done.tsx L74/L109. Fix: sentence case, `tracking-[0.22px]`, `font-geist-medium`.
- B4-04 [P3][RULE-CONFLICT] L88 · The eyebrow/kicker-above-heading pattern itself is banned
  by impeccable craft-floor but is the mockup's `.eyebrow` on every step. Trade-off: drop the
  kicker and let the progress bar + title carry the step (cleaner), or keep it as a Devasri
  call. Not recommended as a fix here.
- B4-05 [P2][MOTION] whole file · No entrance for title/subtitle/body on any step; pushes
  are the platform default and the content just appears. Onboarding is one of the two
  "rare group entrance" cases the budget allows a stagger for. Fix: wrap title, subtitle and
  `children` in `Animated.View entering={FadeInDown.duration(240).easing(Easing.out(Easing.cubic)).delay(i*40)}`
  (translateY 8→0, opacity 0→1); `useReducedMotion()` → no `entering`.
- B4-06 [P3][POLISH] L81–98 · Footer is a plain block under the ScrollView — when a long
  form (brand-details, creator-about) scrolls under it there is no edge. Fix: 1px
  `hairline` on the footer only while `contentSize > layout` (onContentSizeChange), or a
  16pt `bg-app` gradient fade (`expo-linear-gradient` is installed).
- B4-07 [P3][SLOP] L14 · Local `INK` hex constant (same as B1-16). Repeated: sign-up L14,
  role L13–14, platforms L33–34, signature L13, done L13–14 — six files re-declare
  `#1C1B18`/`#847F78`/`#4F7A1E`. Fix: one `tokens.ts` export.
- B4-08 [P2][POLISH] L91–93 (+ every Text in this batch) · No `maxFontSizeMultiplier` anywhere
  in the tree (grep), so the Display title scales to 310% under iOS Larger Text and the
  6-box OTP row/hero block overflow. Fix: role caps (`1.15/1.2/1.25/2/2/2`) in one shared
  `Type` component; log later files as "same as B4-08".

### frontend/src/components/ui/onboarding-progress.tsx
- B4-09 [P2][MOTION] L12–13 · Segment fill is a hard mount on each step — this is the
  wizard's "stage-bar advance", explicitly funded in §8. Fix: keep the fill mounted; on
  mount of the newly-current segment animate `scaleX` 0→1 (`transformOrigin` left,
  `withTiming(1,{duration:240, easing:Easing.out(Easing.cubic)})`); opacity-only under
  reduce-motion. Previous segments render filled instantly.
- B4-10 [P3][SLOP] L10–12 · `h-[3.5px]`, `gap-[5px]`, `rounded-[2px]` — sub-pixel height
  renders 3 or 4 by density. Fix: `h-1 gap-1 rounded-pill`.
- B4-11 [P3][POLISH] L8 · No `accessibilityRole="progressbar"` /
  `accessibilityValue={{min:0,max:total,now:current+1}}` — VoiceOver reads nothing.

### frontend/src/components/ui/signature-pad.tsx
- B4-12 [P2][POLISH] L124–129 · Strokes are raw `M…L…` polylines from every move event —
  a quick signature renders as visible polygon segments, cheapening the one "real ink"
  moment. Fix: skip points <1.5px apart and emit quadratic segments through midpoints
  (`Q cx cy mx my`); keep `STROKE_WIDTH` 2.4.
- B4-13 [P2][MOTION] L121, L140–144 · No haptic on pen-down (`Haptics.impactAsync(Light)`),
  none on Clear; Clear is a hard cut. Fix: fade the `<Svg>` opacity 1→0 over 150ms
  (`withTiming`, ease-out) then reset strokes; `selectionAsync()` on Clear.
- B4-14 [P3][SLOP] L156 · `border-[1.5px] border-dashed border-cane-3` — dashed = web
  "dropzone" idiom, off-token width, and RN dashed borders render unevenly on iOS at
  rounded corners. Same box in signature.tsx L110. Fix: `bg-surface-recess` +
  `border border-hairline` (a recessed track reads native).
- B4-15 [P3][POLISH] L181–192 · Placeholder "Sign with your finger" is wrong on web/trackpad
  ("Sign here"); "Clear and redraw" is an underlined text link with `hitSlop 6` (≈30pt),
  no `accessibilityRole`. Fix: tertiary ghost button, `min-h-11`, no underline.

### frontend/src/app/(auth)/_layout.tsx
- B4-16 [P2][MOTION] L11 · Sign-up ↔ Login swap via `router.replace` gets the default
  push slide (iOS) / nothing (web, same as B1-01) — a lateral slide between two
  near-identical forms reads as "went somewhere"; it should read as "same place, other mode".
  Fix: `screenOptions={{ headerShown:false, animation:'fade', animationDuration:200 }}`;
  override to `slide_from_right` on `verify-otp` only.

### frontend/src/app/(auth)/login.tsx
- B4-17 [P2][POLISH] L57–61 (same block: sign-up L72–76, done L170–174) · Form error is a
  centred red line that hard-mounts above the button and pushes it down 30pt (layout
  jump). Fix: reserve the slot (`min-h-[18px]`) or `Animated.View entering={FadeIn.duration(160)}`
  + `layout={LinearTransition}`; left-align to the field column; pair with the
  `alert-triangle` icon (colour + shape, never colour alone).
- B4-18 [P3][POLISH] L72–80 · "Create an account" link: `pt-3` Pressable ≈30pt tall, no
  `accessibilityRole="link"`. Same in sign-up L87–96. Fix: `min-h-11 justify-center`.
- B4-19 [P3][MOTION] L62–71 · Press feedback same as B1-28. On success there is no haptic
  and the root guard flips to a blank frame (B1-02). Fix: `Haptics.notificationAsync(Success)`
  right after `signInWithPassword` resolves; keep the button in its loading state until the
  guard navigates (currently `finally` re-enables it for a frame).
- B4-20 [P3][POLISH] L96, L110 · `returnKeyType="next"` on Email but no
  `onSubmitEditing` → the keyboard's Next key does nothing. Same on every multi-field form
  (sign-up, brand-details ×4, creator-about ×2). Fix: refs + `nextRef.current?.focus()`.

### frontend/src/app/(auth)/sign-up.tsx
- B4-21 [P2][RULE] L138 (+ signature L140, platforms L138–140, role L32/L38) · Icon size drift
  across one flow: shield 15, check/shield 16, chevron 18, role icons 21, back 22. At 15px
  the 1.6 stroke renders ≈1px and looks like a different, lighter set (rule: don't mix icon
  weights/heights). Fix: two sizes only — 16 inline, 20 in containers; drop `marginTop:2`
  hacks by centring in a 20pt box.
- B4-22 [P3][POLISH] L137 · `shadow-recessInset` is an inset shadow — NativeWind emits
  nothing for it on native (the verify-otp comment says so), so the "recess" reads as a
  flat beige block on iOS. Repeated on signature L59/L123/L139 and done L117. Fix:
  `bg-surface-recess border border-hairline` (top hairline ≈ the inset) and keep
  `web:shadow-recessInset`.
- B4-23 [P3][SLOP] L14 · hex constant — same as B4-07. Otherwise the field-level blur
  validation (L107/L123) is the right pattern; keep it.

### frontend/src/app/(auth)/verify-otp.tsx
- B4-24 [P1][MOTION] L110–147 · The 6 code boxes are the most "alive" moment of sign-up
  and every state is a hard cut: fill swap, no "next box" indicator, no caret, no shake on a
  wrong code, no success beat before the guard flips, no haptic per digit. Fix:
  ```tsx
  // per box: const s = useSharedValue(1);
  useEffect(() => { if (filled) { s.value = withSequence(withTiming(1.04,{duration:90}), withTiming(1,{duration:120})); Haptics.selectionAsync(); } }, [filled]);
  // row on error: x.value = withSequence(withTiming(-6,{duration:60}), withTiming(6,{duration:60}), withTiming(-4,{duration:60}), withTiming(0,{duration:60}));
  // + Haptics.notificationAsync(Error); on verify ok → notificationAsync(Success)
  // active box (index === code.length): 1px `ink` hairline; useReducedMotion() → opacity-only
  ```
  Total shake 240ms, inside the ~400ms cap; transform-only.
- B4-25 [P2][RULE] L125–136 · Filled box carries an outer lift (`0 8 / .09 / r9`) — lift is
  reserved for nav-active (§3/§10); an input is flush. `rounded-[13px]` is not in the radius
  set (input = 16). Mockup lift loses to tokens. Fix: `rounded-input bg-surface-card border
  border-hairline`, no shadow; unfilled = `bg-surface-recess`.
- B4-26 [P2][POLISH] L140 · Digit `fontSize:24` inline is not a role, not tabular, no cap
  (same as B4-08). Fix: `text-display` + `style={{fontVariant:['tabular-nums']}}` +
  `maxFontSizeMultiplier={1.15}`.
- B4-27 [P2][SLOP] L36 · "Something went wrong — please sign up again." is the banned
  generic copy. Fix: "We lost your email address. Go back and sign up again." with a
  Go-back action.
- B4-28 [P3][POLISH] L97–106 · "Verify" is disabled for the whole flow except the ~300ms
  between the 6th digit and auto-verify (L70) — a permanently grey primary. Fix: keep
  auto-verify, render the button as the loading surface only (`Verifying…`), or drop it and
  let the boxes + haptic carry the state (one primary action is then the resend link).
- B4-29 [P3][POLISH] L88, L167–176 · Countdown `0:42` is proportional → the label jitters
  every second; Pressable ≈30pt. Fix: `fontVariant:['tabular-nums']`, `min-h-11`.
- B4-30 [P3][POLISH] L94 · Long emails wrap the subtitle to 3 lines and push the boxes
  down; spaced em-dash in copy. Fix: email on its own line, `font-geist-semibold`,
  `numberOfLines={1} ellipsizeMode="middle"`.

### frontend/src/app/(onboarding)/_layout.tsx
- B4-31 [P3][MOTION] L11 · Same as B4-16 (default stack, none on web). Also `done` should set
  `gestureEnabled:false` once submit starts — an edge-swipe back mid-`submitOnboarding`
  re-enters preferences with a half-written profile.

### frontend/src/app/(onboarding)/role.tsx
- B4-32 [P2][RULE] L65–75 · Hero block is all off-token: `text-[32px]` (no 32 role),
  `text-[26px] leading-[31px] tracking-[-0.4px]` (Display is 26/29/-0.26), `px-[26px] pt-11`,
  `max-w-[290px]`, `rgba(251,250,246,0.72)`. Fix: wordmark as an SVG asset, headline
  `text-display`, body `text-body text-app/70`, padding `p-6`.
- B4-33 [P2][POLISH] L63–65 · The hero is a flat ink slab with 6 lines of copy — this is
  the ONE surface where the signature aqua gradient (`#119B91→#48D6C6`, hero/media only) is
  allowed, and the comment admits the mockup's glow was dropped. Fix: `expo-linear-gradient`
  (installed) radial-ish aqua glow at top-right, ~20% opacity, clipped by the card; or an SVG
  glow asset. Signature, not wallpaper — nowhere else in the wizard.
- B4-34 [P2][MOTION] L26–39 · RoleCards have no press feedback (same as B1-28) and no haptic
  on the most consequential tap of onboarding. This screen is the second allowed
  group-entrance: hero `FadeIn 240ms`, cards `FadeInDown` 60ms apart. Fix: PressableScale
  0.97 + `Haptics.impactAsync(Light)`.
- B4-35 [P3][SLOP] L31 · Icon tile `rounded-[13px]` (panel = 12), `h-11 w-11` with a 21px
  icon; chevron 18 (size drift → B4-21). Fix: `rounded-panel`, icon 20, chevron 16.
- B4-36 [P3][POLISH] L57–96 · No escape hatch: a user who lands here with the wrong account
  has no "Log out" — the only way back is deleting the app. Fix: a tertiary "Not you? Log
  out" text button under the cards.

### frontend/src/app/(onboarding)/brand-details.tsx
- B4-37 [P2][POLISH] L29 · `OnboardingProgress total={1} current={0}` draws one fully-filled
  bar before anything is typed — reads as "done". Fix: omit `progress` on the 1-step brand
  path, or `total={2} current={0}` with done as step 2.
- B4-38 [P3][POLISH] L55, L27 · Placeholder "Who brands and creators will deal with" (39
  chars) clips at 375pt and repeats the hint; subtitle runs 3 lines (117 chars, longest in
  the wizard). Fix: placeholder "Full name"; subtitle ≤2 lines. Next-key chaining: B4-20.

### frontend/src/app/(onboarding)/creator-about.tsx
- B4-39 [P2][RULE] L15–25, L87 · Niche chips are prefixed with emoji (💄🧴🏋️🍜…) — the
  explicit SLOP tell; emoji render as three different glyph sets across iOS/Android/web and
  drop saturated colour into the neutral palette (icons: custom set only). Fix: plain
  labels; if a glyph is wanted, a 16px `assets/icons/` icon via a `leading` slot on Chip
  (B1-31/32 rework).
- B4-40 [P2][MOTION] L83–108 · Chip toggle is a hard cut (same as B1-33), no
  `selectionAsync`; the 3-niche cap silently swallows the 4th tap — zero feedback. Fix:
  live counter `${niches.length} / 3` in the hint (tabular), on cap hit
  `Haptics.notificationAsync(Warning)` + counter flashes `text-ink` for 200ms.
- B4-41 [P3][SLOP] L79–81, L96–98, L83/L99 · Section labels hand-roll TextField's label
  style (`mb-[7px]`, `text-secondary font-geist-semibold text-ink-2`) and `gap-[9px]` is
  off-scale. Fix: shared `FieldLabel` + `gap-2`.
- B4-42 [P3][POLISH] L111–120 · Bio is `multiline` with no fixed height (grows/jumps as the
  user types) and the `0 / 120` counter is proportional. Fix: `min-h-[88px]`
  (3 lines), `textAlignVertical="top"`, tabular counter.

### frontend/src/app/(onboarding)/platforms.tsx
- B4-43 [P1][RULE] L27–30, L89–96 · Platform tiles are hard-coded brand-ish fills
  `#B96A83` / `#C0574B` / `#2C2A25` with a white capital letter — none in the palette (§4
  neutral-first, agreed hex only) and the "letter in a coloured square" is the generic
  avatar tell (same family as B3-41 `LOGO_COLORS`). No platform glyphs exist in
  `assets/icons/` (grep: none). Fix:
  ```tsx
  <View className="h-10 w-10 items-center justify-center rounded-panel bg-avatar border border-hairline">
    <Text className="font-geist-semibold text-body text-ink">{name[0]}</Text>
  </View>
  // or: add instagram/youtube/tiktok/x outline icons (stroke 1.6) to assets/icons/ and render at 20px in ink
  ```
- B4-44 [P2][RULE] L105–123 · Hand-rolled pill `min-h-9` (36pt < 44), `text-[12.5px]` (no
  role), and four `bg-ink` "Connect" buttons on one screen compete with the footer primary
  (one primary action). `Linked ✓` uses a glyph (same habit as B2-66). Fix: Connect =
  secondary glassFlush tier via `ui/button` (B1-25), `Linked` = disabled secondary + 14px
  `check` icon.
- B4-45 [P2][MOTION] L52–60, L112–123 · Connect: 700ms fake round-trip → spinner swap →
  hard cut to "Linked", stats line hard-swaps, threshold panel snaps to green. This is a
  small confirmation, not a win (no spring). Fix: stats `FadeIn.duration(200)`, check icon
  `ZoomIn` from 0.9 (200ms ease-out), `Haptics.notificationAsync(Success)`; threshold panel
  `layout={LinearTransition.duration(200)}`.
- B4-46 [P2][RULE] L87 (+ preferences L21) · Four (and three) stacked `shadow-l1` cards in a
  list — tokens: L0 flat + hairline for dense lists/settings; one lifted element per section.
  Fix: `border border-hairline` rows, no shadow; keep L1 only on role.tsx's two choice cards.
- B4-47 [P3][POLISH] L87, L99–101 · `mb-[11px] p-3.5` vs role/pref cards `mb-3 p-4`
  (sibling drift); stats "48.2K · 4.6% ER" not tabular and "ER" is jargon on a first-run
  screen → "4.6% engagement". Curly `’` at L148 vs `&apos;` elsewhere.

### frontend/src/app/(onboarding)/preferences.tsx
- B4-48 [P2][POLISH] L19–35 · Only the 48×29 switch is tappable (B1-36); iOS settings rows
  toggle on row tap. Fix: wrap the row in `Pressable onPress={() => onValueChange(!value)}`
  with `accessibilityRole="switch"`, `accessibilityState={{checked:value}}`; knob animation is
  B1-35.
- B4-49 [P2][SLOP] L78–85 · A permanently disabled, always-on "Deal notifications" toggle is
  a fake control — users will tap it and it reads as broken; disabled = `opacity-40` (B1-38).
  Fix: remove, or render as a static line with the cane dot: "Deal notifications are on.
  Tune them later in Account."
- B4-50 [P3][POLISH] L62 · "Finish setup" is not the finish — done.tsx's "Start discovering"
  writes the profile. Copy: "Continue". Lift on rows: B4-46.

### frontend/src/app/(onboarding)/signature.tsx
- B4-51 [P2][GLASS] L59–99 · Draw/Type segmented control: the active segment is flat white +
  an approximated outer shadow. This IS an "active state", so the pillow-glass recipe is in
  scope and the current look under-delivers it. Fix: active = `GlassSurface variant="pillow"`
  (gradient `165deg #FFF→#EAE7DF`, inset top highlight, hairline `.05`, the reserved lift)
  so it matches the nav pill; track stays `bg-surface-recess`.
- B4-52 [P2][MOTION] L63–90 · Selection is mount/unmount of the white segment (hard cut),
  no haptic. Fix: one thumb `Animated.View` sliding `translateX` between segments
  (`withTiming 200ms ease-out`), labels crossfade weight; `Haptics.selectionAsync()`;
  reduce-motion → opacity crossfade.
- B4-53 [P2][POLISH] L101–103 · Toggling Draw → Type → Draw remounts `SignaturePad`, whose
  effect fires `onChange('')` — the drawn signature is silently discarded with no warning.
  Fix: keep both mounted (toggle `display`/opacity) or lift `strokes` into this screen.
- B4-54 [P3][POLISH] L110–121 · Typed preview `fontSize:46` with no fit: a 25-char name
  overflows the 170pt box. Fix: `adjustsFontSizeToFit numberOfLines={1}
  minimumFontScale={0.5}` + `px-6`. Default mode should be `typed` on web (trackpad).
- B4-55 [P3][POLISH] L122–134 · Typed-name input hand-rolls a field (`minHeight 52`, no
  label/focus/error state, placeholder `#847F78` on recess = B1-43) instead of `TextField` —
  the only input in the wizard that differs. Fix: `TextField label="Full name"`.
  Dashed box: B4-14. Recess shadows: B4-22.

### frontend/src/app/(onboarding)/done.tsx
- B4-56 [P1][MOTION] L86–113 · The completeness ring is static (comment: "not the mockup's
  animated sweep") — this is the wizard's win moment and the budget funds it: charts
  animate once on load (300–400ms ease-out) and a success haptic is allowed here. Fix:
  ```tsx
  const p = useSharedValue(0);
  useEffect(() => { p.value = reduceMotion ? pct : withTiming(pct, { duration: 400, easing: Easing.out(Easing.cubic) },
    (done) => done && runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success)); }, [pct]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_CIRCUMFERENCE * (1 - p.value / 100) }));
  // <AnimatedCircle animatedProps={ringProps} …/>; % label via useDerivedValue → Math.round(p.value)
  ```
  No spring: it is a readout, not a deal win (§8). Recap card `FadeInDown 240ms` after the
  sweep lands.
- B4-57 [P2][SLOP] L19, L118 · `border-[#F4F2ED]` is not a palette hex (hairlines are
  `#EAE8E2`/`#EFEDE8`); `rounded-[10px]` is not in the radius set. Fix: `border-hairline-card`,
  `rounded-panel` (and outer wrapper radius = inner + 8pt inset, or collapse to one card).
- B4-58 [P2][POLISH] L106, L22–24, L123 · `fontSize:32` inline (no role, no cap — same as
  B4-08), `%`/`48.2K` not tabular; RecapRow label has no width so a long niche list squeezes
  it. Fix: `text-display` + `fontVariant:['tabular-nums']`; label `w-24`, value
  `numberOfLines={2}`.
- B4-59 [P2][POLISH] L71–72, L169–185 · Screen bypasses AuthShell: no ScrollView, so on a
  667pt iPhone SE the header + 150pt ring + recap + nudge + footer overflow and the footer
  overlaps the nudge; no `KeyboardAvoidingView` needed but no reserved error slot (B4-17).
  Fix: reuse AuthShell without progress, or ScrollView + pinned footer.
- B4-60 [P3][SLOP] L74–75, L82–83 · "YOU'RE IN, DEVASRI" shouts in uppercase micro (B4-03);
  body copy ends on a dangling em-dash "…how complete it is —". Fix: sentence case, full
  stop. Nudge bullet `h-[7px]` off-scale → `h-2 w-2`.
- B4-61 [P3][RULE] L13 · Ring stroke `#0095A8` is the chart-e1 teal ("data only") — the
  completeness % is data, so this is within the rule; noting it so nobody "fixes" it to green
  (green is rationed for good/meaning, not for progress).
