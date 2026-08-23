---
name: biz-ship
description: Safely commit and push completed Biz repository work when the user asks to ship, commit, push, or save the current build to GitHub. Reviews scope, excludes unrelated files and secrets, runs relevant checks, creates a conventional commit, and pushes the current branch.
---

# Ship Biz Work

1. Inspect `git status`, the diff, and the current branch. Separate files belonging to the completed task from pre-existing or unrelated changes.
2. Check intended files for credentials or private data. Never stage `.env`, secret files, generated credentials, or unrelated untracked files. If a secret is present, stop and explain it.
3. Run the checks relevant to the changed area, or confirm that equivalent checks were completed after the last edit. Do not bypass a failed check; fix in-scope failures or report the blocker.
4. Stage only the intended task files using explicit paths. Review the staged diff and staged file list.
5. Commit with a concise conventional-commit message that describes the actual change. Do not amend or rewrite history unless the user explicitly requests it.
6. Push the current branch normally. Never force-push and never bypass hooks.
7. Report the commit hash, message, branch, checks, and whether the push succeeded in a short plain-language summary.
