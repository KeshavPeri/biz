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
- A large **architectural change** that contradicts `docs/technical-spec` or this file
- Handling **real secrets/keys** (always use `.env`; never hardcode or commit them)
- Anything irreversible you're less than ~80% confident about

Everything else: just do it, commit, and keep going.

## At the start of every session

1. Read this file and `docs/progress.md`.
2. Check which workplan task we're on (master task list = the Build Workplan sheet).
3. Use **Plan Mode** for anything non-trivial: show me the plan, then build.
4. At the end of the session (or when context gets long), write what you did and what's
   next into `docs/progress.md`, so the next session picks up cleanly.

---

## Tech stack (locked — do not substitute without flagging)

**Frontend**
- Expo (React Native + React Native Web) — one codebase for web now, iOS/Android later
- TypeScript
- Expo Router (navigation)
- NativeBase (UI components) — confirm still the best current option at task 6.4
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

- **Frontend → Supabase directly** for: auth, simple CRUD, realtime subscriptions,
  file storage. Access is protected by **RLS** at the database level.
- **Frontend → FastAPI** for: AI parsing, PDF/contract generation, gated deal-stage
  transitions, and anything sensitive or needing the service_role key.
- **The server is the source of truth.** Deal-stage transitions and RBAC are enforced
  in FastAPI / RLS — never trust the client to enforce rules.

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

These live in `/docs` and are the authority for design decisions. Most don't exist yet
(we build them in Phase 3) — as each is created, treat it as canonical:

- `technical-spec` — the locked technical design
- `stack-decisions` — stack choices + reasoning
- `data-model` — database schema and relationships
- `deal-engine` — the 7-stage deal state machine
- `rbac` — roles and the permission matrix
- `api-architecture` — what goes to Supabase-direct vs FastAPI
- `ai-parser` — the 22-field contract extraction
- `security` — encryption, RLS strategy, secrets handling
- `scope` — MVP in/out boundaries
- `design-direction` — look & feel brief (from my co-founder)
- `rtm.md` - Requirement Traceability Matrix : every feature -> its code -> its test -> status (update after each feature)
- `progress.md` — running log of what's done / what's next

---

## MVP scope

**IN:** Creator + Brand users · full 7-stage deal engine · AI contract parser (22 fields)
· trackers (deal RAG status, payment **tracking only**, calendar, rights/exclusivity)
· Discovery as a **placeholder with mock data** · notifications (in-app + email)
· security, RBAC, audit log.

**OUT (deferred):** Agency user type · real payment **processing** · tax tool ·
full document hub · live marketplace with real social-platform APIs · app-store deployment
· SMS OTP (email OTP only for MVP).

If a request would pull something from OUT into the build, flag it — don't silently expand scope.

## Build sequence (buckets, in dependency order)

1. **Identity & Trust** — auth, OTP, roles, onboarding, signatures
2. **Discovery** — placeholder on mock data
3. **Deal Engine** — chat, 7 stages, contracts, signing, content, posting, payment tracking
4. **AI Contract Parser** — extract the 22 fields, feed the trackers
5. **Tracking** — deal/payment/calendar/rights trackers, auto-populated from the parser

**Security & Notifications** are not a final step — build them alongside everything from day one.

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
