# Biz Workplan Factory: How It Works and User Guide

This guide explains the Biz/Inflo autonomous build system in plain language. It separates the steps the founder must perform from the work handled automatically by Codex and GitHub.

## The short version

1. **The factory prepares the next detailed ticket automatically** when no open workplan ticket remains.
2. **You decide when that ticket may start** by replacing `factory:planned` with `factory:ready`.
3. **The factory builds one ticket automatically** and produces a tested draft pull request.
4. **You review and merge the pull request.** The factory never merges for you.
5. **GitHub closes the ticket automatically**; an existing planned successor waits, or the next run prepares one when the queue is empty.

The normal state flow is:

`factory:planned` → `factory:ready` → `factory:building` → `factory:review` → **Merged PR / Closed issue**

If the factory cannot proceed safely:

`factory:ready` or `factory:building` → `factory:blocked`

Each scheduled run starts independently, so the system rebuilds its understanding from GitHub, the repository, specifications, and durable evidence rather than relying on an earlier chat's memory.

## Responsibilities at a glance

| Stage | What you do | What happens automatically |
|---|---|---|
| Prepare the next block | Nothing | When no open workplan issue remains, Sol High authors exactly one current, detailed `factory:planned` ticket |
| Release the next block | Confirm its dependency is satisfied, replace `factory:planned` with `factory:ready` | Nothing starts before you apply `factory:ready` |
| Scheduled start | Keep the Mac powered on and the ChatGPT desktop app running | The factory checks the queue at the next scheduled time |
| Ticket preparation | Nothing | Sol High inspects the current code and rewrites the ticket into a prescriptive build contract |
| Build | Nothing unless a blocker requires a founder decision | The factory creates an isolated worktree and assigns one appropriate builder |
| Verification | Nothing for automated checks | QA runs independently; security review is added for high-risk work; failed checks receive up to two repair rounds |
| Draft pull request | Nothing | The branch is committed, pushed, and opened as a draft PR with evidence and `Closes #<ticket>` |
| Founder review | Review the PR and perform any named manual checks | CI and recorded automated evidence remain available in GitHub |
| Completion | Convert the draft when needed and merge it | GitHub closes the linked issue automatically |
| Continue | Add `factory:ready` to the next ticket when you are comfortable | The next scheduled run starts the next block |

## Current schedule

The `biz-workplan-factory` scheduled task runs every day at these Singapore times:

- 12:30 AM
- 9:30 AM
- 2:30 PM
- 7:30 PM

Each run processes **at most one build block**.

This is a local-project automation. The Mac must be powered on, the ChatGPT desktop app must be running, and the repository must remain available at `/Users/keshav/Projects/biz`. Closing the Mac lid normally puts it to sleep, so do not rely on a run occurring with the lid closed unless the Mac is deliberately configured to remain awake. If a run is missed, use **Run now** in Scheduled or wait for the next scheduled time.

## Your step-by-step operating process

### Step 1: Confirm the previous block is complete

Before releasing another ticket:

1. Confirm the previous pull request has been merged into `main`.
2. Confirm its GitHub issue is closed.
3. Read any limitation or manual-check note in the merged PR.
4. Do not release a dependent ticket while the previous PR is still open or unmerged.

This is your main safety gate. The factory deliberately does not choose when to begin dependent work.

### Step 2: Mark exactly one ticket ready

In GitHub:

1. Open the Biz repository: <https://github.com/KeshavPeri/biz>.
2. Open **Issues**.
3. Open the next workplan ticket.
4. Confirm its stated dependency is merged.
5. Remove `factory:planned` if present.
6. Add the label `factory:ready`.
7. Leave later dependent tickets unreleased.

Recommended rule: mark only one ticket `factory:ready` at a time. The factory can select the oldest ready issue, but releasing one at a time keeps your intent unambiguous.

### Ticket creation versus ticket preparation

Once an existing issue receives `factory:ready`, the Sol High Workplan Manager rechecks and, when needed, rewrites it into a detailed, code-aware build contract before implementation begins.

When the final open workplan ticket closes, the next scheduled run asks the Sol High Workplan Manager to inspect current code, specifications, workplan/RTM evidence, and all issue/PR history. It creates exactly one fresh `factory:planned` ticket and stops; it never marks that ticket ready or builds it in the same run.

If the next honest step is a manual test, phase gate, waiting dependency, deferred gap, or owner decision, the factory creates no coding ticket and reports the exact action needed. It never skips a gate merely to keep coding.

### Step 3: Keep the local runner available

Before the next scheduled time:

1. Keep the Mac powered on and awake.
2. Keep the ChatGPT desktop app running.
3. Keep `/Users/keshav/Projects/biz` available on disk.
4. Do not move, rename, or delete the repository.

You do not need to keep this chat open.

### Step 4: Let the factory run

