# Inflo — Design Direction

> **Status:** Locked across all ten modules. This is the canonical reference for how Inflo looks, feels, and behaves. It is written to be *buildable* — a designer or engineer who has never seen the product should be able to produce on-brand screens from this document alone. Exact spacing/type-scale **tokens** are derived from this in the design-tokens step (workplan 6.7); this document sets the rules those tokens must obey.
>
> **Name:** "Inflo" is the **provisional working name**, pending trademark/domain/handle clearance (tracked separately). Everything here is deliberately **name-agnostic** — nothing depends on the final name.
>
> **Revision (2026-07, task 6.7 tokens workshop with Devasri):** six deliberate changes were made during tokenisation and folded back into this doc so it stays canonical. Each is marked **⚑ 6.7** inline. Summary: (1) button radius ~10–11 → **16**; (2) secondary button → **flush, no shadow**; (3) app base `#F6F4EF` → **`#FBFAF6`**; (4) avatars → **greige `#E8E5DF` + line/glow**; (5) cards gain a **whisper hairline `#EFEDE8`**; (6) **two signature shifts** — the aqua-water hero gradient is **retired in favour of photography**, and the data-blue chart ramp is **retired in favour of a warm-neutral + single teal family (`#0095A8`)**. Full values live in `design-tokens.md`.

---

## 0. North Star

> **Inflo is the calm, trusted home for creator–brand deals, run end-to-end — a neutral, quiet interface where personalisation, content, and data are the star.**

Everything below serves that sentence. When a design decision is unclear, return to it: *is this calm? does it build trust? is the interface staying quiet so the content and data can lead?*

---

## 1. Brand Personality

**Five adjectives:** Trustworthy · Effortless (simple) · Modern · Personal (warm) · Calm-with-spark.

**The governing principle:** *The UI is the stage; content, data, and personalisation are the star — **data is the headline act**.* The interface should recede so the user's deals, earnings, and content lead.

**Spectrum positions:**
- **Premium, but never intimidating** — confident and refined, never cold or exclusive.
- **Serious where it counts, lively where it helps** — deal, contract, and payment zones are calm and precise; discovery can be more energetic. Tone is *context-dependent*.
- **Strongly simple and minimal**, firmly **modern**.
- **Calm base with deliberate bold pops** — quiet by default, with rationed moments of colour/energy.
- **Emotionally warm, visually cool** — the feeling is human; the surface is restrained.

**Feel like / not like:**
- A **trusted partner**, not a faceless tool.
- A **calm space where the next step is obvious**, not a busy dashboard.
- **Personal and human** — note: "personal, not transactional" means it should never feel *cold or impersonal*. It does **not** mean hiding the business; deals, contracts and payments are the product and are surfaced clearly.
- **Premium yet welcoming.**

---

## 2. Reference Apps (the "parts bin")

Borrow **one mechanic** from each — not their identity. Everything is restyled into Inflo's own aesthetic.

| Reference | What we borrow |
|---|---|
| **Eventra UI kit** (lead aesthetic) | Structured, clean, content-forward cards |
| **Notion** | Information hierarchy + calm density |
| **Luma** | Calm-but-alive cards |
| **Airbnb** | Discovery cards + a "peek" affordance (the clean version only — no pink base, no text clutter) |
| **WhatsApp + Instagram DM + Intercom** (blend) | The chat hero: familiar bones, creator polish, embedded structured workflow cards |
| **Creator media kit** | Profile = one disciplined sectioned scaffold; personality comes from content |
| **Typeform + Duolingo + Revolut** | Onboarding: Typeform tone, grouped progressive disclosure (not one-question-at-a-time), Duolingo mechanics only, Revolut trust framing, role-fork at the top |

**Banked mechanics** (to style later): Mercury's chart-plus-insight pairing; Razorpay's deal-summary + in-chat agreement card; Spotify's "library row."

---

## 3. Visual Tone

