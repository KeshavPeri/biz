"""An unhandled server error must reach the browser as a readable, CORS-enabled 500.

Without this, Starlette's bare 500 has no CORS headers, the cross-origin Expo web
app's fetch rejects, and the user sees "Could not reach the server" for what is
really a server bug. Offline: probe routes are added to the real app in-process.

Run: python backend/tests/test_error_cors.py
"""

import logging
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.error_middleware import GENERIC_DETAIL  # noqa: E402
from main import app  # noqa: E402

ORIGIN = "http://192.0.2.10:8081"  # documentation-range IP, not a real device


def check(label: str, condition: bool) -> None:
    print(f"{'PASS' if condition else 'FAIL'} - {label}")
    if not condition:
        raise AssertionError(label)


def _boom() -> dict:
    raise RuntimeError("internal detail that must not reach the client")


def _conflict() -> dict:
    raise HTTPException(status_code=409, detail="Deliberate conflict.")


def _stream() -> StreamingResponse:
    return StreamingResponse(iter([b"part-1;", b"part-2"]), media_type="text/plain")


def main() -> None:
    logging.getLogger("biz.api").disabled = True  # the expected traceback is noise here
    app.add_api_route("/__test/boom", _boom)
    app.add_api_route("/__test/conflict", _conflict)
    app.add_api_route("/__test/stream", _stream)
    # No `with`: the lifespan (live Supabase check) is not needed for these probes.
    client = TestClient(app, raise_server_exceptions=False)

    boom = client.get("/__test/boom", headers={"Origin": ORIGIN})
    check("unhandled error returns 500", boom.status_code == 500)
    check("500 carries CORS headers the browser can read", boom.headers.get("access-control-allow-origin") == "*")
    check("500 body is the generic JSON detail", boom.json() == {"detail": GENERIC_DETAIL})
    check("internal exception text is not leaked", "internal detail" not in boom.text)

    conflict = client.get("/__test/conflict", headers={"Origin": ORIGIN})
    check("HTTPException status is unchanged", conflict.status_code == 409)
    check("HTTPException detail is unchanged", conflict.json() == {"detail": "Deliberate conflict."})
    check("HTTPException keeps CORS headers", conflict.headers.get("access-control-allow-origin") == "*")

    stream = client.get("/__test/stream", headers={"Origin": ORIGIN})
    check("streamed responses pass through intact", stream.status_code == 200 and stream.text == "part-1;part-2")

    preflight = client.options(
        "/__test/boom",
        headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"},
    )
    check("CORS preflight still answered", preflight.status_code == 200)

    print("RESULT: 9/9 error-CORS checks passed")


if __name__ == "__main__":
    main()
