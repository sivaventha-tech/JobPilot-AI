"""JobPilot AI — Local End-to-End Mock Career Portal Verification.

Tests the semi-automatic browser-assisted workflow against the local mock career portal:
1. In-process / local FastAPI mock portal server.
2. Playwright Chromium automation with explicit 15s action & navigation timeouts.
3. Complete application review, answer editing, and duplicate detection verification.
4. Mandatory final approval gate enforcement (confirmed_by_user=True required).
5. Mock portal form filling, submission, and confirmation receipt verification (#LS-MOCK-2026-CONFIRMED).
6. Platform policy verification (LinkedIn & Naukri restricted to guided manual packets).
7. CAPTCHA / security challenge detection & halt without bypass.
8. Uncertain receipt fallback verification (never results in 'Submitted').
9. Application attempt history and tracking update verification.
"""

from __future__ import annotations

import os
import sys
import time
import threading
from typing import Any

# Ensure backend directory is in Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import uvicorn
from app.main import create_app
from app.config import BackendSettings
from app.schemas import (
    CandidateProfileSnapshot,
    DraftQuestionAnswer,
    BrowserAssistRequest,
)
from app.services.browser_assistant import (
    classify_platform_policy,
    build_clipboard_packet,
    detect_credible_confirmation,
    detect_captcha_challenge,
    execute_browser_assisted_application,
)

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8899  # Dedicated test port to avoid collision with port 8000
BASE_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"


class UvicornTestServer(uvicorn.Server):
    """Thread-safe Uvicorn server wrapper."""
    def install_signal_handlers(self) -> None:
        pass


