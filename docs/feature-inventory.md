# Feature Inventory — Biz MVP

> **Version:** 2.0 — 2026-06-04
> **Sources:** Biz_Feature_List_v5 (business spec) + handover scope decisions + exclusions doc
> **Purpose:** De-duplicated, MVP-only feature list. Source of truth for the RTM (Phase 4).

---

## What changed from v1 → v2

Applied the agreed exclusions document, which narrows 157 v5 "MVP" tags to the actual build scope.
Major trims:

- **Bucket 1:** Removed 2FA, multiple handles, multi-owner handle verification, previous
  brand partnerships, invoice/payment setup at onboarding, device management,
  subscription/billing, payment methods — all deferred.
- **Bucket 2:** Removed all of Campaigns, Products, and Experiences & Events sections
  entirely. Discovery is now mock browse + profile view + one basic connect only.
  Also removed shortlist, AI outreach draft, audience demographics.
- **Bucket 3:** Removed pin messages, voice notes, reactions/read receipts, chat search,
  chat export, vendor onboarding form gate, brand-uploaded contracts, contract version
  control, milestone payment *release*, auto-invoice generation.
- **Bucket 5:** Removed brand payment release initiation and payment maker-checker approval
  (both are processing, not tracking).

**Feature count: 139 → 93**

---

> **Excluded from this inventory** (deferred to MVP-2 or later):
> Agency user type · Real payment processing · Tax Tool · Full Document Hub (only
> platform-generated contract PDF kept) · All Campaigns / Products / Events marketplace
> features · Live social-platform APIs · SMS OTP · 2FA · Subscription/billing ·
> Payment methods management · Multiple handles + multi-owner · Analytics dashboards ·
> Push notifications (in-app + email covers MVP)

---

## Bucket 1 — Identity & Trust

> Auth, sign-up, onboarding (Creator + Brand), digital signatures, account settings.
> Built in Phase 7.

### Auth

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B1-001 | Creator sign-up | Email + password; email OTP verification; Creator role assigned | High | No SMS OTP for MVP |
| B1-002 | Brand sign-up | Email + password; email OTP verification; Brand role assigned; domain-verified email required | High | No SMS OTP for MVP |
| B1-003 | Login + session management | Login screen; persistent session; route logged-in → app, logged-out → login | High | |
| B1-004 | Role selection | Post-signup choice: Creator or Brand; branches into separate onboarding flows | High | Agency excluded for MVP |

### Creator Onboarding

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B1-006 | Core profile — Creator | Display name, city, niche+emoji, bio/tagline, content language(s) | High | |
| B1-007 | Link social platforms | Store platform handles + mock follower/engagement data against profile | High | **Mock only** — no real OAuth or API calls |
| B1-010 | Minimum follower verification | 7K follower threshold check | High | **Mock only** — manual entry with pending flag; no live API |
| B1-011 | Inbound/outbound preference | Creator declares whether to accept inbound, initiate outreach, or both | Medium | |
| B1-012 | Professional affiliations | Show appearances, awards, press, podcast; self-declared; displayed on public profile | Medium | |

### Brand Onboarding

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B1-014 | Core profile — Brand | Company name, industry, company ID/GST, domain-verified email; Verified Business badge | High | |
| B1-015 | Link employees + set roles | Admin invites team; assigns Admin / Maker / Checker roles | Medium | |
| B1-017 | Maker-checker configuration | Configure which actions require Checker sign-off (payment, contract signing, content approval); escalation contact | High | Basic config only — no complex multi-level chains |

### Digital Signatures

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B1-018 | Stored signature setup — Creator | Draw or type signature; stored securely; timestamped + IP-logged on every use | High | |
| B1-019 | Stored signature setup — Brand | Authorised signatory draws or types signature; stored against business profile | High | |
| B1-020 | Stored signature management | View, update, or reset stored signature; requires identity re-verification to change | High | |

### Account & Settings

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B1-021 | Account details | Manage name, email, phone, password; email change triggers re-verification | High | |
| B1-023 | Notification preferences | Toggle per category; set quiet hours; critical deal alerts always delivered | Medium | |
| B1-027 | Profile completeness nudge | Compute completeness %; reminder at 24h + 72h if below threshold | Medium | |

**Bucket 1 total: 18 features**

---

## Bucket 2 — Discovery (Placeholder / Mock Data)

> A convincing browse experience on seeded mock data.
> **Scope:** browse people + view profiles + one basic connect to seed the deal flow.
> No Campaigns, Products, or Experiences & Events marketplace features for MVP.
> No live social APIs. No shortlist, no AI outreach, no application flows.
> Built in Phase 8.

