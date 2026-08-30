"""Request authentication for the API.

The frontend calls FastAPI with the user's Supabase access token
(`Authorization: Bearer <jwt>`). We VERIFY it against Supabase Auth and return
the caller's profile id — the server never trusts a client-supplied identity
(docs/rbac.md: the server is the source of truth). Endpoints then enforce RBAC
themselves, because the service_role client bypasses RLS.
"""

import httpx

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import settings

_bearer = HTTPBearer(auto_error=False)
_auth_http = httpx.Client(
    base_url=settings.SUPABASE_URL,
    headers={"apikey": settings.SUPABASE_SERVICE_ROLE_KEY},
    timeout=10,
)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Resolve and return the verified caller's user id, or raise 401."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication.",
        )

    # Authoritative check: ask Supabase Auth to validate the JWT. The dedicated
    # HTTP pool is thread-safe and carries each bearer token only on its request;
    # unlike GoTrue's stateful client it cannot swap sessions under concurrency.
    try:
        response = _auth_http.get(
            "/auth/v1/user",
            headers={"Authorization": f"Bearer {credentials.credentials}"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify your session.",
        ) from exc

    if response.status_code in {401, 403}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )
    try:
        response.raise_for_status()
        user_id = response.json().get("id")
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify your session.",
        ) from exc
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )
    return user_id
