"""Bearer-authenticated platform-operations dispute endpoints."""

import html

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.auth import get_current_user_id
from services.dispute_service import (
    _contains_phone_contact,
    _contains_private_network,
    _has_control,
)
from services.ops_dispute_service import (
    get_ops_dispute,
    list_ops_disputes,
    resolve_ops_dispute,
)
from services.stage_engine import DealError


router = APIRouter(prefix="/ops", tags=["operations"])


class ResolveDisputeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["resume_payment"]
    resolution_note: str = Field(min_length=10, max_length=1000)
    request_id: UUID

    @field_validator("resolution_note")
    @classmethod
    def validate_resolution_note(cls, value: str) -> str:
        value = value.strip()
        decoded = html.unescape(value)
        if (
            not 10 <= len(value) <= 1000
            or _has_control(decoded)
            or "<" in decoded
            or ">" in decoded
            or _contains_private_network(decoded)
            or _contains_phone_contact(decoded)
        ):
            raise ValueError("resolution_note must be plain text without links or contact details")
        return value


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/disputes")
def dispute_queue(
    status: Literal["open"] = "open",
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None, max_length=512),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return list_ops_disputes(user_id, status=status, limit=limit, cursor=cursor)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/disputes/{dispute_id}")
def dispute_detail(
    dispute_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_ops_dispute(dispute_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/disputes/{dispute_id}/resolve")
def resolve_dispute(
    dispute_id: str,
    body: ResolveDisputeBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return resolve_ops_dispute(
            dispute_id,
            user_id,
            body.outcome,
            body.resolution_note,
            str(body.request_id),
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