### People Discovery (Mock)

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B2-001 | Browse + filter creators (Brand) | Search creator marketplace with filters (niche, platform, etc.); creator cards with mock data | High | Mock seed data only |
| B2-002 | Full creator profile / media kit (Brand) | Photo carousel, bio, stats, previous partnerships, trust score — full profile view | High | Mock data |
| B2-004 | Basic connect — seed deal flow | Creator or Brand sends a basic connection request; creates a Pending deal; seeds the chat and deal engine | High | Simplified — no proposal form, no cap enforcement, no AI draft |
| B2-005 | Browse + filter businesses (Creator) | Search business marketplace with filters; business cards with mock data | High | Mock seed data only |
| B2-006 | Full business profile card (Creator) | Business name, verified badge, industry, campaign history, trust rating | Medium | Mock data |

### Media Kit & Public Profiles

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B2-030 | Creator public profile / media kit | Photo carousel (5 max), stats, partnerships, affiliations, trust score | High | |
| B2-031 | Profile photo carousel | Up to 5 photos; swipeable; primary photo used as avatar | High | |
| B2-032 | Platform stats per handle | Per-handle: followers, engagement rate, weekly reach | High | **Mock values only** — no live API pull |
| B2-034 | Rate card — brands only | Per-platform/per-format pricing + add-ons; brands-only view | High | |
| B2-035 | Media kit preview | Creator sees exact public-facing profile as a brand would see it | Medium | |
| B2-036 | Edit profile | All users can update any profile field at any time | High | |
| B2-037 | Privacy settings | Contact visibility, rate card toggle, platform visibility controls | Medium | |
| B2-038 | Brand business profile | Name, verified badge, industry, campaign types, deal format, trust rating | High | |

**Bucket 2 total: 13 features**

---

## Bucket 3 — Deal Engine

> Chat, 7-stage flow, contracts (platform-generated only), signing, content, posting,
> payment tracking, disputes. The core product.
> Built in Phase 9.

### Chat Infrastructure

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-001 | Chat list with preview cards | Participant photos (stacked), deal name, stage pill, last message, unread badge, next-action prompt, I/O tag, rights chip (mini), deliverable count | High | Next-action prompt is a key differentiator |
| B3-002 | Chat thread + messaging | Message bubbles, input, send, full history | High | |
| B3-003 | Real-time message delivery | Supabase Realtime subscription — messages appear instantly on all devices | High | |
| B3-004 | Group chat + participant management | Multiple participants; adding mid-deal requires all-party approval | High | |
| B3-005 | Editable chat/deal name | Any participant can rename; real-time update; change logged | Medium | |
| B3-006 | Custom internal labels | Private per-user labels on any chat (e.g. Priority / Q3); never shared; filterable | Medium | |
| B3-007 | Media and file sharing | Images, videos, PDFs in chat; stored in Supabase Storage; tracked per deal | High | |

### Deal Stage Engine

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-013 | Deal stage progress bar | 7-stage horizontal stepper on every deal thread; Disputed = red overlay on Payment (not a separate stage) | High | |
| B3-014 | Sticky action bar (stage + role aware) | Above message input; actions change per stage and per role; read-only if no action required from this user | High | |
| B3-015 | Stage transition engine (backend) | FastAPI validates + executes all transitions (auto vs gated); logs timestamp + user; client never trusted | High | |
| B3-016 | Connection request — accept/decline | Recipient accepts (→ Chatting) or declines (→ closed); expires 72h; Pending until accepted | High | |
| B3-017 | Inbound/outbound deal tagging | Auto-tagged at creation based on who initiated; visible on deal card + monthly summary | High | |

### Terms + Approval Flow

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-018 | Minimum deal fields checklist | Validates 12 minimum fields are discussed before AI summary trigger; missing fields surfaced inline | High | |
| B3-019 | Both-party terms summary trigger | Either party requests; BOTH must confirm before AI summary is generated | High | |
| B3-020 | All-party sign-off gate | AI summary sent to all participants incl. internal approvers; all must approve before → Approval stage | High | |
| B3-021 | Approver status checklist | Visible to all deal participants during Approval + Creating; real-time status per approver (pending / approved / changes requested) | High | |

