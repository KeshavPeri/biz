# Deal Engine — Biz MVP

> **Version:** 1.0 (draft for review) — 2026-06-04
> **Depends on:** docs/data-model.md (locked). The `deals.stage` enum and the
> `deal_stage_transitions` log are the backbone of this design.
> **The core product.** Take care here.

---

## Overview

A deal moves through **7 stages** in one direction:

```
PENDING → CHATTING → APPROVAL → CREATING → POSTED → PAYMENT → CLOSED
```

Plus:
- A **Disputed** overlay — a flag on a deal while it's in the Payment stage. Not a stage.
- Two **terminal off-ramps** — `Declined` (from Pending) and `Cancelled` (before signing).

**Three rules govern the whole engine:**
1. **The server is the source of truth.** Every transition is validated and executed in
   FastAPI. The client requests a transition; it never performs one. RLS + endpoint checks
   enforce who may trigger what.
2. **Every transition is logged.** Each stage change writes an append-only row to
   `deal_stage_transitions` (from, to, who, type, timestamp). This feeds the audit log.
3. **Forward only.** Stages don't move backward in MVP. Conflicts are resolved *within* a
   stage. The only non-forward moves are the dispute pause and the terminal off-ramps.

**Two scoping notes:**
- **All MVP deals are campaign-type.** The v5 governance matrix flows Campaigns, Products, and
  Experiences & Events differently (e.g. gifting needs no contract or posting proof). But the
  marketplace is deferred, and every MVP deal is created via basic Connect → so the full
  campaign-style 7-stage flow described here applies to all deals. Deal-type flow variations are
  MVP-2, when the marketplace ships.
- **Contract takes precedence post-signing.** Before signing, the contract-vs-chat conflict check
  must be cleared. After signing, if any later disagreement arises, the signed contract is the
  authority — not the chat history.

---

## Stage flow at a glance

```
                          ┌─────────── decline / 72h expiry ──────────► DECLINED (terminal)
                          │
   [Connect] ──► PENDING ─┤
                          │ recipient accepts
                          ▼
                       CHATTING ──── mutual cancel (pre-signing) ──────► CANCELLED (terminal)
                          │ all parties approve the AI terms summary
                          ▼
                       APPROVAL ──── mutual cancel (pre-signing) ──────► CANCELLED (terminal)
                          │ contract generated + all required signatures collected
                          ▼
                       CREATING
                          │ all deliverables approved + creator submits live URL(s)
                          ▼
                        POSTED
                          │ brand confirms post(s) live & correct
                          ▼
                       PAYMENT  ◄──── Disputed overlay can be raised/resolved here
                          │ both parties confirm payment complete
                          ▼
                        CLOSED (terminal — ratings, read-only thread)
```

---

## Transition types

Every transition is one of three kinds. This matters because it defines what the engine
waits for before advancing.

| Type | Meaning | Example |
|---|---|---|
| **Accept-gate** | One specific role takes one action; that advances the stage | Recipient taps Accept |
| **Mutual-gate** | All required parties must confirm before advancing | All approve the AI summary |
| **System-auto** | Advances automatically the moment its preconditions become true — no "advance" button | All signatures collected → Creating |

---

## Stage-by-stage specification

For each stage: what it's for, who's in it, how you got here, what happens, the sticky action
bar per role, the next-action prompt, and the exit condition.

---

### 1 · PENDING

**Purpose:** A connection request awaiting response. The deal exists but isn't live.
**Entry:** Someone taps Connect (creates the deal in Pending; `direction` set to inbound/outbound).
**Who's present:** Initiator + recipient.

**Sticky action bar:**
| Role | Bar |
|---|---|
| Recipient | `[Accept]` `[Decline]` |
| Initiator | Read-only: "Waiting for response · expires in {Xh}" |

**Next-action prompt:** Recipient → "Respond to this connection request." Initiator → none.

**Exit:**
- **Accept-gate** → recipient accepts → **CHATTING**
- Off-ramp → recipient declines, *or* 72h passes with no response → **DECLINED** (terminal)

> **Exclusivity conflict warning fires here.** At the moment a creator accepts (and at deal
> creation if the creator initiated), the system cross-references the deal's category against the
> creator's active exclusivity clauses. If there's a conflict, a warning is shown *before*
> acceptance is finalised — listing the conflicting brand, category, and expiry. MVP: **warn
> only, never block.** If the creator proceeds, the acknowledgement is logged to the audit trail.

