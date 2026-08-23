# AGENTS.md — Codex project guide for Biz

Biz (working product name: Inflo) is a B2B deal operating system for India's creator economy. It manages creator–brand work from discovery and negotiation through contracts, delivery, posting, payment tracking, and close.

## Working with the founder

- The founder understands product and technical concepts but is not a professional coder.
- Explain decisions and risks in plain language. Give the outcome first and avoid long code walkthroughs unless asked.
- For small ambiguity, make a reasonable reversible assumption, continue, and record it in `docs/progress.md`.

## Start every task

1. Read this file and inspect `git status`; preserve all existing work and never stage unrelated files blindly.
2. Read `docs/progress.md`, the relevant part of `docs/technical-spec.md`, and the matching rows in `docs/rtm.md`.
3. Read the detailed domain document and relevant mockup before changing that area.
4. For non-trivial work, state a short plan, then implement without waiting for approval unless a stop condition below applies.

## Sources of truth

Use this precedence when sources disagree:

1. The user's current request.
2. `docs/technical-spec.md`.
3. The relevant detailed spec in `docs/` (`data-model`, `deal-engine`, `api-architecture`, `ai-parser`, `rbac`, `security`, etc.).
4. For UI: `docs/design-direction.md` → `docs/design-tokens.md` → the relevant file in `docs/mockups/`.
5. Current code and `docs/progress.md`.
6. `docs/rtm.md` for traceability/status.

If code contradicts a locked spec, follow the spec and call out the mismatch. Keep work inside Tier 1 MVP scope from `docs/scope.md`.

## Locked architecture

- Frontend: Expo SDK 54, React Native/Web, strict TypeScript, Expo Router, gluestack-ui v3 + NativeWind, Zustand, Supabase JS with the anon key only.
- Backend: FastAPI/Python, Supabase service-role key only on the backend, WeasyPrint, Resend, and Gemini only through `backend/services/ai_service.py`.
- Frontend talks directly to Supabase for auth, simple RLS-protected CRUD, Realtime, and storage. It uses FastAPI for AI, documents, email, audited rules, sensitive operations, and deal-stage transitions.
- The server is the source of truth. Never enforce security, RBAC, or stage rules only in the client.
- `deal_participants` is the RLS anchor. Deal stages are forward-only and every transition is logged. `Disputed` is a Payment overlay, not a stage.
- Use the existing icon library in `frontend/assets/icons/`; do not add an icon library without flagging it.
- Free tiers only. Never introduce a paid service silently.

## How to build

- Keep functions and components small, typed, and single-purpose. Comment why, not the obvious what.
- Show friendly user-facing errors; never leak raw exceptions or secrets.
- Prefer existing patterns and dependencies. Do not invent schema fields casually; if a specified feature exposes a genuine schema gap, use the smallest migration that preserves the locked model and document the decision.
- Run checks proportional to the change. Common frontend checks are `npx tsc --noEmit` and `npx expo export --platform web` from `frontend/`.
- Backend tests under `backend/tests/` use the live development Supabase project and may create temporary fictional data. Run only relevant tests, never against production, and use realistic fictional—not real private—data.
- Review the final diff, update `docs/progress.md`, and update the affected `docs/rtm.md` rows with files/tests/status.
- Do not commit or push unless the user's task explicitly asks, or the `biz-ship` skill is invoked.

## Autonomy and stop conditions

Proceed with routine repository edits, local checks, installs, dev servers, and non-destructive dev-database work that is part of the requested task.

Stop and explain the blocker before doing any of these:

- destructive data operations or destructive migrations;
- force-push, history rewrite, branch deletion, or discarding existing work;
- production deployment, live user/payment data, or a paid service;
- a large architecture change that contradicts the locked specs;
- handling real secrets outside ignored environment files;
- an irreversible action when confidence is low.

## Session finish

Use the repo-local `biz-wrap` skill to reconcile progress and RTM status. Use `biz-ship` only when the user asks to commit/push. Keep the existing `.claude/` setup intact so Claude can still be used on the same repository.
