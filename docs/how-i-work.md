# How I Work — Claude Tool Framework

## The one-liner
**Chat = decide. Code = build. Cowork = document.**

---

## The three tools

**Claude Chat** (this browser window)
For thinking, learning, and making decisions. Use it when you need to understand something before building it, or when you're stuck and need to talk it through.

**Claude Code** (inside VS Code)
For everything that produces a file, runs a command, or changes the repo. This is where ~80% of build tasks happen. When in doubt between Chat and Code, ask: *does this need to create or run something?* If yes → Code.

**Claude Cowork** (desktop app)
Only for compiling multiple inputs into one long document. Comes up exactly three times in this project: the Technical Spec (3.11), the RTM (4.1), and the design brief (6.0). Don't open it for anything else.

---

## Quick decision rule

| Situation | Tool |
|---|---|
| Making a design decision or locking architecture | Chat |
| Learning a concept before implementing it | Chat |
| Stuck and need to talk something through | Chat |
| Writing, running, or debugging code | Code |
| Git commits, migrations, env setup | Code |
| Compiling multiple docs into one deliverable | Cowork |
| Testing on phone, clicking in a browser, manual review | Neither (Manual/Browser task) |

---

## Rules for my level (beginner–intermediate)

1. **Start each new phase in Chat.** Before opening VS Code for a phase I haven't done before, ask Chat to explain what I'm about to build in plain English. Then switch to Code.

2. **Plan Mode before every non-trivial Code task.** Ask Claude Code to plan first, read the plan, approve it, then build. Never skip this for anything bigger than a minor edit.

3. **When Code's output confuses me, go to Chat.** Paste the code or error into Chat and ask it to explain line by line. Chat is better for learning; Code is better for doing.

4. **Cowork is rare.** If I feel tempted to open it outside of tasks 3.11, 4.1, or 6.0, it probably belongs in Chat or Code instead.

5. **Save context at end of each Code session.** Ask Claude Code to update `docs/progress.md` with what was done and what's next. Start the next session by reading it before anything else.
