# MVP Scope — Biz

> **Version:** 1.0 — 2026-06-04
> **Authority:** This document governs what is built in each release tier.
> If a build request would pull anything from a lower tier upward, flag it — do not silently expand scope.
> Feature-level detail lives in `docs/feature-inventory.md`. This document defines the *boundary*.

---

## What the MVP is

**One Creator + one Brand, doing a deal properly, end to end.**

Onboarding (email OTP, mock social links, digital signature) → mock Discover → connect →
chat → AI terms summary → platform-generated contract + e-sign → content/revisions →
posting proof (hard gate) → payment tracking → close and ratings — with deal, payment,
calendar, and rights/exclusivity **trackers** auto-populated from the AI contract parser,
**notifications** (in-app + email), and **security / RBAC / audit** underneath everything.

The marketplace is a convincing placeholder on mock data. The deal flow is real and complete.

---

## Tier 1 — Build MVP (build now)

> 93 features across 7 groups. Full detail in `docs/feature-inventory.md`.

### Identity & Trust (18 features)
- Creator + Brand sign-up via **email OTP** (no SMS)
- Role selection: Creator or Brand (Agency deferred)
- Creator onboarding: core profile, mock social link, mock follower check, inbound/outbound preference, professional affiliations
- Brand onboarding: core profile, employee + role linking, **basic** maker-checker config
- Digital signature setup (draw or type) for both roles; stored signature management
- Account basics: account details, notification preferences, profile completeness nudge

### Discovery — Placeholder (13 features)
- Browse + filter creators and businesses on **mock/seeded data**
- Full profile / media kit view (mock data, mock stats)
- **One basic Connect** — seeds the deal flow (no proposal form, no AI draft, no outreach cap)
- Creator public profile: photo carousel, mock platform stats, rate card, media kit preview, edit profile, privacy settings
- Brand business profile

### Deal Engine (32 features)
- Chat: thread, real-time (Supabase Realtime), group chat, file/media sharing, editable deal name, custom private labels
- 7-stage engine: progress bar, role-aware sticky action bar, server-side transition enforcement
- Connection accept/decline (Pending stage); inbound/outbound tagging
- Minimum deal fields checklist (12 fields must be discussed before summary trigger)
- Both-party confirmation to trigger AI summary; all-party sign-off gate; approver status checklist (real-time)
- Platform-generated contract PDF (WeasyPrint); three-mode e-signature; contract vs chat alignment check
- Basic maker-checker in-deal (Checker sign-off on payment / contract / content approval)
- Creative brief sharing + version control; content submission + revision flow (Round X of Y); creator internal content labels
- Multi-deliverable tracking per deal
- Posted hard gate (verified live URL + business confirmation required)
- Payment info capture; payment tracking + states + milestone structure (**tracking only, no processing**)
- Automated payment reminders (30-day bad debt escalation)
- Dispute feature (Payment stage overlay)
- Deal close + mutual ratings; post-deal comments + private notes
- Exclusivity conflict warning (warn, not block); brand rights chip (persistent from signing)

### AI Contract Parser (5 features)
- `ai_service` abstraction layer (Gemini now; swappable in one file change)
- 22-field extraction from chat history → structured JSON
- 22-field extraction from platform-generated contract PDF
- Both-party confirmation of extracted terms
- Contract vs chat conflict detection

### Tracking (15 features)
- Deal tracker: summary dashboard, RAG status list, deliverable detail, brand rights tracking, monthly deal summary
- Payment tracker: payment dashboard, creator received-payments view (tracking only)
- Calendar: unified deal-date calendar (deliverables, posting, blackout windows, rights expiry), posting schedule, blackout shading
- Rights tracker: exclusivity, usage rights, whitelisting + boosting, blackout windows, sponsored content disclosure — all auto-populated from parser

### Security (6 features — built throughout)
Row Level Security (RLS) · RBAC enforcement on all endpoints · Immutable audit log · Encryption (at-rest + in-transit) · Secrets management · Error handling + graceful degradation

### Notifications (4 features — built throughout)
Smart priority engine (Critical / Important / Informational) · In-app notification centre · Email via Resend · Stage-gate blocked alerts

---

## Tier 2 — MVP-2 (v5 "MVP"-tagged features deferred from our build)

> Features the business spec (v5) tagged as MVP but deliberately excluded from the first build.
> Build after the core deal flow is validated with real users.

### Auth & Onboarding
- **SMS OTP** — email OTP only for build MVP
- **Two-factor authentication (2FA)** — deferred; email OTP provides sufficient security for MVP
- **Device management + multi-owner session control** — deferred
- **Multiple social handles per platform** — multiple handles + multi-owner handle verification deferred; single handle per platform for MVP
- **Live social platform OAuth + API** — follower/engagement data is mocked for MVP; real OAuth + metric pulls deferred
- **Invoice and payment setup at onboarding** — deferred; payment info captured inline at deal payment stage
- **Previous brand partnerships import** — manual entry deferred; not on critical path

### Discovery & Marketplace (all real marketplace features)
- **Campaigns:** post listing, browse/apply, manage applications, outreach cap enforcement
- **Products:** browse listings, apply (Free/PR / Exchange / Paid), post listing, manage applicants, fulfilment broadcast
- **Experiences & Events:** browse, sign up (Free / Exchange / Instant / Approval-required), post listing, manage sign-ups + approvals, QR attendance check-in
- **Creator shortlist** (save to campaign shortlist; side-by-side compare)
- **Outbound reach-out with full proposal flow** (Campaign Idea Proposal; AI outreach draft)
- **Outreach cap by subscription tier**
- **Audience demographics** (live pull from platform APIs)
- **Live platform stats** (auto-pulled + auto-refreshed from OAuth)

