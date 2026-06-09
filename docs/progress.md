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

- **Current phase:** Phase 4 complete — RTM built. Ready to start Phase 5 (Backend & Database Foundation).
- **Current task:** Phase 4 done (4.1 + 4.2 + 4.3 complete). Next: Phase 5.
- **Built so far:** Local environment + monorepo scaffolded. Private GitHub repo connected.
  `CLAUDE.md` written. All Phase 3 design docs locked (`technical-spec.md` v1.0 + 9 source docs).
  `docs/rtm.md` built — 93 features, 13 columns, pre-populated Explore + Design sections.
- **Not working / known issues:** None — no app code exists yet. Phase 5 starts the backend.
- **How to run the project:** N/A yet. Backend (FastAPI) stands up in Phase 5;
  frontend (Expo) in Phase 6. Update this line with exact run commands once they exist.

## NEXT UP  *(ordered)*

1. **Phase 5 — Backend & Database Foundation:** FastAPI project setup, Supabase project init,
   schema migrations for all 42 tables, RLS policies, `.env` wiring.
2. **Phase 6 — Frontend Foundation:** Expo project setup, Expo Router, NativeBase (re-evaluate
   at task 6.4 per open decision #6), Zustand store, Supabase JS client wiring.
3. After 5 + 6: Phase 7 (Identity & Trust — first real features, Bucket 1).

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

### 2026-06-09 — Phase 4: RTM built (Cowork session)
- **Did:** Tasks 4.1 + 4.2 + 4.3 complete. Built `docs/rtm.md` — 93 features, 7 per-bucket
  sub-tables, 13 columns (Explore / Design / Build / Test). Pre-populated Feature ID, Feature,
  Bucket, Phase, Priority, Scope, Design Summary, Build Elements for all 93 rows.
  Cross-checked vs `technical-spec.md` Appendix A — exact match, nothing missing, no
  out-of-scope rows. Updated `CLAUDE.md` RTM line to name all 13 columns + the fill-in ritual
  for build and test phases. Note: v5 Excel file not independently available; cross-check done
  against Appendix A (which already reconciles to v5).
- **Next:** Phase 5 — Backend & Database Foundation.

### 2026-06-03 — Project setup + CLAUDE.md
- **Did:** Completed Phase 0–1 setup. Scaffolded the monorepo, connected the private
  GitHub repo, first commit pushed. Drafted `CLAUDE.md` (locked stack, architecture,
  autonomy contract, scope, golden rules). Decided the RTM format (markdown). Created
  this `progress.md`.
- **Next:** Task 2.8 (hooks + auto-run permissions), then Phase 3 technical design.
