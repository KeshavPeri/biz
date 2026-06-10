from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import health
from core.supabase_client import get_supabase


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_supabase()  # fail fast at boot if Supabase config/keys are bad
    yield


app = FastAPI(title="Biz API", lifespan=lifespan)

# Local dev only (Expo web/native -> localhost:8000); tighten in Phase 14.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
