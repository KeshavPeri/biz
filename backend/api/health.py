from fastapi import APIRouter

from core.config import settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "env": settings.APP_ENV}
