# Biz build-block bundling rules

## Purpose

Turn ready workplan rows into the largest **safe, coherent, reviewable** build block. A block is one GitHub issue, one feature branch or worktree, one code-writing agent at a time, one independent QA pass, and one draft pull request.

Larger is not automatically more autonomous. A block is autonomous only when one agent can understand, implement, verify, and explain the whole outcome without losing completion discipline.

## Required inputs

Before proposing a block, read:

1. `AGENTS.md`.
2. `factory/WORKPLAN-MAP.md`.
3. `docs/progress.md`.
4. The affected `docs/rtm.md` rows.
5. The relevant locked specification and detailed domain documents.
6. Current Git status and recent history.
7. `factory/TICKET-CONTRACT.md` and the actual code, migrations, tests, and symbols the block will extend.

Do not bundle a row marked Waiting, Manual, Gate, or Deferred gap unless the founder explicitly approves a separate remediation block.

When the open workplan issue queue is empty, author exactly one next safe block rather than a speculative batch. Save it as `factory:planned` and stop; ticket creation and implementation must occur in different runs. If the next honest step is Manual, Gate, Waiting, Deferred, owner-only, or unproven, report that blocker instead of skipping ahead.

## Bundle rows only when all conditions hold

- Every row is Ready, or becomes ready strictly because the previous row in the same block is completed.
- The rows produce one user-visible or system-level outcome that can be described in one sentence.
- They operate primarily in one subsystem or one continuous vertical path.
- Their database, API, UI, and test changes share the same contract rather than merely being nearby in the workbook.
- One acceptance-test set can prove the entire block.
- No manual, account, secret, production, billing, destructive-data, or owner-decision gate sits between the rows.
- Failure of the later row would not leave the earlier row dangerously active or misleading.
- The complete diff can be independently reviewed as one pull request.

The normal ceiling is **two workplan rows**. Three rows are allowed only when they are small parts of one indivisible backend or frontend contract and the task packet explains why splitting would create throwaway seams.

## Mandatory split conditions

Split the work when any condition below applies:

- The rows deliver separate user outcomes or can be tested and shipped independently.
- A manual test or founder decision is required before the next row can safely begin.
- The proposed block combines a database migration, broad cross-stack UI, and an external service integration.
- It crosses more than two major surfaces among database, backend, frontend, external service, deployment, and device-only behaviour.
- It combines unrelated security-sensitive areas such as authentication, RLS/RBAC, signatures, payments, secrets, or destructive data handling.
- It would require multiple code-writing agents or concurrent edits to shared files.
- It includes both a new shared architecture and multiple product features consuming that architecture.
- Acceptance criteria cannot be stated precisely before implementation.
- A temporary failure in one part would make the agent likely to report partial progress as completion.

Never bundle a phase gate, manual device test, production deployment, account creation, secret entry, or destructive migration into an autonomous coding block.

## Risk and model routing

### Routine block — Builder, Terra High

Use `builder` when the block is tightly specified and avoids high-risk boundaries. Typical examples:

- a bounded screen or component using existing APIs and patterns;
- focused client-side state, formatting, filtering, or validation;
- ordinary CRUD under already-proven RLS and schema;
- focused tests or a small regression fix;
- documentation directly required by a completed implementation.

### High-risk block — Senior Builder, Sol High

Use `senior_builder` when any of these apply:

- schema migration, RLS, grants, RBAC, authentication, audit or secrets;
- AI output schemas, provider integration, prompt validation, Gate A/Gate B, or automated decisions;
- stage transitions, signatures, contracts, payments, concurrency, idempotency or atomicity;
- a new shared architectural abstraction;
- cross-stack work spanning database, backend and frontend;
- recovery of incomplete or conflicting work;
- a bug whose cause is ambiguous across several subsystems.

If uncertain between the two, route to `senior_builder`; do not enlarge the block to justify a stronger model.

## Parallelism rules

- Only one code-writing agent may work in a worktree.
- `builder` and `senior_builder` must never run against the same block.
- Read-only exploration, QA, or security review may be delegated separately when bounded.
- Database migrations and development-Supabase integration tests are serialized across active Biz blocks.
- Two feature blocks may run concurrently only after the future orchestrator proves they use separate worktrees, do not share an unapplied migration, do not edit the same core contracts, and do not depend on each other. The default is one active build block.

## Required task-packet fields

The Workplan Manager must return a complete GitHub ticket that passes `factory/TICKET-CONTRACT.md` before a coding agent is dispatched. At minimum it includes:

- block title and one-sentence outcome;
- included workplan IDs and RTM IDs;
- satisfied dependencies and evidence;
- explicit in-scope and out-of-scope lists;
- observable acceptance checks;
- likely systems/files affected;
- required migrations and whether they are additive;
- focused tests, regressions, and manual checks;
- risk classification with reasons;
- selected implementation agent: `builder` or `senior_builder`;
- security-review requirement;
- owner-only actions or `None`;
- completion contract, including documentation expectations.

The definition of done must be numbered, atomic, and mapped to observable evidence. The ticket must also explain consequential decisions, likely silent-failure traps, current-code touchpoints, protected surfaces, exact verification commands, and evidence a substitute cannot produce. If any material field cannot be made concrete, return BLOCKED rather than sending an ambiguous block to a builder.

## Current Phase 10 partition

This is the recommended initial partition, subject to the same readiness and issue-review checks:

| Candidate block | Workplan rows | Primary outcome | Route |
|---|---|---|---|
| 10-A | 10.1–10.2 | Establish the swap-ready AI service and real Gemini provider boundary. | `senior_builder`, Sol High |
| 10-B | 10.3–10.5 | Define, validate, run and persist the 22-field extraction contract. | `senior_builder`, Sol High |
| 10-C | 10.6 | Complete all-party term confirmation, approver status, and Gate B advancement. | `senior_builder`, Sol High |
| 10-D | 10.7 | Extract generated-contract terms and enforce deterministic chat/contract alignment. | `senior_builder`, Sol High |
| Manual gate | 10.8 | Evaluate varied fictional deals with real AI output. | Founder/manual with Codex assistance |
| Phase gate | 10.9 | Reconcile RTM, evidence, commits, and the Phase 10 gate. | Orchestrator |

10-B is the permitted three-row exception: prompt/schema, validated extraction, and persistence form one backend output contract. It must still be split if the 10-A implementation reveals a schema, provider, cost, or reliability decision that requires founder input.
