# CLAUDE.md — Project Guide for Biz

> **Biz** is a placeholder name. Swap it everywhere once the real name is chosen
> (candidates: Handshake, DealDesk, Collab).

---

## What we're building

Biz is a **B2B deal operating system for the creator economy in India**. It connects
**Creators** and **Brands** and manages the full lifecycle of a brand–creator deal —
from first contact, through negotiation, an AI-generated contract and e-signature,
content creation, posting, payment tracking, and close.

The marketplace is just the front door. The real product is the **structured deal flow**
that replaces the chaos of WhatsApp + spreadsheets.

## Who you're working with

I'm the technical co-founder but **not a professional coder**. I understand concepts,
not syntax. So:

- Explain what you're doing and *why* in plain language.
- When you make a technical choice, give me a one-line "why" I can follow.
- Don't dump long code walkthroughs unless I ask — a short summary is better.
- If I'm about to do something risky or wrong, tell me directly.

---

## How to work with me (autonomy contract)

I'm often away while you work, and that's fine — **keep moving, don't wait on me.**

**Proceed without asking** for any routine action:
- Read/write files anywhere in this repo
- Run the dev servers (uvicorn, expo), tests, linters, formatters
- Install dependencies (pip, npm)
- Create and run database migrations **against the dev database**
- Make git commits and normal git operations
- When a small detail is ambiguous, **make the most reasonable assumption, proceed,
  and record the assumption** in `docs/progress.md`. Don't stop just to ask.

**STOP and leave a clear note in `docs/progress.md`** (do NOT proceed) only when an
action is high-stakes or hard to reverse:
- Deleting data, dropping tables, or destructive migrations on anything but throwaway dev data
- `git push --force`, rewriting history, or deleting branches
- Anything touching **production / live deployment, real user data, or live payment state**
- Adding a **new paid service** or anything that incurs cost
- A large **architectural change** that contradicts `docs/technical-spec.md` or this file
- Handling **real secrets/keys** (always use `.env`; never hardcode or commit them)
- Anything irreversible you're less than ~80% confident about

Everything else: just do it, commit, and keep going.

## At the start of every session

1. Read this file and `docs/progress.md`.
2. **`docs/technical-spec.md` is the locked, consolidated build spec — the front door to
   all design decisions.** Read the relevant section before building a feature.
3. Check which workplan task we're on (master task list = the Build Workplan sheet).
4. Use **Plan Mode** for anything non-trivial: show me the plan, then build.
5. At the end of the session (or when context gets long), write what you did and what's
   next into `docs/progress.md`, so the next session picks up cleanly.

---

## Tech stack (locked — do not substitute without flagging)

**Frontend**
- Expo (React Native + React Native Web) — one codebase for web now, iOS/Android later
- TypeScript
- Expo Router (navigation)
- gluestack-ui v3 + NativeWind (UI components + styling) — **chosen at task 6.4**, replacing
  NativeBase (now deprecated; gluestack is its maintained successor). Copy-in/own-your-components
  model styled with Tailwind/NativeWind tokens → maximum design control, not a generic look.
  Confirmed working on Expo SDK 54. The co-founder's theme (6.7) is a NativeWind/Tailwind token
  config derived from `docs/design-direction.md`.
- Zustand (global state: auth, user session, active deal context) + Supabase
  Realtime (live data) + React useState (local screen state)
- Supabase JS client — uses the **anon key only**

**Backend**
- Python + FastAPI
- Supabase Python client — uses the **service_role key, backend only**
- WeasyPrint (contract/invoice PDF generation from HTML templates)
- Gemini (Google AI) for AI features — **always behind an `ai_service` abstraction layer**
  so the provider can be swapped (e.g. to Claude) with a one-line change
- Resend (transactional email)

**Data & infrastructure**
- Supabase: PostgreSQL + Auth + Realtime + Storage + Row Level Security (RLS)
- Hosting: local during development; **Vercel** (frontend) + **Railway** (backend) when
  deploying for phone testing
- Git + a **private** GitHub repo

**Cost rule:** everything stays on free tiers for now. AI calls use Gemini's free tier.
Don't introduce a paid service without flagging it first.

