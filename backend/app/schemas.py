"""Pydantic v2 request and response schemas for JobPilot AI."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, field_validator


JobSourceLiteral = Literal["LinkedIn", "Naukri", "Company Website", "Other"]

ProvenanceSourceLiteral = Literal[
    "screenshot_vision",
    "webpage_public",
    "pasted_description",
    "user_input",
    "missing",
]

ResearchVerificationLiteral = Literal[
    "Verified Facts",
    "Conflicting Information",
    "Unverified Claims",
    "Search Not Configured",
]


class ScreenshotPayload(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(..., min_length=3, max_length=100)
    data_base64: str = Field(
        ...,
        description="Base64-encoded image bytes or data URL (data:image/png;base64,...)",
    )
    size_bytes: int | None = Field(default=None, ge=1)


class EmploymentEntry(BaseModel):
    company: str | None = None
    title: str | None = None
    duration: str | None = None
    highlights: list[str] = Field(default_factory=list)


class EducationEntry(BaseModel):
    degree: str
    institution: str | None = None
    year: str | None = None


class ProjectEntry(BaseModel):
    name: str
    description: str | None = None
    technologies: list[str] = Field(default_factory=list)


class ParsedResumeData(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    preferred_role: str | None = None
    years_of_experience: str | None = None
    experience_summary: str | None = None
    portfolio_or_github_url: str | None = None
    skills: list[str] = Field(default_factory=list)
    employment_history: list[EmploymentEntry] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)


class ResumeParseRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(default="application/pdf", min_length=3, max_length=100)
    data_base64: str = Field(
        ...,
        description="Base64-encoded PDF bytes or data URL (data:application/pdf;base64,...)",
    )
    size_bytes: int | None = Field(default=None, ge=0)


class ResumeParseResponse(BaseModel):
    parse_status: Literal["parsed", "ocr_required", "empty_text"] = "parsed"
    is_scanned_or_image_only: bool = False
    ocr_required: bool = False
    page_count: int = 0
    extracted_char_count: int = 0
    parsed: ParsedResumeData = Field(default_factory=ParsedResumeData)
    status_message: str
    warnings: list[str] = Field(default_factory=list)


class CandidateProfileSnapshot(BaseModel):
    full_name: str = "Candidate"
    email: str = ""
    phone: str = ""
    preferred_role: str = ""
    preferred_location: str = ""
    years_of_experience: str = ""
    experience_summary: str = ""
    education: str = ""
    portfolio_or_github_url: str = ""
    skills: list[str] = Field(default_factory=list)
    employment_history: list[EmploymentEntry] = Field(default_factory=list)
    education_entries: list[EducationEntry] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    work_authorization: str | None = None
    notice_period: str | None = None


class JobAnalyzeRequest(BaseModel):
    source: JobSourceLiteral = "LinkedIn"
    application_url: str | None = Field(default=None, max_length=2048)
    description: str | None = Field(default=None, max_length=50000)
    title_hint: str | None = Field(default=None, max_length=300)
    company_hint: str | None = Field(default=None, max_length=300)
    location_hint: str | None = Field(default=None, max_length=300)
    salary_hint: str | None = Field(default=None, max_length=200)
    experience_hint: str | None = Field(default=None, max_length=200)
    screenshot: ScreenshotPayload | None = None
    candidate_profile: CandidateProfileSnapshot | None = None
    run_web_research: bool = True

    @field_validator("application_url")
    @classmethod
    def validate_optional_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise ValueError("application_url must start with http:// or https://")
        return trimmed


class ContactDetails(BaseModel):
    recruiter_name: str | None = None
    recruiter_title: str | None = None
    recruiter_email: str | None = None
    recruiter_phone: str | None = None


class ExtractedJobFields(BaseModel):
    title: str | None = None
    company: str | None = None
    location: str | None = None
    work_mode: Literal["Remote", "Hybrid", "On-site"] | None = None
    salary: str | None = None
    experience: str | None = None
    required_skills: list[str] = Field(default_factory=list)
    application_url: str | None = None
    contact: ContactDetails = Field(default_factory=ContactDetails)
    summary_description: str | None = None


class FieldProvenanceMap(BaseModel):
    title: ProvenanceSourceLiteral = "missing"
    company: ProvenanceSourceLiteral = "missing"
    location: ProvenanceSourceLiteral = "missing"
    salary: ProvenanceSourceLiteral = "missing"
    experience: ProvenanceSourceLiteral = "missing"
    required_skills: ProvenanceSourceLiteral = "missing"
    application_url: ProvenanceSourceLiteral = "missing"
    contact: ProvenanceSourceLiteral = "missing"


class ResearchEvidenceItem(BaseModel):
    category: Literal["vacancy", "company_careers", "recruiter", "general"] = "general"
    title: str
    url: str
    snippet: str
    classification: Literal["verified_fact", "conflicting_info", "unverified_claim"] = (
        "unverified_claim"
    )


class FieldComparisonResult(BaseModel):
    field_name: str
    extracted_value: str | None = None
    research_finding: str
    status: Literal["matched", "conflicting", "unverified"] = "unverified"


class WebResearchReport(BaseModel):
    provider_used: str = "unconfigured"
    search_performed: bool = False
    verification_status: ResearchVerificationLiteral = "Search Not Configured"
    company_verified: bool = False
    recruiter_verified: bool = False
    summary_note: str
    evidence_items: list[ResearchEvidenceItem] = Field(default_factory=list)
    comparisons: list[FieldComparisonResult] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class SkillGapItem(BaseModel):
    skill: str
    status: Literal["not_mentioned_in_resume", "explicitly_missing"] = (
        "not_mentioned_in_resume"
    )
    detail: str


class EducationCertAlignment(BaseModel):
    status: Literal[
        "aligned",
        "not_mentioned_in_resume",
        "explicitly_missing",
        "not_explicitly_required",
    ] = "not_explicitly_required"
    required_credentials: list[str] = Field(default_factory=list)
    matched_credentials: list[str] = Field(default_factory=list)
    missing_or_unmentioned_credentials: list[str] = Field(default_factory=list)
    summary: str


class ScoreComponentBreakdown(BaseModel):
    skills_score: float = Field(ge=0.0, le=100.0, default=50.0)
    experience_score: float = Field(ge=0.0, le=100.0, default=50.0)
    education_certs_score: float = Field(ge=0.0, le=100.0, default=100.0)
    role_location_score: float = Field(ge=0.0, le=100.0, default=50.0)
    weights_used: dict[str, float] = Field(default_factory=dict)


class SkillMatchEvaluation(BaseModel):
    match_score: int = Field(ge=0, le=100)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    uncertain_or_unmentioned_skills: list[SkillGapItem] = Field(default_factory=list)
    relevant_experience_evidence: list[str] = Field(default_factory=list)
    experience_alignment_status: Literal[
        "aligned",
        "partial_or_below",
        "not_mentioned_in_resume",
        "not_explicitly_required",
    ] = "not_explicitly_required"
    education_certification_alignment: EducationCertAlignment = Field(
        default_factory=lambda: EducationCertAlignment(
            status="not_explicitly_required",
            summary="No explicit degree or certification requirement detected in job description.",
        )
    )
    score_breakdown: ScoreComponentBreakdown = Field(
        default_factory=ScoreComponentBreakdown
    )
    match_summary: str
    explanation: str = ""
    limitations: list[str] = Field(default_factory=list)
    is_heuristic: bool = True


class JobMatchRequest(BaseModel):
    extracted_job: ExtractedJobFields
    candidate_profile: CandidateProfileSnapshot
    weights_override: dict[str, float] | None = None


class DraftQuestionAnswer(BaseModel):
    id: str
    category: Literal["Motivation", "Experience", "Logistics", "Custom"] = "Custom"
    question: str
    answer: str
    needs_user_input: bool = False
    missing_profile_fields: list[str] = Field(default_factory=list)
    grounding_sources: list[str] = Field(default_factory=list)


class TailoredDraftsRequest(BaseModel):
    extracted_job: ExtractedJobFields
    candidate_profile: CandidateProfileSnapshot
    custom_questions: list[str] = Field(default_factory=list)


class TailoredDraftsResponse(BaseModel):
    cover_letter: str
    cover_letter_needs_user_input: bool = False
    questions_and_answers: list[DraftQuestionAnswer] = Field(default_factory=list)
    grounding_warnings: list[str] = Field(default_factory=list)


class JobAnalyzeResponse(BaseModel):
    analysis_mode: Literal[
        "live_ai_and_search",
        "live_ai_only",
        "deterministic_and_search",
        "deterministic_only",
    ]
    ai_provider_used: str
    webpage_fetched: bool = False
    webpage_fetch_note: str | None = None
    extracted: ExtractedJobFields
    provenance: FieldProvenanceMap
    web_research: WebResearchReport
    skill_match: SkillMatchEvaluation
    tailored_drafts: TailoredDraftsResponse | None = None
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "jobpilot-ai-fastapi"
    version: str = "0.4.0"
    auth_required: bool = False
    rate_limiting_enabled: bool = True
    vision_ai_configured: bool
    ai_provider: str
    web_search_configured: bool
    search_provider: str
    pdf_parser_available: bool = True
    browser_assistant_available: bool = False
    max_image_bytes: int
    max_resume_bytes: int = 10 * 1024 * 1024
    http_timeout_seconds: float
    assist_timeout_seconds: float = 15.0


SubmissionOutcomeLiteral = Literal[
    "Submitted",
    "Uncertain Confirmation",
    "CAPTCHA / Security Check",
    "Validation Error",
    "Timeout",
    "User Cancelled",
    "Manual Action Required",
]


class ApplicationAttemptSchema(BaseModel):
    id: str
    timestamp: str
    destination_url: str
    source: JobSourceLiteral
    mode: Literal["browser_assisted", "manual_guided"]
    outcome: SubmissionOutcomeLiteral
    final_status: Literal["Submitted", "Failed", "Approved", "Awaiting Approval"]
    confirmation_details: str | None = None
    error_message: str | None = None
    answers_submitted_count: int = 0
    duplicate_warning_acknowledged: bool = False


class BrowserAssistRequest(BaseModel):
    job_id: str = Field(..., min_length=1, max_length=100)
    destination_url: str = Field(..., min_length=1, max_length=2048)
    source: JobSourceLiteral = "Company Website"
    candidate_profile: CandidateProfileSnapshot
    cover_letter: str = ""
    answers: list[DraftQuestionAnswer] = Field(default_factory=list)
    confirmed_by_user: bool = False  # Mandatory confirmation gate flag
    acknowledged_duplicate: bool = False
    simulate_outcome: str | None = None  # For unit tests / mock portal simulation


class BrowserAssistResponse(BaseModel):
    job_id: str
    destination_url: str
    platform_policy: Literal["permitted_direct_assistant", "restricted_manual_guided"]
    outcome: SubmissionOutcomeLiteral
    final_status: Literal["Submitted", "Failed", "Approved", "Awaiting Approval"]
    submission_confirmed: bool = False
    confirmation_evidence: str | None = None
    step_summary: str
    filled_fields: list[str] = Field(default_factory=list)
    clipboard_packet: dict[str, str] = Field(default_factory=dict)
    attempt_record: ApplicationAttemptSchema
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
