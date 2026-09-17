# Batch 5 — Media kit

IDs: B5-NN. "Same as" references point at batch 1–4 IDs.

### frontend/src/components/media-kit/media-kit-view.tsx
- B5-01 [P1][RULE] L78–83 · No-photo hero is a synthetic mauve/purple gradient
  (`#D9C7B4 → #9C7E86 → #6E5A78`) — none of these hex are in the palette, and §3 bans a
  synthetic gradient hero other than the aqua signature. This is the first thing a brand sees
  for every creator without photos. Fix: use the signature aqua gradient, or a flat warm
  recess with the avatar initial, both token values. Rule: §3, baseline A "Aqua (hero/media only)".
  ```tsx
  <LinearGradient colors={['#119B91', '#48D6C6']} start={{x:0,y:0}} end={{x:1,y:1}}
    style={StyleSheet.absoluteFill} />
  // or: <View style={StyleSheet.absoluteFill} className="bg-cane-2" />
  ```
- B5-02 [P1][POLISH] L117–124 · The check "verified" badge renders for every creator
  unconditionally. The creator kit has no verified flag, only per-handle
  `verification_status`. A false trust mark next to the name on a trust-first B2B product.
  Fix: show it only when at least one handle is verified (or drop it), and add an
  accessibilityLabel "Verified creator".
  ```tsx
  {data.handles.some(h => h.verification_status === 'verified') ? (
    <View accessibilityLabel="Verified creator" className="h-5 w-5 ... rounded-pill"> ... </View>
  ) : null}
  ```
- B5-03 [P1][SLOP] L34–41, L94–106 · `onEditProfile` is declared and wired by the screen but
  never rendered here. The owner has no way to edit name, bio, city or niches from their own kit.
  Fix: add an "Edit profile" secondary (glassFlush) button under the identity block in own
  view, or make the identity overlay a Pressable with an edit chip mirroring "Edit photos".
- B5-04 [P2][SLOP] L167, L251–253 · Developer copy shown to users: "mock stats · no live API"
  and "Connect flow lands with the deal engine." Fix: "Stats are indicative" (or drop the sub),
  and remove the helper line under the disabled CTA.
- B5-05 [P2][RULE] L248–249 · Disabled CTA is `bg-cane-3 opacity-60` with ink-2 text, not the
  disabled token (`#ECEAE3` bg / `#B6B0A6` text). "(coming soon)" inside a button label is
  placeholder copy. Rule: baseline A Buttons "Disabled". Same family as B1-25.
- B5-06 [P2][RULE] L150, L273, L301 · `★` and `›` text glyphs instead of the icon set
  (same as B2-66/B3-35). Use the star/chevron outline icons at 14–16pt, stroke 1.6.
- B5-07 [P2][RULE] L102, L126, L131, L138, L203, L306, L317–318, L332, L348, L365, L372, L383
  · Off-role sizes 12 / 11.5 / 10.5 / 10 / 12.5 / 18 and custom leading 19. Map to the six roles:
  Micro 11 for sub-labels, Secondary 13 for meta/bio/rows, Subtitle 17 for trust values. No
  `maxFontSizeMultiplier` anywhere. Same as B2-14 / type-role sweep.
- B5-08 [P2][RULE] L383 · LockChip label is `uppercase tracking-wide` — Micro is sentence case
  (+0.22). Same as B4-03.
- B5-09 [P2][POLISH] L150–161, L336 · Trust values and rate prices lack tabular figures
  (`fontVariant: ['tabular-nums']`). Prices in a right-aligned column visibly jitter.
  `< ${Math.round(h)}h` renders "< 0h" for sub-30-minute responders. Fix: floor at 1.
- B5-10 [P2][POLISH] L95–105, L300–302 · Hit targets: "Edit photos" pill is ~32pt tall and the
  section "Edit ›" link is ~17pt with no hitSlop. Fix: `min-h-11` on the pill and
  `hitSlop={12}` on the link. Same as B1-28 for press feedback (no scale, no haptic) on the
  pill, the CTA (L239), the Privacy row (L261) and PlatformStatCard taps.
- B5-11 [P2][SLOP] L74, L111, L364 · Off-scale radii: hero `rounded-b-[26px]`, initial tile
  `rounded-2xl`, partnership logo `rounded-[11px]`. Avatars/logos are pill per §4. Hero bottom
  radius is not a token either. Fix: `rounded-pill` for the initial + logo tiles; the hero either
  goes square-bottom or uses `rounded-b-card`.
