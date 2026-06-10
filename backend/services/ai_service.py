# All AI calls go through this module. Swap provider by changing only this file.

import google.generativeai as genai

from core.config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)


async def call_ai(prompt: str, context: dict) -> dict:
    """Stub — no real Gemini call yet (wired up in Phase 10, docs/ai-parser.md)."""
    return {
        "status": "not_implemented",
        "prompt": prompt,
        "context": context,
        "result": None,
    }