---

### 2 · CHATTING

**Purpose:** Negotiate the deal. Free-form chat until terms are agreed, then lock them via the
AI summary.
**Entry:** Recipient accepted.
**Who's present:** Creator + brand participants (Maker/Admin; Checker if configured).

**What happens:**
1. Parties chat freely (messages, files).
2. The **12 minimum fields** must be present before a summary can be requested (see end of doc).
   A live checklist shows what's still missing. A both-party manual override exists for a field
   the AI didn't detect but both confirm was discussed.
3. **Two gates, in order:**
   - **Gate A — trigger:** either party taps `[Request terms summary]`. The **other party must
     confirm** the request before the AI runs. (Both must confirm the trigger.)
   - The AI then produces a structured summary (the 22 fields), sent to **all** participants
     including any internal Checker.
   - **Gate B — sign-off:** each participant approves or raises an issue (the all-party sign-off
     gate). Advances only when **all** approve.

**Sticky action bar:**
| Role / situation | Bar |
|---|---|
| Before 12 fields complete | Read-only: "{N} fields still needed before summary" |
| 12 fields complete, no request yet | `[Request terms summary]` (either party) |
| Request made, awaiting other party | Other party: `[Confirm request]` `[Not yet]` · Initiator: read-only "Waiting for {name} to confirm" |
| Summary generated, awaiting this user | `[Approve summary]` `[Raise issue]` |
| Summary generated, awaiting others | Read-only: "Waiting for {names} to approve" |
| Issue raised | Back to chatting; `[Request terms summary]` re-enabled |

**Next-action prompt:** Whatever this user must do next ("Confirm the summary request", "Approve the terms summary", or "3 fields still needed").

**Exit:**
- **Mutual-gate** → all participants approve the summary → **APPROVAL**
- Off-ramp → mutual cancel → **CANCELLED**

---

### 3 · APPROVAL

**Purpose:** Turn the agreed summary into a signed contract.
**Entry:** AI summary approved by all.
**Who's present:** Creator + brand participants.

**What happens:**
1. System generates the contract PDF from the approved summary (WeasyPrint).
2. The AI parser extracts terms from the generated contract and runs the **contract-vs-chat
   conflict check** against the approved summary. Any conflict must be resolved before signing
   is enabled.
3. Both parties review and e-sign (stored / draw / print-and-sign bypass).
4. If maker-checker is configured for contract signing: the Maker signs, then the Checker
   approves the signing.

**Sticky action bar:**
| Role / situation | Bar |
|---|---|
| Conflict detected | `[Resolve conflicts]` (signing disabled until cleared) |
| Awaiting this user's signature | `[Review contract]` `[Sign]` |
| Maker signed, checker required | Checker: `[Approve signing]` · Maker: read-only "Awaiting checker" |
| Awaiting other party | Read-only: "Waiting for {name} to sign" |

**Next-action prompt:** "Review and sign the contract", or "Resolve {N} term conflicts first".

**Exit:**
- **System-auto** → all required signatures collected (both parties + Checker if configured)
  and no unresolved conflicts → **CREATING**
- Off-ramp → mutual cancel *before any signature* → **CANCELLED**. Once anyone has signed,
  no cancel — the deal must complete or go to dispute.

---

### 4 · CREATING

**Purpose:** Make the content and get it approved.
**Entry:** Contract fully executed.
**Who's present:** Creator + brand participants.

**What happens:**
1. Brand shares the creative brief (version-controlled; creator must acknowledge updates).
2. For each deliverable, the creator submits a draft.
3. Brand approves or requests a revision (Round X of Y — counter tracks against the contracted
   maximum). If maker-checker is on content approval, Checker confirms approvals.
4. Once a deliverable is approved, the creator posts it live on their platform and submits the
   **live post URL** (the hard gate).

**Sticky action bar:**
| Role / situation | Bar |
|---|---|
| Creator, draft not submitted | `[Submit content]` (per deliverable) |
| Brand, draft awaiting review | `[Approve]` `[Request revision]` |
| Checker required on approval | Checker: `[Confirm approval]` |
| Creator, content approved | `[Submit live URL]` (per deliverable) |
| Waiting on the other side | Read-only status |

