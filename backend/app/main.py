"""FastAPI application for JobPilot AI.

Endpoints:
- GET  /api/v1/health
- POST /api/v1/jobs/analyze
- POST /api/v1/resume/parse (and /api/v1/resume/upload alias)
- POST /api/v1/jobs/match
- POST /api/v1/jobs/drafts
"""

from __future__ import annotations

import logging
from typing import Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials

from app.config import BackendSettings, load_settings
from app.security import (
    enforce_rate_limit,
    enforce_request_size,
    security_bearer,
    verify_api_auth,
)
from app.schemas import (
    ExtractedJobFields,
    HealthResponse,
    JobAnalyzeRequest,
    JobAnalyzeResponse,
    JobMatchRequest,
    ResumeParseRequest,
    ResumeParseResponse,
    SkillMatchEvaluation,
    TailoredDraftsRequest,
    TailoredDraftsResponse,
    BrowserAssistRequest,
    BrowserAssistResponse,
)
from app.services.browser_assistant import execute_browser_assisted_application
from app.services.drafter import generate_tailored_application_drafts
from app.services.extractor import (
    ImageValidationError,
    ProviderExtractionError,
    call_vision_ai_provider,
    fetch_public_job_webpage,
    merge_extractions_with_provenance,
    parse_job_text_deterministically,
    validate_and_decode_screenshot,
)
from app.services.matcher import evaluate_explainable_job_match
from app.services.researcher import conduct_web_research
from app.services.resume_parser import (
    ResumeValidationError,
    is_pdf_parser_available,
    parse_resume_pdf_bytes,
    validate_and_decode_pdf,
)

logger = logging.getLogger("jobpilot.api")


