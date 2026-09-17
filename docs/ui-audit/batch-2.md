# UI Audit — Batch 2: Deal room

IDs: B2-NN. Rule refs = docs/design-direction.md §, tokens = docs/design-tokens.md Part 2.
Assumptions: `expo-glass-effect` still treated as NOT installed (option only). "Same as B1-NN"
means the foundation finding covers it; fix the primitive, not the screen.

### frontend/src/app/deal/[id].tsx
- B2-01 [P1][RULE] L443 · "Mine" chat bubble is a flat off-palette fill `bg-[#F3EFE7]` with a
  hairline; tokens define the chat bubble as `glassFlush` (165° #FFFFFF→#EAE7DF, 1px
  rgba(28,27,24,.07), inset top highlight). Also `rounded-2xl rounded-br-md` = 16/6 — 6 is not
  in the radius set. This is the most-seen surface on the hero screen. Rule: §3, tokens
  "Material signatures / glassFlush". Fix: share one `GlassFlush` view (expo-linear-gradient +
  inner 1px white top line) between bubble, secondary button and chart bars:
  ```tsx
  <LinearGradient colors={['#FFFFFF','#EAE7DF']} start={{x:0,y:0}} end={{x:0.3,y:1}}
    style={{borderRadius:14, borderWidth:1, borderColor:'rgba(28,27,24,.07)'}}>
    <View style={{height:1, backgroundColor:'rgba(255,255,255,.9)'}} />
    {children}
  </LinearGradient>
  ```
- B2-02 [P1][POLISH] L283, 358 · `SafeAreaView edges={['top']}` and composer `pb-6` (24pt):
  on home-indicator iPhones the input row sits under the 34pt indicator zone; the sticky action
  bar above it inherits the same gap. Fix: `paddingBottom: Math.max(insets.bottom, 12)` from
  `useSafeAreaInsets` on the composer (and on the action bar when the composer is hidden at
  terminal stages).
- B2-03 [P2][GLASS] L285–318 · Header is an opaque `bg-app` block with a hard hairline; the
  thread stops dead under it. As nav chrome it is in glass scope (§3). Fix: absolute header on
  `BlurView intensity≈40 tint light` + rgba(251,250,246,.6) overlay + inset 1px white top +
  hairline; give the FlatList `contentInset`/top padding = header height so messages scroll
  under. Web fallback: 92% `bg.app`. Option: `expo-glass-effect` on iOS 26 with this as fallback.
- B2-04 [P2][POLISH] L176–178, 341–342 · `scrollToEnd({animated:false})` fires on every
  `onContentSizeChange`, so an incoming message (or a keyboard open, or an attachment thumbnail
  loading) yanks a user who is reading history back to the bottom. Fix: track
  `isNearBottom` from `onScroll`; only auto-scroll when true or when the message is mine;
  otherwise show a "↓ New messages" pill (glassFlush).
- B2-05 [P2][RULE] L369–402 · Attach and Send are `h-10 w-10` (40pt) with no `hitSlop` — below
  the 44pt floor (§11). Back button is 36pt + hitSlop 8 (OK). Fix: `h-11 w-11` or `hitSlop={4}`.
- B2-06 [P2][SLOP] L298, 309, 386, 445, 458, 464 · Off-role type: header title `text-[16px]`
  (Subtitle is 17/600), participant line `12px`, sender name `12px/700`, body 15 with
  `leading-[21px]` (Body lh is 22). Fix: use the 6 roles (`text-subtitle`, `text-secondary`,
  `text-micro`) with their line-heights; timestamps and "N in this deal" get `tnum`.
- B2-07 [P2][SLOP] L322–324 · Full-screen `ActivityIndicator` while the thread loads. Fix: a
  skeleton (header title bar + 3 bubble blocks, `bg.recess`, 1 opacity pulse 200ms→ static
  under reduce-motion) so the room's shape appears immediately.
- B2-08 [P2][POLISH] L325–330 · Load-failure state has copy but no action; user is stuck.
  Fix: add a neutral secondary "Try again" (`loadThread`) and keep Back reachable.
- B2-09 [P2][MOTION] L287–311, 369–402 · No press feedback on Back / Edit / participants /
  Attach / Send — same as B1-28. Send should also fire `Haptics.impactAsync(Light)` on success.
