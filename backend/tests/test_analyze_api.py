"""Unit and API tests for the JobPilot AI FastAPI backend (Phase F).

Tests cover:
- Health endpoint & secret non-exposure
- Missing API keys & honest reporting of unconfigured providers
- Invalid image types, corrupt magic bytes, and oversized files (400 / 413)
- Empty inputs & invalid URL validation (422)
- Deterministic text extraction returning null for unknown fields & tracking provenance
- Public webpage JSON-LD extraction & respect for 403 / CAPTCHA walls
- Vision AI provider extraction, timeouts, and malformed JSON handling
- Web search research verification (Verified Facts, Conflicting Information, Unverified Claims)
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from pydantic import ValidationError

from app.config import BackendSettings, load_settings
from app.main import create_app
from app.schemas import ExtractedJobFields, JobAnalyzeRequest
from app.services.extractor import (
    ProviderExtractionError,
    call_vision_ai_provider,
    fetch_public_job_webpage,
)
from app.services.researcher import (
    DDGSException,
    DDGSTimeoutException,
    DuckDuckGoSearchProvider,
    RatelimitException,
    RawSearchResult,
    SearchProviderError,
    WebSearchProvider,
    conduct_web_research,
    create_search_provider,
)

# Minimal valid 1x1 PNG bytes
VALID_1X1_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
VALID_1X1_PNG_B64 = base64.b64encode(VALID_1X1_PNG_BYTES).decode("ascii")


@dataclass
class DirectResponse:
    status_code: int
    _data: dict[str, Any]

    def json(self) -> dict[str, Any]:
        return self._data

    @property
    def text(self) -> str:
        return json.dumps(self._data)


class DirectFastAPIClient:
    """Synchronous route client that executes FastAPI APIRoutes and Pydantic validation
    without creating Windows ProactorEventLoop loopback socketpairs inside the sandbox.
    """

    def __init__(self, app: FastAPI, settings: BackendSettings) -> None:
        self.app = app
        self.settings = settings
        self._routes: dict[tuple[str, str], APIRoute] = {}
        for r in app.routes:
            if isinstance(r, APIRoute):
                for m in r.methods:
                    self._routes[(m.upper(), r.path)] = r

    def get(self, path: str) -> DirectResponse:
        route = self._routes[("GET", path)]
        res = route.endpoint(settings=self.settings)
        return DirectResponse(200, res.model_dump())

    def post(self, path: str, json: dict[str, Any]) -> DirectResponse:
        route = self._routes[("POST", path)]
        try:
            payload = JobAnalyzeRequest.model_validate(json)
            res = route.endpoint(payload=payload, settings=self.settings)
            return DirectResponse(200, res.model_dump())
        except ValidationError as exc:
            return DirectResponse(422, {"detail": exc.errors()})
        except HTTPException as exc:
            return DirectResponse(exc.status_code, {"detail": exc.detail})


def make_test_client(settings: BackendSettings | None = None) -> DirectFastAPIClient:
    cfg = settings or BackendSettings()
    app = create_app(settings_provider=lambda: cfg)
    return DirectFastAPIClient(app, cfg)


def test_health_endpoint_does_not_expose_keys() -> None:
    settings = BackendSettings(
        ai_provider="gemini",
        gemini_api_key="secret-gemini-key-12345",
        search_provider="tavily",
        tavily_api_key="secret-tavily-key-67890",
    )
    client = make_test_client(settings)
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["vision_ai_configured"] is True
    assert data["web_search_configured"] is True
    raw_body = resp.text
    assert "secret-gemini-key-12345" not in raw_body
    assert "secret-tavily-key-67890" not in raw_body


def test_analyze_rejects_empty_input() -> None:
    client = make_test_client()
    resp = client.post(
        "/api/v1/jobs/analyze",
        json={"source": "LinkedIn", "description": "   ", "application_url": ""},
    )
    assert resp.status_code == 422
    assert "At least one job input is required" in str(resp.json()["detail"])


def test_analyze_rejects_invalid_image_content_type() -> None:
    client = make_test_client()
    resp = client.post(
        "/api/v1/jobs/analyze",
        json={
            "source": "Other",
            "screenshot": {
                "filename": "resume.pdf",
                "content_type": "application/pdf",
                "data_base64": VALID_1X1_PNG_B64,
            },
        },
    )
    assert resp.status_code == 400
    assert "Unsupported image content_type" in resp.json()["detail"]


def test_analyze_rejects_non_image_magic_bytes() -> None:
    client = make_test_client()
    fake_bytes = base64.b64encode(b"not a real png file at all").decode("ascii")
    resp = client.post(
        "/api/v1/jobs/analyze",
        json={
            "source": "Other",
            "screenshot": {
                "filename": "fake.png",
                "content_type": "image/png",
                "data_base64": fake_bytes,
            },
        },
    )
    assert resp.status_code == 400
    assert "image header" in resp.json()["detail"]


def test_analyze_rejects_oversized_image() -> None:
    small_limit_settings = BackendSettings(max_image_bytes=32)
    client = make_test_client(small_limit_settings)
    resp = client.post(
        "/api/v1/jobs/analyze",
        json={
            "source": "Other",
            "screenshot": {
                "filename": "large.png",
                "content_type": "image/png",
                "data_base64": VALID_1X1_PNG_B64,
                "size_bytes": len(VALID_1X1_PNG_BYTES),
            },
        },
    )
    assert resp.status_code == 413
    assert "exceeds" in resp.json()["detail"]


def test_deterministic_extraction_returns_null_for_missing_fields() -> None:
    client = make_test_client(
        BackendSettings(ai_provider="none", search_provider="none")
    )
    description = (
        "AcmeCloud Systems is hiring a Senior Backend Python Engineer.\n"
        "Skills required: Python, FastAPI, PostgreSQL, Docker."
    )
    resp = client.post(
        "/api/v1/jobs/analyze",
        json={
            "source": "LinkedIn",
            "description": description,
            "candidate_profile": {
                "full_name": "Aarav Mehta",
                "skills": ["Python", "FastAPI", "PostgreSQL"],
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["analysis_mode"] == "deterministic_only"
    extracted = body["extracted"]
    prov = body["provenance"]

    assert extracted["company"] == "AcmeCloud Systems"
    assert extracted["title"] == "Senior Backend Python Engineer"
    assert "Python" in extracted["required_skills"]
    assert "FastAPI" in extracted["required_skills"]

    # Salary, experience, and location were not mentioned -> MUST be None (null), never fabricated!
    assert extracted["salary"] is None
    assert extracted["experience"] is None
    assert extracted["location"] is None
    assert prov["company"] == "pasted_description"
    assert prov["salary"] == "missing"
    assert prov["location"] == "missing"

    # Web search unconfigured -> honest reporting, never verified
    assert body["web_research"]["verification_status"] == "Search Not Configured"
    assert body["web_research"]["company_verified"] is False
    assert body["web_research"]["recruiter_verified"] is False


def test_missing_api_keys_with_screenshot_reports_honest_warning() -> None:
    client = make_test_client(
        BackendSettings(ai_provider="none", search_provider="none")
    )
    resp = client.post(
        "/api/v1/jobs/analyze",
        json={
            "source": "Other",
            "screenshot": {
                "filename": "job_post.png",
                "content_type": "image/png",
                "data_base64": f"data:image/png;base64,{VALID_1X1_PNG_B64}",
                "size_bytes": len(VALID_1X1_PNG_BYTES),
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert any("no vision AI provider key" in w for w in body["warnings"])
    assert body["extracted"]["title"] is None
    assert body["extracted"]["company"] is None
    assert body["provenance"]["title"] == "missing"


def test_vision_provider_timeout_and_malformed_json_handling() -> None:
    settings = BackendSettings(
        ai_provider="gemini",
        gemini_api_key="test-key",
        http_timeout_seconds=2.0,
    )

    # 1. Simulate TimeoutException
    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Read timed out", request=request)

    timeout_client = httpx.Client(transport=httpx.MockTransport(timeout_handler))
    with pytest.raises(ProviderExtractionError, match="timed out"):
        call_vision_ai_provider(
            settings=settings,
            image_mime="image/png",
            image_bytes=VALID_1X1_PNG_BYTES,
            text_context="",
            client=timeout_client,
        )

    # 2. Simulate malformed JSON from provider
    def malformed_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"text": "{not-valid-json"}]}}
                ]
            },
        )

    malformed_client = httpx.Client(transport=httpx.MockTransport(malformed_handler))
    with pytest.raises(ProviderExtractionError, match="malformed JSON"):
        call_vision_ai_provider(
            settings=settings,
            image_mime="image/png",
            image_bytes=VALID_1X1_PNG_BYTES,
            text_context="",
            client=malformed_client,
        )

    # 3. Simulate valid structured JSON response from Gemini Vision
    def valid_handler(request: httpx.Request) -> httpx.Response:
        payload = {
            "title": "Staff AI Engineer",
            "company": "OrbitAI Labs",
            "location": "Bengaluru",
            "work_mode": "Hybrid",
            "salary": None,
            "experience": "5+ years",
            "required_skills": ["Python", "FastAPI", "TypeScript"],
            "application_url": None,
            "recruiter_name": "Ananya Sharma",
            "recruiter_title": "Lead Recruiter",
            "recruiter_email": "ananya@orbitai.example.com",
            "recruiter_phone": None,
            "summary_description": "Extracted from screenshot.",
        }
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"text": json.dumps(payload)}]}}
                ]
            },
        )

    valid_client = httpx.Client(transport=httpx.MockTransport(valid_handler))
    fields = call_vision_ai_provider(
        settings=settings,
        image_mime="image/png",
        image_bytes=VALID_1X1_PNG_BYTES,
        text_context="",
        client=valid_client,
    )
    assert fields.title == "Staff AI Engineer"
    assert fields.company == "OrbitAI Labs"
    assert fields.salary is None
    assert fields.contact.recruiter_name == "Ananya Sharma"


def test_public_webpage_extraction_and_access_restriction_respect() -> None:
    # 1. Verify 403 Forbidden is respected and not bypassed
    def forbidden_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="Forbidden")

    client_403 = httpx.Client(transport=httpx.MockTransport(forbidden_handler))
    fields_403, note_403 = fetch_public_job_webpage(
        "https://example.com/jobs/1", timeout_seconds=3.0, client=client_403
    )
    assert fields_403 is None
    assert "Access restricted" in note_403

    # 2. Verify CAPTCHA page is skipped
    def captcha_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><body>Please complete the CAPTCHA challenge to verify you are human</body></html>",
        )

    client_captcha = httpx.Client(transport=httpx.MockTransport(captcha_handler))
    fields_cap, note_cap = fetch_public_job_webpage(
        "https://example.com/jobs/2", timeout_seconds=3.0, client=client_captcha
    )
    assert fields_cap is None
    assert "CAPTCHA" in note_cap

    # 3. Verify valid public JSON-LD JobPosting extraction
    def public_job_handler(request: httpx.Request) -> httpx.Response:
        ld_json = json.dumps(
            {
                "@context": "https://schema.org",
                "@type": "JobPosting",
                "title": "Platform Engineer",
                "hiringOrganization": {
                    "@type": "Organization",
                    "name": "ClearData Corp",
                },
                "jobLocation": {
                    "@type": "Place",
                    "address": {
                        "addressLocality": "Hyderabad",
                        "addressCountry": "IN",
                    },
                },
                "description": "<p>Build services with Python, FastAPI, and PostgreSQL. 3 - 5 years experience.</p>",
            }
        )
        html_doc = f'<html><head><script type="application/ld+json">{ld_json}</script></head><body></body></html>'
        return httpx.Response(
            200, headers={"content-type": "text/html"}, text=html_doc
        )

    client_ok = httpx.Client(transport=httpx.MockTransport(public_job_handler))
    fields_ok, _note_ok = fetch_public_job_webpage(
        "https://careers.cleardata.example.com/jobs/99",
        timeout_seconds=3.0,
        client=client_ok,
    )
    assert fields_ok is not None
    assert fields_ok.title == "Platform Engineer"
    assert fields_ok.company == "ClearData Corp"
    assert "Hyderabad" in (fields_ok.location or "")
    assert "Python" in fields_ok.required_skills
    assert "FastAPI" in fields_ok.required_skills


class FakeSearchProvider(WebSearchProvider):
    name = "fake-search"

    def __init__(self, results_by_query: list[RawSearchResult]) -> None:
        self._results = results_by_query

    def search(
        self, query: str, max_results: int = 5, client: httpx.Client | None = None
    ) -> list[RawSearchResult]:
        return self._results


def test_web_research_distinguishes_verified_conflicting_and_unverified() -> None:
    settings = BackendSettings(search_provider="tavily", tavily_api_key="test")
    extracted = ExtractedJobFields(
        title="Senior Full-Stack Engineer",
        company="LinearStack Labs",
        location="Remote",
    )

    # Case A: Corroborating official domain result -> Verified Facts
    verified_provider = FakeSearchProvider(
        [
            RawSearchResult(
                title="Senior Full-Stack Engineer - LinearStack Labs Careers",
                url="https://careers.linearstack.com/jobs/senior-full-stack",
                snippet="LinearStack Labs is hiring a Senior Full-Stack Engineer (Remote) to build Next.js and FastAPI systems.",
            )
        ]
    )
    report_ok = conduct_web_research(
        extracted=extracted, settings=settings, provider_override=verified_provider
    )
    assert report_ok.verification_status == "Verified Facts"
    assert report_ok.company_verified is True

    # Case B: Conflicting location evidence -> Conflicting Information
    conflict_provider = FakeSearchProvider(
        [
            RawSearchResult(
                title="Senior Full-Stack Engineer at LinearStack Labs",
                url="https://careers.linearstack.com/jobs/senior-full-stack",
                snippet="LinearStack Labs Senior Full-Stack Engineer role is On-site only in Mumbai (no remote work permitted).",
            )
        ]
    )
    report_conflict = conduct_web_research(
        extracted=extracted,
        settings=settings,
        provider_override=conflict_provider,
    )
    assert report_conflict.verification_status == "Conflicting Information"

    # Case C: Unrelated results -> Unverified Claims (never falsely verified)
    unverified_provider = FakeSearchProvider(
        [
            RawSearchResult(
                title="General Software Engineering Blog",
                url="https://blog.example.org/post",
                snippet="Tips for software engineering interviews.",
            )
        ]
    )
    report_unverified = conduct_web_research(
        extracted=extracted,
        settings=settings,
        provider_override=unverified_provider,
    )
    assert report_unverified.verification_status == "Unverified Claims"
    assert report_unverified.company_verified is False
    assert report_unverified.recruiter_verified is False


def test_duckduckgo_provider_config_without_api_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("JOBPILOT_SEARCH_PROVIDER", "duckduckgo")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("SERPER_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)

    settings = load_settings()
    assert settings.search_provider == "duckduckgo"
    assert settings.web_search_configured is True
    assert settings.active_search_provider_name == "duckduckgo"

    provider = create_search_provider(settings)
    assert isinstance(provider, DuckDuckGoSearchProvider)
    assert provider.name == "duckduckgo"

    # Also verify 'ddgs' alias works identically
    monkeypatch.setenv("JOBPILOT_SEARCH_PROVIDER", "ddgs")
    alias_settings = load_settings()
    assert alias_settings.search_provider == "duckduckgo"
    assert alias_settings.web_search_configured is True

    # Verify health endpoint reports duckduckgo configured without any API keys
    client = make_test_client(settings)
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    health_data = resp.json()
    assert health_data["web_search_configured"] is True
    assert health_data["search_provider"] == "duckduckgo"


def test_duckduckgo_search_provider_normalized_results() -> None:
    captured_calls: list[dict[str, Any]] = []

    class MockDDGSSuccess:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            self.timeout = timeout

        def __enter__(self) -> "MockDDGSSuccess":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            captured_calls.append({"query": query, **kwargs})
            return [
                {
                    "title": "Senior Full-Stack Engineer - LinearStack Labs Careers",
                    "href": "https://careers.linearstack.com/jobs/senior-full-stack",
                    "body": "LinearStack Labs is hiring a Senior Full-Stack Engineer (Remote) to build Next.js and FastAPI systems.",
                },
                {
                    "title": "LinearStack Labs Talent Acquisition Team",
                    "href": "https://www.linkedin.com/company/linearstack-labs",
                    "body": "Public company profile for LinearStack Labs hiring and talent acquisition.",
                },
            ]

    provider = DuckDuckGoSearchProvider(
        timeout_seconds=8.0,
        ddgs_cls=MockDDGSSuccess,
    )
    results = provider.search("LinearStack Labs Senior Full-Stack Engineer", max_results=4)

    assert len(results) == 2
    assert results[0].title == "Senior Full-Stack Engineer - LinearStack Labs Careers"
    assert results[0].url == "https://careers.linearstack.com/jobs/senior-full-stack"
    assert "LinearStack Labs is hiring" in results[0].snippet
    assert captured_calls[0]["max_results"] == 4
    assert captured_calls[0]["safesearch"] == "moderate"

    # Integrate with conduct_web_research without any API keys
    settings = BackendSettings(search_provider="duckduckgo")
    extracted = ExtractedJobFields(
        title="Senior Full-Stack Engineer",
        company="LinearStack Labs",
        location="Remote",
    )
    report = conduct_web_research(
        extracted=extracted,
        settings=settings,
        provider_override=provider,
    )
    assert report.provider_used == "duckduckgo"
    assert report.search_performed is True
    assert report.verification_status == "Verified Facts"
    assert report.company_verified is True


def test_duckduckgo_search_provider_empty_results() -> None:
    # 1. DDGS returns empty list []
    class MockDDGSEmptyList:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "MockDDGSEmptyList":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            return []

    provider_empty = DuckDuckGoSearchProvider(ddgs_cls=MockDDGSEmptyList)
    assert provider_empty.search("NonExistentCompanyXYZ123") == []

    # 2. DDGS raises DDGSException("No results found.") when 0 items match
    class MockDDGSNoResultsException:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "MockDDGSNoResultsException":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            raise DDGSException("No results found.")

    provider_no_results_exc = DuckDuckGoSearchProvider(
        ddgs_cls=MockDDGSNoResultsException
    )
    assert provider_no_results_exc.search("NonExistentCompanyXYZ123") == []

    # Verify conduct_web_research handles empty results honestly without fabricating verification
    settings = BackendSettings(search_provider="duckduckgo")
    extracted = ExtractedJobFields(
        title="Quantum Compiler Engineer",
        company="StealthUnverifiedOrg",
        location="Bengaluru",
    )
    report = conduct_web_research(
        extracted=extracted,
        settings=settings,
        provider_override=provider_empty,
    )
    assert report.provider_used == "duckduckgo"
    assert report.search_performed is False
    assert report.verification_status == "Unverified Claims"
    assert report.company_verified is False
    assert report.recruiter_verified is False
    assert any("zero matching public results" in lim for lim in report.limitations)


def test_duckduckgo_search_provider_failures_rate_limit_timeout_and_network() -> None:
    # 1. Rate Limit Failure
    class MockDDGSRateLimit:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "MockDDGSRateLimit":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            raise RatelimitException("https://html.duckduckgo.com/html 202 Ratelimit")

    rate_limit_provider = DuckDuckGoSearchProvider(ddgs_cls=MockDDGSRateLimit)
    with pytest.raises(SearchProviderError, match="rate limit exceeded"):
        rate_limit_provider.search("LinearStack Labs")

    # 2. Timeout Failure
    class MockDDGSTimeout:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "MockDDGSTimeout":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            raise DDGSTimeoutException("Request timed out after 5s")

    timeout_provider = DuckDuckGoSearchProvider(
        timeout_seconds=5.0, ddgs_cls=MockDDGSTimeout
    )
    with pytest.raises(SearchProviderError, match="timed out after 5.0s"):
        timeout_provider.search("LinearStack Labs")

    # 3. Network / DNS Failure
    class MockDDGSNetworkError:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "MockDDGSNetworkError":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            raise DDGSException("Client error (Connect): dns error")

    net_error_provider = DuckDuckGoSearchProvider(ddgs_cls=MockDDGSNetworkError)
    with pytest.raises(SearchProviderError, match="DuckDuckGo search error"):
        net_error_provider.search("LinearStack Labs")

    # 4. Verify conduct_web_research reports provider failures honestly without crashing or falsely verifying
    settings = BackendSettings(search_provider="duckduckgo")
    extracted = ExtractedJobFields(
        title="Backend Engineer",
        company="AcmeCloud",
        location="Remote",
    )
    failed_report = conduct_web_research(
        extracted=extracted,
        settings=settings,
        provider_override=rate_limit_provider,
    )
    assert failed_report.provider_used == "duckduckgo"
    assert failed_report.search_performed is False
    assert failed_report.verification_status == "Unverified Claims"
    assert failed_report.company_verified is False
    assert failed_report.recruiter_verified is False
    assert any("rate limit exceeded" in lim for lim in failed_report.limitations)
