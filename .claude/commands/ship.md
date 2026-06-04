---
description: Safely commit and push the current work to GitHub
---

Commit and push my current work:

1. Run `git status` and show me what's staged. Confirm `.env` and any
   secrets are NOT in the list. If a secret is staged, STOP and tell me.
2. Stage all changes except secrets.
3. Commit with a clear, concise message describing what actually changed
   this session (use conventional-commit style, e.g. "feat:", "chore:", "fix:").
4. Push to the current branch on GitHub.
5. If the pre-commit hook blocks anything, show me exactly what it flagged —
   do NOT bypass it.
6. Confirm in one line what landed on GitHub.