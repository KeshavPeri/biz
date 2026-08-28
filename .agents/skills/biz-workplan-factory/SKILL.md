---
name: biz-workplan-factory
description: Process the next ready Biz workplan build block or, when the workplan issue queue is empty, prepare exactly one fresh planned ticket. Use when asked to run the Biz factory, build the next queued block, replenish the queue, or process a factory:ready issue. Do not use for manual phase gates, production deployment, owner-only actions, or open-ended product design.
---

# Biz Workplan Factory

Turn at most one reviewed GitHub workplan issue into a tested draft pull request, or prepare exactly one future ticket when no open workplan issue remains. The primary agent is the orchestrator and is the only role that changes GitHub workflow state or manages Git.

## Preflight and selection

1. Change to the primary checkout at `/Users/keshav/Projects/biz`, then read `AGENTS.md`, `factory/WORKPLAN-MAP.md`, `factory/BUNDLING-RULES.md`, `factory/TICKET-CONTRACT.md`, and `factory/PROJECT-CONFIG.md`.
2. Before any GitHub, branch, worktree, or queue action, create a unique owner token such as `biz-<UTC timestamp>-<process id>` and run `./scripts/factory-run-lock.sh acquire <owner-token>`. Keep the exact token for the whole run.
3. If acquisition exits 75 or prints `Factory already running`, report `Factory already running` and stop without touching GitHub, branches, worktrees, or queue labels. Never bypass or delete a live lock.
4. Once acquired, renew the lock after readiness review, after implementation, and before shipping. Release it on every clean terminal path, including `Nothing ready`, BLOCKED, and successful draft-PR completion. Release only with the same owner token. A crashed run becomes recoverable after the lock's 18-hour stale timeout.
5. Before broad code exploration, check GitHub for an open `factory:building` issue. Recover its existing branch or draft PR when safe; do not claim a second block while recoverable work exists.
6. If nothing is building, select the oldest open `factory:ready` issue. If none exists, follow **Queue replenishment** below; do not explore implementation code first.
7. Confirm the checkout is an isolated worktree or feature branch and preserve all unrelated work. Never touch `Checklist_new_rows.xlsx`.
8. For an unclaimed `factory:ready` issue, ask `workplan_manager` in READY_REVIEW mode to re-author and validate it against current repository evidence and return READY or BLOCKED. It may narrow an unsafe packet but may not enlarge approved scope. A READY response must contain a complete, prescriptive GitHub title and body that pass `factory/TICKET-CONTRACT.md`, not a summary. For recovery of an existing `factory:building` issue, use RECOVERY_REVIEW mode and validate the saved packet and recovery evidence without changing scope; return BLOCKED if the original contract is unsafe or materially incomplete. Renew the lock after this review.
9. If blocked, comment with the evidence and one question when needed, replace the workflow label with `factory:blocked`, release the lock, and stop.
10. If an unclaimed issue is ready, replace its GitHub title/body with the approved packet before claiming it. Re-read the saved issue and confirm every ticket-contract section and quality gate survived the update. Remove `factory:planned` if present, then claim it. Do not dispatch a builder from an older or abbreviated body, and do not silently rewrite the scope of a recovered building issue.

## Queue replenishment

1. List every open GitHub issue whose title begins `[Workplan`. An open planned, blocked, review, unlabeled, or otherwise waiting workplan issue means the queue has not run out: release the lock, report `Nothing ready: #<number> awaits founder/review/blocker`, and stop without creating another ticket.
2. Only when no open workplan issue exists, ask the Sol High `workplan_manager` in QUEUE_AUTHORING mode to inspect current `main`, all open/closed workplan issues, merged pull requests, workplan/RTM evidence, specifications, code, migrations, and tests. It must return exactly one PLANNED packet or BLOCKED.
3. If BLOCKED because the next item is Waiting, Manual, Gate, Deferred gap, owner-only, or lacks evidence, release the lock and report the exact founder action or dependency. Do not create a coding issue to bypass the gate.
4. If PLANNED, verify the proposed title/body passes `factory/TICKET-CONTRACT.md` and that its workplan/RTM IDs are absent from every other open issue and completed merged scope.
5. Create exactly one GitHub issue atomically with the approved title/body and labels `enhancement` and `factory:planned`, plus `risk:high` when required. Never add `factory:ready` and never build the new ticket in the same run.
6. Re-read the created issue and verify its complete body and labels survived. If creation or verification is ambiguous, search by exact title/workplan IDs before retrying so a duplicate cannot be created.
7. Release the lock and report `Ticket prepared: #<number> — waiting for founder to add factory:ready`, then stop.

## Claim and implement

