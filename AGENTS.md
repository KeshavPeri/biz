# AGENTS.md — Codex project guide for Biz

Biz (working product name: Inflo) is a B2B deal operating system for India's creator economy. It manages creator–brand work from discovery and negotiation through contracts, delivery, posting, payment tracking, and close.

## Working with the founder

- The founder understands product and technical concepts but is not a professional coder.
- Explain decisions and risks in plain language. Give the outcome first and avoid long code walkthroughs unless asked.
- For small ambiguity, make a reasonable reversible assumption, continue, and record it in `docs/progress.md`.

## Start every task

1. Read this file and inspect `git status`; preserve all existing work and never stage unrelated files blindly.
2. Read `docs/progress.md`, the relevant part of `docs/technical-spec.md`, and the matching rows in `docs/rtm.md`.
3. Read the detailed domain document and relevant mockup before changing that area.
4. For non-trivial work, state a short plan, then implement without waiting for approval unless a stop condition below applies.

## Sources of truth

Use this precedence when sources disagree:

1. The user's current request.
2. `docs/technical-spec.md`.
3. The relevant detailed spec in `docs/` (`data-model`, `deal-engine`, `api-architecture`, `ai-parser`, `rbac`, `security`, etc.).
4. For UI: `docs/design-direction.md` → `docs/design-tokens.md` → the relevant file in `docs/mockups/`.
5. Current code and `docs/progress.md`.
6. `docs/rtm.md` for traceability/status.

For factory queue decisions, `factory/WORKPLAN-MAP.md` reconciles workbook rows with verified repository evidence, and `factory/BUNDLING-RULES.md` controls how ready rows may be grouped. Neither overrides the specifications above.

If code contradicts a locked spec, follow the spec and call out the mismatch. Keep work inside Tier 1 MVP scope from `docs/scope.md`.

## Locked architecture

- Frontend: Expo SDK 54, React Native/Web, strict TypeScript, Expo Router, gluestack-ui v3 + NativeWind, Zustand, Supabase JS with the anon key only.
- Backend: FastAPI/Python, Supabase service-role key only on the backend, WeasyPrint, Resend, and Gemini only through `backend/services/ai_service.py`.
- Frontend talks directly to Supabase for auth, simple RLS-protected CRUD, Realtime, and storage. It uses FastAPI for AI, documents, email, audited rules, sensitive operations, and deal-stage transitions.
- The server is the source of truth. Never enforce security, RBAC, or stage rules only in the client.
- `deal_participants` is the RLS anchor. Deal stages are forward-only and every transition is logged. `Disputed` is a Payment overlay, not a stage.
- Use the existing icon library in `frontend/assets/icons/`; do not add an icon library without flagging it.
- Free tiers only. Never introduce a paid service silently.

## How to build

- Keep functions and components small, typed, and single-purpose. Comment why, not the obvious what.
- Show friendly user-facing errors; never leak raw exceptions or secrets.
- Prefer existing patterns and dependencies. Do not invent schema fields casually; if a specified feature exposes a genuine schema gap, use the smallest migration that preserves the locked model and document the decision.
- Run checks proportional to the change. Common frontend checks are `npx tsc --noEmit` and `npx expo export --platform web` from `frontend/`.
- Backend tests under `backend/tests/` use the live development Supabase project and may create temporary fictional data. Run only relevant tests, never against production, and use realistic fictional—not real private—data.
- Review the final diff, update `docs/progress.md`, and update the affected `docs/rtm.md` rows with files/tests/status.
- Do not commit or push unless the user's task explicitly asks, or the `biz-ship` skill is invoked.

## Workplan factory

