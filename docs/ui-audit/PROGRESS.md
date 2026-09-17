# UI Audit — progress

Update after every file. Any model resuming: read AUDIT-PROMPT.md, then continue from the first unticked item.
Skills installed in .claude/skills: impeccable, emil-design-eng, apple-design, find-animation-opportunities, review-animations, improve-animations, animation-vocabulary, animate

## Batch 0 — Baseline · status: done
- [x] 00-baseline.md written

Handoff note:
- tailwind.config.js matches docs/design-tokens.md Part 2 exactly — no token drift found, so
  later batches can treat any off-palette hex/radius/spacing in code as a straight SLOP/RULE
  finding, not a config question.
- Key conflict to watch for: Emil/Apple skills recommend springs/bounce fairly freely (drag,
  momentum, "alive" UI); Inflo's §8 budget restricts bounce to "a tiny spring on genuine wins"
  only — tag any spring/bounce suggestion outside win-moments as RULE-CONFLICT, not a fix.
- Glass is scoped to nav + active states only; secondary buttons are flush (no outer shadow) —
  watch for glass or lift creeping onto plain cards/buttons in batches 1–5, that's a straight
  §3/§10 RULE violation.

## Batch 1 — Foundations & nav · status: done
- [x] app/_layout.tsx
- [x] app/(tabs)/_layout.tsx
- [x] components/bottom-nav.tsx
- [x] components/haptic-tab.tsx
- [x] ui/glass-surface.tsx
- [x] ui/button/index.tsx
- [x] ui/chip.tsx
- [x] ui/toggle.tsx
- [x] ui/text-field.tsx
- [x] ui/edit-sheet.tsx
- [x] ui/collapsible.tsx
- [x] template leftovers