**Next-action prompt:** "Submit your draft for {deliverable}", "Review the creator's draft", or "Post and submit the live link".

> **Revision vs rejection.** "Request revision" increments the Round X of Y counter and keeps the
> deal in Creating. Two things are *not* ordinary revisions: an outright **rejection** of the work,
> and **exhausting the contracted revision rounds** with no agreement. The v5 routes both to
> dispute — but the formal Disputed overlay is Payment-stage only. For MVP, these content-stage
> breakdowns **pause the deal and flag platform ops** for manual mediation (and, where relevant,
> a contract amendment — itself MVP-2). Structured content-stage mediation is deferred.

**Exit:**
- **Accept-gate** → all deliverables approved *and* creator has submitted a live URL for each
  → **POSTED**

> **Multi-deliverable note:** the deal-level stage is the master. Per-deliverable status lives
> on `deliverables.status`. The deal advances to Posted only when **all** contracted
> deliverables have a submitted live URL. Staggered posting dates are handled at the
> deliverable level; the deal waits for the last one. (Partial/independent deliverable
> completion is an MVP-2 refinement.)

---

### 5 · POSTED

**Purpose:** Brand verifies the content is live and correct. A confirmation checkpoint.
**Entry:** Creator submitted live URL(s); platform fetched a preview.
**Who's present:** Creator + brand participants.

**Sticky action bar:**
| Role | Bar |
|---|---|
| Brand | `[Confirm post(s) live]` `[Flag issue]` |
| Creator | Read-only: "Waiting for {brand} to confirm your post" |

**Next-action prompt:** Brand → "Confirm the creator's post is live and correct."

**Exit:**
- **Accept-gate** → brand confirms all posts live & correct → **PAYMENT**
- If the brand flags an issue (wrong link, content differs), it routes back to a revision
  conversation within Creating-style handling. (For MVP: flag reopens the deliverable for a
  corrected URL; it does not roll the whole deal back a stage.)

---

### 6 · PAYMENT

**Purpose:** Track payment to completion. **Tracking only — no money moves on-platform.**
**Entry:** Brand confirmed posts live.
**Who's present:** Creator + brand participants.

**What happens:**
1. Brand updates payment status as they pay off-platform (paid full / partial / per milestone).
2. Automated reminders fire (3 days before due / due date / 3 days overdue / 7 days overdue;
   bad-debt flag at 30 days).
3. Creator confirms receipt.
4. Either party can raise a **Dispute** here (see overlay below).

> Payment maker-checker and real release/processing are **deferred to MVP-2**. In MVP the brand
> simply records status; there is no on-platform release to approve.

**Sticky action bar:**
| Role / situation | Bar |
|---|---|
| Brand | `[Update payment status]` `[Raise dispute]` |
| Creator | `[Confirm payment received]` `[Raise dispute]` |
| Both confirmed paid | `[Close deal]` (mutual) |
| Disputed | `[View dispute]` — payment actions paused |

**Next-action prompt:** "Update the payment status", "Confirm you've received payment", or "Both parties confirm to close".

**Exit:**
- **Mutual-gate** → payment recorded complete *and* both parties confirm close *and* not
  currently disputed → **CLOSED**

---

### 7 · CLOSED

**Purpose:** Done. Wrap-up and record.
**Entry:** Both confirmed payment + close.
**What happens:**
- Both parties may leave a rating + review (feeds trust scores).
- Post-deal comments and private notes allowed.
- Chat thread becomes **read-only**.
- Chat record is auto-stored (PDF) for the deal.

**Sticky action bar:** `[Leave rating]` `[Add note]` — then read-only.

**Exit:** None. Terminal.

---

## The Disputed overlay

- **Scope:** can be raised by either party **only during the Payment stage**.
- **Effect:** sets `deals.is_disputed = true`. The Payment pill shows a **red overlay**. It is
  *not* a stage change — the deal stays in Payment.
- **Behaviour:** payment progression and the Close action are **paused** while disputed. A
  dispute ticket (`disputes` row) is created and platform ops are notified.
- **Resolution:** ops mediate (manual for MVP). On resolution, `is_disputed = false` and the
  normal Payment flow resumes (or the deal is closed/refunded per the resolution).

---

## Terminal states

| State | Reached from | How |
|---|---|---|
| **Declined** | Pending | Recipient declines, or 72h expiry |
| **Cancelled** | Chatting, Approval (pre-signature) | Mutual cancel; blocked once anyone has signed |
| **Closed** | Payment | Happy-path completion |