- B5-12 [P2][POLISH] L117–119 · The 26pt display name has no `numberOfLines` and sits in a
  row with the badge, so long names wrap unpredictably or push the badge. `bio` (L131) is
  unbounded over a 300pt hero, so a long bio overflows the top of the image. Fix:
  `numberOfLines={2}` on the name with the badge inline, and `numberOfLines={3}` on the bio.
- B5-13 [P2][POLISH] L96 · The "Edit photos" chip over photos is a flat
  `rgba(28,27,24,.4)` fill. On bright photos it disappears. Fix: a small BlurView
  (intensity ~30, tint "dark") behind it, with a flat fallback on web. This is an active control
  over media, not a card, so it stays inside the glass scope. The hero has no safe-area
  awareness either: `top-6` can sit under the status bar when the screen scrolls to the top.
- B5-14 [P2][MOTION] L76 + L108–143 · The hero is a static block. The budget's "card
  peek/expand" and the discover-card → creator route (B3 shared-element note) should land here.
  Fix: a subtle scroll-linked hero scale-down/fade of the identity block via
  `useAnimatedScrollHandler` (opacity/transform only, off under reduce-motion). Parallax itself is
  banned (§8), so keep it to the fade and do not translate the image.
- B5-15 [P3][POLISH] L148, L191, L213, L224, L262 · Five L1-lifted cards stacked on one
  screen. Brand history and Credentials are dense lists and should be L0 hairline per the
  elevation rule. This makes the trust strip and the rate card read as the lifted ones.
- B5-16 [P3][SLOP] L226 · The "No past partnerships listed." empty state has no owner
  action, unlike rates and credentials. Brand history also has no edit entry for the owner.

### frontend/src/components/media-kit/media-kit-screen.tsx
- B5-17 [P1][SLOP] L32–40, L66–77 · `fetchOwnMediaKit` returns `null` on any failure
  (no Supabase client, profile read error). The screen then tells an onboarded user to "Finish
  onboarding to build your profile." with no action. The error state and the not-onboarded
  state are the same, and neither has a button. Fix: distinguish the error case with a Retry
  secondary button. Give the onboarding case a primary "Continue onboarding" that routes to the
  first incomplete step.
- B5-18 [P2][SLOP] L58–63 · Centred spinner on a blank canvas while the whole kit loads.
  Same as B3-01. A hero-block + three card skeleton would match the final layout.
- B5-19 [P2][POLISH] L88–94 · Title, "Preview as brand" label and toggle share one row. At
  400pt with larger Dynamic Type they collide, and the title has no `numberOfLines`. Fix: move the
  toggle into a segmented "Edit / Brand view" control under the title. The active segment gets
  the pillow recipe (in scope, same reasoning as B4-51). Otherwise let the row wrap.
- B5-20 [P2][RULE] L97 · Preview banner relies on `shadow-recessInset`, which renders nothing on
  native (same as B4-22). The Exit link (L101) is ~18pt tall with no hitSlop.
- B5-21 [P2][MOTION] L96–105, L108–126 · Toggling preview swaps the banner and the whole kit
  instantly. Fix: `FadeIn.duration(180)` / `FadeOut.duration(140)` on the banner, and a 200ms
  opacity crossfade on the kit content keyed by `viewerMode`. Instant under reduce-motion.
  Pair with `Haptics.selectionAsync()` on toggle.
- B5-22 [P2][POLISH] L47–51 · `afterSave` awaits the refetch before closing the sheet, so a save
  looks frozen for the whole network round-trip, with no success feedback. Fix: close the sheet on
  save success, refetch in the background, and show a brief success toast with a
  `Haptics.notificationAsync(Success)`.
- B5-23 [P2][POLISH] L107, L190 · `pb-32` guesses the tab-bar inset. Same as B1-10.
- B5-24 [P2][SLOP] L181–214 · The brand "You" tab is a bare four-row table plus a full-width
  primary button. "Website" is not tappable, missing values show "—", and there is no logo or
  avatar. "Verified: Not yet" gives no path to get verified. Fix: a brand identity header with
  logo tile + name, "Add website" inline prompts for empty rows instead of "—", and a secondary
  (glassFlush) edit button. Editing is not the screen's primary job.
- B5-25 [P3][POLISH] L89 vs L191 · The creator title uses Title (20) while the brand title and the
  empty state use Display (26). Pick one role for the tab's top title.

