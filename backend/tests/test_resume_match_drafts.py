"""Unit and API tests for Resume Parsing, Explainable Job Matching, and Tailored Application Drafts.

Covers:
- Valid text-based PDF parsing via `POST /api/v1/resume/parse`
- Corrupt PDFs, invalid signatures, oversized PDFs (413), empty PDFs, and encrypted PDFs
- Blank PDFs (`empty_text`) and scanned/image-only PDFs (`ocr_required`) with zero fabricated data
- Deterministic explainable job matching (`POST /api/v1/jobs/match`):
  - Score calculation & configurable weight overrides
  - Matched vs. unmentioned skills (`not_mentioned_in_resume`)
  - Partial experience evidence (`partial_or_below`, `aligned`, `not_mentioned_in_resume`)
  - Education & certification alignment (`aligned`, `explicitly_missing`, `not_mentioned_in_resume`)
- Grounded tailored application drafts (`POST /api/v1/jobs/drafts`):
  - Anti-fabrication guardrails (no invented employers, years, degrees, certifications, or work authorization)
  - `needs_user_input` flags and `[USER INPUT NEEDED]` markers
- DuckDuckGo bounded retry with backoff without engine-switching
"""

from __future__ import annotations

import base64
import io
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from pydantic import BaseModel, ValidationError
from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)

from app.config import BackendSettings
from app.main import create_app
from app.schemas import (
    CandidateProfileSnapshot,
    EducationEntry,
    EmploymentEntry,
    ExtractedJobFields,
    JobMatchRequest,
    ProjectEntry,
    ResumeParseRequest,
    TailoredDraftsRequest,
)
from app.services.drafter import generate_tailored_application_drafts
from app.services.matcher import evaluate_explainable_job_match
from app.services.researcher import (
    DuckDuckGoSearchProvider,
    RatelimitException,
    SearchProviderError,
)


def _build_text_pdf_bytes(lines: list[str]) -> bytes:
    """Create a valid, standards-compliant text-based PDF in memory using pypdf."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)

    # Register Helvetica font in page resources
    font_dict = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    font_ref = writer._add_object(font_dict)
    resources = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref}),
        }
    )
    page[NameObject("/Resources")] = resources

    # Build PDF text content stream
    ops = ["BT", "/F1 11 Tf", "50 740 Td", "14 TL"]
    for line in lines:
        escaped = (
            line.replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )
        ops.append(f"({escaped}) Tj T*")
    ops.append("ET")
    stream_data = "\n".join(ops).encode("latin-1", errors="ignore")

    content_stream = DecodedStreamObject()
    content_stream.set_data(stream_data)
    content_ref = writer._add_object(content_stream)
    page[NameObject("/Contents")] = content_ref

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _build_scanned_image_only_pdf_bytes() -> bytes:
    """Create a valid PDF page containing an embedded `/Image` XObject and zero text."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)

    img_stream = DecodedStreamObject()
    img_stream.set_data(b"\xff\xff\xff")
    img_stream.update(
        {
            NameObject("/Type"): NameObject("/XObject"),
            NameObject("/Subtype"): NameObject("/Image"),
            NameObject("/Width"): NumberObject(1),
            NameObject("/Height"): NumberObject(1),
            NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
            NameObject("/BitsPerComponent"): NumberObject(8),
        }
    )
    img_ref = writer._add_object(img_stream)

    resources = DictionaryObject(
        {
            NameObject("/XObject"): DictionaryObject({NameObject("/Im1"): img_ref}),
        }
    )
    page[NameObject("/Resources")] = resources

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _build_blank_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _invoke_post_route(
    path: str,
    model_cls: type[BaseModel],
    json_body: dict[str, Any],
    settings: BackendSettings | None = None,
) -> tuple[int, dict[str, Any]]:
    cfg = settings or BackendSettings()
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
    except HTTPException as exc:
        return exc.status_code, {"detail": exc.detail}


