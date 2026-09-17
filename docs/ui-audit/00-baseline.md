# UI Audit — Baseline (Batch 0)

## A. Inflo tokens (exact values) + tailwind.config.js reconciliation

**Reconciliation result: tailwind.config.js matches docs/design-tokens.md exactly.** No
disagreements found across colors, radii, spacing, shadows, or type sizes. `global.css` is
plain Tailwind boilerplate (3 `@tailwind` directives, nothing else) — no custom CSS to check.

### Colour
- Surfaces: `bg.app #FBFAF6` · `bg.dashboard #FAFAF8` · `bg.chatCanvas #EBE7E0` ·
  `surface.card #FFFFFF` · `surface.recess #EFEAE2` · `border.hairline #EAE8E2` ·
  `border.cardHairline #EFEDE8` · `avatar.bg #E8E5DF` · `avatar.ring rgba(28,27,24,.09)`
- Text: primary/ink `#1C1B18` · secondary `#5E574E` (AA-passing) · tertiary `#847F78`
  (large text + icons ONLY — fails AA for small body)
- Status: good dot `#7DB02E` / label `#4F7A1E` / tint `#ECF2D6` · neutral `#847F78` ·
  critical `#C0392B` / tint `#FBF3F1` (rationed — dot/icon/label only, never a fill)
- Cane/beige: `#EFEBE3 #DFDACF #D2CFC6 #B3AC9D #8E8676`
- Green (rationed, good/meaning only): `#ECF2D6 #C6DC52 #A6C93A #7DB02E #4F7A1E`
- Aqua (hero/media only): `#D6F3EF #7FDDD0 #25B7AE #0E8C86 #0A5F5C`; signature gradient
  `#119B91→#48D6C6` (hero only, no synthetic gradient hero otherwise)
- Blue/bridge accent `#1F8FAE` — data only, never chrome/icon accent. Banked blue ramp not
  in active use.
- Critical red `#C0392B` — NEVER a button fill or red-washed card. Small dot/icon/label only.
- Chart teal emphasis: `e1 #0095A8/#1CACBE` · `e2 #63B0BE/#7DC1CC` · `e3 #A9CEDB/#BFDBE5`;
  glass bar `linear-gradient(180deg,#FCFAF6,#E9E4DB)` + hairline; max 3 emphasised bars,
  rest fade to glass; never all-blue.

### Radii
`card 14 · panel 12 · button 16 · input 16 · pill 9999`. Circular corners — NO
corner-smoothing/squircle (explicitly rejected in design-direction).

### Spacing (4px scale)
`0,4,8,12,16,20,24,32,40,48`. Screen/card padding `16`, stack gap `12`, section gap `20/24`
(design-tokens says 20, tailwind comment says 20 too — consistent), text-line gap `4`.

### Elevation (3-level, warm-tinted from ink — never cold grey)
- L0: flat + `1px solid #EAE8E2` hairline (dense lists, settings)
- L1 (`elev.l1`): `0 1px 2px rgba(28,27,24,.05), 0 5px 14px rgba(28,27,24,.07)` — primary cards
- L2 (`elev.l2`): `0 2px 6px rgba(28,27,24,.06), 0 14px 34px rgba(28,27,24,.11)` — modals,
  floating chat, approval nudge, ACTIVE STATES
- `liftIn` (subsection): `0 1px 2px rgba(28,27,24,.05), 0 8px 18px rgba(28,27,24,.09)`
- `recessInset` (track): `inset 0 1px 2px rgba(28,27,24,.05)`
- Rule: ONE lifted element per card. Elevation costs density — trade-off is deliberate.

