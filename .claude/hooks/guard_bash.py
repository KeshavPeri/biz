#!/usr/bin/env python3
"""Bash gatekeeper for Claude Code.
 
Two jobs:
  1. BLOCK genuinely destructive / secret-exposing commands (exit 2 -> Claude sees why,
     command never runs; matches the STOP list in CLAUDE.md).
  2. AUTO-APPROVE everything else (permissionDecision "allow") so Claude Code stops
     prompting for routine dev commands. This is the "I trust it" switch — safety now
     comes from the DANGEROUS denylist below, not from clicking Allow every time.
 
To make something prompt again, add it to DANGEROUS (block) or remove the auto-approve
block at the bottom (back to normal prompting).
"""
import json, sys, re
 
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # can't parse -> stay out of the way
 
cmd = (data.get("tool_input") or {}).get("command", "")
 
# --- Hard denylist: these never run without a human doing it themselves ---
DANGEROUS = [
    r"\brm\s+-rf\b",                          # recursive force delete
    r"\bgit\s+push\b.*(--force|-f)\b",        # force push / history rewrite
    r"\bgit\s+reset\s+--hard\b",              # discard-all
    r"\bgit\s+clean\s+-[a-z]*f",              # nuke untracked files
    r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b",    # destructive SQL
    r"\bTRUNCATE\b",
    r"\bsupabase\s+db\s+reset\b",             # wipes the dev DB
    # secret exposure: reading a real .env (but .env.example / .env.sample are fine)
    r"\b(cat|bat|less|more|head|tail|nano|vim|vi|strings|xxd|od)\b[^\n]*\.env(\.local|\.production|\.development)?\b(?!\.example|\.sample)",
    r"\bprintenv\b",
]
 
for pat in DANGEROUS:
    if re.search(pat, cmd, re.IGNORECASE):
        print(f"BLOCKED by guard_bash: matches dangerous pattern '{pat}'. "
              f"Ask the human first — see the STOP list in CLAUDE.md.", file=sys.stderr)
        sys.exit(2)
 
# --- Everything else: auto-approve, no prompt ---
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": "guard_bash: no dangerous pattern — auto-approved"
    }
}))
sys.exit(0)