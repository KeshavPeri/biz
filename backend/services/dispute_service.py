"""Backend-owned Payment dispute raise and participant-safe read projection."""

from __future__ import annotations

import html
import re
import unicodedata
from typing import Any, NoReturn
from uuid import UUID

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError


_ROLES = {"creator", "brand_admin", "brand_maker", "brand_checker"}
_ROLE_LABELS = {
    "creator": "Creator",
    "brand_admin": "Brand admin",
    "brand_maker": "Brand maker",
    "brand_checker": "Brand checker",
}
_PUBLIC_TEXT_INPUT_LIMIT = 4096
_PUBLIC_DNS_NAME_LIMIT = 253
_PUBLIC_DOTTED_HOST = (
    rf"(?=[a-z0-9.-]{{1,{_PUBLIC_DNS_NAME_LIMIT}}}(?![a-z0-9.-]))"
    r"(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}"
)
_PUBLIC_NETWORK = re.compile(
    r"(?ix)"
    r"(?:"
    r"(?<![:/\w])//[^\s<>\"']+"
    r"|"
    r"(?:\b(?:https?|ftp|file|data|javascript|mailto):/{0,2}|\bwww\.)"
    r"[^\s<>\"']+"
    rf"|[a-z0-9.!#$%&'*+/=?^_`{{|}}~-]{{1,64}}@{_PUBLIC_DOTTED_HOST}"
    r"|[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9-]{1,63}(?![a-z0-9-]|\.[a-z0-9-])"
    r"|\[[0-9a-f:.%_-]+\](?::\d{1,5})?(?:/[^\s<>\"']*)?"
    r"|(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}(?:\d{1,3}\.){3}\d{1,3}"
    r"(?::\d{1,5})?(?:/[^\s<>\"']*)?(?![0-9a-f:.])"
    r"|(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}"
    r"(?:%[a-z0-9_.-]+)?(?![0-9a-f:])"
    r"|(?<![@\w])(?:localhost|(?!\d+:)[a-z0-9][a-z0-9_-]{0,62}):\d{1,5}(?:/[^\s<>\"']*)?"
    r"|(?<![@\w])localhost(?:/[^\s<>\"']*)?"
    rf"|(?<![@\w])(?<![a-z0-9-][.-]){_PUBLIC_DOTTED_HOST}(?:/[^\s<>\"']*)?"
    r"|(?<![\w])(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:/[^\s<>\"']*)?"
    r")"
)
_PUBLIC_PHONE_CANDIDATE = re.compile(
    r"(?<![\w])(?:\+|\()?\d[\d().:\s/,\-\u2010-\u2015\u2212]{5,46}\d(?![\w])"
)
_PUBLIC_DATETIME_ONLY = re.compile(
    r"(?:"
    r"(?:"
    r"\d{4}[-/. ](?:0?[1-9]|1[0-2])[-/. ](?:0?[1-9]|[12]\d|3[01])"
    r"|(?:0?[1-9]|[12]\d|3[01])[-/. ](?:0?[1-9]|1[0-2])[-/. ]\d{4}"
    r")"
    r"(?:[ T](?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?)?"
    r"|(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?"
    r")"
)
_PUBLIC_DATETIME_TOKEN = re.compile(
    r"(?<![\w])"
    r"(?:"
    r"(?:"
    r"\d{4}[-/. ](?:0?[1-9]|1[0-2])[-/. ](?:0?[1-9]|[12]\d|3[01])"
    r"|(?:0?[1-9]|[12]\d|3[01])[-/. ](?:0?[1-9]|1[0-2])[-/. ]\d{4}"
    r")"
    r"(?:[ T](?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?)?"
    r"|(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?"
    r")"
    r"(?![\w])"
)
_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "PAYMENT_DISPUTE_DEAL_NOT_FOUND": (404, "This deal could not be found."),
    "PAYMENT_DISPUTE_NOT_PARTICIPANT": (404, "This deal could not be found."),
    "PAYMENT_DISPUTE_NOT_AUTHORIZED": (404, "This deal could not be found."),
    "PAYMENT_DISPUTE_NOT_AVAILABLE": (409, "Disputes can only be raised during Payment."),
    "PAYMENT_DISPUTE_INVALID_REQUEST": (422, "Send a valid dispute description and evidence list."),
    "PAYMENT_DISPUTE_INVALID_EVIDENCE": (422, "One or more evidence references are not available on this deal."),
    "PAYMENT_DISPUTE_STATE_INCONSISTENT": (409, "The dispute state is inconsistent. Nothing was changed."),
    "PAYMENT_DISPUTE_IMMUTABLE_IDENTITY": (409, "Dispute evidence can't be changed after it is raised."),
}