- B2-10 [P3][SLOP] L303, 311 · `#5D5953` is not a palette value (ink-2 is #5E574E); the `›`
  text glyph stands in for `chevron-right.svg` and won't align to the icon set's 1.6 stroke.
- B2-11 [P3][MOTION] L336–348 · New incoming bubble appears with a hard cut. §8 lists list
  add/remove as build-now; chat is dense so keep it minimal: `entering={FadeIn.duration(160)}`
  on the last item only, none under reduce-motion.
- B2-12 [P3][POLISH] L353–355 · `sendError` renders as a bare red 12px line with no dismiss
  and no icon; it also pushes the composer up. Fix: inline row with `alert-circle` icon +
  Secondary role text, auto-clears on next keystroke (already does on send).

### frontend/src/components/deal/sticky-action-bar.tsx
- B2-13 [P1][POLISH] L1330, 1300–1316 · The "sticky bar" is a plain `View` in the screen's
  flex column with no max height and no scroll. At Posted/Payment/Closed it stacks 4–6 full
  cards (deliverables, payment details, tracking, dispute, close, post-close) inside the bar,
  crushing the chat list to zero and pushing the composer off-screen on a 6.1" phone. The
  §8 budget names "card peek/expand" for exactly this. Fix: bar = one collapsed peek row
  (stage label + single primary CTA, ≤72pt) that expands to a scrollable sheet-like panel
  (`maxHeight: 60%` + `ScrollView`) with `LinearTransition.duration(240)`; chat keeps
  ≥40% of the viewport.
  ```tsx
  <Animated.View layout={LinearTransition.duration(240).easing(Easing.out(Easing.quad))}
    style={{ maxHeight: expanded ? '60%' : 72 }}>
    <PeekRow onPress={() => setExpanded(v => !v)} />
    {expanded && <ScrollView bounces={false}>{body()}</ScrollView>}
  </Animated.View>
  ```
- B2-14 [P1][RULE] L1627–1665 · Three hand-rolled button tiers (`PrimaryButton`/`GhostButton`/
  `InlineButton`) instead of `ui/button`: `rounded-full` (buttons are radius 16, not pill —
  tokens "Radii"), `py-2.5` + 14px text ≈ 38pt height (<44, §11), Ghost is a flat white card
  instead of `glassFlush` (§3 secondary spec), Inline is `cane-2` pill with 11px text and a
  ~24pt target. Same root cause as B1-25/26. Fix: delete the three; use `Button` once it has
  the secondary tier, `size="lg"` (44–48).
- B2-15 [P1][MOTION] whole file · Zero motion: no `Animated`, `withTiming`, `Haptics` or
  layout animation anywhere. Stage transitions (Accept, Generate contract, Sign, Confirm posts,
  Confirm close) are the wins §8 reserves the budget for. Fix: on a successful transition fire
  `Haptics.notificationAsync(Success)` + let `StageProgressBar` animate the segment
  (`withTiming` 280ms ease-out); on Deal closed / payment received allow the one tiny
  `withSpring({damping:18, stiffness:220})` scale 1→1.04→1 on the status card (win moment).
  Press feedback on all buttons: same as B1-28.
- B2-16 [P1][SLOP] L1606–1608 (`Actions`) · Every section is topped by a 10.5px UPPERCASE
  tracked eyebrow ("CHATTING — TERMS CHECKLIST", "APPROVAL — CONTRACT"). Kicker labels above
  headings are a banned craft-floor tell; 10.5px is below the Micro role and fails AA at
  `ink-3`. Fix: Subtitle-role (17/600) section title or none — the stage bar already names
  the stage; keep the qualifier as Secondary text under the CTA if needed.
- B2-17 [P2][RULE] L1206–1211, 1466 · `bg-status-critical-tint` is used as a fill for the
  exclusivity warning box and the rejected maker-checker panel. §4/§10: critical red is a
  dot/icon/label only, never a washed card. Fix: `bg-surface-recess` box + `alert-circle`
  icon in `#C0392B` + critical label text only.
- B2-18 [P2][RULE] L892–899 · `Alert.alert` (system dialog) for "Confirm close?" on the deal's
  biggest moment; system alerts fall outside the design system and cannot carry the win
  moment. Fix: reuse the sheet pattern (see EditSheet B1-45 once fixed) with a neutral
  ghost "Not now" + one primary "Confirm close", then the success haptic/spring (B2-15).
- B2-19 [P2][SLOP] L1439–1493, 1620–1624 · Sibling containers drift: ContractCard is
  `rounded-2xl p-3` (16/12), inner boxes `rounded-xl` (12), `Waiting`/`SummaryGate` recess
  boxes are `rounded-2xl px-3.5 py-3` (16/14/12), status panels `px-3 py-2`. Cards are radius
  14 with 16 padding, panels 12. Fix: one `Card` (14/16) and one `Panel` (12/12) wrapper.
- B2-20 [P2][SLOP] L1441–1444, 1508–1520, 1569, 1606 · Off-role type everywhere: 14px
  semibold titles, 12px/11px/10.5px body copy in `ink-2`/`ink-3`. 11px `ink-3` on white is
  ~3.3:1 — fails AA for body. Fix: Body 15 / Secondary 13 / Micro 11 (500, +0.22 tracking)
  only; `ink-3` never below 17px.
- B2-21 [P2][POLISH] L1569 · Missing checklist fields are rendered as text bullets
  (`• {label}`) in a recess box. Fix: rows with the `circle`/`check-circle` icon from the set,
  `Secondary` text, 44pt "Mark as discussed" row action.
- B2-22 [P2][SLOP] L1215, 1229, 1244, 1256 · Loading/acting is signalled by label swaps
  ("Generating…", "Confirming…") and `opacity-50`; `Waiting` boxes are static grey text. Fix:
  keep label, add a 16pt inline spinner-in-button (opacity crossfade 150ms) and a skeleton
  row for "Loading the contract…".
- B2-23 [P3][POLISH] L1222 · `expires in ${hoursUntil}h` is a bare hour count with no
  urgency treatment and non-tabular digits. Fix: `tnum` + `clock` icon; sub-24h in
  `status.critical` label only.
- B2-24 [P3][POLISH] L1597 · "the parser arrives in Phase 10" is build-phase copy visible to
  users. Fix: "Summary is being prepared." or hide the state.

### frontend/src/components/deal/payment-tracking-card.tsx
- B2-25 [P1][SLOP] L302–316, 371–376, 423–439, 453 · The money ledger is set almost entirely
  in 10–11.5px (`text-[10px]`, `[10.5px]`, `[11.5px]`) in `ink-3`/`ink-2` — labels, dates,
  versions, status chips, even the 44pt action buttons' labels. That is below the Micro role
  and fails AA on the recess (`#EFEAE2`) background. This is the screen where trust is won.
  Fix: amount = Title 20/600 `tnum`; facts = Secondary 13 `tnum`; labels = Micro 11/500;
  button labels 15/600. Drop every `text-[10*]`.
- B2-26 [P2][RULE] L217–220, 273–276, 419 · `bg-status-critical-tint` fills (dispute banner,
  error box, `bad_debt`/`disputed` status chip). Same as B2-17 — red is dot/icon/label only.
  `StatusLine` already carries a dot + label; drop the tinted fill and keep the dot.
- B2-27 [P2][MOTION] L227, 372 · "Payment received / receipt confirmed" (`paid_full`,
  `receipt_confirmed`) is the parked win moment (§8) — today it is a static green label. Fix:
  on transition to `paid_full` run the tiny win spring on the `StatusLine` chip + success
  haptic (once, not on re-render). Also: no list animation when a milestone's state changes;
  `LinearTransition.duration(200)` on `MilestoneRow` is within budget.
- B2-28 [P2][SLOP] L205, 298, 367, 419, 453, 468 · Sibling radius drift: card `rounded-2xl`
  (16), summary/milestone `rounded-xl` (12), status chip `rounded-lg` (8, not in the set),
  buttons `rounded-2xl` (16 ✓). Fix: card 14, panel 12, chip pill, per tokens.
- B2-29 [P2][POLISH] L316, 385, 426 · Version numbers and "Server order · N items" are
  audit-log internals shown to end users. Fix: hide version; say "Updated {date}"; drop
  "Server order".
- B2-30 [P2][POLISH] L206–215 · `Refreshing…` text swap (10.5px) as the loading state; no
  skeleton for the initial "Loading the current…" `TrackerNotice`. Fix: initial load =
  skeleton of the summary block (amount bar + 3 fact rows); refresh = 150ms opacity dip to
  0.6 on the card, no text.
- B2-31 [P3][POLISH] L367–372 · Milestone sequence badge is 28pt `bg-ink` filled circle with
  10.5px white digit; reads heavy against the outline icon system. Fix: 24pt, `bg.recess`
  ring 1px `avatar.ring`, Micro 11/500 ink digit.
- B2-32 [P3][MOTION] L449–458 · `ActionButton`/`RetryButton` press feedback: same as B1-28;
  they also duplicate B2-14's tiers (`secondary` = flat white, should be glassFlush).

### frontend/src/components/deal/deliverables-card.tsx
- B2-33 [P1][POLISH] L299–352 · Up to five full-width stacked pill buttons per deliverable
  ("Submit content", "Request revision", "Approve content", "Submit live URL", "Flag issue"),
  each `py-2.5` + 12px text (≈36pt), multiplied by N deliverables inside the action bar
  (B2-13). Breaks "one primary action per screen" (§10). Fix: one primary per deliverable
  row (the next required step), secondary actions in an overflow (`more-horizontal` icon →
  action sheet); 44pt, radius 16, via `ui/button` (B2-14).
- B2-34 [P2][RULE] L91, 183, 213, 255–257 · Four `bg-status-critical-tint` fills (empty plan,
  "Flagged for correction", "Revision rounds exhausted", rejected approval). Same as B2-17.
- B2-35 [P2][SLOP] L86, 159–163, 180–204, 222–240, 354, 371–389, 426 · The whole row body is
  10–11.5px `ink-3` copy plus two uppercase tracked kickers ("CURRENT LIVE PROOF",
  "SUBMISSION HISTORY") — same as B2-16/B2-25. Fix: Secondary 13 for facts, Micro 11/500
  sentence-case labels, no uppercase.
- B2-36 [P2][SLOP] L155, 183, 224, 371 · Nested containers three deep with drifting radii:
  card 16 → row `rounded-xl` 12 → history/evidence `rounded-lg` 8 → pill buttons. Cards
  inside cards inside cards is the "lazy container" tell. Fix: row = L0 flat with hairline
  separators inside the card; evidence/history = plain rows with a leading icon, no boxes.
- B2-37 [P2][POLISH] L224–244, 371–384 · File name, URL and description are `selectable`
  but not truncated (no `numberOfLines` except one) — a long Drive URL wraps 4–5 lines.
  Fix: `numberOfLines={1}` + middle ellipsis for URLs/file names, `Open` as a trailing icon
  button (44pt).
- B2-38 [P3][MOTION] L96–113, 224 · Submission history and new-round rows insert with a hard
  cut; `entering={FadeIn.duration(180)}` on a newly added row only (not the initial render),
  none under reduce-motion. Press feedback: same as B1-28.
- B2-39 [P3][POLISH] L204 · "Earlier proof history is truncated." reads like a log line.
  Fix: "Showing the latest proof." or a "Show earlier" secondary.

### frontend/src/components/deal/creative-brief-card.tsx
- B2-40 [P2][RULE] L232–257 · Two more hand-rolled pill buttons (`ActionButton` `bg-ink`,
  `SecondaryButton` flat `bg-app`), 12px labels, ≈36pt. Same as B2-14.
- B2-41 [P2][SLOP] L57–68 · Version chips are `bg-ink` filled when selected — a colour-change
  active state; §3 says active = pillow-glass elevation, not colour. Also 11px text, 30pt tall.
  Fix: reuse `ui/chip` (B1-33) with the glass active recipe, 44pt hit area.
- B2-42 [P2][SLOP] L139, 219, 226 · Kicker labels (`uppercase tracking-wide` 10.5px) on every
  brief field; editor inputs are 12px text in `rounded-xl` boxes with 10.5px labels instead
  of `ui/text-field` (radius 16, Body 15). Same as B2-16 / B1-42.
- B2-43 [P2][POLISH] L181–200 · Six-field editor renders inline inside the card inside the
  sticky bar (B2-13) with no keyboard avoidance and no scroll — on a phone the lower fields
  are hidden behind the keyboard. Fix: open the editor in a sheet (EditSheet once B1-45/46
  land) with `KeyboardAvoidingView`.
- B2-44 [P3][POLISH] L45, 50, 118, 184, 195 · Version numbers ("v3", "Create v4 from v3",
  "Save v4") dominate the copy; users think in "latest"/"updated". Fix: "Updated 12 Sep by
  Priya" + a single "Latest" pill; keep `vN` only in the history switcher.
- B2-45 [P3][POLISH] L262 · `toLocaleDateString()` yields "9/12/2026"-style output; format
  through `@/lib/format` (used elsewhere) for "12 Sep 2026".

### frontend/src/components/deal/payment-details-card.tsx
- B2-46 [P2][SLOP] L27–30, 152–160, 169–182, 198–200 · Same type/kicker/pill-button pattern:
  10–11.5px labels, uppercase tracked `Detail` labels, 12px inputs in `rounded-xl` boxes,
  `SmallButton` pills at ≈36pt. Same as B2-14 / B2-25 / B2-42.
- B2-47 [P2][POLISH] L89–145 · Bank/UPI and billing editors render inline in the card inside
  the sticky bar; no keyboard avoidance — same as B2-43. These are the fields users most
  need to get right; move to a sheet with `ui/text-field`.
- B2-48 [P2][RULE] L172 · Incomplete side is a `text-status-critical` label ("Missing") — red
  is for real financial harm (§4); "not yet added" is neutral. Fix: `ink-3` "Not added" +
  `circle` icon; reserve red for a failed/blocked state.
- B2-49 [P3][POLISH] L27 · Title "Off-platform payment information" (33 chars, 14px) wraps at
  narrow widths; Fix: "Payment details" as Subtitle, disclaimer as Secondary under it.

### frontend/src/components/deal/terms-review-card.tsx
- B2-50 [P1][POLISH] L45–68 · The 22-field review is a `ScrollView max-h-[320px]` nested
  inside the sticky bar's column (B2-13) with no scroll-edge affordance; the user cannot
  tell 20 more fields exist below the fold, on the screen where terms bind. Fix: give the
  panel its own sheet/route ("Review 22 terms") with a sticky approve bar; until then add a
  bottom gradient fade (`LinearGradient` `#EFEAE2` 0→1, 24pt) + "N more" hint.
- B2-51 [P2][SLOP] L33–34, 50–63, 122–128 · 10–12px copy throughout; evidence quotes are
  10.5px italic `ink-3` (≈3:1, fails AA). Same as B2-25. Field status words ("Found",
  "Ambiguous", "Not discussed") are colour+text only, no icon — add `check-circle` /
  `help-circle` / `circle` from the set for the "never colour alone" rule (§11).
- B2-52 [P2][RULE] L72–76 · `bg-status-critical-tint` fill for "N fields must be clarified".
  Same as B2-17.
- B2-53 [P2][RULE] L147–156 · Another pill `ActionButton` pair (primary/ghost). Same as B2-14.
- B2-54 [P3][POLISH] L162 · `JSON.stringify(value)` shown raw for object-valued fields
  (e.g. deliverables list) — braces and quotes reach the user. Fix: per-type formatter
  (list → bulleted lines, money → `formatExactMoney`).
- B2-55 [P3][POLISH] L104 · Approve button label mutates to "Approved" while disabled — a
  disabled primary reads as broken. Fix: replace with a `check` icon + "You approved" Secondary
  text row; drop the button.

### frontend/src/components/deal/close-status-card.tsx
- B2-56 [P1][MOTION] L26–34 · "Deal closed" is THE win moment (§8 explicitly budgets it) and
  it renders as a static 14px title in a plain card. Fix (parked tier, but cheap): on first
  render with `complete === true` after a transition, `Haptics.notificationAsync(Success)` +
  `withSpring` scale 1→1.03→1 (`damping 18, stiffness 220`, ~350ms) on the card, `FadeIn`
  on the "Confirmed" labels; `check-circle` icon in `status.good`; instant under reduce-motion.
  ```tsx
  const scale = useSharedValue(1);
  useEffect(() => { if (complete && !reduceMotion) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scale.value = withSequence(withTiming(1.03,{duration:140}), withSpring(1,{damping:18,stiffness:220}));
  }}, [complete]);
  ```
- B2-57 [P2][SLOP] L32–45, 61, 96–103 · 10–12px type incl. the primary CTA label at 12px;
  `Refreshing…` 10px text; same as B2-25 / B2-30.
- B2-58 [P2][RULE] L72–78 · Error box `bg-status-critical-tint` fill. Same as B2-17.
- B2-59 [P3][POLISH] L59 · `acting` swaps the primary fill to `bg-avatar` (#E8E5DF) with
  white text — ~1.3:1 contrast, illegible. Fix: keep `bg-ink`, add inline spinner, 0.6
  opacity (see B2-22). Radius `rounded-2xl` (16 ✓) here vs `rounded-full` on every sibling
  card — pick 16 everywhere (B2-14).

### frontend/src/components/deal/stage-progress-bar.tsx (skim — header chrome)
- B2-60 [P1][MOTION] L51–64, 74–84 · Stage-bar advance is the #1 named §8 budget item and the
  bar is fully static: the current-node ring and the segment fill snap on re-render. Fix:
  segment = `Animated.View` width `withTiming(1, {duration:280, easing: Easing.out(Easing.cubic)})`
  from the previous index; ring = scale 0.8→1 + opacity 160ms; `Haptics.impactAsync(Light)`
  on advance; instant under `useReducedMotion()`. This pairs with B2-15/B2-56.
- B2-61 [P2][RULE] L76, 42, 79 · Disputed overlay paints a `rgba(192,57,43,.15)` red RING
  around the node and turns the 13px header red — red should be a dot/icon/label only (§4).
  Ring = a small fill. Fix: keep the node dot red + an `alert-circle` 14px icon before the
  label; ring stays ink/12.
- B2-62 [P3][POLISH] L47 · `n / 7 ›` uses the text glyph chevron and non-tabular digits (same
  as B2-10); nothing happens on press — either make the whole header a 44pt Pressable that
  opens a stage explainer, or drop the `›`.

### Remaining deal/ sheets and cards (skim for repeats)
All 10 sheets (`content-submission`, `contract-sign`, `deal-name`, `dispute`, `live-post`,
`participant`, `payment-state`, `post-close-entry`, `rating`, `private-deliverable-label-picker`,
plus `DisputeDetailSheet` in `dispute-card`) reuse `ui/edit-sheet` — so B1-45 (slide of the
whole tree), B1-46 (no keyboard avoidance), B1-47 (fixed `pb-8`, no safe-area bottom) and
B1-48 (24 top radius) apply to every sheet in the deal room; fixing EditSheet fixes all 11.
No deal/ file imports `ui/button`, `ui/chip`, `ui/toggle` or `ui/text-field` — every one
hand-rolls its own (B2-14 root cause).
- B2-63 [P2][RULE] `dispute-sheet` L?, `payment-state-sheet` ×2, `dispute-card` ×2,
  `post-close-card` ×1, `contract-alignment-card` ×2 · `bg-status-critical-tint` fills — same
  as B2-17. `contract-alignment-card` also uses `bg-status-good-tint` as a full card wash for
  "matches" — green is rationed to dot/label (§4); same treatment: recess box + green dot.
- B2-64 [P2][SLOP] every sheet/card · 10–12px copy density (`tiny` counts 3–18 per file;
  `dispute-card` 18, `participant-sheet` 16). Same as B2-25.
- B2-65 [P2][SLOP] `content-submission-sheet` L168, 239 · `placeholderTextColor="#7A7A7A"` —
  a cold grey not in the palette (should be `#847F78`). `chat-attachment` L24/38/150 uses
  `#5D5953` (same as B2-10). `participant-sheet` L192 selected row `bg-[#F3EFE7]` (same as
  B2-01) and a `border-ink` colour-change active state (same as B2-41).
- B2-66 [P2][SLOP] `rating-sheet` L83–84 · Star rating is the `★` text glyph in 44pt
  `bg-ink` filled circles — a Unicode glyph, not the icon set, and fill-on-select. Fix:
  `star.svg` outline from `assets/icons`, selected = filled ink star at 1.6 stroke, light
  haptic per star, tiny win spring only on final submit (rating is a close-out moment).
- B2-67 [P2][POLISH] `rating-sheet` L56, `contract-sign-sheet` · `Alert.alert` for the
  rating confirm (same as B2-18). Contract signing — the deal's legal win — has no haptic or
  motion on success (`contract-sign-sheet` L128–136: `rounded-full py-3` pill, same as
  B2-14). Add `Haptics.notificationAsync(Success)` + sheet dismiss on sign (B2-15).
- B2-68 [P3][SLOP] all sheets · `ActivityIndicator` inside buttons/rows (2–4 per file) —
  acceptable in-button, but `participant-sheet`/`post-close-card` use it as the whole-list
  loading state: skeleton rows instead (same as B2-07).
- B2-69 [P3][SLOP] `private-deliverable-label-picker` · one `uppercase` kicker (same as B2-16).
