# Inflo — Design Tokens (Workplan 6.7)

**Source of truth:** `design-direction.md` (authored by Devasri, locked).
**This document:** operationalises that direction into concrete, buildable token values, decided in a guided visual workshop with Devasri.
**Drop location:** `docs/design-tokens.md`.

> Part 1 is the plain-language record of every decision (Devasri + Keshav can read this).
> Part 2 is the dev-ready token set for the NativeWind + gluestack-ui v3 theme (Devasri can ignore it).

Where a decision **deviates** from the original `design-direction.md`, it is flagged **⚑ CHANGE** — these were deliberate revisions made during the workshop, not drift.

---

# PART 1 — Decisions (human-readable)

### 1. Spacing rhythm — *Compact, 4px grid*
Everything snaps to a 4px grid: card padding 16, gaps between rows 12, sections open at 20. Implements the doc's "Compact" density. Chosen so a creator with many live deals can scan them without endless scrolling — "we mean business."

### 2. Corner radii — *cards 14 · buttons 16 · chips/avatars pill · circular*
Cards 14, chips and avatars fully pill. **⚑ CHANGE — buttons locked at 16, not the doc's ~10–11.** Reason: at high contrast (ink on white), 10–11 read visibly "sharp" at the corner; 16 resolves it while staying professional. Continuous "smooth/squircle" corners were tested and **rejected** — plain circular corners at 16 are the standard.

### 3. Elevation & shadows — *Soft, and composable*
Three levels: **L0** flat + hairline (dense lists, settings); **L1** soft lift (cards); **L2** floating (modals, nudges, chat, active states). "Soft" character chosen over "Pronounced" to keep the interface quiet. Elevation is **relative and rationed** — lift only one thing per card. **Signature pattern (reuse this):** to lift a subsection *inside* a white card, sit it on a faintly **recessed track** so the shadow has something to fall against ("use case A" — the in-chat agreement panel).

### 4. Pillow-glass & the button system
The premium "liquid glass" material, kept **Subtle**. The system's core rule, discovered in the workshop: **the gradient is a shared language you can use freely; the lift is the reserved signature.**
- **Primary button:** flat ink `#1C1B18`, white text — *flat* (no lift).
- **Secondary button:** the glass gradient, **flush** (no shadow). **⚑ CHANGE — doc's secondary spec included a soft shadow; dropped it** so the secondary never out-shadows the flat primary.
- **Nav-active state:** the *only* place that gets the full pillow-glass (gradient **+** lift + inset highlight). Active state is signalled by elevation + ink icon, never a colour change.

### 5. Colour mapping — *warm-neutral, rationed*
- **⚑ CHANGE — app base is `#FBFAF6`** (a warm near-white), not the doc's `#F6F4EF`, which read too dark under white cards. Cards stay pure white, defined by soft shadow **+ a whisper hairline** so they hold prominence on the lighter base.
- **⚑ CHANGE — avatars are greige `#E8E5DF`** (cooler, more grown-up than cane) with a thin line **+ soft glow** so they don't vanish on tonal surfaces.
- **Text:** ink primary / `#5E574E` secondary / warm-grey tertiary.
- **Status = coloured text + a small dot, no pills.** Good = bright green dot `#7DB02E` with a deep-green label `#4F7A1E` (the bright green is a dot colour, too light for text). Neutral = warm-grey. Critical = red `#C0392B` (kept dark for legibility — a lighter red failed AA).
- **Held back on purpose:** no blue chrome anywhere.

### 6. Chat & avatar tones — *the deal room*
- **⚑ CHANGE — the chat has its own deeper canvas `#EBE7E0`** so light bubbles have contrast.
- **Outgoing bubbles** use the one locked glass gradient (`#FFFFFF → #EAE7DF`), **flush**; **incoming** are white + hairline. Sender is you → glass; recipient → white (convention).
- **Multi-party:** sender **name in bold inside** each incoming bubble; **timestamp rides the last line inside** the bubble (saves vertical space). Own messages carry **no "You"** label.
- **Read receipt:** WhatsApp-style double-tick, warm grey.
- **Header:** group name + "N in this deal ›" (tap → members). No avatars in the header. Top-right = **search + AI**, matching plain icons (no 3-dot menu).
- **Stage tracker (pinned):** current stage name on the left (truncates), "n / 7 ›" on the right, a 7-node stepper below. No leading bullet.
- **Floating AI ("Deal assistant"):** opens with a plain-language summary (scope, fee, due date, stage), quick-ask chips, and a free-form box.
- **Members screen:** roles (Creator / Brand / Agent) shown as **quiet text, not pills.**

