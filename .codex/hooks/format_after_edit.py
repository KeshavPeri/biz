#!/usr/bin/env python3
"""Best-effort formatting for files edited by Codex; unavailable formatters are a no-op."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


try:
    payload = json.load(sys.stdin)
except (json.JSONDecodeError, TypeError):
    raise SystemExit(0)

tool_input = payload.get("tool_input") or {}
paths: set[str] = set()

for key in ("file_path", "path"):
    value = tool_input.get(key)
    if isinstance(value, str) and value:
        paths.add(value)

patch = tool_input.get("command")
if isinstance(patch, str):
    paths.update(
        re.findall(r"^\*\*\* (?:Add|Update) File: (.+)$", patch, flags=re.MULTILINE)
    )

try:
    repo_root = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    ).resolve()
except (OSError, subprocess.CalledProcessError):
    raise SystemExit(0)


def within_repo(path: Path) -> bool:
    try:
        path.relative_to(repo_root)
        return True
    except ValueError:
        return False


def run(command: list[str], cwd: Path) -> None:
    try:
        subprocess.run(command, cwd=cwd, check=False, capture_output=True, timeout=25)
    except (OSError, subprocess.TimeoutExpired):
        pass


for raw_path in paths:
    candidate = Path(os.path.expanduser(raw_path))
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    candidate = candidate.resolve()
    if not candidate.is_file() or not within_repo(candidate):
        continue

    extension = candidate.suffix.lower()
    relative = candidate.relative_to(repo_root)

    if extension in {".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".md"}:
        frontend_root = repo_root / "frontend"
        if shutil.which("npx") and (frontend_root / "node_modules" / ".bin" / "prettier").exists():
            run(["npx", "--no-install", "prettier", "--write", str(candidate)], frontend_root)
    elif extension == ".py":
        ruff = repo_root / "backend" / ".venv" / "bin" / "ruff"
        black = repo_root / "backend" / ".venv" / "bin" / "black"
        if ruff.exists():
            run([str(ruff), "format", str(relative)], repo_root)
        elif black.exists():
            run([str(black), "-q", str(relative)], repo_root)

raise SystemExit(0)
