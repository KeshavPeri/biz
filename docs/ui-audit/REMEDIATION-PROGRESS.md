# UI remediation — progress

Runbook: REMEDIATION-PROMPT.md. One branch per batch (`ui/batch-N`), one commit per PR, merged to main at batch end.
Status values: todo · in progress · done · blocked (reason).

| Batch | PR | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Setup: commit docs/ui-audit + .claude/skills | done | 4b87e0b | |
| 1 | PR-00 Trust fixes | done | ab5d530 | |
| 1 | PR-01 Delete template code | done | ded94f2 | |
| 1 | PR-02 Root layout, tab crossfade, gesture root | done | bfb9d2b | |
| 2 | PR-03 useMotion + PressableScale | done | 09023b7 | also B4-34 role cards |
| 2 | PR-04 Rebuild ui/button + GlassFlush | done | 52058f5 | callers remapped lg→md, xl→lg (same heights); ButtonIcon dropped (unused) |
| 2 | PR-05 Migrate hand-rolled buttons | done | 0902816 | all labelled action buttons in deal/* (not just the named helpers); rows/chips/star pickers left for later PRs |
| 3 | PR-06 Liquid Glass nav + useTabBarInset | done | 89e5419 | decision 4; Chat dot bound to real unread (ink, like the inbox badge) |
| 3 | PR-07 EditSheet rebuild | done | 8837d1e | decision 2; `sheet: 24` in tailwind only — docs/design-tokens.md is read-only on disk, line still to add (see session log) |
| 4 | PR-12 Skeleton | done | a2724c8 | Skeleton.CardGrid columns fixed at 2 in discover-screen (accountType unknown while loading, so isBrand can't gate columns yet) |
| 4 | PR-13 StageAdvance | done | d323a73 | success haptic added only to Accept/Generate contract/approved terms decision/Confirm posts — Sign and Confirm close excluded (WinSpring owns their haptic in PR-14); Decline and dispute submit excluded (not wins) |
| 4 | PR-14 WinSpring | todo | | decision 6 |
| 4 | PR-16 ListItemFade | todo | | |
| 5 | PR-08 Type sweep deal/* | todo | | |
| 5 | PR-09 Type sweep chat/discovery/tabs | todo | | |
| 6 | PR-23 Type sweep auth/onboarding/media-kit | todo | | |
| 6 | PR-17 Polish batch | todo | | decisions 1, 11 |
| 6 | PR-18 Detail-route header | todo | | |
| 7 | PR-19 AuthShell + onboarding moments | todo | | decision 9 |
| 7 | PR-21 Grouped settings lists | todo | | decision 10 |
| 8 | PR-22 Media-kit editors + hero | todo | | |
| 9 | PR-10 Red-tint sweep + stage pills | todo | | decisions 3, 5 |
| 9 | PR-11 Off-palette sweep + chat bubble | todo | | decisions 7, 8 |
| 9 | PR-20 PlatformTile + hero | todo | | |
| 10 | PR-15 Sticky action bar peek/expand | todo | | |

## Batch status
| Batch | Status | Merged to main |
|---|---|---|
| 1 | done | yes (PR #48) |
| 2 | done | yes (PR #49) |
| 3 | done | yes (PR #50) |
| 4 | in progress | |
| 5 | todo | |
| 6 | todo | |
| 7 | todo | |
| 8 | todo | |
| 9 | todo | |
| 10 | todo | |

## Session log
(append: date · model · batch · PRs · checks · merged? · deferred)
- 2026-09-17 · Claude Sonnet 5 · batch 1 · Setup, PR-00, PR-01, PR-02 · tsc/lint/web-export/node-tests all pass · merging to main · nothing deferred. Assumption: PR-00's "Continue onboarding" routes to `/(onboarding)/role` since onboarding has no server-side resume point (profile writes only happen at `done.tsx`); B5-17's `fetchOwnMediaKit` was widened to a status-tagged result (`ok`/`not_onboarded`/`error`) even though `lib/media-kit.ts` isn't in PR-00's file list, because it's the shared primitive the finding is about and the screen fix is meaningless without it.
- 2026-09-17 · Claude Opus 5 · batch 2 · PR-03, PR-04, PR-05 · tsc/lint (3 old warnings)/web-export/node-tests all pass, buttons checked in headless Chromium on web · merging to main · deferred: chip 44pt + type role (PR-17), deliverables one-primary + overflow (PR-15), star/role/candidate selection pills and label-sheet "Remove"/suggestion pills (not buttons; PR-10/17). Assumptions: `PressableScale` is registered with NativeWind so class styles arrive as a separate prop and are merged with the animated style by hand (NativeWind's own merge flattens and breaks reanimated styles); under reduce-motion the press keeps only the opacity dip. `ui/button` uses plain class maps instead of `tva` (tailwind-merge drops `text-body` as a colour clash); `variant`/`ButtonIcon`/xs/sm/xl removed, existing callers remapped lg→md and xl→lg (same heights). PR-05 kept the per-file helper names (now thin `ui/button` wrappers) to keep diffs small; two-up buttons use `px-3` so labels fit, payment-tracking pairs stack. Dispute "View dispute" = secondary + small red dot (decision 3/11). Hard-coded `ButtonSpinner` colours removed app-wide since the spinner now follows the tier and white vanished on the disabled fill.
- 2026-09-17 · Claude Opus 5 · batch 3 · PR-06, PR-07 · tsc/lint (3 old warnings)/web-export/node-tests all pass; exported web app loads cleanly in headless Chromium (signed-out; nav and sheets not viewable without a login) · merging to main · deferred: `sheet: 24` line in docs/design-tokens.md — the file is read-only on disk (`r--------`), so it was not force-edited; flagged in docs/progress.md NEEDS MY INPUT. Moving the inline brief/payment editors into sheets (B2-43/47) and the label-sheet input (B3-22) are left to PR-15/PR-17. Assumptions: the Chat dot uses the same RLS read as the inbox (`fetchMyDealPreviews`) and refetches on every tab change and when the tab shell regains focus (4 small queries, fine for the MVP seed); the dot is ink like the inbox unread badge (green is only for "good"). With Liquid Glass on, the bar is the native GlassView alone (no warm overlay/highlight), and the pill uses GlassView too. `useTabBarInset` = 10 + 60 + max(safe bottom, 12), exact because the tab label never scales. EditSheet drives motion with shared values rather than entering/exiting presets so the drag and the exit share one path; a drag that the parent refuses (busy guards) snaps back after 50ms. Sheets that callers mount conditionally still animate in but unmount without the exit. Keyboard avoidance is iOS-only (Android Modal resizes itself).