### 7. Data & hero colour — *photography + one teal family*  ⚑ CHANGE (significant)
- **⚑ Aqua retired as a hero gradient.** Hero/media moments are carried by **photography** with a neutral scrim for text legibility (an optional aqua-tint scrim keeps a whisper of brand). The synthetic "aqua-water" texture is dropped.
- **⚑ Charts moved off blue** (the doc's data-blue ramp is retired). The chart system is **warm neutrals + a single teal family**, research-backed (teal is the most colour-blind-safe accent and the shade public data-standards use; a single hue in three depths is the most cohesive, per single-hue-sequential research):
  - Default bar = **glass** (vertical gradient + hairline).
  - Emphasis = **Teal `#0095A8` → mid `#63B0BE` → light-steel `#A9CEDB`**, up to three, then everything fades to glass.
  - **Never all-blue** — teal only ever marks the one (or top three) that matter.
  - Numbers are **labelled directly** on bars/points; green & red appear only as status on top; neutrals (cane, grey, ink) kept but ~10% used.

### 8. Type in context — *locked as-is (Current scale)*
Geist, six roles: **Display 26/700 · Title 20/600 · Subtitle 17/600 · Body 15/400 · Secondary 13/400 · Micro 11/500.** Verified against iOS/Material: four roles match iOS exactly; it runs slightly *compact* (body 15 vs iOS 17), consistent with the density chosen in step 1. Money uses **tabular figures.** Labels are **sentence case** (no shouty uppercase).

### 9. Surface textures — *Clean*
**No decorative texture** — no grain, no pattern, no mesh on chrome. The only "texture" in the app is the soft light inside the pillow-glass and the real texture inside photographs. Restraint is the premium signal.

---

# PART 2 — Implementation tokens (FOR THE DEV — Devasri can ignore)

Semantic names → values. Structured for a NativeWind `theme.extend` + gluestack-ui v3 config. Shadows are warm-tinted (from ink), never cold grey.

## Colour

### Surfaces
| Token | Value |
|---|---|
| `bg.app` | `#FBFAF6` |
| `bg.dashboard` | `#FAFAF8` |
| `bg.chatCanvas` | `#EBE7E0` |
| `surface.card` | `#FFFFFF` |
| `surface.recess` | `#EFEAE2` |
| `border.hairline` | `#EAE8E2` |
| `border.cardHairline` | `#EFEDE8` |
| `avatar.bg` | `#E8E5DF` |
| `avatar.ring` | `rgba(28,27,24,0.09)` |

### Text
| Token | Value |
|---|---|
| `text.primary` / `ink` | `#1C1B18` |
| `text.secondary` | `#5E574E` |
| `text.tertiary` | `#847F78` |

### Status (on top only — never a chart's base)
| Token | Value |
|---|---|
| `status.good.dot` | `#7DB02E` |
| `status.good.label` | `#4F7A1E` |
| `status.good.tint` | `#ECF2D6` |
| `status.neutral` | `#847F78` |
| `status.critical` | `#C0392B` |
| `status.critical.tint` | `#FBF3F1` |

### Neutral / cane scale (warmth, chart context)
`#EFEBE3` · `#DFDACF` · `#D2CFC6` · `#B3AC9D` · `#8E8676`

### Chart emphasis — teal family (bar gradients are top→bottom)
| Token | Base | Bar top-light |
|---|---|---|
| `chart.e1` (deep teal) | `#0095A8` | `#1CACBE` |
| `chart.e2` (mid) | `#63B0BE` | `#7DC1CC` |
| `chart.e3` (light steel) | `#A9CEDB` | `#BFDBE5` |
| `chart.glassBar` | `linear-gradient(180deg,#FCFAF6,#E9E4DB)` + `1px rgba(28,27,24,0.12)` | |
| `chart.grid` | `#F0EEE9` | |
| `chart.axisLabel` | `#847F78` | |

**Retired:** `aqua-water` hero gradient, `data-blue` ramp, brown-as-chart-colour.

## Spacing (4px scale)
`space: { 0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48 }`
Defaults: screen padding `16`, card padding `16`, stack gap `12`, section gap `20`, text-line gap `4`.

## Radii
`radii: { card:14, panel:12, button:16, input:16, pill:999, tail:6 }`
`tail: 6` is reserved for the chat bubble tail corner (UI decision 8); it is not a general component radius.
Corner style = **circular** (do *not* apply corner-smoothing / squircle).

## Elevation (warm-tinted)
| Token | Value |
|---|---|
| `elev.l0` | none; `1px solid #EAE8E2` |
| `elev.l1` | `0 1px 2px rgba(28,27,24,.05), 0 5px 14px rgba(28,27,24,.07)` |
| `elev.l2` | `0 2px 6px rgba(28,27,24,.06), 0 14px 34px rgba(28,27,24,.11)` |
| `elev.liftIn` (subsection) | `0 1px 2px rgba(28,27,24,.05), 0 8px 18px rgba(28,27,24,.09)` |
| `elev.recessInset` (track) | `inset 0 1px 2px rgba(28,27,24,.05)` |

Rule: elevation is relative; **one lifted element per card**; use `surface.recess` + `elev.recessInset` under any white-on-white lift.

## Material signatures
```
/* Pillow-glass — NAV-ACTIVE ONLY (gradient + lift) */
pillowGlass = {
  background: linear-gradient(165deg,#FFFFFF,#EAE7DF),
  border: 1px solid rgba(28,27,24,.05),
  boxShadow: inset 0 1px 0 rgba(255,255,255,.9),
             0 1px 2px rgba(28,27,24,.05),
             0 5px 12px rgba(28,27,24,.09)   /* the lift = the reserved signature */
}

/* Glass gradient — SHARED, FLUSH (secondary button, chat bubble, chart bars) */
glassFlush = {
  background: linear-gradient(165deg,#FFFFFF,#EAE7DF),  /* 180deg for bars */
  border: 1px solid rgba(28,27,24,.07),
  boxShadow: inset 0 1px 0 rgba(255,255,255,.9)         /* NO outer lift */
}
```
The inset top-highlight is mandatory — it is what makes the glass read convex.

## Buttons
| Variant | Spec |
|---|---|
| Primary | bg `#1C1B18`, text `#FFFFFF`, radius `16`, **no shadow** |
| Secondary | `glassFlush`, text `#1C1B18`, radius `16` |
| Disabled | bg `#ECEAE3`, text `#B6B0A6` |
| Height / target | 44–48 / min 44 |

## Typography (Geist)
| Role | Size | Weight | Tracking | Notes |
|---|---|---|---|---|
| Display | 26 | 700 | -0.01em | lh 1.12 |
| Title | 20 | 600 | -0.01em | tabular for figures |
| Subtitle | 17 | 600 | -0.01em | |
| Body | 15 | 400 | 0 | lh 1.5 |
| Secondary | 13 | 400 | 0 | |
| Micro | 11 | 500 | +0.02em | **sentence case** |

Money / ledgers: `font-variant-numeric: tabular-nums`.

## Icons
Outline · stroke 1.6 · round caps+joins · 24×24 · `currentColor`. Inactive/wayfinding `#847F78`; content/active `#1C1B18`. Active nav carried by pillow-glass, not colour.

## Chat
| Element | Spec |
|---|---|
| Canvas | `#EBE7E0` |
| Incoming bubble | `#FFFFFF` + `1px #E6E2DA`, radius 16 / tail 6; name **12/700 ink** inside; body 15; timestamp **inline last line**, `11 #847F78` |
| Outgoing bubble | `glassFlush`, radius 16 / tail 6; no name; timestamp + double-tick inline |
| Read receipt | double-tick SVG, `#847F78` |
| Header | group name + "N in this deal ›" (→ members); right: search + AI (matching plain icons) |
| Stage tracker | name left (truncate) + "n / 7 ›" right; 7-node stepper; nodes done/current = ink, current ring `rgba(28,27,24,.12)` |
| Floating AI | bottom sheet, `elev.l2`; summary → quick-ask chips → free-form box |
| Members | rows with avatar + name + **role as `text.secondary`** (not pills) |
| Embedded agreement | lifted subsection on `surface.recess` (signature "use case A") |

## Charts
Default bar = `chart.glassBar`. Emphasis tiers `e1→e2→e3`, max 3, rest fade to glass. **Never all-blue.** Numbers labelled directly. Rounded bar tops (`7 7 3 3`). Horizontal bars: **no track** — clean pills on the card. Gridlines `chart.grid`, labels `chart.axisLabel`. Status colours overlay only.

## Hero / media
Photography-led. Scrim for legibility: `linear-gradient(to top, rgba(28,27,24,.72), transparent 66%)` (neutral) or `rgba(11,95,92,.82)→transparent` (aqua-tint, optional). No synthetic gradient hero.

## Surface texture
None. Do not add grain/pattern/mesh to any surface.

## Motion (from doc)
Micro 120–200ms · transitions 200–300ms · ease-out.
