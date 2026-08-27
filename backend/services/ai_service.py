"""Backend-only, provider-neutral boundary for every Biz AI request.

Gemini is the MVP provider, but callers only depend on the typed request/result/error
contract below. Parsing, prompts, persistence, and approval gates intentionally remain
outside this initial provider-boundary block.
"""

import asyncio
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, Mapping, Protocol, TypeAlias

from google import genai
from google.genai import types

from core.config import settings


class AIErrorCode(StrEnum):
    """Stable, caller-safe failure categories for AI operations."""

    MISSING_CONFIGURATION = 'missing_configuration'
    TIMEOUT = 'timeout'
    RATE_LIMITED = 'rate_limited'
    MALFORMED_RESPONSE = 'malformed_response'
    PROVIDER_FAILURE = 'provider_failure'


@dataclass(frozen=True)
class AIRequest:
    """Provider-neutral input for one server-side AI operation."""

    operation: str
    prompt: str
    context: Mapping[str, Any] = field(default_factory=dict)
    timeout_seconds: float = 20.0


@dataclass(frozen=True)
class AIResult:
    """Successful text response with non-secret provenance for callers."""

    text: str
    provider: str
    model: str


@dataclass(frozen=True)
class AIError:
    """A typed, friendly failure that never includes provider internals or secrets."""

    code: AIErrorCode
    message: str
    retryable: bool


AIResponse: TypeAlias = AIResult | AIError


class AIProvider(Protocol):
    """A provider implementation hidden behind the stable service contract."""

    name: str
    model: str

    async def generate(self, request: AIRequest) -> AIResult:
        """Return a provider response or raise a provider exception for mapping."""


_ERROR_MESSAGES = {
    AIErrorCode.MISSING_CONFIGURATION: 'AI service is not configured. Please try again later.',
    AIErrorCode.TIMEOUT: 'The AI service took too long. Please try again.',
    AIErrorCode.RATE_LIMITED: 'The AI service is busy. Please try again shortly.',
    AIErrorCode.MALFORMED_RESPONSE: 'The AI service returned an unreadable response. Please try again.',
    AIErrorCode.PROVIDER_FAILURE: 'The AI service is temporarily unavailable. Please try again later.',
}


def _error(code: AIErrorCode, *, retryable: bool) -> AIError:
    return AIError(code=code, message=_ERROR_MESSAGES[code], retryable=retryable)


@dataclass
class GeminiProvider:
    """The MVP Gemini implementation; the SDK is deliberately contained here."""

    api_key: str = field(repr=False)
    model: str
    name: str = 'gemini'

    async def generate(self, request: AIRequest) -> AIResult:
        if not self.api_key or not self.model:
            raise MissingAIConfigurationError()

        response = await asyncio.to_thread(self._call_sdk, request)
        text = getattr(response, 'text', None)
        if not isinstance(text, str) or not text.strip():
            raise MalformedAIResponseError()
        return AIResult(text=text.strip(), provider=self.name, model=self.model)

    def _call_sdk(self, request: AIRequest) -> Any:
        """Make the one synchronous SDK call without exposing configuration elsewhere."""
        client = genai.Client(api_key=self.api_key)
        try:
            return client.models.generate_content(
                model=self.model,
                contents=request.prompt,
                config=types.GenerateContentConfig(
                    # The maintained Gemini SDK expects this transport timeout in milliseconds.
                    http_options=types.HttpOptions(timeout=int(request.timeout_seconds * 1000)),
                ),
            )
        finally:
            client.close()


class MissingAIConfigurationError(Exception):
    """Internal sentinel so callers never receive configuration details."""


class MalformedAIResponseError(Exception):
    """Internal sentinel for a response that cannot satisfy the service contract."""


def configured_provider() -> AIProvider | AIError:
    """Select the configured provider without making a network call."""
    if settings.AI_PROVIDER != 'gemini':
        return _error(AIErrorCode.MISSING_CONFIGURATION, retryable=False)
    return GeminiProvider(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)


async def generate_ai(request: AIRequest, *, provider: AIProvider | None = None) -> AIResponse:
    """Run an AI request and map all provider failures to stable safe errors."""
    selected = provider or configured_provider()
    if isinstance(selected, AIError):
        return selected

    try:
        return await selected.generate(request)
    except MissingAIConfigurationError:
        return _error(AIErrorCode.MISSING_CONFIGURATION, retryable=False)
    except MalformedAIResponseError:
        return _error(AIErrorCode.MALFORMED_RESPONSE, retryable=True)
    except Exception as exc:  # Provider SDK exception classes vary by library version.
        return _map_provider_exception(exc)


def _map_provider_exception(exc: Exception) -> AIError:
    """Classify common provider failures without returning raw exception text."""
    status_code = getattr(exc, 'status_code', getattr(exc, 'code', None))
    exception_name = type(exc).__name__.lower()
    if status_code == 429 or 'rate' in exception_name or 'resourceexhausted' in exception_name:
        return _error(AIErrorCode.RATE_LIMITED, retryable=True)
    if isinstance(exc, TimeoutError) or 'timeout' in exception_name or 'deadline' in exception_name:
        return _error(AIErrorCode.TIMEOUT, retryable=True)
    return _error(AIErrorCode.PROVIDER_FAILURE, retryable=True)


async def call_ai(prompt: str, context: Mapping[str, Any] | None = None) -> AIResponse:
    """Compatibility helper for future callers of the original service seam."""
    return await generate_ai(AIRequest(operation='generic', prompt=prompt, context=context or {}))


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
