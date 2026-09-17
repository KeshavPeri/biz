# UI Audit — Batch 3: Chat & Discover

IDs: B3-NN. Rule refs = docs/design-direction.md §, tokens = docs/design-tokens.md Part 2.
Assumptions: `expo-glass-effect` still treated as NOT installed (option only). "Same as B1/B2-NN"
means the earlier finding covers it; fix the primitive, not the screen. Batch ran with the tab
screens as one group (index/track/you are 6–7 line wrappers, logged inline below).

### frontend/src/app/(tabs)/chat.tsx
- B3-01 [P1][SLOP] L126–129 · Inbox loads behind a centred full-screen `ActivityIndicator`
  (`#847F78`); this is the first thing a user sees on the tab every focus (refetch on
  `useFocusEffect`). Fix: keep stale rows visible on refocus (only spin when `deals` is
  empty) and use 3 skeleton preview rows (avatar circle + 2 bars, `bg-surface-recess`,
  opacity pulse 0.6→1 at 1.2s, static under reduce-motion). Same pattern as B2-07.
  ```tsx
  {loading && visibleDeals.length === 0 ? <InboxSkeleton rows={3} /> : <FlatList … />}
  // and in load(): only setLoading(true) when deals.length === 0
  ```
- B3-02 [P2][POLISH] L136 · `pb-24` (96pt) is a guessed bottom inset for the absolute tab
  bar — no `useBottomTabBarHeight`/safe-area (same as B1-10). On iPhone with home indicator
  the bar is ~83pt + margin, so the last card either clips or floats too high.
- B3-03 [P2][MOTION] L133–142 · Rows never animate in/out when a label filter changes or a
  deal is added (`FlatList` with no `itemLayoutAnimation`/`LinearTransition`). The inbox is a
  short list (<20 rows for MVP), so §8 "list add/remove" applies: `Animated.FlatList` +
  `itemLayoutAnimation={LinearTransition.duration(200)}` and `entering={FadeIn.duration(180)}`
  per row; opt out via `useReducedMotion`. Keep "dense lists don't animate" if the inbox
  grows past ~30 rows.
- B3-04 [P2][SLOP] L152–153 · A third hand-rolled filter chip (`rounded-pill px-3 py-1.5`,
  `text-[11px]`) alongside `ui/chip.tsx` and `discovery/filter-chips.tsx`; py-1.5 + 11px text
  makes the chip ~27pt tall — below the 44pt target. Selected = flat `bg-ink` fill, but
  "active = elevation, not colour" (§3/§10 pillowGlass for active states). Fix: use `ui/chip`
  and give it a 44pt hit box (`hitSlop` or `min-h-11`); same as B1-33.
- B3-05 [P2][POLISH] L149–150 · Horizontal filter scroller has no left/right `px-4` inset
  inside `contentContainerClassName` (chips align to the list's padding only by luck of
  `ListHeaderComponent`) and no scroll-edge fade at the trailing edge — chips get hard-clipped.
  Add `contentContainerStyle={{paddingHorizontal:16}}` + a 24pt right fade mask.
- B3-06 [P2][SLOP] L156, 162–164 · Two empty states with different type scales
  (`text-[14px]`/`text-[12px]` vs `text-body`/`text-[13px]`) and no illustration/icon; the
  main empty state has no CTA even though the copy says "Start one from Discover". Fix: one
  `EmptyState` component: Subtitle 17 + Secondary 13 + a Secondary (glassFlush) button
  "Browse Discover" → `router.push('/')`. Copy uses an em dash — fine, keep.
- B3-07 [P3][POLISH] L128,141 · Spinner and `RefreshControl` colour are raw `#847F78`
  literals; import from the tokens module (`colors.ink3`) so dark mode can swap it.
- B3-08 [P3][POLISH] L121 · `SafeAreaView edges={['top']}` + `pt-2` header; the Display title
  has no large-title collapse or hairline on scroll. Optional: fade in a 1px `#EAE8E2`
  hairline under the header once `contentOffset.y > 0` (opacity-only, 150ms).