def test_parse_valid_text_resume_pdf() -> None:
    resume_lines = [
        "Rohan Kulkarni",
        "rohan.kulkarni@example.com | +91 98111 22334 | Bengaluru, India",
        "https://github.com/rohankulkarni-dev",
        "Senior Backend Engineer with 5.5 years of experience.",
        "Professional Summary",
        "Backend and platform engineer experienced in distributed Python and FastAPI microservices.",
        "Technical Skills",
        "Python, FastAPI, TypeScript, React, PostgreSQL, Docker, Kubernetes, Redis",
        "Work Experience",
        "Senior Software Engineer at CloudPulse Technologies (Jan 2023 - Present)",
        "- Architected Python FastAPI microservices processing high-throughput webhook events.",
        "- Scaled PostgreSQL read replicas and Redis caching layers.",
        "Software Engineer at DataBridge Systems (Jun 2020 - Dec 2022)",
        "- Built internal React and TypeScript observability dashboards.",
        "Education",
        "B.Tech in Computer Science, VJTI Mumbai, 2020",
        "Certifications",
        "- AWS Certified Solutions Architect Associate",
        "- Certified Kubernetes Administrator (CKA)",
        "Projects",
        "PulseQueue — Distributed task router built with Python, FastAPI, and Redis",
    ]
    pdf_bytes = _build_text_pdf_bytes(resume_lines)
    pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")

    status_code, body = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "Rohan_Kulkarni_Resume.pdf",
            "content_type": "application/pdf",
            "data_base64": pdf_b64,
            "size_bytes": len(pdf_bytes),
        },
    )
    assert status_code == 200
    assert body["parse_status"] == "parsed"
    assert body["is_scanned_or_image_only"] is False
    assert body["ocr_required"] is False
    assert body["page_count"] == 1

    parsed = body["parsed"]
    assert parsed["full_name"] == "Rohan Kulkarni"
    assert parsed["email"] == "rohan.kulkarni@example.com"
    assert parsed["phone"] == "+91 98111 22334"
    assert "Bengaluru" in (parsed["location"] or "")
    assert parsed["portfolio_or_github_url"] == "https://github.com/rohankulkarni-dev"
    assert "5.5 years" in (parsed["years_of_experience"] or "")
    assert "Python" in parsed["skills"]
    assert "FastAPI" in parsed["skills"]
    assert "Kubernetes" in parsed["skills"]
    assert len(parsed["employment_history"]) >= 2
    assert parsed["employment_history"][0]["company"] == "CloudPulse Technologies"
    assert len(parsed["education"]) >= 1
    assert "B.Tech" in parsed["education"][0]["degree"]
    assert any("AWS Certified" in c for c in parsed["certifications"])
    assert len(parsed["projects"]) >= 1
    assert parsed["projects"][0]["name"] == "PulseQueue"


def test_parse_scanned_image_only_pdf_reports_ocr_required_without_fabricating() -> None:
    scanned_bytes = _build_scanned_image_only_pdf_bytes()
    scanned_b64 = base64.b64encode(scanned_bytes).decode("ascii")

    status_code, body = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "Scanned_Camera_Resume.pdf",
            "content_type": "application/pdf",
            "data_base64": scanned_b64,
            "size_bytes": len(scanned_bytes),
        },
    )
    assert status_code == 200
    assert body["parse_status"] == "ocr_required"
    assert body["is_scanned_or_image_only"] is True
    assert body["ocr_required"] is True
    assert "OCR is required" in body["status_message"]

    # Verify zero fabricated fields
    parsed = body["parsed"]
    assert parsed["full_name"] is None
    assert parsed["email"] is None
    assert parsed["phone"] is None
    assert parsed["skills"] == []
    assert parsed["employment_history"] == []
    assert parsed["education"] == []
    assert parsed["certifications"] == []
    assert parsed["projects"] == []


def test_parse_blank_pdf_reports_empty_text_without_fabricating() -> None:
    blank_bytes = _build_blank_pdf_bytes()
    blank_b64 = base64.b64encode(blank_bytes).decode("ascii")

    status_code, body = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "Blank.pdf",
            "content_type": "application/pdf",
            "data_base64": blank_b64,
            "size_bytes": len(blank_bytes),
        },
    )
    assert status_code == 200
    assert body["parse_status"] == "empty_text"
    assert body["ocr_required"] is True
    assert body["parsed"]["full_name"] is None
    assert body["parsed"]["skills"] == []


