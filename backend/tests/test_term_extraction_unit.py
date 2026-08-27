"""Deterministic B4-002 schema, prompt, evidence, retry, and input tests."""

import asyncio
import copy
import json
import os
import sys
from pathlib import Path

from pydantic import ValidationError

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault('SUPABASE_URL', 'https://example.invalid')
os.environ.setdefault('SUPABASE_ANON_KEY', 'test-anon-key')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')

from services import ai_service  # noqa: E402
from services import term_extraction  # noqa: E402
from services.term_extraction import (  # noqa: E402
    MAX_CHAT_MESSAGES,
    MAX_MESSAGE_BODY_CHARS,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    ChatMessage,
    SummaryGenerationError,
    TermsExtraction,
    _ordered_chat_messages,
    build_extraction_prompt,
    extract_terms,
    parse_terms,
)


EXPECTED_FIELDS = {
    'payment_amount', 'payment_terms_type', 'payment_terms_from_date', 'exclusivity',
    'exclusivity_duration_days', 'exclusivity_category', 'usage_rights',
    'usage_rights_duration', 'usage_rights_channels', 'whitelisting', 'blackout_window',
    'blackout_duration_timing', 'revision_rounds_max', 'creative_guidance',
    'content_format_per_deliverable', 'platform_per_deliverable',
    'posting_window_per_deliverable', 'sponsored_content_disclosure', 'content_ownership',
    'deliverable_count', 'location_per_deliverable', 'milestone_schedule',
}
MESSAGES = [
    ChatMessage('m1', '2026-08-25T10:00:00+00:00', 'brand', 'brand_admin', 'One Reel on Instagram for INR 50000.'),
    ChatMessage('m2', '2026-08-25T10:05:00+00:00', 'creator', 'creator', 'No exclusivity and no usage rights.'),
]


