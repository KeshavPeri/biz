"""Deal endpoints (Phase 8 Cluster C — B2-004 connect).

Thin layer over services.deals: authenticate the caller (core.auth), extract the
client IP, delegate to the connect logic, and map rule failures to clean HTTP
responses (never a raw trace). Mirrors api/maker_checker.py.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.auth import get_current_user_id
from services.deals import DealError, connect_deal

router = APIRouter(prefix="/deals", tags=["deals"])


class ConnectBody(BaseModel):
    target_type: Literal["creator", "brand"]
    target_id: str


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/connect")
def connect(
    body: ConnectBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return connect_deal(user_id, body.target_type, body.target_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
