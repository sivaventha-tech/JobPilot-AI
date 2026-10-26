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

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Request, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials

from app.config import BackendSettings, load_settings
from app.security import (
    enforce_rate_limit,
    enforce_request_size,
    security_bearer,
    verify_api_auth,
    get_current_user,
    get_optional_current_user,
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
    UserRegisterRequest,
    UserLoginRequest,
    UserAuthResponse,
    UserProfileResponse,
    UserProfileUpdateRequest,
    JobCreateRequest,
    JobUpdateRequest,
    AccountDeleteResponse,
    BillingUsageResponse,
)
from app.services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
)
from app.services.stripe_service import (
    verify_stripe_webhook_signature,
    StripeSignatureVerificationError,
)
from app.db.repository import (
    user_repo,
    profile_repo,
    job_repo,
    draft_repo,
    attempt_repo,
    usage_repo,
    resume_repo,
    subscription_repo,
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


def check_and_reserve_user_quota(user_id: str, metric: str) -> None:
    """Atomically checks and reserves 1 unit of monthly subscription tier quota before executing expensive operations."""
    sub = subscription_repo.get_by_user(user_id)
    tier = sub["tier"].lower() if sub else "free"
    limits = {
        "resumes_parsed": 5 if tier == "free" else 100,
        "jobs_analyzed": 20 if tier == "free" else 500,
        "ai_extractions_count": 10 if tier == "free" else 250,
        "web_searches_count": 15 if tier == "free" else 300,
        "applications_assisted": 10 if tier == "free" else 250,
    }
    max_allowed = limits.get(metric, 1000)
    reserved, current_count = usage_repo.reserve(user_id, metric, max_allowed)
    if not reserved:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Monthly {metric.replace('_', ' ')} quota ({max_allowed}) reached for your {tier.capitalize()} plan. "
                "Please upgrade to Pro to increase your quota."
            ),
        )