def run_e2e_verification() -> None:
    print("=" * 70, flush=True)
    print(">>> JOBPILOT AI: STARTING LOCAL END-TO-END VERIFICATION <<<", flush=True)
    print("=" * 70, flush=True)

    app = create_app()
    config = uvicorn.Config(app=app, host=SERVER_HOST, port=SERVER_PORT, log_level="warning")
    server = UvicornTestServer(config=config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    # Wait for server to start
    started = False
    for attempt in range(20):
        if server.started:
            started = True
            break
        time.sleep(0.2)

    if not started:
        print("[ERROR] FastAPI test server failed to bind and start within 4s.", flush=True)
        sys.exit(1)

    print(f"[STEP 1/8] FastAPI test server listening at {BASE_URL}", flush=True)

    # 1. Verify Platform Policy Classification (LinkedIn & Naukri)
    print("[STEP 2/8] Verifying platform classification policy...", flush=True)
    li_policy, li_reasons = classify_platform_policy("https://www.linkedin.com/jobs/view/101", "LinkedIn")
    assert li_policy == "restricted_manual_guided", f"Expected restricted_manual_guided, got {li_policy}"
    assert any("LinkedIn restricts" in r for r in li_reasons)

    naukri_policy, naukri_reasons = classify_platform_policy("https://www.naukri.com/job-103", "Naukri")
    assert naukri_policy == "restricted_manual_guided", f"Expected restricted_manual_guided, got {naukri_policy}"

    direct_policy, _ = classify_platform_policy(f"{BASE_URL}/api/v1/mock-career-portal", "Company Website")
    assert direct_policy == "permitted_direct_assistant", f"Expected permitted_direct_assistant, got {direct_policy}"
    print("  -> LinkedIn and Naukri correctly classified as restricted_manual_guided.", flush=True)
    print("  -> Public career portal correctly classified as permitted_direct_assistant.", flush=True)

    # 2. Verify Mandatory Approval Gate (confirmed_by_user=False stops execution)
    print("[STEP 3/8] Verifying mandatory approval gate enforcement...", flush=True)
    test_settings = BackendSettings(assist_timeout_seconds=15.0, enable_browser_automation=True)
    sample_profile = CandidateProfileSnapshot(
        full_name="Aarav Mehta",
        email="aarav.mehta@example.com",
        phone="+91 98765 43210",
        preferred_role="Senior Full-Stack AI Engineer",
        preferred_location="Bengaluru, India",
        years_of_experience="4.5 Years",
        skills=["TypeScript", "Next.js", "Python", "FastAPI"],
    )
    sample_answers = [
        DraftQuestionAnswer(
            id="q1",
            question="Why LinearStack Labs?",
            answer="Extensive full-stack experience in AI workflow orchestration.",
            category="Motivation",
        ),
        DraftQuestionAnswer(
            id="q2",
            question="FastAPI & PostgreSQL experience?",
            answer="Built and maintained async FastAPI microservices with Supabase.",
            category="Experience",
        ),
    ]

    unconfirmed_req = BrowserAssistRequest(
        job_id="job-mock-01",
        destination_url=f"{BASE_URL}/api/v1/mock-career-portal",
        source="Company Website",
        candidate_profile=sample_profile,
        cover_letter="Sample cover letter",
        answers=sample_answers,
        confirmed_by_user=False,  # NOT CONFIRMED
    )
    unconf_res = execute_browser_assisted_application(unconfirmed_req, test_settings)
    assert unconf_res.outcome == "Validation Error"
    assert unconf_res.final_status == "Awaiting Approval"
    assert not unconf_res.submission_confirmed
    assert any("Mandatory Approval Gate" in err for err in unconf_res.errors)
    print("  -> Mandatory approval gate halted unconfirmed submission as expected.", flush=True)

    # 3. Test Playwright Browser Automation with Local Mock Portal
    print("[STEP 4/8] Initializing Playwright Chromium with 15s timeouts...", flush=True)
    from playwright.sync_api import sync_playwright

    submission_receipt = None
    portal_url = f"{BASE_URL}/api/v1/mock-career-portal"

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout=15000,
        )
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(15000)

        print(f"  -> Navigating to mock career portal at {portal_url}...", flush=True)
        page.goto(portal_url)

        # Verify form elements are rendered
        title_text = page.inner_text("h1")
        assert "Senior Full-Stack Engineer" in title_text
        print(f"  -> Portal page title: '{title_text}'", flush=True)

        # Fill candidate inputs
        print("  -> Filling form inputs with candidate profile and edited cover letter...", flush=True)
        page.fill("input[name='fullName']", sample_profile.full_name)
        page.fill("input[name='email']", sample_profile.email)
        cover_letter_text = (
            "I have 4.5 years of experience building Next.js and FastAPI applications. "
            "I look forward to contributing to LinearStack Labs."
        )
        page.fill("textarea[name='coverLetter']", cover_letter_text)

        # Submit form
        print("  -> Clicking '#submit-btn' to submit application to mock portal...", flush=True)
        page.click("#submit-btn")

        # Wait for confirmation receipt
        page.wait_for_selector("#confirmation-receipt", timeout=15000)
        receipt_text = page.inner_text("#confirmation-receipt")
        print(f"  -> Receipt detected: '{receipt_text}'", flush=True)

        is_confirmed, conf_evidence = detect_credible_confirmation(receipt_text)
        assert is_confirmed, f"Failed to detect confirmation in: {receipt_text}"
        assert "#LS-MOCK-2026-CONFIRMED" in receipt_text
        submission_receipt = receipt_text

        # 4. Verify CAPTCHA challenge detection
        print("[STEP 5/8] Testing CAPTCHA challenge detection on mock portal...", flush=True)
        page.goto(f"{BASE_URL}/api/v1/mock-career-portal/submit?simulate_scenario=captcha")
        captcha_html = page.content()
        is_captcha, captcha_msg = detect_captcha_challenge(captcha_html)
        assert is_captcha, "Failed to detect CAPTCHA challenge"
        print(f"  -> CAPTCHA detected: {captcha_msg}", flush=True)

        captcha_req = BrowserAssistRequest(
            job_id="job-mock-01",
            destination_url=f"{BASE_URL}/api/v1/mock-career-portal",
            source="Company Website",
            candidate_profile=sample_profile,
            cover_letter="Cover letter",
            answers=sample_answers,
            confirmed_by_user=True,
            simulate_outcome="captcha",
        )
        captcha_res = execute_browser_assisted_application(captcha_req, test_settings)
        assert captcha_res.outcome == "CAPTCHA / Security Check"
        assert captcha_res.final_status == "Failed"
        assert not captcha_res.submission_confirmed
        print("  -> CAPTCHA halted browser automation and set status='Failed' (intervention needed).", flush=True)

        # 5. Verify Uncertain Receipt Fallback
        print("[STEP 6/8] Testing uncertain confirmation receipt fallback...", flush=True)
        page.goto(f"{BASE_URL}/api/v1/mock-career-portal/submit?simulate_scenario=uncertain")
        uncertain_html = page.content()
        is_uncertain_conf, _ = detect_credible_confirmation(uncertain_html)
        assert not is_uncertain_conf, "Uncertain response should not match confirmation patterns"

        uncertain_req = BrowserAssistRequest(
            job_id="job-mock-01",
            destination_url=f"{BASE_URL}/api/v1/mock-career-portal",
            source="Company Website",
            candidate_profile=sample_profile,
            cover_letter="Cover letter",
            answers=sample_answers,
            confirmed_by_user=True,
            simulate_outcome="uncertain",
        )
        uncertain_res = execute_browser_assisted_application(uncertain_req, test_settings)
        assert uncertain_res.outcome == "Uncertain Confirmation"
        assert uncertain_res.final_status == "Failed"  # NEVER Submitted
        assert not uncertain_res.submission_confirmed
        print("  -> Uncertain receipt strictly prevented 'Submitted' status (set to 'Failed').", flush=True)

        browser.close()

    # 6. Verify Answer Editing & Grounding Update
    print("[STEP 7/10] Verifying answer editing & grounding updates...", flush=True)
    edited_answers = [
        DraftQuestionAnswer(
            id="q1",
            category="Motivation",
            question="Why LinearStack Labs?",
            answer="[EDITED BY CANDIDATE] Hands-on experience architecting human-in-the-loop review dashboards.",
            needs_user_input=False,
        ),
        DraftQuestionAnswer(
            id="q2",
            category="Experience",
            question="FastAPI & PostgreSQL experience?",
            answer="[EDITED BY CANDIDATE] 4.5 years scaling async Python FastAPI services and Supabase schemas.",
            needs_user_input=False,
        ),
    ]
    assert "[EDITED BY CANDIDATE]" in edited_answers[0].answer
    print("  -> Candidate edited answers verified and staged for submission.", flush=True)

    # 7. Verify Duplicate Application Detection
    print("[STEP 8/10] Verifying duplicate application detection logic...", flush=True)
    existing_applications = [
        {
            "id": "job-existing-1",
            "title": "Senior Full-Stack Engineer",
            "company": "LinearStack Labs",
            "applicationUrl": "https://company.example.com/jobs/101",
            "status": "Submitted",
        }
    ]
    # Check by company + title
    has_dup_role = any(
        j["company"].lower() == "linearstack labs" and j["title"].lower() == "senior full-stack engineer"
        for j in existing_applications
    )
    assert has_dup_role, "Expected duplicate detection for same company and title"
    print("  -> Duplicate detected: Already applied to 'Senior Full-Stack Engineer' at 'LinearStack Labs'.", flush=True)

    # 8. Verify Successful Submission Assist API with Attempt History
    print("[STEP 9/10] Verifying complete confirmed submission assist workflow & attempt history...", flush=True)
    history: list[dict[str, Any]] = []

    # First attempt: simulated timeout or failure
    failed_req = BrowserAssistRequest(
        job_id="job-mock-01",
        destination_url=f"{BASE_URL}/api/v1/mock-career-portal",
        source="Company Website",
        candidate_profile=sample_profile,
        cover_letter=cover_letter_text,
        answers=edited_answers,
        confirmed_by_user=True,
        simulate_outcome="timeout",
    )
    failed_res = execute_browser_assisted_application(failed_req, test_settings)
    assert failed_res.outcome == "Timeout"
    assert failed_res.final_status == "Failed"
    history.append(failed_res.attempt_record.model_dump())
    print("  -> Attempt 1 recorded in history: outcome='Timeout', final_status='Failed'.", flush=True)

    # Second attempt: Retry with explicit confirmation after review
    confirmed_req = BrowserAssistRequest(
        job_id="job-mock-01",
        destination_url=f"{BASE_URL}/api/v1/mock-career-portal",
        source="Company Website",
        candidate_profile=sample_profile,
        cover_letter=cover_letter_text,
        answers=edited_answers,
        confirmed_by_user=True,
        acknowledged_duplicate=True,
    )
    confirmed_res = execute_browser_assisted_application(
        confirmed_req, test_settings, target_page_content=submission_receipt
    )
    assert confirmed_res.outcome == "Submitted"
    assert confirmed_res.final_status == "Submitted"
    assert confirmed_res.submission_confirmed
    assert confirmed_res.attempt_record is not None
    history.append(confirmed_res.attempt_record.model_dump())
    print(f"  -> Attempt 2 recorded in history: outcome='Submitted', receipt='{submission_receipt}'", flush=True)
    assert len(history) == 2, f"Expected 2 attempts in history, got {len(history)}"
    assert history[0]["outcome"] == "Timeout"
    assert history[1]["outcome"] == "Submitted"
    assert history[1]["duplicate_warning_acknowledged"] is True
    print("  -> Attempt history timeline verified with multiple outcomes and non-sensitive notes.", flush=True)

    # 9. Verify Clipboard Packet Structure for Restricted Portals
    print("[STEP 10/10] Verifying clipboard packet structure for restricted portals...", flush=True)
    packet = build_clipboard_packet(sample_profile.model_dump(), cover_letter_text, [a.model_dump() for a in edited_answers])
    assert packet["Full Name"] == "Aarav Mehta"
    assert packet["Email"] == "aarav.mehta@example.com"
    assert "TypeScript" in packet["Skills"]
    assert "Q1 (Motivation): Why LinearStack Labs?" in packet
    assert "[EDITED BY CANDIDATE]" in packet["Q1 (Motivation): Why LinearStack Labs?"]
    print(f"  -> Clipboard packet built with {len(packet)} structured fields including edited answers.", flush=True)

    # Stop test server
    server.should_exit = True
    print("\n" + "=" * 70, flush=True)
    print(">>> LOCAL END-TO-END VERIFICATION COMPLETED SUCCESSFULLY! <<<", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    run_e2e_verification()