## Architecture

- **Frontend → Supabase directly** for: auth, simple owned-record CRUD, realtime
  subscriptions, file storage. Access is protected by **RLS** at the database level.
- **Frontend → FastAPI** for: AI parsing, PDF/contract generation, gated deal-stage
  transitions, email, and anything sensitive or needing the service_role key.
- **Two-key model:** the **anon key** is public and safe *because RLS is the real lock*;
  the **service_role key** bypasses RLS and lives **backend-only**, so FastAPI must enforce
  every rule itself (RBAC + the state machine).
- **The server is the source of truth.** Deal-stage transitions and RBAC are enforced
  in FastAPI / RLS — never trust the client to enforce rules.

> Full routing detail (the test for SB-direct vs FastAPI): `docs/api-architecture.md`.

## Critical design rules (and where they live)

The locked design is in `/docs`. Don't re-derive or contradict it — read the doc, then build.
These are the rules that cause real damage or rework if broken:

- **Data model — `docs/data-model.md` is the source of truth.** 42 tables, 9 domains.
  Don't invent tables/columns. `deal_participants` is the **RLS anchor** (visibility =
  "are you a participant on this deal?"). The 22 parser fields map to specific columns —
  use the storage map; don't free-form them.
- **Deal engine — `docs/deal-engine.md`.** 7 stages, **forward-only**, **server-enforced**,
  **every transition logged** to `deal_stage_transitions`. `Disputed` is an **overlay on
  Payment, not a stage**; `Declined`/`Cancelled` are terminal off-ramps. Client requests a
  transition; it never performs one.
- **API split & two-key — `docs/api-architecture.md`.** Route through FastAPI if it changes
  deal state, uses AI, generates a document, sends email, needs service_role, must be
  audited, or enforces a rule beyond simple ownership. Otherwise Supabase-direct (anon + RLS).
- **AI — `docs/ai-parser.md`.** All AI goes through the single **`ai_service`** module —
  **never call Gemini directly**. The parser **never guesses** (returns
  `found`/`not_discussed`/`ambiguous`); the human confirms before terms bind.
- **Roles & security — `docs/rbac.md` + `docs/security.md`.** Enforce RBAC server-side;
  **maker ≠ checker** on the same action (segregation of duties); RLS + RBAC are
  defence-in-depth; sensitive actions write to the **immutable audit log**.
- **Scope guardrail — `docs/scope.md`.** Only **Tier 1 (the 93 MVP features)** is in scope.
  If a task pulls in anything from MVP-2 / MVP-3 / Future, **stop and flag in
  `docs/progress.md`** — don't silently expand scope.
- **Open decisions — `docs/technical-spec.md` §13.** A short list of "needs a call before
  production" items (retention, AI-data privacy, DPDP, whitelisting access, Railway worker,
  account deletion). *(UI library resolved at 6.4: gluestack-ui v3 + NativeWind.)* Don't resolve
  these silently. Near-term: confirm Railway's
  free tier supports a background worker before the production split (Phase 14).

## Environments

- **Local:** frontend + backend run on your laptop; phone connects via wifi. Used
  for all development (Phases 5–13).
- **Production:** Vercel (frontend) + Railway (backend) + hosted Supabase. A real
  public URL for phone testing and market research. Set up in Phase 14.
- No staging environment for MVP — local dev is your staging. Splitting to
  production later is a ~2–3 hr task (workplan Phase 14).

## Folder structure (monorepo)

```
/                 repo root
├── frontend/     Expo app (TypeScript)
├── backend/      FastAPI app
│   └── migrations/   SQL schema migrations
├── docs/         specs + progress log (source of truth, see below)
├── .claude/      skills, commands, settings.json (hooks)
├── .env          secrets — GITIGNORED, never committed
├── .env.example  key names with blank values — tracked
└── CLAUDE.md     this file
```

## Source-of-truth documents

These live in `/docs` and are the authority for design decisions. As of Phase 3 they are
**written and locked** — treat them as canonical; if code and a doc disagree, the doc wins
(and flag it). Start from `technical-spec.md`, which consolidates the rest.

