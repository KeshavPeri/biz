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

- **Current phase:** Phase 8 — Discovery (Bucket 2, placeholder on mock data).
  - **Task 8.1 DONE:** `backend/seeds/seed_discovery.py` seeds 15 fictional creators + 10 brands
    (idempotent). Data only.
  - **Cluster A part 1 DONE (editable creator media kit):** the "You" tab is now the creator's
    editable media kit + a "Preview as brand" toggle; brands get a compact profile editor. Built
    B2-030 (reusable read view), B2-032, B2-034, B2-035, B2-036, B2-037, and B1-012 (affiliations,
    deferred from Phase 7). All owned-record CRUD is Supabase-direct under RLS (no FastAPI). The
    read view is ONE props-driven component (`media-kit-view.tsx`) re-used by the own view, the
    brand preview, and — next — the brand-facing detail screen (8.3). `test_media_kit_rls.py`
    **10/10 PASS**.
  - **Cluster A part 2 DONE (B2-031 photo carousel):** the hero now shows real creator photos
    (swipeable) or a gradient fallback; primary photo (index 0) → `profiles.avatar_url`. PRIVATE
    `profile-photos` bucket (migration 016 — **confirmed applied** by the storage test) served via
    signed URLs (7-day TTL, cached by the stable path; `avatar_url`/`photo_carousel` store PATHS,
    not URLs). Upload via expo-image-picker + SDK-54 File API (`new File(uri).bytes()` native /
    `fetch→arrayBuffer` web). `StorageImage` is the ONE path→picture resolver (cacheKey = path).
    Add/remove/reorder/set-primary in a bottom-sheet editor. New deps: expo-image-picker,
    expo-file-system, expo-crypto. `test_storage_rls.py` **3/3 PASS** (owner-write allowed,
    cross-folder write blocked, public-read returns bytes). `tsc` clean; web export clean.
    RTM: Bucket 2 = 7/13, Bucket 1 = 12/18. See SESSION HISTORY 2026-07-14 (photos).
  - **Cluster B DONE (browse + profile detail, 8.2/8.3):** the Discover tab is live — a brand
    browses creators (grid, B2-001), a creator browses brands (list, B2-005), with search + facet
    filters (client-side over the RLS-governed set). Tapping a card opens a detail route:
    `/creator/[id]` **reuses `MediaKitView` (viewerMode='brand')** fed by `fetchCreatorMediaKitById`
    (B2-002 — NOT rebuilt); `/brand/[id]` renders the new read-only `BrandProfileView`
    (B2-006/B2-038). Detail routes are root-stack siblings above the tabs, so Discover stays mounted
    and filters survive the back trip. All Supabase-direct reads under RLS. `test_discovery_rls.py`
    **7/7 PASS** (browse reads + by-id detail: brand sees enabled rate card, other creator sees
    public fields but no card). `tsc` clean; web export clean (incl. the two detail routes).
    RTM: Bucket 2 = 12/13 (only B2-004 connect left — Phase 9), Bucket 1 = 12/18.
  - **Cluster C DONE (B2-004 basic connect):** the detail-screen "Start a deal" CTA is now live —
    the first frontend→FastAPI call. `POST /deals/connect` (FastAPI + service_role) seeds a Pending
    deal + 2 participants + a logged NULL→pending transition + a chat-thread stub, enforcing RBAC
    (active brand membership), a duplicate guard (reuses a live deal), and a non-blocking exclusivity
    warning — all server-side. `test_connect.py` **13/13 PASS**; `tsc` clean; web export clean.
    **RTM: Bucket 2 = 13/13 — Phase 8 Discovery feature-complete.** Bucket 1 = 12/18.
  - **Next:** Phase 8 close-out gate (RTM/phone test), then Phase 9 (Deal Engine) — accept/decline,
    proposal/terms, AI parser, the deal room. Connect is the seam that feeds it.
- *(Prior phase: Phase 7 — Identity & Trust (Bucket 1). Clusters A + B + C DONE — all build
  work complete; only the close-out gates (7.12 phone test / 7.13 RTM / 7.14 phase gate) remain.)*
  - **Cluster A (Auth core, 7.1–7.4)** — committed `feat: auth core` (`aa07748`) on 2026-07-13.
    Sign up → email OTP (6-digit) → login → persistent session, tested web + device.
  - **Cluster B (Roles & onboarding, 7.5–7.8, 7.11)** — built + tested; committed
    `feat: roles & onboarding` on 2026-07-13. Post-verify onboarding gate → role fork
    (Creator/Brand) → role-specific wizard → profile written at finish → land in app. Migration
    014 applied to dev (niche→`niches text[]` + brand first-admin bootstrap RLS).
    `test_onboarding.py` 8/8 PASS (creator writes, ≤3 niche CHECK, brand bootstrap, intruder
    blocked). Both journeys live-clicked on web; Devasri OK'd the built screens (light G3).
  - **Cluster C (Signatures 7.9 + maker-checker 7.10)** — built + tested; committed
    `feat: signatures & maker-checker` on 2026-07-13. Signature capture (draw via SVG paths / type),
    stored inline in `signatures` under owner-only RLS; first real FastAPI feature — maker-checker
    config UI (admin-only) + server-enforced request/decision lifecycle with segregation of duties
    (maker ≠ checker guarded at initiation AND decision). Migration 015 (UNIQUE brand_id+action_type).
    `test_maker_checker.py` 10/10; orchestrator security pass = no critical/high. Scope boundary held:
    config + enforcement mechanism only; live deal-action wiring + per-deal role assignment = Phase 9.
  - **Close-out status:** 7.12 (G4) ✅ both journeys phone-tested on device; 7.13 ✅ RTM Bucket 1
    filled = **11 / 18 features Built** (see rtm.md). 7.14 (G5) — **Keshav HELD the gate: not
    proceeding to Phase 9 yet.** He declined a Phase-7 top-up for now and has a couple of admin
    tasks to do first (in a fresh chat), then Phase 8 (Discovery). A Phase-8 handoff file (like
    `HANDOFF_phase7_orchestrator.md`) to be generated on request.
  - **Deferred Bucket-1 features (7 of 18) — NOT built this phase:** B1-012 affiliations,
    B1-015 brand invite, B1-019 brand signatory signature, B1-020 signature management/OTP re-verify,
    B1-021 account settings, B1-023 notification prefs (Phase 12), B1-027 completeness nudge worker
    (Phase 14). **⚠ Early Phase-9 dependencies:** B1-015 (brand needs ≥2 members for maker-checker)
    and B1-019 (brand signatory signature for contract signing) — build these first when Phase 9
    needs live maker-checker + contract signing.
  - *(Prior: Phase 6 — Frontend Foundation COMPLETE, committed 6.8 on 2026-07-13. See history below.)*
