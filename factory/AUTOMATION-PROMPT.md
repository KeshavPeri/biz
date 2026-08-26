Use $biz-workplan-factory to process at most one ready Biz workplan block in this repository.

Follow AGENTS.md and the skill exactly. Start with the cheap GitHub recovery/queue check before broad repository exploration. If no issue is recoverably building and no open issue has `factory:ready`, report `Nothing ready` and stop. Use one code-writing agent, wait for all required reviews, and do not return completion before the draft pull request and queue-state update are finished. Never merge, deploy production, handle owner-only secrets, or perform a destructive action.