### Contracts + Signing

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-023 | Contract generation (PDF) | FastAPI generates contract PDF from approved AI summary via WeasyPrint; stored in Supabase Storage | High | Platform-generated only — brand-uploaded contracts deferred |
| B3-025 | Digital signature — three modes | ① Stored one-tap ② Draw new ③ Print-and-sign bypass; all modes timestamped + IP-logged | High | |
| B3-026 | Contract vs chat alignment check | Auto-flags conflicts between extracted contract terms and AI-approved chat summary; must resolve before signing | High | |
| B3-028 | Maker-checker in-deal approval | Checker sign-off for configured actions (payment, contract, content approval); full audit log | High | Basic config only — complex multi-level chains deferred |

### Content + Delivery

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-029 | Creative brief sharing (Brand) | Brand creates + shares campaign brief per deal; version-controlled; creator acknowledgement required on post-signing updates | High | |
| B3-030 | Content submission + revision flow | Creator submits draft; brand approves / requests revision (Round X of Y); counter tracks against contracted max | High | |
| B3-031 | Creator internal content labels | Private labels per deliverable (Idea / In Progress / Filmed / Approved / Scheduled); creator-only | Medium | |
| B3-032 | Multi-deliverable tracking | Single deal can have multiple deliverables; each has platform, format, deadline, approval status, proof link | High | |

### Posted + Payment

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-033 | Posted — live URL hard gate | Creator pastes verified live URL; platform fetches preview; business confirms → auto-advance to Payment; no other action unlocks this stage | High | |
| B3-034 | Invoice and payment info capture | Validates creator invoice details + brand billing details before Payment stage activates; inline form for any missing fields | High | Info capture only — invoice generation deferred |
| B3-035 | Payment tracking + states + milestones | Payment states: Paid full / Paid partial / Not paid in window / Not paid delayed / Bad debt / Disputed / Refunded; manual mark; milestone structure (trigger + amount + due date) for tracking only | High | **Tracking only** — no real payment processing or auto-release |
| B3-037 | Automated payment reminders | Auto-sends: 3 days before due / due date / 3 days overdue / 7 days overdue; bad debt flag at 30 days | High | |
| B3-039 | Dispute feature (Payment stage) | Raise Dispute → pauses payment → red overlay on Payment pill → dispute ticket → platform ops notified | High | Feature of Payment stage, not a separate stage |
| B3-040 | Deal close + ratings | Both parties confirm close; leave ratings/reviews; thread → read-only; post-deal comments + private notes allowed | High | |

### Exclusivity + Rights (in-deal)

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B3-041 | Exclusivity conflict warning | Cross-references new deal category against all active exclusivity clauses before acceptance; **warn only — does not block** | High | |
| B3-042 | Brand rights chip | Persistent chip in chat header + deal card from signing; shows rights type, start, expiry; turns grey on expiry; perpetual = no expiry | High | |

**Bucket 3 total: 32 features**

---

## Bucket 4 — AI Contract Parser

> Extract the 22 fields from chat history (platform-generated contracts only for MVP).
> Feed extracted data to all trackers.
> Always behind the `ai_service` abstraction layer (Gemini now, swappable later).
> Built in Phase 10.

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B4-001 | AI service abstraction layer | Single `ai_service` module wrapping all Gemini calls; provider swap = one file change | High | Non-negotiable architectural rule |
| B4-002 | 22-field extraction from chat | Gemini extracts all 22 fields from chat history into structured JSON; flags missing or ambiguous fields | High | Uses realistic fictional test data |
| B4-003 | 22-field extraction from contract | Parser runs on the platform-generated contract PDF; same 22 fields | High | Brand-uploaded contracts deferred |
| B4-004 | Both-party confirmation of extracted terms | Extracted fields shown to both parties; each approves or raises issue before stage advances | High | |
| B4-005 | Contract vs chat conflict detection | Extracted contract terms cross-referenced against AI-approved chat summary; discrepancies flagged before signing | High | |

**The 22 extracted fields:**
Payment amount · Payment terms type · Payment terms from-date · Exclusivity yes/no · Exclusivity duration · Exclusivity category · Usage rights yes/no · Usage rights duration · Usage rights channels · Whitelisting yes/no · Blackout window yes/no · Blackout window duration + timing · Revision rounds max · Creative guidance/brief · Content format per deliverable · Platform per deliverable · Posting date/window per deliverable · Sponsored content disclosure · Content ownership · Deliverable count · Location (if applicable) · Milestone schedule (if applicable)

**Bucket 4 total: 5 features**

---

## Bucket 5 — Tracking

> Auto-populated from the AI contract parser.
> Deal RAG status, payment tracking (no processing), calendar, rights + exclusivity.
> Built in Phase 11.

