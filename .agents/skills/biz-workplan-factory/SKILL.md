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
8. For an unclaimed `factory:ready` issue, spawn `workplan_manager` with `fork_turns="none"`, model `gpt-5.6-sol`, and High reasoning. Tell it to read `.codex/agents/workplan_manager.toml`, then give it a compact handoff containing only READY_REVIEW, repository path, issue number, current base commit, and required durable sources. It returns READY with `ticket_action: KEEP` when the detailed queue-authored body remains valid, or `ticket_action: REPLACE` plus one complete replacement title/body only when material drift requires it. It may narrow an unsafe packet but may not enlarge founder-released scope. For an existing `factory:building` issue, first evaluate the Usage-limit recovery fast path below. If it does not apply, spawn the same manager in RECOVERY_REVIEW mode and preserve the saved scope; return BLOCKED if the contract is unsafe or materially incomplete. Renew the lock after validation/review.
9. If blocked, comment with the evidence and one question when needed, replace the workflow label with `factory:blocked`, release the lock, and stop.
10. If an unclaimed issue is ready, replace its GitHub title/body only for `ticket_action: REPLACE`; for `KEEP`, verify the saved title/body and contract metadata without rewriting it. Re-read the saved issue and confirm every ticket-contract section and quality gate survived. Remove `factory:planned` if present, then claim it. Do not dispatch a builder from an abbreviated body or silently rewrite a recovered scope.

## Queue replenishment

1. List every open GitHub issue whose title begins `[Workplan`. An open planned, blocked, review, unlabeled, or otherwise waiting workplan issue means the queue has not run out: release the lock, report `Nothing ready: #<number> awaits founder/review/blocker`, and stop without creating another ticket.
2. Only when no open workplan issue exists, spawn the Sol High `workplan_manager` with no inherited history and use QUEUE_AUTHORING mode. It inspects current `main`, all open/closed workplan issues, merged pull requests, workplan/RTM evidence, specifications, code, migrations, and tests. It must return exactly one PLANNED packet or BLOCKED.
3. If BLOCKED because the next item is Waiting, Manual, Gate, Deferred gap, owner-only, or lacks evidence, release the lock and report the exact founder action or dependency. Do not create a coding issue to bypass the gate.
4. If PLANNED, verify the proposed title/body passes `factory/TICKET-CONTRACT.md` and that its workplan/RTM IDs are absent from every other open issue and completed merged scope.
5. Create exactly one GitHub issue atomically with the approved title/body and labels `enhancement` and `factory:planned`, plus `risk:high` when required. Never add `factory:ready` and never build the new ticket in the same run.
6. Re-read the created issue and verify its complete body and labels survived. If creation or verification is ambiguous, search by exact title/workplan IDs before retrying so a duplicate cannot be created.
7. Release the lock and report `Ticket prepared: #<number> — waiting for founder to add factory:ready`, then stop.

## Claim and implement

1. Replace `factory:ready` with `factory:building` only after readiness and the saved-ticket quality gate pass.
2. Reuse a safe existing branch or create `codex/workplan-<issue-number>-<short-slug>` from current `main`.
3. Record any material reversible decision in the issue and `docs/progress.md` before implementation.
4. Run `./scripts/setup-worktree.sh`, then `./scripts/factory-preflight.sh --require-integration-env` when the ticket names development-Supabase tests, otherwise `./scripts/factory-preflight.sh`. Fail before agent review if required environment or dependencies are unavailable; never print environment contents.
5. Spawn exactly one implementation agent with `fork_turns="none"` and the explicit model/High effort from `factory/PROJECT-CONFIG.md`: `builder` uses Terra; `senior_builder` uses Sol. Tell it to read its exact `.codex/agents/<role>.toml`. Its compact handoff contains the worktree path, issue number/URL, base commit, approved role, and required output—not the parent transcript. Never run concurrent writers in the worktree.
6. Keep the implementation agent available for the whole run. During initial implementation it obtains `./scripts/factory-affected-tests.sh --list <base-commit>`, forms the de-duplicated union with ticket-focused checks, and runs each command once per candidate state, but not the complete ticket regression set. Renew the lock immediately after it returns `IMPLEMENTATION_READY_FOR_REVIEW` or a genuine AGENTS.md blocker.

## Review and repair