- **Light-first, dark mode as a fast-follow.** Both must hold all contrast ratios.
- **Three-level elevation, consistency-biased:**
  - **L0** — flat + hairline border (dense lists, settings)
  - **L1** — soft lift (primary cards)
  - **L2** — floating (modals, floating chat, approval nudge, active states)
  - Elevation *costs density* — a lifted card fits fewer items. Inter-element spacing is a deliberate lever.
- **Corners:** 14px anchor, proportional and contextual — cards **14**, buttons **16** *(⚑ 6.7 — up from ~10–11; ink-on-white read too sharp at 10–11; corner-smoothing/squircle tested and rejected, plain circular)*, chips/avatars **pill**. Icon internal corners track the *button* radius, not the card radius.
- **Imagery for content, icons for wayfinding.**
- **Shared design language (tokens), distinct purpose-built components.** Chat and Discover share DNA (rounding, colour, elevation, spacing, type) but are *separate components*, not one reused component. Principle: **structure constant, content variable.** Cross-screen consistency is prioritised.
- **Premium signatures:**
  - **Pillow gradient / liquid glass** — the elevation *material*, scoped to **nav + active states**. Works in light and dark.
  - **Hero/media** — *(⚑ 6.7 — the synthetic aqua-water gradient hero signature is **retired**.)* Hero/media moments are carried by **photography** with a neutral scrim for text legibility (`linear-gradient(to top, rgba(28,27,24,.72), transparent 66%)`); an optional faint **aqua-tint scrim** (`rgba(11,95,92,.82)→transparent`) keeps a whisper of brand. No synthetic gradient hero.

---

## 4. Colour System

A **neutral-dominant, nature-derived analogous "landscape" palette.**

**Rules (non-negotiable):**
1. **Only agreed-palette colours, ever.**
2. **Wide palette, narrow per view** — the system is broad so layering stays rich, but any single screen uses few colours.
3. **"Bad" goes quiet** — it recedes to grey/beige; it never shouts (the one exception is *critical red*, below).
4. **Green = good/meaning only**, rationed.
5. **Blue / neutral = data.** Neutral-first for all chrome — **blue is not used as UI chrome or icon accent.**

### Neutrals (warm) — the foundation
| Token | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | Card surfaces |
| Off-white | `#FBFAF6` | **App base** background *(⚑ 6.7 — lightened from `#F6F4EF`, which read too dark under white cards; `#F6F4EF` retained as a deeper recessive neutral)* |
| Near-white | `#FAFAF8` | **Dashboard** base background |
| Light grey | `#EAE8E2` | Hairlines, dividers, fills |
| Warm grey | `#847F78` | Wayfinding/inactive icons, large/secondary text *(only)* |
| Ink | `#1C1B18` | Primary text, primary button |

### Text colours (accessibility-tuned)
| Level | Hex | Notes |
|---|---|---|
| Primary | `#1C1B18` | Default for anything important |
| Secondary | `#5E574E` | All supporting/secondary text — passes AA |
| Tertiary | `#847F78` | **Large text & icons only** — ~4.0:1, fails AA for small body |

### Cane / beige (warm naturals)
`#EFEBE3` · `#DFDACF` · **`#D2CFC6`** · `#B3AC9D` · `#8E8676` — warmth, recessive surfaces.

### Green (good / meaning — rationed)
`#ECF2D6` · `#C6DC52` · `#A6C93A` · **`#7DB02E`** (status dot) · `#4F7A1E`.

### Aqua (hero / media)
`#D6F3EF` · `#7FDDD0` · `#25B7AE` · `#0E8C86` · `#0A5F5C`.
Signature gradient: **`#119B91` → `#48D6C6`** (sunlit 3-stop variant for hero). Texture via soft caustics, never stripes.

### Blue (data only — not chrome)
*(⚑ 6.7 — the data-blue ramp is **retired for charts**; charts now use a warm-neutral base + a single **teal** emphasis family, see Charts below. The blue ramps here are **banked** only.)*
Bridge accent **`#1F8FAE`** — ramp `#D2EBF0` · `#7FCAD8` · `#38A6BC` · `#1F8FAE` · `#136A82`.
*Banked:* brightened blue `#2E84C2` (5 steps `#DCEBF8`…`#2E84C2`…`#1C5E97`) — retained, usage decided at component-build.

