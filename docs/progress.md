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

- **Issue #45 / B3-007 secure chat-attachment candidate:** additive migration 047 creates the
  private 50 MiB `deal-files` bucket and auth-derived upload reservations. Participant-scoped
  opaque paths, exact Storage owner/MIME/byte verification, lock-ordered idempotent finalization,
  direct-write revocation and terminal guards keep message and attachment binding database-owned.
  Authenticated Storage SELECT/signing is revoked; a bearer-authenticated backend endpoint
  revalidates the exact live participant/message/attachment chain and alone issues five-minute
  service-role links. Expo supports one PDF/JPEG/PNG/WebP/MP4/MOV with an optional caption,
  authoritative attachment hydration after Realtime hints, bounded image/file presentation, and
  account/deal/terminal/message fences around every private async result. The de-duplicated
  focused/affected candidate union passed **14/14 commands**: chat attachments **21/21** with zero
  fixture residue, Storage RLS **3/3**, close gate **27/27**, archive **9/9**, baseline RLS **4/4**,
  stage engine **23/23**, term approvals **32/32**, maker/checker **10/10**, contract flow **28/28**,
  frontend attachment tests **9/9**, strict TypeScript, lint (0 errors / 3 pre-existing warnings),
  Expo web export and diff hygiene. Complete non-documentation candidate fingerprint (including
  recovered additions) `22fe6c685a6a7a8b15779683de7515b8e74a9a7d`; independent QA and security
  re-review passed, and the required reviewed-source full regression passed **15/15 commands** with
  **157/157** backend assertions. The optional native picker/open walkthrough is `LIMITED`, and
  9.18/9.19 remain waiting.

- **Issue #43 / B3-006 private-deal-label candidate:** the chat list now reads only the signed-in
  owner's `private_annotations` for already-authorized deal IDs, validates and bounds untrusted
  label rows locally, and joins them only into that user's preview presentation. The Expo editor
  creates/removes exact owner rows, offers own-label suggestions, and fences account/deal async
  work; cards render two quiet labels plus overflow and a non-navigating edit action. A stable
  single-select local filter preserves existing activity order and resets safely when its label
  disappears. No shared projection, backend endpoint, migration, RLS policy, deliverable-label
  behavior, audit, notification, or URL changed. The focused/affected union passed: private-label
  privacy **6/6**, existing deliverable labels **21/21**, label-state Node tests **4/4**,
  TypeScript, lint (0 errors / 3 pre-existing warnings), Expo web export and diff hygiene.
  Combined acceptance/privacy review passed at non-documentation source fingerprint
  `9f6002ebad6872970e4e34066acb7e0aa51f1dda`; the optional two-persona native walkthrough remains
  founder-owned and `LIMITED`. B3-007 is now a verified candidate awaiting review before 9.18/9.19.

- **Issue #41 / B3-005 implementation candidate:** additive migration 045 gives every existing
  deal a non-null version without changing its name, stage or timestamps, and exposes one
  service-role-only, fixed-search-path rename RPC. The transaction locks the deal, proves current
  participation, rejects terminal/deleted rows, compares the exact displayed version, updates the
  canonical name/version/timestamp and inserts one metadata-only immutable audit event. Python
  normalizes NFKC and whitespace and rejects blank, overlong, control and bidi-formatted input;
  direct authenticated deal UPDATE and RPC execution remain revoked. Exact normalized retries are
  idempotent and distinct races commit once. The Expo header uses the existing edit affordance and
  `EditSheet`, hides editing in terminal stages or without a real version, adopts only the
  authoritative response, and keeps the participant's draft while refetching/showing the winning
  value after a stale conflict. Account/deal/displayed-version fences reject late results. The
  de-duplicated focused/affected candidate union passed 15/15 commands and 203/203 backend
  assertions: deal-name 30/30, upstream deal/API suites, RLS/archive compatibility, backend
  compile, strict TypeScript, a context-fence test, lint (0 errors / 3 pre-existing warnings), Expo
  web export and diff hygiene at non-documentation source fingerprint
  `769b0b2a7f4c0266c2c20e1922745405c14ea648`. Independent security review passed and QA found no defects;
  QA is `LIMITED` only for the optional two-persona/native refresh walkthrough. The required
  unchanged-source final regression also passed 15/15 commands at this fingerprint. B3-006 private
  labels and B3-007 attachments remain separate and still block 9.18/9.19.

- **Issue #39 / B3-004 reviewed candidate:** additive migration 044 normalizes a frozen
  per-request electorate, revokes direct authenticated request/decision mutation, enforces one
  pending request per deal and serializes participant admission with Gate A on the deal row.
  FastAPI alone derives active same-brand candidates, role eligibility, unanimous actions and a
  bounded identity/checklist view; exact retries are idempotent, rejection is final, and final
  admission revalidates stage, terms, membership and role before one RLS-anchor row is inserted.
  Generic notifications run best-effort after commit and audit metadata contains no names, contacts
  or reason text. The Expo header opens the locked “N in this deal ›” sheet with quiet role text,
  server-authorized request/decision controls, authoritative action/focus refetch and account/deal
  response fencing. New Realtime publication, email, removal, role changes, deal rename, labels and
  attachments remain excluded; two-device automatic refresh is `LIMITED` by design. Migration 044
  is applied to development and the de-duplicated focused/affected union passed. Review revision 1
  now quarantines unsafe legacy pending rows before installing the unique invariant, removes their
  former write policies, requires a role on every future pending row, and rejects every new vote
  after stage/terms drift without changing decision, request or audit state. The implementation
  evidence totals 193 backend assertions; the final test-only assertion correction passed the
  participant suite 29/29 plus compile/diff checks. Independent security review passed; QA is
  LIMITED only for the expressly founder-owned native/two-device refresh walkthrough. The required
  post-review full regression passed 13/13 commands and 193/193 backend assertions at canonical
  fingerprint `e2f5c8cfaace4678a8717c278206d207c7fe0b6e`.

- **Current phase:** Phase 9 — core workplan 9.15 and B3-035 are **Complete/Built**. Workplan
  9.16 / B3-039 is implemented through the current 9.16-C candidate: secure participant raise/read,
  the Expo participant journey, generic in-app operations notification, and authenticated
  platform-operations resume resolution are built. Critical dispute email remains explicitly
  deferred to CC-N003 / Phase 12.
  Workplan 9.17-B / issue #37 now completes B3-040's ratings, post-deal entries, trust aggregation
  and private chat-record archive as a reviewed candidate on the merged 9.17-A mutual-close
  boundary. QA/security re-review and the final full regression passed; only the founder's native
  reminders B3-037 remain pending for Phase 12 scheduling; 9.18
  lifecycle testing and the 9.19 phase gate remain incomplete.
  Workplan 9.13-E creator-private deliverable labels are merged through
  PR #19, completing the 9.13 Creating scope after 9.13-D merged through PR #18.
  Workplan 9.13-C draft submission/revision is merged through PR #17, 9.13-A creative briefs through
  PR #10, and 9.13-B canonical deliverables through PR #16. The optional short fictional 9.13-E
  creator/brand/checker role-switch walkthrough remains. Phase 10
  remains complete; PRs #5–#8 are merged;
  B4-001–B4-005 and the linked B3-020/B3-021/B3-026 slices are Built and reconciled. The founder
  accepted the manual 10.8 device/live-Gemini gate as non-blocking on 2026-08-29; this records a
  scheduling decision, not invented test evidence. Crisp later-testing steps live in
  `docs/LOCAL-APP-TESTING.md`.
