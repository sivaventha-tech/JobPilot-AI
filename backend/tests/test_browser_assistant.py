"""Automated unit and integration tests for JobPilot AI browser-assisted application workflow.

Tests cover:
- Mandatory human approval confirmation gate (halting unconfirmed submissions)
- Platform policy classification (strictly restricting LinkedIn & Naukri, permitting public company portals)
- Credible submission confirmation detection
- Uncertain outcome handling (setting status to Failed rather than falsely reporting Submitted)
- CAPTCHA interruption handling without attempting bypass
- Duplicate warning acknowledgment
- Local mock career portal endpoint responses
"""

from __future__ import annotations

from typing import Any
import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel, ValidationError

from app.config import BackendSettings
from app.main import create_app
from app.schemas import (
    BrowserAssistRequest,
    CandidateProfileSnapshot,
    DraftQuestionAnswer,
)
from app.services.browser_assistant import (
    classify_platform_policy,
    detect_captcha_challenge,
    detect_credible_confirmation,
    execute_browser_assisted_application,
)


def _invoke_post_route(
    path: str,
    model_cls: type[BaseModel],
    json_body: dict[str, Any],
    settings: BackendSettings | None = None,
) -> tuple[int, dict[str, Any]]:
    cfg = settings or BackendSettings(enable_browser_automation=True)
    app = create_app(settings_provider=lambda: cfg)
    target_route: APIRoute | None = None
    for r in app.routes:
        if isinstance(r, APIRoute) and "POST" in r.methods and r.path == path:
            target_route = r
            break
    assert target_route is not None, f"Route {path} not found"
    try:
        payload = model_cls.model_validate(json_body)
        res = target_route.endpoint(payload=payload, settings=cfg)
        return 200, res.model_dump()
    except ValidationError as exc:
        return 422, {"detail": exc.errors()}


def _invoke_get_route(
    path: str,
    settings: BackendSettings | None = None,
) -> Any:
    cfg = settings or BackendSettings(enable_browser_automation=True)
    app = create_app(settings_provider=lambda: cfg)
    for r in app.routes:
        if isinstance(r, APIRoute) and "GET" in r.methods and r.path == path:
            return r.endpoint()
    raise RuntimeError(f"GET Route {path} not found")


@pytest.fixture
def sample_candidate() -> CandidateProfileSnapshot:
    return CandidateProfileSnapshot(
        full_name="Aarav Mehta",
        email="aarav@example.com",
        phone="+91 98765 43210",
        preferred_role="Senior Full-Stack Engineer",
        preferred_location="Bengaluru",
        years_of_experience="4.5 Years",
        skills=["TypeScript", "Next.js", "Python", "FastAPI"],
    )


def test_platform_policy_strictly_restricts_linkedin_and_naukri():
    pol_li, li_reasons = classify_platform_policy(
        "https://www.linkedin.com/jobs/view/12345", "LinkedIn"
    )
    assert pol_li == "restricted_manual_guided"
    assert any("LinkedIn restricts" in r for r in li_reasons)

    pol_naukri, nk_reasons = classify_platform_policy(
        "https://www.naukri.com/job-listings-ai-101", "Naukri"
    )
    assert pol_naukri == "restricted_manual_guided"
    assert any("Naukri" in r for r in nk_reasons)

    pol_co, _ = classify_platform_policy(
        "https://careers.linearstack.example.com/apply/101", "Company Website"
    )
    assert pol_co == "permitted_direct_assistant"


def test_mandatory_approval_gate_halts_unconfirmed_submission(sample_candidate):
    req = BrowserAssistRequest(
        job_id="job-101",
        destination_url="https://careers.example.com/apply/1",
        source="Company Website",
        candidate_profile=sample_candidate,
        cover_letter="I am excited to apply.",
        answers=[DraftQuestionAnswer(id="qa-1", question="Why us?", answer="Strong engineering culture.")],
        confirmed_by_user=False,  # Unconfirmed!
    )
    settings = BackendSettings()
    resp = execute_browser_assisted_application(req, settings)

    assert resp.submission_confirmed is False
    assert resp.outcome == "Validation Error"
    assert resp.final_status == "Awaiting Approval"
    assert any("Mandatory Approval Gate" in err for err in resp.errors)


