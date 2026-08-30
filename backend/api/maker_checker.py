"""Maker-checker HTTP endpoints (task 7.10) — the first real backend feature.

Thin layer over services.maker_checker: authenticate the caller (core.auth),
extract the client IP for the audit trail, delegate to the enforcement logic, and
map rule failures to clean HTTP responses (never a raw trace to the user).
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.auth import get_current_user_id
from services.maker_checker import MakerCheckerError, decide_request, initiate_action

router = APIRouter(prefix="/maker-checker", tags=["maker-checker"])


class InitiateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deal_id: str
    action_type: Literal["payment_release", "contract_signing", "content_approval"]


class DecideBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def strip_comment(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/initiate")
def initiate(
    body: InitiateBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return initiate_action(user_id, body.deal_id, body.action_type, _client_ip(request))
    except MakerCheckerError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/requests/{request_id}/decide")
def decide(
    request_id: str,
    body: DecideBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return decide_request(user_id, request_id, body.decision, body.comment, _client_ip(request))
    except MakerCheckerError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
