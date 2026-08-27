"""Deterministic checks for the provider-neutral AI boundary (no network access)."""

import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# The boundary tests use fakes only; no development-Supabase configuration is needed.
os.environ.setdefault('SUPABASE_URL', 'https://example.invalid')
os.environ.setdefault('SUPABASE_ANON_KEY', 'test-anon-key')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')

from services import ai_service  # noqa: E402


def check(name: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(name)
    print(f'PASS: {name}')


class FakeProvider:
    name = 'fake'
    model = 'fake-model'

    def __init__(self, response=None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.request = None

    async def generate(self, request):
        self.request = request
        if self.error:
            raise self.error
        return self.response


class RateLimitError(Exception):
    code = 429


class Response:
    def __init__(self, text):
        self.text = text


class FakeGeminiClient:
    captured = {}

    def __init__(self, *, api_key):
        self.captured['api_key'] = api_key
        self.models = self

    def generate_content(self, **kwargs):
        self.captured['request'] = kwargs
        return Response('  fictional Gemini response  ')

    def close(self):
        self.captured['closed'] = True


def run(coro):
    return asyncio.run(coro)


def main() -> None:
    request = ai_service.AIRequest(
        operation='fictional_smoke',
        prompt='Reply with exactly: fictional provider boundary verified',
        context={'deal_name': 'Fictional Monsoon Skincare campaign'},
        timeout_seconds=7.0,
    )

    original_provider = ai_service.settings.AI_PROVIDER
    original_key = ai_service.settings.GEMINI_API_KEY
    original_model = ai_service.settings.GEMINI_MODEL
    try:
        ai_service.settings.AI_PROVIDER = 'gemini'
        ai_service.settings.GEMINI_API_KEY = ''
        ai_service.settings.GEMINI_MODEL = 'test-gemini-model'
        selected = ai_service.configured_provider()
        check(
            'configured provider selects Gemini without network access',
            isinstance(selected, ai_service.GeminiProvider) and selected.model == 'test-gemini-model',
        )

        fake = FakeProvider(ai_service.AIResult('accepted fictional response', 'fake', 'fake-model'))
        forwarded = run(ai_service.generate_ai(request, provider=fake))
        check('provider receives the complete typed request', fake.request is request)
        check(
            'provider-neutral result reaches the caller unchanged',
            isinstance(forwarded, ai_service.AIResult) and forwarded.text == 'accepted fictional response',
        )

        missing = run(ai_service.generate_ai(request, provider=ai_service.GeminiProvider('', 'fake-model')))
        check(
            'missing configuration is a safe typed failure',
            isinstance(missing, ai_service.AIError)
            and missing.code == ai_service.AIErrorCode.MISSING_CONFIGURATION
            and not missing.retryable,
        )

        missing_model = run(ai_service.generate_ai(request, provider=ai_service.GeminiProvider('test-key-not-used', '')))
        check(
            'missing model is a safe typed failure',
            isinstance(missing_model, ai_service.AIError)
            and missing_model.code == ai_service.AIErrorCode.MISSING_CONFIGURATION
            and 'test-key-not-used' not in repr(ai_service.GeminiProvider('test-key-not-used', 'fake-model')),
        )

        timeout = run(ai_service.generate_ai(request, provider=FakeProvider(error=TimeoutError())))
        check('timeout maps to a retryable typed failure', isinstance(timeout, ai_service.AIError) and timeout.code == ai_service.AIErrorCode.TIMEOUT and timeout.retryable)

        rate_limited = run(ai_service.generate_ai(request, provider=FakeProvider(error=RateLimitError())))
        check('rate limit maps to a retryable typed failure', isinstance(rate_limited, ai_service.AIError) and rate_limited.code == ai_service.AIErrorCode.RATE_LIMITED and rate_limited.retryable)

        original_client = ai_service.genai.Client
        FakeGeminiClient.captured = {}
        ai_service.genai.Client = FakeGeminiClient
        try:
            handled = run(ai_service.generate_ai(request, provider=ai_service.GeminiProvider('test-key-not-used', 'fake-model')))
        finally:
            ai_service.genai.Client = original_client
        check(
            'maintained Gemini SDK response is normalised into the provider-neutral result',
            isinstance(handled, ai_service.AIResult)
            and handled.text == 'fictional Gemini response'
            and handled.provider == 'gemini',
        )
        sdk_request = FakeGeminiClient.captured.get('request', {})
        check(
            'Gemini SDK receives model, prompt, timeout, and closes its client',
            sdk_request.get('model') == 'fake-model'
            and sdk_request.get('contents') == request.prompt
            and sdk_request.get('config').http_options.timeout == request.timeout_seconds
            and FakeGeminiClient.captured.get('closed') is True,
        )

        malformed_gemini = ai_service.GeminiProvider('test-key-not-used', 'fake-model')
        malformed_gemini._call_sdk = lambda _: Response(None)
        malformed = run(ai_service.generate_ai(request, provider=malformed_gemini))
        check(
            'malformed provider response is a safe typed failure',
            isinstance(malformed, ai_service.AIError) and malformed.code == ai_service.AIErrorCode.MALFORMED_RESPONSE,
        )

        provider_failure = run(ai_service.generate_ai(request, provider=FakeProvider(error=RuntimeError('private provider detail'))))
        check(
            'provider failure does not expose raw provider details',
            isinstance(provider_failure, ai_service.AIError)
            and provider_failure.code == ai_service.AIErrorCode.PROVIDER_FAILURE
            and 'private provider detail' not in provider_failure.message,
        )
    finally:
        ai_service.settings.AI_PROVIDER = original_provider
        ai_service.settings.GEMINI_API_KEY = original_key
        ai_service.settings.GEMINI_MODEL = original_model


if __name__ == '__main__':
    main()