### Brown (atmospheric only — never functional or text)
`#E4DBCE` · `#A99A85` · `#6A553E` · `#574536` · `#3E332A`.

### Critical red (rationed — added deliberately)
**`#C0392B`** + soft tint **`#FBF3F1`**. Used **only** for genuinely bad/urgent financial/contractual harm (e.g. overdue payment, dispute, failed transaction). **Used tactically and sparingly:** small signals only — a status dot, a small icon, a short label. **Never** a red button fill, never a red-washed card. Always paired with clear copy and a confirm step. Routine deletes/cancels do **not** use red.

### Semantic meaning (memorise this)
> **green = good · blue/neutral = data · quiet grey/beige = bad · aqua = hero/media · brown/cane = warmth · red = critical harm (rationed)**

### Charts *(⚑ 6.7 — moved off blue)*
Default bar = **glass** (vertical gradient + hairline). Emphasis = a **single teal family**, research-chosen (most colour-blind-safe accent; single-hue-sequential for cohesion): **`#0095A8` → `#63B0BE` → `#A9CEDB`**, up to **three** emphasised bars then everything fades to glass — **never all-blue/all-teal**. Numbers labelled **directly** on bars/points. Green only on a genuinely *meaningful* bar; a "bad" bar = recessive grey/beige, never an alarm colour. Warm neutrals (cane/grey/ink) retained but ~10% used.

---

## 5. Typography

**Primary: Geist.** Alternate: **Figtree** (warmer; one-line swap). Geist chosen for cleaner numerals (critical for payments), an available mono, and neutrality so content leads.

**Principle:** weight creates hierarchy — **one family does every job**; hierarchy comes from weight + size, never new fonts or colours.

### The 6 type roles
Each text element is tagged with **one role**. The role carries its size *and* its scaling behaviour. (Default = scales with the OS up to the cap.)

| Role | Size / Weight | Scaling cap | Use |
|---|---|---|---|
| Display | 26 / 700 | 115% | Screen titles, big figures |
| Title | 20 / 600 | 120% | Section heads, card titles |
| Subtitle | 17 / 600 | 125% | Names, row headers |
| Body | 15 / 400 | 200% | Messages, descriptions, paragraphs |
| Secondary | 13 / 400 | 200% | Metadata, captions, helper text |
| Micro | 11 / 500 | 200% | Tab labels, badges, pills |

- **"Fixed" is a rare local override**, applied by a *component* (not chosen per text element) only where geometry truly cannot move — e.g. Micro inside a tab bar, a number locked in a fixed-width chart cell.
- **Principle:** content scales, chrome is constrained. Reading text (Body/Secondary) scales generously; structural text is capped/fixed.
- **React Native:** each cap maps to `maxFontSizeMultiplier`; use `allowFontScaling={false}` for the fixed override.

### Numbers
Numbers **reuse the 6 roles** (no separate role). They additionally take a figure treatment:
- **Tabular figures** (`font-feature-settings: "tnum"`) wherever numbers appear in **lists, tables, ledgers, or live-updating values** — so digits align in clean columns.
- **Proportional figures** for numbers sitting **inline within prose**.
- **Lining figures** are the default everywhere. (Geist supports all of this.)

---

## 6. Logo / Wordmark

- **Now:** a clean **lowercase "inflo" wordmark set in Geist** — simple, free, instantly on-brand, trivially swappable.
- **Later:** an optional simple **icon-mark** once the name clears clearance.
- **Execution deliberately deferred** — no point polishing a wordmark for a provisional name. Direction is locked; rendering waits for the name.

---

## 7. Iconography

A **custom 119-icon library**, delivered as individual SVGs + sprite + gallery + README.

