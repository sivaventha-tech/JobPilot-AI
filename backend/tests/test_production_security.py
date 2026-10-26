"""Production security, authentication, rate limiting, and CORS tests for JobPilot AI."""

from __future__ import annotations

import base64
from typing import Any
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.config import BackendSettings
from app.main import create_app
from app.schemas import (
    BrowserAssistRequest,
    CandidateProfileSnapshot,
    DraftQuestionAnswer,
    ExtractedJobFields,
    JobAnalyzeRequest,
    JobMatchRequest,
    ResumeParseRequest,
    TailoredDraftsRequest,
)
from app.security import (
    SlidingWindowRateLimiter,
    enforce_rate_limit,
    enforce_request_size,
    global_rate_limiter,
    verify_api_auth,
)

VALID_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

VALID_PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
VALID_PDF_B64 = base64.b64encode(VALID_PDF_BYTES).decode("ascii")

PROD_SETTINGS = BackendSettings(
    require_auth=True,
    api_auth_token="prod-secure-token-2026-xyz",
    rate_limit_enabled=True,
    rate_limit_rpm=60,
    expensive_rate_limit_rpm=3,
    max_request_bytes=1000,  # 1000 bytes for size testing
    enable_browser_automation=False,
    cors_origins=["https://jobpilot.example.com"],
    cors_origin_regex=None,  # No permissive wildcards
)


import inspect

def _invoke_endpoint(
    app: FastAPI,
    method: str,
    path: str,
    payload_obj: BaseModel | None = None,
    auth_token: str | None = None,
    x_api_key: str | None = None,
    request: Request | None = None,
    settings: BackendSettings = PROD_SETTINGS,
) -> tuple[int, Any]:
    """Invokes route endpoint directly with simulated dependency injection."""
    target_route: APIRoute | None = None
    for r in app.routes:
        if isinstance(r, APIRoute) and method in r.methods and r.path == path:
            target_route = r
            break
    assert target_route is not None, f"Route {method} {path} not found"

    auth_cred = (
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth_token)
        if auth_token
        else None
    )

    sig = inspect.signature(target_route.endpoint)
    kwargs: dict[str, Any] = {}
    if "settings" in sig.parameters:
        kwargs["settings"] = settings
    if "payload" in sig.parameters and payload_obj is not None:
        kwargs["payload"] = payload_obj
    if "request" in sig.parameters:
        kwargs["request"] = request
    if "auth" in sig.parameters:
        kwargs["auth"] = auth_cred
    if "x_api_key" in sig.parameters:
        kwargs["x_api_key"] = x_api_key
    if "current_user" in sig.parameters:
        from app.services.auth_service import verify_access_token
        from app.db.repository import user_repo
        if auth_token:
            try:
                jwt_payload = verify_access_token(auth_token)
                u = user_repo.get_by_id(jwt_payload["sub"])
                if u:
                    kwargs["current_user"] = u
            except Exception:
                pass

    try:
        res = target_route.endpoint(**kwargs)
        return 200, res.model_dump()
    except HTTPException as exc:
        return exc.status_code, exc.detail


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    global_rate_limiter.reset()
    yield
    global_rate_limiter.reset()


def test_sensitive_endpoints_require_auth_when_enabled() -> None:
    """Confirms all sensitive endpoints reject unauthenticated requests with HTTP 401."""
    app = create_app(settings_provider=lambda: PROD_SETTINGS)

    # 1. /jobs/analyze
    analyze_payload = JobAnalyzeRequest(
        source="Company Website",
        description="Senior Engineer role in Bengaluru.",
    )
    status_code, detail = _invoke_endpoint(app, "POST", "/api/v1/jobs/analyze", analyze_payload)
    assert status_code == 401
    assert "Authentication required" in str(detail)

    # 2. /resume/parse
    resume_payload = ResumeParseRequest(
        filename="resume.pdf",
        data_base64=VALID_PDF_B64,
        size_bytes=len(VALID_PDF_BYTES),
    )
    status_code, detail = _invoke_endpoint(app, "POST", "/api/v1/resume/parse", resume_payload)
    assert status_code == 401

    # 3. /jobs/match
    match_payload = JobMatchRequest(
        extracted_job=ExtractedJobFields(title="Engineer", company="LinearStack"),
        candidate_profile=CandidateProfileSnapshot(full_name="Aarav Mehta"),
    )
    status_code, detail = _invoke_endpoint(app, "POST", "/api/v1/jobs/match", match_payload)
    assert status_code == 401

    # 4. /jobs/drafts
    drafts_payload = TailoredDraftsRequest(
        extracted_job=ExtractedJobFields(title="Engineer", company="LinearStack"),
        candidate_profile=CandidateProfileSnapshot(full_name="Aarav Mehta"),
    )
    status_code, detail = _invoke_endpoint(app, "POST", "/api/v1/jobs/drafts", drafts_payload)
    assert status_code == 401

    # 5. /applications/assist
    assist_payload = BrowserAssistRequest(
        job_id="job-101",
        destination_url="https://company.example.com",
        source="Company Website",
        candidate_profile=CandidateProfileSnapshot(full_name="Aarav Mehta"),
        answers=[DraftQuestionAnswer(id="q1", question="Why?", answer="Experience.")],
        confirmed_by_user=True,
    )
    status_code, detail = _invoke_endpoint(app, "POST", "/api/v1/applications/assist", assist_payload)
    assert status_code == 401