check_and_enforce_user_quota = check_and_reserve_user_quota


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
        current_user: dict = Depends(get_current_user),
    ) -> ResumeParseResponse:
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.expensive_rate_limit_rpm,
            endpoint_tag="resume_parse",
        )
        if not isinstance(current_user, dict):
            current_user = get_current_user(auth=auth)

        user_id = current_user["id"]
        # Atomically reserve quota before commencing expensive file decoding & OCR parsing
        check_and_reserve_user_quota(user_id, "resumes_parsed")

        storage_key: str | None = None
        try:
            pdf_bytes = validate_and_decode_pdf(
                filename=payload.filename,
                content_type=payload.content_type,
                data_base64=payload.data_base64,
                max_bytes=settings.max_resume_bytes,
                declared_size=payload.size_bytes,
            )
            parsed_result = parse_resume_pdf_bytes(pdf_bytes)

            import hashlib
            import uuid
            from app.services.storage import (
                StorageQuotaExceededError,
                delete_resume_file,
                save_resume_file,
            )

            res_id = str(uuid.uuid4())
            try:
                storage_key = save_resume_file(user_id, res_id, pdf_bytes)
            except StorageQuotaExceededError as sq_exc:
                usage_repo.release(user_id, "resumes_parsed")
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail=str(sq_exc),
                ) from sq_exc

            sha256 = hashlib.sha256(pdf_bytes).hexdigest()
            dumped = (
                parsed_result.model_dump()
                if hasattr(parsed_result, "model_dump")
                else parsed_result.dict()
            )
            try:
                resume_repo.save(
                    user_id=user_id,
                    filename=payload.filename,
                    file_size_bytes=len(pdf_bytes),
                    content_type=payload.content_type,
                    sha256_hash=sha256,
                    parsed_data=dumped,
                    ocr_required=parsed_result.ocr_required,
                    storage_path=storage_key,
                    resume_id=res_id,
                )
            except Exception as db_exc:
                if storage_key:
                    delete_resume_file(storage_key)
                usage_repo.release(user_id, "resumes_parsed")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to persist resume record to database.",
                ) from db_exc

            return parsed_result
        except ResumeValidationError as exc:
            usage_repo.release(user_id, "resumes_parsed")
            raise HTTPException(
                status_code=exc.status_code,
                detail=str(exc),
            ) from exc
        except HTTPException:
            raise
        except Exception as unk_exc:
            if storage_key:
                from app.services.storage import delete_resume_file
                delete_resume_file(storage_key)
            usage_repo.release(user_id, "resumes_parsed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred while parsing resume: {unk_exc}",
            ) from unk_exc

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
        current_user: dict = Depends(get_current_user),
    ) -> JobAnalyzeResponse:
        verify_api_auth(settings=settings, auth=auth, x_api_key=x_api_key)
        enforce_request_size(request=request, settings=settings)
        enforce_rate_limit(
            request=request,
            settings=settings,
            max_requests=settings.expensive_rate_limit_rpm,
            endpoint_tag="job_analyze",
        )
        if not isinstance(current_user, dict):
            current_user = get_current_user(auth=auth)

        user_id = current_user["id"]

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

        # Early payload limits validation before reservation
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

        # Atomically reserve quota for this job analysis
        check_and_reserve_user_quota(user_id, "jobs_analyzed")

        warnings: list[str] = []
        image_mime: str | None = None
        image_bytes: bytes | None = None

        try:
            # 1. Validate & decode screenshot if provided
            if payload.screenshot is not None:
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
                    usage_repo.release(user_id, "jobs_analyzed")
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

            if used_live_ai:
                usage_repo.increment(user_id, "ai_extractions_count")
            if web_research and web_research.search_performed:
                usage_repo.increment(user_id, "web_searches_count")

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
        except HTTPException:
            raise
        except Exception as exc:
            usage_repo.release(user_id, "jobs_analyzed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An unexpected error occurred while analyzing job: {exc}",
            ) from exc

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
        current_user: dict = Depends(get_current_user),
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
        if not isinstance(current_user, dict):
            current_user = get_current_user(auth=auth)

        user_id = current_user["id"]
        check_and_reserve_user_quota(user_id, "applications_assisted")
        try:
            return execute_browser_assisted_application(req=payload, settings=settings)
        except Exception as exc:
            usage_repo.release(user_id, "applications_assisted")
            raise exc

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

    # =========================================================================
    # Multi-Tenant SaaS Authentication & User Lifecycle
    # =========================================================================

    @app.post("/api/v1/auth/register", response_model=UserAuthResponse, tags=["SaaS Auth"])
    def register_user(
        payload: UserRegisterRequest,
        settings: BackendSettings = Depends(settings_provider),
    ) -> UserAuthResponse:
        """Registers a new tenant user and generates a signed access token."""
        existing = user_repo.get_by_email(payload.email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email address already exists.",
            )

        try:
            pwd_hash = hash_password(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        user = user_repo.create(
            email=payload.email,
            password_hash=pwd_hash,
            full_name=payload.full_name,
        )
        token = create_access_token(
            user_id=user["id"],
            email=user["email"],
            role=user.get("role", "user"),
        )
        return UserAuthResponse(
            user_id=user["id"],
            email=user["email"],
            full_name=user["full_name"],
            role=user.get("role", "user"),
            access_token=token,
        )

    @app.post("/api/v1/auth/login", response_model=UserAuthResponse, tags=["SaaS Auth"])
    def login_user(
        payload: UserLoginRequest,
        settings: BackendSettings = Depends(settings_provider),
    ) -> UserAuthResponse:
        """Authenticates user credentials and issues a signed access token."""
        user = user_repo.get_by_email(payload.email)
        if not user or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = create_access_token(
            user_id=user["id"],
            email=user["email"],
            role=user.get("role", "user"),
        )
        return UserAuthResponse(
            user_id=user["id"],
            email=user["email"],
            full_name=user["full_name"],
            role=user.get("role", "user"),
            access_token=token,
        )

    @app.get("/api/v1/auth/me", tags=["SaaS Auth"])
    def get_current_user_profile(
        current_user: dict = Depends(get_current_user),
    ):
        """Returns the authenticated tenant identity."""
        return {
            "user_id": current_user["id"],
            "email": current_user["email"],
            "full_name": current_user["full_name"],
            "role": current_user.get("role", "user"),
            "created_at": current_user.get("created_at"),
        }

    @app.delete("/api/v1/auth/account", response_model=AccountDeleteResponse, tags=["SaaS Auth"])
    def delete_own_account(
        current_user: dict = Depends(get_current_user),
    ) -> AccountDeleteResponse:
        """Cascades and permanently deletes user account and all workspace data (GDPR compliant)."""
        from app.services.storage import delete_user_resumes
        delete_user_resumes(current_user["id"])
        deleted = user_repo.delete(current_user["id"])
        if not deleted:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")
        return AccountDeleteResponse(
            status="deleted",
            detail="Account and all tenant data deleted successfully.",
            user_id=current_user["id"],
        )

    # =========================================================================
    # Candidate Profile Management
    # =========================================================================

    @app.get("/api/v1/profile", response_model=UserProfileResponse, tags=["SaaS Profile"])
    def get_profile(
        current_user: dict = Depends(get_current_user),
    ) -> UserProfileResponse:
        """Retrieves candidate profile for the authenticated tenant."""
        p = profile_repo.get(current_user["id"])
        if not p:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
        return UserProfileResponse(
            user_id=p["user_id"],
            email=p["email"],
            full_name=p["full_name"],
            phone=p.get("phone") or "",
            preferred_role=p.get("preferred_role") or "",
            preferred_location=p.get("preferred_location") or "",
            years_of_experience=p.get("years_of_experience") or "",
            experience_summary=p.get("experience_summary") or "",
            skills=p.get("skills") or [],
            portfolio_url=p.get("portfolio_url") or "",
            linkedin_url=p.get("linkedin_url") or "",
            education_entries=p.get("education_entries") or [],
            employment_entries=p.get("employment_entries") or [],
            certifications=p.get("certifications") or [],
            updated_at=p.get("updated_at") or "",
        )

    @app.put("/api/v1/profile", response_model=UserProfileResponse, tags=["SaaS Profile"])
    def update_profile(
        payload: UserProfileUpdateRequest,
        current_user: dict = Depends(get_current_user),
    ) -> UserProfileResponse:
        """Updates candidate profile for the authenticated tenant."""
        updates = payload.model_dump(exclude_unset=True)
        p = profile_repo.update(current_user["id"], updates)
        if not p:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
        return UserProfileResponse(
            user_id=p["user_id"],
            email=p["email"],
            full_name=p["full_name"],
            phone=p.get("phone") or "",
            preferred_role=p.get("preferred_role") or "",
            preferred_location=p.get("preferred_location") or "",
            years_of_experience=p.get("years_of_experience") or "",
            experience_summary=p.get("experience_summary") or "",
            skills=p.get("skills") or [],
            portfolio_url=p.get("portfolio_url") or "",
            linkedin_url=p.get("linkedin_url") or "",
            education_entries=p.get("education_entries") or [],
            employment_entries=p.get("employment_entries") or [],
            certifications=p.get("certifications") or [],
            updated_at=p.get("updated_at") or "",
        )

    # =========================================================================
    # Multi-Tenant Workspace Jobs CRUD
    # =========================================================================

    @app.get("/api/v1/workspace/jobs", tags=["Tenant Workspace Jobs"])
    def list_workspace_jobs(
        status: str | None = None,
        source: str | None = None,
        search: str | None = None,
        current_user: dict = Depends(get_current_user),
    ):
        """Lists jobs exclusively owned by the authenticated tenant."""
        return job_repo.list_by_user(
            user_id=current_user["id"],
            status=status,
            source=source,
            search=search,
        )

    @app.post("/api/v1/workspace/jobs", status_code=status.HTTP_201_CREATED, tags=["Tenant Workspace Jobs"])
    def create_workspace_job(
        payload: JobCreateRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Creates a job record owned by the authenticated tenant."""
        job = job_repo.create(user_id=current_user["id"], data=payload.model_dump())
        usage_repo.increment(current_user["id"], "jobs_analyzed")
        return job

    @app.get("/api/v1/workspace/jobs/{job_id}", tags=["Tenant Workspace Jobs"])
    def get_workspace_job(
        job_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Retrieves a single job strictly scoped to the authenticated tenant."""
        job = job_repo.get_by_user(user_id=current_user["id"], job_id=job_id)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Job '{job_id}' not found in your workspace.",
            )
        return job

    @app.put("/api/v1/workspace/jobs/{job_id}", tags=["Tenant Workspace Jobs"])
    def update_workspace_job(
        job_id: str,
        payload: JobUpdateRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Updates a job record strictly scoped to the authenticated tenant."""
        updates = payload.model_dump(exclude_unset=True)
        job = job_repo.update(user_id=current_user["id"], job_id=job_id, updates=updates)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Job '{job_id}' not found in your workspace.",
            )
        return job

    @app.delete("/api/v1/workspace/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Tenant Workspace Jobs"])
    def delete_workspace_job(
        job_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Deletes a job record strictly scoped to the authenticated tenant."""
        deleted = job_repo.delete(user_id=current_user["id"], job_id=job_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Job '{job_id}' not found in your workspace.",
            )
        return None

    # =========================================================================
    # Tenant-Isolated Drafts & Attempts
    # =========================================================================

    @app.get("/api/v1/workspace/jobs/{job_id}/draft", tags=["Tenant Application Drafts"])
    def get_workspace_draft(
        job_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        draft = draft_repo.get(user_id=current_user["id"], job_id=job_id)
        if not draft:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No draft found for job '{job_id}'.",
            )
        return draft

    @app.put("/api/v1/workspace/jobs/{job_id}/draft", tags=["Tenant Application Drafts"])
    def save_workspace_draft(
        job_id: str,
        payload: dict[str, Any],
        current_user: dict = Depends(get_current_user),
    ):
        return draft_repo.upsert(user_id=current_user["id"], job_id=job_id, draft_data=payload)

    @app.get("/api/v1/workspace/jobs/{job_id}/attempts", tags=["Tenant Application Attempts"])
    def list_workspace_attempts(
        job_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        return attempt_repo.list_by_job(user_id=current_user["id"], job_id=job_id)

    @app.post("/api/v1/workspace/jobs/{job_id}/attempts", tags=["Tenant Application Attempts"])
    def record_workspace_attempt(
        job_id: str,
        payload: dict[str, Any],
        current_user: dict = Depends(get_current_user),
    ):
        res = attempt_repo.record(user_id=current_user["id"], job_id=job_id, attempt=payload)
        usage_repo.increment(current_user["id"], "applications_assisted")
        return res

    # =========================================================================
    # Commercial SaaS Billing & Usage Metering
    # =========================================================================

    @app.get("/api/v1/billing/usage", response_model=BillingUsageResponse, tags=["Commercial SaaS Billing"])
    def get_billing_usage(
        current_user: dict = Depends(get_current_user),
    ) -> BillingUsageResponse:
        """Returns the current billing period's usage, active tier, and plan limits."""
        sub = subscription_repo.get_by_user(current_user["id"])
        tier = sub["tier"] if sub else "free"
        usage = usage_repo.get_or_create(current_user["id"])

        limits = {
            "resumes_parsed": 5 if tier == "free" else 100,
            "jobs_analyzed": 20 if tier == "free" else 500,
            "ai_extractions_count": 10 if tier == "free" else 250,
            "web_searches_count": 15 if tier == "free" else 300,
            "applications_assisted": 10 if tier == "free" else 250,
        }

        return BillingUsageResponse(
            user_id=current_user["id"],
            tier=tier.capitalize(),
            period_year_month=usage["period_year_month"],
            resumes_parsed=usage["resumes_parsed"],
            jobs_analyzed=usage["jobs_analyzed"],
            ai_extractions_count=usage["ai_extractions_count"],
            web_searches_count=usage["web_searches_count"],
            applications_assisted=usage["applications_assisted"],
            limits=limits,
        )

    @app.post("/api/v1/billing/webhook", tags=["Commercial SaaS Billing"])
    def stripe_billing_webhook(
        raw_body: bytes = Body(default=b""),
        stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
        settings: BackendSettings = Depends(settings_provider),
    ):
        """Processes Stripe subscription webhook events.
        Enforces cryptographic Stripe-Signature verification, event deduplication,
        and safe subscription-state handling.
        """
        secret = settings.stripe_webhook_secret or os.getenv("STRIPE_WEBHOOK_SECRET", "")
        if not secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Stripe webhook secret is not configured on the server.",
            )

        try:
            event = verify_stripe_webhook_signature(
                raw_payload=raw_body,
                signature_header=stripe_signature,
                secret=secret,
            )
        except StripeSignatureVerificationError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        event_id = event.get("id")
        event_type = event.get("type", "")

        # Persistent Deduplication
        if event_id and not subscription_repo.record_processed_event(event_id, event_type):
            return {"status": "duplicate_ignored", "event_id": event_id}

        data_object = event.get("data", {}).get("object", {})
        customer_id = data_object.get("customer")
        subscription_id = data_object.get("id")

        # 3-Tiered Customer-to-User Resolution
        user_id = data_object.get("metadata", {}).get("user_id")
        if not user_id and customer_id:
            sub = subscription_repo.get_by_stripe_customer_id(customer_id)
            if sub and sub.get("user_id"):
                user_id = sub["user_id"]

        if not user_id:
            customer_email = data_object.get("customer_email") or data_object.get("email")
            if customer_email:
                usr = user_repo.get_by_email(customer_email)
                if usr and usr.get("id"):
                    user_id = usr["id"]

        if event_type in ("customer.subscription.created", "customer.subscription.updated"):
            raw_status = data_object.get("status", "active")
            is_active_status = raw_status in ("active", "trialing")
            if raw_status in ("past_due", "canceled", "unpaid", "incomplete_expired"):
                plan_tier = "free"
            else:
                plan_tier = data_object.get("metadata", {}).get("plan_tier", "pro").lower() if is_active_status else "free"

            if user_id:
                subscription_repo.upsert(
                    user_id=user_id,
                    plan_tier=plan_tier,
                    status=raw_status,
                    stripe_customer_id=customer_id or "",
                    stripe_subscription_id=subscription_id or "",
                )
                return {"status": "processed", "event": event_type, "event_id": event_id}
            return {"status": "ignored", "reason": "unmapped_customer", "event": event_type, "event_id": event_id}

        elif event_type == "customer.subscription.deleted":
            if user_id:
                subscription_repo.upsert(
                    user_id=user_id,
                    plan_tier="free",
                    status="canceled",
                    stripe_customer_id=customer_id or "",
                    stripe_subscription_id=subscription_id or "",
                )
                return {"status": "processed", "event": event_type, "event_id": event_id}
            return {"status": "ignored", "reason": "unmapped_customer", "event": event_type, "event_id": event_id}

        elif event_type == "invoice.payment_failed":
            inv_sub_id = data_object.get("subscription") or subscription_id or ""
            if user_id:
                subscription_repo.upsert(
                    user_id=user_id,
                    plan_tier="free",
                    status="past_due",
                    stripe_customer_id=customer_id or "",
                    stripe_subscription_id=inv_sub_id,
                )
                return {"status": "processed", "event": event_type, "event_id": event_id}
            return {"status": "ignored", "reason": "unmapped_customer", "event": event_type, "event_id": event_id}

        elif event_type in ("invoice.paid", "invoice.payment_succeeded"):
            inv_sub_id = data_object.get("subscription") or subscription_id or ""
            if user_id:
                subscription_repo.upsert(
                    user_id=user_id,
                    plan_tier="pro",
                    status="active",
                    stripe_customer_id=customer_id or "",
                    stripe_subscription_id=inv_sub_id,
                )
                return {"status": "processed", "event": event_type, "event_id": event_id}
            return {"status": "ignored", "reason": "unmapped_customer", "event": event_type, "event_id": event_id}

        return {"status": "ignored", "event": event_type, "event_id": event_id}

    return app


app = create_app()
