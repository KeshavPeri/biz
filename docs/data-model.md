# Data Model — Biz MVP

> **Version:** 1.3 (Phase 9 Gate-A state correction) — 2026-08-23
> **Status:** Awaiting approval at task 3.4. Do not write migrations until locked.
> Everything downstream (RLS, API, trackers) depends on this. Review carefully.

---

## Revision log

**v1.2 → v1.3 (Phase 9, tasks 9.9–9.10):**
- **+ `deal_summary_gates` table** — the locked workflow requires persisted
  checklist-override proposals/confirmations and the two-sided Gate-A summary
  request, but the original 42-table schema had no home for either. This is one
  cohesive, service-only state row per deal; its `manual_overrides` JSON keeps
  the short-lived proposal/confirmation state while immutable `audit_log` records
  every action. It deliberately does **not** reuse `term_approvals` (Gate B) or
  pre-create an `ai_summaries` row before Phase 10 produces real parser output.

Net: 42 → 43 tables.

**v1.1 → v1.2 (RBAC design, task 3.6):**
- **`brand_members.brand_role` changed from `admin|maker|checker` to `admin|member`.** Maker and
  checker are not permanent identities — they are per-deal hats assigned on
  `deal_participants.participant_role`. So a person can be maker on one deal and checker on
  another, and a brand can have many of each. Brand standing is just admin vs member.

**v1.0 → v1.1 (v5 cross-check):**

A line-by-line tally against the v5 feature list surfaced gaps. Changes:

- **+ `brand_partnerships` table** — previous brand partnerships are kept (manual) on the media
  kit per the exclusions doc, but had no home.
- **+ `deal_payment_details` table** — B3-034 captures creator receiving details + brand billing
  details before Payment activates; this had nowhere to be stored.
- **+ `participant_add_requests` table** — group chat (B3-004) requires all-party approval to add
  a participant mid-deal.
- **+ `deal_participants.last_read_at`** — the chat-list unread badge needs self read-state
  (distinct from read receipts, which are deferred).
- **+ `deals.expires_at`** — explicit 72h Pending connection-request expiry.
- **+ `deals.stage` gains `declined` + `cancelled`** — the two terminal off-ramps from the
  deal-engine design.
- **+ `contract_signatures.bypass_reason` / `physical_doc_path`** — print-and-sign bypass (mode ③).
- **+ `creator_profiles.privacy_settings`, `creator_profiles.response_time_hours`,
  `brands.profile_attributes`, `brands.deal_completion_rate`** — media-kit / business-profile
  display fields that were missing.

Net: 39 → 42 tables, plus the field additions above.

---

## Design principles

1. **A Brand is an organisation, not a user.** A creator is one person = one account.
   A brand is several people (Admin, Maker, Checker) acting under one brand identity.
   So `brands` is its own entity, and `brand_members` links users to it with a role.
   This is what makes maker-checker possible.

2. **Access is driven by deal participation.** `deal_participants` is the anchor table:
   nearly every RLS policy reduces to "is this user a participant on this deal?".
   Messages, deliverables, contracts, payments all inherit visibility from it.

3. **The connection request IS the deal.** Tapping Connect creates a `deals` row in the
   Pending stage. No separate connections table. Accept → Chatting; decline → closed.

4. **The 22 parsed fields are split by where they belong:**
   - Deal-wide terms (payment, ownership) → `deal_terms`
   - Per-deliverable terms (format, platform, posting date) → `deliverables`
   - Rights-type terms (exclusivity, usage, blackout, whitelisting, disclosure) → their own tables
   - The raw AI output is kept as JSON on `ai_summaries` / `extracted_terms` for audit + conflict check

5. **History is append-only.** Stage transitions, signatures, payment status changes,
   approvals — logged as inserts, never overwritten. The audit log and calendar feed off these.

6. **Soft deletes** (`deleted_at` marker) for deals and messages, so the audit trail survives.

---

## The domains