def test_parse_rejects_corrupt_encrypted_invalid_and_oversized_pdfs() -> None:
    # 1. Non-PDF file type & header
    status_non_pdf, body_non_pdf = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "notes.txt",
            "content_type": "text/plain",
            "data_base64": base64.b64encode(b"hello world").decode("ascii"),
        },
    )
    assert status_non_pdf == 400
    assert "Only PDF files" in body_non_pdf["detail"]

    # 2. Fake .pdf extension without %PDF- magic signature
    status_bad_sig, body_bad_sig = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "fake.pdf",
            "content_type": "application/pdf",
            "data_base64": base64.b64encode(b"NOT_A_PDF_HEADER_12345").decode("ascii"),
        },
    )
    assert status_bad_sig == 400
    assert "PDF header signature" in body_bad_sig["detail"]

    # 3. Corrupt PDF body after %PDF- header
    status_corrupt, body_corrupt = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "corrupt.pdf",
            "content_type": "application/pdf",
            "data_base64": base64.b64encode(b"%PDF-1.7\n%%EOF\ngarbage-corrupt-xref").decode("ascii"),
        },
    )
    assert status_corrupt == 400

    # 4. Oversized PDF (> max_resume_bytes)
    valid_pdf = _build_blank_pdf_bytes()
    small_settings = BackendSettings(max_resume_bytes=64)
    status_large, body_large = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "huge.pdf",
            "content_type": "application/pdf",
            "data_base64": base64.b64encode(valid_pdf).decode("ascii"),
            "size_bytes": len(valid_pdf),
        },
        settings=small_settings,
    )
    assert status_large == 413
    assert "exceeds maximum allowed limit" in body_large["detail"]

    # 5. Encrypted / password-protected PDF
    enc_writer = PdfWriter()
    enc_writer.add_blank_page(width=612, height=792)
    enc_writer.encrypt("user_password_123")
    enc_buf = io.BytesIO()
    enc_writer.write(enc_buf)
    enc_bytes = enc_buf.getvalue()

    status_enc, body_enc = _invoke_post_route(
        "/api/v1/resume/parse",
        ResumeParseRequest,
        {
            "filename": "protected.pdf",
            "content_type": "application/pdf",
            "data_base64": base64.b64encode(enc_bytes).decode("ascii"),
        },
    )
    assert status_enc == 400
    assert "Encrypted or password-protected" in body_enc["detail"]


def test_explainable_job_matching_scores_missing_skills_and_partial_experience() -> None:
    job = ExtractedJobFields(
        title="Senior Backend Python Engineer",
        company="AcmeCloud",
        location="Bengaluru",
        work_mode="Hybrid",
        experience="5+ years",
        required_skills=["Python", "FastAPI", "PostgreSQL", "Kubernetes"],
        summary_description=(
            "Requires a Bachelor's degree in Computer Science and AWS Certified Solutions Architect. "
            "5+ years building distributed services."
        ),
    )

    # Candidate A: Strong match (has 3/4 skills, 6 years exp, B.Tech, AWS Certified)
    strong_candidate = CandidateProfileSnapshot(
        full_name="Rohan Kulkarni",
        preferred_role="Senior Backend Engineer",
        preferred_location="Bengaluru (Hybrid)",
        years_of_experience="6 Years",
        education="B.Tech in Computer Science",
        skills=["Python", "FastAPI", "PostgreSQL"],
        certifications=["AWS Certified Solutions Architect"],
        employment_history=[
            EmploymentEntry(
                company="CloudPulse",
                title="Senior Backend Engineer",
                duration="2021 - Present",
                highlights=["Built Python and FastAPI services backed by PostgreSQL."],
            )
        ],
    )

    eval_strong = evaluate_explainable_job_match(job, strong_candidate)
    assert 75 <= eval_strong.match_score <= 95
    assert eval_strong.matched_skills == ["Python", "FastAPI", "PostgreSQL"]
    assert eval_strong.missing_skills == ["Kubernetes"]
    assert eval_strong.uncertain_or_unmentioned_skills[0].skill == "Kubernetes"
    assert eval_strong.uncertain_or_unmentioned_skills[0].status == "not_mentioned_in_resume"
    assert eval_strong.experience_alignment_status == "aligned"
    assert eval_strong.education_certification_alignment.status == "aligned"
    assert len(eval_strong.relevant_experience_evidence) >= 1

    # Candidate B: Partial experience (2 years vs 5+ required) & missing required certification
    partial_candidate = CandidateProfileSnapshot(
        full_name="Junior Dev",
        preferred_role="Backend Developer",
        preferred_location="Mumbai",
        years_of_experience="2 Years",
        education="B.Tech in Information Technology",
        skills=["Python"],
        certifications=[],
    )
    eval_partial = evaluate_explainable_job_match(job, partial_candidate)
    assert eval_partial.match_score < eval_strong.match_score
    assert eval_partial.experience_alignment_status == "partial_or_below"
    assert eval_partial.education_certification_alignment.status == "explicitly_missing"
    assert any("Explicit experience gap" in lim for lim in eval_partial.limitations)

    # Candidate C: Unmentioned experience and unmentioned education -> distinguished as not_mentioned_in_resume
    unmentioned_candidate = CandidateProfileSnapshot(
        full_name="Minimal Profile",
        skills=["Python", "FastAPI"],
    )
    eval_unmentioned = evaluate_explainable_job_match(job, unmentioned_candidate)
    assert eval_unmentioned.experience_alignment_status == "not_mentioned_in_resume"
    assert eval_unmentioned.education_certification_alignment.status == "not_mentioned_in_resume"

    # Verify /api/v1/jobs/match endpoint with custom weights_override
    status_match, match_body = _invoke_post_route(
        "/api/v1/jobs/match",
        JobMatchRequest,
        {
            "extracted_job": job.model_dump(),
            "candidate_profile": strong_candidate.model_dump(),
            "weights_override": {
                "skills": 1.0,
                "experience": 0.0,
                "education_certs": 0.0,
                "role_location": 0.0,
            },
        },
    )
    assert status_match == 200
    # 3 of 4 skills matched with 100% weight on skills -> exact 75 score
    assert match_body["match_score"] == 75