def check(label: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(label)
    print(f'PASS: {label}')


def nd() -> dict:
    return {'status': 'not_discussed', 'value': None, 'evidence': []}


def found(value, message_id='m1', quote='One Reel') -> dict:
    return {'status': 'found', 'value': value, 'evidence': [{'message_id': message_id, 'quote': quote}]}


def ambiguous(message_id='m1', quote='One Reel') -> dict:
    return {'status': 'ambiguous', 'value': None, 'evidence': [{'message_id': message_id, 'quote': quote}]}


def payload() -> dict:
    return {key: nd() for key in EXPECTED_FIELDS}


def rejected(value: dict, messages=MESSAGES) -> bool:
    try:
        TermsExtraction.model_validate(value)
        # Evidence validation is a separate, source-aware boundary.
        parse_terms(json.dumps(value), messages)
    except (ValidationError, ValueError):
        return True
    return False


class SequencedProvider:
    name = 'fake'
    model = 'fake-model'

    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return ai_service.AIResult(self.responses.pop(0), self.name, self.model)


class RateLimitError(Exception):
    status_code = 429


class FakeQuery:
    def __init__(self, rows, log):
        self.rows = rows
        self.log = log

    def select(self, columns):
        self.log.append(('select', columns))
        return self

    def eq(self, column, value):
        self.log.append(('eq', column, value))
        return self

    def is_(self, column, value):
        self.log.append(('is', column, value))
        return self

    @property
    def not_(self):
        self.log.append(('not',))
        return self

    def order(self, column):
        self.log.append(('order', column))
        return self

    def limit(self, value):
        self.log.append(('limit', value))
        return self

    def execute(self):
        return type('Response', (), {'data': self.rows})()


class FakeClient:
    def __init__(self):
        self.log = []
        self.tables = {
            'deal_participants': [
                {'profile_id': 'creator-id', 'participant_role': 'creator'},
                {'profile_id': 'brand-id', 'participant_role': 'brand_checker'},
            ],
            'messages': [
                {'id': 'm1', 'sender_id': 'creator-id', 'body': 'Safe creator text', 'created_at': '2026-08-25T10:00:00Z'},
                {'id': 'm2', 'sender_id': 'brand-id', 'body': 'Safe brand text', 'created_at': '2026-08-25T10:00:00Z'},
            ],
        }

    def table(self, name):
        self.log.append(('table', name))
        return FakeQuery(self.tables[name], self.log)


def main() -> None:
    base = payload()
    validated = TermsExtraction.model_validate(base)
    check('schema has exactly the locked 22 top-level fields', set(TermsExtraction.model_fields) == EXPECTED_FIELDS and len(EXPECTED_FIELDS) == 22)

    missing = copy.deepcopy(base)
    missing.pop('payment_amount')
    extra = copy.deepcopy(base)
    extra['invented'] = nd()
    check('missing and unknown top-level fields are rejected', rejected(missing) and rejected(extra))

    invalid_status = copy.deepcopy(base)
    invalid_status['payment_amount']['status'] = 'missing'
    mistyped_bool = copy.deepcopy(base)
    mistyped_bool['exclusivity'] = found('false', 'm2', 'No exclusivity')
    mistyped_number = copy.deepcopy(base)
    mistyped_number['revision_rounds_max'] = found('0')
    check('status vocabulary and scalar types are strict', rejected(invalid_status) and rejected(mistyped_bool) and rejected(mistyped_number))

    explicit_false = copy.deepcopy(base)
    explicit_false['exclusivity'] = found(False, 'm2', 'No exclusivity')
    check('explicit false is a valid found value', not rejected(explicit_false))

    invalid_envelopes = copy.deepcopy(base)
    invalid_envelopes['payment_amount'] = {'status': 'found', 'value': None, 'evidence': []}
    invalid_ambiguous = copy.deepcopy(base)
    invalid_ambiguous['payment_amount'] = {'status': 'ambiguous', 'value': None, 'evidence': []}
    invalid_not_discussed = copy.deepcopy(base)
    invalid_not_discussed['payment_amount'] = {'status': 'not_discussed', 'value': None, 'evidence': [{'message_id': 'm1', 'quote': 'One Reel'}]}
    check('status/value/evidence invariants reject invented or unsupported values', rejected(invalid_envelopes) and rejected(invalid_ambiguous) and rejected(invalid_not_discussed))

    wrong_id = copy.deepcopy(base)
    wrong_id['payment_amount'] = found({'amount': 50000, 'currency': 'INR'}, 'other-deal-message', 'One Reel')
    wrong_quote = copy.deepcopy(base)
    wrong_quote['payment_amount'] = found({'amount': 50000, 'currency': 'INR'}, 'm1', 'not in source')
    check('evidence must belong to and quote the supplied chat', rejected(wrong_id) and rejected(wrong_quote))

    exclusive = copy.deepcopy(base)
    exclusive['exclusivity'] = found(True, 'm2', 'exclusivity')
    check('enabled exclusivity requires duration and category', rejected(exclusive))
    exclusive['exclusivity_duration_days'] = found(30, 'm2', 'exclusivity')
    exclusive['exclusivity_category'] = found('skincare', 'm2', 'exclusivity')
    check('complete exclusivity condition is accepted', not rejected(exclusive))
    false_with_child = copy.deepcopy(explicit_false)
    false_with_child['exclusivity_duration_days'] = found(30, 'm2', 'exclusivity')
    check('disabled condition cannot carry invented child values', rejected(false_with_child))

    usage = copy.deepcopy(base)
    usage['usage_rights'] = found(True, 'm2', 'usage rights')
    blackout = copy.deepcopy(base)
    blackout['blackout_window'] = found(True, 'm2', 'No exclusivity')
    check('usage-rights and blackout children are mandatory when enabled', rejected(usage) and rejected(blackout))
    usage['usage_rights_duration'] = found({'duration_days': 30, 'is_perpetual': False}, 'm2', 'usage rights')
    usage['usage_rights_channels'] = found([], 'm2', 'usage rights')
    check('found usage-rights channels must be non-empty', rejected(usage))

    net = copy.deepcopy(base)
    net['payment_terms_type'] = found('net_x_days')
    check('net_x_days requires explicit basis and positive day count', rejected(net))
    net['payment_terms_from_date'] = found({'basis': 'invoice_date', 'net_days': 30})
    check('complete net terms are accepted', not rejected(net))

    deliverables = copy.deepcopy(base)
    deliverables['deliverable_count'] = found(2)
    deliverables['content_format_per_deliverable'] = found([
        {'deliverable_index': 1, 'content_format': 'Reel'},
        {'deliverable_index': 2, 'content_format': 'Story'},
    ])
    deliverables['platform_per_deliverable'] = found([
        {'deliverable_index': 1, 'platform': 'Instagram'},
        {'deliverable_index': 3, 'platform': 'Instagram'},
    ])
    check('per-deliverable indices must be contiguous, shared, and count-aligned', rejected(deliverables))
    deliverables['platform_per_deliverable']['value'][1]['deliverable_index'] = 2
    deliverables['posting_window_per_deliverable'] = found([
        {'deliverable_index': 1, 'posting_date': '2026-09-05', 'window_start': None, 'window_end': None},
        {'deliverable_index': 2, 'posting_date': None, 'window_start': '2026-09-06', 'window_end': '2026-09-08'},
    ])
    check('valid locked enums and ISO date/window shapes are accepted', not rejected(deliverables))
    bad_date = copy.deepcopy(deliverables)
    bad_date['posting_window_per_deliverable']['value'][0]['posting_date'] = '2026-02-30'
    check('invalid calendar dates are rejected', rejected(bad_date))

    milestone = copy.deepcopy(base)
    milestone['payment_amount'] = found({'amount': 50000, 'currency': 'INR'})
    milestone['payment_terms_type'] = found('milestone')
    milestone['milestone_schedule'] = found([
        {'trigger': 'Draft approved', 'amount': {'amount': 20000, 'currency': 'INR'}, 'due_date': '2026-09-01'},
        {'trigger': 'Post live', 'amount': {'amount': 30000, 'currency': 'INR'}, 'due_date': '2026-09-10'},
    ])
    check('complete milestone schedule reconciles exactly with total', not rejected(milestone))
    milestone['milestone_schedule']['value'][1]['amount']['amount'] = 29999
    check('milestone mismatch is rejected', rejected(milestone))

    prompt = build_extraction_prompt(MESSAGES)
    check('prompt versions the contract and includes every field', SCHEMA_VERSION in prompt and PROMPT_VERSION in prompt and all(field in prompt for field in EXPECTED_FIELDS))
    prompt_lower = prompt.lower()
    check('prompt locks never-guess, evidence, normalisation, JSON-only, and untrusted delimiters', all(term in prompt_lower for term in ('never guess', 'verbatim substring', 'relative dates', 'strict json only', 'begin_untrusted_deal_chat_json', 'end_untrusted_deal_chat_json')))

    valid_json = json.dumps(base)
    first_pass = SequencedProvider([valid_json])
    first = asyncio.run(extract_terms(MESSAGES, provider=first_pass))
    check('valid first pass performs one provider call', len(first_pass.requests) == 1 and first.provider == 'fake')
    repaired = SequencedProvider(['not json', valid_json])
    asyncio.run(extract_terms(MESSAGES, provider=repaired))
    check('invalid first pass receives exactly one complete corrective re-prompt', len(repaired.requests) == 2 and repaired.requests[1].prompt.startswith('CORRECTION:'))
    exhausted = SequencedProvider(['not json', '{}'])
    try:
        asyncio.run(extract_terms(MESSAGES, provider=exhausted))
        exhausted_ok = False
    except SummaryGenerationError as exc:
        exhausted_ok = exc.status_code == 502 and len(exhausted.requests) == 2 and 'not json' not in exc.detail
    check('two invalid responses produce one safe exhausted failure', exhausted_ok)
    outage = SequencedProvider(error=RateLimitError('private provider detail'))
    try:
        asyncio.run(extract_terms(MESSAGES, provider=outage))
        outage_ok = False
    except SummaryGenerationError as exc:
        outage_ok = exc.status_code == 429 and len(outage.requests) == 1 and 'private' not in exc.detail
    check('operational failures are returned immediately and safely', outage_ok)

    oversized_count_provider = SequencedProvider([valid_json])
    try:
        asyncio.run(extract_terms([MESSAGES[0]] * (MAX_CHAT_MESSAGES + 1), provider=oversized_count_provider))
        oversized_count_ok = False
    except SummaryGenerationError as exc:
        oversized_count_ok = exc.status_code == 413 and len(oversized_count_provider.requests) == 0
    oversized_body_provider = SequencedProvider([valid_json])
    oversized_body = ChatMessage('m3', MESSAGES[0].timestamp, 'brand', 'brand_admin', 'x' * (MAX_MESSAGE_BODY_CHARS + 1))
    try:
        asyncio.run(extract_terms([oversized_body], provider=oversized_body_provider))
        oversized_body_ok = False
    except SummaryGenerationError as exc:
        oversized_body_ok = exc.status_code == 413 and len(oversized_body_provider.requests) == 0
    check('oversized message count or body is rejected before any provider call', oversized_count_ok and oversized_body_ok)

    class RpcFailure:
        def __init__(self, error):
            self.error = error

        def execute(self):
            raise self.error

    class PersistenceClient:
        def __init__(self, error):
            self.error = error

        def rpc(self, name, params):
            del name, params
            return RpcFailure(self.error)

    class ConflictError(Exception):
        message = 'B4002_GENERATION_CONFLICT private db detail'

    originals = (
        term_extraction.get_supabase,
        term_extraction._existing_summary,
        term_extraction._assert_generation_ready,
        term_extraction._ordered_chat_messages,
    )
    term_extraction._existing_summary = lambda client, deal_id, generation_id: None
    term_extraction._assert_generation_ready = lambda client, deal_id, generation_id: None
    term_extraction._ordered_chat_messages = lambda client, deal_id: MESSAGES
    try:
        mapped = []
        for error in (ConflictError(), RuntimeError('private database outage')):
            term_extraction.get_supabase = lambda error=error: PersistenceClient(error)
            try:
                asyncio.run(term_extraction.generate_and_persist_summary('deal', 'generation', 'test', provider=SequencedProvider([valid_json])))
            except SummaryGenerationError as exc:
                mapped.append((exc.status_code, exc.detail))
        check('persistence conflicts map to safe 409 and other DB failures to safe 503', [row[0] for row in mapped] == [409, 503] and all('private' not in row[1] for row in mapped))
    finally:
        (
            term_extraction.get_supabase,
            term_extraction._existing_summary,
            term_extraction._assert_generation_ready,
            term_extraction._ordered_chat_messages,
        ) = originals

    fake_client = FakeClient()
    ordered = _ordered_chat_messages(fake_client, 'deal-1')
    selections = [row[1] for row in fake_client.log if row[0] == 'select']
    orderings = [row[1] for row in fake_client.log if row[0] == 'order']
    check('chat query selects only minimal message and participant columns', selections == ['profile_id,participant_role', 'id,sender_id,body,created_at'])
    check('chat query filters one deal/non-deleted text, orders timestamp then id, and bounds rows', ('eq', 'deal_id', 'deal-1') in fake_client.log and ('is', 'deleted_at', 'null') in fake_client.log and orderings == ['created_at', 'id'] and ('limit', MAX_CHAT_MESSAGES + 1) in fake_client.log)
    check('provider projection contains opaque IDs, role/side, timestamp and body only', [message.sender_side for message in ordered] == ['creator', 'brand'] and set(ordered[0].__dict__) == {'message_id', 'timestamp', 'sender_side', 'sender_role', 'body'})


if __name__ == '__main__':
    main()
