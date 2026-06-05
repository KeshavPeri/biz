# RBAC — Roles & Permissions — Biz MVP

> **Depends on:** data-model.md (roles live on `brand_members` and `deal_participants`),
> deal-engine.md (who can trigger each stage transition).
> **Pairs with:** security.md covers RLS row-visibility; this doc covers *what actions each role
> may perform*. Two halves of the same lock.

---

## The core idea

There are **two different questions** an access system answers, and Biz keeps them separate:

- **Can you see this row?** → Row Level Security (RLS), driven by *participation + ownership*.
  Detailed in security.md.
- **Can you perform this action?** → RBAC, driven by *role*. This document.

Both are enforced **server-side** (FastAPI + Supabase policies). The client never decides
permissions — it only requests, and the server validates.

---

## Roles are layered (three levels)

A person's effective permissions come from **three stacked layers**, not one role field.

### Layer 1 — Account type
Set at sign-up. Answers "what kind of user are you on the platform?"
- **Creator** — an individual.
- **Brand** — a member of a brand organisation.
- *(Agency — deferred to MVP-2.)*

### Layer 2 — Brand standing (`brand_members.brand_role`)
For brand accounts only. Answers "what is your authority *within your brand*?"
- **Admin** — manages the brand: invites/removes members, configures maker-checker rules,
  edits the brand profile, and can act in any operative capacity on deals. **Multiple admins
  allowed.**
- **Member** — a regular brand employee. Can be assigned operative roles on deals.

> Maker and checker are deliberately *not* values here — they are not permanent identities.
> (Manager and Viewer from the v5 spec are deferred to MVP-2.)

### Layer 3 — Per-deal operative role (`deal_participants.participant_role`)
Assigned **per deal**. Answers "what is your job *on this specific deal*?"
- **creator** — the creator on the deal.
- **brand_admin** / **brand_maker** / **brand_checker** — the operative hat a brand person
  wears *on this deal*.

**This layer is where maker/checker actually lives** — and it's the answer to your point:

> ✅ **A person can be the maker on Deal A and the checker on Deal B.** Their brand standing
> (admin/member) doesn't change; only the per-deal hat does.
> ✅ **A brand can have many admins, many makers, and many checkers** — there's no cap, because
> maker/checker is just a per-deal assignment any member (or admin) can receive.

---

## The four MVP roles, defined

| Role | Layer | Who | Core job |
|---|---|---|---|
| **Creator** | account type | An individual creator | Their side of every deal: negotiate, sign, create, post, confirm payment |
| **Brand Admin** | brand standing | Senior brand user | Run the brand: members, maker-checker config, brand profile. Can also act on deals in any capacity |
| **Brand Maker** | per-deal | Brand member assigned to *do* on this deal | Initiates deal actions: negotiate, sign, approve content, mark payment |
| **Brand Checker** | per-deal | Brand member assigned to *approve* on this deal | Signs off on the gated actions the brand configured (payment / contract / content) |

*(Deferred to MVP-2: Manager, Viewer, Agency roles, and per-campaign granular permission matrices.)*

---

## The two non-negotiable rules

1. **Segregation of duties.** On a single deal, for a single gated action, the **maker and the
   checker must be different people.** One person cannot approve their own action. (Across
   different deals, the same person freely switches hats.)

2. **The server is the source of truth.** Every gated action is validated in FastAPI against the
   actor's role *for that deal* before it executes. A correct-looking request from the wrong role
   is rejected with a clear reason.

---

## Maker-checker: how it works in MVP

**Configuration (brand-level, by an Admin).** The brand chooses which action types require a
Checker's sign-off. Three configurable actions (from v5):
- **Contract signing**
- **Content approval**
- ~~Payment release~~ — *configurable in the model, but inert in MVP:* payment is tracking-only,
  there is no on-platform release to approve. The config option exists for when real payments
  ship (MVP-2).