def test_tailored_application_drafts_never_fabricate_missing_qualifications() -> None:
    job = ExtractedJobFields(
        title="Staff Platform Engineer",
        company="NovaScale Systems",
        location="Bengaluru",
        required_skills=["Python", "FastAPI", "Kubernetes", "Terraform"],
    )

    # Sparse candidate profile: NO years_of_experience, NO employment_history, NO work_authorization, NO certifications
    sparse_profile = CandidateProfileSnapshot(
        full_name="Aarav Mehta",
        email="aarav@example.com",
        skills=["Python", "FastAPI"],
        projects=[
            ProjectEntry(
                name="FastService",
                description="Microservice template",
                technologies=["Python", "FastAPI"],
            )
        ],
    )

    drafts = generate_tailored_application_drafts(
        extracted_job=job,
        candidate_profile=sparse_profile,
        custom_questions=[
            "Do you hold a Certified Kubernetes Administrator (CKA) certification?",
            "What is your expected CTC?",
        ],
    )

    # Cover letter must include candidate name, matched skills, and project, without inventing years of experience or employers
    assert "Aarav Mehta" in drafts.cover_letter
    assert "NovaScale Systems" in drafts.cover_letter
    assert "FastService" in drafts.cover_letter
    assert "years of experience" not in drafts.cover_letter.lower()

    # Check Q&A items for [USER INPUT NEEDED] markers on missing qualifications
    qa_by_id = {q.id: q for q in drafts.questions_and_answers}

    # Q1 should flag unmentioned skills (Kubernetes, Terraform) and missing years_of_experience
    q1 = qa_by_id["qa-draft-1"]
    assert q1.needs_user_input is True
    assert "Kubernetes" in q1.answer
    assert "[USER INPUT NEEDED" in q1.answer

    # Q3 (Logistics) must flag work_authorization and notice_period as needing user input
    q3 = qa_by_id["qa-draft-3"]
    assert q3.needs_user_input is True
    assert "work_authorization" in q3.missing_profile_fields
    assert "notice_period" in q3.missing_profile_fields
    assert "[USER INPUT NEEDED" in q3.answer

    # Custom certification question must NOT claim the candidate holds CKA
    q4 = qa_by_id["qa-draft-4"]
    assert q4.needs_user_input is True
    assert "certifications" in q4.missing_profile_fields
    assert "[USER INPUT NEEDED" in q4.answer

    # Verify /api/v1/jobs/drafts endpoint
    status_drafts, drafts_body = _invoke_post_route(
        "/api/v1/jobs/drafts",
        TailoredDraftsRequest,
        {
            "extracted_job": job.model_dump(),
            "candidate_profile": sparse_profile.model_dump(),
        },
    )
    assert status_drafts == 200
    assert "NovaScale Systems" in drafts_body["cover_letter"]
    assert len(drafts_body["questions_and_answers"]) == 3


def test_duckduckgo_bounded_retries_and_backoff_respects_throttling() -> None:
    sleep_calls: list[float] = []
    attempts = 0

    class MockThrottledDDGS:
        def __init__(self, timeout: int | None = None, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "MockThrottledDDGS":
            return self

        def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
            return None

        def text(self, query: str, **kwargs: Any) -> list[dict[str, str]]:
            nonlocal attempts
            attempts += 1
            # Verify it only queries 'duckduckgo' and does not switch engines to evade rate limits
            assert kwargs.get("backend") == "duckduckgo"
            raise RatelimitException("202 Ratelimit")

    provider = DuckDuckGoSearchProvider(
        timeout_seconds=5.0,
        max_retries=2,
        retry_backoff_seconds=0.5,
        sleep_fn=lambda delay: sleep_calls.append(delay),
        ddgs_cls=MockThrottledDDGS,
    )

    with pytest.raises(SearchProviderError, match="rate limit exceeded"):
        provider.search("Cloudflare Software Engineer")

    # Initial attempt + 2 bounded retries = 3 total attempts, with exponential backoff [0.5, 1.0]
    assert attempts == 3
    assert sleep_calls == [0.5, 1.0]
