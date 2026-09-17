# UI remediation — batch runbook

You (the agent) were pointed here with "run batch N". Do that batch, end to end, then stop.

## 0. Read first (nothing else up front)
1. `docs/ui-audit/REMEDIATION-PROGRESS.md` — find your batch. If its status is "in progress", resume from the first PR in it not marked done.
2. `docs/ui-audit/99-roadmap.md` + `docs/ui-audit/99-roadmap-addendum.md` — the PR descriptions for your batch only (§6), plus §2 motion kit / §3 glass recipe when your PRs use them.
3. `docs/ui-audit/DECISIONS.md` — all 11 are decided; follow them.
4. `docs/ui-audit/00-baseline.md` — tokens + checklist.
5. For each PR: grep the batch-N.md files for the finding IDs it resolves and read only those entries, then the source files it lists.
Do not open `.claude/skills/` unless a finding is unclear (then one reference file only).

## 1. Batches
| Batch | PRs | What it does |
|---|---|---|
| 1 | Setup, PR-00, PR-01, PR-02 | Commit audit docs + skills; trust bug fixes; delete template code; root layout, tab crossfade, gesture root |
| 2 | PR-03, PR-04, PR-05 | `useMotion` + `PressableScale`; rebuild `ui/button` + `GlassFlush`; move all hand-rolled buttons onto it |
| 3 | PR-06, PR-07 | Liquid Glass nav bar (`expo-glass-effect` + blur fallback) + `useTabBarInset`; `EditSheet` rebuild |
| 4 | PR-12, PR-13, PR-14, PR-16 | Skeleton loaders; stage-bar advance; win spring + haptics; list add/remove motion |
| 5 | PR-08, PR-09 | Type-role sweep: deal room, chat, discover, tabs |
| 6 | PR-23, PR-17, PR-18 | Type sweep auth/onboarding/media-kit; polish batch; detail-route header |
| 7 | PR-19, PR-21 | AuthShell + onboarding moments; grouped settings lists |
| 8 | PR-22 | Media-kit editors + hero polish |
| 9 | PR-10, PR-11, PR-20 | Red-tint sweep + neutral stage pills; off-palette sweep + chat bubble; `PlatformTile` + hero |
| 10 | PR-15 | Sticky action bar peek/expand (largest, alone) |

Batches depend on earlier ones. If an earlier batch is not "done" in REMEDIATION-PROGRESS.md, stop and say so.

## 2. Rules while building
- Skip Plan Mode. Don't ask questions. Make reasonable assumptions and write them in the session log.
- Locked design rules win: `docs/design-direction.md` → `docs/design-tokens.md` → `00-baseline.md`. Palette hex only, token radii/spacing, the 6 type roles, icons from `frontend/assets/icons/`.
- Touch only the files each PR lists plus the shared primitives it names. No backend, schema, API or deal-logic changes. Only behaviour changes a finding explicitly asks for.
- Only new dependency allowed in the whole programme: `expo-glass-effect` in batch 3, installed with `npx expo install expo-glass-effect`.
- Motion: reanimated 4 + expo-haptics only, via `useMotion()` so reduce-motion is honoured; timings from roadmap §2.
- When a decision adds a token (`sheet: 24`, `tail: 6`), add it to `frontend/tailwind.config.js` AND `docs/design-tokens.md` Part 2 in the same PR.

## 3. Git flow (keeps main working, locally and on GitHub)
Start of batch:
```
git checkout main
git pull origin main
git checkout -b ui/batch-N
```
(If resuming and `ui/batch-N` exists: `git checkout ui/batch-N` then `git pull origin ui/batch-N`.)

After EACH PR inside the batch:
1. From `frontend/`: `npx tsc --noEmit` and `npm run lint`. Fix what you broke.
2. Stage only the files you changed, by explicit path. Never `git add -A` or `git add .` (the repo root has unrelated untracked files that must not be committed). Never stage `.env`. Don't bypass the pre-commit hook.
3. Commit: `ui(PR-XX): <short summary>`.
4. `git push -u origin ui/batch-N` so work is safe on GitHub even if the session dies.
5. Mark that PR done in REMEDIATION-PROGRESS.md (with commit hash) and commit that file too.

## 4. End of batch: cleanup, verify, merge
1. Cleanup: remove unused imports/files your changes orphaned, no leftover `console.log`, no commented-out code, no TODOs you created.
2. Full checks, the same as CI (`.github/workflows/ci.yml` frontend job), from `frontend/`:
   `npx tsc --noEmit`, `npm run lint`, `npx expo export --platform web`, and `node --test tests/*.test.mjs`.
   (`frontend/dist` is gitignored; never force-add it.)
3. If any check fails and you cannot fix it inside this batch's scope: do NOT merge. Push the branch, set the batch to "blocked: <reason>" in REMEDIATION-PROGRESS.md, commit + push that, stop.
4. If all pass: update REMEDIATION-PROGRESS.md (batch "done", session log entry) and add one line under a "UI polish" heading in `docs/progress.md`. Commit and push.
5. Merge to main through GitHub:
   ```
   gh pr create --base main --head ui/batch-N --title "UI polish batch N" --body "<PRs done, checks run, anything deferred>"
   gh pr checks --watch
   gh pr merge --merge --delete-branch
   ```
   If CI fails on GitHub, fix on the branch, push, and watch again. If `gh` is not installed or not logged in, use:
   ```
   git checkout main
   git pull origin main
   git merge --no-ff ui/batch-N -m "Merge UI polish batch N"
   git push origin main
   ```
   Never force-push. Never rewrite history.
6. Sync local: `git checkout main`, `git pull origin main`, `git status` must show main up to date with origin. Delete the local branch: `git branch -d ui/batch-N`.
7. Final reply to Keshav, in plain words, max 6 lines: what changed on screen, checks passed, merged yes/no, and what to eyeball on his phone.

## 5. If you run low on context or usage
Stop at a PR boundary: commit and push what compiles, set the batch to "in progress" with exactly what remains, commit + push REMEDIATION-PROGRESS.md, and end. Never merge a half-finished batch.