- **Current build:** issue #29 / PR #30 / workplan 9.16-A is merged and adds the backend-owned Payment dispute foundation.
  Any current creator or active brand admin/maker/checker participant can submit one bounded
  plain-text narrative with up to ten exact same-deal message/live-post references. Migration 039
  takes the established deal-then-canonical-payment lock order and atomically stores immutable
  request provenance and the prior aggregate state, changes only the aggregate to `disputed`, sets
  the deal overlay, writes one metadata-only audit event and creates one generic Critical in-app
  notification per current eligible participant. Additive migration 040 corrects the already-applied
  migration 039 function so stale invited/inactive brand-member rows receive neither API history
  nor notices. Exact retries are idempotent; different and concurrent raises converge on one safe
  conflict. Payment report/receipt races serialize around the same
  locks, and every participant database mutation/RPC path remains revoked.
  - `GET/POST /deals/{deal_id}/disputes` are the only participant boundary. Reads expose bounded
    sanitized narrative, safe raiser labels and text-only message snippets without raw HTML, URLs,
    email-carried/internal hosts, IPv4/IPv6, sender ids, fingerprints or audit/payment details.
    Live-post evidence is a generic label and never derives from preview or network metadata.
    Before Payment is stably unavailable;
    Payment/Closed inconsistencies fail closed; `can_resolve` is always false. No resolution,
    refund, close, email, external support/ops delivery or platform-ops identity is invented.
  - **9.16-B candidate:** issue #31 adds the narrow Expo raise/view composition in
    `frontend/src/lib/deals.ts`, `frontend/src/components/deal/{sticky-action-bar,dispute-card,dispute-sheet}.tsx`
    and `frontend/src/app/deal/[id].tsx`. Strict runtime parsing fences the GET/POST projection;
    only returned `can_raise` and `current_open` drive actions. Draft narrative/evidence remains
    component-local, exact same-deal loaded message/current-live-post ids are deduplicated and capped,
    and every POST outcome refetches dispute, tracking and thread state without replay. The restrained
    Critical notice preserves the existing Payment overlay/tracker freeze; Closed remains read-only.
    Candidate code fingerprint `345f2fb232acdaee757498982b331d6e450fd8db`: affected/ticket union passed;
    repair 1 reset/closed the sheet on authenticated account change and reran TypeScript, lint, Expo export
    and diff hygiene. The full prior affected backend union remains valid because the repair is frontend-only.
    (private labels 21/21; content approval 20/20; deliverables 17/17; stage engine 23/23; term
    approvals 32/32; maker-checker 10/10; contract flow 28/28; briefs 28/28; RLS 4/4; disputes
    42/42; payment tracking 30/30; strict TypeScript; lint 0 errors with 3 pre-existing warnings;
    Expo web export; diff hygiene). All stateful fixtures cleaned. Interactive device/browser evidence
    is `LIMITED`; combined verifier passed after the account-switch draft-reset and fingerprint-coverage
    repair. No resolution, upload, email/ops delivery,
    money movement or production action was added.
  - **9.16-C candidate:** issue #33 adds additive migration 041, an explicit server-managed active
    `platform_ops_members` capability, and bearer-authenticated `/ops/disputes` queue/detail/resolve
    routes. Operations reads are bounded and use the shared participant-safe text/evidence
    projection; membership, auth ids, contacts, payment values, raw network content, fingerprints
    and audit fields are excluded. The only resolution outcome is `resume_payment`: one locked
    deal → canonical payment → dispute transaction restores the immutable prior aggregate state,
    clears only the overlay, records resolver provenance and a metadata-only audit, and writes one
    generic Important in-app notice per current participant. Exact retries are idempotent; changed,
    reused and concurrent requests fail closed or converge. Raising now adds one generic Critical
    in-app notice per active operations member and records an explicit zero-recipient count when
    none exists. No membership API, client credential, customer self-enrolment, money movement,
    refund, close, email or real staff provisioning is added. Migration 041 is applied to
    development with no real operations member provisioned. Independent QA/security passed after
    two privacy-sanitizer repair rounds; final regression passed 11/11 commands and 189/189
    fictional assertions at code fingerprint `2e9c59e0e2e827cd081da10d5874916719fbcd8d`, with
    complete cleanup. Real staff provisioning, email delivery, production action, ops UI and
    native-device walkthrough remain explicitly out of scope/LIMITED.
  - **9.17-A candidate:** issue #35 adds additive migration 042 and a service-only, fixed-search-path
    mutual-close RPC. It locks deal → canonical payment, requires exact current paid-full creator
    receipt evidence for the single payment or every canonical milestone, rejects an active/open
    dispute, records one immutable confirmation per creator/brand side, and performs the final
    Closed transition, transition log, metadata-only audit and generic Important notices in the
    same transaction. UUID retries converge; reused or changed identities conflict. A defensive
    deal trigger independently blocks Payment→Closed without both confirmations and the same
    payment guards. `GET /deals/{deal_id}/close-status` is bounded, current-participant-safe and
    owns `can_confirm`; payment tracking derives `can_request_close` from that service.
    PostgreSQL message/attachment triggers take a deal row lock and reject INSERT/UPDATE/DELETE in
    Closed, Declined or Cancelled, serializing sends with final close while preserving historical
    reads. Expo adds explicit final confirmation, progress/waiting states, request fences and
    authoritative close/payment/thread refetch; terminal refresh clears local draft/request state.
    Migration 042 was applied to development after metadata-only inventory showed zero Payment and
    Closed deals, canonical payments and open disputes. The de-duplicated affected/ticket union
    passed 21/21 commands and 411/411 assertions at source fingerprint
    `052f05215fa3de0774072b05db2c15870045e32c`; the targeted disputed-overlay repair then passed
    14 changed-path commands and 289/289 assertions. The final source fingerprint
    `05c0a5503a539d408c0dfcbcd20b7f2df0947753` passed one complete final regression: 21/21
    commands and 414/414 assertions, including close 26/26, payment tracking 30/30, payment
    details 29/29, disputes 43/43, stage engine 23/23, RLS 4/4, upstream focused integration/unit
    suites, backend compile, strict TypeScript, lint (0 errors / 3 pre-existing warnings), Expo web
    export and diff hygiene. QA returned LIMITED solely for the founder-owned two-persona/device
    Expo walkthrough; security re-review passed after the dispute projection was made fail-closed.
    All stateful fixtures cleaned to zero. No ratings,
    comments/private notes, trust-score work, PDF, refund, payment movement, email, production data
    or reopen path was added.
  - **9.17-B implementation candidate:** issue #37 adds additive migration 043 without changing
    migrations 001–042. Service-only fixed-search-path RPCs derive the creator/brand rating side and
    exact target from a current Closed deal, enforce one immutable proven rating per side and exact
    request idempotency, write metadata-only audit evidence and recompute only the corresponding
    brand `trust_rating` or creator `trust_score` from proven rows. Direct authenticated rating,
    trust-field and outcome-table access is revoked. Shared comments and author-private notes use
    separate bounded/cursor-stable API feeds; inserts are Closed-only, append-only and idempotent.
    Shared comments produce generic Informational notices for other current participants, while
    private notes produce none and are unavailable through another participant's API, RLS or
    Realtime/table boundary.
    A Closed-transition trigger queues one source-watermarked `deal_chat_archives` row. The backend
    pages the complete bounded terminal chat in deterministic order, escapes text, emits bounded
    attachment labels only, validates PDF signature/pages/size, writes one deterministic object to
    the private `deal-chat-archives` bucket, and finalizes under an expiring lease/source hash.
    Pending/failed work is retryable without changing Closed; participant download returns only a
    five-minute signed URL. Expo replaces the generic Closed wrap-up with final ratings, separate
    shared/private sections, component-local drafts and Preparing/Ready/Could-not-prepare archive
    actions without restoring chat mutation.
    Development inventory before 043 found 0 ratings, comments, structural inconsistencies, Closed
    deals and terminal messages; migration/table/functions/private bucket verified and fictional
    fixtures/storage were cleaned. The de-duplicated affected/ticket union passed **21/21 commands**
    and **353/353 backend assertions** at code fingerprint
    `b4290816cc12452bd21053bb092f39c5e12ce528`: post-close 14/14, archive 9/9,
    close 27/27, stage 23/23, RLS 4/4, payment 30/30, disputes 43/43 and all inherited
    content/contract/onboarding suites; backend compile, strict TypeScript, lint (0 errors / 3
    pre-existing warnings), Expo web export and diff hygiene also passed. Review revision 1 now
    selects and bounds the exact deal name used by the archive PDF, and synchronously invalidates,
    masks, then clears every post-close state across deal/stage/account changes; initial loads,
    pagination, mutations, archive retry and signed-download opening all reject late cross-context
    results. The impacted repair set passed **8/8 commands** (post-close 14/14, archive 9/9 and one
    deferred A-to-B render fence test) at replacement fingerprint
    `55608eb3352041897c91a1902542d1c77669d6a7`. Separate QA/security re-review passed, and the one
    unchanged-fingerprint final regression passed **22/22 commands** with **353/353 backend
    assertions** at that same fingerprint. The founder two-persona/native PDF-open visual walkthrough
    remains `LIMITED`. Email, production, public
    storage, reopening, refunds and money movement remain out of scope.
  - Development inventory before migration 039 found **0** disputes, open disputes, flagged
    Payment deals, flag-without-open rows and duplicate-open deals. The additive migration applied
    without rewriting historical data. Independent QA and security re-review pass after the
    participant-safe sanitizer was hardened for dotless/internal email and host forms, complete
    network-token removal and bounded linear processing. The single final regression passed at
    fingerprint `5d6f366d7eb12fa707770c8f3a33601b7f1efef1`: disputes **42/42**, payment tracking
    **30/30**, payment details **29/29**, posting gate **34/34**, stage engine **23/23**, term
    approvals **32/32**, contract flow **28/28**, RLS **4/4**, backend compile and diff hygiene —
    **222/222** assertions total. Every stateful suite cleaned its fictional data.
- **Merged payment UI dependency:** issue #27 / workplan 9.15-D consumes issue #25's participant-safe FastAPI
  payment-tracking boundary in Payment and Closed. The strict client validates the discriminated
  projection before rendering; exact decimal strings stay strings; aggregate and milestone state,
  receipt facts, due dates, versions and action flags remain server-owned. Active controls appear
  only from the exact returned action flags and submit the displayed item/version. Stale conflicts
  refetch and require a new choice; network failures retain the last valid projection. Disputed and
  Closed deals are read-only. Tracking and payment instructions stay separate, component-local
  channels with no direct Supabase table access, persistence, route/chat/analytics/log leakage or
  money-movement language.
  - **9.15-D pre-review evidence:** the exact de-duplicated affected/ticket union passed: strict
    TypeScript; lint with 0 errors and the 3 pre-existing `signature-pad.tsx` warnings; Expo web
    export with 36 routes; payment tracking **30/30**; payment details **29/29**; posting **34/34**;
    private labels **21/21**; content approval **20/20**; deliverables **17/17**; stage engine
    **23/23**; term approvals **32/32**; maker-checker **10/10**; contract flow **28/28**; briefs
    **28/28**; RLS **4/4**; and diff hygiene. Every stateful suite cleaned its fictional data.
    Interactive fictional brand/creator/checker, stale, disputed and Closed walkthrough evidence is
    `LIMITED` pending founder browser/device review; no real payment or campaign data was used.
  - **9.15-C backend foundation:** migration 038 and the participant-safe FastAPI boundary atomically
    materialize one immutable tracker from the executed contract's approved summary. Active brand
    admin/maker reports use exact versions; only the named creator confirms receipt of a current
    partial/full report; structured aggregates are database-derived. Direct participant table/RPC
    access remains revoked, disputes fail closed, Closed is read-only and Payment → Closed remains
    unavailable. No gateway, transfer, verification, invoice, reminder or dispute workflow is added.
  - **9.15-C verified evidence:** development inventory was 0 canonical/historical payments and
    0 milestones before migration 038. The focused union passed after each candidate repair;
    payment tracking reaches **30/30**, Payment entry/posting **34/34**, payment details **29/29**,
    stage engine **23/23** and RLS **4/4**. Independent QA and mandatory security review passed.
    The one complete final regression passed with unchanged source fingerprint
    `cc52ad608431e4fae2e12b8b21360a39a0d7b813`: term extraction unit/database, approvals **32/32**,
    contract flow **28/28**, backend compile and diff hygiene all passed. All created records were
    fictional and cleaned.
  - **Payment-information UI:** Posted/Payment/Closed read the dedicated FastAPI projection only.
    Creator and brand forms are enabled solely by side-specific server action flags, keep values in
    component state, and save with the displayed independent version. They never use Supabase,
    persisted state, navigation, chat, analytics, logs, or toast text. Exact post confirmation is
    shown only when both backend projections authorize it, and sends the displayed post plus
    creator/brand detail versions before the authoritative Payment refetch. Payment/Closed freeze
    both records read-only; no payment row, invoice, transfer, or release language is introduced.
  - **Pre-review verification:** strict TypeScript, frontend lint (0 errors; 3 pre-existing
    `signature-pad.tsx` warnings), Expo web export (36 routes), payment details **29/29**, posting
    gate **32/32**, private labels **21/21**, content approval **20/20**, deliverables **17/17**,
    Stage Engine **23/23**, term approvals **32/32**, maker-checker **10/10**, contract flow
    **28/28**, briefs **28/28**, and RLS **4/4** pass in the exact de-duplicated focused/affected
    union. Every database suite cleaned its fictional data. Independent QA and security review
    passed; the single final regression also passed at unchanged source fingerprint
    `c54c52e12bb28e6a66665d70445e0bd7104c84d0` (one transient HTTP/2 read error in content approval
    was retried once in isolation and then passed **20/20** without a source change).
    The deterministic fictional two-persona backend contracts cover multi-deliverable waiting,
    flag/replacement, stale versions, side ownership, and atomic confirmation. Interactive
    browser/device walkthrough evidence remains `LIMITED` until founder review.