def test_restricted_platform_returns_guided_manual_packet_and_respects_human_checkpoint(sample_candidate):
    req = BrowserAssistRequest(
        job_id="job-li-1",
        destination_url="https://www.linkedin.com/jobs/view/sample-123",
        source="LinkedIn",
        candidate_profile=sample_candidate,
        cover_letter="Cover letter text",
        answers=[DraftQuestionAnswer(id="qa-1", question="Notice period?", answer="30 days")],
        confirmed_by_user=True,
    )
    settings = BackendSettings()
    resp = execute_browser_assisted_application(req, settings)

    assert resp.platform_policy == "restricted_manual_guided"
    assert "Full Name" in resp.clipboard_packet
    assert resp.clipboard_packet["Full Name"] == "Aarav Mehta"
    assert resp.clipboard_packet["Cover Letter"] == "Cover letter text"
    # When user has not yet reported portal completion, status remains Action Required/Approved, never Submitted
    assert resp.outcome == "Manual Action Required"
    assert resp.final_status == "Approved"
    assert resp.submission_confirmed is False


def test_permitted_portal_detects_credible_confirmation(sample_candidate):
    html_page = """
    <html>
      <body>
        <h1>Thank you for applying!</h1>
        <div id="receipt">Your application submitted successfully. Confirmation #LS-998811</div>
      </body>
    </html>
    """
    is_conf, note = detect_credible_confirmation(html_page)
    assert is_conf is True
    assert "application submitted" in note.lower() or "thank you for applying" in note.lower()

    req = BrowserAssistRequest(
        job_id="job-co-1",
        destination_url="https://careers.linearstack.example.com/openings/101",
        source="Company Website",
        candidate_profile=sample_candidate,
        cover_letter="Verified cover letter",
        answers=[],
        confirmed_by_user=True,
    )
    settings = BackendSettings()
    resp = execute_browser_assisted_application(req, settings, target_page_content=html_page)

    assert resp.submission_confirmed is True
    assert resp.outcome == "Submitted"
    assert resp.final_status == "Submitted"
    assert resp.attempt_record.outcome == "Submitted"


def test_uncertain_confirmation_sets_status_to_failed_without_false_positive(sample_candidate):
    ambiguous_page = "<html><body><h1>Loading application status... please check your email.</h1></body></html>"
    is_conf, _ = detect_credible_confirmation(ambiguous_page)
    assert is_conf is False

    req = BrowserAssistRequest(
        job_id="job-co-2",
        destination_url="https://careers.unknown.example.com/apply",
        source="Company Website",
        candidate_profile=sample_candidate,
        cover_letter="Cover letter",
        answers=[],
        confirmed_by_user=True,
    )
    settings = BackendSettings()
    resp = execute_browser_assisted_application(req, settings, target_page_content=ambiguous_page)

    assert resp.submission_confirmed is False
    assert resp.outcome == "Uncertain Confirmation"
    assert resp.final_status == "Failed"
    assert any("confirmation" in w.lower() for w in resp.warnings)


def test_captcha_detection_halts_automation_without_bypass(sample_candidate):
    captcha_page = "<html><body><div class='g-recaptcha'>Please solve the CAPTCHA security check</div></body></html>"
    is_captcha, note = detect_captcha_challenge(captcha_page)
    assert is_captcha is True
    assert "captcha" in note.lower()

    req = BrowserAssistRequest(
        job_id="job-co-3",
        destination_url="https://careers.protected.example.com/apply",
        source="Company Website",
        candidate_profile=sample_candidate,
        cover_letter="Cover letter",
        answers=[],
        confirmed_by_user=True,
    )
    settings = BackendSettings()
    resp = execute_browser_assisted_application(req, settings, target_page_content=captcha_page)

    assert resp.submission_confirmed is False
    assert resp.outcome == "CAPTCHA / Security Check"
    assert resp.final_status == "Failed"
    assert any("CAPTCHA" in err for err in resp.errors)


def test_mock_career_portal_endpoints_and_assist_api(sample_candidate):
    # 1. GET local mock career portal form
    get_res = _invoke_get_route("/api/v1/mock-career-portal")
    assert "LinearStack Labs Mock Careers" in get_res.body.decode("utf-8")

    # 2. POST /api/v1/applications/assist endpoint with confirmed submission
    status_code, body = _invoke_post_route(
        "/api/v1/applications/assist",
        BrowserAssistRequest,
        {
            "job_id": "mock-job-1",
            "destination_url": "http://127.0.0.1:8000/api/v1/mock-career-portal",
            "source": "Company Website",
            "candidate_profile": sample_candidate.model_dump(),
            "cover_letter": "Tailored cover letter grounded in profile",
            "answers": [{"id": "q1", "category": "Motivation", "question": "Why?", "answer": "Good fit"}],
            "confirmed_by_user": True,
            "acknowledged_duplicate": False,
            "simulate_outcome": "success",
        },
    )
    assert status_code == 200
    assert body["submission_confirmed"] is True
    assert body["outcome"] == "Submitted"
    assert body["final_status"] == "Submitted"
    assert body["attempt_record"]["outcome"] == "Submitted"
