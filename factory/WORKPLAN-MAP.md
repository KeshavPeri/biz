# Biz executable workplan map

**Snapshot date:** 2026-08-31
**Workbook reviewed:** `/Users/keshav/Downloads/App MVP - Build Workplan.xlsx`
**Repository baseline:** `4561a93 Merge pull request #19 from KeshavPeri/codex/workplan-14-creator-private-deliverable-labels`
**Purpose:** give future Codex factory runs a versioned dependency and evidence map. This file is a planning index, not a replacement for the locked specifications, RTM, tests, or Git history.

Block formation is controlled by `factory/BUNDLING-RULES.md`. The workplan map determines what is ready; the bundling rules determine how much of that ready work may enter one build ticket.

## Source and status rules

Use this order when sources disagree:

1. The founder's current request.
2. `docs/technical-spec.md` and the relevant detailed specification.
3. Verified code, tests, migrations, and Git history.
4. `docs/progress.md`.
5. `docs/rtm.md`.
6. The external workbook's status and notes.

The workbook is the roadmap, but its status cells are not automatically synchronized with the repository. A task is **Complete** here only when repository or manual evidence supports it.

| Executable status | Meaning |
|---|---|
| Complete | Required work is supported by repository or manual evidence. |
| Ready | Dependencies are satisfied and the task can be converted into a build ticket. |
| Waiting | At least one effective dependency is incomplete. |
| Manual | Founder/device/browser action; never dispatch to a code-writing agent. |
| Gate | Review, RTM, commit, or phase gate rather than a feature implementation. |
| Deferred gap | RTM work not fully represented by the workbook task that originally carried it. |

Only rows marked **Ready** may enter the `factory:ready` GitHub queue. GitHub issues and pull requests are the execution state; this map remains the workplan-to-RTM index. When explicitly asked and no open workplan issue remains, the standing orchestrator may use current verified evidence to author exactly one successor as `factory:planned`; the scheduled build factory never authors tickets, and the founder still controls release to `factory:ready`.

## Reconciliation decisions

- Workbook rows **9.9–9.12 still say Not Started**, but Git, tests, progress, and RTM prove they are complete. This map uses the verified state.
- Workbook row **10.1 originally depends on 9.19**. That dependency is now technically invalid: 9.9/9.10 intentionally left an honest parser-pending seam, so the real Phase 10 parser, Gate B approvals, and contract alignment must land before the remaining Phase 9 lifecycle can be exercised end to end.
- Effective order from the current baseline is therefore: **9.12 → 10.1–10.9 → 9.13–9.19 → Phase 11**.
- Phase 7 workplan rows are complete, but Bucket 1 is only **12/18 RTM features built**. The unrepresented or partial gaps are recorded separately below; completing a broad workplan row does not silently mark those RTM features complete.
- The protected untracked file `Checklist_new_rows.xlsx` is unrelated user material and must never be staged by factory runs.

## Current verified position

| Area | Verified position | Evidence |
|---|---|---|
| Phases 0–6 | Workplan complete | Repository scaffold, locked specifications, `docs/rtm.md`, migrations, FastAPI and Expo foundation. |
| Phase 7 | Workplan 7.1–7.14 complete; Bucket 1 is 12/18 | `docs/progress.md`; RTM Bucket 1. |
| Phase 8 | Workplan 8.1–8.6 complete; Bucket 2 is 13/13 | `docs/progress.md`; RTM Bucket 2. |
| Phase 9 | 9.1–9.16 complete in candidates; 9.17 implementation candidate; 9.18–9.19 pending | Merged PRs #5–#8 satisfy the Phase 10 dependency; PR #10 builds B3-029, PR #16 builds B3-032, PR #17 builds submission/revision, PR #18 completes B3-028/B3-030 approval, PR #19 builds B3-031, PR #20 builds backend-only B3-033, PRs #23/#24 complete B3-034, issue #25 builds the B3-035 backend and issue #27 adds the strict participant payment-tracking Expo journey. Issues #29/#31/#33 build B3-039 participant raise/read/freeze, UI, and platform-ops resolution. Issue #35 builds B3-040's atomic mutual-close and terminal-thread slice; issue #37 adds ratings/trust, separate shared/private outcomes and the private chat PDF candidate. Critical email remains CC-N003 / Phase 12. |
| Phase 10 | 10.1–10.9 complete; Bucket 4 is 5/5 | Merged PRs #5–#8; `docs/progress.md`; B4-001–B4-005 are Built in RTM. Founder accepted the manual test as non-blocking and can run `docs/LOCAL-APP-TESTING.md` later. |
| Phases 11–14 | Not started | Workbook, progress, and RTM. |