- **Merged dependency:** issue #21 implements backend-only 9.15-A two-sided payment-information capture
  on base `3210a15`, after issue #15 merged through PR #20. Migration
  `037_payment_details_gate.sql` adapts the existing per-deal record for independently complete
  creator and brand sides, with side-specific optimistic versions and provenance. Named creators
  can change only creator fields; active brand admins/makers can change only brand fields; all
  current participants read a dedicated safe projection in Posted/Payment/Closed. Direct table
  CRUD/raw reads and client RPC execution are revoked. Exact retries are audit-idempotent, same-side
  races fail stale, cross-side writes do not overwrite each other, and all fields are bounded,
  trimmed, control-character free, and kept out of AI/log evidence. The migration was applied to
  development only after a zero-row, zero-distinct-deal inventory.
  - **Atomic Payment entry:** migration 037 replaces migration 036's confirmation signature so the
    deal, payment-detail row, exact live-post set, post confirmations, stage transition and safe
    audit metadata share one database transaction. Missing, incomplete or stale detail versions
    leave posts and stage unchanged; an exact retry in Payment is idempotent. No payment row,
    invoice, validation service, money movement, UI or payment-tracking behavior is introduced.
  - **9.15-A verification:** the development table inventory was 0 rows/0 distinct deals and
    migration 037 applied cleanly. The exact de-duplicated affected/focused pre-review union passes:
    payment details **29/29**, extended posting gate **32/32**, URL verifier **12/12**, brief
    **28/28**, Stage Engine **23/23**, summary gate, term approvals **32/32**, maker-checker
    **10/10**, contract flow **28/28**, content approval **20/20**, content flow **25/25**,
    deliverables **17/17**, private labels **21/21**, RLS **4/4**, backend compile and diff hygiene.
    All integration data was fictional and cleaned. B3-034 and 9.15 remain **In progress (backend
    only)** until the successor Expo capture UI merges. B3-035 payment tracking, invoices,
    reminders and the remainder of Phase 9 remain pending.
  - **9.14-A MERGED (B3-033 backend):** migration `036_live_post_gate.sql` fails closed on unrecognized historical proof,
  adds append-only per-deliverable URL versions plus a backend-owned current binding, and owns
  atomic final-link Creating → Posted and exact-set Posted → Payment transitions. The verifier
  normalizes platform domains and pins every public-only DNS-checked HTTPS hop; stores bounded text
  preview only; and treats network/platform failure as retryable without changing state. Brand
  admin/maker may flag an exact version in Posted, only the creator may replace that flagged link,
  and participant reads preserve history without private-label or network-internal joins.
  `backend/tests/test_url_verifier.py` uses controlled DNS/HTTP doubles and
  `backend/tests/test_posting_gate.py` uses fictional development data with no public fetch.
  External platform evidence remains `LIMITED` by design. Issue #22 is the reviewed Expo successor
  candidate; B3-033/9.14 become complete when its draft PR merges.
  - **9.13-E MERGED (B3-031 private labels):** migrations `034_private_deliverable_labels.sql` and
    `035_private_deliverable_label_lifecycle_lock.sql` add
    historical fail-closed inventory, five-value validation, creator/target proof, immutable label
    identity, one-row race-safe uniqueness, an authenticated owner-derived set/change/clear RPC, and
    deliverable/deal-cascade cleanup without touching deal annotations. Direct deal annotation CRUD
    remains compatible; shared deliverable APIs remain label-free.
  - **Creator-only UI:** the authoritative per-deal creator role is checked before the app makes any
    annotation query or renders the current value/picker. Changes are optimistic with rollback plus
    authoritative refetch on failure. Brand admin/maker/checker receive no query, placeholder, count,
    or label existence hint. Label changes are independent of canonical status, revisions, approvals,
    stage, audit, notifications, and tracker state.
  - **9.13-E verification:** migration 034 was applied to development only after confirming migration
    033's hardened wrapper/private-column lock and zero existing deliverable annotations, invalid
    values/targets, or duplicates. The fictional privacy test passes **19/19**; content approval
    **20/20**, deliverables **17/17**, Stage Engine **23/23**, term approvals **32/32**, maker-checker
    **10/10**, contract flow **28/28**, brief flow **28/28**, RLS **4/4**, backend compile, strict
    TypeScript, and diff hygiene all pass in the de-duplicated focused pre-review suite. Security-review
    repair 035 locks the target deliverable through set/clear and rechecks after the write, so direct
    deletion or a parent-deal cascade can neither pass cleanup and then receive an orphan label. The
    deterministic repaired privacy suite passes **21/21**, including both uncommitted-delete races.
    Independent QA and security review passed; the complete final regression also passed with an unchanged
    source fingerprint, including content flow **25/25**, frontend lint (0 errors; 4 pre-existing warnings),
    and Expo web export.
  - **9.13-D MERGED (B3-030 approval + B3-028 content slice):** migration
    `032_content_approval.sql` adds service-only exact-object held payloads and database-atomic direct
    approval, hold creation, checker release, and checker rejection. Every execution rechecks Creating,
    active brand roles, exact deliverable/revision/round/object identity, assigned checker, and the held
    rule snapshot. Retries and races produce one request/terminal effect; stale submissions fail closed.
    Review-hardening migration `033_content_approval_hardening.sql` preserves an existing exact-revision
    hold before consulting current gating configuration and removes authenticated access to private
    deliverable path columns while retaining explicit participant-safe columns.
    Participant views expose maker/checker names, safe round/status, and role-correct actions without
    payloads, paths, IPs, or audit internals. Checker rejection leaves content awaiting review and does
    not consume a revision or create ops attention; no live URL or stage transition is enabled.
  - **9.13-C MERGED (B3-030 submission/revision slice):** migration
    `030_content_submissions.sql` adds a private 100 MB bounded `content-drafts` bucket, one-time
    creator upload reservations, MIME/signature verification, append-only submission provenance,
    backend-only atomic submit/revision RPCs, per-round uniqueness and explicit awaiting-review state.
    Only the named creator can submit; brand admin/maker can request a revision with an immutable
    explanation; checker reads. Short-lived opaque backend downloads hide bucket paths.
    Review-repair migration `031_content_submission_hardening.sql` removes authenticated raw-table
    reads (history remains available through the safe API projection), caps current unbound reservations
    at ten per creator/deliverable, and adds leased server cleanup of at most 25 expired objects per pass.
  - **Rounds and exhaustion:** the saved submission increments `revision_current` exactly once;
    requesting changes never increments it again. Exhaustion keeps the deal in Creating, marks the
    deliverable for ops attention, writes metadata-only audit evidence, and enables neither a Payment
    dispute nor another ordinary round. Exact approval is now available through 9.13-D; live URLs and
    stage movement remain unavailable for later slices.
  - **9.13-B BUILT (B3-032 canonical deliverables):** migration `029_canonical_deliverables.sql`
    adds historical-compatible approved-summary provenance, safe sequence/timing/revision constraints,
    canonical uniqueness, participant-only reads, and a backend-only deal-locked materialization RPC.
    Exhaustive parser-to-database enum maps fail closed. Exact retries and concurrent calls return one
    set and one metadata-only audit row; historical, partial, or differently sourced rows are preserved
    and reported as conflicts. Future contract completion initializes before Creating advances, while
    the first authoritative Creating read safely recovers older deals.
  - **Creating deliverables UI:** every participant receives the same participant-safe, sequence-ordered
    plan and sees one detailed card per deliverable with platform, format, exact date/inclusive window,
    optional location, Round 0 of Y, and status. Loading, conflict, retry, and impossible-empty states are
    honest. The existing terms and creative-brief cards remain, and content/review/live-link actions stay
    unavailable for their separately reviewed slices. Focus refetch remains authoritative; no Realtime
    claim is made.
  - **9.13-A BUILT (B3-029 creative briefs):** migration `028_creative_briefs.sql` removes authenticated
    participant and direct service-role table writes, retains least-privilege participant/service reads,
    adds nullable historical-compatible author/
    acknowledgment provenance, unique positive per-deal versions, structured-content safeguards and an
    immutable-update plus direct-delete guards. Parent deal deletion still performs its legitimate FK
    cascade. Backend-only row-locked RPCs serialize version creation and latest-only, one-way creator
    acknowledgment with metadata-only audit rows; authorization precedes stage errors. FastAPI exposes participant-safe
    latest/newest-first history plus role/stage-derived actions; strict bounded bodies reject extras.
  - **Creating UI:** all current participants see the latest brief, author, version, acknowledgment state
    and immutable history. Brand admin/maker can share v1 or prefill a new version; the named creator can
    acknowledge only the unacknowledged latest version; checker stays read-only. Action and focus refetch
    are authoritative. The approved terms-review card remains visible, and the premature live-link action
    is replaced by an honest notice that content submission/review belongs to the next Creating slice.
  - **9.13-A verification:** development migration 028 applied after confirming live migration-027
    markers and zero historical/duplicate brief rows. `TEST-BRIEF-FLOW` covers 28 JWT/API/database checks,
    including exact content/provenance, concurrency, stale conflicts, role/stage denials, direct-client
    write denial, immutable prior versions, idempotent acknowledgment, participant-safe reads, audit
    privacy and safe fictional cleanup. Independent QA and security both passed after two focused repairs;
    the complete final regression passed unchanged: brief flow **28/28**, Stage Engine **23/23**, summary
    gate **39/39**, term approvals **32/32**, maker-checker **10/10**, contract flow **28/28**, RLS
    **4/4**, backend compile, strict TypeScript, lint (0 errors; 3 pre-existing warnings), Expo web export
    (36 routes), and diff hygiene.
  - **10.7 BUILT (contract alignment):** migration `027_contract_alignment.sql` stores one immutable,
    service-role-only alignment attempt and extracted result for the exact generated v1 PDF, bound to its
    approved summary, source hash, schema/prompt provenance and contract version. The backend extracts the
    locked 22 fields from bounded PDF text, compares deterministically, shows safe conflicts, and requires
    both eligible sides to confirm an override. Clear or jointly overridden alignment gates signing,
    held maker actions, execution, and Approval → Creating both in services and database triggers; private
    paths, draft hashes, raw output and provenance remain unavailable to participants.
  - **10.7 verification:** migration 027 applied/reapplied on development; alignment unit **13/13** and
    integration **13/13**; contract flow **28/28**; Gate-B acceptance **32/32** (including the recovered
    aligned/executed fixture); AI boundary **11/11**; extraction unit **29/29** and DB **20/20**;
    Gate-A unit **7/7** and integration **39/39**; Stage Engine **23/23**; maker-checker **10/10**;
    RLS **4/4**; contract template PASS; compile, strict TypeScript, lint (0 errors; 3 pre-existing
    warnings), 36-route Expo web export, and diff hygiene pass. No live Gemini or private data was used.
  - **10.6 BUILT (all-participant Gate B):** migration `026_term_approval_gate_b.sql` revokes the
    historical direct authenticated `term_approvals` insert path and exposes one backend-only locked
    decision RPC. It also revokes authenticated table-wide deal updates and restricts a participant-row
    update to the caller's own `last_read_at` column, closing direct stage/identity and cross-deal/role/
    profile pivots. Creator, brand admin, brand maker, and brand checker each decide only for their own
    authenticated profile and the active immutable summary version. Decisions remain append-only, with
    a monotonic sequence making latest status deterministic; retries are idempotent and stale/wrong-deal/
    outsider/forged requests fail safely.
  - **Atomic decision and recovery:** applicable `not_discussed` or any applicable `ambiguous` field
    blocks approval server-side; conditional children of explicit `false` parents are non-applicable.
    A bounded explained issue marks only that summary `issue_raised`, leaves Chatting unchanged, preserves
    history, and resets Gate A for a new generation. The last current-participant approval atomically
    marks the summary approved and writes exactly one Chatting → Approval transition plus decision/stage
    audits. The Stage Engine remains the application entry path through a handled Gate-B guard and never
    calls its generic transition apply after the atomic decision RPC. Only a non-idempotent transition
    emits notifications, so concurrent completion and later retries produce one notification set.
  - **Review UI + refresh:** the deal room renders all 22 fields with values/status/evidence, approval
    blockers, whole-summary controls, and pending/approved/changes-requested roster. `term_approvals`
    Realtime INSERTs trigger an authenticated refetch; focus and every action also refetch, so Realtime
    is never authority. The approved roster stays read-only in Approval and Creating.
  - **10-C verification:** migration 026 applied/reapplied on development; Gate-B acceptance **32/32**
    after security repair (including direct stage/identity denial with no artifacts, immutable participant
    identity/role/deal columns with retained read marker, participant-vs-outsider Realtime RLS evaluation,
    and exactly one concurrent-completion notification set plus retry);
    extraction unit **29/29** and DB **20/20**; summary-gate unit **7/7** and integration **39/39**;
    AI boundary **11/11**; Stage Engine **23/23**; maker-checker **10/10**; contract flow **28/28**;
    contract-template PASS; Python compile, strict
    TypeScript, lint (0 errors; 3 pre-existing signature-pad warnings), 36-route Expo web export, and
    diff checks pass. All fictional users/data were cleaned. QA's two-device Realtime/visual check is
    **LIMITED** because external websocket delivery was unavailable; publication, installed Realtime RLS
    authorization, authoritative API state, focus/action refetch, and outsider denial are automated and passing.
  - **10.3–10.5 BUILT (B4-002 chat slice):** `backend/services/term_extraction.py` owns the strict
    provider-neutral prompt (`chat-terms-extraction.v1`) and Pydantic schema (`chat-terms-22.v1`)
    for exactly 22 `found` / `not_discussed` / `ambiguous` envelopes. It forbids coercion/extras,
    validates source-backed bounded evidence, locked enums, explicit false/zero, conditional rights,
    payment, date, deliverable-index and milestone rules, and retries exactly once only for invalid
    output. Ordered non-deleted chat input contains only opaque message ID, timestamp, participant
    side/role and body; 500 messages, 8,000 characters per body, and 100,000 total characters are the
    hard pre-provider limits. Provider/DB failures map to stable safe HTTP errors.
  - **Gate-A + persistence:** migration `025_chat_terms_summary.sql` gives each confirmed Gate-A event
    a durable UUID and adds schema/prompt/provider/model provenance to `ai_summaries`. Its backend-only,
    row-locked RPC verifies the deal, chatting stage and generation identity, returns the first valid
    `pending_approval` row on retries/races, and writes one metadata-only audit. Failures leave the
    confirmed event retryable; success never advances stage or writes approvals/canonical terms,
    rights, deliverables, briefs, payments, milestones, contracts, or extracted contract terms.
    The same migration closes the historical `deal_participants_insert_own` self-enrollment gap;
    FastAPI/service-role remains the participant-add path, while legitimate participant reads and
    own read-marker updates remain available under RLS.
  - **10-B verification:** extraction unit **29/29**; development persistence/RLS/recovery/concurrency
    **20/20**; AI boundary **11/11**; summary-gate unit **7/7** and integration **39/39**; stage engine
    **23/23**; contract flow **28/28**; contract-template PASS; Python compile and diff checks clean.
    Migration 025 applied and repair-reapplied successfully on development; fictional test data cleaned.
    Real Gemini smoke is optional and **LIMITED/not run**; no real/private chat was sent.
  - **10.1–10.2 BUILT (B4-001):** `backend/services/ai_service.py` now exposes the typed,
    provider-neutral `AIRequest` / `AIResult` / `AIError` contract and an internal Gemini provider
    using the maintained `google-genai` SDK.
    The key and configurable model remain backend-only; no module outside `ai_service.py` imports the
    Gemini SDK. Missing configuration, timeout, rate limit, malformed provider output, and provider
    failure produce stable friendly errors without raw details. That merged block added no extraction,
    persistence, UI, Gate B, stage, or schema work; 10-B now consumes its boundary. Deterministic
    `test_ai_service.py` (11 checks), compile, summary-gate unit
    (7), contract-template, and diff checks pass. The serialized summary-gate run exercised 39 assertions
    but was **LIMITED** by cleanup after an already-absent fictional auth user; real Gemini smoke is also
    opt-in and **LIMITED** this run.
  - **9.11 DONE (B3-023):** participant-scoped FastAPI generation from the latest approved
    `ai_summaries` row only while the deal is in Approval. A row-locked reservation + unique
    `(deal_id, version)` index makes concurrent generation one version-1 contract; Jinja2 escapes
    the approved terms and WeasyPrint produces a validated PDF. Drafts live only in the private
    `contracts` bucket and participant downloads use audited five-minute signed URLs.
  - **9.12 DONE (B3-025 + contract-signing slice of B3-028):** stored, newly drawn, and real
    print-and-sign PDF upload modes are complete. Signer role/side checks, strict SVG/PDF validation,
    append-only signature records, mode/timestamp/IP audit evidence, side-level uniqueness, and
    checker hold/reject/retry/approve are enforced server-side. A checker releases the maker's held
    signature atomically and never signs as the brand.
  - **Execution + stage:** once exactly one named creator and one brand signature exist, the backend
    freshly renders an executed PDF with signer/mode/time/evidence IDs (and appends validated wet-signed
    pages), then reconciles the system-only Approval → Creating transition through the stage engine.
    Retries and races produce one executed contract and one transition. IP/signature snapshots and held
    payloads are not participant-readable; direct client signing/request writes are revoked.
  - **Phase-10 alignment:** `phase10_alignment_check` now asserts the immutable clear-or-both-overridden
    alignment result for the exact generated v1 contract. No placeholder `extracted_terms` rows are used.
  - **Schema:** migrations 019–028 are applied and verified on development. 020 creates the private
    bucket + contract version uniqueness; 021 adds held-action linkage; 022–024 add atomic RPCs,
    signer/side uniqueness, owner-only wet upload, service-only held payloads, safe column grants,
    and backend-only write grants. Public schema is now 44 tables.
  - **Verify:** `TEST-CONTRACT-FLOW` **28/28**, `TEST-CONTRACT-ALIGNMENT` **13/13**,
    `TEST-CONTRACT-ALIGNMENT-UNIT` **13/13**, `TEST-CONTRACT-TEMPLATE` PASS,
    `TEST-SUMMARY-GATE` **39/39**, `TEST-STAGE-ENGINE` **23/23**, and
    `test_maker_checker.py` **10/10**. Python compile clean; strict TypeScript clean; Expo web export
    clean (36 routes). All development test users/data/Storage objects cleaned up.
  - **9.9 DONE (B3-018):** server-owned exact-12 minimum-field checklist in
    `backend/services/summary_gate.py`, with documented `found` / `not_discussed` /
    `ambiguous` statuses and conditional children when a yes/no parent is yes. Phase 10 owns
    real parsing; its `ai_service` seam deliberately returns `not_discussed` today rather than
    pretending it read chat. A two-side, audit-logged manual override can clear one missing item.
  - **9.10 DONE (B3-019):** a creator, brand admin, or maker can request only after the checklist
    is complete; an eligible opposite side confirms or says Not yet. The row-locked Gate-A RPC
    makes duplicate taps idempotent. After confirmation, 10-B now extracts and atomically persists one
    pending summary; a failed attempt remains retryable under the same generation identity. No
    `term_approvals` or Chatting → Approval transition is created.
  - **Schema correction:** additive migration `019_summary_gate.sql` adds the service-only
    `deal_summary_gates` state row (43 tables total) because the specified Gate-A/override state
    was omitted. It does not misuse `term_approvals` or create a placeholder AI summary.
  - **9.6 DONE (Stage progress bar, B3-013):** reusable `components/deal/stage-progress-bar.tsx` — a
    7-node stepper (Pending→Closed) driven by `stage` + `is_disputed`, pinned under the deal-room header.
    done/current = ink, current in a soft ink-token ring, upcoming = cane-2. **Disputed** = a critical
    overlay on the Payment node (flag, not a stage); **declined/cancelled** render their own muted
    end-state strip; **closed** completes the line. Tokens only (the ring uses the exact `rgba(28,27,24,.12)`
    design-tokens §185 names via the proven `bg-[rgba(...)]` pattern — no new invented hex).
  - **9.7 DONE (Sticky action bar, B3-014):** `components/deal/sticky-action-bar.tsx` — stage- AND
    role-aware buttons per deal-engine.md's per-stage tables + rbac.md. Buttons only **request** a
    transition → the documented FastAPI endpoints via `postJson` (`requestDealTransition` +
    `acceptDeal`/`declineDeal`). Pending accept/decline (incl. warn-only exclusivity re-confirm) is LIVE;
    cancel/submit-live/confirm-posts/close hit their **stub-guarded** endpoints and return
    the engine's clean **409 "not available yet"**, surfaced inline (no crash). On success → thread refetch
    so the stepper + bar update immediately on the **acting** client. The throwaway 9.5 inline pending
    control was **removed/absorbed**.
  - **Data + screen:** `fetchDealThread` now also returns **`myRole`** (this user's `participant_role`);
    the bar decides visibility from `myRole` + `createdBy` (initiator) + `is_disputed` + `stage`. deal-room
    header dropped its stage pill (the stepper conveys stage); composer is read-only in terminal stages.
    Both reserved slots filled — no reflow.
  - **Verify:** `tsc` clean; web export clean (all routes incl. `/deal/[id]`); new components have **no
    hardcoded hex**; transition endpoints already proven by 9.8 (`test_stage_engine` 23/23) +
    `test_accept_decline` 18/18. Shipped in `39f9caa`.
    RTM: B3-013 + B3-014 = Built.
- *(Earlier this phase:* **Cluster 1 DONE — 9.1–9.5**; **task 9.8 (engine) DONE**.*)*
  - **9.8 DONE (Stage Transition Engine, B3-015) — the server-side state machine the product rides on.**
    New `backend/services/stage_engine.py`: a `(from_stage,to_stage)` **REGISTRY** is the single source
    of truth for legal moves (all 6 forward transitions from deal-engine.md's guard table + the two
    terminal off-ramps). **`request_transition`** is the ONE path for every stage change, running the
    "Server-side enforcement" checks in order (participant → legal-move lookup → role/recipient → guard),
    first failure wins with clean errors. **Forward-only** is enforced by the lookup — backward/skip/
    undefined all reject (a classifier gives precise 409/422 messages). Guards for later stages
    (9.10/9.12/9.13/9.14/9.15-17) are **stubs returning "not available yet"** — each owning task fills the
    guard body without touching the engine.
  - **Atomicity (folded in both FOLD-INTO-9.8 notes):** **migration 018** adds Postgres RPC
    `apply_stage_transition` — a **conditional** `UPDATE deals … WHERE stage = <from>` + the
    transition-log INSERT + the audit INSERT, all in ONE transaction. So a stage change can never lack a
    log row, and two concurrent transitions can't both apply (2nd sees 0 rows → engine returns 409). The
    RPC is **locked to `service_role`** (REVOKE'd from anon/authenticated — verified; else a signed-in
    user could force stage changes). Migration was FLAGGED in the plan and applied to dev after approval.
  - **accept/decline refactored** into 1-line wrappers over `request_transition` (no parallel transition
    path remains); response shapes + status codes unchanged. **Endpoint contract documented** at the top
    of `api/deals.py` for the 9.7 sticky action bar (accept/decline live; approve-summary/cancel/
    submit-live/confirm-posts/close wired but stub-guarded → clean 409 until their task). approval→creating
    is **system-auto** (no endpoint; fired internally by 9.12).
  - **Verify:** `test_stage_engine.py` **23/23** (structural forward-only + legal + each illegal reason
    independently + atomicity/no-double-apply + accept/decline regression). Full backend suite green:
    accept_decline 18/18, connect 13/13, maker_checker 10/10, onboarding 8/8, discovery 7/7, media_kit
    10/10, storage 3/3, rls 4/4, auth_session 5/5, connection PASS. No frontend changes. **NOT committed** —
    user reads the diff + runs the security pass, then /ship. RTM: B3-015 = Built.
- *(Earlier this phase:* **Cluster 1 DONE — tasks 9.1/9.2/9.3/9.4/9.5.***)*
  - **9.4 DONE (Realtime delivery, B3-003):** new messages appear live in an open thread with no
    refetch. **Migration 017** adds `messages` to the `supabase_realtime` publication (it shipped
    empty — postgres_changes delivered nothing before). `subscribeToDealMessages` (lib/deals.ts)
    opens a `postgres_changes` INSERT channel filtered by `deal_id`; RLS gates delivery to
    participants. Dedupe in the handler = **id-exists guard + skip own sender_id** (closes the
    optimistic-reconcile-vs-echo race). Cleanup unsubscribes + removeChannel on unmount; re-stamps
    last_read on incoming. Verified live via a Node subscribe+insert check (message delivered).
    **2-device live check deferred to the G4 phone test.**
  - **9.5 DONE (Pending accept/decline, B3-016):** the FIRST real server-side stage transition,
    built to the engine so 9.8 absorbs it. `POST /deals/{id}/accept` + `/decline` (FastAPI,
    service_role) in api/deals.py → `accept_deal`/`decline_deal` in services/deals.py. Guards:
    participant + recipient (≠ created_by) + not checker + stage==pending + within 72h. Accept →
    chatting (clears expires_at); decline → declined (terminal); both log a `gated`
    `deal_stage_transitions` row + an `audit_log` row (via shared `_advance_stage`/`_audit`).
    Exclusivity fired at accept = **warn-only** (returns `requires_acknowledgement` → re-confirm;
    ack logged in the audit metadata). Clean errors 403/409/410. Frontend: `acceptDeal`/`declineDeal`
    (lib/deals.ts, Bearer token) + a minimal Pending inline control in deal/[id].tsx (recipient sees
    Accept/Decline + the warn-only banner; initiator sees "Waiting for response · expires in {Xh}").
    **72h auto-expiry worker + accept/decline notifications still deferred** (needs the Railway worker,
    Phase 14). `test_accept_decline.py` **18/18 PASS**.
  - **Verify:** `tsc` clean; web export clean; `test_accept_decline.py` 18/18; Realtime Node check PASS.
    **NOT committed** — user runs /ship. RTM: B3-001/002/003/016 = Built. Bucket 3 = 4 built.
- **Current phase (earlier this cluster):** **Cluster 1 chat DONE — tasks 9.1/9.2/9.3.**
  - **9.1 VERIFIED (no migration):** live-checked the dev DB — `messages`, `deal_participants`
    (incl. `last_read_at`), `message_attachments` all match data-model.md, and RLS is in place
    (`messages_read_participant` / `messages_insert_participant`, `deal_participants_update_own`
    for last_read_at, `deals_read_participant`). Nothing missing.
  - **9.2 DONE (chat list, B3-001):** `chat.tsx` replaced the placeholder — one preview card per deal
    I'm on (Supabase-direct under RLS): other-party avatar/initials, deal name, stage pill, last-msg
    preview, unread badge (msgs after my `last_read_at`, from others), next-action line, I/O tag.
    Empty state + pull-to-refresh + refetch-on-focus. New: `components/chat/deal-preview-card.tsx`,
    `lib/deals.ts` (`fetchMyDealPreviews`/`stagePill`/`nextActionPrompt`), `lib/format.ts` relative-time.
  - **9.3 DONE (deal room, B3-002):** new route `app/deal/[id].tsx` (root-stack sibling above tabs,
    registered in `_layout.tsx`). History oldest→newest + auto-scroll; mine/theirs bubbles; composer
    inserts Supabase-direct (RLS: sender=me + participant) with optimistic append + rollback; stamps my
    `last_read_at` on open (clears the badge). **Reserved empty layout slots** for the stage progress bar
    (9.6) and sticky action bar (9.7). `lib/deals.ts` (`fetchDealThread`/`sendMessage`/`markDealRead`).
  - **Verify:** `tsc` clean; web export clean (incl. `/deal/[id]`). Data layer verified against 3
    seeded dev deals for the test brand admin (Peri/Abc) — stage pills (pending/chatting/creating),
    other-party names, and unread counts all correct. Live RN render NOT click-driven (no login creds
    to hand); covered by tsc + export + query verification. **NOT committed** — user runs /ship.
  - RTM: B3-001 + B3-002 = Built. Bucket 3 = 2/? started.
  - **Dev seed added:** 3 deals for Peri (Abc admin) ↔ Ananya Rao / Vikram Malhotra / Priya Nair via
    the real `connect_deal` service, plus a few messages; two had stage bumped (chatting/creating)
    directly for pill variety — see ASSUMPTIONS. Soft-deletable dev data.
- *(Prior phase: Phase 8 — Discovery (Bucket 2, placeholder on mock data).)*
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
  **`backend/migrations/` — 24 SQL files** defining 44 tables, 27 enums, the private Storage
  buckets/policies, full RLS/grants, and atomic stage, summary, contract and signing RPCs (001–024,
  see SESSION HISTORY). Migrations 001–024 are applied to the development Supabase project.
  **`backend/tests/test_rls.py`** — RLS smoke test
  (4/4 PASS). **`backend/migrations/apply_migration.py`** — applies a migration file to the
  dev project via the Supabase Management API (workaround for broken `DATABASE_URL`, see
  below).
  **FastAPI skeleton (task 5.9):** `backend/main.py` (CORS, lifespan, router registration),
  `backend/core/config.py` (`Settings` — all config from `.env`), `backend/core/supabase_client.py`
  (`get_supabase()`, service_role key), `backend/services/ai_service.py` (the `ai_service`
  abstraction — `call_ai(prompt, context)` stub, only file that imports `google.generativeai`),
  `backend/api/health.py` (`GET /health`). `backend/requirements.txt` now also has fastapi,
  uvicorn, google-generativeai, WeasyPrint, Jinja2, pypdf, and resend — all installed in
  `backend/.venv/`.
- **Not working / known issues:**
  - `DATABASE_URL` in `.env` does not connect — Supavisor pooler returns "tenant/user ... not
    found" even though the project ref matches `SUPABASE_URL`. Likely a stale/incorrect
    password or pooler string. Not currently blocking (FastAPI uses the supabase-py client +
    service_role key, not raw psycopg; `apply_migration.py` is the workaround for running SQL
    migrations). Worth regenerating the connection string from the Supabase Dashboard
    (Settings → Database) when convenient.
  - WeasyPrint imports and renders valid contract PDFs locally; `TEST-CONTRACT-TEMPLATE` and the
    live `TEST-CONTRACT-FLOW` both validate the generated bytes with pypdf.
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

1. **Issue #43 founder review:** review the private-label draft PR; the optional fictional
   two-persona native privacy/filter walkthrough remains `LIMITED` and non-blocking.
2. **B3-007:** review the secure attachment draft PR; optionally perform the fictional two-persona
   native picker/open walkthrough, then decide whether to merge.
3. **9.18/9.19:** run lifecycle acceptance and reconcile Phase 9 only after B3-007 is merged.

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

- 2026-09-04 — **Participant-safe dispute text boundary.** Current and historical descriptions,
  resolution notes, display names and message snippets are capped before parsing, stripped of HTML
  and control characters, and replace URL/email/internal-network tokens with a neutral label using
  bounded forward scans and DNS-limited matching. Live-post evidence remains a fixed safe label.
- 2026-08-31 — **Live-post verification boundary.** Named social deliverables accept only their
  exact canonical registrable-domain families; the locked generic Podcast value accepts any
  DNS-stable public HTTPS host without claiming provider matching. Every redirect is revalidated and
  TLS-pinned outside database transactions. Only bounded text metadata is stored or returned; images,
  HTML, response/network details and private labels remain outside the participant contract.

- 2026-08-30 — **Content draft boundary.** Drafts accept PDF/JPEG/PNG/WebP/MP4/MOV up to 100 MB.
  Prepared opaque paths expire after one hour; bound objects cannot be overwritten/deleted. Participant
  downloads use a five-minute HMAC-bound backend stream so Supabase bucket paths stay private.

- 2026-08-29 — **Phase 10 manual gate deferred without blocking development.** The founder explicitly
  marked workplan 10.8 complete for sequencing and will perform the Expo Go/two-device/live-Gemini checks
  later using `docs/LOCAL-APP-TESTING.md`. Automated evidence remains valid, but no omitted manual check
  is represented as passed.

- 2026-08-28 — **10.7 recovery fixture.** The legacy Gate-B checklist test generates a fictional v1
  contract, uses the production alignment reservation/completion RPCs with the exact private bytes and
  approved 22-field summary, then marks the synthetic contract executed. Both migration-027 triggers
  still enforce alignment; no production gate, schema, permission, or provider behavior is bypassed.

- 2026-08-28 — **Gate-B atomicity and applicability.** The Stage Engine's Chatting → Approval guard
  returns a handled outcome from one service-only locked RPC, because the last approval, summary status,
  transition row, deal stage, and audits cannot be split across transactions. Every current
  `deal_participants` row is required. Ambiguous/applicable-not-discussed fields block; conditional
  children of an explicit false parent and payment/milestone children excluded by the validated parent
  are non-applicable. An issue clears Gate-A request/generation/override state, not prior evidence.

- 2026-08-27 — **AI provider boundary.** Gemini remains the MVP provider behind a typed backend-only
  interface. `AI_PROVIDER` and `GEMINI_MODEL` are reversible backend configuration, while callers
  depend only on request/result/error types. The maintained `google-genai` SDK is constrained to
  `>=1.75.0,<2.0`; live provider smoke stays opt-in and uses fictional content only.
- 2026-08-26 — **Signing security/concurrency boundary.** In-process contract actions serialize use
  of the shared sync Supabase client; database row locks/unique constraints remain the cross-worker
  authority. PDF uploads use deterministic paths and retry-safe completion RPCs. User wet-sign uploads
  are validated then copied to backend-owned immutable evidence paths before a held request returns.
- 2026-08-26 — **Private signing evidence.** Participant APIs expose signer name/side/mode/time only.
  Column grants hide signature snapshots, IPs, evidence paths, and held payloads; executed participant
  PDFs omit IP while immutable audit rows retain it. Direct client inserts/updates/deletes on contract
  signatures and maker-checker requests are revoked.
- 2026-08-26 — **Phase-10 boundary held.** Contract generation consumes an existing approved summary,
  but 9.11/9.12 do not create summaries or `extracted_terms`. The executed-contract hook is a named
  no-op until the real parser/alignment task supplies evidence.

- 2026-08-23 — **Gate-A state correction (9.9/9.10).** The specified checklist overrides and
  request/confirmation state had no schema home. Added one service-only `deal_summary_gates` row per
  deal plus row-locked RPCs and immutable audit history; this changes the schema count 42 → 43.
  Gate A stays separate from later `term_approvals` (Gate B) and from real `ai_summaries` output.
- 2026-08-23 — **Parser honesty boundary.** Until Phase 10 supplies validated field statuses,
  `ai_service.get_minimum_field_statuses` returns all 12 as `not_discussed`; manual overrides remain
  available for genuinely discussed fields. Confirming Gate A calls the generation seam once and
  persists parser-pending state, without fabricating output or advancing the stage.
- 2026-07-15 — **9.7 action bar: Approval "Sign" is NOT wired.** Signing (approval→creating) is
  SYSTEM-AUTO in the engine, fired internally when all signatures land (task 9.12) — it has no user
  transition endpoint. So the Approval bar shows the prompt + the pre-signature Cancel off-ramp only;
  the Sign affordance arrives with 9.12. Same for brand content-review in Creating (9.13) and payment
  status/confirm/dispute in Payment (9.15-17) — the bar shows the wired transition button (submit-live /
  confirm-posts / close) + prompt; the intra-stage actions land with their tasks.
- 2026-07-15 — **Button visibility mirrors the engine's `allowed_roles`** so the bar never shows a button
  the server would 403 (checker sees no accept/decline/cancel/close; only creator sees submit-live; only
  brand admin/maker sees confirm-posts). A role/stage the user can't act in shows a read-only "waiting" box.
- 2026-07-15 — **Deal-room stage pill removed from the header** — the new 7-node stepper conveys stage, so
  the header pill was redundant (matches the mockup, whose header has no pill). `stagePill` is still used
  by the chat-list card.
- 2026-07-15 — **Composer goes read-only in terminal stages** (closed/declined/cancelled) per deal-engine.md
  ("Closed = read-only thread"). Minor fidelity touch beyond the strict 9.7 DoD.
- 2026-07-15 — **KNOWN GAP (G4 phone test): the OTHER participant's stage/action bar won't live-update** on a
  transition — migration 017 put only `messages` (not `deals`) on the Realtime publication. Acceptable for
  MVP: the acting client refetches immediately, and the deal room reloads on open (push/pop). NOT adding
  `deals` to Realtime now (out of scope; flagged for the 2-device phone test).
- 2026-07-15 — **Visual fidelity not device-verified.** tsc + web export are clean and the logic matches the
  spec tables, but the rendered stepper/bar weren't screenshotted here (no headless Expo-web+auth run).
  Devasri's design review on device is the remaining fidelity pass (consistent with the deferred G4 test).

- 2026-07-15 — **Migration 018 applied to dev (stage-transition RPC) — FLAGGED + approved.** Adds
  `apply_stage_transition(...)` (SECURITY INVOKER): conditional stage UPDATE + transition-log + audit in
  one txn; `REVOKE`d from PUBLIC/anon/authenticated, `GRANT`ed to service_role only (013's default-privs
  auto-grant made this REVOKE mandatory — verified anon/authenticated cannot execute). Non-destructive.
- 2026-07-15 — **9.8 engine design decisions.** (1) `request_transition` is **target-stage-based**; the
  `(from,to)` registry lookup makes forward-only structural (no separate backward/skip code — an illegal
  pair simply isn't a key; a classifier phrases the 409/422). (2) **Audit ALL** stage transitions (every
  registry entry has an `audit_action`), the stricter reading of deal-engine.md "sensitive" + rbac.md
  "stage advances are audited". (3) Shared primitives (`DealError`, `_exclusivity_warning`,
  `_load_deal_for_transition`, `_participant_role`, `_is_expired`) **moved down** into stage_engine.py;
  deals.py imports them (one-way dep, no import cycle). (4) All semantic transition endpoints exposed now
  (stub-guarded ones return a clean 409 "not available yet") so 9.7 has a complete, stable contract.
  (5) Notification hook = minimal best-effort in-app insert to other participants, OUTSIDE the atomic RPC
  (a notify failure must not roll back a committed transition); full catalogue is Phase 12.
- 2026-07-15 — **FOLD INTO 9.8 — RESOLVED in 9.8.** Both hardening items below are now handled by the
  migration-018 RPC (single-txn apply + conditional `UPDATE … WHERE stage=<from>`); `_advance_stage` and
  the read-then-write pending guard were deleted. (Original note kept for history.)
- 2026-07-15 — **FOLD INTO 9.8 (orchestrator verification note, Cluster 1).** Two hardening items
  found reviewing the 9.5 accept/decline transition, to absorb when the real engine is built in 9.8
  (consistent with the Cluster-C connect-hardening notes): (1) `_advance_stage` does the stage UPDATE
  then the transition INSERT as two non-transactional calls — a failed insert would leave a stage
  change with no log row; 9.8 should wrap stage-mutate + transition-log + audit in one transaction/RPC.
  (2) The pending guard is read-then-write, so it isn't atomic — 9.8 should use a conditional
  `UPDATE ... WHERE stage = <expected>` and check the row count so concurrent transitions can't both
  pass. Low risk at Pending (single recipient); real concern for mutual/auto gates later.
- 2026-07-15 — **Migration 017 applied to dev (Realtime).** `ALTER PUBLICATION supabase_realtime ADD
  TABLE messages` — non-destructive, required for 9.4 (the publication shipped empty so postgres_changes
  delivered nothing). Only `messages` added; `deals` deliberately left out (live stage updates are a
  later task). Applied via apply_migration.py + confirmed via SQL.
- 2026-07-15 — **Realtime dedupe = id-guard + skip-own-sender.** The task asked for an id-exists guard;
  I also skip events where `sender_id === me` because my own sends already render via optimistic+reconcile,
  and skipping the echo closes the race where the echo (real id) arrives before the insert response
  reconciles the temp id (which the id-guard alone would miss). Both together = no self-duplicate.
- 2026-07-15 — **Accept exclusivity flow = one extra round-trip, no error-code abuse.** When the creator
  accepts and has an active exclusivity clause, the accept endpoint returns HTTP 200 with
  `requires_acknowledgement:true` and NO state change; the client shows an inline warn-only banner and
  re-calls with `acknowledge_exclusivity:true` to proceed. Faithful to "shown before finalised / warn
  only, never block"; the acknowledgement is logged in the `deal_accept` audit metadata.
- 2026-07-15 — **Accept/decline audited via a local `_audit` in services/deals.py** (mirrors
  services/maker_checker._audit) rather than importing across service modules — keeps deals.py
  self-contained, consistent with connect_deal. Transition itself is logged in `deal_stage_transitions`.
- 2026-07-15 — **72h auto-decline + accept/decline notifications NOT built.** deal-engine.md §1 specifies
  a 72h auto-expiry (scheduled worker) and outcome notifications; both need the deferred Railway worker
  (Phase 14 open decision). 9.5 enforces the 72h window on accept (410 if expired) but nothing auto-flips
  an expired Pending deal to Declined yet.
- 2026-07-15 — **Pending inline control is deliberately minimal.** The recipient's Accept/Decline and the
  initiator's "Waiting…" line live in a small block at the top of the thread; the full stage-aware sticky
  action bar (all stages × roles) is task 9.7 (Cluster 2). The composer stays visible in Pending.

- 2026-07-15 — **Phase 9 chat: Realtime deferred within Cluster 1.** api-architecture lists live
  message/unread updates as Supabase Realtime (SB), but B3-003 is its own task — 9.2/9.3 use
  fetch-on-focus + optimistic send. Realtime subscription lands later in Phase 9 (B3-003).
- 2026-07-15 — **Chat attachments read-tolerant, no picker.** `message_attachments` exists and RLS
  is verified, but sending/rendering media (B3-007) is a separate task; the thread renders text
  bodies only for now (attachment-only messages show an empty body). No file picker built.
- 2026-07-15 — **Deal-preview "other party" = other participant profile(s), not the brand company.**
  The brand company already appears in `deal_name` ("Company × Creator"); the card avatar/name uses
  the other participant profile(s). Fine for MVP; revisit if group deals need company branding.
- 2026-07-15 — **"mine" bubble styling** uses a warm off-white tint (`#F3EFE7`) + right alignment
  rather than the mockup's glass-gradient (gradients are awkward in RN); "theirs" is white + hairline.
  Token-faithful and legible; swap to a gradient fill later if desired.
- 2026-07-15 — **Dev seed for chat testing.** Seeded 3 deals for Peri (Abc admin) ↔ 3 creators via the
  real `connect_deal` service + a few messages. Two deals had `stage` bumped directly (chatting/creating)
  purely for stage-pill/next-action visual variety — this bypasses the (Phase-9) server engine and is
  dev-data-only. Remove or reset if it clutters testing.

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

### 2026-09-15 — Issue #45 final verification

- Independent QA and security re-review passed the revised attachment candidate. The required final
  regression passed **15/15 commands** and **157/157** backend assertions at
  `22fe6c685a6a7a8b15779683de7515b8e74a9a7d`; lint reported 0 errors and 3 pre-existing warnings.
  Development fixtures left zero database/Storage residue. The native picker/preview/open walkthrough
  remains founder-owned and `LIMITED`; 9.18/9.19 remain separate gates.

### 2026-09-15 — Issue #45 review revision 1

- Removed authenticated `deal-files` Storage SELECT/signing authority. A dedicated authenticated
  FastAPI endpoint now uses the backend service-role client only after revalidating the exact
  non-deleted deal, current participant, live message and bound attachment, and hardcodes the
  returned link to 300 seconds. Integration evidence denies direct 24-hour signing and denies
  outsiders, anonymous callers and removed participants while preserving terminal-history access.
- SQL and TypeScript now apply NFKC before rejecting separators/control/bidi, including compatibility
  slash and backslash forms. Text-only sends capture the account/deal/generation fence and reject
  every delayed post-await mutation after context changes. The RTM displayed total now reconciles
  Bucket 3's 16 built rows to **46 / 93** overall.
- Migration 047 reapplied idempotently to development. The changed-path impact set passed **9/9** at
  `22fe6c685a6a7a8b15779683de7515b8e74a9a7d`: attachments **21/21** with zero residue, Storage RLS
  **3/3**, close **27/27**, archive **9/9**, baseline RLS **4/4**, frontend attachment tests **9/9**,
  backend compile, strict TypeScript and diff hygiene. QA/security re-review and the post-review full
  regression remain; native picker/open stays `LIMITED`.

### 2026-09-15 — Issue #45 recovered state reconciliation repaired

- Recovered the complete attachment candidate and repaired two context/reconciliation gaps:
  account/deal changes now clear temporary messages before a new thread can publish, and a delayed
  text-send response de-duplicates against an authoritative focus refresh instead of leaving two
  copies of one server message. A deterministic frontend regression covers the latter race.
- Preflight passed. The de-duplicated focused/affected union passed **14/14** at source fingerprint
  `a7c7ca58c4e0e7ecb43c4a3deda1459b00c42801`: **157/157** backend assertions, frontend attachment
  tests **8/8**, strict TypeScript, lint (0 errors / 3 pre-existing warnings), Expo web export and
  diff hygiene. Attachment fixtures again proved zero database/Storage residue. Independent
  QA/security review and the post-review full regression remain; native picker/open is `LIMITED`.

### 2026-09-13 — Issue #45 recovery candidate verified

- Recovered and reviewed the complete migration, Storage/RPC/RLS boundary, integration tests,
  typed attachment helpers, deal-room UI, Realtime hydration and context fences against the
  unchanged approved issue. No source repair was required.
- The required preflight passed, and the de-duplicated focused/affected union passed **14/14** at
  source fingerprint `6a4ca0b5e3c9b79130118b37ff96f53d8b1ca0cf`: **157/157** backend assertions,
  frontend attachment tests **7/7**, strict TypeScript, lint (0 errors / 3 pre-existing warnings),
  Expo web export and diff hygiene. Chat-attachment fixtures left zero database/Storage residue.
  Independent QA/security review and one unchanged-fingerprint full regression remain required;
  the optional native picker/open walkthrough remains `LIMITED`.

### 2026-09-11 — Issue #45: secure chat attachments candidate

- **Private integrity boundary:** additive migration 047 creates the private 50 MiB `deal-files`
  bucket and auth-derived, unenumerable upload reservations. Opaque paths bind one participant,
  deal, MIME and exact byte count; idempotent lock-ordered finalize verifies the actual Storage
  owner/metadata before atomically creating one message and attachment. Direct attachment writes,
  path substitution, outsider reads and bound deletion are denied; terminal deals preserve history
  but reject prepare/finalize/cleanup mutation.
- **Expo behavior:** the live-thread composer accepts one PDF/JPEG/PNG/WebP/MP4/MOV with an optional
  caption, safe selected-file removal/busy/retry behavior, bounded image previews and accessible
  PDF/video chips. Realtime INSERTs are hints hydrated by exact authoritative reads; attachment-only
  messages never render empty, and picker/read/upload/finalize/hydrate/sign/open results are fenced
  across account, deal, terminal and message context.
- **Evidence:** development-Supabase privacy/integrity/cleanup **21/21** and pure frontend validation,
  result parsing/hydration/deduplication/context tests **7/7** pass. Full candidate evidence is
  recorded in the 2026-09-13 recovery entry; independent QA/security review and reviewed-source
  regression remain the factory gates. The optional two-persona native picker/open walkthrough is
  `LIMITED`; 9.18/9.19 remain waiting and Phase 11 is not unlocked.

### 2026-09-11 — Issue #43: private deal labels and chat filtering candidate

- **Private boundary/UI:** added owner-RLS Supabase-direct deal-label reads/inserts/exact-ID deletes
  over already-authorized preview IDs, bounded normalization and untrusted-row handling, an
  account/deal-fenced private editor with own-label suggestions, quiet card chips/overflow and a
  stable local single-label chat filter. Labels never enter shared deal/message/API projections.
- **Evidence:** development-Supabase privacy **6/6** proves both participants cannot read, update
  or delete each other's rows; fixed deliverable labels **21/21** remain unchanged; pure label-state
  tests **4/4**, strict TypeScript, Expo web export and diff hygiene passed; lint has 0 errors and
  3 pre-existing warnings. Combined acceptance/privacy review passed at fingerprint
  `9f6002ebad6872970e4e34066acb7e0aa51f1dda`. The founder's optional fictional two-persona native
  privacy/filter walkthrough remains `LIMITED`; B3-007 still blocks 9.18/9.19.

### 2026-09-08 — Issue #39: unanimous participant admission candidate

- Added migration 044, backend-owned participant request/decision endpoints, frozen unanimous
  electorate, one-pending-request invariant, Gate-A serialization, bounded participant/candidate
  projection, privacy-safe audit/notification behavior and the deal-room participant sheet.
- **Evidence:** migration 044 applied to development. The implementation focused/affected union
  passed 13/13 commands and 189/189 backend assertions: participant management 25/25, briefs 28/28,
  stage engine 23/23, summary gate 39/39, term approvals 32/32, maker-checker 10/10, contract flow
  28/28 and RLS 4/4; backend compile, strict TypeScript, lint (0 errors / 3 pre-existing warnings),
  Expo web export and diff hygiene passed. Review revision 1 adds stage/terms-drift rollback and a
  seeded single/duplicate legacy-upgrade proof; participant management now passes 29/29. Its eight
  unaffected backend commands passed before a test-only pending-row count correction, then the
  participant suite, backend compile and diff hygiene passed 3/3 at final fingerprint
  `49151fdf1de74a214b25b4a8446fb7c45467b820`.
  Fictional fixtures cleaned. Independent QA/security and
  the required post-review full regression remain pending; the two-device native walkthrough is
  `LIMITED`.

### 2026-09-05 — Risk-proportional factory verification
- **Why:** transcript evidence from the issue #29 run and targeted recovery showed roughly 71–76% of
  effective usage in builder/orchestrator context churn, while repeated broad reads, tool turns and
  unchanged regression replay added more cost than the reviewer split alone.
- **Changed:** v3 tickets now route routine work to Terra Medium QA, medium-risk work to one Terra High
  Combined Verifier, and high-risk trust boundaries to separate Terra Medium QA plus Sol High security.
  Routine/medium tickets reuse fingerprinted affected-test evidence after an unchanged review; only
  high-risk tickets add one complete final regression. Role contracts require diff-first bounded reads,
  compact evidence, batched commands, recovery-delta context and no repeated status probes.
- **Preserved:** one writer/worktree, founder release/merge, additive migration safety, mandatory separate
  high-risk security review, fictional test data, affected-test floors and high-risk full regression.

### 2026-09-04 — Issue #29: secure Payment dispute backend candidate
- **Backend:** migrations 039–040 and the FastAPI dispute service add one atomic, race-safe Payment
  dispute overlay for current participants, immutable same-deal evidence, metadata-only audit, generic
  Critical in-app notices, safe idempotency/conflicts and read-only current/historical projections.
- **Privacy:** arbitrary participant-facing text is bounded and removes HTML, controls, URLs, email
  forms, host/port paths and IPv4/IPv6 locators without erasing ordinary narrative; live-post evidence
  never derives from preview metadata. Direct participant table/RPC mutations remain revoked.
- **Evidence:** targeted QA and security pass. The unchanged final fingerprint
  `5d6f366d7eb12fa707770c8f3a33601b7f1efef1` passed the single final regression: disputes **42/42**,
  payment tracking **30/30**, payment details **29/29**, posting **34/34**, stage **23/23**, term
  approvals **32/32**, contract **28/28**, RLS **4/4**, compile and diff hygiene (**222/222** total).
  All integration data was fictional and cleaned. UI, ops resolution and email remain pending.

### 2026-09-02 — Issue #27: participant payment-tracking Expo candidate
- **UI:** Payment and Closed now fetch one strict FastAPI-only payment projection and render a
  separate off-platform tracking ledger. Single and structured controls follow independent server
  action flags, send exact displayed versions, isolate row actions, refetch after outcomes and force
  renewed review after a stale conflict. High-consequence bad-debt/refunded labels require a second
  tracking-only confirmation. Disputed and Closed evidence stays visible without mutation controls.
- **Boundary:** exact decimal strings are grouped without numeric conversion; no aggregate, receipt,
  due/overdue or close truth is calculated in JavaScript. No backend, migration, RLS, API, payment
  detail, dispute, reminder, close, rating, persistence or telemetry behavior changed.
- **Limit:** the deterministic command set is mandatory; the fictional two-persona/checker
  browser/device walkthrough remains `LIMITED` for founder review.

### 2026-09-02 — Issue #25: authoritative payment tracking backend candidate
- **Backend:** additive migration 038 makes exact Posted → Payment confirmation atomically
  materialize one immutable tracker from the complete approved summary. It adds service-role-only,
  exact-version payment reporting/receipt RPCs, participant-safe API projections, structured
  milestone aggregates, metadata-only audit, dispute/Closed guards, and removes direct participant
  writes. No payment movement, invoice, reminder, dispute workflow, close flow, or Expo control was
  activated.
- **Evidence:** development payment/milestone inventory and final cleanup were 0/0. QA and mandatory
  security review passed after two focused validator-parity repairs. Final regression passed at
  `cc52ad608431e4fae2e12b8b21360a39a0d7b813`: payment tracking **30/30**, payment details **29/29**,
  posting **34/34**, stage **23/23**, term approvals **32/32**, contract flow **28/28**, RLS **4/4**,
  compile and diff hygiene.

### 2026-09-01 — Issue #22: live-post and payment-information Expo candidate
- **UI:** creator exact-version submit/replacement, shared bounded proof/history, server-authorized
  brand flagging/confirmation, and side-owned ephemeral payment-information forms now consume the
  merged FastAPI contracts. Current verified HTTPS proof opens only on an explicit gesture; no URL
  fetch/WebView/image/HTML or payment movement path was added.
- **Evidence:** QA and mandatory security review passed. TypeScript, lint (0 errors; 3 existing
  warnings), Expo web export (36 routes), the affected union, and final regression passed. A transient
  content-approval HTTP/2 read error was retried once; it then passed 20/20 with the same fingerprint.
- **Limit:** the fictional two-persona interactive browser/device and live-provider walkthrough is
  `LIMITED` for founder review; no real financial or campaign data was used.

### 2026-08-31 — Phase 9: verified live-post backend gate (9.14-A)
- **Network and persistence:** backend-only verification normalizes IDNA/host/default-port form,
  enforces exact social domains (or generic public-HTTPS Podcast), validates two stable public DNS
  answers per hop, pins TLS to the checked address, and bounds redirects, time, bytes, content types,
  and text-only metadata. Additive migration 036 records append-only versions and backend-owned current
  proof, revokes participant lifecycle writes/raw-history reads, and fails closed on historical values.
- **Atomic gates and correction:** creator-only exact-state submission saves a verified link; the last
  approved deliverable enters Posted in the same transaction. Brand admin/maker can flag one exact
  version without moving the deal back; creator replacement preserves flagged evidence. Exact current
  set confirmation atomically enters Payment and creates no payment record. The participant API returns
  bounded history/future action hints without private-label joins while `can_submit_live_url` stays false.
- **Evidence:** migration 035 was present, historical live values were zero, and migration 036 applied
  to development. Deterministic verifier tests pass 12/12 and fictional posting integration passes 28/28
  with cleanup. The affected union also passes brief 28/28, stage 23/23, summary 39/39, term approvals
  32/32, maker-checker 10/10, contract 28/28, content approval 20/20, content flow 25/25,
  deliverables 17/17, private labels 21/21, RLS 4/4, backend compile, and diff hygiene. Public-provider
  smoke and Expo UI remain `LIMITED`; B3-033/9.14 remain In progress.

### 2026-08-31 — PR #19 merged; next-ticket handoff
- **Merge:** issue #14 closed through merged PR #19, placing migrations 034–035 and creator-private
  deliverable labels on `main`; workplan 9.13 is now complete.
- **Queue:** the standing orchestrator synchronized the checkout, inspected the merged label/content
  seams, and revalidated issue #15 as the backend-only verified live-post gate; the broad Expo UI is a
  successor because factory bundling rules separate it from the new network/schema boundary. Preview
  data stays text-only, social hosts are allowlisted, and generic podcast links use public-HTTPS
  verification without a false provider claim. #15 alone returns to founder-controlled planned state.

### 2026-08-31 — Phase 9: creator-private deliverable labels (9.13-E)
- **Database boundary:** additive migration 034 inventories historical deliverable annotations before
  adding exact allowed values, creator/target validation, immutable owner/type/target identity, partial
  uniqueness and target-delete cleanup. One authenticated `SECURITY DEFINER` RPC derives `auth.uid()`
  and atomically sets, changes or clears the current label; guessed and cross-creator targets share a
  closed error. Existing freeform deal annotations retain owner-only direct CRUD.
- **Privacy and UI:** the creator role gates the private table read before it runs and gates the picker
  before it renders. Shared deliverable/content responses remain unchanged. The per-deliverable sheet
  offers only Idea, In Progress, Filmed, Approved, Scheduled, or no label; optimistic changes roll back
  and refetch on failure.
- **Evidence:** the focused fictional integration test covers creator CRUD, exact values, idempotency,
  concurrency, RLS across every brand role/other creators/outsider/anon, guessed targets, identity
  pivots, direct and parent-cascade cleanup, deal-annotation compatibility, shared-API non-disclosure,
  lifecycle isolation, and set races against direct/parent-cascade deletion (**21/21 passing with
  cleanup**). Migration 035 reconciles the already-applied development function while fresh installs
  receive the same lock in 034. The affected pre-review content approval,
  deliverable, stage, term, maker-checker, contract, brief, RLS, compile, TypeScript and diff checks also
  pass. Independent QA and security review passed, followed by an unchanged-fingerprint full regression:
  private labels 21/21, content approval 20/20, content flow 25/25, deliverables 17/17, brief 28/28,
  stage 23/23, terms 32/32, maker-checker 10/10, contract 28/28, RLS 4/4, compile, TypeScript, lint,
  Expo web export, and diff hygiene. The optional founder role-switch UI walkthrough remains `LIMITED`.

### 2026-08-30 — PR #18 merged; next-ticket handoff
- **Merge:** issue #13 closed through merged PR #18, placing migrations 032–033 and exact direct or
  checker-gated content approval on `main`.
- **Queue:** the standing orchestrator synchronized the checkout, inspected the merged approval and
  Creating UI seams, and revalidated issue #14 for one creator-owned label per canonical deliverable.
  Labels remain Supabase-direct and owner-only; shared deal/content responses must expose no label or
  existence hint. #14 alone returns to founder-controlled planned state.

### 2026-08-30 — PR #17 merged; next-ticket handoff
- **Merge:** issue #12 closed through merged PR #17, placing migrations 030–031 and the secure
  per-deliverable content submission/revision loop on `main`.
- **Queue:** issue #13 is the active review candidate. Checker rejection is constrained to rejecting
  only the held maker action while leaving the submission awaiting review; it cannot silently act as a
  maker-authored revision request. Later Creating/Posted tickets remain gated.

### 2026-08-30 — Phase 9: exact-submission content approval (9.13-D)
- **Atomic boundary:** added development migration 032 with a private service-role held-payload table
  and backend-only RPCs for direct approval, checker hold, checker release, and checker rejection.
  Approval copies only the immutable submitted object reference to the deliverable and leaves the deal
  in Creating. The generic maker-checker endpoint cannot create or falsely approve an empty content
  action.
- **Role and UI path:** brand admin/maker sees Approve only for the current awaiting-review submission;
  checker sees Confirm/Reject only for their assigned current request; creator sees honest waiting,
  approved, or rejected state. Rejection requires a bounded explanation and reopens only the maker's
  existing approval/revision choices. Focus and decision refetch stay authoritative.
- **Review hardening:** additive migration 033 was applied after verifying 032. It resolves a bound
  pending hold before current configuration/direct approval, preserving the held-rule snapshot when a
  maker retries after gating is disabled. Authenticated direct deliverable projections now receive only
  an explicit safe column allowlist; private approved/submitted object paths remain backend-only.
- **Safety/evidence:** migration 031's live cleanup table/lease/RPC were verified before 032 was applied;
  post-apply evidence confirms authenticated RPC denial and service-role-only execution. Migration 033
  verification confirms the stable wrapper is service-only, its private implementation is not directly
  executable, and authenticated users cannot select `approved_content_url`. The focused acceptance test
  covers 20 direct/held/reject/stale/concurrency/RBAC/privacy checks with fictional cleanup. The original
  affected pre-review union included content, deliverable, maker-checker, contract, brief, stage, terms,
  RLS, backend compile, strict TypeScript, and diff hygiene; repair reruns only affected focused checks.
  Independent QA/security passed after the repair. The final unchanged fingerprint passed the complete
  content-approval, content, deliverable, brief, maker-checker, contract, stage, summary, term, RLS,
  backend compile, TypeScript, lint, Expo web-export, and diff-hygiene regression set.

### 2026-08-30 — Phase 9: content submissions and revision requests (9.13-C)
- **Implementation:** added migration 030, private prepared creator uploads, file metadata/magic checks,
  atomic append-only round submission, immutable brand revision decisions, role-derived participant
  history/actions, secure opaque downloads, submission/revision sheets, and focus/action refetch.
- **Safety:** direct authenticated and ordinary service writes are revoked; Storage path pivots,
  overwrite/delete of bound evidence and public listing are denied. Exhausted rounds pause only the
  affected deliverable for ops while the deal remains Creating. Approval/live-post behavior is absent.
- **Review repair:** added migration 031 after security/QA review identified raw authenticated revision
  projection and persistent abandoned reservations. Creator/admin/checker JWTs can no longer select the
  raw path-bearing table. Active unbound reservations are capped and expired uploads use leased,
  bounded, server-owned Storage cleanup with retry release.
- **Evidence:** migrations 030 and 031 applied to development. Independent QA/security passed fingerprint
  `6d6ad45c0e287f6a9bf3af2ddd58c08586056b42`, and the unchanged candidate's complete regression passes
  with fictional cleanup: content **25/25**, deliverable **17/17**, brief **28/28**, Stage Engine
  **23/23**, summary gate, term approvals **32/32**, maker-checker **10/10**, contract flow **28/28**,
  RLS **4/4**, backend compile, strict TypeScript, lint (0 errors; 4 warnings), Expo web export, and diff
  hygiene. Three lint warnings are pre-existing in `signature-pad`; one changed-file unused-variable warning
  is retained to avoid invalidating the reviewed candidate and is a non-blocking cleanup item.

### 2026-08-30 — PR #16 merged; next-ticket handoff
- **Merge:** issue #11 closed through merged PR #16, placing migration 029 and the canonical deliverable
  service/API/cards on `main`. The standing orchestrator synchronized the checkout and revalidated issue
  #12 against those exact seams before returning it to the founder-controlled planned state.

### 2026-08-30 — Phase 9: canonical multi-deliverable foundation (9.13-B)
- **Canonical boundary:** validated the latest approved summary with `TermsExtraction`, mapped only
  explicit locked parser enums, and materialized the full ordered set through migration 029's deal- and
  summary-locked RPC. New rows carry source provenance, exact timing/location/revision terms, pending
  state and empty future proof fields. Participant and ordinary service-role table writes are revoked;
  exact retry/concurrency is idempotent and conflicting existing rows are never rewritten or deleted.
- **Product path:** added a thin authenticated Creating endpoint plus ordered participant-safe cards for
  platform, format, date/window, optional location, revision count and status. Approval → Creating now
  initializes the plan before stage completion, and Creating reads recover pre-migration deals. Existing
  brief/terms surfaces remain intact; submission, approval, labels and live URLs stay unavailable.
- **Evidence:** development migration 029 applied after confirming migration 028 markers. The
  fictional JWT/API/database acceptance flow passes **17/17**, including one/many, concurrency,
  RLS/direct-write denial, malformed/index/count/enum fail-closed cases, future-entry initialization,
  partial-set preservation, minimal audit data and safe cleanup. The conservative affected floor also
  passes: brief **28/28**, Stage Engine **23/23**, summary gate, term approvals **32/32**, maker-checker
  **10/10**, contract flow **28/28**, RLS **4/4**, contract-alignment unit/integration **13/13**, contract
  template, compile, strict TypeScript and diff hygiene. Independent QA and security passed with no
  remediation. The complete final regression passed unchanged: deliverable **17/17**, brief **28/28**,
  term approvals **32/32**, contract flow **28/28**, Stage Engine **23/23**, RLS **4/4**, backend compile,
  strict TypeScript, lint (0 errors; 3 pre-existing warnings), Expo web export (36 routes), and diff hygiene.

### 2026-08-29 — Phase 9 queue partitioned for usage-bounded runs
- **Queue:** authored and contract-linted issues #11–#15: canonical deliverables; draft submissions and
  revision requests; checker-gated content approval; creator-private labels; and the verified live-post
  gate. #11 alone is `factory:planned`; #12–#15 remain dependency-blocked until each predecessor merges
  and the standing orchestrator refreshes its exact base and code seams.

### 2026-08-29 — Phase 9: versioned creative briefs (9.13-A)
- **Trust boundary:** removed direct participant and service-role brief writes and added one backend-only
  atomic RPC path for immutable next-version creation plus latest-only, one-way creator acknowledgment.
  Direct DELETE/TRUNCATE is denied while the existing deal FK cascade remains safe. Authorization is
  evaluated before stage errors; deal locks, expected versions and a unique index make concurrent
  same-version submissions produce one winner and one 409.
- **Product path:** added strict participant-safe brief APIs and a Creating card/editor with newest-first
  history, author/version/ack state, brand admin/maker share controls, creator acknowledgment, checker
  read-only behavior, and focus/action refetch. Terms review remains; premature live-link UI is gone.
- **Verify:** migration 028 applied to development after compatibility checks; QA and security passed after
  two focused security repairs. The final unchanged candidate passed brief flow **28/28**, Stage Engine
  **23/23**, summary gate **39/39**, term approvals **32/32**, maker-checker **10/10**, contract flow
  **28/28**, RLS **4/4**, compile, strict TypeScript, lint, Expo web export and diff hygiene. PR #10 is
  merged; the optional short fictional role-switch UI walkthrough remains and no instantaneous two-device
  refresh is claimed.

### 2026-08-29 — Standing-orchestrator ticket ownership
- **Separated planning from execution:** the standing orchestrator now performs the full repository/
  specification inspection and creates one detailed `factory:planned` ticket when asked. Scheduled
  builds no longer replenish the queue or spawn a Workplan Manager to recheck ticket quality.
- **Cheap build start:** a released ticket carries v2 metadata for base commit, dependency, builder, and
  security routing. The factory checks only lock/queue state, exact main, dependency, routing, and active
  conflicts. Any base drift is returned to the standing orchestrator; QA, security review, final
  regression, isolated worktrees, founder release, and founder merge control remain unchanged.

### 2026-08-29 — Phase 10 close-out and factory refinement
- **Closed Phase 10:** confirmed PRs #5–#8 merged, reconciled B4-001–B4-005 and linked Phase 9 Gate-B/
  alignment rows, accepted manual 10.8 as a non-blocking founder-deferred check, and made 9.13 Ready.
- **Founder testing:** added `docs/LOCAL-APP-TESTING.md` with the local backend, Expo Go, two-device,
  22-field review, contract-alignment, signing, and optional fictional live-Gemini path.
- **Factory:** reduced repeated context/tests, added durable usage-limit recovery and early affected-test
  coverage, and strengthened draft PRs with plain-language “What was built” and “What to look out for”.

### 2026-08-28 — Phase 10: contract-vs-chat alignment recovery (10.7)
- **Recovered issue #4:** repaired only the legacy `test_term_approvals.py` fixture, which previously
  moved Approval → Creating without the now-required aligned contract. The deterministic fixture creates
  a fictional generated v1, hashes the exact private bytes, reserves/completes clear alignment against
  the approved structured terms, and satisfies the existing execution trigger before the original
  read-only checklist assertion.
- **Implementation:** the completed 10.7 candidate adds bounded private-PDF extraction, strict 22-field
  validation, deterministic normalized comparison, participant-safe conflict UI/API, two-side override,
  immutable hash/provenance binding, minimal grants, and database hard gates for signing through Creating.
- **Verify:** focused Gate-B **32/32**, targeted QA PASS, targeted security PASS, and the issue-defined
  complete regression passed: AI **11**, extraction **29/20**, Gate-A **7/39**, Stage Engine **23**,
  maker-checker **10**, contract alignment **13/13**, contract flow **28**, RLS **4**, template,
  compile, TypeScript, lint (0 errors; 3 existing warnings), Expo web export (36 routes), and diff check.

### 2026-08-28 — Phase 10: all-participant summary review and Gate B (10.6)
- **Independent review:** post-repair security review PASS; QA automated checks PASS with the only
  limitation being the explicitly founder-owned two-device Realtime/visual confirmation.
- **Security repair round 1:** revoked authenticated `deals` UPDATE; limited participant UPDATE to own
  `last_read_at`; proved direct stage/identity and participant deal/role/profile pivots fail without
  artifacts or access gain; and suppressed Stage Engine notification emission for idempotent handled
  transitions. The dev Gate-B suite now passes 32/32, including installed Realtime RLS visibility and
  exactly one notification set under concurrent completion plus later retry.
- **Backend/schema:** added participant-safe 22-field review, derived latest approver roster, strict
  version/role/ownership/completeness checks, append-only decisions, issue recovery, and one atomic final
  Chatting → Approval transaction. Revoked authenticated writes/RPC execution and published only
  participant-RLS approval INSERTs as Realtime refresh hints.
- **Frontend:** field/status/value/evidence review with blockers and bounded changes explanation;
  pending/approved/changes-requested roster; action/focus/Realtime refetch; read-only checklist retained
  through Approval and Creating.
- **Verify:** development migration applied/reapplied; Gate B 32/32; extraction 29/29 + 20/20; Gate A
  7/7 + 39/39; AI boundary 11/11; Stage Engine 23/23; maker-checker 10/10; contract template PASS;
  contract flow 28/28; compile, TypeScript,
  lint (0 errors), 36-route web export, diff hygiene, and fictional cleanup pass. Two-device visual/
  Realtime behavior remains LIMITED to a manual two-device check for independent QA/founder review;
  publication, database Realtime authorization, API state, and fallback refetches pass automatically.

### 2026-08-27 — Phase 10: AI service and Gemini provider boundary (10.1/10.2)
- **Did:** added the provider-neutral `AIRequest` / `AIResult` / `AIError` contract and a backend-only
  Gemini adapter. It maps missing configuration, timeout, rate limit, malformed output, and provider
  failure to friendly stable errors; the existing Gate-A parser-pending seam is unchanged.
- **Security:** switched to maintained constrained `google-genai`; SDK imports remain isolated to
  `ai_service.py`, keys stay ignored/backend-only, clients close after each call, and no parsing,
  persistence, UI, stage, schema, or migration work entered the block.
- **Verify:** compile; AI service 11/11; summary-gate unit 7/7; contract template; diff hygiene; and
  independent QA/security reviews all pass. The serialized summary-gate run exercised 39 assertions but
  is LIMITED by cleanup after an already-absent fictional auth user. Live fictional Gemini smoke is
  opt-in and LIMITED this run.

### 2026-08-26 — Phase 9: platform contract generation + three-mode signing (9.11/9.12)
- **Backend:** private, idempotent version-1 generation from approved summary; escaped Jinja2 template
  → WeasyPrint PDF; participant-only five-minute links; stored/drawn/wet-PDF signing; atomic held maker
  release; freshly rendered executed PDF; retry-safe system Approval → Creating.
- **Frontend:** Approval contract card with secure download, creator/brand checklist, held/approved/
  rejected maker-checker states, checker decisions, validation/loading/retry states, SignaturePad, and
  native/web PDF picker + owner-folder upload. Successful actions refetch contract and deal state.
- **Security/schema:** migrations 020–024 applied to development; private bucket, strict SVG/readable-PDF
  validation, one signer per side, service-only held payloads, immutable wet evidence, safe column grants,
  and backend-only signing/request writes. Phase 10 remains an honest no-op seam.
- **Verify:** contract flow 28/28; template PASS; summary gate 39/39; stage engine 23/23; maker-checker
  10/10; Python compile, strict TypeScript, Expo web export, schema/grant inspection, diff check, and
  fictional-data cleanup all pass. Manual Expo Go/two-device visual pass remains.

### 2026-08-23 — Phase 9: minimum fields + two-side summary trigger (9.9/9.10)
- **Did:** Replaced Chatting's incorrect direct `approve-summary` action with a server-owned
  12-item checklist and Gate-A request/other-side-confirmation workflow. The deal room now shows
  exact missing or ambiguous fields inline, proposes/accepts two-side manual overrides, and
  displays request waiting / Not yet / parser-pending states.
- **Security + concurrency:** FastAPI verifies participant, Chatting stage, role, and party side;
  Checkers can view but cannot request, confirm, or override. Migration 019 uses a locked state row
  and service-role-only RPCs so duplicate request/confirmation taps are idempotent; every override
  and Gate-A action goes to immutable `audit_log`.
- **Honest Phase-10 boundary:** the `ai_service` parser seam currently does no extraction and no
  fake `ai_summaries` row is created. The confirmation calls its generation seam once, leaves the
  deal in Chatting, and records ready-for-generation/parser-pending state for Phase 10.
- **Verify:** TypeScript and the focused pure 12-field/conditional checklist test pass. The dev
  Supabase Management API returned 544 connection timeouts while applying/verifying migration 019;
  rerun `python backend/migrations/apply_migration.py 019_summary_gate.sql` and the focused dev test
  when it is reachable.

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