1. Replace `factory:ready` with `factory:building` only after readiness and the saved-ticket quality gate pass.
2. Reuse a safe existing branch or create `codex/workplan-<issue-number>-<short-slug>` from current `main`.
3. Record any material reversible decision in the issue and `docs/progress.md` before implementation.
4. Spawn exactly one implementation agent named by the approved packet: `builder` for routine work or `senior_builder` for high-risk work. Never run concurrent writers in the worktree.
5. Keep the implementation agent available for the whole run. During initial implementation it runs focused acceptance checks and cheap compile/type/diff gates, but not the complete ticket regression set. Renew the factory lock immediately after it returns `IMPLEMENTATION_READY_FOR_REVIEW` or a genuine AGENTS.md blocker.

## Review and repair

1. Ask `qa` to review the packet, specifications, complete diff, and focused test evidence. QA may run targeted checks needed to validate a criterion or finding, but must not replay the complete regression set.
2. When the packet requires security review, ask `security_reviewer` for an independent pass under the same targeted-check rule. Read-only reviews may run in parallel.
3. Keep the handles for the implementation, QA, and security agents. Use the longest bounded wait supported by the active environment and do not poll repository status, interrogate an agent, or narrate unchanged waits. Send a follow-up only for completion, a blocker, a review finding, or a materially exceeded expected completion window.
4. If either review fails, send one consolidated correction request to the same implementation agent. After the repair's focused tests pass, send the affected review back to the same QA and security agents; do not spawn `qa_repair` or `security_repair`. A replacement is allowed only if the original agent failed or is unavailable, and the final report must say so.
5. Allow at most two implementation revisions. After the second failed revision, preserve the branch, comment with remaining findings and reproduction steps, replace `factory:building` with `factory:blocked`, and stop.
6. After every required reviewer returns PASS or an allowed LIMITED result, send `FINAL_REGRESSION` to the same implementation agent with the exact ticket-defined regression commands from `factory/PROJECT-CONFIG.md`. Run the complete set once on the final candidate state and record the source-state fingerprint and results. QA, security, and the orchestrator must rely on this evidence while that state remains unchanged.
7. If final regression fails, use the same implementation agent for the repair. Any code change invalidates the prior reviews and regression evidence: repeat only the affected reviews with the same reviewers, then run one new complete final regression on the new candidate state. Documentation-only evidence corrections do not invalidate code checks.
8. A named device, live-AI, Realtime, or external-service check may be recorded as LIMITED only when the packet says it belongs to founder review and the missing evidence does not invalidate the automated acceptance checks. Never invent evidence.

## Reconcile and prepare review

1. After all required reviews pass, invoke `$biz-wrap` to update `docs/progress.md` and only the RTM rows supported by evidence.
2. Verify that the recorded final-regression fingerprint still matches the candidate state. Do not replay its successful commands. Run only diff hygiene, secret review, and any documentation-only validation needed for shipping, then renew the factory lock.
3. Invoke `$biz-ship` to stage only the block files, create a conventional commit, and push the feature branch. Do not push unrelated work.
4. Open or update a draft pull request using `factory/REVIEW-PACKET.md`. Link the workplan and RTM IDs, exact tests, review outcomes, limitations, risks, and the shortest owner review path. Include exactly one standalone `Closes #<issue-number>` line for the selected workplan issue; never reference an adjacent ticket with a closing keyword.
5. Re-read the draft PR and verify GitHub reports the selected issue in `closingIssuesReferences`. If not, repair the PR body before continuing. Then replace `factory:building` with `factory:review` and link the draft PR on the issue. The issue remains open until the founder merges the PR, when GitHub closes it automatically.
6. Release the factory lock with the original owner token, then stop. The founder reviews and decides whether to merge.

## Invariants

- GitHub issues, branches, comments, draft pull requests, CI, `docs/progress.md`, and `docs/rtm.md` are durable state; never rely on chat memory alone.
- Exactly one factory run may hold the repository-wide lock. Never work around a live lock or release a lock owned by another run.
- Process one block per run and one writer per worktree. Ticket creation is its own run and never starts implementation.
- After the current pre-created queue is exhausted, keep at most one automatically authored workplan issue open; never replenish it with a speculative batch. `factory:planned` means detailed and waiting for founder release, not ready to build.
- Use only verified Ready rows and the approved issue packet. Do not silently absorb adjacent RTM gaps.
- Migrations must be additive and non-destructive unless the founder explicitly approves otherwise.
- Development tests use realistic fictional data with safe cleanup; never use production or real private user/payment data.
- Never merge, deploy production, create accounts, enable billing, add or rotate secrets, expose private data, or perform destructive/irreversible operations without explicit founder approval.
- Do not return a completion message while required implementation, verification, documentation, commit, push, or draft-PR work remains unfinished.
