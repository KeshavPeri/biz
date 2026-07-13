"""Request authentication for the API.

The frontend calls FastAPI with the user's Supabase access token
(`Authorization: Bearer <jwt>`). We VERIFY it against Supabase Auth and return
the caller's profile id — the server never trusts a client-supplied identity
(docs/rbac.md: the server is the source of truth). Endpoints then enforce RBAC
themselves, because the service_role client bypasses RLS.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.supabase_client import get_supabase

_bearer = HTTPBearer(auto_error=False)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Resolve and return the verified caller's user id, or raise 401."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication.",
        )

    # Authoritative check: ask Supabase Auth to validate the JWT. Adds no secret
    # to our config and rejects tampered/expired tokens.
    try:
        response = get_supabase().auth.get_user(credentials.credentials)
    except Exception as exc:  # network / malformed token
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify your session.",
        ) from exc

    if response is None or response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )
    return response.user.id