### Deal Tracker

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B5-001 | Track home — summary dashboard | Active deals count, action-needed (red RAG), payments due this week, next deadline, overdue deliverables, I/O ratio | High | |
| B5-002 | Deal list with RAG status | All active deals: Green/Amber/Red; filter by status, stage, type, date, I/O tag; red-first default sort | High | |
| B5-003 | Deliverable detail view | Per deliverable: content type, platform, location, posting date, usage rights, revision count, proof link, approval status | High | |
| B5-004 | Brand rights tracking | Rights period tracked per deal; persistent chip; 14-day and on-expiry alerts to both parties | High | |
| B5-005 | Monthly deal summary | Per-month view grouped by business: contracted value, received, outstanding, deliverables, I/O count | Medium | |

### Payment Tracker

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B5-006 | Payment dashboard | Unified payment view across all deals; states + filters (deal/business/date/state); bad debt prominently flagged | High | |
| B5-008 | Creator — track received payments | Full payment history: received, pending, overdue, bad debt; each entry links to deal | High | |

### Calendar

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B5-010 | Unified campaign calendar | All deal-linked dates: deliverables, posting, payment, blackout windows (amber shading), rights expiry; day/week/month toggle | High | |
| B5-011 | Posting schedule with creator labels | Creator's personal posting schedule with internal content labels; not visible to brand | Medium | |
| B5-012 | Blackout window visibility | Contractual blackout periods as shaded amber ranges; auto-populated from parser | High | |

### Rights Tracker

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| B5-013 | Exclusivity tracker | All active exclusivity clauses: brand, category, start/end, status; feeds conflict checker; alerts at 14d + 7d before expiry | High | |
| B5-014 | Usage rights tracker | Usage rights: channels, start/end or perpetuity flag, status; expiry alerts; perpetuity = no expiry alert | High | |
| B5-015 | Whitelisting + boosting tracker | Active whitelisting: platform, ad account, start/end, budget if disclosed, status | Medium | |
| B5-016 | Blackout window tracker | All active blackout windows; feeds calendar shading and conflict checker | High | |
| B5-017 | Sponsored content disclosure tracker | Tracks disclosure requirements per deal; platform-specific rules surfaced; reminder before posting deadline | Medium | |

**Bucket 5 total: 15 features**

---

## Cross-cutting — Security

> Built alongside every phase from day one. Consolidated in Phase 12.

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| CC-S001 | Row Level Security (RLS) | Every sensitive table has RLS policies; users access only their own + deal-participant data | High | |
| CC-S002 | RBAC enforcement (backend) | All FastAPI endpoints enforce role permissions per docs/rbac.md; no over-permissive endpoint | High | |
| CC-S003 | Audit log | Immutable log: contract signings, payment actions, stage advances, role changes; timestamp + user + IP | High | |
| CC-S004 | Encryption | Supabase at-rest encryption (default on); all traffic HTTPS in transit | High | |
| CC-S005 | Secrets management | All keys in .env locally; Railway/Vercel platform variables in production; pre-commit hook blocks commits | High | |
| CC-S006 | Error handling + graceful degradation | User-friendly errors; no raw technical errors shown to users; per-screen error boundaries | High | |

**Security total: 6 features**

---

## Cross-cutting — Notifications

> In-app + email only for MVP. No SMS, no rich push notifications.
> Built alongside every phase. Consolidated in Phase 12.

| ID | Feature | Description | Priority | Notes |
|---|---|---|---|---|
| CC-N001 | Smart notification engine | Priority tiers: Critical (always delivered) / Important (quiet hours respected) / Informational (batched) | High | |
| CC-N002 | In-app notification centre | Bell icon; all past notifications; read/unread; deep-link to source; grouped by deal; 90-day auto-clear | Medium | |
| CC-N003 | Email notifications (Resend) | Key events: OTP, stage advance, signature request, payment reminders, dispute raised | High | Free tier: 3k emails/month |
| CC-N004 | Stage-gate blocked alerts | Targeted alerts when a deal cannot advance (missing sign-off, no posted URL, maker-checker pending) | High | |

**Notifications total: 4 features**

---

## Summary

| Bucket | Phase | Features |
|---|---|---|
| Bucket 1 — Identity & Trust | Phase 7 | 18 |
| Bucket 2 — Discovery (Placeholder) | Phase 8 | 13 |
| Bucket 3 — Deal Engine | Phase 9 | 32 |
| Bucket 4 — AI Contract Parser | Phase 10 | 5 |
| Bucket 5 — Tracking | Phase 11 | 15 |
| Cross-cutting: Security | Phase 12 | 6 |
| Cross-cutting: Notifications | Phase 12 | 4 |
| **Total** | | **93** |

---