### Glass ("pillow glass") — scoped to NAV + ACTIVE STATES ONLY
```
pillowGlass (nav-active, has outer lift — the ONE reserved lift signature):
  background: linear-gradient(165deg,#FFFFFF,#EAE7DF)
  border: 1px solid rgba(28,27,24,.05)
  boxShadow: inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(28,27,24,.05),
             0 5px 12px rgba(28,27,24,.09)

glassFlush (shared: secondary button, chat bubble, chart bars — NO outer lift):
  background: linear-gradient(165deg,#FFFFFF,#EAE7DF)  [180deg for bars]
  border: 1px solid rgba(28,27,24,.07)
  boxShadow: inset 0 1px 0 rgba(255,255,255,.9)
```
Inset top-highlight is mandatory (makes glass read convex). Secondary button = flush, no
outer shadow (lift reserved for nav-active only — this was a deliberate 6.7 revision).

### Buttons
| Tier | Spec |
|---|---|
| Primary | bg `#1C1B18`, white text, radius 16, NO shadow |
| Secondary | `glassFlush`, ink text, radius 16, flush (no outer shadow) |
| Tertiary | soft neutral `#EDEAE3` or ghost — rarely needed |
| Disabled | bg `#ECEAE3`, text `#B6B0A6` (same both modes) |
| Height/target | 44–48pt, min 44 |

Destructive: routine (delete draft/cancel) = fully neutral ghost + confirm step, no colour.
Critical (real harm) = rationed red accent only (dot/icon/label + confirm), never a red fill.

### Typography — Geist only, 6 roles (size/weight/scaling-cap/lh/tracking)
| Role | Size/Weight | Cap | LH | Tracking |
|---|---|---|---|---|
| Display | 26/700 | 115% | 29px | -0.26px |
| Title | 20/600 | 120% | 26px | -0.2px |
| Subtitle | 17/600 | 125% | 23px | -0.17px |
| Body | 15/400 | 200% | 22px | 0 |
| Secondary | 13/400 | 200% | 18px | 0 |
| Micro | 11/500 | 200% | 15px | +0.22px, sentence case |

Tabular figures (`tnum`) for lists/tables/ledgers/live values; proportional for inline prose
numbers; lining figures default. "Fixed" (no scaling) is a rare component-level override
(e.g. tab bar micro label) — never chosen per text element; RN maps caps to
`maxFontSizeMultiplier`, fixed uses `allowFontScaling={false}`.

### Icons
Custom 119-icon library at `frontend/assets/icons/`. Outline, rounded caps/joins, ~2px
corner radius, stroke **1.6** default (overridable via `stroke-width`), 24×24 grid, equal
optical height, `currentColor`. Inactive/wayfinding `#847F78`; content/ink `#1C1B18`; status
green `#7DB02E` rationed; NO blue chrome ever. Active state = pillow-glass elevation, NOT a
colour change — reserved for nav + active states.

### Motion (§8, exact budget)
- Micro-interactions: 120–200ms · Transitions: 200–300ms · Nothing over ~400ms
- Ease-out for entrances; gentle ease-in-out for state changes
- Avoid bounce/spring EXCEPT a tiny spring on genuine wins (deal closed, payment received)
- transform/opacity ONLY (GPU-friendly)
- Budget is spent on: stage-bar advance, pillow-glass nav/active, approval-nudge + deal-closed/
  payment confirmations, card peek/expand. Everywhere else stays still.
- Dense lists don't animate; no parallax/decorative motion
- Charts: animate once on load (~300–400ms ease-out, gentle stagger), never loop; instant
  final state under reduced motion
- Honour OS reduce-motion (swap to instant/none); never signal state by motion alone; no
  flashing faster than ~3/sec
- Build-now tier: screen transitions, button/card press feedback, tab crossfade, list
  add/remove, reduce-motion handling, stage-bar advance, toast/nudge entrances
- Parked (phase-2): deal-closed/payment celebration, chart load choreography, glass shimmer

### Accessibility
AA: body ≥4.5:1, large text/icons ≥3:1. Never colour alone — colour+label+shape always.
Touch targets ≥44pt/48dp with padding beyond the 24px icon. Density = compact (body 15,
target 44). Screen-reader labels on every icon-only control. Visible focus states.

