# Notification Architecture — Biz MVP

> **Depends on:** data-model.md (`notifications`, `notification_preferences`), deal-engine.md
> (the events that fire notifications), api-architecture.md (notifications are created server-side;
> email is sent via Resend).

---

## Channels in MVP

Two channels only:

- **In-app** — the notification centre (`notifications` table) plus live delivery over Supabase
  Realtime (the bell badge updates instantly).
- **Email** — transactional email via Resend (free tier: 3,000/month).

**No SMS. No web/native push.** The v5 spec says "push" throughout — for MVP, **every "push"
maps to in-app (realtime) + email.** Rich push returns with the native app (MVP-2).

---

## The model: in-app is a log, email is the alert

This is the key simplification that makes the tier rules clean:

- **The in-app centre entry is always written immediately** for every notification, regardless of
  tier or quiet hours. It's a passive log — it never wakes anyone up, so there's no reason to hold
  it. The bell badge updates live via Realtime.
- **Email is the active alert**, so the tier rules below really govern *email*: when it sends, and
  whether it respects quiet hours.

---

## Priority tiers

From the v5 engine spec. Every notification is exactly one tier.

| Tier | Examples | In-app | Email | Quiet hours | Batching |
|---|---|---|---|---|---|
| **Critical** | Dispute raised · payment overdue / bad debt · deal moved to Red · contract-breach warning | Immediate | **Immediate** | **Ignored** | Never batched |
| **Important** | Stage advance · approval / signature needed · deadline & expiry reminders · connection request | Immediate | Immediate, **unless** quiet hours (held until they end) | Respected | Not batched |
| **Informational** | New message · status change · confirmations · profile nudges | Immediate | **Batched** into digests (no individual email) | Respected | Batched |

**Critical overrides preferences.** A user cannot suppress critical deal alerts — if they disable
everything, a one-time warning explains that critical alerts will still be delivered.

---

## How notifications are triggered

Two sources:

1. **Event-driven** — fired inline by a FastAPI action as it happens (a stage advance, a signature,
   a dispute). The action writes the `notifications` row and, per tier, sends the email.
2. **Time-driven** — fired by a **scheduled worker** (reminders, expiry alerts, digests). These
   aren't tied to a user action; a periodic job checks due dates and emits them.

> **Build-phase flag:** the time-driven notifications need a scheduled worker (cron-style) running
> on Railway. Worth confirming the free tier supports a background worker when we deploy — same
> flag as in api-architecture.md.

---

## The engine logic (per event)

1. Determine the **tier**.
2. Always write the in-app `notifications` row (recipient, tier, title, body, deal deep-link).
3. Check the recipient's `notification_preferences` (category enabled? email enabled?) — **skipped
   for Critical**.
4. Apply tier rules: Critical → email now; Important → email now unless in quiet hours (then hold);
   Informational → no individual email, fold into the next digest.
5. If several alerts land in a short window, **stack them into one summary** rather than firing many.

---

## In-app notification centre

- Bell icon, top-right (not a bottom-nav item).
- A log of all past notifications with read/unread state.
- Each entry **deep-links** to its source (the deal, the action).
- **Grouped by deal.**
- Read on view.
- Oldest **auto-cleared after 90 days**.
- More than 100 unread → paginated, oldest first.

---

## Notification preferences

Per `notification_preferences`: per-category toggles, per-channel (in-app / email), and a
quiet-hours window. Critical alerts are always delivered regardless. Disabling everything triggers
the one-time critical-alerts warning.

---

## Event catalogue

Grouped by area. "Channels" assumes the recipient hasn't disabled the category (Critical ignores
that). Events for deferred features (pins, voice notes, read receipts, real payment release, etc.)
are intentionally omitted.

### Onboarding & account
| Event | Tier | Channels | Timing |
|---|---|---|---|
| Email OTP at sign-up | Important | Email | Immediate |
| Welcome | Informational | Email | Immediate |
| Profile completeness nudge | Informational | In-app + email | At 24h and 72h if < 60% |
| Social platform linked (mock) | Informational | In-app | Immediate |
| Signature saved | Informational | In-app | Immediate |
| Brand domain verified / badge issued | Informational | Email | Immediate |
| Team invite sent / accepted | Important | Email | Immediate |

