---
name: biz-wrap
description: Reconcile Biz project documentation at the end of a build or session. Use when the user asks to wrap up, update progress, update the RTM, record what was built, or prepare a clean handoff for the next Codex task.
---

# Wrap a Biz Build Session

1. Inspect the final diff, recent commits, test results, `docs/progress.md`, and affected `docs/rtm.md` rows. Treat Git and verified test output as evidence; do not invent progress.
2. Update `docs/progress.md`:
   - refresh CURRENT STATE, including phase/task, what works, known gaps, and how to verify it;
   - set NEXT UP to the next one to three workplan tasks;
   - record new assumptions or decisions, newest first;
   - add a concise SESSION HISTORY entry, newest first;
   - put unresolved founder decisions in NEEDS MY INPUT.
3. Update only the affected RTM rows with exact code files, build status, build notes, test IDs, and test status. Keep deferred pieces explicit.
4. Reconcile stale statements against the workplan and Git state. Do not mark a feature Built or a test Passing without supporting evidence.
5. Do not commit or push unless the user separately asks to ship.
6. Return a three-to-five-line plain-language summary of what changed, what was verified, and what is next.
