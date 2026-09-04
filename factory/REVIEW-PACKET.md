## Founder summary — plain language

### What was built

Explain the completed feature as if speaking to a non-technical founder. State what the user can now do, what the system now does automatically, and the main before/after difference. Be concrete and specific to this pull request; do not use generic wording such as “implemented the ticket” or lead with file names.

### What to look out for

State the two to five behaviours, screens, edge cases, or limitations the founder should pay attention to when reviewing or testing. Separate expected limitations from possible warning signs. If there is genuinely nothing unusual, say `No special concerns beyond the Owner review steps below.`

## Outcome

What user-visible or system-level behaviour changed?

## Workplan and RTM

- Workplan block:
- Included workplan IDs:
- Included RTM IDs:
- Issue:

## Issue closure

Closes #<issue-number>

Replace the placeholder with the selected ticket's number. Before moving the ticket to `factory:review`, verify that GitHub lists it in the pull request's `closingIssuesReferences`. Do not use a closing keyword for any adjacent ticket.

## Acceptance evidence

Map every acceptance criterion to observed evidence. Do not use a general statement such as “tests pass” in place of criterion-level evidence.

## Verification

- Focused pre-review tests:
- Targeted reviewer checks:
- Regression route (`affected` evidence reused or one `full` final pass) and source-state fingerprint:
- Frontend typecheck/lint/build:
- Independent review result (`QA`, `Combined Verifier`, or separate `QA`/`Security`):
- Manual or environment limitations:

## Migrations and data

List migrations, development-application status, fictional test-data cleanup, and destructive-data impact. Use `None` when absent.

## Decisions and risks

List material decisions with reasoning and reversibility, residual risks, deferred RTM gaps, or `None`.

## Owner review

Give the shortest reliable review path, including any phone, live-AI, Realtime, or external-service check the founder must perform.

## Safety

Confirm that no secret, real private data, production action, billing change, destructive operation, or unrelated file entered the branch.