### frontend/src/components/media-kit/photo-carousel.tsx
- B5-26 [P2][POLISH] L46–57 · Page dots sit at `bottom-2`, directly under the identity overlay
  (name, bio, "Open to" pill), which renders later and on top. With a bio the dots are hidden or
  collide with the text. Fix: move the dots to the top of the hero (below the safe area), or give
  them a fixed slot above the name inside the overlay.
- B5-27 [P2][POLISH] L31–44 · No accessibility for the pager: no "Photo 2 of 4" label and no
  adjustable role. Fix: `accessibilityRole="adjustable"` + `accessibilityValue={{ text:
  \`Photo ${index+1} of ${paths.length}\` }}` with increment/decrement actions.
- B5-28 [P3][MOTION] L49–54 · The active dot jumps from 6 to 16pt wide instantly. Fix:
  reanimated `withTiming` (160ms, ease-out) on the active dot, driven from the scroll offset.
  Use scaleX or opacity instead of width to stay transform-only.
- B5-29 [P3][POLISH] L24–27, L35 · `setState` on every 16ms scroll frame re-renders all slides.
  Fix: compute the index in `onMomentumScrollEnd`, or use a reanimated scroll handler.
  `useWindowDimensions().width` assumes a full-bleed parent, so on wide web the pages overflow
  any max-width container. Fix: measure the container with `onLayout`.

### frontend/src/components/media-kit/platform-stat-card.tsx
- B5-30 [P1][RULE] L8–17, L40–47 · Platform tiles use off-palette fills: pink `#B96A83`,
  brick `#C0574B`, blue `#2C6BA0` (blue chrome), brown `#7E5B4E`. Pinterest is filled with the
  critical red `#C0392B`, which is never allowed as a fill. They also show a letter where an icon
  belongs. Same family as B4-43 and B3-41. Fix: a neutral `bg-avatar` tile with an outline
  platform icon in ink. The platform icons are not in the set yet, which B4-43 already flags.
  ```tsx
  <View className="h-7 w-7 items-center justify-center rounded-pill bg-avatar">
    <PlatformIcon platform={handle.platform} width={16} height={16} color="#1C1B18" />
  </View>
  ```
- B5-31 [P2][RULE] L44, L49, L55, L62–92 · Off-role sizes 9 / 10 / 12 / 21. The "Primary"
  badge is 9pt uppercase (below Micro, not sentence case). The "Pending" label is 10pt `ink-3`,
  and tertiary fails AA on small text. Fix: Micro 11 sentence case, and ink-2 for the Pending
  label. The follower count should be Title 20 with tabular figures.
- B5-32 [P2][POLISH] L62–78 · Numeric values (followers, engagement, reach) lack tabular
  figures, so the value column drifts across the 2-up grid. "Eng. rate" is an abbreviation.
  Use "Engagement".
- B5-33 [P2][POLISH] L98–103 · The whole card is the edit target with no pressed state, no
  haptic and no accessibilityLabel. VoiceOver reads the card's full text as a button name. Fix:
  PressableScale (same as B1-28) + `accessibilityLabel={\`Edit ${platformLabel} handle\`}`.
  "Edit ›" (L92) is the `›` glyph habit (same as B5-06).
- B5-34 [P3][SLOP] L41 · `rounded-[9px]` is an off-scale radius. It resolves with B5-30's pill tile.

### frontend/src/components/media-kit/storage-image.tsx
- B5-35 [P2][POLISH] L32–43, L46 · A failed or expired signed URL leaves a flat greige block
  forever, with no retry and no image-missing glyph. Hero and editor thumbnails look broken with
  no explanation. Fix: track `error`, render a centred outline image icon in `ink-3` over
  `bg-avatar`, and retry once on `onError` by re-signing.
- B5-36 [P3][POLISH] L48–56 · No `accessibilityLabel`/`alt` prop, so every photo is silent to
  VoiceOver. `transition={150}` ignores reduce-motion. Pass 0 when `useReducedMotion()` is true.
  The placeholder is flat. A soft 1.2s opacity pulse skeleton would signal loading, and
  expo-image's `placeholder` blurhash is an option if hashes are stored at upload. Same as B3-44.

### frontend/src/components/media-kit/editors/edit-profile-sheet.tsx
- B5-37 [P2][POLISH] L55–62, L154–159 · Form state is seeded once, at mount. The sheet stays
  mounted and only toggles `visible`, so cancelled edits persist when it reopens. After a save and
  refetch the fields never re-sync with `data`. Fix: reset state from `data` whenever `visible`
  becomes true. A keyed remount (`key={visible ? 'open' : 'closed'}`) also works. Add a discard
  confirm when the form is dirty and the user swipes the sheet down.