| Domain | Tables | Purpose |
|---|---|---|
| Identity & Profile | 10 | Who the users are |
| Deal Core | 8 | The deal, its participants, chat, deliverables, Gate-A state |
| Terms & Contracts | 8 | What was agreed, the contract, signatures |
| Rights | 5 | Exclusivity, usage, whitelisting, blackout, disclosure |
| Payments | 3 | Payment tracking + captured invoicing details (no processing) |
| Deal Outcomes | 3 | Disputes, ratings, comments |
| Maker-Checker | 2 | Brand approval workflow |
| Private Annotations | 1 | Per-user private labels |
| Cross-cutting | 3 | Notifications, preferences, audit log |
| **Total** | **42** | |

---

## Domain 1 — Identity & Profile

### `profiles`
Extends Supabase `auth.users` (1:1). Base profile for every user.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | = auth.users.id |
| account_type | enum | `creator` \| `brand` |
| display_name | text | |
| email | text | |
| phone | text | nullable (no SMS use in MVP) |
| city | text | |
| avatar_url | text | primary photo — a **Storage PATH in the private `profile-photos` bucket, NOT a URL**. Mirrors `creator_profiles.photo_carousel[0]`. Rendered only via signed URLs (frontend `StorageImage`/`getSignedProfilePhotoUrl`, B2-031); never `getPublicUrl` |
| profile_completeness | int | 0–100, computed |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `creator_profiles`
Creator-specific fields. 1:1 with `profiles` where account_type = creator.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| profile_id | uuid (FK → profiles) | |
| niches | text[] | up to 3 (migration 014; was single `niche`). App + DB CHECK cap at 3 |
| content_category | text | |
| bio | text | |
| content_languages | text[] | |
| photo_carousel | jsonb | ordered array of up to 5 **Storage paths** (not URLs), index 0 = primary = `profiles.avatar_url`; served via signed URLs (B2-031) |
| inbound_enabled | bool | accept inbound outreach |
| outbound_enabled | bool | initiate outreach |
| trust_score | numeric | computed (placeholder logic for MVP) |
| deal_completion_rate | numeric | computed |
| response_time_hours | numeric | computed (avg first-response time); shown on media kit |
| privacy_settings | jsonb | contact visibility, platform visibility toggles (rate-card toggle lives on `rate_cards`) |

### `brands`
The organisation entity.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| company_name | text | |
| industry | text | |
| company_id_gst | text | GST / company registration |
| domain | text | verified domain |
| verified | bool | Verified Business badge |
| trust_rating | numeric | from completed deal ratings |
| deal_completion_rate | numeric | computed |
| profile_attributes | jsonb | display-only: typical campaign types, deal-format preference, preferred creator tier, collaboration style |
| created_at | timestamptz | |

### `brand_members`
Links users to a brand, with their role. This is what enables maker-checker.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| brand_id | uuid (FK → brands) | |
| profile_id | uuid (FK → profiles) | |
| brand_role | enum | `admin` \| `member` — brand *standing* (admin manages the brand). The operative maker/checker hat is per-deal, on `deal_participants`. See rbac.md |
| status | enum | `invited` \| `active` |
| created_at | timestamptz | |

### `social_handles`
Creator platform handles. **Mock stats for MVP** — no live API.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| creator_id | uuid (FK → creator_profiles) | |
| platform | enum | instagram, tiktok, youtube, linkedin, x, pinterest, threads, podcast |
| handle | text | |
| follower_count | int | mock value |
| engagement_rate | numeric | mock value |
| weekly_reach | int | mock value |
| is_primary | bool | |
| verification_status | enum | `pending` \| `verified` (mock for MVP) |

### `signatures`
Stored digital signatures, per user. Reused for one-tap signing.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| profile_id | uuid (FK → profiles) | |
| signature_data | text | drawn (image/SVG storage path) or typed (rendered) |
| signature_type | enum | `drawn` \| `typed` |
| is_active | bool | only one active at a time |
| created_at | timestamptz | |

### `rate_cards`
Creator rate card header. Brands-only visibility (enforced in RLS).

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| creator_id | uuid (FK → creator_profiles) | |
| is_enabled | bool | visible to brands when true |

### `rate_card_items`
Line items on a rate card.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| rate_card_id | uuid (FK → rate_cards) | |
| platform | enum | |
| content_format | enum | |
| base_price | numeric | |
| currency | text | |
| title | text | editable label |
| description | text | |
| add_ons | jsonb | usage rights %, whitelisting, exclusivity add-ons |

