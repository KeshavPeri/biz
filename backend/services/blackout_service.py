"""Participant-safe, read-only blackout tracker over canonical calendar facts."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from supabase import Client

from core.supabase_client import get_supabase
from services.exclusivity_service import _authorized_deals, _executed_source, _execution_evidence
from services.stage_engine import DealError
from services.term_extraction import TermsExtractionV1, TermsExtractionV2, validate_chat_terms_row

_MAX_DEALS = 100
_MAX_DELIVERABLES = 100
_MAX_RANGES = 500
_MAX_GENERATED_DAYS = 10_000
_MAX_NAME = 160
_GENERIC_UNAVAILABLE = "Blackout information is temporarily unavailable. Please refresh."


def _unavailable() -> None:
    raise DealError(409, _GENERIC_UNAVAILABLE)


def _safe_text(value: Any, maximum: int = _MAX_NAME) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or value != value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
        _unavailable()
    return value


TermsModel = TermsExtractionV1 | TermsExtractionV2


def _terms(summary: dict[str, Any]) -> TermsModel:
    try:
        terms = validate_chat_terms_row(summary)
    except (TypeError, ValueError) as exc:
        raise DealError(409, _GENERIC_UNAVAILABLE) from exc
    if terms.usage_rights.status != "found" or terms.blackout_window.status != "found" or not isinstance(terms.usage_rights.value, bool) or not isinstance(terms.blackout_window.value, bool):
        _unavailable()
    if terms.blackout_window.value and (terms.blackout_duration_timing.status != "found" or terms.blackout_duration_timing.value is None):
        _unavailable()
    return terms


def _canonical_pair(client: Client, deal_id: str, source_id: str, contract: dict[str, Any], terms: TermsModel) -> tuple[bool, str | None, int | None]:
    """Validate the all-or-nothing calendar pair; historical source is read-only."""
    usage = client.table("usage_rights").select("source_summary_id,has_usage_rights,channels,duration_days,is_perpetual,start_date,end_date").eq("deal_id", deal_id).not_.is_("source_summary_id", "null").limit(2).execute().data
    blackouts = client.table("blackout_windows").select("source_summary_id,has_blackout,timing,duration_days,start_date,end_date").eq("deal_id", deal_id).not_.is_("source_summary_id", "null").limit(2).execute().data
    if not usage and not blackouts:
        _execution_evidence(client, deal_id, contract["id"], require_transition=True)
        return _blackout_terms(terms)
    if len(usage) != 1 or len(blackouts) != 1 or usage[0].get("source_summary_id") != source_id or blackouts[0].get("source_summary_id") != source_id:
        _unavailable()
    execution_date = _execution_evidence(client, deal_id, contract["id"], require_transition=False)
    u = usage[0]
    if bool(u.get("has_usage_rights")) != terms.usage_rights.value:
        _unavailable()
    if terms.usage_rights.value:
        duration = terms.usage_rights_duration.value
        channels = terms.usage_rights_channels.value
        if terms.usage_rights_duration.status != "found" or terms.usage_rights_channels.status != "found" or duration is None or not isinstance(channels, list):
            _unavailable()
        expected_end = None if duration.is_perpetual else (execution_date + timedelta(days=duration.duration_days - 1)).isoformat()
        if u.get("channels") != channels or u.get("duration_days") != duration.duration_days or u.get("is_perpetual") != duration.is_perpetual or u.get("start_date") != execution_date.isoformat() or u.get("end_date") != expected_end:
            _unavailable()
    elif any(u.get(key) not in (None, [], False) for key in ("channels", "duration_days", "is_perpetual", "start_date", "end_date")):
        _unavailable()
    expected = _blackout_terms(terms)
    b = blackouts[0]
    if bool(b.get("has_blackout")) != expected[0] or b.get("timing") != expected[1] or b.get("duration_days") != expected[2] or b.get("start_date") is not None or b.get("end_date") is not None:
        _unavailable()
    return expected


def _blackout_terms(terms: TermsModel) -> tuple[bool, str | None, int | None]:
    if not terms.blackout_window.value:
        return False, None, None
    detail = terms.blackout_duration_timing.value
    if detail is None or detail.timing not in {"before", "after", "both"} or not isinstance(detail.duration_days, int) or not 1 <= detail.duration_days <= 3650:
        _unavailable()
    return True, detail.timing, detail.duration_days


def _canonical_deliverables(client: Client, deal_id: str, source_id: str, terms: TermsModel) -> list[tuple[date, date]]:
    rows = client.table("deliverables").select("id,sequence,source_summary_id,posting_date,posting_window_start,posting_window_end").eq("deal_id", deal_id).limit(_MAX_DELIVERABLES + 1).execute().data
    expected_count = terms.deliverable_count.value
    if not isinstance(expected_count, int) or not 1 <= expected_count <= _MAX_DELIVERABLES or len(rows) != expected_count:
        _unavailable()
    schedules: list[tuple[date, date]] = []
    sequences: set[int] = set()
    for row in rows:
        if row.get("source_summary_id") != source_id or not isinstance(row.get("sequence"), int) or row["sequence"] in sequences:
            _unavailable()
        sequences.add(row["sequence"])
        posting, start, end = row.get("posting_date"), row.get("posting_window_start"), row.get("posting_window_end")
        try:
            if isinstance(posting, str) and start is None and end is None:
                schedules.append((date.fromisoformat(posting), date.fromisoformat(posting)))
            elif posting is None and isinstance(start, str) and isinstance(end, str):
                start_date, end_date = date.fromisoformat(start), date.fromisoformat(end)
                if start_date > end_date:
                    _unavailable()
                schedules.append((start_date, end_date))
            else:
                _unavailable()
        except ValueError:
            _unavailable()
    if sequences != set(range(1, expected_count + 1)):
        _unavailable()
    return schedules


def _ranges(deal_id: str, schedules: list[tuple[date, date]], timing: str, duration: int, today: date) -> list[tuple[date, date]]:
    raw: list[tuple[date, date]] = []
    posting_days: set[date] = set()
    for start, end in schedules:
        for offset in range((end - start).days + 1):
            posting_days.add(start + timedelta(days=offset))
        if timing in {"before", "both"}:
            raw.append((start - timedelta(days=duration), start - timedelta(days=1)))
        if timing in {"after", "both"}:
            raw.append((end + timedelta(days=1), end + timedelta(days=duration)))
    days: set[date] = set()
    for start, end in raw:
        if end < today:
            continue
        for offset in range((end - start).days + 1):
            days.add(start + timedelta(days=offset))
            if len(days) > _MAX_GENERATED_DAYS:
                _unavailable()
    days.difference_update(posting_days)
    merged: list[tuple[date, date]] = []
    for current in sorted(days):
        if not merged or current > merged[-1][1] + timedelta(days=1):
            merged.append((current, current))
        else:
            merged[-1] = (merged[-1][0], current)
    return [item for item in merged if item[1] >= today]


def get_blackout_snapshot(user_id: str, *, _client: Client | None = None, _now: datetime | None = None) -> dict[str, Any]:
    client = _client or get_supabase()
    now = (_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    today = now.date()
    deals = _authorized_deals(client, user_id)
    brand_ids = {row.get("brand_id") for row in deals if isinstance(row.get("brand_id"), str)}
    brands = client.table("brands").select("id,company_name").in_("id", list(brand_ids)).execute().data if brand_ids else []
    brand_names = {row.get("id"): _safe_text(row.get("company_name")) for row in brands}
    visible: list[dict[str, Any]] = []
    unavailable = 0
    for deal in deals:
        try:
            deal_id = deal["id"]
            if deal.get("brand_id") not in brand_names:
                _unavailable()
            contract, summary, terms = _executed_source(client, deal_id)
            has_blackout, timing, duration = _canonical_pair(client, deal_id, summary["id"], contract, terms)
            if not has_blackout:
                continue
            if timing is None or duration is None:
                _unavailable()
            for start, end in _ranges(deal_id, _canonical_deliverables(client, deal_id, summary["id"], terms), timing, duration, today):
                visible.append({"id": f"blackout:{deal_id}:{start.isoformat()}:{end.isoformat()}", "deal_id": deal_id, "deal_name": _safe_text(deal.get("deal_name")), "brand_name": brand_names[deal["brand_id"]], "timing": timing, "duration_days": duration, "start_date": start.isoformat(), "end_date": end.isoformat(), "status": "active" if start <= today <= end else "upcoming", "deal_path": f"/deal/{deal_id}"})
        except (DealError, KeyError, TypeError, ValueError):
            unavailable += 1
    if len(visible) > _MAX_RANGES or len({item["id"] for item in visible}) != len(visible):
        _unavailable()
    visible.sort(key=lambda item: (0 if item["status"] == "active" else 1, item["start_date"], item["end_date"], item["deal_id"], item["id"]))
    return {"version": 1, "as_of": now.isoformat().replace("+00:00", "Z"), "integrity_unavailable_count": unavailable, "ranges": visible}