### Do's/Don'ts callouts most relevant to audit
- Don't spread the premium gradient everywhere — signature, not wallpaper (glass = nav +
  active only).
- Don't fill icons by default (outline only).
- Don't mix icon weights/heights on one screen.
- One primary action per screen.
- Plain, active, end-user language ("Save changes" not "Submit").

---

## B. Merged review checklist (RN-translated, Inflo-rule-filtered)

### SLOP tells (AI-generic-build)
- Expo template leftovers still present: `hello-wave`, `parallax-scroll-view`, `themed-text`,
  `themed-view`, `external-link`, `icon-symbol*`, default `modal.tsx`, `tab-placeholder` —
  flag for delete/replace.
- Magic hex/numbers not in the token set (any hex outside the palette above, any radius not
  in `{14,12,16,9999}`, any spacing not on the 4px scale).
- Random greys (e.g. `#999`, `#CCC`, Tailwind default gray-*) instead of `ink-2`/`ink-3`/
  `hairline`.
- Inconsistent padding/radius between sibling cards/rows.
- Emoji or stock icon glyphs instead of the custom 119-icon set.
- Centred-everything layouts, generic hero-metric card template, same-size icon+heading+text
  cards (impeccable craft-floor: "cards are the lazy container").
- Generic copy: "Submit", "Something went wrong", "Error", lorem/placeholder text.
- Missing empty/loading/error states; spinners where a skeleton fits better.
- Cramped or uneven vertical rhythm (inconsistent gap-3/gap-5 usage).
- Kicker/eyebrow labels above headings (banned outright per craft-floor, no exception).
- Gradient text; hard offset (non-blurred) box-shadows; sparklines/progress-rings standing
  in for real content; monospace used as a "technical" costume.

### iOS/native craft checks (from ios.md + audit.native.md, RN-translated)
- Safe area: no content under notch/Dynamic Island/home indicator; respect `useSafeAreaInsets`.
- Edge-swipe back must stay alive — don't disable/override the native back gesture.
- Tab bar = 2–5 top-level sections only, never actions.
- Touch targets ≥44×44pt with spacing so thumbs don't mis-hit.
- Dynamic Type: text scales via the 6 roles + `maxFontSizeMultiplier`, no hard-coded px
  point sizes defeating scaling (Inflo overrides "system font" with Geist — that's locked,
  not a violation, but scaling caps must still be honored).
- Contrast in both light/dark (dark is fast-follow, but must not visibly break).
- Reduce Motion: crossfade instead of parallax/large slides; verify a code path exists.
- Off-platform controls: custom toggles/switches that don't match `ui/toggle.tsx`'s system,
  web-shaped buttons, hover-only affordances with no touch equivalent.
- Icon drift: any icon not from `frontend/assets/icons/` (mixed sets = P1).
- List virtualization: FlatList/FlashList for long lists, not raw `.map` in ScrollView.
- Unvirtualized long lists, sync work in scroll/gesture paths, unmemoized re-renders.

### Polish checks (from impeccable/polish.md)
- States completeness per interactive control: default/hover/focus/active/disabled/loading/
  error/success — RN equivalent: pressed, disabled, loading spinner→skeleton, error inline.
- Optical alignment (not just mathematical) of icon+text baselines, numeric columns.
- Text truncation handled (no overflow/clip on long creator names, deal titles).
- Keyboard avoidance on forms/chat input (KeyboardAvoidingView / equivalent).
- Scroll-edge fades where floating chrome overlaps content (nav bar, sticky action bar) —
  per Apple materials guidance, prefer a soft fade/mask over a hard 1px divider where content
  scrolls under floating UI.
- Consistent terminology/capitalization/copy voice across the app.
- Dead code / commented-out blocks / unused imports left behind.

