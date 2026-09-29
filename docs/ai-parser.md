# AI Contract Parser — Biz MVP

> **Depends on:** data-model.md (`deal_terms`, `ai_summaries`, `extracted_terms`, the five rights
> tables, `deliverables`, `payment_milestones`), deal-engine.md (when the parser runs),
> api-architecture.md (all AI runs server-side, behind `ai_service`).

---

## What the parser does

One job: turn a messy human negotiation into **22 clean, structured fields** the system can store
and the trackers can query. Because those fields end up in a binding contract, the entire design
is built for reliability over cleverness — the parser would rather say "not discussed" than guess.

It runs **server-side only**, always through the `ai_service` abstraction. The frontend never
calls the AI directly.

---

## Where it runs — two trigger points

1. **From chat → the terms summary** (Chatting stage). The parser reads the conversation and
   produces the structured summary both parties approve. This is the primary, high-value use.
2. **From the generated contract → the conflict check** (Approval stage). The parser re-extracts
   the 22 fields from the generated contract PDF and compares them to the approved summary.

> **MVP honesty note.** In MVP the contract is generated *from* the approved summary, so the
> re-extraction will largely match by construction — the conflict check is a **light safety net**
> that mainly catches generation bugs. It becomes genuinely valuable in MVP-2, when brand-uploaded
> contracts (an independent document) are parsed. The engine is built source-agnostic so that
> upgrade is a scope change, not a rebuild.

---

## Core principles (the guardrails)

1. **Structured output, always.** The AI returns strict JSON matching a fixed schema — the 22
   fields with defined types and allowed values — never free prose. A deterministic validation
   layer checks it before anything is stored.
2. **Never guess.** In a contract context a hallucinated value is dangerous. Every field carries a
   status — `found` / `not_discussed` / `ambiguous` — and the AI returns null rather than invent a
   value. "Not discussed" is a valid, useful answer.
3. **The human is the authority.** The AI extracts; it never finalises. Both parties confirm the
   extracted terms before they become binding (the deal-engine sign-off gate).
4. **Normalise casual input.** Indian deal chats are messy — "50k", "net 15", "post next Friday".
   The AI normalises to clean canonical values; the validation layer enforces the types.
5. **The summary is rendered *from* the validated data.** The readable summary users approve is
   generated from the structured JSON — not written separately by the AI. So what a user approves
   is exactly what gets stored; the two can't drift.

---

## The `ai_service` abstraction (locked rule)

Every AI call goes through one `ai_service` module. **Gemini** sits behind it for MVP (free tier).
Swapping to another provider (e.g. Claude) is a one-file change. The prompt and the output schema
are written provider-agnostically so nothing else in the codebase knows or cares which model ran.

---

## The 22 fields — the extraction contract

`★` = one of the 12 mandatory minimum fields that gate the terms summary (see next section).
"Required" = whether the field must be resolved before the deal can progress.

