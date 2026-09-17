# UI Polish Audit — run prompt

How to use: open a NEW Claude Code session in VS Code (model: Fable) for each batch. Paste everything
under "PROMPT" and change only the last line (`RUN: batch 0`, `RUN: batch 1`, ...). One batch per
session. Fresh sessions keep context small, which is what keeps the cost down.

If credits run out mid-batch, nothing is lost: findings are written to disk after every file.
Any other model can continue by pasting the same prompt with `RUN: resume`.

---

## PROMPT

You are a senior iOS design engineer auditing the Inflo app (Expo SDK 54, React Native + Web,
NativeWind, gluestack-ui v3, reanimated 4, expo-blur, expo-haptics). The goal is a premium,
polished feel in the league of Apple Music, Revolut and Notion, inside Inflo's locked design rules.

This is a REVIEW ONLY. Do not edit any file outside `docs/ui-audit/`. Do not run the app, builds,
tests, npm installs, or git commands. Do not read `node_modules`, `ios/`, `dist/`, `backend/`,
`.expo/`, or `docs/mockups/*.html`, and only read `.claude/skills/` in batch 0 (they are huge and not needed). Credits are tight: read only the
files listed for your batch, prefer `grep -n` + reading line ranges over whole-file reads for any
file over 400 lines, and never re-read a file you already read this session.

### Skills (installed in `.claude/skills/`)
Installed: `impeccable` (v4.0.4) plus Emil Kowalski's set: `emil-design-eng`, `apple-design`,
`find-animation-opportunities`, `review-animations` (+ `STANDARDS.md`), `improve-animations`,
`animation-vocabulary`, `animate`.

Cost rules for skills (these override anything a skill tells you):
- Read skill files ONLY in batch 0. Batch 0 distils them into `00-baseline.md`; batches 1–6 use
  that summary and do not open `.claude/skills/` again.
- Do NOT run `/impeccable init`, `context.mjs`, `detect.mjs`, or any interview/question flow.
  There is no PRODUCT.md or DESIGN.md on purpose: the product and visual authority is
  `docs/design-direction.md` + `docs/design-tokens.md`. Platform: iOS-first Expo React Native,
  web secondary.
- Do NOT use impeccable `critique` (it spawns sub-agents). Never spawn sub-agents or Task tools.
- Use these impeccable references: `reference/audit.native.md`, `reference/ios.md`,
  `reference/craft-floor.md`, `reference/polish.md`.
- `apple-design` and the Emil skills are written for the web. Translate every motion
  recommendation to React Native: `react-native-reanimated` 4 (`withTiming`/`withSpring`,
  layout animations `FadeIn`/`LinearTransition`), `react-native-gesture-handler`, `expo-haptics`,
  `expo-blur`. No CSS transitions, no framer-motion.
- Never let a skill override Inflo's locked rules below.

### Locked rules win (non-negotiable)
Source of truth order: `docs/design-direction.md` → `docs/design-tokens.md` → code.
Every suggestion must fit these. If a premium idea conflicts with a rule, log it as
`RULE-CONFLICT` with the trade-off, and do not recommend it as a fix. Key rules to hold:
- Neutral-first palette, only agreed hex values; no blue chrome; green rationed for "good";
  red `#C0392B` only as a small dot/icon/label for real financial harm, never a fill.
- Glass ("pillow glass") is scoped to nav + active states only. Lift/shadow reserved for
  nav-active. Secondary button is flush glass gradient, no outer shadow.
- Radii: cards 14, buttons 16, chips/avatars pill. Icons: custom set in `frontend/assets/icons/`,
  outline, stroke 1.6, `currentColor`, active = elevation not colour.
- Type: Geist only, the 6 roles (26/20/17/15/13/11) with their scaling caps; tabular figures for
  money/lists.
- Motion: 120–200ms micro, 200–300ms transitions, nothing over ~400ms; ease-out; no bounce except a
  tiny spring on real wins; transform/opacity only; honour reduce-motion; dense lists don't animate.
- One primary action per screen. Touch targets ≥ 44pt. AA contrast.

