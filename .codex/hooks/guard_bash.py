#!/usr/bin/env python3
"""Block destructive or secret-exposing shell commands before Codex runs them."""

import json
import re
import sys


def deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    raise SystemExit(0)


try:
    payload = json.load(sys.stdin)
except (json.JSONDecodeError, TypeError):
    raise SystemExit(0)

command = str((payload.get("tool_input") or {}).get("command", ""))

dangerous_patterns = (
    (r"\brm\s+-[^\n]*r[^\n]*f\b|\brm\s+-[^\n]*f[^\n]*r\b", "recursive forced deletion"),
    (r"\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f)\b", "force-pushing Git history"),
    (r"\bgit\s+reset\s+--hard\b", "discarding repository changes"),
    (r"\bgit\s+clean\s+-[a-z]*f", "deleting untracked files"),
    (r"\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b", "dropping database objects"),
    (r"\bTRUNCATE\b", "truncating database data"),
    (r"\bsupabase\s+db\s+reset\b", "resetting the Supabase database"),
    (
        r"\b(?:cat|bat|less|more|head|tail|strings|xxd|od)\b[^\n]*"
        r"(?:^|[\s/])\.env(?:\.(?:local|production|development))?\b"
        r"(?!\.(?:example|sample))",
        "reading a real environment-secret file",
    ),
    (r"\bprintenv\b", "printing environment secrets"),
)

for pattern, label in dangerous_patterns:
    if re.search(pattern, command, flags=re.IGNORECASE):
        deny(f"Blocked: {label}. Ask the user before taking this high-risk action.")

raise SystemExit(0)