- Founder-facing operating instructions live in `factory/USER-GUIDE.md`.
- Use `$biz-workplan-factory` only when asked to process the next ready workplan block or run the factory.
- GitHub workflow labels are `factory:planned`, `factory:ready`, `factory:building`, `factory:review`, and `factory:blocked`.
- Process at most one build block per run. The primary Codex agent owns queue state, branches, commits, pushes, pull requests, recovery, and the final report.
- Before touching GitHub or queue state, every factory run—and any standing-orchestrator ticket-creation or revision action—must acquire the shared lock with `scripts/factory-run-lock.sh`; an overlapping action reports `Factory already running` and stops.
- Ticket authoring is a separate standing-orchestrator task, normally performed with Sol High after inspecting the exact workplan, specifications, code, migrations, tests, GitHub history, and RTM scope. The standing orchestrator owns the quality gate in `factory/TICKET-CONTRACT.md`, creates at most one `factory:planned` issue when explicitly asked, and never adds `factory:ready`; the founder remains the release gate.
- The scheduled factory never authors, rewrites, expands, or performs a second quality review of a ticket. With neither a `factory:building` nor a `factory:ready` issue it reports `Nothing ready` and stops; with multiple candidates it reports the conflict. A base-commit mismatch or other possible drift is blocked for the standing orchestrator to revalidate; the build run does not spawn a planning agent.
- Delegate implementation to exactly one of `builder` or `senior_builder`, as required by `factory/BUNDLING-RULES.md`. Never run both on the same block.
- Use the ticket's v3 risk route: `qa` alone for routine work, one `verifier` for medium-risk acceptance plus integrity review, and separate `qa` plus `security_reviewer` only for high-risk trust-boundary work.
- Spawn every build or review role with no inherited conversation history and the explicit model/effort from `factory/PROJECT-CONFIG.md`. Tell it to read its exact `.codex/agents/<role>.toml` role contract, then give it only the repository/worktree path, issue URL, base commit, review/regression mode, changed files, source fingerprint, named criteria/trust boundaries, compact evidence manifest, and required output. Never paste the parent transcript, full test output, or unrelated specifications into a role handoff.
- Reuse the same implementation and reviewer agents for every repair and re-review in a run. Wait without repeated status probes; create a replacement only when the original agent is genuinely unavailable.
- After worktree setup and before review, run `scripts/factory-preflight.sh`, calculate the conservative floor from `scripts/factory-affected-tests.sh`, and execute the de-duplicated union of that floor and ticket-specific focused tests exactly once per candidate state. Routine/medium tickets reuse that evidence after review when the source fingerprint is unchanged. High-risk tickets alone add one complete final regression. Reviewers and the orchestrator never replay an unchanged successful command set.
- Batch independent reads and commands, preserve full logs locally while returning only concise results, never reread unchanged sources, and wait without repeated status probes or restated progress.
- Read-only agents may run in parallel when their scopes are independent. Never run concurrent code-writing agents in the same worktree.
- If Codex reports a usage/rate limit, preserve a compact recovery comment and the worktree, keep the issue `factory:building`, release the lock, and stop. Do not wait for the reset or recreate the full agent roster in the same run.
- Allow at most two focused implementation revisions after review failures. Then preserve the branch and mark the issue blocked with evidence.
- A direct request to run `$biz-workplan-factory` authorizes the feature-branch commit, push, and draft pull request defined by that skill. It never authorizes merging, production deployment, billing, account creation, secret changes, or destructive data operations.
- Every factory pull request must contain the standalone GitHub closing line `Closes #<issue-number>` for its one workplan ticket. The issue stays open during draft/review and closes automatically only when the PR is merged into the default branch.
- Every factory pull request must open with a concrete plain-language founder summary covering what was built, the user/system before-and-after, and what to look out for. Keep the full technical evidence, tests, risks, migrations, owner review, and safety sections from `factory/REVIEW-PACKET.md`.
- `Checklist_new_rows.xlsx` is protected unrelated user material: never edit, stage, move, delete, or include it in a factory branch.

## Factory worktrees

- Run each factory build block in its own Codex-managed worktree or isolated feature branch.
- Use `scripts/setup-worktree.sh` for dependencies. `.worktreeinclude` or the setup script makes available only the two approved ignored environment files needed for local development; they remain untracked and must never be printed or committed.
- Serialize development-Supabase migrations and integration tests across active Biz blocks.
- Do not start a second writing block that depends on, migrates, or edits the same core contracts as an active block.

## Autonomy and stop conditions

Proceed with routine repository edits, local checks, installs, dev servers, and non-destructive dev-database work that is part of the requested task.

Stop and explain the blocker before doing any of these:

- destructive data operations or destructive migrations;
- force-push, history rewrite, branch deletion, or discarding existing work;
- production deployment, live user/payment data, or a paid service;
- a large architecture change that contradicts the locked specs;
- handling real secrets outside ignored environment files;
- an irreversible action when confidence is low.

## Session finish

Use the repo-local `biz-wrap` skill to reconcile progress and RTM status. Use `biz-ship` only when the user asks to commit/push. Keep the existing `.claude/` setup intact so Claude can still be used on the same repository.
