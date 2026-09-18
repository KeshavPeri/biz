"""Turn unhandled exceptions into a generic JSON 500 inside the CORS layer.

Starlette handles an unhandled exception in its outermost ServerErrorMiddleware,
which sits outside CORSMiddleware. That 500 therefore has no CORS headers, and a
browser on another origin (the Expo web app) cannot read it: fetch rejects and the
app shows "Could not reach the server", masking a server bug as a network problem.
"""

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("biz.api")

GENERIC_DETAIL = "Something went wrong on our side. Please try again."


class UnhandledErrorMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so streamed responses pass through untouched."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            # Log the method + path only; the traceback never includes headers/tokens.
            logger.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if response_started:
                raise  # Too late for a clean 500; let the server close the connection.
            await JSONResponse({"detail": GENERIC_DETAIL}, status_code=500)(scope, receive, send)
