# Biz factory ticket contract

## Purpose

A factory ticket is the builder's approved product-and-engineering contract. It must be detailed enough that the implementation agent can choose ordinary implementation mechanics without having to invent product behaviour, data semantics, security boundaries, failure behaviour, or the definition of done.

Prescriptiveness should match risk. A small UI correction does not need a migration-level essay; a schema, AI, authorization, payment, signature, state-transition, or concurrency block does.

## Evidence required before drafting

The ticket author must inspect, not merely cite:

1. The included rows in `factory/WORKPLAN-MAP.md` and affected `docs/rtm.md` requirements.
2. The relevant locked specifications and domain documents.
3. Current `main`: existing services, schemas, migrations, UI paths, tests, and named seams the work will extend or replace.
4. `docs/progress.md`, recent commits, and dependency pull requests/issues.
5. Any active or planned block that may own the same files, migration sequence, or contracts.
6. Every open and closed `[Workplan ...]` issue and merged pull request needed to prove the proposed workplan/RTM IDs are not duplicated.

## Standing-orchestrator ticket state

Ticket authoring is a separate standing-orchestrator task, normally using Sol High. When explicitly asked and no open workplan issue remains, the standing orchestrator may draft and create exactly one next safe ticket. It creates the issue with `factory:planned`, never `factory:ready`, then stops without implementation. The founder alone releases it by replacing `factory:planned` with `factory:ready`.

Return BLOCKED and create no coding ticket when the next honest workplan step is Waiting, Manual, Gate, Deferred gap, owner-only, or unsupported by current repository evidence.

Immediately before creating or materially revising the GitHub issue, the standing orchestrator acquires the shared factory lock. It releases only its own lock after the saved issue and labels are verified.

Every ticket body begins with hidden execution metadata in this exact form, using the current 40-character `main` commit:

`<!-- biz-factory-ticket:v3 base=<commit> dependency=<none|issue-number> route=<builder|senior_builder> review=<qa|combined|qa-security> regression=<affected|full> -->`

The header exists only for cheap build routing. `dependency` names the one immediate prerequisite GitHub issue whose merged pull request must be on `main`, or `none` when all dependencies were already part of the authored base. `route`, `review`, and `regression` must match `factory/BUNDLING-RULES.md`:

- `review=qa regression=affected` for routine work;
- `review=combined regression=affected` for medium-risk work; and
- `review=qa-security regression=full` only for high-risk trust-boundary work.

When the founder releases the issue, the build factory compares this header to current repository and GitHub state. It does not re-read the broad product context, verify the ticket sections, or spawn a planning agent. Any base mismatch is blocked and returned to the standing orchestrator for revalidation or revision.

## Required ticket body

Use these sections. Combine sections only when the result remains equally clear.

### Context

- Where this block sits in the workplan and why it is next.
- What user or system problem exists today.
- Which later work depends on it.

### What this delivers, in plain terms

- Explain the outcome for a non-specialist.
- State why this is one coherent slice and why adjacent work is excluded.

### Workplan and RTM

- Exact workplan and RTM IDs.
- One-sentence outcome.
- Any permitted bundling exception and its evidence-based rationale.

### Decisions and rationale

- Record consequential choices already settled by the specifications or current architecture.
- Explain the important `why`, especially when an attractive alternative would create security, migration, data-quality, or rework risk.
- Do not invent a decision that belongs to the founder.

### Dependencies and evidence

- Name each prerequisite and prove it with exact files, symbols, tests, commits, issues, or merged pull requests.
- Distinguish verified facts from assumptions. An unresolved material assumption makes the ticket BLOCKED.

### In scope

- Required user and system behaviour.
- Data/API/state contracts, authorization, errors, idempotency, audit, and recovery behaviour where relevant.
- Exact fields, statuses, transitions, or invariants when locked sources define them.

### Out of scope

- Adjacent features and tempting extensions that must not be absorbed.
- Manual gates, later workplan rows, production actions, and owner-only actions.

### Definition of done

- Numbered, atomic, independently verifiable criteria.
- Cover the happy path, meaningful failure paths, authorization, boundaries, and regressions proportional to risk.
- Name the observable evidence for each criterion: a test assertion, API response, database state, UI state, audit record, or manual observation.
- Avoid vague criteria such as `works`, `is robust`, or `tests pass` without saying what must be proven.
- State which environmental checks may be `LIMITED`, why automation cannot prove them, and whether that blocks review.

### Notes for the builder

- Call out the most likely silent mistakes, relevant existing patterns, identifiers, normalization rules, trust boundaries, race conditions, and compatibility constraints.
- Separate mandatory requirements from useful implementation suggestions.

### Likely files and scope constraint

- Name verified existing files/symbols likely to change and expected new files.
- State protected or concurrently owned surfaces that must not change.
- Use an exact file whitelist only when repository evidence makes it safe; otherwise label the list `likely` and define the behavioural boundary. False precision is not quality.

### Verification plan

- Exact focused pre-review tests and the risk-proportional final verification mode from `factory/PROJECT-CONFIG.md`.
- Require the implementation agent to combine the conservative output of `scripts/factory-affected-tests.sh` with ticket-specific focused checks, de-duplicate them, and run each command once per candidate state before review. Ticket-specific checks may add to this floor but never replace or subtract from it.
- For `regression=affected`, retain the passing affected/focused evidence when the source fingerprint is unchanged; do not replay it after review. For `regression=full`, assign one complete final regression pass to the implementation agent after review. Reviewers and the orchestrator never duplicate an unchanged pass.
- Required fictional fixtures, arithmetic reconciliations, concurrency cases, security review, device/browser checks, or external-service smoke checks.
- The shortest founder review path and any check a substitute cannot perform.

### Risk, routing, and owner actions

- Routine/medium/high-risk classification with reasons.
- `builder` or `senior_builder`, the exact `qa`/`combined`/`qa-security` review route, `affected`/`full` regression route, and owner-only actions or `None`.
- Explicitly repeat any forbidden production, secret, billing, destructive-data, or real-private-data action relevant to the block.

### Completion and documentation contract

- Exact `docs/progress.md` and RTM reconciliation expected.
- Required branch, commit, draft-PR, evidence, and queue-state outcome.
- The draft PR must contain `Closes #<this-ticket-number>` and GitHub must expose that ticket in `closingIssuesReferences`, so the ticket closes only when the founder merges the PR.

## Quality gate

Return BLOCKED rather than READY unless all are true:

- A builder can identify exactly what changes for the user or system and what must remain unchanged.
- Every dependency is supported by current repository evidence.
- Locked data, state, authorization, AI, and failure semantics are explicit where relevant.
- The definition of done can be mapped one-to-one to evidence.
- Important negative and regression cases are named.
- Likely files and forbidden surfaces are grounded in the current codebase.
- Manual or unavailable evidence is explicit and cannot be mistaken for an automated pass.
- The route, review mode, and regression mode match `factory/BUNDLING-RULES.md`.
- No unresolved founder decision is hidden as an implementation detail.
- The ticket is specific because the evidence is specific, not because it guesses implementation details.
- The workplan/RTM IDs do not duplicate any open issue or already merged scope.
- A standing-orchestrator ticket is the single next safe block and is saved as `factory:planned`, never auto-released or built during ticket preparation.
- The ticket contains the exact v3 execution metadata needed for cheap build-start validation and routing.
