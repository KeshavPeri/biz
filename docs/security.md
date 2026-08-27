# Security Model — Biz MVP

> **Depends on:** data-model.md (RLS anchor, `audit_log`), rbac.md (action permissions),
> api-architecture.md (the two-key boundary), ai-parser.md (AI data handling).

---

## Philosophy

Five principles drive every decision below.

1. **Defence in depth.** Two independent layers — RLS (which rows you can touch) and RBAC (which
   actions you can perform). A mistake in one is caught by the other.
2. **The server is the source of truth.** The client may *request*; for anything that matters, the
   server decides whether it happens.
3. **Least privilege.** Each key, role, and policy grants the minimum needed.
4. **Never trust the client.** All enforcement is server-side (FastAPI + Postgres/RLS). Frontend
   checks are for UX only, never for security.
5. **Lean on managed services for the hard parts.** Password hashing, encryption, and TLS are the
   easiest things to get dangerously wrong, so they're handled by Supabase's managed platform, not
   hand-rolled.

**Honest framing:** MVP is *secure by sound architecture and managed services* — not yet
*enterprise-hardened or certified*. Formal penetration testing, compliance certification (SOC 2 /
ISO), and advanced threat monitoring are explicitly out of MVP scope (see Deferred). The
architecture is built so those can be added without a redesign.

---

## The two-key model

The entire access design rests on two keys with very different powers.

| Key | Lives | Powers | Lock |
|---|---|---|---|
| **anon key** | frontend (public) | Supabase-direct calls | **RLS** — the database decides which rows this user may touch |
| **service_role key** | backend only (secret) | FastAPI's Supabase calls | **bypasses RLS** — so FastAPI must enforce the rules itself |

The anon key being public is safe *because RLS is the real lock* — it grants no blanket access, only
what the policies allow for the logged-in user. The service_role key can do anything, so it never
touches the client and every code path behind it is responsible for its own checks.

---

## Authentication & identity

**Handled by Supabase Auth** — not hand-rolled.

- **Login:** email + password. **Email OTP** for verification. No SMS (deferred).
- **Passwords are never stored or seen by us.** They live in Supabase's managed `auth.users`
  schema, stored only as a **bcrypt hash** — not the password itself. Our application code never
  receives the raw password; it goes straight from the client to Supabase Auth. Even Supabase
  can't read it back. This is precisely why we use a managed auth provider rather than rolling our
  own.
- **Identity bridge:** the authoritative identity record is `auth.users`. Our `profiles` table
  shares the **same UUID** (`profiles.id == auth.users.id`), which links Supabase's auth records to
  all our application data. `profiles` holds a readable copy of email + display name; `auth.users`
  remains the source of truth for credentials.
- **Sessions:** Supabase issues a short-lived JWT access token + a refresh token, managed by the
  client SDK. Logout revokes the session. The JWT is what RLS reads to identify the caller
  (`auth.uid()`).
- **Key-action protection in MVP:** 2FA is deferred, so sensitive actions (signing, payment status
  changes) are protected by the authenticated session plus the explicit per-action confirmation
  step (e.g. the signature confirm). 2FA on these actions arrives in MVP-2.

---

## Authorization — two layers

### Layer 1 — Row Level Security (RLS): which rows you can touch

The data-visibility lock, enforced by Postgres itself. The frontend uses the anon key, so **RLS is
the enforcement** for every direct read/write. The anchor is **participation + ownership**.