No founder action is normally required during the build. The factory will:

1. Acquire the repository-wide lock.
2. Recover an interrupted `factory:building` ticket before considering new work.
3. Otherwise select the oldest open `factory:ready` ticket.
4. If there is no building or ready ticket, either wait on an existing planned/review/blocked workplan ticket or prepare one new `factory:planned` ticket when none remains, then stop.
5. For a ready ticket, ask the Sol High Workplan Manager to inspect current code, specifications, migrations, tests, dependencies, and recent history.
6. Rewrite and save a detailed GitHub ticket that passes the ticket quality contract.
7. Change the ticket from `factory:ready` to `factory:building`.
8. Create an isolated feature branch/worktree based on current `origin/main`.
9. Route the implementation to one builder.
10. Run independent QA and any required security review.
11. Allow up to two focused repair rounds if a review fails.
12. Update progress and RTM evidence.
13. Commit and push the feature branch.
14. Create or update a draft PR containing `Closes #<ticket-number>`.
15. Verify that GitHub recognizes the closing link.
16. Change the issue to `factory:review` and report the PR URL.

### Step 5: Review the draft pull request

When the factory reports that a PR is ready:

1. Open the PR URL from the scheduled-run report.
2. Read these PR sections:
   - Outcome
   - Acceptance evidence
   - Verification
   - Migrations and data
   - Decisions and risks
   - Owner review
   - Safety
3. Confirm all GitHub checks are green.
4. Open **Files changed** and scan the scope. It should match one ticket and should not contain unrelated files.
5. Perform every manual founder check named in **Owner review**. Examples may include a phone flow, live Gemini smoke, Realtime behavior, or an external-service check.
6. Review every `LIMITED` item and decide whether the stated limitation is acceptable before merging.

The factory has already performed detailed automated and independent review, but you remain the final product and release decision-maker.

### Step 6A: If the PR is acceptable

1. If GitHub still shows it as a draft, click **Ready for review**.
2. Merge it using the repository's normal merge option.
3. Confirm the linked issue closes automatically.
4. Do not manually reopen or relabel the completed ticket unless the merge was reverted or the evidence was materially wrong.

The PR contains `Closes #<ticket-number>`, so GitHub closes the issue only when the PR reaches the default branch. Opening the draft PR does not close it.

### Step 6B: If the PR needs an in-scope correction

For a correction already covered by the ticket:

1. Add a precise PR comment explaining the failed behavior and expected result.
2. Remove `factory:review` from the linked issue.
3. Add `factory:building` to that issue.
4. Do not merge the PR.
5. The next scheduled factory run will recover the existing issue, branch, worktree, and draft PR instead of starting a new ticket.

For a new product decision or material scope change, do not relabel the ticket automatically. Bring the dilemma to the orchestrator chat so the ticket and workplan can be revised safely first.

### Step 7: Release the next ticket

After the PR is merged and its issue is closed:

1. Open the existing next `factory:planned` ticket. If none exists, the next scheduled run prepares one when no open workplan ticket remains.
2. Confirm the ticket's dependency is satisfied.
3. Replace `factory:planned` with `factory:ready` when you want work to begin.
4. Repeat the cycle.

There is no need to rush this step. Leaving all tickets without `factory:ready` safely pauses feature development while the scheduled task remains active.

## What each label means

| Label | Meaning | Your normal action |
|---|---|---|
| `factory:planned` | Detailed ticket prepared but not released | Confirm its dependency, then replace this label with `factory:ready` when you want it built |
| No factory label | Legacy or manually created issue with no workflow state | Do not release it until its scope and dependency are clear |
| `factory:ready` | Founder has released the ticket | Wait for the next run |
| `factory:building` | Work is active or recoverable | Do not start another dependent ticket |
| `factory:review` | Draft PR and automated evidence are ready | Review, test, and decide whether to merge |
| `factory:blocked` | The factory found a dependency, safety, evidence, or decision blocker | Read the issue comment and resolve the named blocker |
| Closed issue | Its linked PR was merged or the issue was deliberately closed | Release the next dependency when ready |

## What the agents do

### Main orchestrator — Terra High

Owns the run, lock, issue selection, labels, worktree, branch, commits, push, PR, recovery, and final report. It does not normally write feature code.

### Workplan Manager — Sol High, read-only

Turns the selected workplan block into the detailed GitHub ticket. It inspects real repository evidence and defines context, scope, exclusions, risks, likely files, silent-failure traps, numbered acceptance criteria, and exact verification. It returns `BLOCKED` instead of guessing a material product or architecture decision.

### Builder — Terra High

Implements routine, tightly specified work using established architecture.

### Senior Builder — Sol High

Implements high-risk work involving migrations, RLS/RBAC, AI contracts, authentication, contracts, signatures, payments, concurrency, state transitions, or broad cross-stack changes.