## Phases 0–6 — completed foundation

| Workplan IDs | Original dependency | Executable status | RTM / evidence |
|---|---|---|---|
| 0.1–0.9 | As listed in workbook | Complete | Founder orientation and required accounts recorded complete in workbook; live Supabase, GitHub, Gemini and Resend configuration seams exist. |
| 1.1–1.13 | 0.x chain | Complete | `/Users/keshav/Projects/biz` is a connected Git repository with ignored secrets and pushed history. |
| 2.1–2.8 | 1.13 and internal 2.x chain | Complete | Claude operating system remains; Codex equivalents are in `AGENTS.md`, `.codex/`, and `.agents/skills/` from `b026f01`. |
| 3.0–3.14 | 2.x and internal 3.x chain | Complete | Locked documents include technical spec, scope, data model, deal engine, RBAC, API, AI parser, notifications, and security. |
| 4.1–4.3 | 3.13 | Complete | `docs/rtm.md` exists and is maintained through `biz-wrap`. |
| 5.1–5.13 | 3.13, 5.1 and internal 5.x chain | Complete | Supabase development project, migrations 001–024, RLS tests, FastAPI, health route, and Supabase service connection. Foundation work; no direct RTM feature row. |
| 6.0–6.8 | 5.x, 6.0 and internal 6.x chain | Complete | Expo SDK 54, Expo Router, NativeWind, gluestack, design tokens, five-tab shell, and anon Supabase client. RTM explicitly records Phase 6 as built infrastructure. |

## Phase 7 — Identity & Trust

| ID | Task | Effective dependency | Status | RTM feature(s) / evidence |
|---|---|---|---|---|
| 7.1 | Sign-up screen | 6.7 | Complete | B1-001. |
| 7.2 | Wire sign-up to Supabase Auth | 7.1, 6.6 | Complete | B1-001; `test_auth_session.py`. |
| 7.3 | Email OTP verification | 7.2 | Complete | B1-001; Supabase OTP with development SMTP. |
| 7.4 | Login and session handling | 7.3 | Complete | B1-003; `test_auth_session.py`. |
| 7.5 | Creator/Brand role selection | 7.4 | Complete | B1-004; `test_onboarding.py`. |
| 7.6 | Creator onboarding | 7.5 | Complete | B1-006; `test_onboarding.py`. |
| 7.7 | Brand onboarding | 7.5 | Complete | B1-002 and B1-014; domain verification remains an RTM limitation. |
| 7.8 | Mock social-platform link | 7.6 | Complete | B1-007 and B1-010. |
| 7.9 | Draw/type stored signature | 7.6, 7.7 | Complete | B1-018; contract-use evidence completed again in 9.12. B1-019/B1-020 gaps remain below. |
| 7.10 | Basic maker-checker configuration | 7.7 | Complete | B1-017; `test_maker_checker.py`. Contract action wired in 9.12. |
| 7.11 | Profile completeness logic | 7.6, 7.7 | Complete | B1-027 core calculation built; scheduled reminders remain deferred. |
| 7.12 | Phone-test both onboarding journeys | 7.11 | Manual complete | Recorded as device-tested in `docs/progress.md`. |
| 7.13 | Update Bucket 1 RTM | 7.12 | Gate complete | RTM reconciled; Bucket 1 currently 12/18. |
| 7.14 | Commit and Phase 7 gate | 7.13 | Gate complete | Relevant Phase 7 commits are in Git history. |

### Phase 7 RTM gaps not safely represented by the completed rows

These require future factory tickets rather than reopening the historical workplan status:

| RTM ID | Gap | Earliest sensible dependency | Status |
|---|---|---|---|
| B1-015 | Invite brand employees and assign roles | Notification/email foundation or a deliberately scoped earlier block | Deferred gap |
| B1-019 | Dedicated brand stored-signature setup path | Existing 9.12 signing flow | Deferred gap |
| B1-020 | Stored-signature management with OTP re-verification | Auth hardening block | Deferred gap |
| B1-021 | Account details/settings | Phase 12 reliability/security preparation | Deferred gap |
| B1-023 | Notification preferences and quiet hours | 12.1 | Deferred gap |
| B1-027 | Scheduled 24h/72h completeness nudges | 12.1–12.2 plus deployment scheduler | Deferred gap |

## Phase 8 — Discovery