- B5-38 [P2][POLISH] L73, L98 · Save is disabled until at least one niche and one language are
  selected, but nothing says so. The hint only says "pick up to 3". When the cap is hit
  (L69), extra taps silently do nothing. Fix: hint "Pick 1–3" / "Pick at least 1", and on a
  capped tap fire `Haptics.notificationAsync(Warning)` + briefly emphasise the hint (ink colour,
  no motion beyond a 160ms opacity change).
- B5-39 [P2][RULE] L138, L205 · Routine save errors render in `text-status-critical` red.
  Red is reserved for real financial harm. Use ink-2 with a small neutral alert icon. Same as
  B1-42. The error also sits at the bottom of a long scroll, so it can be off-screen when Save is
  tapped. Move it into the footer, above the button.
- B5-40 [P3][SLOP] L100, L190 · Button label "Save". Use "Save changes" (baseline copy rule).
  Save is enabled even when nothing changed. Gate it on a dirty check.
- B5-41 [P3][POLISH] L128–136 · Bio is the most visible field (it is printed on the hero) but it
  sits last, below two chip walls. Move it under Display name. The `n / 160` counter needs tabular
  figures so it doesn't jitter while typing.
- B5-42 [P3][SLOP] L225, L229 · `mb-[7px]` and `gap-[9px]` are off the 4px scale. Use `mb-2`
  and `gap-2`.

### frontend/src/components/media-kit/editors/edit-handle-sheet.tsx
- B5-43 [P2][MOTION] L52 + media-kit-screen L131–136 · On close, the parent sets `visible=false`
  and `activeHandle=null` in the same tick, so this component returns `null` and the sheet
  unmounts instantly. The slide-down dismiss never plays. Fix: keep the last handle in a ref while
  `visible` is false, or clear `activeHandle` in the sheet's `onDismiss`. Symmetric
  enter/exit is a baseline motion rule.
