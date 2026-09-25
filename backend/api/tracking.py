"""Read-only tracking projections that require server-side canonical access."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user_id
from services.stage_engine import DealError
from services.usage_rights_service import get_usage_rights_snapshot

router = APIRouter(prefix="/tracking", tags=["tracking"])


@router.get("/usage-rights")
def usage_rights(user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return get_usage_rights_snapshot(user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