| ID | Task | Effective dependency | Status | RTM feature(s) / evidence |
|---|---|---|---|---|
| 8.1 | Seed fictional creator and brand data | 7.7 | Complete | Discovery seed plus media-kit fixtures. |
| 8.2 | Discover screen and cards | 8.1, 6.5 | Complete | B2-001 and B2-005. |
| 8.3 | Profile detail and media-kit view | 8.2 | Complete | B2-002, B2-006 and reusable B2-030–B2-038 slices. |
| 8.4 | Basic connection request | 8.3, 3.5 | Complete | B2-004; `TEST-CONNECT`. |
| 8.5 | Phone-test discovery flow | 8.4 | Manual complete | Recorded in Phase 8 close-out evidence. |
| 8.6 | Update RTM and commit Bucket 2 | 8.5 | Gate complete | Bucket 2 is 13/13; commits `7bc522d` through `52333c8`. |

## Phase 9 — Deal Engine

| ID | Task | Original dependency | Effective dependency | Status | RTM feature(s) / evidence |
|---|---|---|---|---|---|
| 9.1 | Verify chat/deal data model | 5.6, 3.5 | Same | Complete | Data-model/RLS verification supporting B3-001–B3-003. |
| 9.2 | Chat list preview cards | 9.1 | Same | Complete | B3-001. |
| 9.3 | Chat thread and messaging | 9.2 | Same | Complete | B3-002. |
| 9.4 | Supabase Realtime delivery | 9.3 | Same | Complete | B3-003; migration 017. Two-device recheck remains part of lifecycle QA. |
| 9.5 | Pending accept/decline | 9.4, 8.4 | Same | Complete | B3-016 plus the current warn-only exclusivity slice. |
| 9.6 | Deal-stage progress bar | 9.5, 3.5 | Same | Complete | B3-013. |
| 9.7 | Stage/role-aware sticky action bar | 9.6 | Same | Complete | B3-014. |
| 9.8 | Server stage-transition engine | 9.7, 3.5, 3.7 | Same | Complete | B3-015; `TEST-STAGE-ENGINE` 23/23. |
| 9.9 | Minimum deal-fields checklist | 9.8, 3.8 | Same | Complete | B3-018; workbook is stale; summary-gate tests pass. |
| 9.10 | Two-side summary request | 9.9 | Same | Complete | B3-019 Gate A only; real AI output/Gate B deliberately deferred to Phase 10. |
| 9.11 | WeasyPrint contract generation | 9.10, 5.11 | Same | Complete | B3-023; `7257508`; `TEST-CONTRACT-FLOW` and template test. |
| 9.12 | Three-mode contract signing | 9.11, 7.9 | Same | Complete | B3-025 plus contract slice of B3-028; exactly-once execution and Approval → Creating. |
| 9.13 | Creating: brief, content and revisions | 9.12 | **10.9** | **Complete** | 9.13-A built B3-029 in PR #10; 9.13-B built B3-032 in PR #16; 9.13-C built secure submission/revision in PR #17; 9.13-D built exact direct/checker-gated approval through migrations 032–033 in PR #18; 9.13-E built creator-private deliverable labels through migrations 034–035 in PR #19, completing B3-028–B3-032. B3-021 is already Built. |
| 9.14 | Posted: live URL hard gate | 9.13 | Same | **Complete** | B3-033; merged PR #20 provides the pinned public-HTTPS verifier and exact backend gate. Issue #22 adds the server-action-driven Expo submit/correction, bounded proof/history, flag and exact confirmation journey. External provider/device evidence remains `LIMITED`. |
| 9.15 | Payment tracking and states | 9.14 | Same | **Complete** | PRs #23/#24 complete B3-034 capture. Issue #25 / 9.15-C adds B3-035's canonical payment/milestone schema, atomic Payment-entry materialization, exact-version reports, creator receipt evidence and participant-safe API. Issue #27 / 9.15-D adds the strict FastAPI-only single/milestone/combination Expo ledger and exact-version server-authorized controls. Interactive walkthrough is `LIMITED`; automated reminders B3-037 still depend on Phase 12/deployment scheduling. |
| 9.16 | Payment dispute overlay | 9.15 | Same | **Complete in candidate** | Issue #29 / 9.16-A adds one race-safe Payment dispute, atomic aggregate freeze, safe participant history and Critical in-app participant notices. Issue #31 / 9.16-B adds strict participant raise/view UI with bounded existing evidence and authoritative refetches. Issue #33 / 9.16-C adds explicit active platform-ops authority, bounded sanitized queue/detail, generic Critical in-app ops notices and atomic resume-only resolution with Important participant notices. Critical email remains CC-N003 / Phase 12. |
| 9.17 | Close and ratings | 9.16 | Same | **Complete in candidate** | Issue #35 supplies the exact-payment mutual close gate and terminal chat boundary. Issue #37 adds one backend-derived immutable rating per side with proven trust aggregation, separate idempotent shared comments/author-private notes, and one retryable private source-bound chat PDF with five-minute participant download. QA/security re-review and final regression passed; the 9.18 manual lifecycle gate remains. |
| 9.18 | Full deal-lifecycle test | 9.17 | Same | Manual | Phase 9 acceptance gate covering every B3 path. |
| 9.19 | RTM, commit and Phase 9 gate | 9.18 | Same | Gate waiting | Reconcile all 32 B3 rows only after lifecycle evidence. |