---

## Server-side enforcement (FastAPI)

Every transition request hits a single gated endpoint pattern that checks, in order:

1. **Does the deal exist and is the caller a participant?** (RLS + lookup)
2. **Is the caller the role allowed to trigger this transition?**
   (e.g. only the recipient accepts; only the creator submits a live URL; only the brand
   confirms posts; only a Checker gives checker approval)
3. **Is the deal in the correct current stage for this transition?**
4. **Are the transition's guard conditions met?** (the exit conditions listed per stage)
5. If all pass: update `deals.stage`, write a `deal_stage_transitions` row, fire notifications,
   write an `audit_log` entry for sensitive transitions (signing, payment, close).

The client only ever *requests*; it cannot set a stage directly. Any failed check returns a
clear, user-friendly reason (never a raw error).

---

## Guard conditions (the precondition for each forward transition)

| Transition | Type | Guard |
|---|---|---|
| Pending → Chatting | Accept-gate | Caller = recipient; within 72h |
| Chatting → Approval | Mutual-gate | AI summary exists; all participants approved it |
| Approval → Creating | System-auto | Contract executed (all required signatures); no unresolved conflicts |
| Creating → Posted | Accept-gate | All deliverables approved; live URL submitted for each |
| Posted → Payment | Accept-gate | Brand confirmed all posts live |
| Payment → Closed | Mutual-gate | Payment recorded complete; both confirm close; not disputed |

---

## SLA timers (drive notifications, not stage changes)

The engine watches the clock on anything it's waiting for. These don't change a stage by
themselves — they escalate notifications and colour the deal's RAG status:

- **Pending:** connection request expires at **72h** → auto-Declined.
- **Any awaited confirmation** (summary request, approval, signature, posted-confirmation):
  **amber at 24–48h**, **red / escalation at 48–72h**, per the v5 reminders.
- **Posting deadline:** 48h and 2h reminders before; amber then red if missed.
- **Rights expiry:** notify both parties **14 days** before and on expiry.

(Full notification tiers and timing live in docs/notifications.md, 3.9.)

## Things that run *parallel* to the stage machine

Not everything follows the 7 stages. Two things run independently:

- **Brand rights chip / rights period.** Set at contract signing, it runs on its own clock and
  persists even after the deal is **Closed**, until the rights expiry date. It is never tied to
  the current stage. (Detail in docs/data-model.md rights tables + the trackers.)
- **The approver status checklist.** Visible across Approval *and* Creating, showing each
  required approver's real-time status (pending / approved / changes requested).

---

## The 12 minimum fields gate

Before a terms summary can be requested in Chatting, all 12 must have been discussed. This is the
exact list from the v5 spec (the source of truth) and matches the parser design in
docs/ai-parser.md (3.8):

1. Payment amount
2. Payment terms — type + from-date (invoice date or posting date)
3. Exclusivity — yes/no (+ duration + category if yes)
4. Usage rights — yes/no (+ duration + channels if yes)
5. Whitelisting / boosted ads — yes/no
6. Blackout window — yes/no (+ duration if yes)
7. Revision rounds — maximum allowed
8. Creative guidance / brief
9. Content format per deliverable
10. Platform per deliverable
11. Posting date / window per deliverable
12. Sponsored content disclosure requirement

"No" is a valid, explicit answer for the yes/no fields — it must be confirmed, not assumed.
If a party insists a field was discussed but the AI didn't detect it, a both-party manual
override clears the checklist item.

(The parser extracts up to 22 fields total — see ai-parser.md. These 12 are the *minimum* to
request a summary; the remaining fields, e.g. content ownership, deliverable count, location,
and milestone schedule, are captured/confirmed through the summary and contract steps.)

---

## Data-model addendum (needs your nod)

Designing the state machine surfaced one small gap in the locked data model:

> **`deals.stage` enum needs two terminal values added: `declined` and `cancelled`.**
> The current enum has only the 7 happy-path stages. These two off-ramps need to be
> representable. This is a one-line enum change, no structural impact.

Everything else maps cleanly onto the existing tables. If you approve this addendum, I'll note
it so the migration includes it.

---

*Next after approval: docs/rbac.md (task 3.6) — the roles and permission matrix.*