### Emil/Apple motion rules (RN-translated, Inflo-conflict-filtered)
Inflo's own budget (120–200ms micro / 200–300ms transitions / ~400ms cap, ease-out entrances,
transform+opacity only, bounce reserved for wins) is STRICTER than Emil/Apple's general web
guidance in places — where they conflict, Inflo's budget wins. Useful RN-translated pieces
that don't conflict:
- Press feedback: `withTiming(scale, {duration: 120-160, easing: Easing.out(...)})` to
  `scale(0.97)` + slight opacity — matches Inflo's 120–200ms micro band exactly.
- Never animate from `scale(0)` — start `scale(0.95)` + `opacity:0` (applies to RN
  `FadeIn`/custom entrances too).
- Origin-aware sheets/popovers: anchor `transform-origin`/reanimated layout origin to the
  trigger, not screen center; modals/full sheets stay centered — this is compatible with
  Inflo's "card peek/expand" budget line.
- Interruptibility: prefer `withSpring`/reanimated shared values over one-shot `Animated.timing`
  re-triggers for anything gesture-driven (sticky action bar drag, sheet drag) so it can be
  grabbed and reversed — use `react-native-gesture-handler` + reanimated worklets.
- Rubber-banding at drag boundaries (sheets, swipe actions) instead of hard stops.
- Spatial consistency: symmetric enter/exit paths (sheet in from bottom → out to bottom).
- Reduced motion: swap to opacity-only crossfade, honor OS setting via
  `AccessibilityInfo.isReduceMotionEnabled` / `useReducedMotion` (reanimated has a hook).
- Stagger only for rare group entrances (onboarding, empty→populated first load), 30–80ms,
  never on dense/frequent lists (this matches Inflo's "dense lists don't animate" rule).
- CONFLICT NOTE: Emil/Apple allow bounce/spring fairly liberally (drag, momentum, "alive"
  elements). Inflo restricts spring/bounce to "a tiny spring on genuine wins" only — do not
  recommend bounce for ordinary UI (tab switches, card expand, button press) even if
  Emil/Apple would allow it. Flag any such suggestion as RULE-CONFLICT rather than an outright
  fix.
- Haptics: pair light haptic with selection/press on key actions, success haptic on wins
  (`expo-haptics`), fired on the same frame as the visual per Apple's harmony rule.

### GLASS-specific checks (nav, active tab/pill, sticky bar, sheet headers)
- Is `expo-blur` or a hand-rolled semi-transparent View used for nav? Check whether
  `expo-glass-effect` (native iOS 26 glass, SDK 54) would read better, with a non-iOS-26
  fallback — flag as an option only, don't assume installed.
- Blur intensity/tint, 1px inner top highlight (`rgba(255,255,255,.9)` per pillowGlass spec),
  hairline border, content scrolling under (not a fixed opaque bar).
- Confirm glass is scoped to nav + active states ONLY — glass on a plain content card is a
  RULE violation (§3/§10).
- Secondary buttons: flush glass, no outer shadow — an outer shadow on a secondary button is
  a RULE violation (lift is nav-active-reserved).

### Severity reminder
P1 = cheapens app / breaks a rule on a main screen. P2 = noticeable gap. P3 = nice-to-have,
keep short. Skip cosmetic items you're not sure about.

---

## C. Skills found and read

All 8 installed skills confirmed present at `.claude/skills/` and read in full for batch 0:
`impeccable` (reference files: `audit.native.md`, `ios.md`, `craft-floor.md`, `polish.md`),
`emil-design-eng` (`SKILL.md`), `apple-design` (`SKILL.md`),
`find-animation-opportunities` (`SKILL.md`), `review-animations` (`STANDARDS.md`).
`animate`, `improve-animations`, `animation-vocabulary` are installed but not required
reading per the prompt (not in the batch-0 read list) — not opened.

Docs read: `docs/design-direction.md` (§3,4,5,8,10,11), `docs/design-tokens.md` (Part 2),
`frontend/tailwind.config.js`, `frontend/global.css`.