### Outstanding manual check from 9.11/9.12

The normal G4 device check remains for the Approval contract card, drawn-signature gesture, native PDF picker/private upload, signed-link opening, and maker/checker two-device refresh. It is an explicit manual QA item, not evidence that the shipped automated tests failed.

## Phase 10 — AI Contract Parser

| ID | Task | Original dependency | Effective dependency | Status | RTM feature(s) / evidence |
|---|---|---|---|---|---|
| 10.1 | AI service abstraction | 9.19, 3.8 | **9.12, 3.8** | Complete | B4-001; merged PR #5 provides the typed provider-neutral boundary. |
| 10.2 | Connect Gemini | 10.1, 0.7 | Same | Complete | B4-001; merged PR #5 provides the backend-only maintained Google Gen AI adapter. |
| 10.3 | Build the fixed 22-field prompt/schema | 10.2, 3.8 | Same | Complete | B4-002; strict `chat-terms-22.v1` schema and prompt shipped in PR #6. |
| 10.4 | Parse source text into validated JSON | 10.3, 9.10 | Same | Complete | B4-002 chat extraction shipped in PR #6; B4-003 generated-contract extraction shipped in PR #8. |
| 10.5 | Persist extracted fields | 10.4, 5.6 | Same | Complete | Atomic `ai_summaries` persistence shipped in PR #6; immutable `extracted_terms` provenance shipped in PR #8. |
| 10.6 | Confirmation UI and Gate B | 10.5 | Same | Complete | B4-004 plus B3-020/B3-021 shipped in PR #7 with 32/32 Gate-B checks. |
| 10.7 | Contract-vs-chat alignment | 10.6 | Same | Complete | B4-003/B4-005 plus B3-026 shipped in PR #8; deterministic comparison and hard signing gates pass. |
| 10.8 | Test varied fictional contracts | 10.7 | Same | Complete | Founder explicitly accepted this manual gate as non-blocking on 2026-08-29. No live-Gemini/device pass is claimed; follow `docs/LOCAL-APP-TESTING.md` when convenient. |
| 10.9 | RTM and commit Phase 10 | 10.8 | Same | Gate complete | B4-001–B4-005 and B3-020/B3-021/B3-026 reconciled; Phase 10 close-out committed after merged PRs #5–#8. |

## Phase 11 — Tracking

| ID | Task | Effective dependency | Status | RTM feature(s) |
|---|---|---|---|---|
| 11.1 | Deal tracker and RAG dashboard | 10.9, 9.19 | Waiting | B5-001, B5-002 and B5-005. |
| 11.2 | Payment tracker | 11.1, 9.15 | Waiting | B5-006 and B5-008. |
| 11.3 | Calendar | 11.1 | Waiting | B5-010, B5-011 and B5-012. |
| 11.4 | Rights and exclusivity trackers | 11.1, 10.5 | Waiting | B5-003, B5-004 and B5-013–B5-017. |
| 11.5 | Exclusivity conflict warning | 11.4 | Waiting | B3-041/B5 tracker integration; warn, never block. |
| 11.6 | Test parser-to-tracker population | 11.5 | Manual | Phase 11 acceptance gate. |
| 11.7 | RTM and commit Bucket 5 | 11.6 | Gate waiting | Reconcile all 15 B5 rows. |

## Phase 12 — Security and Notifications

| ID | Task | Effective dependency | Status | RTM feature(s) |
|---|---|---|---|---|
| 12.1 | In-app notification engine | 11.7, 3.9 | Waiting | CC-N001 and CC-N002. |
| 12.2 | Resend email notifications | 12.1, 0.8 | Waiting | CC-N003. |
| 12.3 | Stage-gate blocked alerts | 12.1, 9.8 | Waiting | CC-N004. |
| 12.4 | Consolidate immutable audit logging | 11.7, 3.10 | Waiting | CC-S003; partial audit writes already exist and require a full coverage review. |
| 12.5 | Endpoint-wide RBAC review | 12.4, 3.6 | Waiting | CC-S001 and CC-S002; partial RLS/RBAC exists and must be audited, not assumed complete. |
| 12.6 | Encryption review | 12.5 | Waiting | CC-S004. |
| 12.7 | Secrets audit | 12.6 | Waiting | CC-S005. |
| 12.8 | Error handling and degradation | 12.5 | Waiting | CC-S006. |
| 12.9 | RTM and cross-cutting gate | 12.8 | Gate waiting | Reconcile all CC-S and CC-N rows. |