| Table group | Policy |
|---|---|
| `profiles`, creator/brand profiles | Public read (it's a marketplace); write only by the owner |
| `deals` and everything attached (messages, deliverables, terms, contracts, payments, rights, disputes, ratings, comments) | Read/write only if the caller is in `deal_participants` for that deal |
| `private_annotations` | Visible only to the owner (`profile_id = auth.uid()`) — even to other participants on the same deal. This is how creator content labels stay private. |
| Brand data (`brands`, `brand_members`, maker-checker config) | Visible to that brand's members; management actions admin-only |
| `rate_cards` | Owner always; brands only when `is_enabled = true`; never other creators |
| `notifications` | Visible only to the recipient |
| `deal_payment_details`, signatures, compliance docs | Owner + relevant deal participants only; never public |
| `audit_log` | **Not readable by normal users at all** — ops/admin only; insert-only |

### Layer 2 — RBAC: which actions you can perform

The action lock, enforced in FastAPI. Because the service_role key **bypasses RLS**, the backend
must check the caller's role *for that deal/brand* against the permission matrix in rbac.md before
executing any gated action — including **segregation of duties** (maker ≠ checker on the same
action).

**The two layers are deliberately redundant:** RBAC stops the *action*, RLS stops the *data
access*. A bug in one is caught by the other.

---

## Encryption

- **At rest:** Supabase Postgres is encrypted at rest by default; Supabase Storage objects are
  encrypted at rest. No extra configuration needed.
- **In transit:** TLS/HTTPS everywhere — client↔Supabase, client↔FastAPI, FastAPI↔Supabase, and
  the Vercel/Railway endpoints. No plaintext traffic.
- **Sensitive fields** (stored signatures, payment receiving details, compliance documents) rely on
  Supabase's at-rest encryption + strict RLS rather than additional application-level field
  encryption. Application-level field encryption is noted as a possible MVP-2 hardening step if a
  specific field is judged to need it.

---

## Secrets management

- **Local:** all keys in `.env`, which is **gitignored** and never committed. `.env.example` holds
  the key *names* with blank values and is tracked.
- **Production:** keys live in the Railway / Vercel platform environment-variable settings, never in
  the repo.
- **The keys and where each may appear:**

| Secret | Frontend? | Backend? |
|---|---|---|
| `SUPABASE_URL` | yes | yes |
| `SUPABASE_ANON_KEY` | yes (public-safe) | yes |
| `SUPABASE_SERVICE_KEY` | **never** | yes only |
| `GEMINI_API_KEY` | **never** | yes only |
| `RESEND_API_KEY` | **never** | yes only |

- **Pre-commit hook** (`.githooks/pre-commit`) blocks committing secrets; `git status` must never
  list `.env`. (Already in place from Phase 2.)
- **If a key leaks:** rotate it immediately in the Supabase / Google / Resend dashboard; the
  service_role key especially, since it bypasses RLS.

---

## Audit log

Immutable, **insert-only** — rows are never updated or deleted. It's the backbone of dispute
resolution, legal defensibility, and trust.

**Logged events:** contract signings (all three modes, including print-and-sign bypass details —
who requested, reason, who uploaded the physical doc, when), payment status changes, every stage
transition, role changes, maker-checker approvals / rejections / admin overrides,
exclusivity-warning overrides (creator proceeded despite a conflict), participant additions,
signature changes, and access to sensitive documents (compliance).

**Each row:** actor, action, entity type + id, metadata, IP address, timestamp. Written
server-side only (never client-writable), and not readable through the normal client.

---

## File & document storage security

- All files live in **Supabase Storage**, in RLS-scoped buckets — no public bucket for sensitive
  documents.
- Downloads use **signed, time-limited URLs**, not permanent public links.
- Contracts, signatures, chat media, and compliance documents are reachable only via deal
  participation or ownership.
- **Compliance documents** (GST / PAN / company registration) are encrypted at rest, RLS-scoped,
  and every access is audit-logged. An unauthorised access attempt is logged and blocked.

---

## Input validation & error handling

- **All inputs validated server-side** (FastAPI / Pydantic models) and reinforced by DB constraints
  and enum types — never trusting client-side validation.
- **Injection is prevented** by the Supabase client's parameterised queries; no raw SQL is built
  from user input.
- **Graceful degradation:** users never see a raw technical error. The UI shows a friendly message;
  full details are logged server-side for debugging. This is both a UX rule and a security rule —
  raw errors can leak schema or stack details.

---

## Rate limiting & abuse prevention

- **OTP resend** throttled (60-second cooldown).
- **Outreach caps** per subscription tier double as spam control.
- **Connection requests** rate-limited; blocked users' requests silently dropped.
- **Basic per-endpoint rate limiting** on FastAPI to blunt brute-force and scraping.

---

## AI data handling (privacy)

Extracting deal terms means **deal chat content is sent to Google's Gemini API** via `ai_service`.
Two rules govern it:

1. **Scope the data sent.** Only the chat needed for term extraction goes to the AI. Sensitive
   personal/financial records — `deal_payment_details` (bank/UPI/PAN), compliance documents — are
   **never** sent to the AI; the parser doesn't need them.
2. **MVP testing uses fictional data**, so no real person's data reaches the AI during the build.

**Production consideration (genuine, not for MVP build):** sending real users' conversation content
to a third-party AI requires a clear privacy-policy disclosure and appropriate data-processing
terms with the provider. The `ai_service` abstraction is what makes this manageable — if stronger
data terms or a different/self-hosted provider are needed for production, it's a one-file swap.

---

## Data privacy & retention

- **Personal data** (profiles, contact info) is RLS-scoped, user-editable, and user-deletable.
- **Soft deletes** on deals and messages preserve the audit trail while removing data from normal
  views.
- **Document retention** (contracts, invoices) is *kept* for MVP — nothing auto-deletes. The legal
  retention period (India's Income Tax Act implies ~6 years; perpetuity-rights contracts longer) is
  an **open decision requiring legal research per market** before public launch.
- **Account deletion:** a user can delete their account; deal history handling and the interaction
  with retention obligations is basic for MVP and needs the same legal review.

**India DPDP Act 2023 (production, not MVP):** because this product handles personal data of Indian
creators and brands, a public launch in India will need to address the Digital Personal Data
Protection Act — consent, data-principal rights (access/correction/erasure), and breach
notification. This needs proper legal review before launch; it is flagged here, not solved, and is
not legal advice.

---

## What's enforced where — summary

| Concern | Mechanism | Layer |
|---|---|---|
| Who you are | Supabase Auth (bcrypt, JWT) | Managed |
| Which rows you can read/write | RLS policies | Postgres |
| Which actions you can perform | RBAC checks | FastAPI |
| Maker ≠ checker | Segregation-of-duties check | FastAPI |
| Data at rest | Supabase encryption | Managed |
| Data in transit | TLS/HTTPS | Platform |
| Secrets | `.env` + platform vars + pre-commit hook | Repo / platform |
| Tamper-evidence | Immutable audit log | Postgres |
| File access | RLS buckets + signed URLs | Storage |
| Bad input | Server-side validation + DB constraints | FastAPI / Postgres |
| Abuse | Rate limits + outreach caps | FastAPI |

---

## Open decisions (need a call before production)

| Decision | Note |
|---|---|
| Document retention duration | India Income Tax Act ~6 years; perpetuity contracts longer; varies by market — legal research. |
| Whitelisting ad-account access | How a creator grants a brand access to their ad account (platform-facilitated vs manual) has real security implications. For MVP, whitelisting is *tracked only* — no actual ad-account access is facilitated. |
| AI data privacy for production | Privacy-policy disclosure + data-processing terms with Google, or a provider swap via `ai_service`. |
| DPDP Act compliance | Consent, data-principal rights, breach notification before India public launch — legal review. |

---

## Known RLS implementation gaps (address before production)

Identified during the Phase 5.4 schema review. Gap 1 is resolved by migration 025; Gap 2 remains a
pre-production hardening item.

### Resolved — `deal_participants` uninvited self-addition

**File:** `backend/migrations/012_rls.sql` — policy `deal_participants_insert_own`

**Resolution:** `backend/migrations/025_chat_terms_summary.sql` removes the authenticated INSERT
policy and table grant. Participant assignment remains a FastAPI/service-role action, matching the
locked architecture. Development RLS evidence proves an outsider cannot self-add and inherit a
participant-readable AI summary, while backend-added participants retain their required reads and
own `last_read_at` update.

---

### Gap 2 — `deals` UPDATE policy does not restrict the `stage` column

**File:** `backend/migrations/012_rls.sql` — policy `deals_update_participant`

**Issue:** The policy allows any deal participant to UPDATE any column on `deals`, including `stage`.
A user with the anon key could bypass FastAPI and directly set `deals.stage` to any valid enum
value, bypassing the deal engine's forward-only, gated transition logic.

**Why it's acceptable for MVP:** Stage transitions in the app always go through FastAPI (service_role).
The architecture explicitly relies on FastAPI as the enforcer ("the server is the source of truth").
This is an accepted trade-off, not a design mistake.

**Fix before production (optional hardening):** Add a Postgres trigger on `deals` that prevents
direct `stage` updates except via a trusted database function. RLS does not natively support
column-level UPDATE restrictions, so a trigger is the right mechanism.

---

## Deferred (MVP-2)

Two-factor authentication (login + key actions) · SMS OTP · device management + multi-owner session
control + 90-day auto-logoff · government-API identity verification (GSTIN / PAN / MCA) ·
application-level field encryption · formal penetration testing and compliance certification
(SOC 2 / ISO) · advanced threat monitoring and anomaly detection.