### QA — Terra High, read-only

Independently checks the completed diff and evidence against every ticket criterion. QA does not edit the implementation.

### Security Reviewer — Sol High, read-only

Reviews high-risk trust boundaries, authorization, RLS/grants, secrets, AI output handling, concurrency, auditability, and data safety.

Only one implementation agent writes code for a ticket. Review agents are separate so the builder does not grade its own work.

To control usage without weakening review, the factory reuses those same agents after repairs. The builder runs focused checks before review and one complete ticket-defined regression pass after review on the final code. QA and security run targeted validation instead of independently repeating the whole suite, and the orchestrator reuses the recorded final evidence while the code remains unchanged.

## Safety and concurrency controls

- A shared atomic lock allows only one factory run to operate on the repository at a time.
- An overlapping run reports `Factory already running` and exits without touching GitHub or the codebase.
- An abandoned lock becomes recoverable after 18 hours.
- Each ticket uses one isolated branch/worktree and one code-writing agent.
- The factory processes one workplan block per run.
- Development migrations and integration tests are serialized.
- `Checklist_new_rows.xlsx`, `.env`, and `frontend/.env` are protected from staging or commits.
- Tests use realistic fictional data, never production or real private user/payment data.
- The factory never merges, deploys production, creates accounts, enables billing, changes secrets, force-pushes, or performs destructive data operations.

## Common run results and what you should do

### `Nothing ready`

Meaning: no open issue has `factory:building` or `factory:ready`, but an open workplan issue is still planned, under review, blocked, or otherwise waiting.

Your action: read the reported issue state. If it is an eligible `factory:planned` ticket and you want work to start, replace that label with `factory:ready`.

### `Ticket prepared`

Meaning: the previous workplan queue was empty, so Sol High authored one fresh detailed ticket and the factory saved it as `factory:planned`.

Your action: review its dependency, then replace `factory:planned` with `factory:ready` when you want the next build to start.

### `Factory already running`

Meaning: another scheduled run owns the shared lock.

Your action: none. The overlapping run stopped safely. Review the active run or wait for the next scheduled time.

### `factory:blocked`

Meaning: the factory found a concrete missing dependency, unsafe boundary, unresolved decision, failed review, or exhausted repair limit.

Your action:

1. Read the evidence and question on the GitHub issue.
2. Resolve or answer the exact blocker.
3. Remove `factory:blocked`.
4. If the block stopped before code was written, add `factory:ready` to retry readiness.
5. If a recoverable feature branch or draft PR already exists, add `factory:building` instead so the next run recovers that work rather than starting over.

### `LIMITED`

Meaning: an environmental or manual check could not be honestly proven automatically.

Your action: read whether the limitation blocks review. Perform the named founder check before merge when required.

### A run stops unexpectedly

Meaning: the scheduled task may have crashed, the Mac may have slept, or an external service may have failed.

Your action: normally none. Durable state remains in GitHub, the branch, the worktree, commits, comments, and the draft PR. The next run recovers an open `factory:building` issue before taking new work. If no later run can recover it, bring the issue/PR number to the orchestrator chat.

## What remains deliberately manual

You are always responsible for:

- deciding when to add `factory:ready`;
- resolving material product, architecture, privacy, cost, or infrastructure dilemmas;
- performing named owner-only or real-environment checks;
- reviewing the draft PR and limitations;
- converting the draft PR when appropriate;
- merging or declining the PR;
- approving production deployment, accounts, billing, secrets, or destructive operations in a separate explicit task.

Everything else in the normal build-review handoff is automated.

## Pausing or running the factory manually

- To pause all scheduled starts, open **Scheduled** in the ChatGPT desktop app, select `biz-workplan-factory`, and pause it—or ask the orchestrator chat to pause it.
- To resume, reactivate the same scheduled task. Do not create a duplicate automation.
- To run immediately, use **Run now** on `biz-workplan-factory`.
- A manual run follows the same lock, queue, one-ticket, review, and no-merge rules.

## Sources of truth

- [Project operating rules](../AGENTS.md)
- [Factory skill](../.agents/skills/biz-workplan-factory/SKILL.md)
- [Workplan map](WORKPLAN-MAP.md)
- [Bundling rules](BUNDLING-RULES.md)
- [Ticket quality contract](TICKET-CONTRACT.md)
- [Project commands and test boundaries](PROJECT-CONFIG.md)
- [Draft PR evidence template](REVIEW-PACKET.md)
- [Worktree and secret-handling guide](WORKTREE-GUIDE.md)
- [Scheduled-task prompt](AUTOMATION-PROMPT.md)
- [Official OpenAI scheduled-task documentation](https://learn.chatgpt.com/docs/automations)

If this guide conflicts with the user's current instruction, `AGENTS.md`, or a locked product specification, follow the higher-precedence source and update this guide afterward.
