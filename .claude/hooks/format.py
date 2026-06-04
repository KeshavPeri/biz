#!/usr/bin/env python3
"""After Claude edits a file, auto-format it if a formatter is installed. No-op otherwise."""
import json, sys, subprocess, shutil, os

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

path = (data.get("tool_input") or {}).get("file_path", "")
if not path or not os.path.isfile(path):
    sys.exit(0)

ext = os.path.splitext(path)[1].lower()

def run(cmd):
    try:
        subprocess.run(cmd, check=False, capture_output=True)
    except Exception:
        pass

if ext in {".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".md"}:
    if shutil.which("npx"):
        run(["npx", "--no-install", "prettier", "--write", path])
elif ext == ".py":
    if shutil.which("ruff"):
        run(["ruff", "format", path])
    elif shutil.which("black"):
        run(["black", "-q", path])

sys.exit(0)