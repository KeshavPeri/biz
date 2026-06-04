#!/usr/bin/env python3
"""Block obviously destructive bash commands. Exit 2 = block (Claude sees the reason)."""
import json, sys, re

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # can't parse -> don't block

cmd = (data.get("tool_input") or {}).get("command", "")

DANGEROUS = [
    r"\brm\s+-rf\b",
    r"\bgit\s+push\b.*(--force|-f)\b",
    r"\bgit\s+reset\s+--hard\b",
    r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b",
    r"\bTRUNCATE\b",
    r"\bsupabase\s+db\s+reset\b",
]

for pat in DANGEROUS:
    if re.search(pat, cmd, re.IGNORECASE):
        print(f"BLOCKED by guard_bash: matches dangerous pattern '{pat}'. "
              f"Ask the human first — see the STOP list in CLAUDE.md.", file=sys.stderr)
        sys.exit(2)

sys.exit(0)