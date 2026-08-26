# Biz factory project configuration

This file is the command and environment source of truth for factory runs. Agents must use these commands rather than guessing.

## Stack

- **App:** Inflo/Biz monorepo; Expo SDK 54 React Native/Web frontend and FastAPI backend.
- **Frontend:** TypeScript, Expo Router, NativeWind, gluestack-ui, Zustand, Supabase JS anon key.
- **Backend:** Python 3.12, FastAPI, Supabase service role, Gemini through `backend/services/ai_service.py`, WeasyPrint, Jinja2, pypdf, and Resend.
- **Data:** Supabase Postgres, Auth, Realtime, and private Storage.
- **Package managers:** npm and Python venv/pip.

## Worktree setup

- **Setup command:** `./scripts/setup-worktree.sh`
- The managed worktree receives ignored `.env` and `frontend/.env` through `.worktreeinclude`. Never print, stage, or commit either file.
- Homebrew Pango is required on the local Mac for WeasyPrint and is already installed on the primary machine.

## Deterministic checks

Run checks proportional to the block, then the relevant standard gates:

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
- `backend/.venv/bin/python backend/tests/test_summary_gate.py`
- `backend/.venv/bin/python backend/tests/test_maker_checker.py`
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