def create_app(settings_provider: Callable[[], BackendSettings] = load_settings) -> FastAPI:
    initial_settings = settings_provider()

    app = FastAPI(
        title="JobPilot AI Backend API",
        version="0.2.0",
        description=(
            "Human-in-the-loop Job Screenshot Analysis, Public Webpage Metadata Extraction, "
            "and Evidence-Based Web Research API."
        ),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=initial_settings.cors_origins,
        allow_origin_regex=initial_settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health", response_model=HealthResponse, tags=["System"])
    def get_health(
        settings: BackendSettings = Depends(settings_provider),
    ) -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="jobpilot-ai-fastapi",
            version="0.4.0",
            auth_required=settings.require_auth,
            rate_limiting_enabled=settings.rate_limit_enabled,
            vision_ai_configured=settings.vision_ai_configured,
            ai_provider=settings.active_ai_provider_name,
            web_search_configured=settings.web_search_configured,
            search_provider=settings.active_search_provider_name,
            pdf_parser_available=is_pdf_parser_available(),
            browser_assistant_available=settings.enable_browser_automation,
            max_image_bytes=settings.max_image_bytes,
            max_resume_bytes=settings.max_resume_bytes,
            http_timeout_seconds=settings.http_timeout_seconds,
            assist_timeout_seconds=settings.assist_timeout_seconds,
        )

    @app.post(
        "/api/v1/resume/parse",
        response_model=ResumeParseResponse,
        tags=["Resume Parsing"],
    )
    @app.post(
        "/api/v1/resume/upload",
        response_model=ResumeParseResponse,
        tags=["Resume Parsing"],
    )
    def parse_resume(
        payload: ResumeParseRequest,
        request: Request = None,
        auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
        settings: BackendSettings = Depends(settings_provider),
    ) -> ResumeParseResponse:
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.expensive_rate_limit_rpm,
            endpoint_tag="resume_parse",
        )
        try:
            pdf_bytes = validate_and_decode_pdf(
                filename=payload.filename,
                content_type=payload.content_type,
                data_base64=payload.data_base64,
                max_bytes=settings.max_resume_bytes,
                declared_size=payload.size_bytes,
            )
            return parse_resume_pdf_bytes(pdf_bytes)
        except ResumeValidationError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=str(exc),
            ) from exc

    @app.post(
        "/api/v1/jobs/match",
        response_model=SkillMatchEvaluation,
        tags=["Job Matching"],
    )
    def match_job(
        payload: JobMatchRequest,
        request: Request = None,
        auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
        settings: BackendSettings = Depends(settings_provider),
    ) -> SkillMatchEvaluation:
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.rate_limit_rpm,
            endpoint_tag="job_match",
        )
        return evaluate_explainable_job_match(
            extracted=payload.extracted_job,
            candidate=payload.candidate_profile,
            settings=settings,
            weights_override=payload.weights_override,
        )

    @app.post(
        "/api/v1/jobs/drafts",
        response_model=TailoredDraftsResponse,
        tags=["Application Drafts"],
    )
    def generate_drafts(
        payload: TailoredDraftsRequest,
        request: Request = None,
        auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
        settings: BackendSettings = Depends(settings_provider),
    ) -> TailoredDraftsResponse:
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.rate_limit_rpm,
            endpoint_tag="job_drafts",
        )
        return generate_tailored_application_drafts(
            extracted_job=payload.extracted_job,
            candidate_profile=payload.candidate_profile,
            custom_questions=payload.custom_questions,
        )

    @app.post(
        "/api/v1/jobs/analyze",
        response_model=JobAnalyzeResponse,
        tags=["Job Analysis"],
    )
    def analyze_job(
        payload: JobAnalyzeRequest,
        request: Request = None,
        auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
        settings: BackendSettings = Depends(settings_provider),
    ) -> JobAnalyzeResponse:
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.expensive_rate_limit_rpm,
            endpoint_tag="job_analyze",
        )
        has_screenshot = payload.screenshot is not None
        has_description = bool(payload.description and payload.description.strip())
        has_url = bool(payload.application_url and payload.application_url.strip())

        if not (has_screenshot or has_description or has_url):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "At least one job input is required: provide a screenshot image, "
                    "a pasted job description, or a valid http/https job posting URL."
                ),
            )

        warnings: list[str] = []
        image_mime: str | None = None
        image_bytes: bytes | None = None

        # 1. Validate & decode screenshot if provided
        if payload.screenshot is not None:
            if (
                payload.screenshot.size_bytes is not None
                and payload.screenshot.size_bytes > settings.max_image_bytes
            ):
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail=(
                        f"Screenshot size ({payload.screenshot.size_bytes} bytes) exceeds "
                        f"maximum allowed limit of {settings.max_image_bytes} bytes."
                    ),
                )
            try:
                image_mime, image_bytes = validate_and_decode_screenshot(
                    content_type=payload.screenshot.content_type,
                    data_base64=payload.screenshot.data_base64,
                    max_bytes=settings.max_image_bytes,
                )
            except ImageValidationError as exc:
                msg = str(exc)
                code = (
                    status.HTTP_413_CONTENT_TOO_LARGE
                    if "exceeds limit" in msg
                    else status.HTTP_400_BAD_REQUEST
                )
                raise HTTPException(status_code=code, detail=msg) from exc

        # 2. Fetch public job webpage metadata if a URL was supplied
        webpage_fields: ExtractedJobFields | None = None
        webpage_fetched = False
        webpage_note: str | None = None
        if has_url and payload.application_url:
            webpage_fields, webpage_note = fetch_public_job_webpage(
                url=payload.application_url,
                timeout_seconds=settings.http_timeout_seconds,
            )
            webpage_fetched = webpage_fields is not None
            if not webpage_fetched and webpage_note:
                warnings.append(f"Public webpage fetch note: {webpage_note}")

        # 3. Deterministic extraction from pasted description
        text_fields: ExtractedJobFields | None = None
        if has_description and payload.description:
            text_fields = parse_job_text_deterministically(payload.description)

        # 4. Vision / AI provider extraction when configured
        vision_fields: ExtractedJobFields | None = None
        used_live_ai = False
        ai_provider_label = "unconfigured (deterministic parser only)"

        if settings.vision_ai_configured:
            try:
                vision_fields = call_vision_ai_provider(
                    settings=settings,
                    image_mime=image_mime,
                    image_bytes=image_bytes,
                    text_context=payload.description or "",
                )
                used_live_ai = True
                ai_provider_label = settings.active_ai_provider_name
            except ProviderExtractionError as exc:
                warnings.append(
                    f"Configured AI provider ({settings.active_ai_provider_name}) failed: {exc} "
                    "Fell back to deterministic text/webpage extraction."
                )
        elif has_screenshot:
            warnings.append(
                "A job screenshot was uploaded, but no vision AI provider key "
                "(GEMINI_API_KEY or OPENAI_API_KEY) is configured on the server. "
                "Screenshot OCR/vision extraction was skipped; only pasted text, URL metadata, "
                "or user hints were extracted."
            )

        # 5. Merge extracted fields & provenance without inventing missing values
        merged_fields, provenance = merge_extractions_with_provenance(
            request=payload,
            vision_fields=vision_fields,
            webpage_fields=webpage_fields,
            text_fields=text_fields,
        )

        # 6. Conduct web research
        if payload.run_web_research:
            web_research = conduct_web_research(
                extracted=merged_fields,
                settings=settings,
            )
        else:
            web_research = conduct_web_research(
                extracted=merged_fields,
                settings=BackendSettings(search_provider="none"),
            )

        # 7. Evaluate explainable skill & requirement match against candidate profile snapshot
        skill_match = evaluate_explainable_job_match(
            extracted=merged_fields,
            candidate=payload.candidate_profile,
            settings=settings,
        )

        # 8. Generate grounded tailored application drafts
        tailored_drafts = generate_tailored_application_drafts(
            extracted_job=merged_fields,
            candidate_profile=payload.candidate_profile,
        )

        if used_live_ai and web_research.search_performed:
            analysis_mode = "live_ai_and_search"
        elif used_live_ai:
            analysis_mode = "live_ai_only"
        elif web_research.search_performed:
            analysis_mode = "deterministic_and_search"
        else:
            analysis_mode = "deterministic_only"

        return JobAnalyzeResponse(
            analysis_mode=analysis_mode,
            ai_provider_used=ai_provider_label,
            webpage_fetched=webpage_fetched,
            webpage_fetch_note=webpage_note,
            extracted=merged_fields,
            provenance=provenance,
            web_research=web_research,
            skill_match=skill_match,
            tailored_drafts=tailored_drafts,
            warnings=warnings,
        )

    @app.post(
        "/api/v1/applications/assist",
        response_model=BrowserAssistResponse,
        tags=["Browser-Assisted Application"],
    )
    def assist_application(
        payload: BrowserAssistRequest,
        request: Request = None,
        auth: HTTPAuthorizationCredentials | None = Security(security_bearer),
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
        settings: BackendSettings = Depends(settings_provider),
    ) -> BrowserAssistResponse:
        """Semi-automatic browser-assisted application workflow.

        Enforces mandatory user confirmation, respects platform restrictions on LinkedIn/Naukri,
        detects credible confirmation receipts, and records structured application attempts.
        """
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.expensive_rate_limit_rpm,
            endpoint_tag="application_assist",
        )
        return execute_browser_assisted_application(req=payload, settings=settings)

    @app.get(
        "/api/v1/mock-career-portal",
        tags=["Mock Portal for Testing"],
    )
    def mock_career_portal_form():
        """Local HTML mock application form for offline browser automation tests."""
        from fastapi.responses import HTMLResponse

        html_content = """<!DOCTYPE html>
<html>
<head><title>LinearStack Labs Mock Careers</title></head>
<body>
  <h1>Senior Full-Stack Engineer Application</h1>
  <form id="application-form" action="/api/v1/mock-career-portal/submit" method="POST">
    <label>Full Name: <input type="text" name="fullName" required></label><br>
    <label>Email: <input type="email" name="email" required></label><br>
    <label>Cover Letter: <textarea name="coverLetter"></textarea></label><br>
    <input type="submit" id="submit-btn" value="Submit Application">
  </form>
</body>
</html>"""
        return HTMLResponse(content=html_content, status_code=200)

    @app.api_route(
        "/api/v1/mock-career-portal/submit",
        methods=["GET", "POST"],
        tags=["Mock Portal for Testing"],
    )
    def mock_career_portal_submit(simulate_scenario: str | None = None):
        """Simulates submission outcomes for testing without calling external servers."""
        from fastapi.responses import HTMLResponse

        if simulate_scenario == "captcha":
            return HTMLResponse(
                content="<div id='captcha-challenge'>Security Verification: Please solve the CAPTCHA</div>",
                status_code=403,
            )
        if simulate_scenario == "error":
            return HTMLResponse(
                content="<div class='error-msg'>Validation Error: Required field missing</div>",
                status_code=400,
            )
        if simulate_scenario == "uncertain":
            return HTMLResponse(
                content="<div>Processing your request... please check back later.</div>",
                status_code=200,
            )
        return HTMLResponse(
            content="<div id='confirmation-receipt'>Application Submitted Successfully! Reference: #LS-MOCK-2026-CONFIRMED</div>",
            status_code=200,
        )

    return app


app = create_app()