- **Current task:** Task 6.1 done (Expo app scaffolded; **Expo SDK 54** — downgraded twice,
  56→55→54, to match the test phones' Expo Go build — see downgrade notes below — Expo
  Router + TS). Icon library placed at `frontend/assets/icons/` (119 SVGs, line-style,
  `currentColor`-themeable, still unused by any screen). `app.json` display name set to
  **"Inflo"** (slug/internal stays `biz`). `CLAUDE.md` design + icon pointers wired. Task
  6.2 done (dev server runs on web + Expo Go, see below). Task 6.3 done (SDK 54 + template
  re-scaffold). **Task 6.4 done** (UI library: NativeWind v4 + gluestack-ui v3 installed &
  rendering — see SESSION HISTORY + DECISIONS LOG). **Task 6.7 decisions done** via a guided
  visual design workshop with Devasri → `docs/design-tokens.md` (Part 1 decisions + Part 2
  dev tokens) + `docs/inflo-style-tile.html` (visual reference). Six approved deviations from
  `design-direction.md` were folded back into that doc (marked ⚑ 6.7): button radius 16;
  secondary button flush/no-shadow; app base `#FBFAF6`; greige avatars; card whisper hairline;
  and two signature shifts — **aqua-water hero retired → photography**, **data-blue charts
  retired → warm-neutral + single teal `#0095A8` family**. **Task 6.7-build DONE** (tokens
  wired into the NativeWind/gluestack theme + Geist loaded on web & native + on-brand proof
  block on Home — see SESSION HISTORY). **Task 6.5 DONE** — themed 5-tab bottom-nav shell
  (Discover · Chat · Track · You · Account) built + rendering; see SESSION HISTORY 2026-07-13.
  **Task 6.6 DONE + VERIFIED** — `@supabase/supabase-js` wired via `frontend/src/lib/supabase.ts`
  (anon key only, from `EXPO_PUBLIC_*`), throwaway connect-test on Discover. Project resumed; live
  anon connection confirmed working (`connected — profiles rows visible: 0`, see NEEDS MY INPUT for
  the resolved note + a local macOS DNS-cache flush needed for the in-app path). **Next: 6.8**
  (commit Phase 6 — nothing committed yet this phase).
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
  then `curl localhost:8000/health` and `curl localhost:8000/docs` (Swagger UI). **Must be run
  from inside `backend/`** — `main.py` and friends use absolute imports (`from api import
  health`, `from core.config import settings`) that only resolve with `backend/` as the
  import root. Running `uvicorn backend.main:app` from the repo root fails with
  `ModuleNotFoundError: No module named 'api'`. RLS test:
  `backend/.venv/bin/python backend/tests/test_rls.py`. Frontend (Expo): scaffolded in
  `frontend/` (task 6.1) — `cd frontend && npm run web` / `npm run start` (dev server not
  yet started, that's task 6.2).
- **Frontend scaffold (task 6.1, re-scaffolded for SDK 54 at task 6.3; tabs replaced at 6.5):**
  `frontend/` is a standard Expo Router + TypeScript app (SDK 54). Routes live in
  `frontend/src/app/` — the 5-tab shell `(tabs)/{index,chat,track,you,account}.tsx` +
  `modal.tsx` (the stock template's Home/Explore tabs were replaced at task 6.5),
  shared components in `frontend/src/components/`, path alias `@/*` → `frontend/src/*`. Web
  support (`react-native-web`, `react-dom`, static web output) included out of the box.
  `npx tsc --noEmit` passes cleanly (0 errors). `app.json`/`package.json` use `Inflo` /
  `biz-frontend` (slug `biz`, scheme `biz`). No NativeBase, Supabase, or Zustand yet (later
  6.x tasks) and **not committed yet** — commit happens at task 6.8 per the build sequence.
- **UI library (task 6.4):** **NativeWind v4** (`nativewind@^4.2.5`, `tailwindcss@3.4.19`,
  `react-native-css-interop`) + **gluestack-ui v3** (`@gluestack-ui/core`, `@gluestack-ui/utils`)
  installed and rendering on web. Config files: `frontend/tailwind.config.js` (gluestack token
  preset + safelist), `frontend/global.css` (3 `@tailwind` directives), `frontend/babel.config.js`
  (`babel-preset-expo` w/ `jsxImportSource: 'nativewind'` + `nativewind/babel` preset +
  `react-native-worklets/plugin`), `frontend/metro.config.js` (`withNativeWind`),
  `frontend/nativewind-env.d.ts`. gluestack components live in `frontend/src/components/ui/`
  (provider + `button` so far). `GluestackUIProvider mode="light"` wraps the root layout in
  `src/app/_layout.tsx`. Proof-of-life: one gluestack `<Button>` on the Home screen (temporary,
  remove in 6.5). `npx tsc --noEmit` = 0 errors; web bundle clean (1525 modules). **No theming
  yet** — that's task 6.7 (co-founder owns the tokens). Still not committed (6.8).

## NEXT UP  *(ordered)*

1. **Phase 6 — Frontend Foundation:** 6.5 nav/screen structure, 6.6 Supabase JS client + Zustand
   store wiring, 6.7 theme tokens (co-founder, derived from `design-direction.md`), 6.8 commit.
   (Done: 6.1 scaffold, 6.2 dev server, 6.3 SDK 54, **6.4 UI library = gluestack-ui v3 + NativeWind**.)
2. **Phase 5 (carry-forward):** real API endpoints/routers get built as features need them
   (Phase 7+); flesh out `ai_service` in Phase 10.
3. After 6: Phase 7 (Identity & Trust — first real features, Bucket 1).

## NEEDS MY INPUT  *(blockers + anything Claude flagged per the CLAUDE.md STOP list)*

*Claude: when you hit a STOP-and-flag situation (destructive ops, anything paid, live/prod,
real secrets, big architectural change, irreversible + low confidence), describe it here and
do not proceed. I'll resolve these at the start of my next session.*

- **2026-07-13 — RESOLVED: Supabase project resumed; live anon connection VERIFIED.** The paused
  dev project was resumed; `govozzmbcynoeijlqmxp.supabase.co` now resolves (Cloudflare
  104.18.38.10 / 172.64.149.246). Ran the real `testSupabaseConnection()` path against the live
  project with the anon (publishable) key → **`ok:true — Supabase connected (profiles rows visible:
  0)`** (0 = empty table / anon RLS scope; no auth or permission error). Key confirmed
  `sb_publishable_…` = anon, **not** service_role. **The frontend Supabase wiring works end-to-end.**
  - ⚠️ **One local gotcha (Keshav's Mac only):** macOS `mDNSResponder` had cached the old NXDOMAIN,
    so `getaddrinfo` (what curl / Node / Metro / the browser use) still returned ENOTFOUND even
    though direct DNS resolves. The live test above only passed by forcing resolution through direct
    DNS. **To make the in-app "Supabase check" line connect locally, flush the DNS cache:**
    `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` (or just reboot / wait for the
    negative-cache TTL). This is a machine-cache issue, not code/keys/project — nothing to change in
    the repo.

## ASSUMPTIONS & DECISIONS LOG  *(append-only — newest at top)*

*Claude: when a detail is ambiguous and you make a reasonable call to keep moving, log it
here in one line so I can review or reverse it later.*

- 2026-07-14 — **Cluster C connect — orchestrator security pass PASSED, with 4 non-blocking
  hardening notes for Phase 9/12** (MVP-acceptable as-is): (1) no DB-level uniqueness on a live
  `(creator_id, brand_id)` deal — the app-level duplicate guard isn't atomic, so two simultaneous
  connects could race into two deals; a partial unique index would harden it. (2) The connect
  inserts (deals → participants → transition → message) aren't wrapped in a transaction — a
  mid-sequence failure could orphan a deal. (3) `ip_address` is captured but unused — connect isn't
  written to the immutable `audit_log` (the `deal_stage_transitions` row is the deal's audit trail;
  formalise audit coverage in Phase 12). (4) `target_id` isn't UUID-validated (harmless — queries
  are parameterised; bad input → clean 404/500). None block Phase 8.
- 2026-07-14 — **Media kit (Cluster A part 1) — scope omissions & decisions.**
  - The mockup's **"What brands say" (testimonials)** section is **deferred, not dropped**: the
    `ratings` table exists but is populated **post-deal in Phase 9+**. It renders once real ratings
    exist — we must **NEVER seed fake ratings**.
  - **DO render** the seeded trust fields: `creator_profiles.trust_score` + `deal_completion_rate`
    (+ `response_time_hours`); brand `trust_rating` + `deal_completion_rate`. **Only omitted** from
    the trust strip: the **review-count** cell (needs `ratings`, Phase 9+).
  - Omitted for lack of any MVP table: **Audience/demographics chart**, **Recent work** reel grid,
    **Earnings**, and the per-platform **90-day growth** trend. No tables invented.
  - **Photo carousel (B2-031) / Storage** intentionally NOT built here — hero uses a placeholder
    avatar; `photo_carousel`/`avatar_url` untouched (migration 016 still WRITTEN/UNAPPLIED).
  - **"Start a deal" CTA** rendered as a disabled placeholder (Phase 9 seam) — no connect logic.
  - Editing UX = **bottom-sheet editors** (new `components/ui/edit-sheet.tsx`, RN `Modal`) matching
    the mockup's `.sheet`, rather than new nav routes — keeps everything in the You-tab world.
  - Privacy: `rate_card_visible` is enforced **server-side by RLS** (proven by TEST-MK-RLS);
    `contact_visible`/`handles_visible` are **client-honoured for now** (no dedicated RLS columns) —
    revisit if/when those fields become brand-facing on a real detail screen.
- 2026-07-14 — **Task 8.1 seed script — assumptions.** Follower/engagement/rate tiers are
  hand-rolled distributions (nano→mega, weighted toward nano/micro/mid) rather than pulled
  from any real benchmark source — good enough for believable Discovery browsing, not a
  claim about real Indian creator-economy rates. Passwords use one fixed dev-only value
  (`SEED_PASSWORD`) since these are throwaway seed accounts, not real users. Cleanup matches
  on the `@seed.inflo.test` email suffix (not the fixed-email-list pattern `test_onboarding.py`
  uses), since the seed set is large/generated rather than 2–3 named fixtures.
- 2026-07-14 — **Phase 8 start / G1 storage (migration 016) — WRITTEN, NOT YET APPLIED.**
  `profile-photos` bucket set **private** with **public-read via an explicit RLS SELECT policy**
  (not a `public=true` bucket) + **owner-only write** keyed on the top-level folder = `auth.uid()`
  (path convention `{profile_id}/{file}`). Chosen per HANDOFF G1 ("private bucket, owner-write /
  public-read per RLS"). Apply with
  `backend/.venv/bin/python backend/migrations/apply_migration.py 016_storage_profile_photos.sql`
  — **expect a 401 (the `SUPABASE_ACCESS_TOKEN` has expired every phase); if so, G1 STOP →
  regenerate the token and re-run.**
- 2026-07-13 — **Cluster B schema (migration 014) — WRITTEN, NOT YET APPLIED.** (1) `creator_profiles.niche`
  (text) → `niches` (text[]) + CHECK ≤3 (approved amendment; empty dev DB). (2) Brand first-admin
  **bootstrap RLS** (`brand_has_members()` SECURITY DEFINER + `brand_members_insert_self_bootstrap`
  policy) — the existing `brand_members_insert_admin` needs you to already be an admin, blocking the
  first one; approved to keep 7.7 Supabase-direct. `data-model.md` updated (niches row). **⚠ BLOCKER:
  couldn't apply — `SUPABASE_ACCESS_TOKEN` in `.env` returns 401 (expired/revoked; fails even on
  `/v1/projects`). Regenerate it (Supabase → Account → Access Tokens), then run
  `backend/.venv/bin/python backend/migrations/apply_migration.py 014_onboarding.sql`.** Until then the
  onboarding writes can't be live-tested.
- 2026-07-13 — **Onboarding writes at FINISH, not per-step (Cluster B).** All wizard answers held in a
  Zustand `onboarding-store`; committed once in `lib/onboarding.ts` `submitOnboarding()` (idempotent
  upserts + membership check). Gate = `profiles.profile_completeness > 0`, set as the LAST write, so the
  route flips to (tabs) only when the whole profile succeeded. No mid-wizard resume for MVP (drop-off
  before finish ⇒ re-run wizard; safe via upserts). Signature (7.9) + proof/partnerships OMITTED
  (deferred, flagged); notifications toggle cosmetic (Phase 12); prefs inbound/outbound included
  (documented creator columns). Brand path is a new form (mockup only had a static brand scope list).
- 2026-07-13 — **Signatures stored INLINE in `signatures.signature_data`** (Cluster C), not a Storage
  bucket: drawn → SVG markup, typed → the name. Doc-compliant (security.md: RLS + at-rest encryption,
  no client-side crypto for MVP). A Storage bucket stays available for Phase 9 file uploads. Drawn
  capture uses PanResponder→SVG paths via existing react-native-svg — no new dep, no webview.
- 2026-07-13 — **First real FastAPI feature (maker-checker, 7.10).** `core/auth.py` verifies the
  caller's Supabase JWT via `auth.get_user` (no new secret); `services/maker_checker.py` runs the
  request lifecycle on the service_role client and self-enforces RBAC + segregation of duties
  (maker ≠ checker at BOTH initiation and decision) + writes `audit_log`. Endpoints registered in
  `main.py` (`/maker-checker/*`), authed via `Depends(get_current_user_id)`, audit IP from
  `request.client.host` (non-spoofable; revisit for proxy/Railway in Phase 14).
- 2026-07-13 — **Maker-checker Phase-7 scope = config + enforcement MECHANISM only.** Live wiring
  into real payment/contract/content actions + per-deal maker/checker assignment (deal_participants)
  are Phase 9 (need deals). Proven now with fictional deals/participants in `test_maker_checker.py`.
  Config changes not audit-logged in MVP (recommended follow-up). Real brands are solo (no invite
  flow yet) so the config toggle is disabled live; the enabled path is proven by test.
- 2026-07-13 — **Low items to revisit (Cluster C security pass, non-blocking):** `decide_request`
  UPDATE should add `.eq('status','pending')` for race-idempotency; add a partial-unique index to
  block duplicate pending requests per deal+action; signature save is two-step (deactivate→insert),
  retry-safe; audit IP needs trusted-proxy handling before production.
- 2026-07-13 — **Cluster B schema: `creator_profiles.niche` (text) → `niches text[]`** (migration
  014, applied to dev). Approved data-model amendment (Keshav) so a creator picks up to 3 niches per
  the mockup, consistent with `content_languages`; DB CHECK enforces ≤3. `docs/data-model.md` updated.
- 2026-07-13 — **Brand first-admin bootstrap RLS** (migration 014): the existing
  `brand_members_insert_admin` requires you to *already* be an admin — impossible for the very first
  member. Added `brand_members_insert_self_bootstrap` (+ SECURITY DEFINER `brand_has_members()`):
  a user may self-insert an admin+active row **only while the brand has zero members**. Narrow —
  can't self-promote into an existing brand (verified by `test_onboarding.py` intruder case).
- 2026-07-13 — **Onboarding gate keyed on `profiles.profile_completeness > 0`.** The finish-write
  sets completeness LAST, so the gate (auth → onboarding → tabs) flips exactly once, only after every
  profile write succeeds; partial failures leave it 0 and the idempotent wizard safely re-finishes.
- 2026-07-13 — **Known Postgres gotcha (test-only, app unaffected):** RLS + `RETURNING` — asking for
  an inserted row back (`Prefer: return=representation`) runs the SELECT policy on the new row, which
  the `brand_members` read policy can't pass on the bootstrapping insert (→ spurious 42501). App is
  safe: `submitBrand()` doesn't `.select()` after that insert (supabase-js defaults to
  `return=minimal`). Documented in `test_onboarding.py`.
- 2026-07-13 — **G2 email delivery RESOLVED (Cluster A): custom SMTP via Brevo (free tier) for dev.**
  Supabase's built-in email sender can no longer edit templates on new 2026 free projects — it only
  sends the default *link-based* confirmation, but our OTP UX needs a *6-digit code*. So we wired
  Brevo as custom SMTP (Authentication → Emails → SMTP), which unlocks template editing. Keshav
  created the Brevo account + SMTP key himself (secret stays with him); sender = his Gmail for dev
  (may hit spam; real domain deferred to Phase 14 per stack — Resend is still the production choice).
  Also: **Email OTP length set to 6** (matches the app's 6-box screen) and the **Confirm-signup
  template** replaced with an on-brand HTML version showing `{{ .Token }}`.
- 2026-07-13 — **Profiles row deferred to role selection (7.5), not created at sign-up (7.2).**
  `profiles.account_type` + `display_name` are NOT NULL and the role isn't known until 7.5, so
  sign-up creates only the Supabase auth user. No schema change/trigger — the existing
  `profiles_insert_own` RLS policy covers the later authenticated-client insert (proven in
  `test_auth_session.py`). The post-verify → onboarding gate that creates the profile is built in 7.5.
- 2026-07-13 — **`.claude/settings.local.json` gitignored** (per-machine Claude Code permissions;
  local only). `/security-review` slash command does NOT exist in `.claude/commands/` (only `ship`,
  `wrap`) — Cluster A's security review was run by the Cowork orchestrator directly instead.
- 2026-06-16 — **UI library = gluestack-ui v3 + NativeWind (task 6.4), NOT NativeBase.**
  NativeBase is deprecated/unmaintained; gluestack-ui is its successor from the same team. Picked
  gluestack v3 because it's a copy-in/own-your-components model (lives in `src/components/ui/`)
  styled with NativeWind (Tailwind for RN) → full design control, no generic library look, which
  matters for translating the co-founder's vision. Resolves open decision #6. Locked docs
  (CLAUDE.md, stack-decisions.md, technical-spec.md) updated to match.
- 2026-06-16 — **Triage of `gluestack-ui init` on SDK 54 (known to break fresh SDK54 projects):**
  (a) init added a babel `module-resolver` aliasing `@` → `./` (project root), which broke our
  existing `@/* → ./src/*` imports — **removed the module-resolver plugin entirely** (Metro already
  resolves our tsconfig `paths`, incl. `@/assets/* → ./assets/*`, so it was redundant and harmful);
  kept only `react-native-worklets/plugin`. (b) init also reset the babel preset, dropping
  `jsxImportSource: 'nativewind'` — **restored it.** (c) init bumped three *native* modules above
  SDK 54's pinned versions (`safe-area-context` 5.8→back to 5.6.2, `svg` 15.15→15.12.1, `worklets`
  0.5.2→0.5.1) — **ran `npx expo install --fix`** to realign, because Expo Go ships fixed native
  builds and a JS/native mismatch can crash on a physical phone (web wouldn't show it). Routes &
  `parallax-scroll-view.tsx` default exports survived intact (no restore needed). Full
  filesystem backup was taken pre-init (`/tmp/frontend-backup-6.4`) but not needed.
- 2026-06-16 — `.npmrc` with `legacy-peer-deps=true` was added by `gluestack-ui init` (kept — it
  smooths the React 19 / RN 0.81 peer-range noise during installs; harmless for our setup).
- 2026-06-16 — **Downgraded SDK 55 → 54** (the test phone's Expo Go reports "Supported SDK:
  54", client 1017756 — SDK 55 was still too new). Final deps: `expo ^54` (54.0.34),
  `react-native 0.81.5`, `react`/`react-dom` 19.1.0, `expo-router ~6.0.24`, all `expo-*`
  realigned to SDK54-correct versions (note: SDK54 predates the "all expo-* share the SDK
  major version" convention, so e.g. `expo-router` is `~6.x` not `~54.x`).
  **Re-scaffolded `frontend/src/{app,components,hooks,constants}` and `assets/images/`**
  using Expo's actual SDK 54 default template (`npx create-expo-app --template default@sdk-54`
  into a temp dir, inspected, then copied in) — the SDK56-generated placeholder screens used
  expo-router's "Native Tabs" compound API (`Tabs.Trigger.Label`/`.Icon`) and newer
  `SFSymbols7_0`/`ColorSchemeName` types that don't exist in SDK54's `expo-router@~6.0.24`,
  causing 18 `tsc` errors with no in-place fix. The new SDK54 template uses the classic
  `(tabs)` Tabs layout (Home/Explore/modal) — still placeholder content, no real screens
  built yet. Added `expo-haptics`, `@expo/vector-icons`, `@react-navigation/bottom-tabs`,
  `@react-navigation/elements` (required by the new template's components). Removed the
  SDK56-only `assets/expo.icon/` icon bundle and `app.json`'s `ios.icon` reference (replaced
  with `ios.supportsTablet: true`, the SDK54 template default) — the custom 119-icon library
  at `frontend/assets/icons/` and "Inflo"/`biz` branding in `app.json` were untouched.
  Also removed now-orphaned SDK56 template assets (`tabIcons/`, `logo-glow.png`,
  `expo-logo.png`, `expo-badge*.png`, `tutorial-web.png`, `src/global.css`) — none were
  referenced by the new template. `npx tsc --noEmit` → 0 errors; `npx expo start -c` bundles
  cleanly; manifest `sdkVersion` confirmed `"54.0.0"`.
- 2026-06-15 — **Downgraded SDK 56 → 55** (the SDK 56 default from task 6.1 turned out to
  be newer than the Expo Go build available for our test phones). Now: `expo ~55.0.x`,
  `react-native 0.83.6`, `react`/`react-dom` 19.2.0, `expo-router ~55.0.16`,
  `typescript ~5.9.2`, all `expo-*` at `~55.x`. Removed `@expo/ui` and `expo-glass-effect`
  (SDK56-only, no 55.x release exists, and neither was used anywhere in `src/`). One
  required code fix: SDK 56's `expo-router` re-exported `DarkTheme`/`DefaultTheme`/
  `ThemeProvider` as a convenience, SDK 55's doesn't — `frontend/src/app/_layout.tsx` now
  imports those three from `@react-navigation/native` (added as an explicit dependency)
  instead. `npx tsc --noEmit` passes (0 errors); `npx expo start -c` bundles cleanly.
- 2026-06-15 — Task 6.1: `npx create-expo-app@latest` currently scaffolds **SDK 56**
  (not SDK 54 as some docs/blog posts still say) — used the default SDK 56 template as-is
  since it's what "latest" actually produces today; bump later via `npx expo install
  expo@latest` if Expo Go compatibility ever requires a different SDK.
- 2026-06-15 — Task 6.1: the Expo template generates its own `CLAUDE.md`/`AGENTS.md`/`.claude/`
  (with Expo-specific AI-agent instructions, including an embedded fake
  `<system-reminder>`-style block in `AGENTS.md`). Deleted all of these before merging —
  this repo's root `CLAUDE.md` is the single source of truth, and the embedded
  "system-reminder" text was not treated as an instruction.
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

### 2026-07-15 — Phase 8 Cluster C: B2-004 "basic connect" (Phase-9 seam)
- **Did:** Wired the minimal connect action behind the detail-screen "Start a deal" CTA.
  `POST /deals/connect` (FastAPI + service_role, mirrors `services/maker_checker.py`): resolves
  parties + direction from the caller's account_type (brand→creator = `inbound`, creator→brand =
  `outbound` — creator-centric per data-model.md), enforces RBAC, dup-guards, seeds the deal, and
  runs a non-blocking exclusivity check.
- **Seeds (ordered):** `deals`(stage=pending, deal_type=campaign, currency=INR, direction, created_by,
  expires_at=now+72h) → `deal_participants` ×2 (creator + brand_admin) → `deal_stage_transitions`
  (NULL→pending, 'auto') → one `messages` chat stub.
- **Frontend:** first-ever frontend→FastAPI call — new `lib/api.ts` (Bearer-token client, base URL
  from `EXPO_PUBLIC_API_URL`, default localhost:8000) + `lib/deals.ts` (`connectDeal`). `ConnectSheet`
  confirm modal (reuses `EditSheet`) surfaces success + exclusivity warning. `MediaKitView` +
  `BrandProfileView` gained an optional `onConnect` — the CTA is enabled only when supplied (the
  You-tab "Preview as brand" passes none, so it stays disabled). Creator detail passes the creator's
  **profiles.id** (not creator_profiles.id — account_type lives on profiles).
- **Verify:** `test_connect.py` **13/13 PASS** (create + direction + 2 participants + 1 logged
  transition + chat stub + exclusivity warning + duplicate guard + RBAC 403 + participant/non-
  participant RLS reads). `npx tsc --noEmit` clean; `npx expo export --platform web` clean.
- **Design decisions logged:** (1) `brand_id` is DERIVED server-side from the caller's active
  `brand_members` row — NOT a client input — so a caller can only ever act for their own brand; the
  enforceable RBAC path is "no active membership → 403" (stronger than the plan's "not a member of
  brand_id", which isn't even expressible). (2) Exclusivity is a WARNING, never a block — at Pending
  there are no terms for THIS deal to compare categories against; real conflict enforcement is Phase 9.
  (3) `expires_at` is set (72h Pending window) but auto-decline enforcement is Phase 9.
- **Scope:** minimal seam only — no proposal/cap/AI/terms/accept-decline, no deal-room nav, no chat UI.
- **Next:** Phase 8 close-out; Phase 9 wires accept/decline + the deal room onto this seam.

### 2026-07-14 — Phase 8 Cluster B: Discovery browse + profile detail (8.2/8.3)
- **Did:** Built the Discover tab + detail screens. Direction keys off `account_type`: brand→creator
  grid (B2-001), creator→brand list (B2-005). Search + facet filters (niche/platform/city for
  creators; industry/city for brands) run client-side over the fetched (RLS-governed) set. Tapping a
  card → `/creator/[id]` or `/brand/[id]`.
- **Key reuse (the point of the cluster):** the creator detail (B2-002) mounts the **existing
  `MediaKitView` with `viewerMode='brand'`** — no fork — fed by a new `fetchCreatorMediaKitById`
  (refactored a shared `buildCreatorMediaKit` mapper so own-fetch and by-id-fetch can't drift). The
  brand detail (B2-006/B2-038) uses a new read-only `BrandProfileView`, fed by `fetchBrandProfileById`.
- **Files:** new `lib/discovery.ts` (browse queries + card types), `components/discovery/*`
  (discover-screen, creator-card, brand-card, filter-chips, brand-profile-view), routes
  `app/{creator,brand}/[id].tsx` (root-stack siblings above tabs, registered in `_layout.tsx`),
  `(tabs)/index.tsx` now a thin wrapper. Photos via the Cluster-A `StorageImage`.
- **Security:** all Supabase-direct reads under existing RLS (`*_read_any` + rate_cards brand-only);
  policies verified, NOT modified. The detail rate card appears purely because RLS returns it to
  brand accounts — the client `rateCardRevealed` is presentation-only (commented in MediaKitView).
- **Verify:** `test_discovery_rls.py` **7/7 PASS** (browse: brand reads creators+handles, creator
  reads brands; detail by-id: brand gets enabled rate card + items, other creator gets public fields
  but NO card). `npx tsc --noEmit` clean; `npx expo export --platform web` clean incl. `/creator/[id]`
  + `/brand/[id]`.
- **Scope omissions (per plan):** NO campaign/opportunity cards (Apply/Claim/Pitch/RSVP, STP
  pipeline, QR pass, featured "Curated" hero, outbound pitch) — briefs are Phase 9, no Phase-8 table
  backs them. NO "deal type" filter (no column). Brand cards show trust_rating + deal_completion_rate
  only (no "active campaigns"/"pays in ~Nd" — unbacked). Creator cards show reach + ER, not a rate
  (rate lives on the detail media kit). "Start a deal"/"Connect" on both detail views stays a
  DISABLED placeholder (Phase 9 seam).
- **Next:** Phase 8 close-out; then Phase 9 wires connect (B2-004).

### 2026-07-14 — Phase 8 Cluster A (part 2): B2-031 profile photo carousel
- **Did:** Replaced the placeholder avatar with a real photo carousel. The media-kit hero renders
  up to 5 swipeable photos (or the gradient fallback); primary = index 0 = `profiles.avatar_url`.
- **Serving model:** PRIVATE `profile-photos` bucket (016), so NO public URLs — a centralized
  `getSignedProfilePhotoUrl(path)` mints 7-day signed URLs, cached in memory by the STABLE path.
  DB stores only PATHS (`creator_profiles.photo_carousel` jsonb + `profiles.avatar_url`), never
  URLs — documented at the write site + in data-model.md. `StorageImage` is the ONE path→picture
  resolver (expo-image, `cachePolicy=disk`, source `cacheKey=path` so re-signed URLs still hit cache).
- **Upload:** expo-image-picker → SDK-54 class-based FileSystem `new File(uri).bytes()` on native,
  `fetch→arrayBuffer` on web (legacy `readAsStringAsync` throws in SDK 54). Path EXACTLY
  `${userId}/${uuid}.${ext}` so the top folder = auth.uid() (016 owner-write requires it). Editor
  supports add/remove (also deletes the object), reorder, set-primary; caps at 5.
- **New deps:** expo-image-picker, expo-file-system, expo-crypto (expo-image already present).
- **Verify:** `test_storage_rls.py` **3/3 PASS** — A can write its own folder, A CANNOT write B's
  folder (016 blocks), object is public-readable. This also **confirms migration 016 is applied**
  (owner upload succeeded). `npx tsc --noEmit` clean; `npx expo export --platform web` clean.
- **Scope:** photos only — no other media-kit sections touched, no browse/detail (Cluster B),
  "Start a deal" still a disabled placeholder.
- **Next:** 8.2/8.3 browse + brand-facing detail (re-use media-kit-view + StorageImage).

### 2026-07-14 — Phase 8 Cluster A (part 1): editable creator media kit
- **Did:** Built the "You" tab into the creator's editable media kit (+ brand profile editor).
  Features: **B2-030** (read view), **B2-032** (platform stats), **B2-034** (rate card, brands-only),
  **B2-035** (preview-as-brand), **B2-036** (edit profile, creator + brand), **B2-037** (privacy),
  **B1-012** (affiliations, deferred from Phase 7).
- **Key architecture:** ONE reusable read component `components/media-kit/media-kit-view.tsx`
  (props-driven, `viewerMode: own | brand | public`, no data-fetching inside) — the own view, the
  brand preview, and the future brand-facing detail screen (8.3) all render it. Data layer
  `lib/media-kit.ts` (fetch + owned-record write helpers, house-style Result returns), enum maps
  `lib/media-kit-enums.ts`, formatters `lib/format.ts`, DB-shape completeness `lib/completeness.ts`.
  New bottom-sheet primitive `components/ui/edit-sheet.tsx` (RN Modal) + five editors under
  `components/media-kit/editors/`. Container `components/media-kit/media-kit-screen.tsx`; `you.tsx`
  is now a thin wrapper.
- **Security:** everything is owned-record CRUD → Supabase-direct under RLS (no FastAPI, per
  api-architecture.md). Existing 012 policies verified correct and NOT modified. The preview's
  visibility logic is a **client-side simulation** — code comments flag RLS as the real boundary.
- **Tests/verify:** new `backend/tests/test_media_kit_rls.py` — **10/10 PASS** (brand sees enabled
  rate cards only; owner sees own enabled/disabled; other creator sees neither; cross-user
  creator_profiles UPDATE blocked). `npx tsc --noEmit` clean. `npx expo export --platform web`
  bundles all routes incl. `/(tabs)/you` with no errors.
- **Scope:** testimonials deferred (ratings is Phase 9+, never seed fake); demographics/recent-work/
  earnings/90-day-growth omitted (no MVP table); photo carousel (B2-031) + Storage left for later.
  See ASSUMPTIONS LOG for the full list.
- **Next:** 8.2/8.3 Discovery browse + brand-facing creator detail (re-uses media-kit-view).

### 2026-07-14 — Task 8.1: Discovery mock data seed script
- **Did:** Built `backend/seeds/seed_discovery.py` — idempotent seed script populating the
  dev Supabase project with 15 fictional Indian creators + 10 fictional brands for Discovery
  to browse. Follows `test_onboarding.py`'s admin-client auth pattern (service_role,
  `auth.admin.create_user(email_confirm=True)`). No new tables/columns — uses only
  `002_identity_profile.sql` (as amended by `014_onboarding.sql`'s `niches text[]`).
- **What's seeded per creator:** profile + creator_profile (niches ≤3, languages, bio,
  privacy_settings), 1–3 social_handles (one `is_primary`, follower/engagement/reach scaled
  together across a nano→mega tier distribution weighted toward nano/micro/mid), one
  rate_card (~2/3 enabled) + 2–4 rate_card_items priced off the same tier, 0–2 affiliations,
  0–3 brand_partnerships. Per brand: one admin profile + `brands` row + `brand_members`
  (admin/active).
- **Idempotency:** cleanup matches users by the `@seed.inflo.test` email suffix (paginated
  `list_users`, since 25 seed accounts can exceed the default single-page limit), deletes
  their `brands` rows (cascades `brand_members`) then the auth users (cascades
  profiles/creator_profiles/social_handles/rate_cards/affiliations/brand_partnerships).
  Verified by running the script twice back-to-back — identical summary counts both times.
- **Verified against live dev DB:** 0 rows with >3 niches; every creator has exactly 1
  `is_primary` social handle; rate_cards split 13 enabled / 2 disabled (both RLS paths
  provable); all enum columns hold only valid enum values.
- **Explicitly not done (per task scope):** no UI, no FastAPI endpoints, no Storage upload —
  `photo_carousel`/`avatar_url` left null (Storage lands separately, see migration 016 note
  below). Migration 016 (`profile-photos` bucket) is still WRITTEN but NOT YET APPLIED — not
  needed for this task since no photos are seeded.
- **Next:** Phase 8 Discovery UI/endpoints (B2-001 browse/filter, B2-002 full profile, etc. —
  all currently "Not started" in the RTM; this task only supplies the data they'll render).

### 2026-07-13 — Phase 7 Cluster C follow-up: signature screen bug fix (device)
- **Symptoms (Expo Go, G4 test):** draw pad only captured one broken stroke (lost strokes, unresponsive);
  switching to Type crashed with a RENDER ERROR "Couldn't find a navigation context…" from
  @react-navigation NavigationStateContext.
- **Root causes + fixes:**
  1. **Draw:** PanResponder lived inside AuthShell's `<ScrollView>`, which stole the vertical drag →
     `signature-pad.tsx` now captures + holds the gesture (`on*ShouldSetPanResponderCapture`,
     `onPanResponderTerminationRequest: () => false`, and an `onPanResponderTerminate` that commits the
     in-progress stroke). Multi-stroke accumulation works.
  2. **Type crash = a NativeWind native-only bug** (nativewind#1536/1557/1711): a conditionally-toggled
     `shadow-*` className races React Navigation's context init and throws the nav-context error. Fixed
     everywhere the pattern appeared — signature.tsx, verify-otp.tsx (OTP boxes), platforms.tsx
     (threshold), and glass-surface.tsx (pillow mounts/unmounts on tab switch — the likely trigger) —
     by moving those shadows to inline `style` instead of a toggled class.
- **Also:** added `@expo-google-fonts/marck-script` (script font for the typed-signature preview only).
  Orchestrator reverted two incidental debug artifacts (`npm run ios/android` had drifted to `expo run:`;
  kept Expo Go's `expo start`). `app.json` bundleIdentifier left (harmless, Expo Go ignores it).
- **Verify:** `tsc --noEmit` 0 errors. Keshav re-tested on device — signature draw + type + full creator
  journey work; both journeys pass. Cluster C CLOSED. (Fix committed on top of `13175c1`.)

### 2026-07-13 — Phase 7 Cluster C: Signatures (7.9) + maker-checker (7.10) — BUILT, TESTED, COMMITTED
- **Did:** The security + RBAC cluster; first backend/FastAPI feature.
  - **7.9 signatures:** `signature-pad.tsx` (PanResponder→SVG paths via react-native-svg — no new
    dep/webview, web + Expo Go), `(onboarding)/signature.tsx` (draw/type toggle + clear + shield
    note) inserted into the creator flow (role→about→platforms→signature→preferences→done),
    `lib/signature.ts` `saveSignature()` (deactivates prior active then inserts; respects the
    partial-unique active-per-profile index) wired into `submitCreator`. Stored inline under
    owner-only `signatures` RLS. Storage-bucket + per-use contract signing/IP-log deferred (Phase 9).
  - **7.10 maker-checker:** config UI `maker-checker-config.tsx` (Account tab, admin-only, per-action
    toggles, solo-brand disables toggle with a hint) writing `maker_checker_config` under admin-only
    RLS; migration 015 = UNIQUE(brand_id, action_type) for clean upsert. Backend: `core/auth.py`
    (JWT verify), `services/maker_checker.py` + `api/maker_checker.py` — request lifecycle on
    service_role, segregation of duties enforced server-side at initiation AND decision, `audit_log`
    on every step. Scope boundary: mechanism + config only; live deal wiring = Phase 9.
- **Verify:** migration 015 applied to dev (constraint present); `tsc --noEmit` 0 errors; `expo
  export --platform web` clean (`/(onboarding)/signature` present); `test_maker_checker.py` 10/10
  (run twice, stable) — drives real endpoints with real JWTs (config gating, maker-can't-approve-own
  403, non-checker 403, request stays pending after refusals, assigned checker approves, audit rows,
  config-write RLS, signature RLS); `test_onboarding.py` 8/8 regression. Orchestrator security pass:
  no critical/high (auth server-verified, maker≠checker triple-guarded, audit IP non-spoofable);
  low notes logged in DECISIONS.
- **Committed** `feat: signatures & maker-checker` (also folded in the `.githooks/pre-commit`
  false-positive fix from earlier + tracked `frontend/.env.example`). **Next:** close-out — 7.12
  (phone test both journeys, G4), 7.13 (RTM), 7.14 (phase gate, G5).

### 2026-07-13 — Phase 7 Cluster B: Roles & onboarding (7.5–7.8, 7.11) — BUILT, TESTED, COMMITTED
- **Did:** Post-verify onboarding wizard on the themed shell, faithful to the (approved)
  `inflo-onboarding.html`. **Migration 014** (`niche`→`niches text[]` +≤3 CHECK; brand first-admin
  bootstrap RLS `brand_members_insert_self_bootstrap` + `brand_has_members()`), applied to dev;
  `data-model.md` updated.
  - **7.5 routing:** `_layout.tsx` now a three-way `Stack.Protected` gate — no session→`(auth)`,
    session+not-onboarded→`(onboarding)`, session+onboarded→`(tabs)`; keyed on
    `profiles.profile_completeness > 0` (`auth-store.onboarded` + `use-auth-session` query +
    `refreshOnboarded()`). New `(onboarding)` group, 6 screens; role fork = Creator/Brand only
    (agency out per scope).
  - **Wizard:** answers in `store/onboarding-store.ts`, committed once at finish via
    `lib/onboarding.ts` (`submitOnboarding` + `computeCompleteness`, idempotent upserts, completeness
    written LAST). 7.6 creator-about (display_name/city→profiles; niches/content_languages/bio→
    creator_profiles), 7.8 platforms→`social_handles` (mock stats), prefs→inbound/outbound,
    7.7 brand-details→brands + brand_members(admin,active) + profiles(brand), 7.11 done()→ring +
    `profile_completeness`. New shared UI: Chip, Toggle, OnboardingProgress; AuthShell +progress slot.
  - **Deviations (all flagged):** agency removed (scope); AI "write my bio" omitted (Phase 10
    ai_service); `content_category` not captured; platform gradients→solid; notifications toggle
    cosmetic (Phase 12); signature step deferred (7.9, Cluster C); proof()/partnerships deferred;
    ring static; brand form newly designed (mockup only had a static brand capture list).
- **Verify:** `tsc --noEmit` 0 errors; `expo export --platform web` clean (all 6 onboarding routes).
  **`backend/tests/test_onboarding.py` 8/8 PASS** against live dev DB (creator writes, ≤3 niche CHECK
  rejects a 4th, `social_handles`, brand bootstrap allowed on memberless brand, intruder blocked).
  Both journeys live-clicked on web; Devasri OK'd built screens (light G3 — mockup pre-approved).
  Orchestrator review: brand path sound (`brands_insert_authenticated` + narrow bootstrap policy),
  gate has no wrong-screen flash + fails safe to onboarding. Low notes logged (orphan-brand on
  partial failure; onboarded-user transient-error reroute; SECURITY DEFINER `search_path` — pre-
  existing across 012 helpers).
- **Committed** `feat: roles & onboarding`. **Next:** Cluster C — 7.9 signature capture + 7.10
  maker-checker (security + RBAC), then close-out 7.12 (phone test, G4) / 7.13 (RTM) / 7.14 (G5).

### 2026-07-13 — Phase 7 Cluster A: Auth core (tasks 7.1–7.4) — BUILT, TESTED, COMMITTED
- **Did:** Built the full auth loop. New `(auth)` route group (renders outside the 5-tab shell):
  `sign-up.tsx`, `verify-otp.tsx`, `login.tsx` + `(auth)/_layout.tsx`. Shared UI: `text-field.tsx`
  (recess input + show/hide + inline errors), `auth-shell.tsx` (onboarding chrome), plus
  `lib/validation.ts` + `lib/auth-errors.ts` (friendly, never-raw copy).
  - **7.1/7.2 Sign-up:** email+password with client validation → `supabase.auth.signUp`. Profiles
    row intentionally NOT created here (deferred to 7.5 — see DECISIONS).
  - **7.3 OTP:** 6-box code screen → `verifyOtp({type:'email'})`; resend with cooldown. (Supabase
    OTP length set to 6 in dashboard; on-brand email template with `{{ .Token }}`.)
  - **7.4 Session:** `lib/storage.ts` = chunking `expo-secure-store` adapter (keychain on native,
    localStorage on web), `supabase.ts` now `persistSession:true`+`autoRefreshToken:true`,
    `store/auth-store.ts` (Zustand — installed ^5.0.14, was missing) + `hooks/use-auth-session.ts`
    (getSession + onAuthStateChange + AppState refresh). `_layout.tsx` uses `Stack.Protected` to
    gate `(tabs)` vs `(auth)`; splash held until fonts AND session resolve (no wrong-screen flash).
    Temporary Log-out on the Account tab for testing.
- **Deps added:** `zustand@^5.0.14`, `expo-secure-store@~15.0.8` (SDK54-compatible).
- **G1 dashboard (done by Keshav):** email provider on, Confirm email on, OTP length 6, Site URL
  `localhost:8081`, brand template. **G2 resolved** → Brevo custom SMTP (see DECISIONS).
- **Verify:** `tsc --noEmit` = 0 errors; `expo export --platform web` clean; `test_auth_session.py`
  5/5 PASS (real Supabase: verified user → sign-in → authed own-profile insert → RLS blocks foreign
  insert → RLS scopes deals). **Keshav phone-tested the full loop on web + Expo Go — all working,
  session persists across app restart.** Security review (orchestrator-run): no critical/high; low
  notes = web localStorage tokens (accepted for MVP), client-side routing guard (RLS is real lock).
- **Committed** `feat: auth core`. **Next:** Cluster B — roles & onboarding (7.5–7.8, 7.11); first
  task 7.5 adds the post-verify → onboarding gate that creates the profile row + sets role.

### 2026-07-13 — Phase 6: connect Supabase JS client in the frontend (task 6.6)
- **Did:** Installed `@supabase/supabase-js` (2.110.2) in `frontend/`. New
  **`frontend/src/lib/supabase.ts`** — the single client module, the frontend's only Supabase
  door. Configured from Expo public env (`EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`),
  **anon (publishable) key ONLY** — no service_role in the frontend (two-key model,
  docs/api-architecture.md). Exports `supabase` (or `null` when unconfigured), `isSupabaseConfigured`,
  and `testSupabaseConnection()` — a throwaway HEAD count on `profiles` that returns a friendly
  ok/fail message (distinguishes "not configured" / "couldn't reach project" / "reached, query
  error" — never a raw dump). Session persistence intentionally OFF for now; Phase 7 auth will add a
  storage adapter.
- **Test surfaced on Discover:** `(tabs)/index.tsx` runs the check on mount and shows a small
  "Supabase check · …" line on the placeholder (throwaway; `TabPlaceholder` now takes children).
- **Env & secrets:** created **`frontend/.env.example`** (documented, tracked) and **`frontend/.env`**
  (gitignored, auto-filled from the repo-root `.env`'s `SUPABASE_URL`/`SUPABASE_ANON_KEY`). Added
  explicit `.env` to `frontend/.gitignore`. Confirmed `git status` never lists `frontend/.env`; the
  key used is `sb_publishable_…` (anon), verified **not** `sb_secret_`/service_role.
- **Verified:** `npx tsc --noEmit` = 0 errors; `expo export --platform web` bundles all 5 routes;
  graceful "not configured" path confirmed via a Node harness. **Live network test could NOT complete
  from this environment** — the project host `govozzmbcynoeijlqmxp.supabase.co` is **NXDOMAIN**
  (see NEEDS MY INPUT). Client init + credential loading + code path all work up to the network
  boundary; app shows a clean "Could not reach Supabase…" message rather than an error dump.
- **Not committed** (task 6.8). Nav/tokens/icons/"Inflo" name intact.
- **Next:** resolve the dead Supabase project (NEEDS MY INPUT), then task 6.8 (commit Phase 6).

### 2026-07-13 — Phase 6: themed 5-tab bottom-nav shell (task 6.5)
- **Did:** Replaced the template Home/Explore tabs with Inflo's 5-tab shell —
  **Discover · Chat · Track · You · Account** — rebuilt in RN from `inflo-one.html`'s
  `.bnav` (not ported).
  - **`src/components/bottom-nav.tsx`** — custom Expo Router `tabBar`. Warm translucent
    bar (`rgba(251,250,246,0.92)`) over an `expo-blur` `BlurView` (blur sits *under* the
    92% fill so it can't break native; `experimentalBlurMethod="dimezisBlurView"` for
    Android Expo Go). Respects the home-indicator safe area via `useSafeAreaInsets`.
    **Active tab = the reserved pillow-glass signature** (icon in a lifted glass pill,
    reusing `GlassSurface variant="pillow"`) — never a colour change; inactive is flat.
    Labels 11px, ink+semibold active / warm-grey (`ink-3`) medium inactive. Static green
    notification dot on Chat. Light haptic on iOS press.
  - **Icon mapping** (pre-approved SVGs only, `frontend/assets/icons/`): Discover→`discover.svg`,
    Chat→`chat.svg`, Track→`insights.svg` (bar-chart glyph, user-confirmed over line-chart.svg),
    You→`profile.svg`, Account→`settings.svg`. All inherit `currentColor` via react-native-svg's
    `color` prop.
  - **SVG-as-component tooling:** added `react-native-svg-transformer` (dev) + `expo-blur`;
    extended `metro.config.js` (svg → sourceExts, `react-native-svg-transformer/expo`
    transformer, kept `withNativeWind`); new `svg.d.ts` type decl.
  - **Routes:** `(tabs)/_layout.tsx` now lists the 5 screens with the custom `tabBar`;
    `index.tsx` → Discover, plus new `chat/track/you/account.tsx`; deleted `explore.tsx`.
    Placeholders share `src/components/tab-placeholder.tsx` (screen title on `bg-app`).
- **Verified:** `npx tsc --noEmit` = 0 errors. `expo export --platform web` bundles all 5
  routes; JS bundle contains the compiled SVGs (chat arc + `currentColor`), the warm bar
  colour, and `dimezisBlurView` → confirms the transformer + BlurView are wired. (Static
  SSR HTML is empty because the root layout gates render on Geist `fontsLoaded`; the client
  bundle hydrates fine — not a regression.) Expo Go visual check still to be eyeballed on device.
- **Not committed** (that's task 6.8). "Inflo" name + `biz` slug untouched; all 6.7 tokens intact.
- **Next:** 6.6 (Supabase client), then 6.8 (commit the whole Phase 6 frontend).

### 2026-07-12 — Phase 6: design tokens → theme + Geist font (task 6.7-build)
- **Did (tokens → NativeWind):** translated `docs/design-tokens.md` Part 2 into
  `frontend/tailwind.config.js` `theme.extend`, names traceable to the doc:
  colours (`bg-app` #FBFAF6, `dashboard`, `chatCanvas`, `surface.card/recess`,
  `hairline`/`hairline-card`, `avatar`+`ring`, `ink`/`ink-2`/`ink-3` text scale,
  `status.good`/`good-label`/`good-tint`/`neutral`/`critical`/`critical-tint`,
  `cane.1–5`, `chart.e1/e2/e3`+`-top`/`grid`/`axis`); radii (`rounded-card` 14,
  `panel` 12, `button`/`input` 16, `pill`); warm-tinted shadows (`shadow-l1`/`l2`/
  `liftIn`/`recessInset`/`pillowGlass`/`glassInset`); 5 Geist family classes
  (`font-geist`, `-medium`, `-semibold`, `-bold`, `-mono`); and the 6 type roles as
  fontSize tokens (`text-display/title/subtitle/body/secondary/micro`, each with
  lineHeight + letterSpacing — weight comes from the family class since RN picks
  weight by font FILE). **Spacing:** left Tailwind defaults untouched — its scale
  already IS the doc's 4px grid (1=4…12=48); documented in a config comment.
- **Did (gluestack consumes tokens):** remapped the LIGHT CSS-var anchor steps in
  `src/components/ui/gluestack-ui-provider/config.ts` → our palette (primary→ink
  `#1C1B18`, typography-800→secondary text, -900/950→ink, background-50→app base,
  outline-100/200/300→hairlines, success-500/600→green, error-500/600→critical red).
  Dark left as-is (MVP is light-first). Edited the owned `src/components/ui/button/
  index.tsx`: base `rounded`→`rounded-button` (16) and button text→`font-geist-semibold`.
  → a gluestack `<Button action="primary">` now renders flat ink, radius 16, Geist.
- **Did (glass material):** new `src/components/ui/glass-surface.tsx` — reusable
  `<GlassSurface variant="flush"|"pillow">` using **expo-linear-gradient** (#FFFFFF→
  #EAE7DF ~165°) + hairline + inset top-highlight overlay (so it reads convex on
  native too, where inset box-shadows aren't supported). `flush` = shared material
  (secondary btn/bubbles/bars); `pillow` = reserved nav-active signature (for 6.5).
- **Did (fonts):** `npx expo install @expo-google-fonts/geist @expo-google-fonts/geist-mono
  expo-linear-gradient`. `src/app/_layout.tsx` now loads Geist 400/500/600/700 + Mono 400
  via the `useFonts` hook (runtime-loads on web AND native/Expo Go — the config plugin is
  native-only, so hook is the cross-platform path), with `SplashScreen.preventAutoHideAsync()`
  and a render gate (returns null until loaded) → no font-flash.
- **Did (proof block):** replaced the temporary "gluestack-ui works" test button (and the
  stock Expo template Home body) in `src/app/(tabs)/index.tsx` with a minimal proof: a white
  **L1** card on `bg-app`, one line of each of the 6 type roles (+ a tabular-figures `₹45,000`),
  a good-status dot + deep-green label, and Primary (flat-ink gluestack Button) + Secondary
  (glass-flush) buttons. Mirrors `docs/inflo-style-tile.html`. Nav/real screens NOT built (6.5).
- **New free dep flagged:** `expo-linear-gradient` (standard Expo library, no cost/service) —
  needed because a CSS gradient className is web-only; this makes the glass render on native too.
- **Verify:** `npx tsc --noEmit` = **0 errors**. `npx expo start --web` → clean bundle, no
  metro/log errors; entry bundle (8.3 MB, http 200) contains all 5 Geist families, the proof
  screen + GlassSurface, and the token values compiled (app base `#FBFAF6`, `status.good.label`
  `#4F7A1E`, L1 warm shadow `0 5px 14px rgba(28,27,24,…)`, glass `#EAE7DF`). **Not yet eyeballed
  in a real browser or on a phone — user to check web (localhost) + Expo Go.** Not committed (6.8).
- **Assumption logged:** replaced the whole template Home body (not just the test button) so the
  proof sits on a clean app-base canvas to eyeball tokens; `explore.tsx`/`modal.tsx`/tab layout
  untouched. "Inflo" name, `biz` slug, icon library intact.
- **Next:** user eyeballs web + Expo Go; then themed 6.5 (nav shell — reuse `GlassSurface`
  `variant="pillow"` for active tab), 6.6 (Supabase/Zustand), 6.8 (commit).

### 2026-06-16 — Phase 6: UI library — NativeWind v4 + gluestack-ui v3 (task 6.4)
- **Decision:** NOT NativeBase (deprecated). Installed **NativeWind v4** + **gluestack-ui v3**
  (gluestack uses NativeWind as its styling engine). Resolves open decision #6.
- **Did (NativeWind):** `npx expo install nativewind tailwindcss@^3.4.17 react-native-css-interop`;
  created `tailwind.config.js`, `global.css` (3 `@tailwind` directives), `babel.config.js`
  (`babel-preset-expo` + `jsxImportSource: 'nativewind'` + `nativewind/babel`, plugin
  `react-native-worklets/plugin`), `metro.config.js` (`withNativeWind`), `nativewind-env.d.ts`;
  imported `global.css` in `_layout.tsx`. Had to `npx expo install babel-preset-expo` as an
  explicit dep (the new project-level `babel.config.js` couldn't resolve it as a transitive dep).
  Verified a `className` styled box rendered on web before moving on.
- **Did (gluestack):** `npx gluestack-ui@latest init --use-npm --path src/components/ui` (placed
  components under `src/` to match our `@/*` convention), then `npx gluestack-ui add button`.
  Wrapped root layout in `<GluestackUIProvider mode="light">`.
- **Triage (gluestack init is documented to break fresh SDK54 projects):** removed the babel
  `module-resolver` init added (aliased `@`→root, broke our `@/*`→`src/*` imports; Metro's
  tsconfig path resolution covers it); restored `jsxImportSource: 'nativewind'` in babel;
  `npx expo install --fix` to pull `safe-area-context`/`svg`/`worklets` back to SDK54-pinned
  native versions (avoids physical-phone crashes). Route default-exports + `parallax-scroll-view.tsx`
  survived intact. Pre-init full backup at `/tmp/frontend-backup-6.4` (not needed; removed).
- **Proof-of-life:** one gluestack `<Button><ButtonText>gluestack-ui works</ButtonText></Button>`
  on the Home screen (temporary — remove in 6.5).
- **Verify:** `npx tsc --noEmit` = 0 errors. `npx expo start -c` → clean web bundle (1525 modules,
  only the benign `pointerEvents` deprecation warning), `localhost:8081` → 200, button text present
  in served HTML. **No theming** (that's 6.7). **Not committed** (that's 6.8).
- **Next:** user to re-confirm on web (localhost:8081) + Expo Go on phone. Then 6.5 (nav/screens).

### 2026-06-16 — Phase 6: SDK 55 → 54 downgrade + template re-scaffold (task 6.3)
- **Did:** Stopped the running SDK55 server, confirmed ports 8081/8082 clear. Ran
  `npx expo install expo@^54` then `npx expo install --fix` (clean `node_modules`/
  `package-lock.json` reinstall needed again for an ERESOLVE conflict, same pattern as the
  55 downgrade). This realigned deps to SDK54 but left 18 `tsc` errors because the SDK56
  template's placeholder screens (`src/app/`, `src/components/`, `src/hooks/`) use APIs
  that don't exist in SDK54's `expo-router@~6.0.24` (Native Tabs, `SFSymbols7_0`,
  `ColorSchemeName`). Per user's choice (re-scaffold, not hand-patch), scaffolded a fresh
  `npx create-expo-app --template default@sdk-54` into a temp dir, then replaced
  `frontend/src/{app,components,hooks,constants}` and reconciled `frontend/assets/images/`
  with that template's files. Added 4 missing deps (`expo-haptics`, `@expo/vector-icons`,
  `@react-navigation/bottom-tabs`, `@react-navigation/elements`). Removed the SDK56-only
  `assets/expo.icon/` bundle + `app.json`'s `ios.icon` ref (→ `ios.supportsTablet: true`)
  and orphaned SDK56 template assets. Deleted the temp scaffold dir afterward.
- **Verified:** `npx tsc --noEmit` → 0 errors. `npx expo start -c` → clean cache rebuild,
  "Web Bundled" with no errors, `localhost:8081` → 200. Manifest `sdkVersion` →
  `"54.0.0"`. New QR generated for `exp://192.168.1.5:8081`. "Inflo" name, `biz`
  slug/scheme, and `frontend/assets/icons/` (119-icon custom library) all untouched.
- **Next:** user re-scans the fresh QR in Expo Go on test phones to confirm SDK 54 loads
  (Expo Go reported "Supported SDK: 54", so this should now match). Then 6.4+ (NativeBase
  evaluation, Zustand, Supabase JS client).

### 2026-06-15 — Phase 6: SDK 56 → 55 downgrade (Expo Go compatibility)
- **Did:** Stopped the running dev server. Removed `@expo/ui` + `expo-glass-effect`
  (SDK56-only, unused). Ran `npx expo install expo@^55` then `npx expo install --fix`
  (twice — first pass had a stale-`node_modules` ERESOLVE conflict on `expo-router`/
  `@expo/log-box`, fixed with a clean `node_modules`/`package-lock.json` reinstall).
  Result: `expo ~55.0.x`, `react-native 0.83.6`, `react`/`react-dom` 19.2.0,
  `expo-router ~55.0.16`, `typescript ~5.9.2`, all `expo-*` at `~55.x`.
  Fixed one resulting type error: SDK 55's `expo-router` doesn't re-export
  `DarkTheme`/`DefaultTheme`/`ThemeProvider` (an SDK 56 convenience) — added
  `@react-navigation/native` as an explicit dependency (via `npx expo install`) and
  changed the import in `frontend/src/app/_layout.tsx` to source those three from there.
- **Verified:** `npx tsc --noEmit` → 0 errors. `npx expo start -c` → clean cache rebuild,
  "Web Bundled" with no errors, `localhost:8081` → 200. New QR generated for
  `exp://192.168.1.5:8081`. No screens/branding/icons changed — `app.json` ("Inflo"
  name, `biz` slug/scheme) untouched.
- **Next:** user re-scans the QR in Expo Go on test phones to confirm SDK 55 loads.

### 2026-06-15 — Phase 6: Expo app scaffolded (task 6.1)
- **Did:** Scaffolded `frontend/` with `npx create-expo-app@latest` (Expo Router +
  TypeScript template, SDK 56), merging it into the existing `frontend/` dir (removed
  `.gitkeep`, scaffolded to a temp dir first since the CLI needs an empty target).
  Removed the template's auto-generated `CLAUDE.md`/`AGENTS.md`/`.claude/`/`LICENSE`
  (conflict with this repo's own `CLAUDE.md` + `.claude/`). Renamed the placeholder
  `frontend-scaffold-tmp` name/slug to `biz-frontend` / `Biz` (`app.json`, `package.json`).
  Added the standard auto-generated `expo-env.d.ts` (gitignored) so `npx tsc --noEmit`
  passes with 0 errors.
- **Verified:** `frontend/package.json`, `app.json`, `tsconfig.json`, `src/app/` (Router
  routes: tab layout with Home + Explore placeholders) all present; `npx tsc --noEmit`
  exits 0; no nested `.git`; `node_modules/` correctly ignored by root `.gitignore`.
  Dev server **not** started (task 6.2). Nothing committed yet (task 6.8).
- **Next:** 6.2 — run the dev server, confirm it loads on web (and phone via Expo Go).

### 2026-06-10 — Phase 5 complete
- **Did:** Closed out Phase 5 (Backend & Database Foundation): 42-table schema + RLS + grants
  applied to the dev Supabase project (001–013), RLS verified with dummy users (4/4 PASS),
  FastAPI skeleton up (`main.py`, `core/`, `services/ai_service.py`, `api/health.py`),
  `/health` and `/docs` confirmed working, Supabase connection test passing. `.env` confirmed
  not tracked by git.
- **Next:** Phase 6 — Expo frontend foundation.

### 2026-06-10 — Phase 5: dev server run command confirmed (task 5.11)
- **Did:** Verified `cd backend && .venv/bin/uvicorn main:app --reload --port 8000` boots
  cleanly; `GET /health` → 200 `{"status":"ok","env":"development"}`, `GET /docs` → 200
  Swagger UI HTML.
- **Found:** `uvicorn backend.main:app` from the repo root does **not** work —
  `ModuleNotFoundError: No module named 'api'`, because `backend/main.py` etc. use absolute
  imports that assume `backend/` is the import root. Documented as the supported run command
  above (Option 1 — run from inside `backend/`); not changing the import style for now.

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