- B5-44 [P2][POLISH] L10–16, L57–62 · Invalid numbers ("48.2K", "4,6") silently become `null`
  and save, wiping the stat with no message. Fix: inline field error ("Numbers only, e.g.
  48200") and block Save while invalid. Show a grouped preview ("48,200 followers") under the
  field.
- B5-45 [P2][SLOP] L73 · Developer copy in the subtitle: "Mock stats for now — no live platform
  pull in this version." Same as B5-04. Suggest "Enter your latest numbers. Brands see these as
  indicative."
- B5-46 [P3][POLISH] L43–50 · Reopening the same handle after a cancel shows the unsaved edits,
  because `seededFor` matches. Same fix as B5-37. The Handle field lacks `autoCorrect={false}`
  and an "@" prefix affordance. "(%)" in the label should be a trailing suffix inside the field.
  Placeholder figures ("48200") read as real data.

### frontend/src/components/media-kit/editors/privacy-sheet.tsx
- B5-47 [P1][SLOP] L40–44, L94–102 · Two switches control the same outcome: "Allow rate card"
  and "Enable rate card", the master switch, which sits below the switch it gates. On the most
  sensitive screen in the kit, users can't tell which one hides their prices. Fix: one "Show rate
  card to verified brands" switch that writes both flags. If both must stay, nest "Allow" under
  "Enable" and disable it when the master is off, with a one-line state summary on top ("Your
  prices are hidden from everyone").
- B5-48 [P2][POLISH] L56–59 · A failed `ensureRateCard` / `setRateCardEnabled` is ignored.
  The sheet closes as if saved while prices are still visible or hidden. Fix: check both
  results and surface the error. Keep the sheet open.
- B5-49 [P2][RULE] L78–81, L94 · Each settings row is its own L1-lifted card. Settings are the
  named L0 case (flat + hairline). Fix: one grouped `rounded-card` list with hairline dividers
  between rows, no shadow. Rule: baseline A Elevation L0.
- B5-50 [P2][POLISH] L70–75 · Toggles behind a Save button is a web pattern. iOS switches apply
  immediately. Fix: write on toggle with an optimistic update, a `Haptics.selectionAsync()`, and a
  revert plus inline message on failure. Drop the footer, or turn it into "Done". State seeding has
  the same stale-on-reopen issue as B5-37. The routine error is red, same as B5-39.
- B5-51 [P3][SLOP] L39 · "Reveal contact details on your profile." doesn't say which details
  (email, phone) or to whom. Say "Let verified brands see your email and phone."

### frontend/src/components/media-kit/editors/affiliations-editor.tsx
- B5-52 [P1][RULE] L113–120, L66–72 · Deleting a credential is one tap on a red `#C0392B`
  trash icon, with no confirm and no undo. Deleting a credential is routine, so it should be
  neutral ghost + confirm, never red. Rule: baseline A "Destructive". The target is also
  18pt + 8 slop, about 34pt, under 44. Fix: neutral ink-3 icon, 44pt box, and an Alert confirm
  or an undo toast.
  ```tsx
  <Pressable onPress={() => confirmRemove(a)} hitSlop={13}
    className="h-11 w-11 items-center justify-center"
    accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`}>
    <TrashIcon width={18} height={18} color="#847F78" />
  </Pressable>
  ```
- B5-53 [P2][RULE] L80–84, L178–181 · Two full-weight primary buttons are visible at once:
  "Add"/"Save" in the body and "Done" in the footer. The rule is one primary action per screen.
  Fix: "Done" becomes a header text button or a secondary glassFlush, and "Add credential" stays
  primary. "Cancel edit" uses `variant="outline"`, which is not the Inflo secondary. Same as
  B1-25.
- B5-54 [P2][POLISH] L95–112 · Tapping a row loads it into the form below, but nothing suggests
  that: no chevron or edit icon, no pressed state, no accessibilityRole or label. The row being
  edited isn't marked, and the form may be below the fold, so nothing visibly happens. Fix: edit
  icon + PressableScale (B1-28), an active-row pillow state (in scope as an active state), and
  scroll the form into view when a row is picked.
- B5-55 [P2][MOTION] L86–123 · Adding or removing a credential snaps the list. The budget
  explicitly covers "list add/remove". Fix: `Animated.View` rows with
  `entering={FadeIn.duration(180)}`, `exiting={FadeOut.duration(140)}`, and
  `layout={LinearTransition.duration(200)}`. Skip under reduce-motion. Add
  `Haptics.notificationAsync(Success)` on add.
- B5-56 [P3][POLISH] L45–47, L150–157 · Year accepts "20266" or "2026.5". Limit it to 4 digits
  (`maxLength={4}`) and a 1950–current range. Row meta is 11pt regular `ink-3`, which is
  tertiary on small text and fails AA. Use ink-2. `mb-[7px]` and `gap-[9px]` repeat B5-42. The
  chip-group markup is duplicated from edit-profile-sheet, so extract a shared ChipGroup.

### frontend/src/components/media-kit/editors/photos-editor.tsx
- B5-57 [P1][POLISH] L151–179, L88–94 · The red trash icon sits 4pt from "Move down". All
  three controls are about 32pt targets (20pt + 6 slop), and one tap permanently deletes the
  storage object with no confirm or undo. A mis-tap while reordering destroys a photo. Same rule
  as B5-52: neutral colour + confirm. Fix: 44pt targets, and move remove into a confirm or a
  separate trailing slot with ≥12pt spacing.
  ```tsx
  <View className="flex-row items-center">
    <IconButton icon={ChevronUpIcon} label="Move up" size={44} ... />
    <IconButton icon={ChevronDownIcon} label="Move down" size={44} ... />
    <View className="ml-3"><IconButton icon={TrashIcon} color="#847F78"
      label="Remove photo" onPress={() => confirmRemove(i)} size={44} /></View>
  </View>
  ```
- B5-58 [P2][MOTION] L96–110, L128–183 · Reordering with up/down chevrons makes rows swap
  instantly. The premium pattern is long-press drag with a handle: gesture-handler + reanimated,
  a lifted row (L2 is allowed here because it is an active state), `Haptics.selectionAsync()` on
  pickup and on each slot change, and `LinearTransition.duration(200)` for the others. Keep the
  chevrons as the accessibility actions (`accessibilityActions` move up/down). At minimum, add
  `layout={LinearTransition}` to the current rows.
- B5-59 [P2][POLISH] L49–59, L88–110 · Move, set-primary and remove have no busy guard.
  Rapid taps fire overlapping `persist` calls, and a failure reverts to the stale prop, which can
  undo the earlier successful moves. Fix: queue writes, or disable row controls while a
  write is in flight.
- B5-60 [P2][RULE] L136–141 · "Primary · avatar" uses a green star and the good-label
  green. Green is rationed for "good" status, and being the primary photo is not a status. Fix: an
  ink star with an ink-2 label, or a small neutral "Primary" pill. The label is 12pt, which is
  off-role.
- B5-61 [P2][POLISH] L143–147, L186–197 · The "Set as primary" text link is about 16pt tall with
  no hitSlop or pressed state. During upload the only feedback is the button text changing
  to "Uploading…". Fix: `hitSlop={12}` + PressableScale, and a placeholder thumbnail row with a
  skeleton pulse appended immediately while the upload runs.
- B5-62 [P2][POLISH] L64–67 · A denied photo permission shows a red dead-end message. Fix:
  neutral copy plus an "Open Settings" action (`Linking.openSettings()`). The error is red, same
  as B5-39.
- B5-63 [P3][SLOP] L125, L131, L195 · The empty state is a single grey line. An "Add your first
  photo" 4:5 dashed tile would be the obvious target. Each row is L1-lifted, same as B5-49.
  "Maximum 5 photos" hardcodes 5 instead of using `MAX_PHOTOS`. The Add button is the outline
  variant, same as B1-25.

### frontend/src/components/media-kit/editors/rate-card-editor.tsx
- B5-64 [P2][POLISH] L70–77, L130–134 · The toggle is bound to the `rateCard` prop and only
  flips after the network write and refetch finish. It lags or snaps back, and `onChanged()`
  runs even after an error. Fix: optimistic local state + `Haptics.selectionAsync()`, and revert
  with the message on failure. The same flag is labelled "Show rate card to brands" here and
  "Enable rate card" in the privacy sheet. Resolve it with B5-47 so there is one switch with one
  label.
- B5-65 [P2][POLISH] L141–175 · The price, the thing creators scan for, is buried in 11pt `ink-3`
  meta text. Fix: mirror the view's RateRow, with the title and meta on the left and the price
  right-aligned in Body semibold with tabular figures. Row edit affordance: same as B5-54. List
  motion: same as B5-55. The red trash with no confirm is the same as B5-52.
- B5-66 [P2][POLISH] L67–68, L203–209 · "35,000" or "35000.50" silently keeps "Add rate"
  disabled with no reason. "₹" is in the label instead of a field prefix. The placeholder
  figure reads as real data. Fix: strip grouping characters on input, add a ₹ prefix inside the
  field, show a live grouped preview, and add an inline hint when invalid. Same family as B5-44.
- B5-67 [P2][RULE] L116–121, L230–239 · Two primary buttons ("Add rate" + "Done"), same as
  B5-53. The price and description fields sit at the bottom of a long chip-wall form, so they
  depend on EditSheet keyboard avoidance, which is missing. Same as B1-45.
- B5-68 [P3][SLOP] L183–201 · Title is free text ("e.g. Instagram Reel") that duplicates the
  Platform + Format chips right below it. Fix: auto-fill the title from platform + format and
  let the user override it. The full platform and format chip walls make this the longest sheet.
  Use a compact picker row, or show only the formats valid for the chosen platform. The chip
  markup is duplicated a third time, same as B5-56.

### frontend/src/components/maker-checker-config.tsx
- B5-69 [P2][SLOP] L97, L123, L24 · "Maker-checker" is internal banking jargon shown as a
  heading, which breaks the plain-language rule. The inert "Payment release" row has developer copy
  ("Inert for now — payments are tracking-only in this version.") next to a dead switch.
  Fix: heading "Approval rules" with the subline "Require a second teammate to approve…".
  Hide the inert row, or show it as a "Coming later" line without a toggle.
- B5-70 [P2][POLISH] L45–92 · The section renders `null` until two network round-trips finish,
  then pops in and shifts the settings screen. Load errors are swallowed, so an admin silently
  sees nothing. Fix: a three-row skeleton, or `entering={FadeIn.duration(200)}` on the
  section, plus an error line with Retry.
- B5-71 [P2][POLISH] L128–134, L150 · A solo brand gets three disabled switches and an
  explanation with no way forward. Fix: add an "Invite a teammate" secondary (glassFlush)
  button in the recess note. The recess note relies on `shadow-recessInset`, same as B4-22.
- B5-72 [P2][RULE] L137–140 · Settings toggles sit in separate L1-lifted cards. Use a grouped L0
  hairline list, same as B5-49. Toggle writes have no haptic, same as B1-35. The save error is
  red, same as B5-39.
- B5-73 [P3][POLISH] L94–103 · Non-admins see only "Only brand admins can configure approval
  rules." Show the current rules as read-only rows so members know what applies to them.
