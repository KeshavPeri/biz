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

- **Current phase:** Phase 7 — Identity & Trust (Bucket 1). **Cluster A (Auth core, 7.1–7.4)
  BUILT + PHONE-TESTED + committed** `feat: auth core` on 2026-07-13. Full loop works end-to-end
  on web + device: sign up (email+password) → email OTP (6-digit) → land in app → log out → log
  back in → session persists across restart. Security-reviewed (no critical/high). **Next up:
  Cluster B — roles & onboarding (7.5–7.8, 7.11).** RTM Build columns for Bucket 1 to be filled
  at task 7.13 (per the Phase 7 handoff plan).
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
