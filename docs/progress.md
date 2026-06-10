# progress.md — Session Log & Working State

This is the project's **working memory**. It exists so any fresh Claude session can pick
up exactly where the last one left off, with zero context lost.

## How to use this file

- **Start of every session:** read this file *and* `CLAUDE.md` before doing anything.
- **End of every session (or when context gets long):** update the live sections below,
  then it's safe to `/clear` and start fresh.
- Keep it **tight and current** — this is working memory, not documentation. Overwrite
  stale lines in the live sections; only `SESSION HISTORY`, `ASSUMPTIONS & DECISIONS`,
  and `NEEDS MY INPUT` are append-style.

---

## CURRENT STATE  *(always keep this accurate — it's the snapshot)*

- **Current phase:** Phase 5 — Backend & Database Foundation (in progress).
- **Current task:** Task 5.9 done — FastAPI skeleton boots, `/health` returns 200. Next: 5.10+.
- **Built so far:** Local environment + monorepo scaffolded. Private GitHub repo connected.
  `CLAUDE.md` written. All Phase 3 design docs locked (`technical-spec.md` v1.0 + 9 source docs).
  `docs/rtm.md` built — 93 features, 13 columns, pre-populated Explore + Design sections.
  **`backend/migrations/` — 13 SQL files** covering all 42 tables, 27 enums, ~60 indexes,
  full RLS policies, and role grants (001–013, see SESSION HISTORY). Migrations 001–013
  applied to the live dev Supabase project. **`backend/tests/test_rls.py`** — RLS smoke test
  (4/4 PASS). **`backend/migrations/apply_migration.py`** — applies a migration file to the
  dev project via the Supabase Management API (workaround for broken `DATABASE_URL`, see
  below).
  **FastAPI skeleton (task 5.9):** `backend/main.py` (CORS, lifespan, router registration),
  `backend/core/config.py` (`Settings` — all config from `.env`), `backend/core/supabase_client.py`
  (`get_supabase()`, service_role key), `backend/services/ai_service.py` (the `ai_service`
  abstraction — `call_ai(prompt, context)` stub, only file that imports `google.generativeai`),
  `backend/api/health.py` (`GET /health`). `backend/requirements.txt` now also has fastapi,
  uvicorn, google-generativeai, weasyprint, resend — all installed in `backend/.venv/`.
- **Not working / known issues:**
  - `DATABASE_URL` in `.env` does not connect — Supavisor pooler returns "tenant/user ... not
    found" even though the project ref matches `SUPABASE_URL`. Likely a stale/incorrect
    password or pooler string. Not currently blocking (FastAPI uses the supabase-py client +
    service_role key, not raw psycopg; `apply_migration.py` is the workaround for running SQL
    migrations). Worth regenerating the connection string from the Supabase Dashboard
    (Settings → Database) when convenient.
  - **WeasyPrint installs via pip but cannot be imported yet** — needs system Pango/GObject
    libs (`brew install pango`). Not blocking now (nothing imports it yet); must be resolved
    before Phase 9 contract/invoice PDF generation.
- **How to run the project:** Backend: `cd backend && .venv/bin/uvicorn main:app --reload --port 8000`,
  then `curl localhost:8000/health`. RLS test: `backend/.venv/bin/python backend/tests/test_rls.py`.
  Frontend (Expo) stands up in Phase 6.

## NEXT UP  *(ordered)*

1. **Phase 5 (continued, 5.10+):** Build out the real API endpoints/routers as features need
   them; flesh out `ai_service` in Phase 10.