**Spec (locked):**
- **Style:** outline, rounded caps & joins, **balanced corners (~2px radius)** tuned to the ~10px button rounding.
- **Weight:** **1.6** default, set via `stroke-width` so it's overridable (1.5 alternate; per-context allowed). Weight is *not baked in*.
- **Grid:** 24×24, **consistent optical height** (widths may vary).
- **Colour:** every icon uses `currentColor` — **neutral-first.**
  - Inactive / wayfinding → warm grey `#847F78`
  - Content → ink `#1C1B18` (warm grey when secondary)
  - On dark / glass → white or ink for contrast
  - Status → green `#7DB02E`, rationed for positive only
  - **No blue chrome.**
- **Active state:** carried by the **neutral pillow-glass** elevation, *not* a colour change. Reserved for nav + active states.
- **Slide decks:** the same set renders crisply at a heavier **~2.0 stroke** for large sizes — bump `stroke-width`, no rebuild.

**Parked (separate style tracks — not built):**
- **Illustrative pictograms** — larger duotone "spot" icons for empty states, onboarding, and deck heroes. A separate mini-system (fill, two-tone, aqua/cane palette).
- **Third-party social/platform logos** — sourced from official brand kits, never redrawn into the system.

---

## 8. Motion

**Personality:** calm, quick, purposeful. Motion **confirms and guides** — it is never the show.

- **Speed:** micro-interactions 120–200ms · transitions 200–300ms · nothing over ~400ms. Inflo should always feel *fast*.
- **Easing:** ease-out for entrances (decelerate in); gentle ease-in-out for state changes. Avoid bouncy/springy — the one exception is a *tiny* spring on genuine wins (deal closed, payment received).
- **Where motion is spent (the budget):** stage-bar advancing · pillow-glass nav/active states · approval-nudge, deal-closed & payment confirmations · card peek/expand. Everywhere else stays still.
- **Restraint + performance:** dense lists don't animate; no parallax or decorative motion; **transform/opacity only** (GPU-friendly on mobile).
- **Charts:** animate **once on load** (ease-out ~300–400ms, gentle stagger), **never loop**; show final state instantly under reduced motion.
- **Accessibility:** honour the OS **"reduce motion"** setting (swap to instant/none); **never signal state by motion alone**; no flashing faster than ~3/sec.

**Build tiers:**
- **Build now (basically free with Expo/RN):** screen transitions, button/card press feedback, tab-switch crossfade, list add/remove, reduce-motion handling.
- **Build now (cheap, high-value):** stage-bar advancing, toast/approval-nudge entrances.
- **Parked (phase-2 polish):** deal-closed/payment celebration, chart load choreography, pillow-glass nav shimmer.

---

## 9. Accessibility & Mobile

- **Contrast (WCAG AA):** body text ≥ 4.5:1, large text & icons/UI ≥ 3:1. Secondary text uses `#5E574E` (passes); `#847F78` is reserved for icons and large text.
- **Never colour alone:** every status = colour **+** label **+** shape/icon. (The stage system already does this.)
- **Touch targets:** ≥ 44pt (iOS) / 48dp (Android). Pad the tappable area beyond the 24px icon; keep spacing so thumbs don't mis-hit.
- **Density:** **Compact** — body **15**, target **44**.
- **Dynamic Type:** handled by the 6 type roles and their caps (§5) — content scales, chrome is constrained.
- **Screen readers:** every icon-only control gets an `accessibilityLabel`.
- **Focus:** visible focus states (keyboard / RN Web); honour reduce-motion.
- **Mobile ergonomics:** primary actions in the thumb zone; bottom nav reachable one-handed; respect safe areas (notch / home indicator).
- **Signatures must clear ratios:** white-on-aqua and ink-on-pillow-glass both verified at build.
- **Dark mode** re-clears every ratio (fast-follow, but the discipline is baked in now).

---

## 10. Buttons & Component System

**Button hierarchy (fully neutral — no colour chrome):**

