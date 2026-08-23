# All AI calls go through this module. Swap provider by changing only this file.

from dataclasses import dataclass, field
from typing import Any, Literal

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


# Phase 9 owns the checklist workflow, while Phase 10 owns actual chat parsing.
# Keeping this seam here means the workflow never needs to know whether Gemini,
# another provider, or a validated persisted parser result produced the statuses.
FieldStatus = Literal['found', 'not_discussed', 'ambiguous']


@dataclass(frozen=True)
class ChecklistAnalysis:
    status: FieldStatus
    # Conditional children live under their parent checklist item. For example,
    # an explicit "yes" to exclusivity also requires duration + category.
    children: dict[str, FieldStatus] = field(default_factory=dict)
    value: Any = None


async def get_minimum_field_statuses(deal_id: str) -> dict[str, ChecklistAnalysis]:
    """Return parser-owned statuses for the 12 Gate-A checklist items.

    There is deliberately no chat scan or invented success here: Phase 10 will
    replace this stub with the validated 22-field parser output. Until then each
    item honestly remains not discussed unless both parties complete an override.
    """
    del deal_id
    return {key: ChecklistAnalysis(status='not_discussed') for key in MINIMUM_FIELD_KEYS}


async def request_terms_summary_generation(deal_id: str) -> dict[str, str]:
    """The single Gate-A invocation seam. Phase 10 will call the real parser here.

    It does not create ai_summaries or pretend a summary exists while the parser
    is intentionally pending.
    """
    del deal_id
    return {'status': 'parser_pending'}


MINIMUM_FIELD_KEYS = (
    'payment_amount',
    'payment_terms',
    'exclusivity',
    'usage_rights',
    'whitelisting',
    'blackout_window',
    'revision_rounds',
    'creative_guidance',
    'content_format',
    'platform',
    'posting_window',
    'sponsored_disclosure',
)