### `affiliations`
Professional affiliations / credentials (self-declared).

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| creator_id | uuid (FK → creator_profiles) | |
| type | enum | `show` \| `award` \| `press` \| `podcast` |
| name | text | |
| year | int | |
| description | text | nullable |

### `brand_partnerships`
Previous brand partnerships shown as social proof on the creator's media kit. Manual entry for
MVP (auto-import deferred). Feeds trust scoring.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| creator_id | uuid (FK → creator_profiles) | |
| brand_name | text | free text (brand may not be on Biz) |
| platform | enum | nullable |
| views_reach | int | nullable; achieved views/reach |
| year | int | |
| description | text | nullable |

---

## Domain 2 — Deal Core

### `deals`
The central entity. Created when someone taps Connect.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| creator_id | uuid (FK → profiles) | the one creator on the deal |
| brand_id | uuid (FK → brands) | |
| deal_name | text | editable by any participant |
| deal_type | enum | `campaign` \| `product` \| `experience` (default campaign for MVP) |
| stage | enum | pending, chatting, approval, creating, posted, payment, closed, **declined**, **cancelled** |
| is_disputed | bool | overlay on Payment stage (not a stage) |
| direction | enum | `inbound` \| `outbound` (who initiated) |
| currency | text | ₹ / $ label; no conversion |
| expires_at | timestamptz | Pending connection-request expiry (created_at + 72h); nullable once accepted |
| created_by | uuid (FK → profiles) | initiator |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz | soft delete; nullable |

### `deal_participants`
Who is on a deal. **The RLS anchor.**

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| profile_id | uuid (FK → profiles) | |
| participant_role | enum | `creator` \| `brand_admin` \| `brand_maker` \| `brand_checker` |
| last_read_at | timestamptz | drives the unread-count badge (messages after this time are unread for this user); note: this is *self* read-state, not read receipts (those are deferred) |
| joined_at | timestamptz | |

### `deal_stage_transitions`
Append-only log of every stage change.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| from_stage | enum | nullable for the first (creation) |
| to_stage | enum | |
| transition_type | enum | `auto` \| `gated` |
| triggered_by | uuid (FK → profiles) | |
| created_at | timestamptz | |

### `participant_add_requests`
Adding a participant to a deal mid-flow requires all existing participants to approve (per
group-chat rules). One row per proposed addition; approvals tracked in `metadata` or via
per-approver rows.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| proposed_profile_id | uuid (FK → profiles) | the person to add |
| requested_by | uuid (FK → profiles) | |
| reason | text | |
| status | enum | `pending` \| `approved` \| `rejected` |
| approvals | jsonb | per-participant approve/pending state |
| created_at | timestamptz | |

### `messages`
Chat messages within a deal.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| sender_id | uuid (FK → profiles) | |
| body | text | nullable if attachment-only |
| created_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

### `message_attachments`
Files/media shared in chat. Stored in Supabase Storage.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| message_id | uuid (FK → messages) | |
| storage_path | text | |
| file_name | text | |
| file_type | text | mime type |
| file_size | int | bytes |

### `deliverables`
Per-deal deliverables. Holds the **per-deliverable** parsed fields.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| sequence | int | ordering within the deal |
| content_format | enum | reel, static_post, story, carousel, yt_video, yt_short, blog, ugc_photo, podcast_read, x_thread, linkedin_post, pinterest_pin |
| platform | enum | |
| posting_date | date | nullable if a window is used |
| posting_window_start | date | nullable |
| posting_window_end | date | nullable |
| location | text | nullable; for experience/event deals |
| revision_max | int | contracted maximum |
| revision_current | int | current count |
| approved_content_url | text | nullable |
| live_post_url | text | nullable; set at Posted gate |
| post_metadata | jsonb | fetched preview (platform, account, date, caption) |
| status | enum | pending, submitted, in_revision, approved, posted |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

## Domain 3 — Terms & Contracts

