# UI remediation — progress

Runbook: REMEDIATION-PROMPT.md. One branch per batch (`ui/batch-N`), one commit per PR, merged to main at batch end.
Status values: todo · in progress · done · blocked (reason).

| Batch | PR | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Setup: commit docs/ui-audit + .claude/skills | done | 4b87e0b | |
| 1 | PR-00 Trust fixes | done | ab5d530 | |
| 1 | PR-01 Delete template code | done | ded94f2 | |
| 1 | PR-02 Root layout, tab crossfade, gesture root | done | bfb9d2b | |
| 2 | PR-03 useMotion + PressableScale | todo | | |
| 2 | PR-04 Rebuild ui/button + GlassFlush | todo | | |
| 2 | PR-05 Migrate hand-rolled buttons | todo | | |
| 3 | PR-06 Liquid Glass nav + useTabBarInset | todo | | decision 4 |
| 3 | PR-07 EditSheet rebuild | todo | | decision 2 |
| 4 | PR-12 Skeleton | todo | | |
| 4 | PR-13 StageAdvance | todo | | |
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
| 1 | done | pending merge |
| 2 | todo | |
| 3 | todo | |
| 4 | todo | |
| 5 | todo | |
| 6 | todo | |
| 7 | todo | |
| 8 | todo | |
| 9 | todo | |
| 10 | todo | |

## Session log
(append: date · model · batch · PRs · checks · merged? · deferred)
- 2026-09-17 · Claude Sonnet 5 · batch 1 · Setup, PR-00, PR-01, PR-02 · tsc/lint/web-export/node-tests all pass · merging to main · nothing deferred. Assumption: PR-00's "Continue onboarding" routes to `/(onboarding)/role` since onboarding has no server-side resume point (profile writes only happen at `done.tsx`); B5-17's `fetchOwnMediaKit` was widened to a status-tagged result (`ok`/`not_onboarded`/`error`) even though `lib/media-kit.ts` isn't in PR-00's file list, because it's the shared primitive the finding is about and the screen fix is meaningless without it.