2. **Phase 6 — Frontend Foundation:** Expo project setup, Expo Router, NativeBase (re-evaluate
   at task 6.4 per open decision #6), Zustand store, Supabase JS client wiring.
3. After 5 + 6: Phase 7 (Identity & Trust — first real features, Bucket 1).

## NEEDS MY INPUT  *(blockers + anything Claude flagged per the CLAUDE.md STOP list)*

*Claude: when you hit a STOP-and-flag situation (destructive ops, anything paid, live/prod,
real secrets, big architectural change, irreversible + low confidence), describe it here and
do not proceed. I'll resolve these at the start of my next session.*

- *(nothing flagged yet)*

## ASSUMPTIONS & DECISIONS LOG  *(append-only — newest at top)*

*Claude: when a detail is ambiguous and you make a reasonable call to keep moving, log it
here in one line so I can review or reverse it later.*

- 2026-06-10 — Discovered the Supabase project had **no table grants at all** on `public`
  for `anon`/`authenticated`/`service_role` (Supabase normally auto-configures this; it
  didn't take here). Even `service_role` got `permission denied for table brands` (42501).
  Fixed with a new migration `013_grants.sql` (standard Supabase GRANT + ALTER DEFAULT
  PRIVILEGES statements) — RLS (012) remains the real lock for anon/authenticated, this
  migration just makes the tables reachable at all. Applied via the Management API since
  `DATABASE_URL`/psql access doesn't work (see CURRENT STATE).
- 2026-06-09 — Two RLS gaps deferred (task 5.4 review): (1) `deal_participants` INSERT policy
  allows uninvited self-addition — mitigated by UUID non-guessability + app flow enforcing invites
  via FastAPI; (2) `deals` UPDATE policy doesn't restrict `stage` column — mitigated by FastAPI
  being the only path for stage transitions. Both documented in full in `docs/security.md` under
  "Known RLS implementation gaps (address before production)".
- 2026-06-03 — RTM will live as `docs/rtm.md` (markdown table, not xlsx) so it's
  Git-diffable and editable without scripts. Workplan stays as the separate Google Sheet.
- 2026-06-03 — App name "Biz" is a placeholder pending final naming.

---

## SESSION HISTORY  *(append-only — newest at top, keep each entry brief)*

### 2026-06-10 — Phase 5: FastAPI skeleton (task 5.9)
- **Did:** Built the FastAPI app shell on top of the venv/requirements from 5.8:
  `backend/main.py` (FastAPI app, CORS middleware open for local dev, lifespan hook that
  calls `get_supabase()` so bad config fails at boot, registers the health router),
  `backend/core/config.py` (`Settings` class — every value read from `.env` via
  python-dotenv, required Supabase keys via `os.environ[...]` so missing config fails fast),
  `backend/core/supabase_client.py` (`get_supabase()` — singleton client built with
  **service_role key**, never anon, per the two-key rule), `backend/services/ai_service.py`
  (the locked `ai_service` abstraction — `async def call_ai(prompt, context) -> dict` stub;
  configures `google.generativeai` with `GEMINI_API_KEY` but makes no real call yet; it's the
  *only* file that imports `google.generativeai`), `backend/api/health.py` (`GET /health`).
  Added fastapi/uvicorn/google-generativeai/weasyprint/resend to `backend/requirements.txt`
  and installed into `backend/.venv`.
- **Verified:** `uvicorn main:app --port 8000` boots cleanly, `curl localhost:8000/health` →
  `{"status":"ok","env":"development"}`.
- **Found:** WeasyPrint installs fine via pip but fails to *import* — needs system
  Pango/GObject libs (`brew install pango`). Logged as a known issue; not blocking since
  nothing imports it yet (Phase 9 will need it for contract/invoice PDFs).
- **Next:** 5.10+ — real endpoints as features need them.

### 2026-06-10 — Phase 5: RLS tested with dummy users (task 5.8)
- **Did:** Wrote `backend/tests/test_rls.py` — creates 3 throwaway Supabase Auth users
  (Priya/creator, Rahul/brand admin at "Zomato Brand Account", Sneha/unrelated) via
  service_role, wires up a deal + deal_participants + a message, then signs in as the anon
  client to verify: the participant (Priya) can see the deal and message (1 row each), and
  the unrelated user (Sneha) sees neither (0 rows, no error). Cleans up all test data + auth
  users afterward. Also created `backend/requirements.txt` (supabase, python-dotenv) and a
  `backend/.venv/`.
- **Hit a blocker:** first run failed with `permission denied for table brands` (42501) for
  the **service_role** key — the project's `public` schema had no grants to
  anon/authenticated/service_role at all. Wrote `backend/migrations/013_grants.sql`
  (standard Supabase GRANT + ALTER DEFAULT PRIVILEGES) and applied it via the Supabase
  Management API (`backend/migrations/apply_migration.py`), since `DATABASE_URL` doesn't
  connect (see ASSUMPTIONS LOG / CURRENT STATE).
- **Result:** re-ran `test_rls.py` — **4/4 PASS**. RLS policies from migration 012 are
  confirmed working as designed.
- **Next:** FastAPI project setup (5.9+).

### 2026-06-09 — Phase 5: SQL migrations written
- **Did:** Created `backend/migrations/` with 12 ordered SQL files covering the full data model
  from `docs/data-model.md` v1.2 (42 tables, 9 domains). Files:
  - `001`: Extensions (uuid-ossp, pgcrypto) + 27 custom enum types
  - `002–010`: All 42 tables grouped by domain with FK constraints, CASCADE rules, and timestamps
  - `011`: ~60 indexes — FK indexes, hot-path compound indexes (messages by deal+time, notifications
    unread, deals active), partial indexes (rights expiry, open disputes, pending maker-checker)
  - `012`: RLS — enabled on all 42 tables; 3 SECURITY DEFINER helper functions
    (`is_deal_participant`, `is_brand_member`, `is_brand_admin`); policies for every table
    anchored to `deal_participants` as the visibility anchor.
  - Audit log immutability enforced by BEFORE UPDATE/DELETE trigger (raises exception).
  - Key correctness decisions: UNIQUE(profile_id, category) on notification_preferences (not
    UNIQUE(profile_id)); no FK on private_annotations.entity_id (polymorphic); SET NULL on
    payment_milestones.deliverable_id; ratings CHECK constraint for ratee_profile_id XOR ratee_brand_id.
- **Not done yet:** Supabase project not created; migrations not applied.
- **Next:** FastAPI project setup → Supabase project init → apply migrations.

### 2026-06-09 — Phase 4: RTM built (Cowork session)
- **Did:** Tasks 4.1 + 4.2 + 4.3 complete. Built `docs/rtm.md` — 93 features, 7 per-bucket
  sub-tables, 13 columns (Explore / Design / Build / Test). Pre-populated Feature ID, Feature,
  Bucket, Phase, Priority, Scope, Design Summary, Build Elements for all 93 rows.
  Cross-checked vs `technical-spec.md` Appendix A — exact match, nothing missing, no
  out-of-scope rows. Updated `CLAUDE.md` RTM line to name all 13 columns + the fill-in ritual
  for build and test phases. Note: v5 Excel file not independently available; cross-check done
  against Appendix A (which already reconciles to v5).
- **Next:** Phase 5 — Backend & Database Foundation.

### 2026-06-03 — Project setup + CLAUDE.md
- **Did:** Completed Phase 0–1 setup. Scaffolded the monorepo, connected the private
  GitHub repo, first commit pushed. Drafted `CLAUDE.md` (locked stack, architecture,
  autonomy contract, scope, golden rules). Decided the RTM format (markdown). Created
  this `progress.md`.
- **Next:** Task 2.8 (hooks + auto-run permissions), then Phase 3 technical design.
