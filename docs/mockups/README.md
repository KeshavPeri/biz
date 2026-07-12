# Screen Mockups — visual & structural references

High-fidelity **HTML/CSS prototypes** of target Inflo screens, built by Devasri (Fable).
They are **token-faithful**: their `:root` CSS variables are a 1:1 match with
`docs/design-tokens.md` (same colours, radii, elevation, glass gradients). They show how the
locked design system composes into real screens.

## How to use these (rules)

- **They are the visual + structural target, NOT source code.** These are web HTML/CSS; the app
  is React Native (Expo + gluestack-ui v3 + NativeWind). **Do not port HTML/CSS directly** —
  rebuild each screen in React Native, mapping the mockup's CSS variables onto the NativeWind
  tokens in `design-tokens.md` (e.g. `--bg-app` → `bg.app`, `--r-btn` → `radii.button`,
  `--elev-1` → `elev.l1`, `--glass-grad` → the pillow-glass/glassFlush material).
- **Canonical order if anything disagrees:** `design-direction.md` → `design-tokens.md` → these
  mockups. The mockups illustrate; the token/direction docs decide. If a mockup shows something
  not yet in the tokens, flag it rather than inventing a new token.
- **Use as an acceptance check:** after building a screen in RN, compare it side-by-side with its
  mockup for layout, spacing, and fidelity.
- Open any file in a browser to view it.

## Index — mockup → what it references

| File | Screens shown | Maps to build phase / bucket |
|---|---|---|
| `inflo-one.html` | **Unified prototype** — the app shell incl. the **5-tab bottom nav** (Discover · Chat · Track · You · Account) and multiple screens in one | **6.5 nav shell**; general screen composition reference |
| `inflo-onboarding.html` | Onboarding / role fork / sign-up flow | Bucket 1 — Identity & Trust (Phase 7) |
| `inflo-discover.html` | Discover — "Matched to you", creator match, "Pitch a brand" | Bucket 2 — Discovery (Phase 8) |
| `inflo-deal-room.html` | Deal room — chat hero, stage tracker, in-chat agreement, floating AI | Bucket 3 — Deal Engine (Phase 9) |
| `inflo-media-kit.html` | Profile as media-kit scaffold — Reach, Audience, Rate card, Brand history | "You" / profile (Identity & profile) |
| `inflo-perks-stp.html` | Perks + pipeline ("Your pipeline", "Open to you") | Tracking / perks *(confirm what "STP" denotes)* |

## Notes
- Provenance: Fable prototypes from Devasri, 2026-07, built on the 6.7 token system.
- Kept as reference assets only — never imported into the build tree.