Handoff note:
- The three foundation gaps that will echo through every later batch: (1) no shared press
  primitive — Button/Chip/Tab/Toggle each lack scale-0.97 + haptic (B1-12/28/33/35), so log
  screen-level press findings as "same as B1-28"; (2) `ui/button` has no Inflo secondary
  (glassFlush) tier and defaults to a 40pt height, which is why 29 screen files hand-roll
  `Pressable bg-ink` buttons — expect sibling drift in batches 2–5, reference B1-25/26;
  (3) EditSheet uses RN Modal slide with no keyboard avoidance or safe-area bottom
  (B1-45/46/47) — check whether deal/* sheets reuse it or re-implement the same flaws.
- Nav: blur is effectively hidden under a 92% fill and no tab crossfade exists (B1-07/09);
  no screen uses `useBottomTabBarHeight`, so verify each tab screen's bottom padding (B1-10).
- Batch 2 should confirm sheet top radius (24 here, B1-48) and red-outline error styling
  (B1-42) are consistent, then hand both to the RULE-CONFLICT list for batch 6.

## Batch 2 — Deal room · status: done
- [x] app/deal/[id].tsx
- [x] deal/sticky-action-bar.tsx
- [x] deal/payment-tracking-card.tsx
- [x] deal/deliverables-card.tsx
- [x] deal/creative-brief-card.tsx
- [x] deal/payment-details-card.tsx
- [x] deal/terms-review-card.tsx
- [x] deal/close-status-card.tsx
- [x] deal/ remaining sheets

Handoff note:
- Deal room has zero motion (no reanimated/haptics in 6,000 lines): stage-bar advance,
  deal-closed win, contract-signed and payment-received are all static (B2-15/56/60/67) —
  batch 6 should make the motion kit's StageAdvance + WinSpring the top-ranked items.
- Structural P1: the "sticky" action bar is an unbounded View stacking 4–6 cards, crushing
  chat (B2-13); nested 22-field ScrollView inside it (B2-50). Every deal file hand-rolls
  pill buttons (radius 9999, ~36pt, 11–14px labels) and 10–12px body copy — one shared
  Button/Card/type fix resolves B2-14/25/33/40/46/53/57/64. Red tints used as fills 15+
  times (B2-17 family) → add to RULE-CONFLICT list only if Devasri wants a "warning fill".
- All 11 deal sheets go through EditSheet, so B1-45/46/47/48 are the real sheet fix; batch 3
  should check whether chat/discover reuse the same `#F3EFE7`/`#5D5953`/`#7A7A7A` off-palette
  values (B2-01/10/65) and the `★`/`›` glyph habit (B2-62/66).

## Batch 3 — Chat & Discover · status: done
- [x] (tabs) screens
- [x] chat/*
- [x] discovery/*
- [x] brand/[id], creator/[id]

Handoff note:
- Same three foundation gaps recur (press primitive B1-28, secondary button B1-25, EditSheet
  B1-45/46/47): every card/row in chat + discover has no scale/haptic (B3-14/39), and every
  screen guesses the tab-bar inset (pb-24/pb-32/pb-16 — B1-10). Off-palette colour is the new
  P1 theme here: stage pills in `lib/deals.ts` (B3-15) and the six `LOGO_COLORS` fills
  duplicated in brand-card + brand-profile-view (B3-41) — both fixable in one place.
- Every loading state on these tabs is a centred spinner on a blank canvas (B3-01/26/49); a
  single skeleton primitive would resolve all of them. `text-status-bad` is used but is not a
  token (B3-25) — batch 4/5 should grep for other undefined class names (`status-bad`,
  `rounded-xl`, `rounded-2xl`) and the `★` glyph (B3-35/42, B2-66).
- Batch 5 (media-kit) should check `MediaKitView`'s "Start a deal" CTA and `StorageImage`
  placeholder/fade-in (B3-38, B3-44) since creator/[id] renders MediaKitView directly.
Assumptions: (tabs)/index.tsx and you.tsx are thin wrappers — audited via their child
components; `expo-glass-effect` treated as not installed; `rounded-xl` assumed to be Tailwind
default 12 (= panel radius) since tailwind.config.js does not redefine it.

## Batch 4 — Auth & onboarding · status: done
- [x] auth-shell, onboarding-progress, signature-pad
- [x] (auth)/*
- [x] (onboarding)/*

Handoff note:
- The first-run flow has zero motion, zero haptics and no Dynamic-Type caps (grep across all
  15 files): three P1s are all "moments" — OTP boxes (B4-24), the platform tiles' off-palette
  fills (B4-43) and the static completeness ring (B4-56). PressableScale (B1-28) + a
  FadeInDown stagger in AuthShell (B4-05) + the progress-bar advance (B4-09) fix most of it
  in three shared spots; roadmap §1 should slot B4-05/09/24/56 next to StageAdvance/WinSpring.
- Off-token drift is concentrated in AuthShell (`px-[22px]`, uppercase micro eyebrow —
  B4-02/03) and role.tsx's hero (B4-32/33); fixing the shell fixes 10 screens. Inset-shadow
  "recess" tokens render as nothing on native (B4-22) — batch 5 should check media-kit for
  the same `shadow-recessInset` reliance and for emoji chips (B4-39) / hand-rolled pills
  (B4-44) / `rounded-[13px]`/`[10px]` radii.
- New RULE-CONFLICT for §5: the mockup eyebrow/kicker (B4-04). Lift on active segmented
  control (B4-51) is IN scope (active state) — recommend the pillow recipe, not removal.
Assumptions: `expo-glass-effect` still treated as not installed; `expo-linear-gradient`,
`expo-haptics`, reanimated 4 confirmed in package.json so fixes assume no new deps; no
platform (Instagram/YouTube/TikTok/X) icons exist in `assets/icons/` — B4-43's icon option
requires adding four outline icons in the house style, flagged rather than assumed.

## Batch 5 — Media kit · status: done
- [x] media-kit/*
- [x] media-kit/editors/*
- [x] maker-checker-config

Handoff note:
- Four P1s cluster around trust and safety, not motion. The no-photo hero is an off-palette
  purple gradient (B5-01). A verified check shows for every creator (B5-02). The owner cannot
  reach Edit profile at all (B5-03). Photos and credentials delete on one red, sub-44pt tap with
  no confirm (B5-52/57). The privacy sheet has two switches for one outcome (B5-47/64). Error
  state and not-onboarded state are the same screen (B5-17).
- The foundation gaps repeat here: EditSheet state seeding and dismiss (B5-37/43, B1-45), outline
  instead of glassFlush secondary (B1-25), two primaries per sheet (B5-53/67), routine errors in
  red (B5-39), and settings rows lifted to L1 instead of L0 (B5-49). A shared ChipGroup,
  IconButton (44pt) and a "destructive confirm" helper would close most editor findings.
- Batch 6 (already written) needs a refresh. Append B5-01/02/03/17/47/52/57 to roadmap §1 and
  add a "list add/remove + drag reorder" item (B5-55/58) to the motion kit. PLATFORM_COLOR (B5-30)
  joins B3-41/B4-43 as one off-palette-fill fix.
Assumptions: `expo-glass-effect` still treated as not installed; `@/components/ui/toggle` and
`Chip` behaviour taken from batch-1 findings, not re-read; `fetchOwnMediaKit` returning null on
error was inferred from its doc comment and early `return null`, not a full read of lib/media-kit.ts;
the hero `bio` overflow (B5-12) and dot collision (B5-26) are layout inferences from the code,
not verified in a running app (the audit forbids running it).

## Batch 6 — Synthesis · status: done
- [x] 99-roadmap.md written

Handoff note:
- Ran batch 6 before batches 4 and 5 (per Keshav's RUN line); the roadmap synthesises batches
  1–3 only. When batch-4.md / batch-5.md exist, append their IDs to roadmap §1 (Top 15) and §6
  (PR order) — most auth/onboarding/media-kit findings will map to PR-03/04/07/08 primitives.
- The whole roadmap hinges on four primitives (PressableScale, ui/button secondary tier,
  EditSheet rebuild, type-role sweep); eight RULE-CONFLICT decisions (§5) block PR-10 and PR-11
  and should go to Keshav + Devasri first.
Assumptions: batch 6 read only 00-baseline.md + batch-1/2/3.md (no source, no docs);
`expo-glass-effect` still treated as not installed; PR sizing assumes one cheaper-model
session per PR with no new dependencies except the optional iOS-26 glass call.