**Per deal.** When the brand engages on a deal, members join as participants with operative
roles. The **Maker** initiates a gated action → if that action type requires a Checker, the
action is held → the assigned **Checker** approves or rejects → only then does it execute. Every
step is written to the audit log.

**If maker-checker is off** for an action (or for the whole brand), the Maker/Admin acts alone —
no hold. Many small brands will run this way. A solo brand (one member) always runs this way:
there is no second person to act as checker, so maker-checker is unavailable until the brand adds
another member.

**MVP simplifications (vs the full v5 spec):**
- **Single checker per action.** v5 allows "multiple checkers, all approve in configured order"
  and "3+ level chains" — both are **MVP-2**. MVP is one checker, one approval.
- Admin can step in as the Checker, or override if the assigned checker is unresponsive (logged).

---

## Permission matrix

✓ = allowed · ✗ = not allowed · **own** = only their own records · **(deal)** = only on deals
they participate in · **cfg** = only if the brand configured this action to need a checker

### Brand & account management
| Action | Creator | Brand Admin | Brand Maker | Brand Checker |
|---|---|---|---|---|
| Edit own profile / media kit | ✓ own | ✓ own | ✓ own | ✓ own |
| Set up / manage own signature | ✓ own | ✓ own | ✓ own | ✓ own |
| Edit brand profile | — | ✓ | ✗ | ✗ |
| Invite / remove brand members | — | ✓ | ✗ | ✗ |
| Assign per-deal operative roles | — | ✓ | ✗ | ✗ |
| Configure maker-checker rules | — | ✓ | ✗ | ✗ |

### Discovery
| Action | Creator | Brand Admin | Brand Maker | Brand Checker |
|---|---|---|---|---|
| Browse creator marketplace | ✗ | ✓ | ✓ | ✓ |
| Browse business marketplace | ✓ | n/a | n/a | n/a |
| View rate card (brands only) | — | ✓ | ✓ | ✓ |
| Initiate a Connect | ✓ | ✓ | ✓ | ✗ |

### Deal flow — by stage
| Action (stage) | Creator | Brand Admin | Brand Maker | Brand Checker |
|---|---|---|---|---|
| Accept / decline connection (Pending) | ✓ if recipient | ✓ if recipient | ✓ if recipient | ✗ |
| Send messages (Chatting+) | ✓ (deal) | ✓ (deal) | ✓ (deal) | ✓ (deal) |
| Request terms summary (Chatting) | ✓ | ✓ | ✓ | ✗ |
| Confirm the summary request | ✓ other party | ✓ other party | ✓ other party | ✗ |
| Approve terms summary (sign-off gate) | ✓ | ✓ | ✓ | ✓ if participant |
| Resolve contract↔chat conflicts (Approval) | ✓ | ✓ | ✓ | ✗ |
| Sign contract (Approval) | ✓ | ✓ | ✓ | ✗ |
| Approve the signing (Approval) | ✗ | ✓ cfg | ✗ | ✓ cfg |
| Share creative brief (Creating) | ✗ | ✓ | ✓ | ✗ |
| Submit content draft (Creating) | ✓ | ✗ | ✗ | ✗ |
| Approve / request revision (Creating) | ✗ | ✓ | ✓ | ✗ |
| Approve the content sign-off (Creating) | ✗ | ✓ cfg | ✗ | ✓ cfg |
| Apply private content labels | ✓ own | ✗ | ✗ | ✗ |
| Submit live post URL (Posted) | ✓ | ✗ | ✗ | ✗ |
| Confirm post is live (Posted) | ✗ | ✓ | ✓ | ✗ |
| Capture invoice / payment info (Payment) | ✓ own side | ✓ | ✓ | ✗ |
| Update payment status (Payment) | ✗ | ✓ | ✓ | ✗ |
| Confirm payment received (Payment) | ✓ | ✗ | ✗ | ✗ |
| Raise a dispute (Payment) | ✓ | ✓ | ✓ | ✓ |
| Confirm close (Closed) | ✓ | ✓ | ✓ | ✗ |
| Leave rating / review (Closed) | ✓ | ✓ | ✓ | ✓ if participant |