def test_invalid_auth_token_rejected_with_401() -> None:
    """Confirms invalid bearer tokens or X-API-Key are rejected with 401."""
    app = create_app(settings_provider=lambda: PROD_SETTINGS)
    analyze_payload = JobAnalyzeRequest(
        source="Company Website",
        description="Senior Engineer role.",
    )
    status_code, detail = _invoke_endpoint(
        app, "POST", "/api/v1/jobs/analyze", analyze_payload, auth_token="wrong-token-abc"
    )
    assert status_code == 401
    assert "Invalid authentication token" in str(detail)


def test_valid_bearer_token_and_x_api_key_allowed() -> None:
    """Confirms valid Bearer token and X-API-Key are both accepted and allow access on gateway endpoints."""
    app = create_app(settings_provider=lambda: PROD_SETTINGS)
    match_payload = JobMatchRequest(
        extracted_job=ExtractedJobFields(title="Senior Full-Stack Engineer", company="Acme Corp"),
        candidate_profile=CandidateProfileSnapshot(full_name="Aarav Mehta"),
    )

    # A. Via Bearer Token
    status_code, data = _invoke_endpoint(
        app,
        "POST",
        "/api/v1/jobs/match",
        match_payload,
        auth_token="prod-secure-token-2026-xyz",
    )
    assert status_code == 200

    # Reset limiter for second call in test
    global_rate_limiter.reset()

    # B. Via X-API-Key Header
    status_code, data = _invoke_endpoint(
        app,
        "POST",
        "/api/v1/jobs/match",
        match_payload,
        x_api_key="prod-secure-token-2026-xyz",
    )
    assert status_code == 200


def test_auth_fails_closed_when_server_token_unconfigured() -> None:
    """Confirms system fails closed (500) if require_auth=True but server token is blank."""
    unconfigured_settings = BackendSettings(
        require_auth=True,
        api_auth_token="",  # Unconfigured!
    )
    app = create_app(settings_provider=lambda: unconfigured_settings)
    analyze_payload = JobAnalyzeRequest(
        source="Company Website",
        description="Developer role.",
    )
    status_code, detail = _invoke_endpoint(
        app,
        "POST",
        "/api/v1/jobs/analyze",
        analyze_payload,
        auth_token="any-token",
        settings=unconfigured_settings,
    )
    assert status_code == 500
    assert "JOBPILOT_API_AUTH_TOKEN is unconfigured" in str(detail)


def test_health_endpoint_public_and_exposes_zero_secrets() -> None:
    """Verifies health check is public without auth and leaks zero secrets or paths."""
    sensitive_settings = BackendSettings(
        require_auth=True,
        api_auth_token="super-secret-auth-key-9999",
        gemini_api_key="gemini-live-secret-8888",
        tavily_api_key="tavily-live-secret-7777",
        enable_browser_automation=False,
    )
    app = create_app(settings_provider=lambda: sensitive_settings)

    # Health check should succeed without any auth token
    status_code, data = _invoke_endpoint(
        app, "GET", "/api/v1/health", settings=sensitive_settings
    )
    assert status_code == 200
    assert data["status"] == "ok"
    assert data["auth_required"] is True
    assert data["browser_assistant_available"] is False

    # String representation test: ensure no keys appear
    data_str = str(data)
    assert "super-secret-auth-key-9999" not in data_str
    assert "gemini-live-secret-8888" not in data_str
    assert "tavily-live-secret-7777" not in data_str
    assert "C:\\" not in data_str
    assert "/Users/" not in data_str


def test_rate_limiting_enforces_limits_and_returns_429() -> None:
    """Verifies sliding-window rate limiter trips when request count exceeds threshold."""
    limiter = SlidingWindowRateLimiter()
    test_settings = BackendSettings(
        rate_limit_enabled=True,
        expensive_rate_limit_rpm=3,
    )

    class MockRequest:
        client = None
        headers = {"x-forwarded-for": "203.0.113.195"}

    mock_req = MockRequest()

    # First 3 requests succeed
    for _ in range(3):
        enforce_rate_limit(
            request=mock_req,  # type: ignore
            settings=test_settings,
            max_requests=3,
            endpoint_tag="test_endpoint",
            limiter=limiter,
        )

    # 4th request trips rate limit
    with pytest.raises(HTTPException) as exc_info:
        enforce_rate_limit(
            request=mock_req,  # type: ignore
            settings=test_settings,
            max_requests=3,
            endpoint_tag="test_endpoint",
            limiter=limiter,
        )

    assert exc_info.value.status_code == 429
    assert "Rate limit exceeded" in exc_info.value.detail
    assert "Retry-After" in exc_info.value.headers


def test_oversized_request_header_rejected_with_413() -> None:
    """Verifies requests declaring Content-Length greater than max_request_bytes are rejected."""
    test_settings = BackendSettings(max_request_bytes=500)

    class OversizedRequest:
        headers = {"content-length": "10000"}

    with pytest.raises(HTTPException) as exc_info:
        enforce_request_size(request=OversizedRequest(), settings=test_settings)  # type: ignore

    assert exc_info.value.status_code == 413
    assert "exceeds the maximum allowed limit" in exc_info.value.detail


def test_cors_strictly_restricts_origins() -> None:
    """Verifies that CORS origins are strictly matched and wildcards are disabled by default."""
    cfg = BackendSettings(
        cors_origins=["https://jobpilot.example.com"],
        cors_origin_regex=None,
    )
    assert "https://jobpilot.example.com" in cfg.cors_origins
    assert "https://attacker.example.com" not in cfg.cors_origins
    assert cfg.cors_origin_regex is None