### What to look for (tag each finding with one category)
1. `SLOP` — generic AI-built look: default Expo template leftovers (`hello-wave`,
   `parallax-scroll-view`, `themed-text`, `themed-view`, `external-link`, `modal.tsx`,
   `icon-symbol`), magic numbers instead of tokens, random greys/hex not in the palette,
   inconsistent padding/radius between siblings, emoji or stock icons, centred-everything layouts,
   gradient/shadow soup, "Submit"/"Something went wrong" copy, placeholder text, cramped or
   uneven vertical rhythm, missing empty/loading/error states, spinners where skeletons fit.
2. `RULE` — breaks a locked rule above (quote the rule section number).
3. `GLASS` — where the Apple Liquid Glass feel can be improved WITHIN scope (nav bar, active
   tab/pill, sticky action bar, sheets' grab area/headers). Be concrete: blur intensity, tint,
   1px inner highlight, hairline, specular top edge, content scrolling under the bar, safe-area
   handling, web fallback when blur is unavailable. Check whether `expo-glass-effect` (native
   iOS 26 glass, Expo SDK 54) would be better than `expo-blur` for the nav, with a non-iOS-26
   fallback — flag as an option, do not assume it is installed.
4. `MOTION` — missing or wrong motion from the §8 budget: press feedback (scale 0.97 + opacity,
   ~120ms), tab crossfade, sheet present/dismiss, stage-bar advance, list insert/remove, toast /
   approval-nudge entrance, win-moment spring + haptic, shared-element card→deal expand. Also flag
   motion that violates the budget. Pair haptics with key actions (light on selection, success on
   wins).
5. `POLISH` — the small things that separate premium from fine: optical alignment, icon/text
   baseline, numeric alignment, keyboard avoidance, scroll-edge fades, pressed/disabled/focus
   states, safe areas, hit slop, text truncation, dark-mode readiness.

### Severity
`P1` visibly cheapens the app or breaks a rule on a main screen · `P2` noticeable polish gap ·
`P3` nice-to-have. Keep P3s short. Skip anything cosmetic you are not sure about.

### Checkpoint protocol (do this exactly — it is what protects the work)
All output lives in `docs/ui-audit/`.
1. At the start: read `docs/ui-audit/PROGRESS.md`. If `RUN: resume`, pick the first batch not
   marked `done` and, inside it, the first file not ticked.
2. After reviewing EACH file: immediately append its findings to
   `docs/ui-audit/batch-<N>.md` and tick that file in PROGRESS.md (`- [x]`). Do not hold findings
   in memory until the end of the batch.
3. At the end of the batch: set the batch status to `done` in PROGRESS.md and add a 3-line
   "handoff note" under it (what stood out, anything the next batch should check).
4. If you notice your context getting long, stop at a file boundary, write the handoff note,
   and end. Partial is fine; lost work is not.

### Finding format (compact — output tokens are the expensive part)
```
### <file path>
- [P1][GLASS] L42–58 · Nav uses flat white bg with shadow; reads as Android, not glass.
  Fix: BlurView intensity ~40 tint "light" + rgba(255,255,255,.55) overlay + 1px top highlight
  rgba(255,255,255,.8) + hairline #EFEDE8; let list scroll under it. Rule: §3, tokens "Material signatures".
```
Include a code snippet (max 10 lines) only for P1s. No praise, no restating the file's purpose.

### Batches
Batch 0 — Baseline (do first; this is the only batch that reads docs and skills).
Read `docs/design-direction.md` sections 3, 4, 5, 8, 10, 11 (lines ~58–270),
`docs/design-tokens.md` Part 2 (from line 64), `frontend/tailwind.config.js`,
`frontend/global.css`, then these skill files: `impeccable/reference/audit.native.md`,
`impeccable/reference/ios.md`, `impeccable/reference/craft-floor.md`,
`impeccable/reference/polish.md`, `emil-design-eng/SKILL.md`, `apple-design/SKILL.md`,
`find-animation-opportunities/SKILL.md`, `review-animations/STANDARDS.md`.
Write `docs/ui-audit/00-baseline.md`, max 160 lines, in three parts:
A. Inflo tokens (exact hex, radii, spacing, shadows, glass recipe, motion timings) and any place
   `tailwind.config.js` disagrees with the docs.
B. A merged review checklist distilled from the skills (AI-slop tells, iOS/native craft checks,
   polish checks, Emil/Apple motion rules with exact values), already translated to React Native
   and with anything that conflicts with Inflo's rules removed or marked.
C. Which skills were found and read. Tick batch 0 in PROGRESS.md.
Later batches read this file INSTEAD of the docs and skills.

Batches 1–5: first read `docs/ui-audit/00-baseline.md`, then review these files.

Batch 1 — Foundations & navigation (highest leverage: fixes here spread everywhere)
- frontend/src/app/_layout.tsx
- frontend/src/app/(tabs)/_layout.tsx
- frontend/src/components/bottom-nav.tsx
- frontend/src/components/haptic-tab.tsx
- frontend/src/components/ui/glass-surface.tsx
- frontend/src/components/ui/button/index.tsx
- frontend/src/components/ui/chip.tsx
- frontend/src/components/ui/toggle.tsx
- frontend/src/components/ui/text-field.tsx
- frontend/src/components/ui/edit-sheet.tsx
- frontend/src/components/ui/collapsible.tsx
- Template leftovers (skim only, one line each, decide keep/delete): hello-wave, parallax-scroll-view,
  themed-text, themed-view, external-link, tab-placeholder, app/modal.tsx, ui/icon-symbol*.tsx

Batch 2 — Deal room (the hero experience)
- frontend/src/app/deal/[id].tsx
- frontend/src/components/deal/sticky-action-bar.tsx (1,661 lines: grep for `className`,
  `style=`, `Animated`, `Pressable`, `BlurView`, `shadow`, `#` hex first, then read only the
  render sections)
- frontend/src/components/deal/payment-tracking-card.tsx
- frontend/src/components/deal/deliverables-card.tsx
- frontend/src/components/deal/creative-brief-card.tsx
- frontend/src/components/deal/payment-details-card.tsx
- frontend/src/components/deal/terms-review-card.tsx
- frontend/src/components/deal/close-status-card.tsx
- Remaining files in frontend/src/components/deal/ (sheets): skim for pattern repeats only; don't
  re-log an issue already logged — write "same as <ID>".

Batch 3 — Chat & Discover
- frontend/src/app/(tabs)/chat.tsx, account.tsx, index.tsx, track.tsx, you.tsx
- frontend/src/components/chat/*
- frontend/src/components/discovery/*
- frontend/src/app/brand/[id].tsx, frontend/src/app/creator/[id].tsx

Batch 4 — Auth & onboarding (first impression)
- frontend/src/components/ui/auth-shell.tsx, onboarding-progress.tsx, signature-pad.tsx
- frontend/src/app/(auth)/*.tsx
- frontend/src/app/(onboarding)/*.tsx

Batch 5 — Media kit
- frontend/src/components/media-kit/*.tsx
- frontend/src/components/media-kit/editors/*.tsx
- frontend/src/components/maker-checker-config.tsx

Batch 6 — Synthesis (read ONLY the batch-*.md files and 00-baseline.md; no source code)
Write `docs/ui-audit/99-roadmap.md`, max 150 lines:
1. Top 15 changes ranked by visual impact ÷ effort, each with finding IDs it resolves.
2. A shared "motion kit" spec: 4–6 reusable primitives (PressableScale, SheetTransition,
   FadeIn list item, StageAdvance, WinSpring+haptic) with exact duration/easing/haptic, so one
   component fixes many findings.
3. A single "glass recipe" spec for nav + active states (native, iOS-26 glass option, web fallback).
4. Template/dead code to delete.
5. RULE-CONFLICT list for Keshav + Devasri to decide.
6. Implementation order as small PR-sized tasks a cheaper model can execute one at a time.

Start by writing `docs/ui-audit/PROGRESS.md` if it does not exist (copy the checklist from the
batches above), then do the batch named below.

RUN: batch 0