| Tier | Light | Dark | Notes |
|---|---|---|---|
| **Primary** | Flat ink `#1C1B18`, white text | Light ink `#FAFAF8`, dark text | Highest-contrast, the one main action |
| **Secondary** | Glass gradient `linear-gradient(165deg,#FFFFFF,#EAE7DF)` + hairline + inset highlight, **flush (no outer shadow)** *(⚑ 6.7 — shadow dropped so secondary never out-shadows the flat primary; the **lift** is now reserved for nav-active only)* | Charcoal pill ≈ `#3A3833→#2A2823` gradient on a near-black bar (`#1A1916`), faint white top inset, off-white label, flush | Shared glass gradient, flush. Core rule: **gradient = reusable, lift = reserved (nav-active only)** |
| **Tertiary** *(only if a 3rd action is truly needed)* | Soft neutral `#EDEAE3` or ghost outline | Soft neutral `#2C2A25` or ghost | Most screens won't need this |
| **Disabled** | `#ECEAE3` bg / `#B6B0A6` text | `#262420` bg / `#5E5A53` text | **Same treatment in both modes** |

**Destructive actions:**
- **Routine** (delete draft, cancel) → **fully neutral** (ghost/outline, ink/grey text), protected by a **confirm step**. No colour.
- **Critical** (genuinely harmful/urgent) → **rationed red accent only** (small dot/icon/label + clear copy + confirm). Never a red fill or red-washed surface.

**Corners:** cards 14 · buttons **16** *(⚑ 6.7)* · chips/avatars pill.
**One primary action per screen.** Make the next step obvious.

---

## 11. Do's & Don'ts

**Do**
- Let **content and data be the star**; keep the UI quiet.
- Spend colour **meaningfully** — green = good (rationed), blue/neutral = data, aqua = hero/media.
- Use the **pillow-glass** for nav + active states; **aqua-water** for hero/media only.
- Keep icons **neutral, outline, 1.6, equal optical height**; signal "active" with elevation, not colour.
- Make the **next step obvious**; one primary action per screen.
- Pair every status with **colour + label + shape**.
- Keep motion **fast, calm, purposeful** (120–300ms, ease-out); spend delight only on real wins.
- Use **tabular figures** for any column/ledger/live number.
- Write **plain, active, end-user language** ("Save changes", not "Submit").

**Don't**
- Don't use **alarm colours** for routine "bad" — it recedes to quiet grey; red is reserved, rationed, and tactical.
- Don't use **blue (or any colour) as icon/interface chrome** — neutral-first.
- Don't spread the **premium gradient everywhere** — it's a signature, not wallpaper.
- Don't **fill icons** as the default (outline only; fill/duotone reserved for rare active emphasis).
- Don't let **type carry personality** — one family (Geist), hierarchy via weight/size.
- Don't animate **dense lists** or add decorative motion.
- Don't rely on **colour alone**, ever.
- Don't crowd **touch targets** or drop text below legible sizes.
- Don't mix **icon weights/heights** on one screen.

---

## Appendix A — Deferred to Design Tokens (workplan 6.7) — ✅ RESOLVED

*(⚑ 6.7 — all resolved in the tokens workshop; final values in `design-tokens.md`.)*
These were intentionally *not* fixed here; they were derived from the rules above during tokenisation:
- Exact spacing scale (px) and exact elevation values (px/blur/spread per L0–L2).
- Where each palette colour lands per component; chat-bubble and avatar tones.
- Any additional surface textures beyond the two locked signatures.

## Appendix B — Component & IA backlog (styled at component-build)

Per-row chat + "⋯" actions · "library row" (tap = primary, ⋯ = secondary) · completion-tracker pill (3/5) · header "⋯" overflow · peek affordance · floating multi-chat bubble · in-chat structured agreement pop-up (mandatory/optional fields, doubles as a data source) · in-chat stage legend · workflow rows with completion tick + scroll/lock · approval nudge card · chat-list bubble filters · structured chat header · read receipts · voice toggle · persistent AI-summary bubble · reactions · tagging · search-as-bubble-filters · category tabs · profile = media-kit scaffold.

## Appendix C — Naming (parked, own track)

"Inflo" is the **provisional working name**. Before committing: run a trademark clearance search (IP India + any target markets, via an attorney), secure domain/handles, and confirm app-store availability. The design system is name-agnostic, so this can resolve in parallel without blocking build.

---

*End of design direction. All ten modules locked. Tokens follow.*
