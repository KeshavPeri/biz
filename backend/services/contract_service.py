"""Approval-stage contract generation, alignment, signing, and execution.

The service-role client bypasses RLS, so every public entry point verifies deal
participation and RBAC. Migration 022 owns transaction/concurrency boundaries;
deterministic private Storage paths make file steps safe to retry.

Workplan 10-D replaces the former no-op with an immutable generated-v1 alignment
gate owned by ``services.contract_alignment`` and migration 027.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import math
import os
import re
import threading
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

os.environ.setdefault("DYLD_FALLBACK_LIBRARY_PATH", "/opt/homebrew/lib")

from jinja2 import Environment, FileSystemLoader, select_autoescape
from pypdf import PdfReader, PdfWriter
from weasyprint import HTML

from core.supabase_client import get_supabase
from services.maker_checker import MakerCheckerError, initiate_action
from services.stage_engine import (
    DealError,
    MAIN_LINE,
    _load_deal_for_transition,
    _participant_role,
    request_transition,
)

logger = logging.getLogger(__name__)
BUCKET = "contracts"
SIGNED_URL_TTL_SECONDS = 300
MAX_WET_PDF_BYTES = 10 * 1024 * 1024
TEMPLATES = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)
_CONTRACT_LOCK = threading.RLock()


def _serialized(function: Any) -> Any:
    """Protect the singleton Supabase sync client from concurrent thread use.

    Database constraints/RPC row locks still protect separate worker processes;
    this lock owns only the in-process HTTP client and file-rendering boundary.
    """
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        with _CONTRACT_LOCK:
            return function(*args, **kwargs)

    return wrapped


def _audit(client: Any, actor_id: str, action: str, deal_id: str, metadata: dict[str, Any], ip_address: str) -> None:
    client.table("audit_log").insert(
        {
            "actor_id": actor_id,
            "action": action,
            "entity_type": "deal",
            "entity_id": deal_id,
            "metadata": metadata,
            "ip_address": ip_address,
        }
    ).execute()


def _deal(client: Any, deal_id: str, user_id: str) -> tuple[dict[str, Any], str]:
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")
    return deal, role


def _approved_summary(client: Any, deal_id: str, summary_id: str | None = None) -> dict[str, Any]:
    query = client.table("ai_summaries").select("id,structured_terms,status,generated_at").eq("deal_id", deal_id)
    if summary_id:
        query = query.eq("id", summary_id)
    rows = query.eq("status", "approved").order("generated_at", desc=True).limit(1).execute().data
    if not rows:
        raise DealError(409, "An approved terms summary is required before a contract can be generated.")
    return rows[0]


def _pdf(html: str) -> bytes:
    """Render valid PDF bytes and parse them once before they reach Storage."""
    try:
        data = HTML(string=html).write_pdf()
        if not data.startswith(b"%PDF") or len(data) < 1_000:
            raise ValueError("renderer returned incomplete PDF bytes")
        if not PdfReader(io.BytesIO(data)).pages:
            raise ValueError("renderer returned a PDF with no pages")
        return data
    except Exception as exc:
        logger.exception("Contract PDF rendering failed")
        raise DealError(500, "The contract PDF could not be generated. Please try again.") from exc


def phase10_alignment_check(client: Any, deal_id: str, contract_id: str) -> None:
    """Fail closed unless the exact v1 result is clear or overridden."""
    from services.contract_alignment import assert_alignment_ready

    assert_alignment_ready(client, deal_id, contract_id)


def _display_value(value: Any) -> str:
    if value is None:
        return "Not specified"
    if isinstance(value, dict):
        status = value.get("status")
        if status in {"not_discussed", "ambiguous"} and value.get("value") in {None, ""}:
            return "Not discussed" if status == "not_discussed" else "Needs clarification"
        if "value" in value:
            return _display_value(value["value"])
        return "; ".join(f"{str(k).replace('_', ' ').title()}: {_display_value(v)}" for k, v in sorted(value.items()))
    if isinstance(value, list):
        return ", ".join(_display_value(item) for item in value) or "None"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:,}"
    return str(value).strip() or "Not specified"


def _terms_for_template(structured_terms: Any) -> list[dict[str, str]]:
    if not isinstance(structured_terms, dict):
        raise DealError(409, "The approved terms summary is incomplete. Please review it before generating a contract.")
    return [
        {"label": str(key).replace("_", " ").strip().title(), "value": _display_value(value)}
        for key, value in sorted(structured_terms.items())
    ]


def _base_context(client: Any, deal: dict[str, Any], summary: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    profiles = client.table("profiles").select("id,display_name").eq("id", deal["creator_id"]).execute().data
    brands = client.table("brands").select("company_name").eq("id", deal["brand_id"]).limit(1).execute().data
    created = datetime.fromisoformat(str(contract["created_at"]).replace("Z", "+00:00"))
    return {
        "contract_id": contract["id"],
        "version": contract["version"],
        "generated_date": created.astimezone(timezone.utc).strftime("%d %B %Y"),
        "deal_name": deal.get("deal_name") or "Collaboration",
        "currency": deal.get("currency") or "INR",
        "creator_name": profiles[0]["display_name"] if profiles else "Creator",
        "brand_name": brands[0]["company_name"] if brands else "Brand",
        "approved_summary_id": summary["id"],
        "terms": _terms_for_template(summary.get("structured_terms")),
    }


def _draft_path(deal_id: str, contract_id: str) -> str:
    return f"{deal_id}/{contract_id}/draft-v1.pdf"


def _executed_path(deal_id: str, contract_id: str) -> str:
    return f"{deal_id}/{contract_id}/executed-v1.pdf"


def _upload_pdf(client: Any, path: str, data: bytes) -> None:
    client.storage.from_(BUCKET).upload(
        path,
        data,
        file_options={"content-type": "application/pdf", "upsert": "true"},
    )


def _remove_pdf_best_effort(client: Any, path: str | None) -> None:
    if not path:
        return
    try:
        client.storage.from_(BUCKET).remove([path])
    except Exception:
        logger.warning("Could not remove unreferenced contract upload", exc_info=True)


def _rpc_data(client: Any, name: str, params: dict[str, Any]) -> Any:
    return client.rpc(name, params).execute().data


def _friendly_database_error(exc: Exception, *, duplicate_message: str) -> DealError:
    text = str(exc).lower()
    if "contract_alignment_required" in text:
        return DealError(409, "Contract signing is locked until the alignment check is clear or both sides accept every conflict.")
    if "unique" in text or "duplicate" in text or "23505" in text:
        return DealError(409, duplicate_message)
    if "not_awaiting" in text or "required_signatures_missing" in text:
        return DealError(409, "The contract changed while this request was running. Refresh and try again.")
    logger.exception("Contract database operation failed")
    return DealError(500, "The contract could not be updated. Please try again.")


@_serialized
def generate_contract(deal_id: str, user_id: str, ip_address: str) -> dict[str, Any]:
    client = get_supabase()
    deal, _ = _deal(client, deal_id, user_id)
    if deal["stage"] != "approval":
        raise DealError(409, "Contracts can only be generated in Approval.")
    try:
        reservation = _rpc_data(client, "reserve_contract_v1", {"p_deal_id": deal_id, "p_actor_id": user_id})
        contract = reservation["contract"]
        if contract["status"] == "draft":
            summary = _approved_summary(client, deal_id, contract["generated_from_summary_id"])
            context = _base_context(client, deal, summary, contract)
            pdf = _pdf(TEMPLATES.get_template("agreement.html").render(**context, signatures=[], executed=False))
            path = _draft_path(deal_id, contract["id"])
            _upload_pdf(client, path, pdf)
            _rpc_data(
                client,
                "complete_contract_generation_v1",
                {
                    "p_contract_id": contract["id"],
                    "p_actor_id": user_id,
                    "p_storage_path": path,
                    "p_source_sha256": hashlib.sha256(pdf).hexdigest(),
                    "p_ip_address": ip_address,
                },
            )
        return contract_status(deal_id, user_id, reconcile_ip=ip_address)
    except DealError:
        raise
    except Exception as exc:
        if "approved_summary_required" in str(exc):
            raise DealError(409, "An approved terms summary is required before a contract can be generated.") from exc
        logger.exception("Contract generation failed")
        raise DealError(500, "The contract could not be generated. Please try again.") from exc


def _contract_rows(client: Any, deal_id: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    rows = client.table("contracts").select("*").eq("deal_id", deal_id).eq("version", 1).limit(1).execute().data
    if not rows:
        return None, []
    contract = rows[0]
    signatures = (
        client.table("contract_signatures")
        .select("id,contract_id,signer_id,on_behalf_of_brand_id,signature_mode,signature_ref,bypass_reason,physical_doc_path,signed_at,ip_address")
        .eq("contract_id", contract["id"])
        .order("signed_at")
        .execute()
        .data
    )
    return contract, signatures


def _latest_signing_request(client: Any, deal_id: str, contract_id: str) -> dict[str, Any] | None:
    rows = (
        client.table("maker_checker_requests")
        .select("id,status,initiated_by,checker_id,comment,created_at,decided_at,action_payload")
        .eq("deal_id", deal_id)
        .eq("action_type", "contract_signing")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return next((row for row in rows if (row.get("action_payload") or {}).get("contract_id") == contract_id), None)


def _public_state(
    client: Any,
    deal: dict[str, Any],
    user_id: str,
    role: str,
    contract: dict[str, Any] | None,
    signatures: list[dict[str, Any]],
) -> dict[str, Any]:
    from services.contract_alignment import alignment_state

    if not contract:
        return {
            "contract": None,
            "signatures": [],
            "required_signatures": {"creator": "pending", "brand": "pending"},
            "maker_checker": None,
            "alignment": alignment_state(client, deal, role, None),
        }
    ids = {row["signer_id"] for row in signatures}
    request = _latest_signing_request(client, deal["id"], contract["id"])
    if request:
        ids.update({request["initiated_by"], request["checker_id"]})
    profiles = client.table("profiles").select("id,display_name").in_("id", list(ids)).execute().data if ids else []
    names = {row["id"]: row["display_name"] for row in profiles}
    public_signatures = [
        {
            "signer_id": row["signer_id"],
            "signer_name": names.get(row["signer_id"], "Participant"),
            "side": "brand" if row.get("on_behalf_of_brand_id") else "creator",
            "signature_mode": row["signature_mode"],
            "signed_at": row["signed_at"],
            "wet_signed_document": bool(row.get("physical_doc_path")),
        }
        for row in signatures
    ]
    creator_signed = any(row["signer_id"] == deal["creator_id"] and not row.get("on_behalf_of_brand_id") for row in signatures)
    brand_signed = any(row.get("on_behalf_of_brand_id") == deal["brand_id"] for row in signatures)
    public_request = None
    if request:
        public_request = {
            "request_id": request["id"],
            "status": request["status"],
            "maker_id": request["initiated_by"],
            "maker_name": names.get(request["initiated_by"], "Brand maker"),
            "checker_id": request["checker_id"],
            "checker_name": names.get(request["checker_id"], "Brand checker"),
            "comment": request.get("comment") if request["status"] == "rejected" else None,
            "created_at": request["created_at"],
            "decided_at": request.get("decided_at"),
            "can_decide": request["status"] == "pending" and request["checker_id"] == user_id,
        }
    return {
        "contract": {"id": contract["id"], "version": contract["version"], "status": contract["status"], "created_at": contract["created_at"]},
        "signatures": public_signatures,
        "required_signatures": {
            "creator": "signed" if creator_signed else "pending",
            "brand": "signed" if brand_signed else ("held" if public_request and public_request["status"] == "pending" else "pending"),
        },
        "maker_checker": public_request,
        "alignment": alignment_state(client, deal, role, contract),
    }


@_serialized
def contract_status(deal_id: str, user_id: str, *, reconcile_ip: str = "system-retry") -> dict[str, Any]:
    client = get_supabase()
    deal, role = _deal(client, deal_id, user_id)
    contract, signatures = _contract_rows(client, deal_id)
    if contract and contract["status"] in {"awaiting_signatures", "executed"}:
        _finalize_if_ready(client, deal, contract, signatures, user_id, reconcile_ip)
        contract, signatures = _contract_rows(client, deal_id)
    return _public_state(client, deal, user_id, role, contract, signatures)


@_serialized
def signed_url(deal_id: str, user_id: str, ip_address: str) -> dict[str, Any]:
    client = get_supabase()
    _deal(client, deal_id, user_id)
    contract, _ = _contract_rows(client, deal_id)
    if not contract or contract["status"] == "draft" or not contract["storage_path"]:
        raise DealError(404, "No contract PDF is ready yet.")
    result = client.storage.from_(BUCKET).create_signed_url(contract["storage_path"], SIGNED_URL_TTL_SECONDS)
    url = result.get("signedURL") or result.get("signedUrl")
    if not url:
        raise DealError(500, "A secure download link could not be created. Please try again.")
    _audit(client, user_id, "contract_download_link_issued", deal_id, {"contract_id": contract["id"], "expires_in_seconds": SIGNED_URL_TTL_SECONDS}, ip_address)
    return {"url": url, "expires_in": SIGNED_URL_TTL_SECONDS, "status": contract["status"]}


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _positive_number(value: str, *, maximum: float = 2_000) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0 or number > maximum:
        raise ValueError("number outside safe bounds")
    return number


def _safe_svg(svg: str) -> str:
    """Accept only the one-path SVG emitted by the app's SignaturePad."""
    if not 80 <= len(svg.encode("utf-8")) <= 20_000 or "<!" in svg:
        raise DealError(422, "Please draw a simple signature in the signature pad.")
    try:
        root = ElementTree.fromstring(svg)
        if _local_tag(root.tag) != "svg" or len(list(root)) != 1 or set(root.attrib) - {"viewBox", "width", "height"}:
            raise ValueError("unexpected SVG structure")
        child = list(root)[0]
        allowed = {"d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"}
        if _local_tag(child.tag) != "path" or list(child) or set(child.attrib) - allowed:
            raise ValueError("unexpected SVG child")
        width = _positive_number(root.attrib.get("width", "0"))
        height = _positive_number(root.attrib.get("height", "0"))
        vb = [float(part) for part in root.attrib.get("viewBox", "").split()]
        if len(vb) != 4 or any(not math.isfinite(n) for n in vb) or vb[2] <= 0 or vb[3] <= 0 or vb[2] > 2_000 or vb[3] > 2_000:
            raise ValueError("invalid viewBox")
        path_data = child.attrib.get("d", "")
        if not re.fullmatch(r"[ML0-9eE+.,\-\s]+", path_data) or "M" not in path_data or "L" not in path_data:
            raise ValueError("invalid path")
        numbers = [float(n) for n in re.findall(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", path_data)]
        if len(numbers) < 4 or any(not math.isfinite(n) or abs(n) > 4_000 for n in numbers):
            raise ValueError("unsafe path coordinates")
        if child.attrib.get("fill") != "none" or child.attrib.get("stroke", "").lower() != "#1c1b18":
            raise ValueError("unexpected paint")
        stroke_width = _positive_number(child.attrib.get("stroke-width", "0"), maximum=20)
        if child.attrib.get("stroke-linecap") != "round" or child.attrib.get("stroke-linejoin") != "round":
            raise ValueError("unexpected line style")
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb[2]:g} {vb[3]:g}" width="{width:g}" height="{height:g}">'
            f'<path d="{path_data}" fill="none" stroke="#1C1B18" stroke-width="{stroke_width:g}" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        )
    except DealError:
        raise
    except Exception as exc:
        raise DealError(422, "Please draw a simple signature in the signature pad.") from exc


def _encode_snapshot(prefix: str, value: str) -> str:
    return f"{prefix}:{base64.b64encode(value.encode('utf-8')).decode('ascii')}"


def _validate_wet_pdf(client: Any, deal_id: str, contract_id: str, user_id: str, path: str | None) -> tuple[str, bytes]:
    pattern = rf"{re.escape(deal_id)}/{re.escape(contract_id)}/wet-signatures/{re.escape(user_id)}/[0-9a-fA-F-]{{36}}\.pdf"
    if not path or not re.fullmatch(pattern, path):
        raise DealError(422, "Choose the signed PDF from your device and upload it here.")
    try:
        data = client.storage.from_(BUCKET).download(path)
        if not isinstance(data, bytes) or not 1_000 <= len(data) <= MAX_WET_PDF_BYTES or not data.startswith(b"%PDF"):
            raise ValueError("not a valid-size PDF")
        if not PdfReader(io.BytesIO(data)).pages:
            raise ValueError("PDF has no pages")
        return f"print_bypass:sha256:{hashlib.sha256(data).hexdigest()}", data
    except DealError:
        raise
    except Exception as exc:
        logger.info("Rejected invalid wet-sign upload at validated private path", exc_info=True)
        raise DealError(422, "That upload is not a readable PDF. Choose the completed signed PDF and try again.") from exc


def _signature_payload(
    client: Any,
    deal_id: str,
    contract_id: str,
    user_id: str,
    mode: str,
    ip_address: str,
    svg: str | None,
    bypass_reason: str | None,
    physical_doc_path: str | None,
) -> dict[str, Any]:
    if mode == "stored":
        rows = client.table("signatures").select("signature_type,signature_data").eq("profile_id", user_id).eq("is_active", True).limit(1).execute().data
        if not rows:
            raise DealError(409, "No active stored signature was found. Draw a new one instead.")
        signature_type = rows[0]["signature_type"]
        data = str(rows[0]["signature_data"])
        if signature_type == "drawn":
            data = _safe_svg(data)
        elif signature_type == "typed":
            data = data.strip()
            if not 2 <= len(data) <= 100 or any(ord(char) < 32 for char in data):
                raise DealError(422, "Your stored signature needs to be updated before it can be used.")
        else:
            raise DealError(422, "Your stored signature type is not supported.")
        signature_ref = _encode_snapshot(f"stored:{signature_type}", data)
        reason = None
        wet_path = None
    elif mode == "drawn":
        signature_ref = _encode_snapshot("drawn:svg", _safe_svg(svg or ""))
        reason = None
        wet_path = None
    elif mode == "print_bypass":
        reason = (bypass_reason or "").strip()
        if not 3 <= len(reason) <= 500:
            raise DealError(422, "Add a short reason (3–500 characters) for printing and signing.")
        signature_ref, wet_pdf = _validate_wet_pdf(client, deal_id, contract_id, user_id, physical_doc_path)
        digest = signature_ref.removeprefix("print_bypass:sha256:")
        # Copy the user upload into a backend-owned path. Participants have no
        # INSERT/DELETE policy for wet-evidence, so a held signature cannot lose
        # its document before the checker decides.
        wet_path = f"{deal_id}/{contract_id}/wet-evidence/{user_id}-{digest}.pdf"
        _upload_pdf(client, wet_path, wet_pdf)
    else:
        raise DealError(422, "Choose a valid signing method.")
    return {
        "contract_id": contract_id,
        "mode": mode,
        "signature_ref": signature_ref,
        "bypass_reason": reason,
        "physical_doc_path": wet_path,
        "ip_address": ip_address,
        "source_upload_path": physical_doc_path if mode == "print_bypass" else None,
    }


@_serialized
def sign_contract(
    deal_id: str,
    user_id: str,
    mode: str,
    ip_address: str,
    svg: str | None = None,
    bypass_reason: str | None = None,
    physical_doc_path: str | None = None,
) -> dict[str, Any]:
    client = get_supabase()
    deal, role = _deal(client, deal_id, user_id)
    if deal["stage"] != "approval":
        raise DealError(409, "This contract is no longer awaiting signatures.")
    if role == "brand_checker":
        raise DealError(403, "Checkers approve a maker's signing request; they do not sign for the brand.")
    if role == "creator" and user_id != deal["creator_id"]:
        raise DealError(403, "Only the creator named on this deal can sign for the creator side.")
    if role not in {"creator", "brand_admin", "brand_maker"}:
        raise DealError(403, "Your role can't sign this contract.")
    contract, signatures = _contract_rows(client, deal_id)
    if not contract or contract["status"] != "awaiting_signatures":
        raise DealError(409, "This contract is not awaiting signatures.")
    if any(row["signer_id"] == user_id for row in signatures):
        raise DealError(409, "You have already signed this contract.")
    if role == "creator" and any(not row.get("on_behalf_of_brand_id") for row in signatures):
        raise DealError(409, "The creator side has already signed this contract.")
    if role in {"brand_admin", "brand_maker"} and any(row.get("on_behalf_of_brand_id") for row in signatures):
        raise DealError(409, "The brand side has already signed this contract.")
    phase10_alignment_check(client, deal_id, contract["id"])
    payload = _signature_payload(client, deal_id, contract["id"], user_id, mode, ip_address, svg, bypass_reason, physical_doc_path)
    if role in {"brand_admin", "brand_maker"}:
        try:
            gate = initiate_action(user_id, deal_id, "contract_signing", ip_address, action_payload=payload)
        except MakerCheckerError as exc:
            _remove_pdf_best_effort(client, payload.get("physical_doc_path") if mode == "print_bypass" else None)
            raise DealError(exc.status_code, exc.detail) from exc
        if gate["status"] == "held":
            return contract_status(deal_id, user_id, reconcile_ip=ip_address)
    try:
        _rpc_data(
            client,
            "apply_contract_signature",
            {
                "p_deal_id": deal_id,
                "p_contract_id": contract["id"],
                "p_signer_id": user_id,
                "p_on_behalf_of_brand_id": deal["brand_id"] if role in {"brand_admin", "brand_maker"} else None,
                "p_signature_mode": mode,
                "p_signature_ref": payload["signature_ref"],
                "p_bypass_reason": payload["bypass_reason"],
                "p_physical_doc_path": payload["physical_doc_path"],
                "p_ip_address": ip_address,
            },
        )
    except Exception as exc:
        _remove_pdf_best_effort(client, payload.get("physical_doc_path") if mode == "print_bypass" else None)
        raise _friendly_database_error(exc, duplicate_message="This side has already signed the contract.") from exc
    return contract_status(deal_id, user_id, reconcile_ip=ip_address)


@_serialized
def decide_held_contract_signature(
    request: dict[str, Any],
    checker_id: str,
    decision: str,
    comment: str | None,
    ip_address: str,
) -> dict[str, Any]:
    client = get_supabase()
    try:
        result = _rpc_data(
            client,
            "decide_contract_signing_request",
            {
                "p_request_id": request["id"],
                "p_checker_id": checker_id,
                "p_decision": decision,
                "p_comment": comment,
                "p_ip_address": ip_address,
            },
        )
    except Exception as exc:
        raise _friendly_database_error(exc, duplicate_message="The brand side has already signed this contract.") from exc
    if result.get("already_decided"):
        raise DealError(409, "This request has already been decided.")
    if decision == "reject":
        _remove_pdf_best_effort(client, result.get("physical_doc_path"))
    if decision == "approve" and result.get("signature_applied"):
        deal = _load_deal_for_transition(client, request["deal_id"])
        contract, signatures = _contract_rows(client, request["deal_id"])
        if contract:
            _finalize_if_ready(client, deal, contract, signatures, request["initiated_by"], ip_address)
    return {"status": result["status"], "request_id": request["id"]}


def _decode_signature_ref(ref: str) -> tuple[str | None, str | None]:
    parts = ref.split(":")
    try:
        if parts[:2] == ["stored", "typed"] and len(parts) == 3:
            return base64.b64decode(parts[2]).decode("utf-8"), None
        if parts[:2] in (["stored", "drawn"], ["drawn", "svg"]) and len(parts) == 3:
            safe = _safe_svg(base64.b64decode(parts[2]).decode("utf-8"))
            return None, f"data:image/svg+xml;base64,{base64.b64encode(safe.encode()).decode('ascii')}"
    except Exception:
        logger.warning("Could not decode stored signature snapshot", exc_info=True)
    return None, None


def _execution_signatures(client: Any, signatures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = [row["signer_id"] for row in signatures]
    profiles = client.table("profiles").select("id,display_name").in_("id", ids).execute().data if ids else []
    names = {row["id"]: row["display_name"] for row in profiles}
    result = []
    for row in signatures:
        typed_text, image_uri = _decode_signature_ref(row["signature_ref"])
        result.append(
            {
                "evidence_id": row["id"],
                "signer_name": names.get(row["signer_id"], "Participant"),
                "side": "Brand" if row.get("on_behalf_of_brand_id") else "Creator",
                "mode": {"stored": "Stored electronic signature", "drawn": "Newly drawn electronic signature", "print_bypass": "Print-and-sign PDF upload"}[row["signature_mode"]],
                "signed_at": datetime.fromisoformat(row["signed_at"].replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
                "typed_text": typed_text,
                "image_uri": image_uri,
                "wet_digest": row["signature_ref"].removeprefix("print_bypass:sha256:") if row["signature_mode"] == "print_bypass" else None,
                "has_wet_document": bool(row.get("physical_doc_path")),
            }
        )
    return result


def _merge_executed_pdf(client: Any, rendered: bytes, signatures: list[dict[str, Any]]) -> bytes:
    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(rendered)).pages:
        writer.add_page(page)
    for signature in signatures:
        path = signature.get("physical_doc_path")
        if path:
            for page in PdfReader(io.BytesIO(client.storage.from_(BUCKET).download(path))).pages:
                writer.add_page(page)
    output = io.BytesIO()
    writer.write(output)
    result = output.getvalue()
    if not result.startswith(b"%PDF") or not PdfReader(io.BytesIO(result)).pages:
        raise DealError(500, "The executed contract PDF could not be generated. Please try again.")
    return result


def _signatures_ready(deal: dict[str, Any], signatures: list[dict[str, Any]]) -> bool:
    creator = sum(row["signer_id"] == deal["creator_id"] and not row.get("on_behalf_of_brand_id") for row in signatures)
    brand = sum(row.get("on_behalf_of_brand_id") == deal["brand_id"] for row in signatures)
    return creator == 1 and brand == 1


def _finalize_if_ready(
    client: Any,
    deal: dict[str, Any],
    contract: dict[str, Any],
    signatures: list[dict[str, Any]],
    actor_id: str,
    ip_address: str,
) -> None:
    if not _signatures_ready(deal, signatures):
        return
    phase10_alignment_check(client, deal["id"], contract["id"])
    if contract["status"] == "awaiting_signatures":
        try:
            summary = _approved_summary(client, deal["id"], contract["generated_from_summary_id"])
            context = _base_context(client, deal, summary, contract)
            evidence = _execution_signatures(client, signatures)
            rendered = _pdf(TEMPLATES.get_template("agreement.html").render(**context, signatures=evidence, executed=True))
            executed_pdf = _merge_executed_pdf(client, rendered, signatures)
            path = _executed_path(deal["id"], contract["id"])
            _upload_pdf(client, path, executed_pdf)
            _rpc_data(
                client,
                "complete_contract_execution",
                {"p_contract_id": contract["id"], "p_actor_id": actor_id, "p_storage_path": path, "p_ip_address": ip_address},
            )
            contract["status"] = "executed"
            contract["storage_path"] = path
        except DealError:
            raise
        except Exception as exc:
            logger.exception("Executed contract generation failed")
            raise DealError(500, "Both signatures are saved, but the executed PDF is still being prepared. Please retry.") from exc
    if contract["status"] != "executed":
        return
    current = _load_deal_for_transition(client, deal["id"])
    if current["stage"] == "approval":
        try:
            request_transition(deal["id"], actor_id, "creating", ip_address, system=True)
        except DealError:
            raced = _load_deal_for_transition(client, deal["id"])
            if raced["stage"] != "creating":
                raise
    elif current["stage"] not in MAIN_LINE[MAIN_LINE.index("creating") :]:
        raise DealError(409, "The contract is executed, but the deal could not advance. Please refresh and retry.")