### `deal_terms`
The **confirmed, canonical** deal-wide terms (1:1 with deal). Trackers and app read this.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| payment_amount | numeric | |
| currency | text | |
| payment_terms_type | enum | `upfront` \| `on_posting` \| `net_x_days` \| `milestone` \| `combination` |
| payment_net_days | int | nullable; if net_x_days |
| payment_from_date_basis | enum | `invoice_date` \| `posting_date` (nullable) |
| revision_rounds_max | int | |
| content_ownership | enum | `creator` \| `brand` |
| deliverable_count | int | confirmed total |
| disclosure_required | bool | sponsored content disclosure |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `ai_summaries`
The AI summary generated **from chat**. Both parties approve this.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| raw_output | jsonb | full AI summary text |
| structured_terms | jsonb | the 22 fields as extracted from chat |
| status | enum | `pending_approval` \| `approved` \| `issue_raised` |
| generated_at | timestamptz | |

### `extracted_terms`
The AI extraction **from the final contract**. Compared against the summary for conflicts.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| contract_id | uuid (FK → contracts) | |
| raw_output | jsonb | |
| structured_terms | jsonb | the 22 fields from the contract |
| conflicts_detected | jsonb | list of fields where contract ≠ chat summary |
| confirmed_by_both | bool | |
| extracted_at | timestamptz | |

### `term_approvals`
Who approved the AI summary (the all-party sign-off gate).

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| summary_id | uuid (FK → ai_summaries) | |
| profile_id | uuid (FK → profiles) | |
| decision | enum | `approved` \| `issue_raised` |
| comment | text | nullable |
| decided_at | timestamptz | |

### `contracts`
Platform-generated contract PDF. (Brand-uploaded + version control deferred to MVP-2.)

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| version | int | default 1 (field present for future versioning) |
| storage_path | text | the PDF |
| generated_from_summary_id | uuid (FK → ai_summaries) | |
| status | enum | `draft` \| `awaiting_signatures` \| `executed` |
| created_at | timestamptz | |

### `contract_signatures`
Append-only signing record.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| contract_id | uuid (FK → contracts) | |
| signer_id | uuid (FK → profiles) | |
| on_behalf_of_brand_id | uuid (FK → brands) | nullable; if signing for a brand |
| signature_mode | enum | `stored` \| `drawn` \| `print_bypass` |
| signature_ref | text | snapshot of signature used (modes ①②) |
| bypass_reason | text | nullable; required when mode = print_bypass |
| physical_doc_path | text | nullable; uploaded wet-signed PDF for print_bypass |
| signed_at | timestamptz | |
| ip_address | text | |

### `briefs`
Creative brief, shared by the brand.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| version | int | |
| content | jsonb | objective, guidelines, dos/donts, hashtags, caption guidance |
| acknowledged_by_creator | bool | required on post-signing updates |
| created_at | timestamptz | |

### `revisions`
Revision rounds per deliverable (Round X of Y).

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deliverable_id | uuid (FK → deliverables) | |
| round_number | int | |
| submitted_content_url | text | |
| decision | enum | `approved` \| `revision_requested` |
| comment | text | |
| created_at | timestamptz | |

---

## Domain 4 — Rights

> All auto-populated from the AI contract parser. Each feeds its matching tracker.
> `status` is derived (active / expiring / expired) — see "Derived, not stored".

### `exclusivity_clauses`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| has_exclusivity | bool | must be declared either way |
| category | text | e.g. skincare; NOT blanket unless agreed |
| duration_days | int | nullable |
| start_date | date | nullable |
| end_date | date | nullable |

### `usage_rights`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| has_usage_rights | bool | |
| channels | text[] | paid ads, OOH, website, etc. |
| duration_days | int | nullable |
| is_perpetual | bool | flagged clearly; no expiry alert |
| start_date | date | nullable |
| end_date | date | nullable |

### `whitelisting_arrangements`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| has_whitelisting | bool | |
| platform | enum | nullable |
| ad_account | text | nullable |
| budget | numeric | nullable; if disclosed |
| start_date | date | nullable |
| end_date | date | nullable |

### `blackout_windows`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| has_blackout | bool | |
| timing | enum | `before` \| `after` \| `both` (relative to posting) |
| duration_days | int | nullable |
| start_date | date | nullable |
| end_date | date | nullable |

