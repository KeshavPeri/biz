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

- **Current phase:** Phase 2 — Claude Code Operating System
- **Current task:** 2.7 (set up this progress.md). Next task: 2.8 (hooks).
- **Built so far:** Local environment ready (VS Code, Git, Node, Python). Monorepo
  scaffolded (`/frontend`, `/backend`, `/docs`, `.claude/`). Private GitHub repo connected,
  first commit pushed. `.env` / `.env.example` in place and `.env` is gitignored.
  `CLAUDE.md` written with locked stack + autonomy contract + golden rules.
- **Not working / known issues:** None yet — no app code exists yet.
- **How to run the project:** N/A so far. Backend (FastAPI) stands up in Phase 5;
  frontend (Expo) in Phase 6. Update this line with the exact run commands once they exist.

## NEXT UP  *(ordered)*

1. Task 2.8 — set up deterministic hooks in `.claude/settings.json` (block committing
   secrets; run linter/formatter after edits) and the auto-run permission mode.
2. Phase 3 — Technical Design. Start with task 3.0 (lock remaining decisions +
   `docs/stack-decisions.md`), then the data model and deal-engine design.

## NEEDS MY INPUT  *(blockers + anything Claude flagged per the CLAUDE.md STOP list)*

*Claude: when you hit a STOP-and-flag situation (destructive ops, anything paid, live/prod,
real secrets, big architectural change, irreversible + low confidence), describe it here and
do not proceed. I'll resolve these at the start of my next session.*

- *(nothing flagged yet)*

## ASSUMPTIONS & DECISIONS LOG  *(append-only — newest at top)*

*Claude: when a detail is ambiguous and you make a reasonable call to keep moving, log it
here in one line so I can review or reverse it later.*

- 2026-06-03 — RTM will live as `docs/rtm.md` (markdown table, not xlsx) so it's
  Git-diffable and editable without scripts. Workplan stays as the separate Google Sheet.
- 2026-06-03 — App name "Biz" is a placeholder pending final naming.

---

## SESSION HISTORY  *(append-only — newest at top, keep each entry brief)*

### 2026-06-03 — Project setup + CLAUDE.md
- **Did:** Completed Phase 0–1 setup. Scaffolded the monorepo, connected the private
  GitHub repo, first commit pushed. Drafted `CLAUDE.md` (locked stack, architecture,
  autonomy contract, scope, golden rules). Decided the RTM format (markdown). Created
  this `progress.md`.
- **Next:** Task 2.8 (hooks + auto-run permissions), then Phase 3 technical design.
