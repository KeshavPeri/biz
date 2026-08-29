# Biz factory project configuration

This file is the command and environment source of truth for factory runs. Agents must use these commands rather than guessing.

## Stack

- **App:** Inflo/Biz monorepo; Expo SDK 54 React Native/Web frontend and FastAPI backend.
- **Frontend:** TypeScript, Expo Router, NativeWind, gluestack-ui, Zustand, Supabase JS anon key.
- **Backend:** Python 3.12, FastAPI, Supabase service role, Gemini through `backend/services/ai_service.py`, WeasyPrint, Jinja2, pypdf, and Resend.
- **Data:** Supabase Postgres, Auth, Realtime, and private Storage.
- **Package managers:** npm and Python venv/pip.

## Role routing and compact handoffs

| Role | Model | Effort | History |
|---|---|---|---|
| Orchestrator | `gpt-5.6-terra` | High | Current run only |
| Routine Builder | `gpt-5.6-terra` | High | None |
| Senior Builder | `gpt-5.6-sol` | High | None |
| QA | `gpt-5.6-terra` | High | None |
| Security Reviewer | `gpt-5.6-sol` | High | None |

For every subagent spawn, explicitly set the model and High reasoning and use `fork_turns="none"`; never rely on parent inheritance. Tell the agent to read its exact `.codex/agents/<role>.toml` role contract. The handoff then contains only the role/mode, repository or worktree path, issue number/URL, base commit, relevant durable file links, changed-file list and focused evidence needed by that role. Agents read the approved issue and relevant repository sources directly. Do not paste the parent conversation, repeated global rules, full tool output, or unrelated specifications into the handoff.

Ticket authoring is not a factory role. The standing orchestrator normally uses Sol High, performs the full evidence and ticket-quality review once, and creates a founder-gated `factory:planned` issue. A build run never spawns a Workplan Manager or revalidates the ticket's prose and sections.

## Minimal build-start checks

Before claiming a new `factory:ready` issue, the build orchestrator runs `./scripts/factory-ticket-preflight.sh <issue-number>`. It checks only the shared lock-independent ticket invariants: one-ticket queue state, the `biz-factory-ticket:v2` execution header, exact local/GitHub `main` equality, the recorded merged dependency, and conflicts with another active factory branch, worktree, issue, or draft PR. Any base mismatch is returned to the standing orchestrator; the build run does not spend tokens determining whether drift is material.

## Worktree setup

- **Factory run lock:** `./scripts/factory-run-lock.sh acquire|renew|release <owner-token>`; `status` is read-only. Exit 75 means another run owns the shared lock. The stale timeout is 18 hours.
- **Setup command:** `./scripts/setup-worktree.sh`
- Setup quietly installs dependencies and copies only approved ignored `.env` and `frontend/.env` from the primary checkout when a manually created worktree did not receive `.worktreeinclude`. It prints detailed dependency logs only on failure. Never print, stage, or commit either environment file.
- **Preflight:** `./scripts/factory-preflight.sh`; add `--require-integration-env` when the ticket names development-Supabase tests.
- Homebrew Pango is required on the local Mac for WeasyPrint and is already installed on the primary machine.

## Verification ownership

- **Before independent review:** the implementation agent obtains `./scripts/factory-affected-tests.sh --list <base-commit>`, combines that conservative floor with ticket-focused tests, de-duplicates the commands, and runs each once per candidate state. The ticket may add tests but may not remove the floor. `--run` is a convenience only when the ticket adds no extra command. It does not run the complete ticket regression set yet.
- **During review:** QA and security inspect the full diff and existing evidence, then run only targeted checks needed to validate acceptance criteria or findings. They do not replay an unchanged complete regression set.
- **After review passes:** the same implementation agent runs the ticket's complete named regression set exactly once on the final candidate state and records a source-state fingerprint with the results.
- **Shipping:** the orchestrator verifies that fingerprint and runs only diff/secret/documentation checks. A code change invalidates the prior evidence and requires affected re-review followed by one new complete regression pass; a documentation-only evidence correction does not.

Use this code-state fingerprint from the isolated feature worktree before the final regression and verify it again before shipping:

`base_ref=$(git merge-base HEAD origin/main) && git diff --binary "$base_ref" -- . ':(exclude)docs/**' | git hash-object --stdin`