### frontend/src/app/(tabs)/account.tsx
- B3-09 [P1][RULE] L29–38 · "Log out" is `action="secondary" variant="outline"` — gluestack's
  outline (1px border, transparent) — not the Inflo secondary glassFlush tier (§10, tokens
  "Buttons"). Same root cause as B1-25; on a top-level tab it is P1. Fix once in `ui/button`.
- B3-10 [P2][SLOP] L23–24 · Whole tab is `TabPlaceholder` ("Account" title shell, B1-59)
  with a bare list: no avatar/name header, no grouped settings rows, no version footer. Even
  as a shell, an L0 grouped list (hairline rows, 44pt, chevron icon from the set) would stop
  it reading as a stub. Log out should be the LAST row, neutral ghost + confirm (destructive
  routine action per §10), not a 48pt button mid-screen.
- B3-11 [P3][POLISH] L24 · `pb-32` (128pt) bottom padding — another guessed tab-bar inset
  (same as B3-02/B1-10).
- B3-12 [P3][POLISH] L36 · Spinner colour hard-coded `#1C1B18`; and no haptic on log out.

### frontend/src/app/(tabs)/track.tsx
- B3-13 [P2][SLOP] L5 · Empty `TabPlaceholder title="Track"` — a live top-level tab that
  shows only a title. Until Phase 11 lands, ship a designed "coming soon" empty state
  (Subtitle + Secondary copy + `chart` icon from the set) rather than a blank canvas.