## Phase 13 — Integration testing

| ID | Task | Effective dependency | Status | Evidence target |
|---|---|---|---|---|
| 13.1 | Full regression, both roles | 12.9 | Manual | All Tier 1 journeys on realistic fictional data. |
| 13.2 | Fix discovered bugs | 13.1 | Waiting | Separate bounded tickets created from concrete failures. |
| 13.3 | Re-test on both phones | 13.2 | Manual | Expo Go device evidence for both roles. |
| 13.4 | Performance sanity check | 13.3 | Manual | Startup, navigation, large lists, uploads, Realtime, and slow/failure states. |

## Phase 14 — Deployment for market research

| ID | Task | Effective dependency | Status | Evidence target |
|---|---|---|---|---|
| 14.1 | Deploy FastAPI to Railway | 13.4 | Waiting | Owner-reviewed free-tier production setup. |
| 14.2 | Configure Railway environment variables | 14.1 | Manual | Owner-controlled secrets; never committed. |
| 14.3 | Deploy Expo web to Vercel | 14.1 | Waiting | Deterministic frontend deployment. |
| 14.4 | Point frontend at live backend | 14.2, 14.3 | Waiting | Production-safe public backend URL. |
| 14.5 | Test live app on both phones | 14.4 | Manual | Real deployed end-to-end evidence. |
| 14.6 | Add basic error monitoring | 14.5 | Waiting | Free-tier monitoring selected with owner approval if an external account is needed. |
| 14.7 | Final RTM update | 14.6 | Gate waiting | Every MVP feature reconciled with code and test evidence. |
| 14.8 | Tag `v0.1` | 14.7 | Gate waiting | Owner-approved release tag. |
| 14.9 | MVP market-research gate | 14.8 | Manual | Founder accepts the deployed research build. |

## Completed Phase 10 queue

| Issue | Workplan block | Queue state | Dependency |
|---|---|---|---|
| [#1](https://github.com/KeshavPeri/biz/issues/1) | 10-A · 10.1–10.2 | Closed / merged | PR #5 merged and B4-001 reconciled |
| [#2](https://github.com/KeshavPeri/biz/issues/2) | 10-B · 10.3–10.5 | Closed / merged | PR #6 merged and B4-002 reconciled |
| [#3](https://github.com/KeshavPeri/biz/issues/3) | 10-C · 10.6 | Closed / merged | PR #7 merged and B4-004 reconciled |
| [#4](https://github.com/KeshavPeri/biz/issues/4) | 10-D · 10.7 | Closed / merged | PR #8 merged and B4-003/B4-005 reconciled |

No Phase 10 queue item remains open.

## Current Phase 9 queue

| Issue | Workplan block | RTM scope | Queue state | Dependency |
|---|---|---|---|---|
| [#9](https://github.com/KeshavPeri/biz/issues/9) | 9.13-A · versioned creative brief | B3-029 only | Closed / merged | PR #10 merged |
| [#11](https://github.com/KeshavPeri/biz/issues/11) | 9.13-B · canonical deliverable foundation | B3-032 | Closed / merged | PR #16 merged |
| [#12](https://github.com/KeshavPeri/biz/issues/12) | 9.13-C · submissions and revision requests | B3-030 slice | Closed / merged | PR #17 merged |
| [#13](https://github.com/KeshavPeri/biz/issues/13) | 9.13-D · checker-gated content approval | B3-030 + B3-028 content slice | Closed / merged | PR #18 merged |
| [#14](https://github.com/KeshavPeri/biz/issues/14) | 9.13-E · creator-private deliverable labels | B3-031 | Closed / merged | PR #19 merged |
| [#15](https://github.com/KeshavPeri/biz/issues/15) | 9.14-A · verified live-post backend gate | B3-033 backend slice | `factory:building` | Pinned to `7d40b57`; Expo successor remains deferred |

The queue is partitioned for approximately 80% session allowances. Issue #15 is the sole planned successor and waits for founder release. The scheduled factory does nothing until the founder marks exactly one ticket `factory:ready`.
