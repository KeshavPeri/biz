---
name: biz-workplan-factory
description: Build or recover exactly one founder-released Biz workplan ticket. Use when asked to run the Biz factory, build the next queued block, or process a factory:ready or factory:building issue. Ticket authoring belongs to the standing orchestrator and is not part of this skill.
---

# Biz Workplan Factory

Turn at most one founder-released GitHub workplan ticket into a tested draft pull request. The scheduled factory executes approved tickets; it never authors, expands, or quality-reviews them. The primary agent owns queue state and Git operations, while one builder owns implementation.

## Minimal preflight and selection

1. Change to `/Users/keshav/Projects/biz` and read `AGENTS.md`, this skill, `factory/PROJECT-CONFIG.md`, and the selected GitHub issue. Do not load the workplan, RTM, broad specifications, or implementation code before a ticket is selected.
2. Before any GitHub, branch, worktree, or queue action, create a unique owner token such as `biz-<UTC timestamp>-<process id>` and run `./scripts/factory-run-lock.sh acquire <owner-token>`. Keep the exact token for the whole run.
3. If acquisition exits 75 or prints `Factory already running`, report `Factory already running` and stop without touching GitHub, branches, worktrees, or queue labels. Never bypass or delete a live lock.
4. Once acquired, first recover the single open `factory:building` issue. If more than one exists, release the lock and stop with the conflicting issue numbers. If none is building, require exactly one open `factory:ready` issue. If none exists, release the lock and report `Nothing ready — prepare or release the next ticket in the standing orchestrator chat`. If more than one is ready, release the lock and ask the founder to release only one.
5. For a new ready issue, run `./scripts/factory-ticket-preflight.sh <issue-number>`. It checks the first-line `biz-factory-ticket:v2` execution metadata from `factory/TICKET-CONTRACT.md` and the following cheap invariants. This is not a ticket-quality review. Verify only:
   - the recorded base is the current 40-character `main` commit and local `main` matches GitHub `main`;
   - the recorded dependency is `none` or its issue was closed by a pull request merged into `main`;
   - the route and security fields contain permitted values;
   - no conflicting workflow label remains; and
   - no different factory issue, draft PR, branch, or worktree conflicts with this block.
6. Any base mismatch is possible repository drift. Do not inspect the ticket in depth, rewrite it, or spawn a planning agent. Add concise evidence, replace the workflow label with `factory:blocked`, release the lock, and report that the standing orchestrator must revalidate or revise the ticket against current `main`.
7. Do not verify ticket sections, wording, acceptance-detail quality, workplan completeness, or product assumptions. Those are the standing orchestrator's responsibility before it creates `factory:planned`, and the founder's release confirms that contract may build.
8. Renew the lock after implementation and before shipping. Release it on every clean terminal path. Release only with the same owner token; a crashed run becomes recoverable after the 18-hour stale timeout.

## Claim and implement

1. Replace `factory:ready` with `factory:building` only after the minimal checks pass. Never alter the issue title or body.
2. Reuse a safe existing branch or create `codex/workplan-<issue-number>-<short-slug>` from the verified `main` commit. Use an isolated worktree and preserve unrelated work. Never touch `Checklist_new_rows.xlsx`.
3. Run `./scripts/setup-worktree.sh`, then `./scripts/factory-preflight.sh --require-integration-env` when the ticket names development-Supabase tests, otherwise `./scripts/factory-preflight.sh`. Fail before agent review if required environment or dependencies are unavailable; never print environment contents.
4. Spawn exactly one implementation agent with `fork_turns="none"` and the route/model/High effort from the ticket metadata and `factory/PROJECT-CONFIG.md`: `builder` uses Terra; `senior_builder` uses Sol. Tell it to read its exact `.codex/agents/<role>.toml`. Its compact handoff contains the worktree path, issue number/URL, base commit, approved role, and required output—not the parent transcript. Never run concurrent writers in the worktree.
5. The builder reads the approved issue and only the relevant repository sources needed to implement it. It must not broaden the approved scope or absorb adjacent RTM gaps.
6. Keep the implementation agent available for the whole run. During initial implementation it obtains `./scripts/factory-affected-tests.sh --list <base-commit>`, forms the de-duplicated union with ticket-focused checks, and runs each command once per candidate state, but not the complete ticket regression set. Renew the lock immediately after it returns `IMPLEMENTATION_READY_FOR_REVIEW` or a genuine `AGENTS.md` blocker.