### Group chat
| Action | Creator | Brand Admin | Brand Maker | Brand Checker |
|---|---|---|---|---|
| Request to add a participant | ✓ | ✓ | ✓ | ✓ |
| Approve a participant-add request | ✓ existing | ✓ existing | ✓ existing | ✓ existing |
| Rename the deal / chat | ✓ | ✓ | ✓ | ✓ |

### Trackers & documents
| Action | Creator | Brand Admin | Brand Maker | Brand Checker |
|---|---|---|---|---|
| View deal / payment / calendar / rights trackers | ✓ own deals | ✓ brand deals | ✓ (deal) | ✓ (deal) |
| View / download the contract PDF | ✓ (deal) | ✓ (deal) | ✓ (deal) | ✓ (deal) |
| View audit log | ✗ | ✗ (ops only) | ✗ | ✗ |

> Note on the matrix: **Brand Admin** can do everything a Maker can — the rows separate them only
> to show where the Checker's approval is the *distinct* gate. In practice an Admin often *is* the
> Maker on a small deal; segregation only requires that the same person isn't both maker and
> checker on the same action.

---

## Edge cases (from the v5 spec)

| Situation | Handling |
|---|---|
| Brand has only one member (solo brand) | The sole member is an Admin and acts as `brand_admin` on every deal. Maker-checker cannot be enabled — segregation of duties needs two distinct people — so it stays off and all actions execute directly. The UI hides/disables the maker-checker toggle until a second member is added. |
| Assigned Checker leaves the brand | An Admin must reassign a Checker before any gated action on that deal can proceed. Pending actions stay held. |
| Checker unresponsive | After 24h, escalation to Admin; an Admin may approve in the Checker's place (logged as an override in the audit log). |
| Brand member is both maker and checker on a deal | Blocked. Segregation of duties — the system refuses to let the same person approve their own action. |
| Maker-checker turned off mid-deal | Already-held actions resolve under the rule in force when raised; new actions follow the new config. |
| Creator tries a brand-only action (or vice versa) | Rejected server-side with a clear message; logged. |

---

## Enforcement model

1. **Endpoint guard (FastAPI).** Every action endpoint first resolves the caller's role *for the
   specific deal/brand in question* (via `deal_participants` / `brand_members`), then checks it
   against this matrix. No match → rejected.
2. **RLS (Supabase).** Independently, the database restricts which rows the caller can read/write
   at all (participation + ownership). Even a bug in app code can't leak data the RLS forbids.
3. **Audit log.** Sensitive actions — signing, payment status changes, stage advances, role
   changes, maker-checker approvals and overrides, exclusivity-warning overrides — write an
   immutable `audit_log` row (actor, action, entity, timestamp, IP).

The two layers are deliberately redundant: RBAC stops the *action*, RLS stops the *data access*.
A mistake in one is caught by the other.

---

## Data-model implications (carry into the migration)

1. **`brand_members.brand_role` → `admin | member`** (was `admin|maker|checker`). The maker/checker
   hat is per-deal, not a brand-level identity.
2. **`deal_participants.participant_role`** stays `creator | brand_admin | brand_maker |
   brand_checker` — this is where the operative per-deal role lives. (No change; confirmed correct.)
3. **Segregation-of-duties constraint:** the app enforces that, on one deal, the same `profile_id`
   is not both `brand_maker` and `brand_checker` for the same gated action.
4. `maker_checker_config.action_type` keeps `payment_release` as an option but it is inert in MVP
   (tracking-only payments).

---

## Deferred to MVP-2

Manager and Viewer brand roles · Agency roles and representation permissions · multiple-checker
ordered approval chains (3+ levels) · per-campaign granular permission matrices · maker-checker
on real payment *release* (when payments process on-platform).