| # | Field | Type | Stored in | Required | Key extraction rule |
|---|---|---|---|---|---|
| 1 ★ | Payment amount | number + currency | `deal_terms` | Mandatory | Currency must be specified. Per-deliverable breakdown if milestone-based. |
| 2 ★ | Payment terms — type | enum: upfront / on_posting / net_x_days / milestone / combination | `deal_terms` | Mandatory | Exactly one structure. Combination requires each milestone defined. |
| 3 ★ | Payment terms — from-date | enum: invoice_date / posting_date (+ net days) | `deal_terms` | Mandatory | "net 30" *without* a from-date is treated as **incomplete** and flagged. |
| 4 ★ | Exclusivity — yes/no | bool | `exclusivity_clauses` | Mandatory (declare either way) | "No" must be *confirmed*, not assumed. |
| 5 | Exclusivity — duration | int (days) | `exclusivity_clauses` | If exclusivity = yes | "a few weeks" → ambiguous, must clarify. |
| 6 | Exclusivity — category | text | `exclusivity_clauses` | If exclusivity = yes | NOT blanket unless explicitly agreed. "all beauty" vs "skincare only" distinguished. Feeds conflict checker. |
| 7 ★ | Usage rights — yes/no | bool | `usage_rights` | Mandatory (declare either way) | Explicit either way. |
| 8 | Usage rights — duration | int (days) / is_perpetual | `usage_rights` | If usage = yes | Perpetuity must be explicit and labelled "Perpetual Rights"; shown as a separate chip. |
| 9 | Usage rights — channels | text[] | `usage_rights` | If usage = yes | Vague "any channel" must be confirmed explicitly; each channel listed separately. |
| 10 ★ | Whitelisting — yes/no | bool | `whitelisting_arrangements` | Mandatory (declare either way) | Distinct from usage rights (brand runs ads from creator's own handle). |
| 11 ★ | Blackout window — yes/no | bool | `blackout_windows` | Mandatory (declare either way) | Pre- and post-posting blackouts specified separately if applicable. |
| 12 | Blackout — duration + timing | enum: before/after/both + int | `blackout_windows` | If blackout = yes | Timing relative to posting must be specific. Feeds calendar + conflict checker. |
| 13 ★ | Revision rounds — max | int | `deal_terms` | Mandatory | A specific number. "reasonable" / "as needed" → ambiguous. |
| 14 ★ | Creative guidance / brief | text / brief reference | `briefs` / `deal_terms` | Mandatory | If no brief: creator must confirm they're creating at their own discretion. |
| 15 ★ | Content format per deliverable | enum (see list below) | `deliverables` | Mandatory | "a post" without a format → ambiguous. |
| 16 ★ | Platform per deliverable | enum (see list below) | `deliverables` | Mandatory | One platform per deliverable unless cross-posting explicitly agreed. |
| 17 ★ | Posting date / window per deliverable | date or date-range | `deliverables` | Mandatory | A specific date OR a range is fine. No date → incomplete. |
| 18 ★ | Sponsored content disclosure | bool (+ platform rules) | `disclosure_requirements` / `deal_terms` | Mandatory (legal) | If not discussed → flagged. Platform-specific rules surfaced. |
| 19 | Content ownership | enum: creator / brand | `deal_terms` | Mandatory | **No default assumption** — must be explicit. Critical for UGC. |
| 20 | Deliverable count | int | `deal_terms` (+ rows in `deliverables`) | Mandatory | A confirmed number. "a couple of posts" → ambiguous. |
| 21 | Location | text | `deliverables` | If Experience/Event deal | Physical address, or a platform/link if online. |
| 22 | Milestone schedule | array of {trigger, amount, due_date} | `payment_milestones` | If milestone structure | Each milestone needs trigger + amount + date. Vague → flagged. |

**Content format enum:** Reel · Static Post · Story · Carousel · YouTube Video · YouTube Short ·
Blog Post · UGC Photo · Podcast Read · X/Twitter Thread · LinkedIn Post · Pinterest Pin.

**Platform enum:** Instagram · TikTok · YouTube · LinkedIn · X/Twitter · Pinterest · Threads ·
Podcast platform · Brand's own channel (UGC).

**Versioned field-18 contract:** stored `chat-terms-22.v1` summaries keep the historical
`{"required": bool, "platform_rules": string[]}` value and are always validated as v1. New
summaries use `chat-terms-22.v2`, where every rule is an exact
`{"platform": Platform, "rule": bounded non-empty text}` object. `required=false` permits only an
empty rule list. `required=true` requires at least one rule for every distinct negotiated
deliverable platform and rejects rules for absent platforms, normalized duplicate platform/rule
pairs, unknown keys or enums, unsafe text, and more than 50 rules. Rule order has no contractual
meaning. The matching contract extraction families are `contract-terms-22.v1` and
`contract-terms-22.v2`; persisted version metadata, never payload shape, selects the validator.
Legacy anonymous v1 rules are not assigned to a platform or rewritten.

**Versioned field-10 contract:** v1/v2 summaries retain the historical boolean whitelisting value
and are never inferred into detailed records. Fresh summaries use `chat-terms-22.v3`; only the
nested value of the existing field changes to `{enabled, arrangements}`. Disabled means an empty
list. Enabled requires 1–50 complete arrangements, each with a supported platform, bounded
non-secret ad-account label/ID, explicit ordered inclusive ISO dates, and optional non-negative
budget in the found deal-payment currency. Exact normalized duplicates are rejected; the same
platform/account is allowed for distinct periods. Credentials, missing details, or ambiguity leave
the whole field unresolved. Arrangement order is non-substantive. The matching
`contract-terms-22.v3` family is selected only by the exact persisted schema/prompt pair.

---

## The 12 mandatory minimum fields

These (the `★` rows) must be resolved before the terms summary can be requested in Chatting. They
match the deal-engine gate and the v5 checklist exactly. As a checklist they read:

1. Payment amount
2. Payment terms — type + from-date
3. Exclusivity — yes/no
4. Usage rights — yes/no
5. Whitelisting — yes/no
6. Blackout window — yes/no
7. Revision rounds — max
8. Creative guidance / brief
9. Content format per deliverable
10. Platform per deliverable
11. Posting date / window per deliverable
12. Sponsored content disclosure

The yes/no fields count as resolved when **either** answer is explicitly confirmed — "no
exclusivity" is a complete answer, an *un-discussed* exclusivity is not. The remaining fields
(durations, categories, channels, ownership, deliverable count, location, milestones) are captured
through the summary and contract steps; the conditional ones (5, 6, 8, 9, 12, 21, 22) become
required the moment their parent answer is "yes".

---

## Field status model

Every field comes back tagged, and the tag drives the UI:

| Status | Meaning | UI behaviour |
|---|---|---|
| `found` | A clear value was extracted | Shown for confirmation |
| `not_discussed` | The topic never came up | Shown in the "still needed" checklist; blocks summary if it's a ★ field |
| `ambiguous` | Mentioned but unclear ("a few weeks", "some posts") | Flagged for clarification before it can be confirmed |

A both-party manual override exists for the case where a value *was* discussed but the AI didn't
detect it — both confirm and the checklist item clears (logged).

---

## Normalisation rules

The AI normalises casual input to canonical values before anything is stored:

- **Currency / amounts:** "50k" → 50000; currency captured separately; "₹25,000" → 25000 + INR.
- **Relative dates:** "next Friday", "first week of June" → an absolute date or a date range,
  resolved against the message timestamp.
- **Durations:** "a month" → 30 days; "6 weeks" → 42 days, stored as day counts.
- **Net terms:** "net 30" → net_x_days with net_days = 30 — but only complete once the from-date
  (invoice vs posting) is also resolved.

Normalising up front is also what makes conflict detection reliable (below).

---

## The extraction flow (chat → summary)

1. Server gathers the deal's chat history.
2. `ai_service` extracts all 22 fields into validated JSON, each with a status flag.
3. The validation layer checks the JSON (types, enums, conditional rules). Malformed → re-prompt,
   never store.
4. A readable summary is **rendered from the validated JSON** and shown to all participants.
5. Each participant approves or raises an issue (the all-party sign-off gate).
6. On full approval, the confirmed values are written to the canonical tables — `deal_terms`, the
   rights tables, `deliverables`, `payment_milestones` — and the raw AI output is kept on
   `ai_summaries` for provenance.

---

## Conflict detection (contract vs chat)

Runs at the Approval stage. It is **deterministic code, comparing normalised canonical values** —
not a second AI judgement:

- Both the chat-summary fields and the contract-extracted fields are normalised to the same
  canonical form first. So "₹25,000" vs "25000 INR", or "30 days" vs "1 month", compare equal —
  formatting and phrasing differences disappear *before* comparison. This is how the system
  distinguishes a trivial wording difference from a substantive one without asking the AI to
  judge it.
- Sponsored-disclosure comparison is version-pinned. V1 retains its unordered general string-list
  comparison. V2 sorts complete platform/rule pairs by platform and normalized rule text; moving a
  rule to another platform, adding it, or dropping it remains a conflict. Mixed or unsupported
  schema families fail closed before an alignment result can enable signing.
- Any genuine value mismatch is surfaced to both parties and must be resolved (or explicitly
  overridden by both) before signing is enabled.
- **Contract takes precedence post-signing:** before signing, conflicts must be cleared; after
  signing, the signed contract is the authority if any later disagreement arises.

---

## Prompt strategy

The system prompt is provider-agnostic and built around the guardrails. Its required elements:

- **Role:** "You extract structured deal terms from an influencer-marketing negotiation."
- **The schema:** the exact 22 fields, their types, and allowed enum values.
- **The never-guess rule:** return `not_discussed` or `ambiguous` with a null value rather than
  infer; "no" is only valid if explicitly stated.
- **Normalisation instructions:** the rules above (amounts, dates, durations, net terms).
- **Output contract:** strict JSON only, no prose, no markdown — each field as
  `{ value, status, evidence }` where `evidence` quotes the message it came from (for the
  confirmation UI and audit).

A short skeleton (illustrative — the real prompt is tuned during the build):

```
You extract deal terms. Return ONLY JSON matching the schema.
For each field: {value, status: found|not_discussed|ambiguous, evidence}.
Never infer a value. "No"/"none" counts only if explicitly stated.
Normalise: amounts to integers, dates to ISO, durations to days.
Schema: { payment_amount: {...}, payment_terms_type: {...}, ... }  // all 22
```

---

## Validation layer

After the AI returns, deterministic code (not the AI) enforces:

- JSON parses and matches the schema.
- Types are correct; enum values are in the allowed set.
- Conditional requirements hold (e.g. if `exclusivity.yes` then duration + category present).
- On any failure: one structured re-prompt; if it still fails, surface a clear "couldn't parse —
  please restate" message rather than storing anything.

---

## Testing

Per the project golden rules: the parser is tested on **realistic but fictional** deal chats
(real-looking names, amounts, clauses, dates) and the AI **genuinely processes them** — never a
hardcoded or placeholder response. No real person's private data is used in testing.

---

## Privacy consideration

Sending deal chats to extract terms means real conversation content is sent to Google's Gemini
API. This is acceptable for MVP (testing uses fictional data, and Gemini behind `ai_service` is
the locked stack), but it is a genuine consideration for real production data later — and one
reason the `ai_service` swap path matters. Treated in full in security.md.

---

## Deferred (MVP-2)

Brand-uploaded contract parsing (an independent document — makes the conflict check genuinely
meaningful) · editable-field population within uploaded contracts · AI auto-detecting draft
clauses from free-form chat · multi-language extraction (Hindi / regional).
