---
name: biz-workplan-factory
description: Process the next ready Biz workplan build block through readiness review, one implementation agent, independent QA and conditional security review, documentation, and a draft pull request. Use when asked to run the Biz factory, build the next queued block, or process a factory:ready issue. Do not use for manual phase gates, production deployment, owner-only actions, or open-ended product design.
---

# Biz Workplan Factory

Turn at most one reviewed GitHub workplan issue into a tested draft pull request. The primary agent is the orchestrator and is the only role that changes GitHub workflow state or manages Git.

## Preflight and selection

1. Read `AGENTS.md`, `factory/WORKPLAN-MAP.md`, `factory/BUNDLING-RULES.md`, and `factory/PROJECT-CONFIG.md`.
2. Before broad code exploration, check GitHub for an open `factory:building` issue. Recover its existing branch or draft PR when safe; do not claim a second block while recoverable work exists.
3. If nothing is building, select the oldest open `factory:ready` issue. If none exists, report `Nothing ready` and stop cheaply.
4. Confirm the checkout is an isolated worktree or feature branch and preserve all unrelated work. Never touch `Checklist_new_rows.xlsx`.
5. Ask `workplan_manager` to validate the issue against current repository evidence and return READY or BLOCKED. It may narrow an unsafe packet but may not enlarge approved scope.
6. If blocked, comment with the evidence and one question when needed, replace the workflow label with `factory:blocked`, and stop.

## Claim and implement

1. Replace `factory:ready` with `factory:building` only after readiness passes.
2. Reuse a safe existing branch or create `codex/workplan-<issue-number>-<short-slug>` from current `main`.
3. Record any material reversible decision in the issue and `docs/progress.md` before implementation.
4. Spawn exactly one implementation agent named by the approved packet: `builder` for routine work or `senior_builder` for high-risk work. Never run concurrent writers in the worktree.
5. Keep the implementation agent working until every acceptance item has evidence or it returns a genuine AGENTS.md blocker.

## Review and repair

1. Ask `qa` to review the packet, specifications, complete diff, and test evidence.
2. When the packet requires security review, also ask `security_reviewer` for an independent pass. Read-only reviews may run in parallel.
3. If either review fails, send one consolidated, concrete correction request to the same implementation agent, then repeat every required review.
4. Allow at most two implementation revisions. After the second failed revision, preserve the branch, comment with remaining findings and reproduction steps, replace `factory:building` with `factory:blocked`, and stop.
5. A named device, live-AI, Realtime, or external-service check may be recorded as LIMITED only when the packet says it belongs to founder review and the missing evidence does not invalidate the automated acceptance checks. Never invent evidence.

## Reconcile and prepare review

1. After all required reviews pass, invoke `$biz-wrap` to update `docs/progress.md` and only the RTM rows supported by evidence.
2. Run the required commands from `factory/PROJECT-CONFIG.md`, inspect the final diff, and scan intended files for secrets.
3. Invoke `$biz-ship` to stage only the block files, create a conventional commit, and push the feature branch. Do not push unrelated work.
4. Open or update a draft pull request using `factory/REVIEW-PACKET.md`. Link the workplan and RTM IDs, exact tests, review outcomes, limitations, risks, and the shortest owner review path.
5. Replace `factory:building` with `factory:review` and link the draft PR on the issue.
6. Stop. The founder reviews and decides whether to merge.

## Invariants

- GitHub issues, branches, comments, draft pull requests, CI, `docs/progress.md`, and `docs/rtm.md` are durable state; never rely on chat memory alone.
- Process one block per run and one writer per worktree.
- Use only verified Ready rows and the approved issue packet. Do not silently absorb adjacent RTM gaps.
- Migrations must be additive and non-destructive unless the founder explicitly approves otherwise.
- Development tests use realistic fictional data with safe cleanup; never use production or real private user/payment data.
- Never merge, deploy production, create accounts, enable billing, add or rotate secrets, expose private data, or perform destructive/irreversible operations without explicit founder approval.
- Do not return a completion message while required implementation, verification, documentation, commit, push, or draft-PR work remains unfinished.
