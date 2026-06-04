# Stack Decisions — Biz MVP

> **Status:** Locked v1 — 2026-06-04
> Do not change any decision here without a deliberate, versioned discussion.
> These choices are permanent for the MVP build; revisit only at v2.

---

## 1. Full Tech Stack

### Frontend
| Choice | Why |
|---|---|
| **Expo (React Native + React Native Web)** | One codebase runs as a web app now (for MVP) and compiles to iOS/Android later without a rewrite. Critical for a solo builder. |
| **TypeScript** | Catches type errors before they become runtime bugs. Claude Code writes safer, more predictable code with it. No meaningful overhead. |
| **Expo Router** | File-based navigation — the same mental model as web routing. Works across web and native. |
| **NativeBase** | Cross-platform UI component library (web + iOS + Android). Re-evaluate at task 6.4 — if a better option exists by then, flag before switching. |
| **Supabase JS client (anon key only)** | Frontend talks to Supabase directly for auth, simple reads, realtime subscriptions, and file storage — all protected at the DB level by RLS. The anon key is safe to expose in frontend code because RLS is the real lock. |

### Backend
| Choice | Why |
|---|---|
| **Python + FastAPI** | Fast to write, excellent for AI/ML integrations, strong typing support, and Claude Code handles it well. FastAPI's auto-docs make the API self-documenting. |
| **Supabase Python client (service_role key)** | Backend uses the elevated service_role key to perform privileged operations (deal-stage transitions, contract generation, RBAC enforcement). This key never touches the frontend. |
| **WeasyPrint** | Generates contract and invoice PDFs from HTML/CSS templates on the backend. Free, no external API call, no per-page cost. |
| **Google Gemini API** | Powers the AI contract parser. Free tier is sufficient for MVP usage. Always called through the `ai_service` abstraction layer — see below. |
| **Resend** | Transactional email (OTP, stage notifications, payment reminders). Free tier: 3,000 emails/month — enough for MVP. Simple API. |

### Data & Infrastructure
| Choice | Why |
|---|---|
| **Supabase (PostgreSQL)** | Managed Postgres with built-in Auth, Realtime (websockets), Storage, and Row Level Security. Replaces four separate services in one free-tier product. |
| **Row Level Security (RLS)** | Database-level access control. Every table has RLS policies so users can only read/write data they're authorised to see — even if there were a bug in application code, the DB enforces the rules. |
| **Vercel** | Hosts the Expo web frontend. Free tier, deploys from GitHub automatically on push. |
| **Railway** | Hosts the FastAPI backend. Free tier for MVP. Deploys from GitHub. |
| **Git + private GitHub repo** | Version control and safety net. Every feature committed before moving on. Repo is private — this is your IP. |

### AI Abstraction Layer (critical rule)
All AI calls go through a single `ai_service` module in the backend. No screen or endpoint calls Gemini directly. Why: if we ever swap Gemini for another model (e.g. Claude), it is a one-file change, not a refactor across the whole codebase.

---

## 2. Monorepo

**Decision: One monorepo for everything.**

```
/               ← repo root
├── frontend/   ← Expo app
├── backend/    ← FastAPI app
├── docs/       ← all specs, this file, progress log
└── .claude/    ← hooks, commands, settings
```

**Why:** Solo builder. There is no reason to coordinate across two separate repos. Shared docs, one commit history, one place to look. If the team grows significantly post-MVP, splitting is straightforward.

---

## 3. TypeScript (Frontend)

**Decision: TypeScript, strict mode on.**

Plain JavaScript on the frontend is ruled out. TypeScript catches mistakes at write-time (wrong field name, wrong data type) rather than at runtime on a user's device. Strict mode means the type-checker is thorough rather than lenient. Path aliases configured (`@/` maps to the frontend root) for clean imports.

This is a config setting — it requires no ongoing decisions from you.

---

## 4. Frontend State Management

**Decision: Zustand + Supabase Realtime + local `useState`.**

| Layer | Tool | What it holds |
|---|---|---|
| Global app state | **Zustand** | Auth session, current user profile, active deal context, notification count |
| Live data | **Supabase Realtime** | New messages, deal stage changes, notification events — streamed as they happen |
| Local screen state | **React `useState`** | Form inputs, toggles, loading flags — anything that doesn't need to be shared |

**Why Zustand:** Tiny (1KB), zero boilerplate, TypeScript-native, and pairs naturally with Supabase's subscription model. No server-state caching library (like React Query) needed — Supabase client handles data fetching cleanly for MVP scale. Redux is overkill for a solo MVP.

**Why not React Context alone:** Context re-renders every subscriber on any change. Fine for simple things (theme, locale), not suitable for frequently-updating deal state.

**Cost & security:** Zustand is open-source, runs entirely on the user's device, no external server, no subscription, no data leaves the phone.

---

## 5. Environments

**Decision: Two environments — Local and Production. No staging for MVP.**

| Environment | What it is | When used |
|---|---|---|
| **Local** | App runs on your laptop. Frontend at `localhost`, backend at `localhost:8000`, Supabase running via CLI (`supabase start`). Phone connects via same wifi. | All day-to-day development and testing (Phases 5–13). |
| **Production** | Frontend on Vercel, backend on Railway, hosted Supabase project. A real public URL. | Phase 14 onwards — phone testing, co-founder review, market research with potential customers. |

**Why no staging:** A staging environment would require a second Supabase project (separate free-tier account) and a second Railway instance. It adds complexity and hits free-tier limits with no meaningful benefit at MVP scale. Local dev *is* your staging environment.

**Splitting to production later:** Done in Phase 14. It is a 2–3 hour task (create Supabase project, configure Vercel and Railway deployments, set environment variables). The workplan has dedicated tasks for it (14.1–14.4).

**Environment variables:** All secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`) live in `.env` locally and in platform variables (Railway/Vercel dashboards) for production. Never committed to Git.

---

## Summary Table

| Decision | Choice | Locked? |
|---|---|---|
| Frontend framework | Expo (React Native Web + Native) | ✅ Yes |
| Frontend language | TypeScript, strict mode | ✅ Yes |
| Frontend navigation | Expo Router | ✅ Yes |
| Frontend UI library | NativeBase (re-evaluate at task 6.4) | ✅ Yes |
| Frontend state | Zustand + Supabase Realtime + useState | ✅ Yes |
| Backend language/framework | Python + FastAPI | ✅ Yes |
| Database | Supabase (PostgreSQL + RLS) | ✅ Yes |
| Auth | Supabase Auth (email OTP only for MVP) | ✅ Yes |
| Realtime | Supabase Realtime | ✅ Yes |
| File storage | Supabase Storage | ✅ Yes |
| AI provider | Google Gemini (free tier) via `ai_service` abstraction | ✅ Yes |
| PDF generation | WeasyPrint | ✅ Yes |
| Email | Resend (free tier) | ✅ Yes |
| Frontend hosting | Vercel | ✅ Yes |
| Backend hosting | Railway | ✅ Yes |
| Repo structure | Monorepo (one private GitHub repo) | ✅ Yes |
| Environments | Local + Production (no staging for MVP) | ✅ Yes |
| Cost rule | Everything on free tiers; flag before adding any paid service | ✅ Yes |

---