### Chat / Messaging Extras
- **Voice notes**
- **Pin key messages**
- **Message reactions + read receipts**
- **Chat search** (full-text across threads)
- **Chat export to PDF** (with all-party consent)

### Contracts + Approvals
- **Brand-uploaded contracts** (upload own PDF; AI parser runs on upload)
- **Contract version control + amendments** (full version history; amendment re-sign flow)
- **Vendor onboarding form gate** (brand uploads/creates form; hard gate or soft prompt)
- **Complex maker-checker chains** (3+ level approval; configurable thresholds)

### Payments
- **Real payment processing / gateway** (UPI, bank transfer, payment gateway)
- **Milestone-linked payment auto-release** (escrow + automatic trigger on milestone condition)
- **Brand payment release + maker-checker on payment** (Checker authorises before funds move)
- **Auto-invoice generation** (invoice PDF auto-generated on payment release)

### Account & Settings
- **Subscription and billing management** (tier view, upgrade/downgrade, billing history)
- **Payment methods management** (bank accounts, UPI IDs; encrypted storage)
- **Billing details management — Brand** (GST, billing address, invoicing contact)

### Document Hub (standalone nav section)
- Brand-uploaded contracts store
- Campaign briefs store
- Invoices store
- Vendor onboarding forms store
- Chat records (auto-stored PDF on deal close)
- Compliance documents (GST/PAN/registration; encrypted)
- Event materials (QR codes, booking confirmations)
- Contract print-and-sign bypass (audit trail for wet signatures)

### Tax Tool
- Monthly income and payment dashboard
- Invoice management (auto-generated + custom)
- Expense tracking (deal-related expenses as invoice line items)
- Auto-reminders for overdue invoices
- Tax summary view (annual + quarterly; India first)

### Notifications
- **Rich push notifications** (web push / native push; in-app + email covers MVP)
- **Analytics digests** (creator analytics, business analytics dashboards)

---

## Tier 3 — MVP-3 (v5 "MVP2"-tagged features)

> Features the business spec explicitly flagged as post-launch (v2).
> Build after MVP-2 is shipped and validated.

### Discovery & AI
- AI-ranked shortlist by campaign fit
- AI-ranked discovery feed (businesses for creators)
- AI-generated creator brief for business
- AI-matched campaign recommendations for creators
- Bulk outreach to shortlist
- Promoted campaign listings (paid feature)

### Onboarding & Profile
- Post-onboarding media kit enrichment (production quality, content timeline, blackout/unavailability dates, preferred deal types)
- AI-assisted bio generation
- Tiered follower thresholds (5K free / 10K pro; vary by platform)

### Chat & Contracts
- In-app content annotation + mark-up (brand marks up creator's draft in-app)
- Editable field population within uploaded brand contracts (brand marks editable fields; creator fills in-app)
- Configurable 3+ level approval chains

### Deals & Payments
- Voucher / discount code deal type (unique creator code; audience redemption tracking; commission)
- Escrow + auto-release on milestone completion
- Accounting software export (Tally, QuickBooks, Xero) from Tax Tool

### Integrations
- Export to Google Calendar / Apple Calendar
- Social scheduler integration (schedule posts from within Biz)
- NFC tap-in as alternative to QR check-in
- Auto-transcription of voice notes
- AI semantic chat search
- Auto-verify post live via public API (vs. manual URL submission)
- Auto-verify via government API (India: GSTIN, PAN)

### Platform
- Hindi and regional language support (Hindi first)
- Monthly recap videos (auto-generated)
- AI nudge predictions in notification engine
- Monthly recap card (auto-generated deal/income summary)

---

## Tier 4 — Others / Future (v5 "Future"-tagged features)

> Long-term product vision. No timeline. Validate demand before scoping.

### New User Types
- **Agency user type** — talent / brand / boutique / management agencies; multi-client dashboard; representation agreements; agency discovery
- **Partner profile** — photographers, editors, stylists, makeup artists; calendar availability; booking flow; payment held; flows into Tax Tool as expense
- **Sub-brand linking** — parent business links subsidiary brands; cross-brand analytics rollup

### New Deal Types
- **Affiliate / commission deals** — unique creator link or code; audience converts; creator earns commission; requires e-commerce integration
- **Co-creation deals** — creator co-designs product or collection with brand; premium tier; high value, low frequency

### Discovery + Intelligence
- AI carousel for event push to specific creators (brand selects from AI-ranked matches)
- Platform deals only + premium exception (external deal tracking on premium tier)

### Platform Integrations
- Auto-import from platform-tagged posts (previous brand partnerships)
- Auto-refresh social metrics weekly
- Verification via media API (show appearances, awards, press)
- Auto-verify via company registry API (India: MCA)
- Accounting export to partner platforms

### Monetisation
- Subscription tier pricing (outreach caps, premium features, agency tier)
- Promoted listings as paid feature
- External deal tracking as premium tier feature

### Compliance & Markets
- Multi-market tax and legal compliance (SG, UK, UAE, USA — India is MVP)
- Document storage duration enforcement (6-year India Income Tax Act rule)
- Co-creator / multi-owner deal structures

---

## Scope violation rule

> If any build task or feature request references something in Tiers 2–4 during the MVP build,
> **stop and flag it** — do not silently implement. Log the request in `docs/progress.md`
> and continue with Tier 1 only.

---

*Feature-level detail: `docs/feature-inventory.md`*
*Stack and architecture: `docs/stack-decisions.md`*