### `disclosure_requirements`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| deliverable_id | uuid (FK → deliverables) | nullable; can be per-deliverable |
| platform | enum | rules differ per platform |
| required | bool | |
| rule_note | text | platform-specific rule surfaced |

---

## Domain 5 — Payments (tracking only)

> No real money movement, no gateway, no auto-release. Status tracking + reminders only.

### `payments`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| amount | numeric | |
| currency | text | |
| structure | enum | `single` \| `milestone` \| `combination` |
| state | enum | paid_full, paid_partial, not_paid_in_window, not_paid_delayed, bad_debt, disputed, refunded |
| due_date | date | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `payment_milestones`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| payment_id | uuid (FK → payments) | |
| deliverable_id | uuid (FK → deliverables) | nullable; trigger linked to deliverable |
| trigger_description | text | e.g. "On Reel posted" |
| amount | numeric | |
| due_date | date | |
| state | enum | same set as payments.state |

### `deal_payment_details`
Captured before the Payment stage activates (validates both sides' invoicing info). Stored
per-deal for MVP since profile-level payment-methods management is deferred. No invoice is
generated in MVP (deferred) — this exists so the creator knows where to be paid and both have
a record.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | 1:1 |
| creator_legal_name | text | |
| creator_bank_or_upi | text | where the creator receives payment (off-platform) |
| creator_tax_id | text | nullable (e.g. PAN); optional below tax threshold |
| brand_billing_name | text | |
| brand_billing_address | text | |
| brand_gst | text | nullable |
| created_at | timestamptz | |

---

## Domain 6 — Deal Outcomes

### `disputes`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| raised_by | uuid (FK → profiles) | |
| description | text | |
| evidence | jsonb | screenshot/message/link refs |
| status | enum | `open` \| `resolved` |
| resolution_note | text | nullable |
| created_at | timestamptz | |
| resolved_at | timestamptz | nullable |

### `ratings`
Mutual ratings on deal close.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| rater_id | uuid (FK → profiles) | |
| ratee_profile_id | uuid (FK → profiles) | nullable |
| ratee_brand_id | uuid (FK → brands) | nullable (rating the brand) |
| score | int | 1–5 |
| review | text | nullable |
| created_at | timestamptz | |

### `deal_comments`
Post-close shared comments and private notes.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| author_id | uuid (FK → profiles) | |
| body | text | |
| visibility | enum | `shared` \| `private` |
| created_at | timestamptz | |

---

## Domain 7 — Maker-Checker

### `maker_checker_config`
Per-brand config: which actions need Checker sign-off.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| brand_id | uuid (FK → brands) | |
| action_type | enum | `payment_release` \| `contract_signing` \| `content_approval` |
| requires_checker | bool | |
| escalation_contact | uuid (FK → profiles) | nullable |

### `maker_checker_requests`
A pending approval intercepted at runtime.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| deal_id | uuid (FK → deals) | |
| action_type | enum | |
| initiated_by | uuid (FK → profiles) | the maker |
| checker_id | uuid (FK → profiles) | |
| status | enum | `pending` \| `approved` \| `rejected` |
| comment | text | nullable |
| created_at | timestamptz | |
| decided_at | timestamptz | nullable |

---

## Domain 8 — Private Annotations

### `private_annotations`
Per-user private labels. Covers both chat internal labels and creator content labels.
RLS: a user only ever sees their own rows.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| profile_id | uuid (FK → profiles) | owner; only they can see it |
| entity_type | enum | `deal` \| `deliverable` |
| entity_id | uuid | the deal or deliverable |
| label | text | e.g. "Priority", or content label "Filmed" |
| created_at | timestamptz | |

---

## Domain 9 — Cross-cutting

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| profile_id | uuid (FK → profiles) | recipient |
| tier | enum | `critical` \| `important` \| `informational` |
| title | text | |
| body | text | |
| deal_id | uuid (FK → deals) | nullable; deep-link target |
| read | bool | |
| created_at | timestamptz | 90-day auto-clear |

### `notification_preferences`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| profile_id | uuid (FK → profiles) | |
| category | text | notification category |
| channel_in_app | bool | |
| channel_email | bool | |
| quiet_hours_start | time | nullable |
| quiet_hours_end | time | nullable |

### `audit_log`
Immutable. Critical actions only.

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| actor_id | uuid (FK → profiles) | |
| action | text | e.g. "contract.signed" |
| entity_type | text | |
| entity_id | uuid | |
| metadata | jsonb | |
| ip_address | text | |
| created_at | timestamptz | insert-only |

---

## The 22-field storage map

Where each AI-extracted field lives once confirmed:

| # | Field | Stored in |
|---|---|---|
| 1 | Payment amount | `deal_terms.payment_amount` |
| 2 | Payment terms type | `deal_terms.payment_terms_type` |
| 3 | Payment terms from-date | `deal_terms.payment_from_date_basis` |
| 4 | Exclusivity yes/no | `exclusivity_clauses.has_exclusivity` |
| 5 | Exclusivity duration | `exclusivity_clauses.duration_days` |
| 6 | Exclusivity category | `exclusivity_clauses.category` |
| 7 | Usage rights yes/no | `usage_rights.has_usage_rights` |
| 8 | Usage rights duration | `usage_rights.duration_days` / `is_perpetual` |
| 9 | Usage rights channels | `usage_rights.channels` |
| 10 | Whitelisting yes/no | `whitelisting_arrangements.has_whitelisting` |
| 11 | Blackout window yes/no | `blackout_windows.has_blackout` |
| 12 | Blackout duration + timing | `blackout_windows.duration_days` / `timing` |
| 13 | Revision rounds max | `deal_terms.revision_rounds_max` |
| 14 | Creative guidance/brief | `briefs.content` |
| 15 | Content format per deliverable | `deliverables.content_format` |
| 16 | Platform per deliverable | `deliverables.platform` |
| 17 | Posting date/window per deliverable | `deliverables.posting_date` / window cols |
| 18 | Sponsored content disclosure | `disclosure_requirements` + `deal_terms.disclosure_required` |
| 19 | Content ownership | `deal_terms.content_ownership` |
| 20 | Deliverable count | `deal_terms.deliverable_count` (+ rows in `deliverables`) |
| 21 | Location (if applicable) | `deliverables.location` |
| 22 | Milestone schedule (if applicable) | `payment_milestones` |

Raw AI output for every field is also kept on `ai_summaries.structured_terms` and
`extracted_terms.structured_terms` (provenance + conflict detection).

---

## RLS strategy (summary — full detail in docs/security.md)

The access rule, in plain terms:

- **A user can see a deal** if there's a row in `deal_participants` linking them to it.
- **Everything attached to a deal** (messages, deliverables, contracts, terms, payments,
  rights, disputes, ratings, comments) inherits that: visible if you're a participant.
- **Profiles** are publicly readable (it's a marketplace) but only editable by the owner.
- **Rate cards** are readable by brands only when `is_enabled = true`; always by the owner.
- **Private annotations** are visible only to their owner (`profile_id = auth.uid()`), even
  to other participants on the same deal — this is how creator content labels stay private.
- **Brand data** is visible to that brand's members (via `brand_members`).
- **Notifications** visible only to the recipient.
- **Audit log** is insert-only and not readable by normal users (admin/ops only).

---

## Derived, not stored

These are computed at query time, not kept as columns:

- **Calendar** — a query across `deliverables` (posting dates), `payments` (due dates),
  `blackout_windows`, and rights expiry dates. No calendar table.
- **Deal RAG status** — computed from stage age + pending actions per the deal-engine rules.
- **Rights status** (active / expiring / expired) — computed from `end_date` vs today.
- **Profile completeness %** — computed from filled fields (cached on `profiles` for display).
- **Inbound/outbound ratio, monthly summaries** — aggregation queries over `deals`.

---

## Deferred to MVP-2 (no tables built now)

Vendor onboarding forms · brand-uploaded contracts · contract version history ·
chat pins/reactions/read-receipts/voice notes · payment methods · subscriptions ·
tax tool · document hub browsing · agency entities · multiple social handles per platform.

(Where a field aids future-proofing — e.g. `contracts.version` — it's included now so we
don't have to migrate later. But no full tables for deferred features.)

---