The command excludes documentation so evidence-only progress/RTM updates do not trigger an unnecessary code regression replay.

Independent deterministic lanes may run in parallel to reduce wall time: one backend pure/compile lane and one frontend type/lint/export lane. Commands within a lane remain ordered and each result is recorded separately. Development-Supabase tests, migrations, shared fixtures, and any stateful external check always run serially. Parallelism changes scheduling only; it never removes a command or merges its evidence.

Successful command output should be summarized to the command, exit status, and final assertion/count lines. Preserve complete logs locally during execution and print the relevant tail on failure instead of feeding routine install/test noise back into model context.

## Usage-limit boundary

On an explicit Codex usage/rate-limit response, do not wait for the reset or recreate the role roster. Write the compact `FACTORY_RECOVERY_V1` issue comment defined by the factory skill, including the saved issue-body hash; preserve the worktree, keep `factory:building`, release the lock, and stop. The next run resumes from durable evidence and spawns only the roles still needed when that hash/base/worktree remain unchanged.

## Deterministic checks

The ticket must classify each command as a focused pre-review check or part of the single final regression set:

- **Backend compile:** `backend/.venv/bin/python -m compileall -q backend`
- **Backend pure summary test:** `backend/.venv/bin/python backend/tests/test_summary_gate_unit.py`
- **Backend PDF/template test:** `backend/.venv/bin/python backend/tests/test_contract_template.py`
- **Frontend typecheck:** `cd frontend && npx tsc --noEmit`
- **Frontend lint:** `cd frontend && npm run lint`
- **Frontend web build:** `cd frontend && npx expo export --platform web`
- **Diff hygiene:** `git diff --check`

## Development integration tests

These use the development Supabase project, realistic fictional data, and safe cleanup. Run only tests relevant to the changed block plus named regressions:

- `backend/.venv/bin/python backend/tests/test_auth_session.py`
- `backend/.venv/bin/python backend/tests/test_onboarding.py`
- `backend/.venv/bin/python backend/tests/test_media_kit_rls.py`
- `backend/.venv/bin/python backend/tests/test_storage_rls.py`
- `backend/.venv/bin/python backend/tests/test_discovery_rls.py`
- `backend/.venv/bin/python backend/tests/test_connect.py`
- `backend/.venv/bin/python backend/tests/test_accept_decline.py`
- `backend/.venv/bin/python backend/tests/test_stage_engine.py`
- `backend/.venv/bin/python backend/tests/test_term_extraction_db.py`
- `backend/.venv/bin/python backend/tests/test_term_approvals.py`
- `backend/.venv/bin/python backend/tests/test_summary_gate.py`
- `backend/.venv/bin/python backend/tests/test_maker_checker.py`
- `backend/.venv/bin/python backend/tests/test_contract_alignment.py`
- `backend/.venv/bin/python backend/tests/test_contract_flow.py`
- `backend/.venv/bin/python backend/tests/test_rls.py`

Serialize integration tests and migrations across factory blocks. Never run them against production.

## Migrations

- Migration files live in `backend/migrations/` and are append-only.
- Inspect the current highest migration number before creating another.
- Apply one approved additive development migration with: `backend/.venv/bin/python backend/migrations/apply_migration.py <filename.sql>`.
- Applying a migration is high-risk work and requires `senior_builder` plus `security_reviewer`.
- Destructive migrations require explicit founder approval and are never part of an autonomous factory run.

## Local QA

- **Backend:** `cd backend && .venv/bin/uvicorn main:app --reload --port 8000`
- **Backend health/docs:** `http://127.0.0.1:8000/health` and `http://127.0.0.1:8000/docs`
- **Frontend web:** `cd frontend && npm run web`
- **Device:** Expo Go on the founder's two phones for task-packet manual checks.

## CI boundary

GitHub CI runs secret-free deterministic checks only. Live Supabase, real Gemini, email, Realtime, native-device, and production checks remain explicit local/manual evidence until a separately approved secure CI design exists.

## Deployment boundary

- Railway backend and Vercel frontend are Phase 14 owner-reviewed work.
- Factory runs never deploy production, configure production secrets, create paid resources, or merge pull requests.