- `docs/technical-spec.md` — **the locked, consolidated technical design (v1). Read first.**
- `docs/stack-decisions.md` — stack choices + reasoning (locked)
- `docs/scope.md` — MVP in/out boundaries (the four scope tiers)
- `docs/feature-inventory.md` — the 93 MVP features in 7 buckets (the RTM source)
- `docs/data-model.md` — the 42-table database schema + the 22-field storage map
- `docs/deal-engine.md` — the 7-stage deal state machine
- `docs/rbac.md` — roles and the permission matrix
- `docs/api-architecture.md` — Supabase-direct vs FastAPI (the two-key routing rule)
- `docs/ai-parser.md` — the 22-field contract extraction (behind `ai_service`)
- `docs/notifications.md` — the 3 tiers + event catalogue (in-app + email)
- `docs/security.md` — auth, RLS strategy, encryption, secrets, audit log, privacy
- `docs/design-direction.md` — **the visual source of truth: brand personality, references,
  colours, typography, do's/don'ts** (from my co-founder). Read before building any UI-visible
  feature. The SVG icon library lives at `frontend/assets/icons/` — use those icons; do not
  invent or import other icon sets without flagging.
- `docs/rtm.md` — Requirement Traceability Matrix: every feature → its code → its test →
  status (update after each feature). 13 columns across 4 sections — **Explore** (Feature ID,
  Feature, Bucket, Phase, Priority, Scope) and **Design** (Design Summary, Build Elements) are
  pre-populated. When implementing a feature, fill **Build** columns: Code File(s), Build Status
  (`Not started → In progress → Built → Blocked → Deferred`), Build Notes. When tests are
  written, fill **Test** columns: Test ID(s), Test Status (`Not written → Written → Passing →
  Failing`).
- `docs/progress.md` — running log of what's done / what's next

---

## MVP scope

**93 features across 7 buckets** (full list: `docs/feature-inventory.md`; boundary: `docs/scope.md`).

**IN:** Creator + Brand users · full 7-stage deal engine · AI contract parser (22 fields)
· trackers (deal RAG status, payment **tracking only**, calendar, rights/exclusivity)
· Discovery as a **placeholder with mock data** · notifications (in-app + email)
· security, RBAC, audit log.

**OUT (deferred):** Agency user type · real payment **processing** · tax tool ·
full document hub · live marketplace with real social-platform APIs · brand-uploaded
contracts · app-store deployment · SMS OTP / 2FA (email OTP only for MVP).

If a request would pull something from OUT into the build, flag it — don't silently expand scope.

## Build sequence (buckets, in dependency order)

1. **Identity & Trust** (Phase 7) — auth, OTP, roles, onboarding, signatures
2. **Discovery** (Phase 8) — placeholder on mock data
3. **Deal Engine** (Phase 9) — chat, 7 stages, contracts, signing, content, posting, payment tracking
4. **AI Contract Parser** (Phase 10) — extract the 22 fields, feed the trackers
5. **Tracking** (Phase 11) — deal/payment/calendar/rights trackers, auto-populated from the parser

**Security & Notifications** (Phase 12) are not a final step — build them alongside everything
from day one.

---

## Coding conventions

- TypeScript on the frontend; Python type hints on the backend.
- Small, single-purpose functions with clear names; keep components small.
- Comment the *why*, not the obvious *what*.
- Consistent, descriptive file names.
- Handle errors gracefully — never show a raw technical error to a user.

## Golden rules (non-negotiable)

1. **Plan Mode first** on non-trivial tasks — show the plan before building.
2. **Commit after every feature** — this is the safety net for unattended work.
3. **Never commit secrets** — keys live in `.env` only; confirm `git status` never lists it.
4. **AI runs on realistic fictional data, for real** — use real-looking but fake data and
   let the AI genuinely process it; never hardcode placeholder AI responses. Never feed
   real people's private data while testing.
5. **Manage context** — when a session gets long, update `docs/progress.md` and start fresh.
6. **Update the RTM** after each feature is built + tested.
7. **Respect task order** — later tasks assume earlier ones are done.
