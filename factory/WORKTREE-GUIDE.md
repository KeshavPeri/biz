# Biz factory worktrees

## Default

Run every factory build block in a Codex-managed worktree based on current `main`. This keeps feature changes separate from the founder's local checkout and from other blocks.

## Setup

1. Create the worktree from current `main` in the Codex app.
2. Run `./scripts/setup-worktree.sh` or configure it as the project's worktree setup command.
3. Confirm `.env` and `frontend/.env` exist but remain ignored.
4. Confirm `git status` does not contain another block's changes.
5. Run the factory prompt from `factory/AUTOMATION-PROMPT.md`.

## Branch and queue rules

- One issue maps to one branch: `codex/workplan-<issue-number>-<short-slug>`.
- One code-writing agent owns the worktree.
- Do not check out the same feature branch in Local and a worktree simultaneously.
- Do not start a dependent block before its prerequisite PR is merged to `main` and the workplan map/issue state is reconciled.
- Serialize all development migrations and live integration tests.
- A crashed run leaves `factory:building`, the branch, comments, and draft PR as recovery evidence; the next run recovers it instead of claiming new work.

## Secret handling

`.worktreeinclude` copies the two existing ignored environment files so local development checks can run. They remain secrets:

- never print their contents;
- never stage or commit them;
- never copy them into issue comments, PR bodies, logs, screenshots, or generated artifacts;
- never use them against production;
- stop if either file appears in `git status`.

## Completion

The worktree is complete only after QA/security gates pass, docs are reconciled, the branch is pushed, a draft PR exists, and the issue is labelled `factory:review`. The founder decides whether to merge and when the worktree may be discarded.