class DisputeConflict(DealError):
    """A materially different raise found an existing open dispute."""

    def __init__(self, projection: dict[str, Any]) -> None:
        super().__init__(409, "A payment dispute is already open for this deal.")
        self.projection = projection


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The dispute could not be opened safely. Nothing was changed.") from exc


def _load_deal(client: Client, deal_id: str) -> dict[str, Any]:
    rows = (
        client.table("deals")
        .select("id,stage,creator_id,brand_id,is_disputed")
        .eq("id", deal_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(404, "This deal could not be found.")
    return rows[0]


def _participant(client: Client, deal: dict[str, Any], user_id: str) -> str:
    rows = (
        client.table("deal_participants")
        .select("participant_role")
        .eq("deal_id", deal["id"])
        .eq("profile_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        # A missing deal and a non-participant deliberately share the same response.
        raise DealError(404, "This deal could not be found.")
    role = rows[0]["participant_role"]
    eligible = role in _ROLES
    if role == "creator":
        eligible = eligible and deal["creator_id"] == user_id
    else:
        eligible = eligible and bool(
            client.table("brand_members")
            .select("profile_id")
            .eq("brand_id", deal["brand_id"])
            .eq("profile_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )
    if not eligible:
        # Stale participant rows must not reveal that the deal or its dispute
        # history still exists after current brand membership is lost.
        raise DealError(404, "This deal could not be found.")
    return role


def _canonical_payment(client: Client, deal_id: str) -> dict[str, Any]:
    rows = (
        client.table("payments")
        .select("id,state")
        .eq("deal_id", deal_id)
        .not_.is_("source_summary_id", "null")
        .limit(2)
        .execute()
        .data
    )
    if len(rows) != 1:
        raise DealError(409, "The dispute state is inconsistent. Nothing was changed.")
    return rows[0]


def _has_control(value: str) -> bool:
    return any(unicodedata.category(char).startswith("C") for char in value)


def _uuid(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError
    return str(UUID(value))


def _validate_body(body: Any) -> tuple[str, list[dict[str, str]]]:
    if not isinstance(body, dict) or set(body) - {"description", "evidence"} or "description" not in body:
        raise DealError(422, "Send exactly a description and optional evidence list.")
    description = body.get("description")
    if not isinstance(description, str):
        raise DealError(422, "Add a dispute description between 10 and 2,000 characters.")
    description = description.strip()
    if (
        not 10 <= len(description) <= 2000
        or _has_control(description)
        or re.search(r"<[^>]*>|(?<![\w])(?:https?|file|data):", description, re.IGNORECASE)
    ):
        raise DealError(422, "Add a plain-text dispute description between 10 and 2,000 characters.")
    evidence = body.get("evidence", [])
    if not isinstance(evidence, list) or len(evidence) > 10:
        raise DealError(422, "Add at most 10 message or live-post evidence references.")
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in evidence:
        if not isinstance(item, dict) or set(item) != {"kind", "id"} or item.get("kind") not in {
            "message", "live_post"
        }:
            raise DealError(422, "Each evidence item must be exactly one message or live-post reference.")
        try:
            reference_id = _uuid(item.get("id"))
        except (TypeError, ValueError, AttributeError) as exc:
            raise DealError(422, "Each evidence reference must use a valid id.") from exc
        key = (item["kind"], reference_id)
        if key in seen:
            raise DealError(422, "Duplicate evidence references are not allowed.")
        seen.add(key)
        normalized.append({"kind": key[0], "id": key[1]})
    normalized.sort(key=lambda item: (item["kind"], item["id"]))
    return description, normalized


def _validate_evidence_ownership(client: Client, deal_id: str, evidence: list[dict[str, str]]) -> None:
    message_ids = [item["id"] for item in evidence if item["kind"] == "message"]
    if message_ids:
        rows = (
            client.table("messages")
            .select("id")
            .eq("deal_id", deal_id)
            .is_("deleted_at", "null")
            .in_("id", message_ids)
            .execute()
            .data
        )
        if {row["id"] for row in rows} != set(message_ids):
            raise DealError(422, "One or more message references are not available on this deal.")
    live_ids = [item["id"] for item in evidence if item["kind"] == "live_post"]
    if live_ids:
        submissions = (
            client.table("live_post_submissions")
            .select("id,deliverable_id")
            .in_("id", live_ids)
            .execute()
            .data
        )
        deliverable_ids = [row["deliverable_id"] for row in submissions]
        deliverables = (
            client.table("deliverables")
            .select("id")
            .eq("deal_id", deal_id)
            .not_.is_("source_summary_id", "null")
            .in_("id", deliverable_ids)
            .execute()
            .data
            if deliverable_ids
            else []
        )
        valid_deliverables = {row["id"] for row in deliverables}
        valid_submissions = {
            row["id"] for row in submissions if row["deliverable_id"] in valid_deliverables
        }
        if valid_submissions != set(live_ids):
            raise DealError(422, "One or more live-post references are not available on this deal.")


def raise_dispute(
    deal_id: str,
    user_id: str,
    body: Any,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal = _load_deal(client, deal_id)
    _participant(client, deal, user_id)
    if deal["stage"] != "payment":
        raise DealError(409, "Disputes can only be raised during Payment.")
    _canonical_payment(client, deal_id)
    description, evidence = _validate_body(body)
    # Once the overlay exists, the database compares the normalized request to
    # the locked open row before consulting referenced records. This preserves
    # exact transport retries and gives every different valid request the same
    # already-open conflict without leaking cross-deal evidence details.
    if not deal["is_disputed"]:
        _validate_evidence_ownership(client, deal_id, evidence)
    try:
        outcome = client.rpc(
            "raise_payment_dispute",
            {
                "p_deal_id": deal_id,
                "p_actor_id": user_id,
                "p_description": description,
                "p_evidence": evidence,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    projection = get_disputes(deal_id, user_id, _client=client)
    if outcome.get("outcome") == "already_open":
        raise DisputeConflict(projection)
    projection["outcome"] = {
        "dispute_id": outcome["dispute_id"],
        "opened": True,
        "idempotent": bool(outcome.get("idempotent")),
    }
    return projection


def _stored_references(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 10:
        raise DealError(409, "The dispute history can't be displayed safely.")
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"kind", "id"} or item.get("kind") not in {
            "message", "live_post"
        }:
            raise DealError(409, "The dispute history can't be displayed safely.")
        try:
            reference_id = _uuid(item.get("id"))
        except (TypeError, ValueError, AttributeError) as exc:
            raise DealError(409, "The dispute history can't be displayed safely.") from exc
        key = (item["kind"], reference_id)
        if key in seen:
            raise DealError(409, "The dispute history can't be displayed safely.")
        seen.add(key)
        normalized.append({"kind": key[0], "id": key[1]})
    return normalized


def _strip_html(value: str) -> str:
    """Remove complete tags and neutralize unmatched angle brackets in one pass."""
    parts: list[str] = []
    cursor = 0
    while True:
        start = value.find("<", cursor)
        if start == -1:
            parts.append(value[cursor:].replace(">", " "))
            break
        parts.append(value[cursor:start])
        end = value.find(">", start + 1)
        if end == -1:
            parts.append(value[start:].replace("<", " ").replace(">", " "))
            break
        parts.append(" ")
        cursor = end + 1
    return "".join(parts)


def _strip_scheme_urls(value: str) -> str:
    """Remove arbitrary scheme URLs with a forward-only bounded scan."""
    parts: list[str] = []
    cursor = 0
    index = 0
    while index < len(value):
        char = value[index]
        previous = value[index - 1] if index else ""
        if (
            char.isascii()
            and char.isalpha()
            and (not previous or not (previous.isalnum() or previous == "_"))
        ):
            scheme_end = index + 1
            while scheme_end < len(value) and (
                value[scheme_end].isascii()
                and (value[scheme_end].isalnum() or value[scheme_end] in "+.-")
            ):
                scheme_end += 1
            if value.startswith("://", scheme_end):
                token_end = scheme_end + 3
                while token_end < len(value) and value[token_end] not in " \t\r\n<>\"'":
                    token_end += 1
                parts.extend((value[cursor:index], "[link removed]"))
                cursor = token_end
                index = token_end
                continue
            index = scheme_end
            continue
        index += 1
    parts.append(value[cursor:])
    return "".join(parts)


def _normalize_controls(value: str) -> str:
    return "".join(
        " " if unicodedata.category(char).startswith("C") else char
        for char in value
    )


def _phone_contact(match: re.Match[str]) -> str:
    candidate = match.group(0)
    digits = sum(char.isdigit() for char in candidate)
    if 7 <= digits <= 30 and not _PUBLIC_DATETIME_ONLY.fullmatch(candidate.strip()):
        return "[phone removed]"
    return candidate


def _contains_phone_contact(value: str) -> bool:
    """Detect bounded phone-like contact tokens without scanning unbounded input."""
    bounded = _normalize_controls(html.unescape(value[:_PUBLIC_TEXT_INPUT_LIMIT]))
    bounded, _ = _protect_timestamps(bounded)
    return any(
        _phone_contact(match) != match.group(0)
        for match in _PUBLIC_PHONE_CANDIDATE.finditer(bounded)
    )


def _protect_timestamps(value: str) -> tuple[str, list[tuple[str, str]]]:
    """Temporarily isolate validated timestamps from network/contact patterns."""
    prefix = "publictimestampplaceholder"
    while prefix in value.lower():
        prefix = f"x{prefix}"
    protected: list[tuple[str, str]] = []

    def replace(match: re.Match[str]) -> str:
        token = f"{prefix}{len(protected)}token"
        protected.append((token, match.group(0)))
        return token

    return _PUBLIC_DATETIME_TOKEN.sub(replace, value), protected


def _contains_private_network(value: str) -> bool:
    bounded = _normalize_controls(html.unescape(value[:_PUBLIC_TEXT_INPUT_LIMIT]))
    bounded, _ = _protect_timestamps(bounded)
    return bool(_PUBLIC_NETWORK.search(bounded))


def _public_text(value: Any, fallback: str, limit: int) -> str:
    if not isinstance(value, str):
        return fallback
    plain = _normalize_controls(html.unescape(value[:_PUBLIC_TEXT_INPUT_LIMIT]))
    plain = _strip_html(plain)
    plain = _strip_scheme_urls(plain)
    plain, timestamps = _protect_timestamps(plain)
    plain = _PUBLIC_NETWORK.sub("[link removed]", plain)
    plain = _PUBLIC_PHONE_CANDIDATE.sub(_phone_contact, plain)
    for token, timestamp in timestamps:
        plain = plain.replace(token, timestamp)
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain[:limit] or fallback


def _evidence_display(
    client: Client, deal_id: str, references: list[dict[str, str]]
) -> list[dict[str, str]]:
    message_ids = [item["id"] for item in references if item["kind"] == "message"]
    messages: dict[str, str] = {}
    if message_ids:
        rows = (
            client.table("messages")
            .select("id,body")
            .eq("deal_id", deal_id)
            .is_("deleted_at", "null")
            .in_("id", message_ids)
            .execute()
            .data
        )
        messages = {
            row["id"]: _public_text(row.get("body"), "Message evidence", 160)
            for row in rows
        }

    live_ids = [item["id"] for item in references if item["kind"] == "live_post"]
    live: dict[str, str] = {}
    if live_ids:
        rows = (
            client.table("live_post_submissions")
            .select("id,deliverable_id")
            .in_("id", live_ids)
            .execute()
            .data
        )
        deliverable_ids = [row["deliverable_id"] for row in rows]
        valid = {
            row["id"]
            for row in (
                client.table("deliverables")
                .select("id")
                .eq("deal_id", deal_id)
                .not_.is_("source_summary_id", "null")
                .in_("id", deliverable_ids)
                .execute()
                .data
                if deliverable_ids
                else []
            )
        }
        for row in rows:
            if row["deliverable_id"] in valid:
                live[row["id"]] = "Live-post evidence"

    display_rows: list[dict[str, str]] = []
    for item in references:
        snippet = messages.get(item["id"]) if item["kind"] == "message" else live.get(item["id"])
        if snippet is None:
            raise DealError(409, "The dispute history can't be displayed safely.")
        display_rows.append({"kind": item["kind"], "id": item["id"], "snippet": snippet})
    return display_rows


def safe_dispute_projection(
    client: Client,
    deal: dict[str, Any],
    row: dict[str, Any],
    *,
    display_name: str | None = None,
    can_resolve: bool = False,
    include_allowed_actions: bool = False,
) -> dict[str, Any]:
    """Build the shared, purpose-limited participant/operations projection."""
    deal_id = deal["id"]
    stored_role = row.get("raiser_role")
    safe_role = stored_role if stored_role in _ROLES else None
    side = row.get("raiser_side") if row.get("raiser_side") in {"creator", "brand"} else None
    if safe_role is None:
        participant_rows = (
            client.table("deal_participants")
            .select("participant_role")
            .eq("deal_id", deal_id)
            .eq("profile_id", row["raised_by"])
            .limit(1)
            .execute()
            .data
        )
        safe_role = participant_rows[0]["participant_role"] if participant_rows else "creator"
    if side is None:
        side = "creator" if row["raised_by"] == deal["creator_id"] else "brand"
    if display_name is None:
        profiles = (
            client.table("profiles")
            .select("display_name")
            .eq("id", row["raised_by"])
            .limit(1)
            .execute()
            .data
        )
        display_name = profiles[0].get("display_name") if profiles else None
    legitimate_resolution = (
        row["status"] == "resolved"
        and row.get("resolved_at") is not None
        and row.get("resolved_by") is not None
    )
    projection = {
        "id": row["id"],
        "status": row["status"],
        "description": _public_text(
            row.get("description"), "Dispute description unavailable", 2000
        ),
        "raised_by": {
            "display_name": _public_text(display_name, "Participant", 160),
            "side": side,
            "role": safe_role,
            "role_label": _ROLE_LABELS.get(safe_role, "Participant"),
        },
        "created_at": row["created_at"],
        "resolved_at": row.get("resolved_at") if legitimate_resolution else None,
        "resolution_note": (
            _public_text(row.get("resolution_note"), "Resolution recorded", 1000)
            if legitimate_resolution and row.get("resolution_note")
            else None
        ),
        "evidence": _evidence_display(client, deal_id, _stored_references(row.get("evidence"))),
    }
    if include_allowed_actions:
        projection["allowed_actions"] = {
            "can_resolve": can_resolve and row["status"] == "open"
        }
    return projection


def get_disputes(
    deal_id: str,
    user_id: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal = _load_deal(client, deal_id)
    role = _participant(client, deal, user_id)
    if deal["stage"] not in {"payment", "closed"}:
        return {
            "available": False,
            "deal_id": deal_id,
            "stage": deal["stage"],
            "reason": "not_yet_available",
            "history": [],
            "current_open": None,
            "allowed_actions": {"can_raise": False, "can_resolve": False},
        }

    payment = _canonical_payment(client, deal_id)
    open_rows = (
        client.table("disputes")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("status", "open")
        .limit(2)
        .execute()
        .data
    )
    if len(open_rows) > 1:
        raise DealError(409, "The dispute state is inconsistent. Nothing was changed.")
    has_open = len(open_rows) == 1
    if (
        has_open != bool(deal["is_disputed"])
        or (deal["is_disputed"] and payment["state"] != "disputed")
        or (not deal["is_disputed"] and payment["state"] == "disputed")
        or (deal["stage"] == "closed" and has_open)
    ):
        raise DealError(409, "The dispute state is inconsistent. Nothing was changed.")

    rows = (
        client.table("disputes")
        .select(
            "id,raised_by,description,evidence,status,created_at,resolved_at,resolution_note,"
            "request_fingerprint,raiser_role,raiser_side,resolved_by"
        )
        .eq("deal_id", deal_id)
        .order("created_at", desc=True)
        .order("id", desc=True)
        .limit(50)
        .execute()
        .data
    )
    actor_ids = {row["raised_by"] for row in rows}
    names: dict[str, str] = {}
    if actor_ids:
        profiles = client.table("profiles").select("id,display_name").in_("id", list(actor_ids)).execute().data
        names = {
            row["id"]: _public_text(row.get("display_name"), "Participant", 160)
            for row in profiles
        }

    history = [
        safe_dispute_projection(
            client,
            deal,
            row,
            display_name=names.get(row["raised_by"]),
            can_resolve=False,
        )
        for row in rows
    ]

    current_id = open_rows[0]["id"] if has_open else None
    current_open = next((item for item in history if item["id"] == current_id), None)
    if has_open and current_open is None:
        raise DealError(409, "The dispute history can't be displayed safely.")
    return {
        "available": True,
        "deal_id": deal_id,
        "stage": deal["stage"],
        "history": history,
        "current_open": current_open,
        "allowed_actions": {
            "can_raise": bool(
                role in _ROLES
                and deal["stage"] == "payment"
                and not deal["is_disputed"]
                and not has_open
                and payment["state"] != "disputed"
            ),
            "can_resolve": False,
        },
    }
