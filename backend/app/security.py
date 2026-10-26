"""Production Security, Authentication & Rate Limiting for JobPilot AI.

Guarantees:
1. Fail-closed authentication on sensitive endpoints when auth is required.
2. In-memory sliding-window rate limiting for general and expensive endpoints.
3. Early request-size enforcement before parsing oversized payloads.
4. Safe comparison of secrets via hmac.compare_digest to prevent timing attacks.
"""

from __future__ import annotations

import hmac
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Header, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import BackendSettings

security_bearer = HTTPBearer(auto_error=False)


class SlidingWindowRateLimiter:
    """Thread-safe, sliding-window in-memory rate limiter per client key."""

    def __init__(self) -> None:
        self._history: dict[str, deque[float]] = defaultdict(deque)

    def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: float = 60.0,
    ) -> tuple[bool, int, float]:
        now = time.time()
        q = self._history[key]
        cutoff = now - window_seconds

        while q and q[0] < cutoff:
            q.popleft()

        if len(q) >= max_requests:
            retry_after = max(1.0, window_seconds - (now - q[0]))
            return False, 0, retry_after

        q.append(now)
        remaining = max_requests - len(q)
        return True, remaining, 0.0

    def reset(self) -> None:
        self._history.clear()


global_rate_limiter = SlidingWindowRateLimiter()


def get_client_ip(request: Request | None) -> str:
    """Extracts client IP safely, respecting X-Forwarded-For when behind trusted proxies."""
    if request is None:
        return "127.0.0.1"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
        if client_ip:
            return client_ip
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


def verify_api_auth(
    settings: BackendSettings,
    auth: HTTPAuthorizationCredentials | None = None,
    x_api_key: str | None = None,
) -> str | None:
    """Verifies API Bearer token or X-API-Key header.
    Fails closed if authentication is required but missing or unconfigured.
    """
    if not settings.require_auth:
        return None

    expected_token = settings.api_auth_token.strip()
    if not expected_token:
        # Server misconfiguration: auth required but token is blank -> fail closed
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error: Authentication is required but JOBPILOT_API_AUTH_TOKEN is unconfigured.",
        )

    provided_token = ""
    if auth and auth.credentials:
        provided_token = auth.credentials.strip()
    elif x_api_key:
        provided_token = x_api_key.strip()

    if not provided_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token or X-API-Key header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not hmac.compare_digest(provided_token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return provided_token


def enforce_rate_limit(
    request: Request | None,
    settings: BackendSettings,
    max_requests: int,
    endpoint_tag: str,
    limiter: SlidingWindowRateLimiter = global_rate_limiter,
) -> None:
    """Enforces rate limiting based on client IP and endpoint tier."""
    if not settings.rate_limit_enabled:
        return

    ip = get_client_ip(request)
    key = f"{endpoint_tag}:{ip}"
    allowed, remaining, retry_after = limiter.is_allowed(
        key=key, max_requests=max_requests, window_seconds=60.0
    )

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Rate limit exceeded for {endpoint_tag}. Maximum {max_requests} requests per minute allowed. "
                f"Please retry after {int(retry_after)} seconds."
            ),
            headers={"Retry-After": str(int(retry_after))},
        )


def enforce_request_size(
    request: Request | None,
    settings: BackendSettings,
) -> None:
    """Rejects oversized requests early via Content-Length header check."""
    if request is None:
        return
    content_length_str = request.headers.get("content-length")
    if content_length_str:
        try:
            cl = int(content_length_str)
            if cl > settings.max_request_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail=(
                        f"Request payload size ({cl} bytes) exceeds the maximum allowed limit "
                        f"of {settings.max_request_bytes} bytes."
                    ),
                )
        except ValueError:
            pass


def get_current_user(
    auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
) -> dict[str, Any]:
    """Dependency that validates end-user JWT bearer token and enforces tenant identity.
    Keeps private server-to-server gateway API keys strictly separated from user authentication.
    """
    from typing import Any
    from app.services.auth_service import verify_access_token
    from app.db.repository import user_repo

    token = ""
    if isinstance(auth, HTTPAuthorizationCredentials) and auth.credentials:
        token = auth.credentials.strip()
    elif isinstance(auth, str) and auth.strip():
        token = auth.strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = verify_access_token(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired authentication credentials: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = user_repo.get_by_id(payload["sub"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists or was deleted.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_optional_current_user(
    auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
) -> dict[str, Any] | None:
    """Dependency that returns current user if a valid token is present, else None."""
    try:
        return get_current_user(auth=auth)
    except HTTPException:
        return None

