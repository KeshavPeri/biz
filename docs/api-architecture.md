# API Architecture — Supabase-direct vs FastAPI — Biz MVP

> **Depends on:** data-model.md (tables + RLS anchor), rbac.md (who may act), deal-engine.md
> (which actions are gated state transitions), security.md (RLS policy detail).

---

## The boundary, in one line

**The frontend talks to Supabase directly for reading and simple owned-record writes; everything
that changes deal state, uses AI, generates a document, sends email, or needs elevated privileges
goes through FastAPI.**

---

## The two keys (the whole reason this split exists)

| Key | Lives in | Powers | Lock |
|---|---|---|---|
| **anon key** | the frontend (public) | Supabase-direct calls | **RLS** — the database itself decides which rows this user may read/write |
| **service_role key** | the backend only (secret) | FastAPI's Supabase calls | **bypasses RLS** — so FastAPI *must* enforce the rules itself (RBAC + state machine) |

The anon key being public is fine *because RLS is the real lock*. The service_role key can do
anything, so it never touches the client and the code behind it is responsible for every check.

---

## The routing test

Send an operation through **FastAPI** if any of these is true:

1. It **changes a deal's stage** (the server is the source of truth for the state machine).
2. It **uses AI** (summary, extraction, conflict check — via the `ai_service` layer).
3. It **generates a document** (contract / invoice PDF via WeasyPrint).
4. It **sends email** (Resend).
5. It needs the **service_role key** or must **bypass/transcend RLS**.
6. It must be **audited** (signing, payment, role changes, overrides).
7. It enforces a rule **beyond simple ownership** (maker-checker, RBAC gates, exclusivity check).

Otherwise it goes **Supabase-direct** (protected by RLS): auth, reads, realtime subscriptions,
file storage, and simple create/update/delete on records the user owns.

---

## Why not route everything one way

- **Not all-direct:** stateful, sensitive, AI, and document operations need server authority,
  secret keys, and an audit trail. RLS can't express "maker ≠ checker" or "call Gemini".
- **Not all-FastAPI:** Supabase-direct + RLS is faster to build, gives realtime subscriptions and
  storage for free, and keeps the backend surface small. Forcing every read through FastAPI would
  be slower to build and slower at runtime for no benefit.

---

## Per-domain operation mapping

Legend: **SB** = Supabase-direct (anon key + RLS) · **API** = FastAPI (service_role)

### Auth & onboarding
| Operation | Path | Why |
|---|---|---|
| Sign up, log in, email OTP, session refresh | SB | Supabase Auth handles it |
| Read / update own profile, creator_profile | SB | Owned-record CRUD, RLS = own rows |
| Add / edit social handles, affiliations, brand partnerships | SB | Owned-record CRUD |
| Create brand; invite/remove members; assign brand standing | SB | CRUD with admin-only RLS policy |
| Configure maker-checker rules | SB | CRUD with admin-only RLS policy |
| Create / update own stored signature | SB | Owned-record CRUD (using it to sign is API — below) |
| Manage notification preferences | SB | Owned-record CRUD |

### Discovery (mock)
| Operation | Path | Why |
|---|---|---|
| Browse / filter creators or businesses | SB | Public reads on mock data, RLS-scoped |
| View full profile / media kit | SB | Read |
| View rate card (brands only) | SB | Read, gated by RLS policy |
| **Basic Connect (creates the deal)** | API | Initialises the deal + participants + direction, runs the exclusivity check, enters the state machine |

### Deal engine — reads & simple writes
| Operation | Path | Why |
|---|---|---|
| Read deals, messages, deliverables, terms, contracts, payments | SB | Reads, RLS = deal participants |
| Live message / notification updates | SB | Supabase Realtime subscription |
| Send a chat message | SB | Simple insert, RLS = participant |
| Upload chat media / content draft files | SB | Supabase Storage, RLS-scoped |
| Edit deal name; set private labels; mark messages read | SB | Owned/participant CRUD |
| Post-deal comments; ratings on close | SB | Simple inserts, RLS-scoped |

### Deal engine — gated actions (all API)
| Operation | Path | Why |
|---|---|---|
| Accept / decline connection (stage change) | API | State transition + guard |
| Request terms summary / confirm request | API | Gated trigger; both-confirm logic |
| Generate AI terms summary | API | AI (`ai_service` → Gemini) |
| Approve summary (all-party sign-off gate) | API | Gated transition + audit |
| Generate contract PDF | API | WeasyPrint, service_role |
| Run contract parser + conflict check | API | AI |
| Apply digital signature | API | Audited, gated, IP-logged |
| Maker-checker request / approve / reject / override | API | RBAC gate + audit |
| Share brief; submit content for review; approve / request revision | API | State + maker-checker + revision counter |
| Submit live post URL (Posted hard gate) | API | Validates + fetches preview + transitions |
| Confirm post live | API | State transition |
| Capture invoice/payment info | API | Validates both sides before Payment activates |
| Update payment status; confirm payment received | API | Authoritative state + audit |
| Raise / resolve dispute | API | Pauses payment, notifies ops, audited |
| Confirm close | API | Mutual-gate transition |
| Add participant (with all-party approval) | API | Approval flow + audit |

### AI parser
| Operation | Path | Why |
|---|---|---|
| Any extraction, summary, or conflict-detection call | API | AI only ever runs server-side via `ai_service` |

### Tracking
| Operation | Path | Why |
|---|---|---|
| Read deal / payment / rights trackers | SB | Reads (RLS-scoped views) |
| Calendar feed | SB | Read across deliverables / payments / rights (a view) |
| Monthly summary, RAG status, completeness % | SB | Computed via DB views/functions, read directly |
| Send scheduled payment reminders | API | Scheduled job → Resend (email + service_role) |
| Rights-expiry alerts | API | Scheduled job → notifications + email |

### Notifications & audit
| Operation | Path | Why |
|---|---|---|
| Read notifications; mark read | SB | Owned-record CRUD, RLS |
| Live notification delivery | SB | Supabase Realtime |
| Create a notification | API | Emitted server-side as part of an action |
| Send any email | API | Resend, service_role key |
| Write an audit-log row | API | Server-only; never client-writable |

---

## How the two paths share one database

Both paths read and write the same Postgres. They differ only in *who enforces the rules*:

- A **chat message** is a Supabase-direct insert. RLS confirms the sender is a deal participant.
  That's the only rule, so the database alone can enforce it — no backend needed.
- A **stage advance** is a FastAPI call. It checks the caller's per-deal role, the current stage,
  and the guard conditions; updates `deals.stage`; writes `deal_stage_transitions`; emits
  notifications; writes an audit row — then commits. Too many rules for RLS to express, so the
  server owns it.

Both then surface live to clients through the same Realtime subscriptions.

---

## Two worked examples

**Sending a message (SB):**
client → Supabase insert into `messages` (anon key) → RLS checks participant → row saved →
Realtime pushes it to the other participants. No backend involved.

**Advancing Chatting → Approval (API):**
client → `POST /deals/{id}/approve-summary` (FastAPI) → server verifies caller is a participant,
all approvals are in, deal is in Chatting → updates stage, logs the transition, generates the
contract PDF, emits notifications, writes audit → returns → clients see the new stage via Realtime.

---

## Deferred (MVP-2)

Real payment processing endpoints (gateway calls) · webhook handlers for live social-platform
APIs · brand-uploaded-contract parsing endpoint · push-notification delivery service.
