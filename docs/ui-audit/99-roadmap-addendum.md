# Roadmap addendum — batches 4 & 5

Merge target: `99-roadmap.md`. If `99-roadmap.md` already contains "PR-00" and "PR-23", this
addendum is already merged — ignore it. Otherwise treat this file as part of the roadmap.

## §1 additions (Top changes 16–22)
| # | Change | Effort | Resolves |
|---|---|---|---|
| 16 | **Trust fixes (do first, these are bugs):** verified badge only when a handle is verified; confirm step + 44pt target on photo/credential delete; one rate-card privacy switch; error state ≠ not-onboarded state; owner can reach Edit profile; remove fake always-on toggle; strip developer copy ("mock stats · no live API") | S | B5-02 B5-52 B5-57 B5-47 B5-17 B5-03 B4-49 B5-04 B5-45 |
| 17 | AuthShell: `FadeInDown` stagger on title/subtitle/body, token gutter, sentence-case eyebrow, 44pt back (fixes ~10 screens) | S | B4-01 B4-02 B4-03 B4-05 B4-08 |
| 18 | Onboarding moments: OTP boxes (focus move + filled pop + success haptic), progress-bar advance (StageAdvance timing), completeness ring draws once | S | B4-24 B4-25 B4-26 B4-09 B4-56 |
| 19 | One `PlatformTile` / neutral fill used by onboarding platforms, platform-stat-card, brand logo tiles; replace mauve no-photo hero | S | B4-43 B5-30 B5-01 B3-41 |
| 20 | Grouped L0 settings list (inset-grouped rows, whole row tappable) for preferences, privacy sheet, maker-checker | S | B4-46 B4-48 B5-49 B5-50 B5-72 B5-71 B3-20 |
| 21 | Media-kit editors: one primary per sheet, 44pt `IconButton`, shared `ChipGroup`, list add/remove + reorder motion, busy guards, emoji chips out | M | B5-53 B5-67 B5-55 B5-58 B5-59 B5-61 B5-37 B5-43 B4-39 B4-40 B4-44 |
| 22 | Media-kit hero polish: identity entrance, glass "Edit photos" chip, tabular figures, name truncation, pager a11y | S | B5-09 B5-10 B5-12 B5-13 B5-14 B5-26 B5-27 B5-32 B5-65 |

## §5 additions (RULE-CONFLICT 9–11)
9. **Eyebrow/kicker above headings** (B4-04): mockup uses it; impeccable bans it. Proposal: drop it.
10. **Inset "recess" shadows** (B4-22, B5-20): render nothing on native. Proposal: `#F6F4EF` fill + hairline.
11. **Routine errors in red text** (B5-39, B4-17): Proposal: ink-2 copy; red dot only for payment/contract failures.

## §6 additions (PRs)
PR-00 Trust fixes (§1 #16): media-kit-view, media-kit-screen, privacy-sheet, affiliations-editor,
      photos-editor, edit-handle-sheet, (onboarding)/preferences. Behaviour + copy only, no restyle.
PR-03 also covers onboarding RoleCards (B4-34).
PR-19 AuthShell + onboarding moments (§1 #17, #18): auth-shell, onboarding-progress, verify-otp,
      done, signature (segmented control B4-51/52, keep pad mounted B4-53), signature-pad (B4-12/13).
PR-20 Platform/brand fills + no-photo hero (§1 #19): `PlatformTile`, platforms.tsx,
      platform-stat-card, media-kit-view hero. Pairs with PR-11.
PR-21 Grouped L0 settings list (§1 #20): preferences, privacy-sheet, maker-checker-config
      (plain-words rename B5-69, skeleton instead of null B5-70).
PR-22 Media-kit editors (§1 #21) + hero polish (§1 #22). After PR-04, PR-07, PR-16.
PR-23 Type-role + off-token sweep for auth/onboarding/media-kit (B4-21/32/57/58, B5-07/08/11/31).

## Run order (replaces the last line of §6)
PR-00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 12 → 13 → 14 → 16 → 08 → 09 → 23 → 17 → 18 → 19 →
21 → 22 → 15, then the decision-gated PR-10, 11, 20 once DECISIONS.md is filled in.
