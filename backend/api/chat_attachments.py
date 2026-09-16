"""Authenticated participant endpoint for private deal-chat attachment links."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user_id
from services.chat_attachment_service import attachment_signed_url
from services.stage_engine import DealError

router = APIRouter(prefix="/deals", tags=["chat-attachments"])


@router.get("/{deal_id}/messages/{message_id}/attachments/{attachment_id}/download")
def download_chat_attachment(
    deal_id: UUID,
    message_id: UUID,
    attachment_id: UUID,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return attachment_signed_url(
            str(deal_id),
            str(message_id),
            str(attachment_id),
            user_id,
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