## Review and repair

1. Spawn `qa` with no inherited history and Terra High. Tell it to read `.codex/agents/qa.toml`, then give it the worktree, issue, base, changed-file list, focused results, and required output. QA reviews the approved ticket, relevant specifications, complete diff, and evidence. It may run targeted checks but must not replay the complete regression set.
2. When the ticket metadata says `security=required`, spawn `security_reviewer` with no inherited history and Sol High. Give it the same compact evidence plus the named trust boundaries. Read-only QA and security review may run in parallel.
3. Keep the same implementation, QA, and security agents for repairs. Send one consolidated correction request to the builder, then return only affected scopes to the same reviewers. A replacement is allowed only when an original agent is genuinely unavailable.
4. Allow at most two implementation revisions. After the second failed revision, preserve the branch, comment with remaining findings and reproduction steps, replace `factory:building` with `factory:blocked`, release the lock, and stop.
5. After required reviewers return PASS or an allowed LIMITED result, send `FINAL_REGRESSION` to the same implementation agent. It runs the complete ticket-defined regression once on the final candidate state and records the source-state fingerprint and results.
6. A code change invalidates prior reviews and regression evidence: repeat only affected reviews, then run one new complete final regression. Documentation-only evidence corrections do not invalidate code checks.
7. A named device, live-AI, Realtime, or external-service check may be LIMITED only when the ticket assigns it to founder review and the missing evidence does not invalidate automated acceptance. Never invent evidence.

## Usage-limit recovery

1. An explicit Codex usage/rate limit is an infrastructure pause, not an implementation failure. Stop instead of waiting or creating replacement agents.
2. Add one compact issue comment headed `FACTORY_RECOVERY_V1` containing `reason: usage_limit`, base commit, SHA-256 of the saved issue body, branch, worktree, changed files, completed evidence, unresolved findings, and exact next role/action. Never include secrets or raw environment output.
3. Keep the issue `factory:building`, preserve its isolated worktree, release the lock, and report the recovery path.
4. On the next run, if the recovery comment, branch/worktree, issue-body hash, and base remain unchanged and no safety finding is open, resume only the named remaining roles. Any mismatch is blocked for the standing orchestrator; do not perform a planning review inside the factory.

## Reconcile and prepare review

1. After all required reviews pass, invoke `$biz-wrap` to update `docs/progress.md` and only the RTM rows supported by evidence.
2. Verify the final-regression fingerprint still matches the candidate state. Do not replay successful commands. Run only diff hygiene, secret review, and documentation validation, then renew the lock.
3. Invoke `$biz-ship` to stage only block files, create a conventional commit, and push the feature branch. Do not push unrelated work.
4. Open or update a draft pull request using every section in `factory/REVIEW-PACKET.md`. Begin with the plain-language founder summary and retain acceptance evidence, exact tests, reviews, migrations, risks, owner review, and safety. Include exactly one standalone `Closes #<issue-number>` line.
5. Verify GitHub reports the issue in `closingIssuesReferences`. Then replace `factory:building` with `factory:review` and link the draft PR. The issue remains open until the founder merges it.
6. Release the factory lock with the original owner token and stop. The founder reviews and decides whether to merge.

## Invariants

- Ticket authoring and ticket-quality validation happen only in the standing orchestrator chat. The scheduled factory never creates a ticket and never spawns a Workplan Manager.
- The factory trusts only a founder-released ticket whose v2 execution metadata matches current `main`; mismatch stops safely for orchestrator revalidation.
- Exactly one factory run may hold the repository-wide lock, one block is processed per run, and one writer works in each worktree.
- Independent QA, required security review, the single final regression, migration serialization, isolated worktrees, founder release, and founder merge control remain mandatory.
- GitHub issues, branches, comments, draft pull requests, CI, `docs/progress.md`, and `docs/rtm.md` are durable state; never rely on chat memory alone.
- Migrations are additive and non-destructive unless the founder explicitly approves otherwise. Tests use fictional development data, never production or real private data.
- Never merge, deploy production, create accounts, enable billing, add or rotate secrets, expose private data, force-push, or perform destructive operations without explicit founder approval.
- Do not report completion while required implementation, verification, documentation, commit, push, or draft-PR work remains unfinished.
