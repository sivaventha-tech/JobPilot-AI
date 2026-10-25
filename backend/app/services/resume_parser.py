"""Resume PDF Validation and Structured Extraction Service.

Responsibilities:
- Validate file size, MIME type (`application/pdf`), and PDF header signature (`%PDF-`).
- Handle empty (0-byte), oversized, corrupt, and password-encrypted PDFs with clear errors.
- Extract text from text-based PDFs using `pypdf`.
- Detect scanned or image-only PDFs (embedded image XObjects with minimal/no text layer)
  and report that OCR is required (`parse_status="ocr_required"`, `ocr_required=True`)
  rather than returning fabricated candidate data.
- Extract candidate skills, employment history, education, certifications, projects,
  and contact details where available; return missing fields as `None` or `[]`.
- NEVER log resume text or personal data.
"""

from __future__ import annotations

import base64
import io
import re
from typing import Any

try:
    from pypdf import PdfReader
    from pypdf.errors import FileNotDecryptedError, PdfReadError, PdfStreamError
except ImportError:  # pragma: no cover
    PdfReader = None  # type: ignore[assignment,misc]
    FileNotDecryptedError = Exception  # type: ignore[assignment,misc]
    PdfReadError = Exception  # type: ignore[assignment,misc]
    PdfStreamError = Exception  # type: ignore[assignment,misc]

from app.schemas import (
    EducationEntry,
    EmploymentEntry,
    ParsedResumeData,
    ProjectEntry,
    ResumeParseResponse,
)
from app.services.extractor import KNOWN_TECH_SKILLS