### frontend/src/app/(tabs)/index.tsx · you.tsx
- No findings (thin wrappers; content audited under discovery/* and media-kit/*).

### frontend/src/components/chat/deal-preview-card.tsx
- B3-14 [P1][MOTION] L23–27 · The inbox row — the most-tapped element on the tab — has only
  `active:opacity-90`; no scale, no haptic, and no shared-element expand into the deal room
  (§8 "card peek/expand" is a budgeted item). Same primitive gap as B1-28. Fix: wrap in the
  shared `PressableScale` (0.97 + opacity .9, 120ms ease-out, light haptic on press-in).
  ```tsx
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  onPressIn={() => { scale.value = withTiming(0.97, { duration: 120, easing: Easing.out(Easing.quad) }); Haptics.selectionAsync(); }}
  onPressOut={() => { scale.value = withTiming(1, { duration: 160 }); }}
  ```
- B3-15 [P1][RULE] L37–38 + `lib/deals.ts` L2062–2068 · Stage pills use off-palette fills
  and text: `#F3EFE2/#8A7A45` (Approval), `#E8EFF0/#12707E` (Creating), `#EFEBE3/#6A553E`
  (Payment); and Disputed/Declined/Cancelled are red-TINT FILLS (`bg-status-critical-tint`)
  on a list row. Rule: §4 neutral-first, agreed hex only; critical red is "dot/icon/label,
  never a fill". Also `text-[10.5px]` is below the Micro 11 floor. Fix: all stage pills =
  `bg-surface-recess` + `text-ink-2`, Micro 11/500; Posted keeps the green tint (rationed
  "good"); Disputed/Declined = neutral pill + a 6pt `#C0392B` dot before the label.
- B3-16 [P2][SLOP] L41–42, L48–49, L84 · Magic values in one card: `rounded-[5px]` (not in
  radius set), `text-[10px]`, `h-[19px]` badge, `py-px`, and a literal `#C9C4BA` dot colour
  (not in palette — nearest token `cane.3 #D2CFC6` or `ink-3`). Fix: direction tag → Micro
  11 in a `rounded-pill` hairline chip; badge 20pt; dot `bg-cane-3`.
- B3-17 [P2][POLISH] L71–77 · Tag/labels button is 28×28pt with `hitSlop={8}` = 44pt total
  but visually 28pt; `event.stopPropagation()` is a web-ism — on native the inner Pressable
  already wins. Fix: 32pt visual, hitSlop 6; drop stopPropagation.
- B3-18 [P2][POLISH] L94–95, L49 · Relative time and unread count are not tabular
  (`font-geist` without `tabular-nums`); the row's right column jitters between rows. Rule:
  tokens "tabular figures for lists". Add `tabular-nums` (fontVariant `tabular-nums`).
- B3-19 [P3][POLISH] L33, 56 · `text-[15px]`/`text-[13px]` instead of the `text-body`/
  `text-secondary` role classes (line-heights and scaling caps are lost); `p-3.5` (14pt) is off
  the 4px scale — use `p-4`.
- B3-20 [P3][POLISH] L27 · `shadow-l1` on every inbox row: the tokens say L1 is for "primary
  cards" and dense lists are L0 hairline. With 10+ rows the stack becomes shadow soup; consider
  L0 rows with `border-hairline` and reserve L1 for the row with an active next-action.

### frontend/src/components/chat/private-deal-label-sheet.tsx
- B3-21 [P2][SLOP] L52 · Footer buttons are hand-rolled again (`rounded-xl`=12 not button 16,
  `text-[12px]` label, "Done" = outline, "Add label" = ink fill, disabled = `opacity-40` instead
  of the `#ECEAE3/#B6B0A6` disabled spec). Same as B2-14/B1-25. Two equal-weight footer
  buttons also break "one primary action" — "Done" should be the sheet's close affordance, not
  a button.
- B3-22 [P2][POLISH] L55 · Label `TextInput` is hand-rolled (`rounded-xl`, 13px text, no
  focus ring, no `returnKeyType="done"`/`onSubmitEditing={add}`) instead of `ui/text-field`;
  typing then reaching for "Add label" at the bottom is an extra tap. Inherits EditSheet's
  missing keyboard avoidance (B1-46) — the input sits above the keyboard only by chance.
- B3-23 [P2][SLOP] L58 · `uppercase tracking-wide text-[11px]` kicker "Your other labels" —
  same as B2-16 (kickers banned). Use Secondary 13/500 sentence case.
- B3-24 [P3][MOTION] L57 · Label rows appear/disappear with a hard cut after add/remove;
  this is exactly §8 "list add/remove" — `entering={FadeIn.duration(180)}`
  `exiting={FadeOut.duration(120)}` + `LinearTransition`, light haptic on add.
- B3-25 [P3][POLISH] L57 · "Remove" is a bare 12px text Pressable with no hitSlop (~16pt
  tall). Give it `hitSlop={12}` or make it an `x` icon at 44pt; L56 error text uses
  `text-status-bad` — NOT a defined token (tailwind has `status-critical` only), so the error
  currently renders in the default colour. Use `text-status-critical`.

### frontend/src/components/discovery/discover-screen.tsx
- B3-26 [P1][SLOP] L93–99 · The marketplace front door (first tab after login) opens on a
  blank canvas with a centred spinner; header and search field vanish too. Fix: render the
  header + search immediately, then a card skeleton grid (2×3 tiles `bg-surface-recess`,
  radius 14, opacity pulse) — same recipe as B3-01/B2-07.
  ```tsx
  <SafeAreaView …><Header/><Search/>
    {loading ? <CardSkeletonGrid columns={isBrand ? 2 : 1} rows={3} /> : <Results/>}
  </SafeAreaView>
  ```
- B3-27 [P2][RULE] L108–117 · Search field is a hand-rolled `bg-surface-recess` +
  `shadow-recessInset` box, not `ui/text-field` (radius 16, hairline, focus state). No
  leading `search` icon from the set, no clear (×) affordance, no `returnKeyType="search"`,
  `clearButtonMode`. Also `recessInset` is the TRACK shadow (tokens: "recessInset (track)"),
  not an input material. Rule: tokens "Inputs". Fix: `TextField` with `leadingIcon="search"`.
- B3-28 [P2][POLISH] L120, L141–147 · Results are a raw `.map` inside a `ScrollView` (no
  `FlatList`/virtualisation, even for the 2-column grid) with `pb-32` guessed tab-bar inset
  (B1-10). The grid uses `w-[48.5%]` + `justify-between` — column gutter drifts with screen
  width. Fix: `FlatList numColumns={2} columnWrapperStyle={{gap:12}}` +
  `contentContainerStyle={{paddingBottom: tabBarHeight + 16}}`.
- B3-29 [P2][MOTION] L138–152 · Filtering swaps the whole result set with a hard cut and no
  count-change feedback; the filter chips have no haptic. §8 build-now: "list add/remove".
  Fix: `Animated.View layout={LinearTransition.duration(200)}` on cards, `FadeIn.duration(180)`
  on new ones, `Haptics.selectionAsync()` on chip toggle; disabled under reduce-motion.
- B3-30 [P2][SLOP] L138–139 · Empty result is one line of `text-ink-3` body copy with no
  "Clear filters" action even though 3 facets + search can be active. Fix: shared EmptyState
  (B3-06) with a Secondary "Clear filters" button.
- B3-31 [P3][POLISH] L134–136 · Result count is a Subtitle 17 heading ("12 creators") — a
  number as a section title, non-tabular; the count jumps width on every keystroke. Make it
  Secondary 13 `text-ink-2` with `tabular-nums`, and put it on the same row as an "All
  filters" clear link.
- B3-32 [P3][POLISH] L107 · No large-title collapse / hairline reveal on scroll (same as
  B3-08); `placeholderTextColor="#847F78"` literal (same as B3-07).

### frontend/src/components/discovery/filter-chips.tsx
- B3-33 [P2][SLOP] L24–26 · `uppercase tracking-wide text-[11px]` kicker over each chip
  row ("NICHE", "PLATFORM", "CITY") — same as B2-16. Three stacked kicker+row groups eat
  ~150pt of the fold before any result. Fix: one chip row with facet groups separated by a
  hairline dot, or Secondary 13/500 sentence-case labels inline before the first chip.
- B3-34 [P3][POLISH] L27–31 · `pr-4` trailing pad only; no leading inset (row is inside the
  parent's `px-4` so the left edge clips on overscroll) and no right-edge fade mask. Same as
  B3-05. Chip press/selection motion: same as B1-28/B1-33.

### frontend/src/components/discovery/creator-card.tsx
- B3-35 [P1][RULE] L42 · `★` Unicode star glyph for trust score inside body text — not
  from the icon set, renders in the system font (not Geist), and breaks the outline-icon rule
  (§5, "custom set only"). Same habit as B2-66. Fix: `<StarIcon width={11} height={11}
  color="#847F78" />` inline in a flex-row, stroke 1.6.
- B3-36 [P2][SLOP] L31, 40, 46, 49, 52 · Five off-role sizes on one card: 13 / 11 / 12.5 /
  10 / 10 — none of `12.5` and `10` exist in the 6-role scale; 10pt labels ("reach", "ER")
  fail AA-large and the scaling cap. Fix: name Subtitle-ish 15/600, meta Secondary 13,
  metric 17/600 tabular, metric label Micro 11/500 sentence case.
- B3-37 [P2][POLISH] L44–65 · Metric columns are `justify-between` with no fixed widths, so
  "24.5K / 3.2% / 2" don't align across neighbouring cards in the grid; numbers not
  `tabular-nums`. Fix: `flex-1` per column, left-aligned, `tabular-nums`.
- B3-38 [P2][POLISH] L26–36 · Image scrim is a flat `rgba(28,27,24,.35)` band with a hard
  top edge at 64pt — reads as a grey bar, not a fade. Fix: `expo-linear-gradient`
  `['transparent','rgba(28,27,24,.55)']` over the bottom 50%; `StorageImage` has no
  placeholder (`bg-avatar` fallback + `FadeIn` 200ms on load) so tiles pop in white.
- B3-39 [P2][MOTION] L21–25 · No press feedback at all (not even `active:`), no haptic, no
  card→detail expand. Same as B1-28/B3-14. Verified check is a bare 11pt white glyph with
  no ring — at 11pt the 1.6 stroke disappears; use 14pt on a 18pt `bg-status-good` disc
  (consistent with brand-card L41–43).
- B3-40 [P3][POLISH] L39–40 · `px-2.5` (10pt) / `pb-3` / `pt-2` — off the 4px scale and
  inconsistent with brand-card `p-3.5`. Use `p-3` (12) throughout.

### frontend/src/components/discovery/brand-card.tsx · brand-profile-view.tsx
- B3-41 [P1][RULE] `brand-card` L8, `brand-profile-view` L7 · `LOGO_COLORS` = six
  off-palette saturated fills (`#B96A83 #A9BE8E #CBB080 #8FA3B5 #C98FA0 #7E5B4E`), including
  a blue-grey `#8FA3B5`, painted as 44pt and 64pt solid tiles with white text — on a
  neutral-first, "no blue chrome, agreed hex only" palette (§4). Duplicated in two files.
  Fix: one `LogoTile` component; `bg-avatar #E8E5DF` + `avatar.ring` + ink-2 initials (same
  as the chat Avatar), or at most a cane-ramp rotation (`#EFEBE3/#DFDACF/#D2CFC6`).
  ```tsx
  <View className="h-11 w-11 items-center justify-center rounded-panel bg-avatar"
        style={{ borderWidth: 1, borderColor: 'rgba(28,27,24,.09)' }}>
    <Text className="font-geist-semibold text-secondary text-ink-2">{initials}</Text>
  </View>
  ```
- B3-42 [P2][SLOP] `brand-card` L53, `brand-profile-view` L62 · `★` glyph again (same as
  B3-35); `text-[11.5px]`, `text-[10px]` off-role sizes (same as B3-36); `rounded-2xl` (16)
  on the 64pt logo tile vs `rounded-panel` (12) on the 44pt one — sibling radius drift.
- B3-43 [P2][SLOP] `brand-profile-view` L59–78 · "Trust strip" is the generic 3-up
  centred-metric card (craft-floor: hero-metric template): `text-[18px]` (off-role) numbers
  with `text-[10.5px]` labels, `border-l` dividers, everything centred. "Verified: Yes/No" is
  a boolean posing as a metric. Fix: left-aligned Title 20 tabular figures + Micro 11 labels;
  drop Verified from the strip (the check badge on the name already says it).
- B3-44 [P2][RULE] `brand-profile-view` L101–116 · CTA is a hand-rolled `bg-ink py-3.5`
  Pressable (44pt, OK) instead of `ui/button` — same as B2-14; the disabled state uses
  `bg-cane-3 opacity-60` + "(coming soon)" copy, not the `#ECEAE3/#B6B0A6` disabled spec.
  Also the CTA sits at the bottom of the scroll, not in a sticky footer — on a long profile
  the one primary action is off-screen. Fix: sticky bottom bar (glass scope allows "sticky
  action bar") with safe-area inset.
- B3-45 [P3][POLISH] `brand-card` L27 · `mb-3` on the card itself (spacing owned by the child,
  not the list); `p-3.5` off-scale; no press feedback (same as B3-39). `brand-profile-view`
  L23–26 · `—` for missing fields shows a 4-row card that is mostly dashes; hide empty rows.

### frontend/src/components/discovery/connect-sheet.tsx
- B3-46 [P2][MOTION] L56–58, 90–99 · "Request sent" is the first deal-creation moment and
  it hard-cuts from the confirm body to a static check disc. This is a genuine win-tier
  moment (§8 allows a tiny spring here). Fix: `Haptics.notificationAsync(Success)` on `done`,
  check disc `entering={ZoomIn.springify().damping(18).stiffness(220)}` from scale .8,
  body `FadeIn.duration(200)`; instant under reduce-motion.
- B3-47 [P3][POLISH] L73, 77 · Uses `ui/button` `size="xl"` (good) but "Done" as a full
  primary button after success duplicates the sheet's close; a Secondary is enough. Inherits
  EditSheet B1-45/46/47/48.

### frontend/src/app/brand/[id].tsx · creator/[id].tsx
- B3-48 [P2][POLISH] both L38–48 · Detail header is a lone 40pt back chevron (below 44pt
  visual; hitSlop makes it 56) with no title, no hairline, and content scrolls under nothing —
  no glass header even though this is a nav surface where glass is in scope (§3). Fix: shared
  `DetailHeader`: 44pt back target, centred Subtitle title that fades in on scroll (opacity,
  150ms), `GlassSurface` (B1 glass-surface) background once scrolled.
- B3-49 [P2][SLOP] both L50–53 · Centred spinner while the profile loads (same as B3-01/
  B3-26); use a profile skeleton (avatar + 2 lines + card). Both files are 95% identical —
  one `DetailRoute` wrapper would fix header/loading/error in one place.
- B3-50 [P3][POLISH] both L61–63 · `pb-16` bottom inset instead of `useSafeAreaInsets().bottom`
  (no tab bar here, so 64pt is arbitrary); error state has no "Go back" action; no
  `router.back()` haptic. Native edge-swipe back is intact (no gesture override) — good.

