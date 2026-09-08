"""Retryable, private, immutable Closed-chat PDF generation."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import threading
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any
from uuid import uuid4

from jinja2 import Environment, FileSystemLoader, select_autoescape
from pypdf import PdfReader
from supabase import Client
from weasyprint import HTML

from core.supabase_client import get_supabase
from services.post_close_service import _deal_and_side
from services.stage_engine import DealError


logger = logging.getLogger(__name__)
BUCKET = "deal-chat-archives"
SIGNED_URL_TTL_SECONDS = 300
PAGE_SIZE = 500
MAX_MESSAGES = 5000
MAX_ATTACHMENTS = 10000
MAX_SOURCE_CHARS = 2_000_000
MAX_PDF_BYTES = 10 * 1024 * 1024
TEMPLATES = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)
_LOCK = threading.RLock()
_UNSAFE_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _serialized(function: Any) -> Any:
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        with _LOCK:
            return function(*args, **kwargs)
    return wrapped


def _audit(client: Client, actor_id: str, action: str, deal_id: str, metadata: dict[str, Any], ip_address: str) -> None:
    client.table("audit_log").insert({
        "actor_id": actor_id,
        "action": action,
        "entity_type": "deal",
        "entity_id": deal_id,
        "metadata": metadata,
        "ip_address": ip_address,
    }).execute()


def _clean_text(value: Any, maximum: int, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback
    cleaned = _UNSAFE_CONTROL.sub("", value).strip()
    return cleaned[:maximum] or fallback


def _format_time(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    except ValueError as exc:
        raise DealError(409, "The chat archive source could not be verified safely.") from exc


def _archive_row(client: Client, deal_id: str) -> dict[str, Any]:
    rows = client.table("deal_chat_archives").select(
        "id,deal_id,state,closed_at,source_message_count,source_last_created_at,"
        "source_last_message_id,storage_path,failure_code,attempt_count,byte_count,page_count,message_count"
    ).eq("deal_id", deal_id).limit(1).execute().data
    if not rows:
        raise DealError(409, "The chat record has not been queued yet. Refresh and try again.")
    return rows[0]


def _public_status(row: dict[str, Any]) -> dict[str, Any]:
    state = row.get("state")
    if state == "ready":
        return {
            "state": "ready",
            "message_count": row.get("message_count"),
            "page_count": row.get("page_count"),
            "allowed_actions": {"can_retry": False, "can_download": True},
        }
    if state == "failed":
        return {
            "state": "failed",
            "failure": "The chat record could not be prepared safely.",
            "allowed_actions": {"can_retry": True, "can_download": False},
        }
    return {
        "state": "preparing",
        "allowed_actions": {"can_retry": False, "can_download": False},
    }


def get_archive_status(deal_id: str, user_id: str, *, _client: Client | None = None) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, _ = _deal_and_side(client, deal_id, user_id)
    if deal.get("stage") != "closed":
        raise DealError(409, "The chat record is available only after this deal closes.")
    return {"deal_id": deal_id, **_public_status(_archive_row(client, deal_id))}


def _paged_rows(query_factory: Any, maximum: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = query_factory().range(offset, offset + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(rows) > maximum:
            raise DealError(413, "The chat record is too large to prepare safely.")
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def _load_source(client: Client, deal: dict[str, Any], reservation: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    messages = _paged_rows(
        lambda: client.table("messages").select("id,sender_id,body,created_at").eq(
            "deal_id", deal["id"]
        ).is_("deleted_at", "null").order("created_at").order("id"),
        MAX_MESSAGES,
    )
    expected_count = reservation.get("source_message_count")
    last = messages[-1] if messages else None
    if len(messages) != expected_count or (
        last is None and (reservation.get("source_last_created_at") is not None or reservation.get("source_last_message_id") is not None)
    ) or (
        last is not None and (
            last.get("created_at") != reservation.get("source_last_created_at")
            or last.get("id") != reservation.get("source_last_message_id")
        )
    ):
        raise DealError(409, "The chat archive source could not be verified safely.")

    message_ids = [row["id"] for row in messages]
    attachments: list[dict[str, Any]] = []
    for start in range(0, len(message_ids), 100):
        ids = message_ids[start:start + 100]
        attachments.extend(_paged_rows(
            lambda ids=ids: client.table("message_attachments").select(
                "id,message_id,file_name,file_type"
            ).in_("message_id", ids).order("message_id").order("id"),
            MAX_ATTACHMENTS - len(attachments),
        ))
        if len(attachments) > MAX_ATTACHMENTS:
            raise DealError(413, "The chat record is too large to prepare safely.")

    sender_ids = list({row["sender_id"] for row in messages})
    participant_ids = list({row["profile_id"] for row in client.table("deal_participants").select(
        "profile_id"
    ).eq("deal_id", deal["id"]).execute().data})
    if not set(sender_ids).issubset(set(participant_ids)):
        raise DealError(409, "The chat archive source could not be verified safely.")
    profiles = client.table("profiles").select("id,display_name").in_(
        "id", participant_ids
    ).execute().data if participant_ids else []
    labels = {row["id"]: _clean_text(row.get("display_name"), 120, "Participant") for row in profiles}
    brand_rows = client.table("brands").select("company_name").eq("id", deal["brand_id"]).limit(1).execute().data
    creator_label = labels.get(deal["creator_id"], "Creator")
    brand_label = _clean_text(brand_rows[0].get("company_name") if brand_rows else None, 120, "Brand")

    by_message: dict[str, list[dict[str, str]]] = {message_id: [] for message_id in message_ids}
    attachment_chars = 0
    for attachment in attachments:
        filename = _clean_text(attachment.get("file_name"), 80, "file").replace("/", "_").replace("\\", "_")
        file_type = _clean_text(attachment.get("file_type"), 60, "attachment")
        label = f"{filename} ({file_type})"
        attachment_chars += len(label)
        by_message[attachment["message_id"]].append({"label": label})

    rendered_messages: list[dict[str, Any]] = []
    source_messages: list[dict[str, Any]] = []
    source_chars = attachment_chars + len(creator_label) + len(brand_label) + len(str(deal.get("deal_name") or ""))
    for row in messages:
        body = _clean_text(row.get("body"), MAX_SOURCE_CHARS, "[Attachment-only message]")
        source_chars += len(body)
        if source_chars > MAX_SOURCE_CHARS:
            raise DealError(413, "The chat record is too large to prepare safely.")
        message_attachments = by_message.get(row["id"], [])
        rendered_messages.append({
            "created_at": _format_time(row["created_at"]),
            "sender_label": labels.get(row["sender_id"], "Participant"),
            "body": body,
            "attachments": message_attachments,
        })
        source_messages.append({
            "id": row["id"], "created_at": row["created_at"], "sender_id": row["sender_id"],
            "body": body, "attachments": message_attachments,
        })
    context = {
        "deal_name": _clean_text(deal.get("deal_name"), 160, "Collaboration"),
        "closed_at": _format_time(reservation["closed_at"]),
        "participant_labels": f"{creator_label} and {brand_label}",
        "messages": rendered_messages,
    }
    source_hash = hashlib.sha256(json.dumps({
        "deal_id": deal["id"],
        "message_ids": [row["id"] for row in messages],
        "context": context,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    return [context], source_hash


def _render(context: dict[str, Any]) -> tuple[bytes, int]:
    try:
        html = TEMPLATES.get_template("chat-archive.html").render(**context)
        data = HTML(string=html).write_pdf()
        if not data.startswith(b"%PDF") or not 1_000 <= len(data) <= MAX_PDF_BYTES:
            raise ValueError("invalid PDF size or signature")
        pages = len(PdfReader(io.BytesIO(data)).pages)
        if pages < 1:
            raise ValueError("PDF has no pages")
        return data, pages
    except DealError:
        raise
    except Exception as exc:
        logger.exception("Chat archive rendering failed")
        raise DealError(500, "The chat record could not be rendered safely.") from exc


def _mark_failed(client: Client, archive_id: str, lease_token: str, code: str) -> None:
    try:
        client.rpc("fail_deal_chat_archive", {
            "p_archive_id": archive_id,
            "p_lease_token": lease_token,
            "p_failure_code": code,
        }).execute()
    except Exception:
        logger.exception("Could not persist chat archive failure state")


@_serialized
def prepare_archive(
    deal_id: str,
    user_id: str,
    ip_address: str,
    *,
    explicit_retry: bool = False,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, _ = _deal_and_side(client, deal_id, user_id)
    if deal.get("stage") != "closed":
        raise DealError(409, "The chat record is available only after this deal closes.")
    before = _archive_row(client, deal_id)
    lease_token = str(uuid4())
    try:
        reservation = client.rpc("reserve_deal_chat_archive", {
            "p_deal_id": deal_id, "p_lease_token": lease_token,
        }).execute().data
    except Exception as exc:
        raise DealError(409, "The chat record could not be reserved safely. Please retry.") from exc
    if not isinstance(reservation, dict) or not reservation.get("reserved"):
        return get_archive_status(deal_id, user_id, _client=client)
    archive_id = reservation["archive_id"]
    if explicit_retry and before.get("state") == "failed":
        _audit(client, user_id, "deal_chat_archive_retried", deal_id, {"attempt": before.get("attempt_count", 0) + 1}, ip_address)
    try:
        contexts, source_hash = _load_source(client, deal, reservation)
        pdf, page_count = _render(contexts[0])
        try:
            client.storage.from_(BUCKET).upload(
                reservation["storage_path"], pdf,
                file_options={"content-type": "application/pdf", "upsert": "true"},
            )
        except Exception as exc:
            _mark_failed(client, archive_id, lease_token, "storage_failed")
            raise DealError(500, "The chat record could not be stored safely. Please retry.") from exc
        try:
            finalized = client.rpc("finalize_deal_chat_archive", {
                "p_archive_id": archive_id,
                "p_lease_token": lease_token,
                "p_source_hash": source_hash,
                "p_byte_count": len(pdf),
                "p_page_count": page_count,
                "p_message_count": len(contexts[0]["messages"]),
            }).execute().data
        except Exception as exc:
            _mark_failed(client, archive_id, lease_token, "generation_interrupted")
            raise DealError(500, "The chat record could not be finalized safely. Please retry.") from exc
        if finalized is not True:
            _mark_failed(client, archive_id, lease_token, "generation_interrupted")
            raise DealError(409, "The chat record changed while it was being finalized. Refresh its status.")
        _audit(client, user_id, "deal_chat_archive_ready", deal_id, {
            "message_count": len(contexts[0]["messages"]), "page_count": page_count,
        }, ip_address)
    except DealError as exc:
        if exc.status_code == 413:
            _mark_failed(client, archive_id, lease_token, "source_too_large")
        elif "source" in exc.detail.lower():
            _mark_failed(client, archive_id, lease_token, "source_inconsistent")
        elif "render" in exc.detail.lower():
            _mark_failed(client, archive_id, lease_token, "render_failed")
        else:
            _mark_failed(client, archive_id, lease_token, "generation_interrupted")
        raise
    return get_archive_status(deal_id, user_id, _client=client)


@_serialized
def archive_download(deal_id: str, user_id: str, ip_address: str, *, _client: Client | None = None) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, _ = _deal_and_side(client, deal_id, user_id)
    if deal.get("stage") != "closed":
        raise DealError(404, "No chat record is ready for this deal.")
    row = _archive_row(client, deal_id)
    if row.get("state") != "ready":
        raise DealError(409, "The chat record is not ready to download yet.")
    result = client.storage.from_(BUCKET).create_signed_url(row["storage_path"], SIGNED_URL_TTL_SECONDS)
    url = result.get("signedURL") or result.get("signedUrl")
    if not url:
        raise DealError(500, "A secure download link could not be created. Please try again.")
    _audit(client, user_id, "deal_chat_archive_download_link_issued", deal_id, {
        "expires_in_seconds": SIGNED_URL_TTL_SECONDS,
    }, ip_address)
    return {"url": url, "expires_in": SIGNED_URL_TTL_SECONDS}