1. Spawn `qa` with no inherited history and Terra High. Tell it to read `.codex/agents/qa.toml`, then give it a compact handoff containing the worktree, issue, base, changed-file list, focused command results, and required output. QA reviews the packet, relevant specifications, complete diff, and evidence. It may run targeted checks but must not replay the complete regression set.
2. When required, spawn `security_reviewer` with no inherited history and Sol High. Tell it to read `.codex/agents/security_reviewer.toml`, then give it the same compact evidence plus the named trust boundaries. Read-only QA/security reviews run in parallel.
3. Keep the handles for the implementation, QA, and security agents. Use the longest bounded wait supported by the active environment and do not poll repository status, interrogate an agent, or narrate unchanged waits. Send a follow-up only for completion, a blocker, a review finding, or a materially exceeded expected completion window.
4. If either review fails, send one consolidated correction request to the same implementation agent. After the repair's focused tests and affected-test floor pass, send only affected review scopes back to the same reviewers. Do not spawn `qa_repair` or `security_repair`. A non-quota replacement is allowed only when the original agent is genuinely unavailable and receives one compact recovery handoff.
5. Allow at most two implementation revisions. After the second failed revision, preserve the branch, comment with remaining findings and reproduction steps, replace `factory:building` with `factory:blocked`, and stop.
6. After every required reviewer returns PASS or an allowed LIMITED result, send `FINAL_REGRESSION` to the same implementation agent with the exact ticket-defined regression commands from `factory/PROJECT-CONFIG.md`. Run the complete set once on the final candidate state and record the source-state fingerprint and results. QA, security, and the orchestrator must rely on this evidence while that state remains unchanged.
7. If final regression fails, use the same implementation agent for the repair. Any code change invalidates the prior reviews and regression evidence: repeat only the affected reviews with the same reviewers, then run one new complete final regression on the new candidate state. Documentation-only evidence corrections do not invalidate code checks.
8. A named device, live-AI, Realtime, or external-service check may be recorded as LIMITED only when the packet says it belongs to founder review and the missing evidence does not invalidate the automated acceptance checks. Never invent evidence.

## Usage-limit recovery

1. An explicit Codex usage/rate-limit response is an infrastructure pause, not an implementation failure and not a reason to create replacement agents.
2. Stop promptly rather than waiting for the reset. Add one compact issue comment headed `FACTORY_RECOVERY_V1` containing the reason `usage_limit`, base commit, SHA-256 of the saved issue body, branch, worktree, changed files, completed evidence, unresolved findings, and exact next role/action. Never include secrets or raw environment output.
3. Keep the issue `factory:building`, preserve unpushed work in its isolated worktree, release the lock, and report the recovery path. Do not mark the issue blocked solely for quota exhaustion.
4. On the next run, if that recovery comment, branch/worktree, issue body, and base are unchanged and no safety/scope finding is open, use the compact recovery fast path: skip ticket re-authoring, validate the durable packet and resume only the named roles. Any drift, ambiguity, or material finding falls back to RECOVERY_REVIEW.

## Reconcile and prepare review

1. After all required reviews pass, invoke `$biz-wrap` to update `docs/progress.md` and only the RTM rows supported by evidence.
2. Verify that the recorded final-regression fingerprint still matches the candidate state. Do not replay its successful commands. Run only diff hygiene, secret review, and any documentation-only validation needed for shipping, then renew the factory lock.
3. Invoke `$biz-ship` to stage only the block files, create a conventional commit, and push the feature branch. Do not push unrelated work.
4. Open or update a draft pull request using every section in `factory/REVIEW-PACKET.md`. Start with a specific plain-language founder summary: explain what was built, what the user or system can now do, the main before/after difference, and two to five behaviours, limitations, or warning signs the founder should look out for. Keep the existing workplan/RTM links, criterion-level evidence, exact tests, review outcomes, migrations, decisions, risks, owner-review path, and safety statement. Include exactly one standalone `Closes #<issue-number>` line for the selected workplan issue; never reference an adjacent ticket with a closing keyword.
5. Re-read the draft PR and verify GitHub reports the selected issue in `closingIssuesReferences`. If not, repair the PR body before continuing. Then replace `factory:building` with `factory:review` and link the draft PR on the issue. The issue remains open until the founder merges the PR, when GitHub closes it automatically.
6. Release the factory lock with the original owner token, then stop. The founder reviews and decides whether to merge.

## Invariants

- GitHub issues, branches, comments, draft pull requests, CI, `docs/progress.md`, and `docs/rtm.md` are durable state; never rely on chat memory alone.
- Exactly one factory run may hold the repository-wide lock. Never work around a live lock or release a lock owned by another run.
- Process one block per run and one writer per worktree. Ticket creation is its own run and never starts implementation.
- After the current pre-created queue is exhausted, keep at most one automatically authored workplan issue open; never replenish it with a speculative batch. `factory:planned` means detailed and waiting for founder release, not ready to build.
- Use only verified Ready rows and the approved issue packet. Do not silently absorb adjacent RTM gaps.
- Role model routing is explicit: Workplan Manager, Senior Builder, and Security Reviewer use Sol High; Orchestrator, Builder, and QA use Terra High. Every role spawn uses no inherited conversation history and reads its exact `.codex/agents/<role>.toml`, so the requested model and role contract cannot be silently replaced by parent context.
- Migrations must be additive and non-destructive unless the founder explicitly approves otherwise.
- Development tests use realistic fictional data with safe cleanup; never use production or real private user/payment data.
- Never merge, deploy production, create accounts, enable billing, add or rotate secrets, expose private data, or perform destructive/irreversible operations without explicit founder approval.
- Do not return a completion message while required implementation, verification, documentation, commit, push, or draft-PR work remains unfinished.