### Deal flow
| Event | Tier | Channels | Timing |
|---|---|---|---|
| Connection request received | Important | In-app + email | Immediate |
| Connection accepted / declined | Important | In-app + email | Immediate |
| Connection request expiring | Important | In-app | At ~60h (before 72h expiry) |
| Missing minimum fields flagged | Important | In-app | On summary request |
| Summary request awaiting other party's confirm | Important | In-app | Immediate |
| Terms summary ready to approve | Important | In-app + email | Immediate; reminder 24h; escalate 48h |
| Summary issue raised (back to chatting) | Important | In-app + email | Immediate |
| Signature requested | Important | In-app + email | Immediate; reminder 24h; escalate 48h |
| Contract fully executed | Important | In-app + email | On full execution |
| Extracted terms ready to confirm | Important | In-app | Immediate |
| Contract-vs-chat conflict flagged | Critical | In-app + email | Immediate |
| Maker-checker approval pending (to Checker) | Important | In-app + email | Immediate; Admin escalation if unresponsive 24h |
| Maker-checker decision (to Maker) | Important | In-app | Immediate |
| Content submitted (to brand) | Important | In-app | Immediate |
| Content decision: approved / revision (to creator) | Important | In-app + email | Immediate |
| Max revisions reached | Important | In-app + email | Immediate |
| Posted — confirm post live (to brand) | Important | In-app + email | Immediate; amber if no confirm in 48h |
| Post confirmed / issue raised (to creator) | Important | In-app | Immediate |
| Missing invoice/payment info | Important | In-app | On Payment-stage trigger |
| New chat message | Informational | In-app | Immediate (realtime) |
| Deal renamed | Informational | In-app | Immediate |
| Participant-add request / access granted | Important | In-app | Immediate |
| Shared post-deal comment added | Informational | In-app | Immediate |
| Stage advanced | Important | In-app | Immediate |
| Stage advance proposed, awaiting confirm | Important | In-app | Immediate; amber 48h |

### Payment (tracking)
| Event | Tier | Channels | Timing |
|---|---|---|---|
| Payment due reminder | Important | In-app + email | 3 days before due; on due date |
| Payment overdue | Critical | In-app + email | 3 days overdue; 7 days overdue |
| Bad-debt flag | Critical | In-app + email | 30 days overdue |
| Payment status updated / received confirmed | Informational | In-app | Immediate |
| Dispute raised | Critical | In-app + email (both parties + ops) | Immediate |
| Dispute resolved | Important | In-app + email | On resolution |

### Trackers, deadlines & expiries (scheduled)
| Event | Tier | Channels | Timing |
|---|---|---|---|
| Deliverable posting deadline approaching | Important | In-app + email | 48h and 2h before |
| Deliverable overdue | Critical | In-app + email | On overdue |
| Deal moved to Red RAG | Critical | In-app + email | On transition |
| Rights expiry (exclusivity / usage) | Important | In-app + email (both parties) | 14 days, 7 days, on expiry; none if perpetual |
| Whitelisting expiry | Important | In-app + email | 7 days before, on expiry |
| Blackout window starting | Important | In-app | 3 days before |
| Disclosure reminder | Important | In-app | Before each posting deadline |
| Compliance doc expiry | Important | In-app + email | 30 days, 7 days before |

### Digests (scheduled)
| Event | Tier | Channels | Timing |
|---|---|---|---|
| Daily digest — overdue + upcoming | Informational | Email | Daily |
| Weekly payment summary | Informational | Email | Weekly |
| Monthly deal summary | Informational | Email | 1st of following month |

---

## Batching & stacking

- **Informational** notifications never send individual emails — they roll into the daily/weekly
  digests. In-app, they appear immediately in the centre.
- If multiple alerts for the same user land in a short window, the engine **stacks them into one
  summary** notification rather than firing several.

---

## Edge cases

| Situation | Handling |
|---|---|
| User disables all notifications | One-time warning; critical deal alerts still delivered regardless. |
| Quiet hours active | Important/Informational email held until quiet hours end; in-app log still written; Critical ignores quiet hours. |
| More than 100 unread in centre | Paginated, oldest first. |
| Notification older than 90 days | Auto-cleared from the centre. |
| Email send fails (Resend) | Logged; in-app notification still stands as the record; retry on the next scheduled pass for time-driven ones. |

---

## Deferred (MVP-2)

Rich web / native push notifications · SMS notifications · AI nudge predictions (behaviour-aware
"you usually post on Fridays" type prompts) · per-deal notification mute beyond the global
category toggles.
