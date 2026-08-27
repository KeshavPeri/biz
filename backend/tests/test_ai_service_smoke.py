"""Opt-in real Gemini smoke path using fictional content only.

Run only when an existing local Gemini key is available:
RUN_GEMINI_SMOKE=1 backend/.venv/bin/python backend/tests/test_ai_service_smoke.py
"""

import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# The opt-in smoke path can report LIMITED without unrelated development config.
os.environ.setdefault('SUPABASE_URL', 'https://example.invalid')
os.environ.setdefault('SUPABASE_ANON_KEY', 'test-anon-key')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')

from services.ai_service import AIError, AIRequest, AIResult, generate_ai  # noqa: E402


def main() -> None:
    if os.getenv('RUN_GEMINI_SMOKE') != '1':
        print('LIMITED: real Gemini smoke is opt-in; deterministic boundary tests cover this run.')
        return

    response = asyncio.run(
        generate_ai(
            AIRequest(
                operation='fictional_smoke',
                prompt='Reply with exactly: fictional provider boundary verified',
                context={'data_classification': 'fictional test content only'},
            )
        )
    )
    if isinstance(response, AIError):
        raise AssertionError(f'Gemini smoke returned {response.code}')
    assert isinstance(response, AIResult)
    assert response.text
    print(f'PASS: real Gemini smoke through {response.provider}/{response.model}')


if __name__ == '__main__':
    main()