class ResumeValidationError(ValueError):
    """Raised when a resume upload fails MIME, size, PDF header, encryption, or corruption checks."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def is_pdf_parser_available() -> bool:
    return PdfReader is not None


def validate_and_decode_pdf(
    filename: str,
    content_type: str,
    data_base64: str,
    max_bytes: int,
    declared_size: int | None = None,
) -> bytes:
    """Validate PDF MIME/extension, size limits, base64 encoding, and `%PDF-` signature."""
    norm_mime = (content_type or "").split(";")[0].strip().lower()
    has_pdf_ext = filename.strip().lower().endswith(".pdf")

    if norm_mime not in ("application/pdf", "application/x-pdf", "binary/octet-stream") and not has_pdf_ext:
        raise ResumeValidationError(
            f"Unsupported resume content_type '{content_type}'. Only PDF files (.pdf, application/pdf) are accepted.",
            status_code=400,
        )

    if declared_size is not None:
        if declared_size <= 0:
            raise ResumeValidationError(
                "Uploaded PDF file is empty (0 bytes).",
                status_code=400,
            )
        if declared_size > max_bytes:
            raise ResumeValidationError(
                f"Resume PDF size ({declared_size} bytes) exceeds maximum allowed limit of {max_bytes} bytes.",
                status_code=413,
            )

    raw_b64 = data_base64.strip()
    if not raw_b64:
        raise ResumeValidationError(
            "Uploaded PDF payload is empty.",
            status_code=400,
        )

    if raw_b64.startswith("data:"):
        header, _, remainder = raw_b64.partition(",")
        if not remainder:
            raise ResumeValidationError("Malformed data URL for resume PDF.", status_code=400)
        raw_b64 = remainder.strip()

    try:
        pdf_bytes = base64.b64decode(raw_b64, validate=True)
    except Exception as exc:
        raise ResumeValidationError(
            "Invalid base64 encoding for resume PDF file.",
            status_code=400,
        ) from exc

    if len(pdf_bytes) == 0:
        raise ResumeValidationError("Decoded PDF file is empty (0 bytes).", status_code=400)

    if len(pdf_bytes) > max_bytes:
        raise ResumeValidationError(
            f"Decoded PDF size ({len(pdf_bytes)} bytes) exceeds maximum allowed limit of {max_bytes} bytes.",
            status_code=413,
        )

    # Check PDF signature within first 1024 bytes (standard PDF spec allows leading whitespace before %PDF-)
    header_window = pdf_bytes[:1024]
    if b"%PDF-" not in header_window:
        raise ResumeValidationError(
            "File content does not match a valid PDF header signature (%PDF-).",
            status_code=400,
        )

    return pdf_bytes


def _page_has_image_objects(page: Any) -> bool:
    """Inspect a pypdf PageObject for embedded image XObjects without decoding image pixels."""
    try:
        resources = page.get("/Resources")
        if not resources:
            return False
        if hasattr(resources, "get_object"):
            resources = resources.get_object()
        xobjects = resources.get("/XObject") if isinstance(resources, dict) else None
        if not xobjects:
            return False
        if hasattr(xobjects, "get_object"):
            xobjects = xobjects.get_object()
        if isinstance(xobjects, dict):
            for obj_ref in xobjects.values():
                obj = obj_ref.get_object() if hasattr(obj_ref, "get_object") else obj_ref
                if isinstance(obj, dict) and obj.get("/Subtype") == "/Image":
                    return True
    except Exception:
        return False
    return False


def parse_resume_pdf_bytes(pdf_bytes: bytes) -> ResumeParseResponse:
    """Extract text and structured candidate fields from validated PDF bytes.

    Detects encrypted, corrupt, blank, and scanned/image-only PDFs honestly.
    Never logs resume contents or personal data.
    """
    if PdfReader is None:
        raise ResumeValidationError(
            "PDF parsing library ('pypdf') is not installed on the server.",
            status_code=500,
        )

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes), strict=False)
    except (PdfReadError, PdfStreamError, ValueError, EOFError) as exc:
        raise ResumeValidationError(
            "Corrupt or unreadable PDF structure. Please upload a valid, uncorrupted PDF file.",
            status_code=400,
        ) from exc
    except Exception as exc:
        raise ResumeValidationError(
            f"Failed to read PDF document ({exc.__class__.__name__}).",
            status_code=400,
        ) from exc

    if getattr(reader, "is_encrypted", False):
        # Attempt empty-password owner decryption; if still encrypted, reject cleanly
        try:
            decrypt_res = reader.decrypt("")
            if decrypt_res == 0:
                raise ResumeValidationError(
                    "Encrypted or password-protected PDF files cannot be parsed. Please upload an unencrypted PDF.",
                    status_code=400,
                )
        except ResumeValidationError:
            raise
        except Exception as exc:
            raise ResumeValidationError(
                "Encrypted or password-protected PDF files cannot be parsed. Please upload an unencrypted PDF.",
                status_code=400,
            ) from exc

    try:
        num_pages = len(reader.pages)
    except (FileNotDecryptedError, PdfReadError, PdfStreamError) as exc:
        msg = (
            "Encrypted or password-protected PDF files cannot be parsed."
            if isinstance(exc, FileNotDecryptedError) or "decrypt" in str(exc).lower()
            else "Corrupt or unreadable PDF page tree."
        )
        raise ResumeValidationError(msg, status_code=400) from exc
    except Exception as exc:
        raise ResumeValidationError(
            "Corrupt or unreadable PDF page tree.",
            status_code=400,
        ) from exc

    if num_pages == 0:
        raise ResumeValidationError(
            "The uploaded PDF contains 0 pages.",
            status_code=400,
        )

    page_texts: list[str] = []
    has_embedded_images = False

    for page in reader.pages:
        if _page_has_image_objects(page):
            has_embedded_images = True
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        if txt.strip():
            page_texts.append(txt)

    full_text = "\n".join(page_texts).strip()
    alnum_chars = sum(1 for ch in full_text if ch.isalnum())

    # Detect scanned / image-only PDFs or blank text layers
    if alnum_chars < 20:
        if has_embedded_images:
            return ResumeParseResponse(
                parse_status="ocr_required",
                is_scanned_or_image_only=True,
                ocr_required=True,
                page_count=num_pages,
                extracted_char_count=alnum_chars,
                parsed=ParsedResumeData(),
                status_message=(
                    "Scanned or image-only PDF detected. This document contains embedded page images "
                    "without a machine-readable text layer. OCR is required and is not enabled; "
                    "no candidate profile fields were fabricated."
                ),
                warnings=[
                    "OCR Required: The uploaded PDF appears to be a scanned image document with no extractable text layer.",
                    "Please upload a text-based PDF exported from Word/Google Docs/LaTeX or enter your details manually.",
                ],
            )
        return ResumeParseResponse(
            parse_status="empty_text",
            is_scanned_or_image_only=False,
            ocr_required=True,
            page_count=num_pages,
            extracted_char_count=alnum_chars,
            parsed=ParsedResumeData(),
            status_message=(
                "No extractable text was found in this PDF. The document may contain blank pages, "
                "outlined vector paths, or unsupported font encodings. No candidate profile fields were fabricated."
            ),
            warnings=[
                "No extractable text found in the uploaded PDF. Verify that text can be selected/copied in your PDF viewer.",
            ],
        )

    parsed_data = extract_structured_resume_fields(full_text)
    warnings: list[str] = []
    if not parsed_data.skills:
        warnings.append(
            "No recognized technical skills were automatically matched from the PDF text. Review and add your skills before saving."
        )
    if not parsed_data.employment_history:
        warnings.append(
            "Structured employment history entries could not be segmented automatically; review your experience summary before saving."
        )

    return ResumeParseResponse(
        parse_status="parsed",
        is_scanned_or_image_only=False,
        ocr_required=False,
        page_count=num_pages,
        extracted_char_count=len(full_text),
        parsed=parsed_data,
        status_message=(
            f"Extracted structured candidate fields from {num_pages}-page text-based PDF. "
            "Please review and edit the extracted fields before applying them to your profile."
        ),
        warnings=warnings,
    )


# Heading patterns used to segment resume text into logical sections
_SECTION_PATTERNS: dict[str, re.Pattern[str]] = {
    "summary": re.compile(
        r"^(?:professional\s+summary|executive\s+summary|summary|profile|about\s+me|objective)\s*:?\s*$",
        re.IGNORECASE,
    ),
    "skills": re.compile(
        r"^(?:technical\s+skills|core\s+skills|skills|technologies|tech\s+stack|competencies)\s*:?\s*$",
        re.IGNORECASE,
    ),
    "experience": re.compile(
        r"^(?:work\s+experience|professional\s+experience|employment\s+history|experience|career\s+history)\s*:?\s*$",
        re.IGNORECASE,
    ),
    "education": re.compile(
        r"^(?:education|academic\s+background|qualifications)\s*:?\s*$",
        re.IGNORECASE,
    ),
    "certifications": re.compile(
        r"^(?:certifications?|licenses?\s*&?\s*certifications?|credentials)\s*:?\s*$",
        re.IGNORECASE,
    ),
    "projects": re.compile(
        r"^(?:projects?|key\s+projects?|personal\s+projects?|selected\s+projects?)\s*:?\s*$",
        re.IGNORECASE,
    ),
}


def extract_structured_resume_fields(raw_text: str) -> ParsedResumeData:
    """Deterministically extract candidate fields from resume text.

    Returns `None` or `[]` for any field not found in the text; never invents values.
    """
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    # 1. Contact details (email, phone, portfolio/GitHub URL, location, name)
    email_match = re.search(
        r"\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b", text
    )
    email = email_match.group(1) if email_match else None

    phone_match = re.search(
        r"(?:\+\d{1,3}[\s\-]?)?(?:\(\d{2,4}\)[\s\-]?|\d{2,5}[\s\-])?\d{5,10}\b",
        text,
    )
    phone: str | None = None
    if phone_match:
        candidate_phone = phone_match.group(0).strip()
        digits_only = re.sub(r"\D", "", candidate_phone)
        if 10 <= len(digits_only) <= 15:
            phone = candidate_phone

    url_match = re.search(
        r"(https?://(?:www\.)?(?:github\.com|gitlab\.com|linkedin\.com/in|[a-zA-Z0-9\-]+\.(?:dev|io|me|com))/[^\s,)\]]*)",
        text,
        re.IGNORECASE,
    )
    portfolio_url = url_match.group(1).rstrip(".,;)") if url_match else None

    city_match = re.search(
        r"\b(Bengaluru|Bangalore|Mumbai|Hyderabad|Pune|Chennai|Gurugram|Noida|Delhi|Kolkata|New York|San Francisco|Seattle|London|Remote)(?:,\s*[A-Za-z\s]+)?\b",
        text,
        re.IGNORECASE,
    )
    location = city_match.group(0).strip() if city_match else None

    # Infer candidate name from the first non-contact header line if it looks like a person's name
    full_name: str | None = None
    for top_line in lines[:5]:
        cleaned_top = re.sub(r"[|•].*$", "", top_line).strip()
        if (
            cleaned_top
            and "@" not in cleaned_top
            and "http" not in cleaned_top.lower()
            and not any(
                kw in cleaned_top.lower()
                for kw in ("resume", "curriculum", "vitae", "summary", "experience", "engineer", "developer")
            )
            and re.match(r"^[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z.\-]+){1,3}$", cleaned_top)
        ):
            full_name = cleaned_top
            break

    # Explicit "Name: ..." label fallback
    if not full_name:
        name_label = re.search(
            r"^(?:Name|Candidate)\s*[:\-]\s*([A-Z][A-Za-z\s.\-]{2,50})$",
            text,
            re.MULTILINE,
        )
        if name_label:
            full_name = name_label.group(1).strip()

    # 2. Years of experience & preferred/current role
    exp_years_match = re.search(
        r"\b(\d{1,2}(?:\.\d)?\+?\s*(?:years|yrs))(?:\s+of\s+experience)?\b",
        text,
        re.IGNORECASE,
    )
    years_of_experience = exp_years_match.group(1).strip() if exp_years_match else None

    preferred_role: str | None = None
    role_match = re.search(
        r"\b((?:Senior|Staff|Lead|Principal|Full[\-\s]?Stack|Backend|Frontend|Software|AI|Machine Learning|Data|Platform|DevOps)\s+(?:[A-Za-z\-\/]+\s+){0,2}(?:Engineer|Developer|Architect|Scientist))\b",
        text,
    )
    if role_match:
        preferred_role = role_match.group(1).strip()

    # 3. Segment lines by section headings
    sections: dict[str, list[str]] = {
        "header": [],
        "summary": [],
        "skills": [],
        "experience": [],
        "education": [],
        "certifications": [],
        "projects": [],
    }
    current_section = "header"

    for line in lines:
        matched_heading: str | None = None
        for sec_name, pattern in _SECTION_PATTERNS.items():
            if pattern.match(line):
                matched_heading = sec_name
                break
            # Also handle inline "Skills: Python, FastAPI..."
            inline_m = re.match(
                rf"^(?:{sec_name}|technical\s+skills|work\s+experience)\s*:\s*(.+)$",
                line,
                re.IGNORECASE,
            )
            if inline_m:
                matched_heading = sec_name
                sections[sec_name].append(inline_m.group(1).strip())
                break
        if matched_heading:
            current_section = matched_heading
            continue
        sections[current_section].append(line)

    # 4. Skills extraction (combine known tech skills found in text + explicit items in skills section)
    detected_skills: list[str] = []
    lower_text = text.lower()
    for skill in KNOWN_TECH_SKILLS:
        pattern = r"(?<![a-zA-Z0-9])" + re.escape(skill.lower()) + r"(?![a-zA-Z0-9])"
        if re.search(pattern, lower_text):
            detected_skills.append(skill)

    for skill_line in sections["skills"]:
        cleaned_line = re.sub(r"^[•\-\*]\s*", "", skill_line)
        # Strip category prefix like "Languages & Frameworks:"
        if ":" in cleaned_line:
            _, _, rhs = cleaned_line.partition(":")
            if rhs.strip():
                cleaned_line = rhs.strip()
        for token in re.split(r"[,|•;/]", cleaned_line):
            tok = token.strip()
            if 2 <= len(tok) <= 35 and not any(
                s.lower() == tok.lower() for s in detected_skills
            ):
                detected_skills.append(tok)

    # 5. Summary extraction
    experience_summary: str | None = None
    if sections["summary"]:
        experience_summary = " ".join(sections["summary"])[:600].strip()

    # 6. Employment history extraction
    employment_history = _parse_employment_section(sections["experience"])

    # 7. Education extraction
    education_entries = _parse_education_section(sections["education"], text)

    # 8. Certifications extraction
    certifications = _parse_certifications_section(sections["certifications"], text)

    # 9. Projects extraction
    projects = _parse_projects_section(sections["projects"])

    return ParsedResumeData(
        full_name=full_name,
        email=email,
        phone=phone,
        location=location,
        preferred_role=preferred_role,
        years_of_experience=years_of_experience,
        experience_summary=experience_summary,
        portfolio_or_github_url=portfolio_url,
        skills=detected_skills,
        employment_history=employment_history,
        education=education_entries,
        certifications=certifications,
        projects=projects,
    )


_DATE_RANGE_RE = re.compile(
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\s*\d{4}\s*[\-–—to]+\s*(?:Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\s*\d{4}))",
    re.IGNORECASE,
)


def _parse_employment_section(exp_lines: list[str]) -> list[EmploymentEntry]:
    entries: list[EmploymentEntry] = []
    current: EmploymentEntry | None = None

    for line in exp_lines:
        is_bullet = line.startswith(("•", "-", "*"))
        date_match = _DATE_RANGE_RE.search(line)

        if not is_bullet and (date_match or " at " in line or " | " in line or " — " in line or " - " in line):
            if current is not None:
                entries.append(current)

            duration = date_match.group(1).strip() if date_match else None
            header_without_date = (
                line.replace(date_match.group(0), "").strip(" |—–-(),")
                if date_match
                else line
            )

            title: str | None = None
            company: str | None = None
            if " at " in header_without_date:
                t_part, _, c_part = header_without_date.partition(" at ")
                title = t_part.strip() or None
                company = c_part.strip() or None
            elif " | " in header_without_date:
                t_part, _, c_part = header_without_date.partition(" | ")
                title = t_part.strip() or None
                company = c_part.strip() or None
            elif " — " in header_without_date:
                t_part, _, c_part = header_without_date.partition(" — ")
                title = t_part.strip() or None
                company = c_part.strip() or None
            elif " - " in header_without_date:
                t_part, _, c_part = header_without_date.partition(" - ")
                title = t_part.strip() or None
                company = c_part.strip() or None
            else:
                title = header_without_date.strip() or None

            current = EmploymentEntry(
                company=company,
                title=title,
                duration=duration,
                highlights=[],
            )
        else:
            cleaned_bullet = re.sub(r"^[•\-\*]\s*", "", line).strip()
            if current is None and cleaned_bullet:
                current = EmploymentEntry(
                    company=None,
                    title=None,
                    duration=None,
                    highlights=[cleaned_bullet],
                )
            elif current is not None and cleaned_bullet:
                current.highlights.append(cleaned_bullet)

    if current is not None:
        entries.append(current)

    return entries[:8]


_DEGREE_RE = re.compile(
    r"\b(B\.?Tech|M\.?Tech|B\.?E\.?|M\.?E\.?|B\.?S\.?|M\.?S\.?|B\.?Sc|M\.?Sc|BCA|MCA|MBA|Ph\.?D\.?|Bachelor(?:'s)?|Master(?:'s)?)[^\n,;]*",
    re.IGNORECASE,
)


def _parse_education_section(edu_lines: list[str], full_text: str) -> list[EducationEntry]:
    entries: list[EducationEntry] = []
    source_lines = edu_lines if edu_lines else [
        ln.strip() for ln in full_text.split("\n") if _DEGREE_RE.search(ln)
    ]

    for line in source_lines:
        cleaned = re.sub(r"^[•\-\*]\s*", "", line).strip()
        if not cleaned:
            continue
        deg_m = _DEGREE_RE.search(cleaned)
        if not deg_m and not edu_lines:
            continue

        year_m = re.search(r"\b(19\d{2}|20\d{2})\b", cleaned)
        year = year_m.group(1) if year_m else None

        parts = [p.strip() for p in re.split(r"[,|—–]", cleaned) if p.strip()]
        degree_str = parts[0] if parts else cleaned
        institution_str = parts[1] if len(parts) > 1 else None

        entries.append(
            EducationEntry(
                degree=degree_str,
                institution=institution_str,
                year=year,
            )
        )

    return entries[:5]


def _parse_certifications_section(cert_lines: list[str], full_text: str) -> list[str]:
    certs: list[str] = []
    for line in cert_lines:
        cleaned = re.sub(r"^[•\-\*]\s*", "", line).strip()
        if cleaned and len(cleaned) <= 140:
            certs.append(cleaned)

    if not certs:
        # Look for explicit certification mentions in full text only when clearly labeled
        for m in re.finditer(
            r"\b(AWS\s+Certified\s+[A-Za-z\s\-]+|Certified\s+Kubernetes\s+[A-Za-z\s]+|CKA|CKAD|Google\s+Cloud\s+Professional\s+[A-Za-z\s]+|Azure\s+[A-Za-z\s]+Associate|PMP|CompTIA\s+Security\+)\b",
            full_text,
        ):
            val = m.group(1).strip()
            if not any(c.lower() == val.lower() for c in certs):
                certs.append(val)

    return certs[:8]


def _parse_projects_section(proj_lines: list[str]) -> list[ProjectEntry]:
    projects: list[ProjectEntry] = []
    current: ProjectEntry | None = None

    for line in proj_lines:
        is_bullet = line.startswith(("•", "-", "*"))
        if not is_bullet and (
            current is None
            or ":" in line
            or " — " in line
            or " - " in line
            or " | " in line
            or len(line) < 60
        ):
            if current is not None:
                projects.append(current)
            name_part = line
            desc_part: str | None = None
            for sep in (" — ", " - ", " | ", ": ", "  "):
                if sep in line:
                    n_p, _, d_p = line.partition(sep)
                    name_part = n_p.strip()
                    desc_part = d_p.strip() or None
                    break
            techs = [
                s
                for s in KNOWN_TECH_SKILLS
                if re.search(
                    r"(?<![a-zA-Z0-9])" + re.escape(s.lower()) + r"(?![a-zA-Z0-9])",
                    line.lower(),
                )
            ]
            current = ProjectEntry(
                name=name_part,
                description=desc_part,
                technologies=techs,
            )
        else:
            cleaned = re.sub(r"^[•\-\*]\s*", "", line).strip()
            if current is not None and cleaned:
                current.description = (
                    f"{current.description} {cleaned}".strip()
                    if current.description
                    else cleaned
                )
                for s in KNOWN_TECH_SKILLS:
                    if (
                        s not in current.technologies
                        and re.search(
                            r"(?<![a-zA-Z0-9])" + re.escape(s.lower()) + r"(?![a-zA-Z0-9])",
                            cleaned.lower(),
                        )
                    ):
                        current.technologies.append(s)

    if current is not None:
        projects.append(current)

    return projects[:6]
