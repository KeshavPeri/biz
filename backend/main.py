from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import chat_attachments, deals, health, maker_checker, ops
from core.error_middleware import UnhandledErrorMiddleware
from core.supabase_client import get_supabase


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_supabase()  # fail fast at boot if Supabase config/keys are bad
    yield


app = FastAPI(title="Biz API", lifespan=lifespan)

# Added before CORS so CORS wraps it (last added = outermost): an unhandled
# error then becomes a readable 500 *with* CORS headers, instead of a bare 500
# the browser reports as a network failure.
app.add_middleware(UnhandledErrorMiddleware)

# Local dev only (Expo web/native -> localhost:8000); tighten in Phase 14.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(maker_checker.router)
app.include_router(deals.router)
app.include_router(chat_attachments.router)
app.include_router(ops.router)
