"""Authorized live-post persistence, correction and confirmation boundary."""

from __future__ import annotations

from typing import Any, Callable, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role, request_transition
from services.url_verifier import PreviewEvidence, UrlVerificationError, verify_live_post_url


_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "LIVE_POST_DEAL_NOT_FOUND": (404, "This deal could not be found."),
    "LIVE_POST_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "LIVE_POST_CREATOR_ONLY": (403, "Only the named creator can submit this live post."),
    "LIVE_POST_BRAND_ONLY": (403, "Your role can't review live posts on this deal."),
    "LIVE_POST_DELIVERABLE_NOT_FOUND": (404, "This deliverable could not be found."),
    "LIVE_POST_WRONG_STAGE": (409, "Live-post evidence can't be changed at this deal stage."),
    "LIVE_POST_NOT_APPROVED": (409, "This deliverable must be content-approved before a live link is submitted."),
    "LIVE_POST_NOT_FLAGGED": (409, "Only a link the brand flagged can be replaced in Posted."),
    "LIVE_POST_NOT_FLAGGABLE": (409, "This link is no longer available to flag."),
    "LIVE_POST_STALE_VERSION": (409, "This live-post version changed. Refresh and try again."),
    "LIVE_POST_STALE_SET": (409, "One or more live-post versions changed. Refresh before confirming."),
    "LIVE_POST_INVALID_SET": (422, "Confirm the exact current set of deliverable versions."),
    "LIVE_POST_INVALID_REASON": (422, "Explain the link issue in 3 to 500 characters."),
    "LIVE_POST_BINDING_INVALID": (409, "The live-post state is inconsistent. Nothing was changed."),
    "LIVE_POST_INVALID_EVIDENCE": (422, "The verified preview could not be stored safely."),
    "LIVE_POST_STAGE_RACE": (409, "This deal was just updated by someone else. Refresh and try again."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The live-post update could not be applied safely. Nothing was changed.") from exc


def _current_submission(client: Client, submission_id: str | None) -> dict[str, Any] | None:
    if not submission_id:
        return None
    rows = (
        client.table("live_post_submissions")
        .select(
            "id,deliverable_id,version,submitted_url,final_url,final_host,"
            "preview_title,preview_site_name,preview_description,status,verified_at,"
            "flag_reason,flagged_at,confirmed_at"
        )
        .eq("id", submission_id)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _precheck_submission(
    client: Client,
    deal_id: str,
    deliverable_id: str,
    actor_id: str,
    submitted_url: str,
    expected_version: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, actor_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")
    if role != "creator" or deal["creator_id"] != actor_id:
        raise DealError(403, "Only the named creator can submit this live post.")
    rows = (
        client.table("deliverables")
        .select(
            "id,deal_id,platform,status,content_ops_attention,source_summary_id,"
            "current_live_post_submission_id"
        )
        .eq("id", deliverable_id)
        .eq("deal_id", deal_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows or not rows[0].get("source_summary_id"):
        raise DealError(404, "This deliverable could not be found.")
    deliverable = rows[0]
    current = _current_submission(client, deliverable.get("current_live_post_submission_id"))
    actual_version = current["version"] if current else 0
    if (
        current is not None
        and actual_version == expected_version + 1
        and current["submitted_url"] == submitted_url.strip()
        and current["status"] in {"verified", "confirmed"}
    ):
        return deal, deliverable, current
    if actual_version != expected_version:
        raise DealError(409, "This live-post version changed. Refresh and try again.")
    if deal["stage"] == "creating":
        if current is not None or deliverable["status"] != "approved" or deliverable["content_ops_attention"]:
            raise DealError(409, "This deliverable must be content-approved before a live link is submitted.")
    elif deal["stage"] == "posted":
        if current is None or current["status"] != "flagged" or deliverable["status"] != "posted":
            raise DealError(409, "Only a link the brand flagged can be replaced in Posted.")
    else:
        raise DealError(409, "Live-post evidence can't be changed at this deal stage.")
    return deal, deliverable, None


def _safe_result(current: dict[str, Any], stage: str, *, idempotent: bool) -> dict[str, Any]:
    return {
        "submission_id": current["id"],
        "version": current["version"],
        "verification_status": current["status"],
        "stage": stage,
        "transitioned": False,
        "idempotent": idempotent,
        "evidence": {
            "submitted_url": current["submitted_url"],
            "final_url": current["final_url"],
            "title": current.get("preview_title"),
            "site_name": current.get("preview_site_name"),
            "description": current.get("preview_description"),
            "verified_at": current["verified_at"],
        },
    }


def submit_live_post(
    deal_id: str,
    deliverable_id: str,
    actor_id: str,
    submitted_url: str,
    expected_version: int,
    ip_address: str,
    *,
    verifier: Callable[[str, str], PreviewEvidence] | None = None,
    _client: Client | None = None,
) -> dict[str, Any]:
    """Authorize first, fetch without a DB transaction, then atomically recheck/save."""
    client = _client or get_supabase()
    deal, deliverable, existing = _precheck_submission(
        client, deal_id, deliverable_id, actor_id, submitted_url, expected_version
    )
    if existing is not None:
        return _safe_result(existing, deal["stage"], idempotent=True)
    try:
        evidence = (verifier or verify_live_post_url)(submitted_url, deliverable["platform"])
    except UrlVerificationError as exc:
        status = 503 if exc.retryable else 422
        raise DealError(status, exc.detail) from exc

    result = request_transition(
        deal_id,
        actor_id,
        "posted",
        ip_address,
        params={
            "live_post_request": True,
            "deliverable_id": deliverable_id,
            "expected_version": expected_version,
            "evidence": evidence,
        },
        _client=client,
    )
    verification_status = result.pop("status", "verified")
    return {
        **result,
        "verification_status": verification_status,
        "evidence": {
            "submitted_url": evidence.submitted_url,
            "final_url": evidence.final_url,
            "title": evidence.title,
            "site_name": evidence.site_name,
            "description": evidence.description,
        },
    }


def commit_live_post(ctx: Any) -> dict[str, Any]:
    evidence = ctx.params.get("evidence")
    if not isinstance(evidence, PreviewEvidence):
        raise DealError(422, "Verified live-post evidence is required.")
    try:
        return ctx.client.rpc(
            "submit_verified_live_post",
            {
                "p_deal_id": ctx.deal["id"],
                "p_deliverable_id": ctx.params.get("deliverable_id"),
                "p_actor_id": ctx.user_id,
                "p_expected_version": ctx.params.get("expected_version"),
                "p_submitted_url": evidence.submitted_url,
                "p_final_url": evidence.final_url,
                "p_final_host": evidence.final_host,
                "p_preview_title": evidence.title,
                "p_preview_site_name": evidence.site_name,
                "p_preview_description": evidence.description,
                "p_ip_address": ctx.params.get("ip_address", "unknown"),
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def flag_live_post(
    deal_id: str,
    deliverable_id: str,
    actor_id: str,
    expected_version: int,
    reason: str,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    try:
        return client.rpc(
            "flag_live_post",
            {
                "p_deal_id": deal_id,
                "p_deliverable_id": deliverable_id,
                "p_actor_id": actor_id,
                "p_expected_version": expected_version,
                "p_reason": reason,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def commit_post_confirmation(ctx: Any) -> dict[str, Any]:
    versions = ctx.params.get("versions")
    if not isinstance(versions, list) or not versions:
        raise DealError(422, "Confirm the exact current set of deliverable versions.")
    try:
        return ctx.client.rpc(
            "confirm_live_posts",
            {
                "p_deal_id": ctx.deal["id"],
                "p_actor_id": ctx.user_id,
                "p_versions": versions,
                "p_ip_address": ctx.params.get("ip_address", "unknown"),
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def participant_post_state(
    client: Client,
    deal_id: str,
    user_id: str,
    stage: str,
    deliverables: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Attach bounded text-only posting history without private-label joins."""
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")
    ids = [row["id"] for row in deliverables]
    history_rows: list[dict[str, Any]] = []
    if ids:
        history_rows = (
            client.table("live_post_submissions")
            .select(
                "id,deliverable_id,version,submitted_url,final_url,final_host,"
                "preview_title,preview_site_name,preview_description,status,submitted_by,"
                "verified_at,flagged_by,flagged_at,flag_reason,confirmed_by,confirmed_at"
            )
            .in_("deliverable_id", ids)
            .order("version", desc=True)
            .limit(min(2000, max(20, len(ids) * 20)))
            .execute()
            .data
        )
    actor_ids = {
        actor_id
        for item in history_rows
        for actor_id in (item.get("submitted_by"), item.get("flagged_by"), item.get("confirmed_by"))
        if actor_id
    }
    names: dict[str, str] = {}
    if actor_ids:
        profiles = client.table("profiles").select("id,display_name").in_("id", list(actor_ids)).execute().data
        names = {row["id"]: row["display_name"] for row in profiles}

    by_deliverable: dict[str, list[dict[str, Any]]] = {deliverable_id: [] for deliverable_id in ids}
    for item in history_rows:
        history = by_deliverable.get(item["deliverable_id"])
        if history is None or len(history) >= 20:
            continue
        history.append(
            {
                "id": item["id"],
                "version": item["version"],
                "submitted_url": item["submitted_url"],
                "final_url": item["final_url"],
                "host": item["final_host"],
                "title": item.get("preview_title"),
                "site_name": item.get("preview_site_name"),
                "description": item.get("preview_description"),
                "verification_status": item["status"],
                "submitted_by_name": names.get(item["submitted_by"], "Creator"),
                "verified_at": item["verified_at"],
                "flag_reason": item.get("flag_reason"),
                "flagged_by_name": names.get(item.get("flagged_by")) if item.get("flagged_by") else None,
                "flagged_at": item.get("flagged_at"),
                "confirmed_by_name": names.get(item.get("confirmed_by")) if item.get("confirmed_by") else None,
                "confirmed_at": item.get("confirmed_at"),
            }
        )

    active_brand_actor = False
    if role in {"brand_admin", "brand_maker"}:
        deal = _load_deal_for_transition(client, deal_id)
        active_brand_actor = bool(
            client.table("brand_members")
            .select("profile_id")
            .eq("brand_id", deal["brand_id"])
            .eq("profile_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )

    expected_versions: list[dict[str, Any]] = []
    all_verified = bool(deliverables)
    enriched: list[dict[str, Any]] = []
    for deliverable in deliverables:
        history = by_deliverable[deliverable["id"]]
        current = history[0] if history else None
        if current is not None:
            expected_versions.append({"deliverable_id": deliverable["id"], "version": current["version"]})
        all_verified = all_verified and current is not None and current["verification_status"] == "verified"
        can_submit_future = (
            role == "creator"
            and (
                (stage == "creating" and deliverable["status"] == "approved" and current is None)
                or (stage == "posted" and current is not None and current["verification_status"] == "flagged")
            )
        )
        can_flag_future = (
            active_brand_actor
            and stage == "posted"
            and current is not None
            and current["verification_status"] == "verified"
        )
        enriched.append(
            {
                **deliverable,
                "post_state": {
                    "current": current,
                    "history": history,
                    "history_truncated": len(history) == 20,
                    "verification_scope": "public_https" if deliverable["platform"] == "podcast" else "platform_domain",
                    "future_actions": {
                        "can_submit_or_replace": can_submit_future,
                        "can_flag": can_flag_future,
                    },
                },
            }
        )
    return enriched, {
        "expected_versions": expected_versions,
        "future_actions": {
            "can_confirm_all": active_brand_actor and stage == "posted" and all_verified
        },
    }
