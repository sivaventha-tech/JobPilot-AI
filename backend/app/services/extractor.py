"""Provider-based Job Information Extraction Service (Phase C).

Responsibilities:
- Validate and decode screenshot images (PNG, JPEG, WEBP, GIF) up to configured max size.
- Call configurable vision-capable AI provider (Gemini or OpenAI) when credentials are set.
- Retrieve public job webpage HTML/JSON-LD only when public access is permitted
  (never bypassing login walls, CAPTCHAs, or 401/403/429 restrictions).
- Parse pasted job descriptions deterministically without inventing missing fields.
- Return unknown or missing fields as `None` (`null` in JSON) rather than fabricating values.
- Track field-level provenance (`screenshot_vision`, `webpage_public`, `pasted_description`, `user_input`, `missing`).
"""

from __future__ import annotations

import base64
import html
import json
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import BackendSettings
from app.schemas import (
    CandidateProfileSnapshot,
    ContactDetails,
    ExtractedJobFields,
    FieldProvenanceMap,
    JobAnalyzeRequest,
    ProvenanceSourceLiteral,
    SkillMatchEvaluation,
)

ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
}

KNOWN_TECH_SKILLS = [
    "TypeScript",
    "JavaScript",
    "React",
    "Next.js",
    "Tailwind CSS",
    "Node.js",
    "Python",
    "FastAPI",
    "Django",
    "Flask",
    "PostgreSQL",
    "MySQL",
    "Supabase",
    "MongoDB",
    "Redis",
    "Docker",
    "Kubernetes",
    "AWS",
    "GCP",
    "Azure",
    "GraphQL",
    "REST APIs",
    "Git",
    "LLM Orchestration",
    "PyTorch",
    "TensorFlow",
    "SQL",
    "Go",
    "Java",
    "C++",
    "Rust",
    "Kafka",
    "Terraform",
    "CI/CD",
]


class ImageValidationError(ValueError):
    """Raised when an uploaded screenshot fails content-type, size, or base64 checks."""


class ProviderExtractionError(RuntimeError):
    """Raised when an external AI provider times out or returns a malformed response."""


def validate_and_decode_screenshot(
    content_type: str, data_base64: str, max_bytes: int
) -> tuple[str, bytes]:
    normalized_type = content_type.strip().lower()
    if normalized_type == "image/jpg":
        normalized_type = "image/jpeg"

    if normalized_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise ImageValidationError(
            f"Unsupported image content_type '{content_type}'. Allowed types: PNG, JPEG, WEBP, GIF."
        )

    raw_b64 = data_base64.strip()
    if raw_b64.startswith("data:"):
        parts = raw_b64.split(",", 1)
        if len(parts) != 2:
            raise ImageValidationError("Malformed data URL in screenshot payload.")
        header, raw_b64 = parts[0], parts[1]
        if ";base64" not in header:
            raise ImageValidationError("Screenshot data URL must be base64-encoded.")

    if not raw_b64:
        raise ImageValidationError("Screenshot base64 payload is empty.")

    try:
        decoded = base64.b64decode(raw_b64, validate=True)
    except Exception as exc:
        raise ImageValidationError("Invalid base64 image encoding.") from exc

    if len(decoded) == 0:
        raise ImageValidationError("Decoded screenshot image is empty (0 bytes).")

    if len(decoded) > max_bytes:
        raise ImageValidationError(
            f"Decoded screenshot size ({len(decoded)} bytes) exceeds limit of {max_bytes} bytes."
        )

    # Verify magic bytes for real image formats
    is_valid_magic = (
        decoded.startswith(b"\x89PNG\r\n\x1a\n")
        or decoded.startswith(b"\xff\xd8\xff")
        or (decoded.startswith(b"RIFF") and decoded[8:12] == b"WEBP")
        or decoded.startswith(b"GIF87a")
        or decoded.startswith(b"GIF89a")
    )
    if not is_valid_magic:
        raise ImageValidationError(
            "Uploaded file bytes do not match a valid PNG, JPEG, WEBP, or GIF image header."
        )

    return normalized_type, decoded


def fetch_public_job_webpage(
    url: str, timeout_seconds: float, client: httpx.Client | None = None
) -> tuple[ExtractedJobFields | None, str]:
    """Retrieve public job page content ONLY when access is permitted.

    Never bypasses login walls, CAPTCHAs, OTPs, or 401/403/429 status codes.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None, "Invalid URL scheme or hostname."

    headers = {
        "User-Agent": "JobPilotAI-Inspector/0.2 (+https://localhost; PublicJobMetadataReader)",
        "Accept": "text/html,application/xhtml+xml",
    }

    should_close = client is None
    http_client = client or httpx.Client(
        timeout=timeout_seconds, follow_redirects=True, headers=headers
    )
    try:
        resp = http_client.get(url, headers=headers)
    except httpx.TimeoutException:
        return None, f"Timed out after {timeout_seconds}s while requesting public job URL."
    except httpx.RequestError as exc:
        return None, f"Network request to public job URL failed: {exc.__class__.__name__}."
    finally:
        if should_close:
            http_client.close()

    if resp.status_code in (401, 403, 407, 429, 451):
        return (
            None,
            f"Access restricted by remote host (HTTP {resp.status_code}). "
            "JobPilot AI respects website restrictions and does not bypass login or anti-bot walls.",
        )

    if resp.status_code >= 400:
        return None, f"Job URL returned HTTP {resp.status_code}."

    content_type = resp.headers.get("content-type", "").lower()
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        return None, f"URL did not return HTML content (received '{content_type}')."

    html_text = resp.text[:200_000]
    lower_html = html_text.lower()

    # Check for login wall or CAPTCHA challenge indicators
    if (
        "captcha" in lower_html and ("challenge" in lower_html or "verify you are human" in lower_html)
    ) or ("sign in to view" in lower_html):
        return (
            None,
            "Page requires interactive login or CAPTCHA verification. "
            "Skipped extraction in compliance with safety rules.",
        )

    extracted = _parse_public_html_metadata(html_text, url)
    return extracted, "Public webpage metadata retrieved successfully."


def _parse_public_html_metadata(html_text: str, url: str) -> ExtractedJobFields:
    fields = ExtractedJobFields(application_url=url)

    # 1. Try JSON-LD JobPosting schema if present
    json_ld_matches = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for raw_block in json_ld_matches:
        try:
            data = json.loads(raw_block.strip())
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict) and item.get("@type") == "JobPosting":
                    fields.title = _clean_str(item.get("title")) or fields.title
                    org = item.get("hiringOrganization")
                    if isinstance(org, dict):
                        fields.company = _clean_str(org.get("name")) or fields.company
                    loc = item.get("jobLocation")
                    if isinstance(loc, dict):
                        addr = loc.get("address")
                        if isinstance(addr, dict):
                            loc_parts = [
                                _clean_str(addr.get("addressLocality")),
                                _clean_str(addr.get("addressRegion")),
                                _clean_str(addr.get("addressCountry")),
                            ]
                            fields.location = (
                                ", ".join([p for p in loc_parts if p]) or fields.location
                            )
                    desc_html = _clean_str(item.get("description"))
                    if desc_html:
                        clean_desc = _strip_html_tags(desc_html)
                        fields.summary_description = clean_desc[:2000]
                        text_parsed = parse_job_text_deterministically(clean_desc)
                        if not fields.salary and text_parsed.salary:
                            fields.salary = text_parsed.salary
                        if not fields.experience and text_parsed.experience:
                            fields.experience = text_parsed.experience
                        if not fields.required_skills and text_parsed.required_skills:
                            fields.required_skills = text_parsed.required_skills
                        if not fields.work_mode and text_parsed.work_mode:
                            fields.work_mode = text_parsed.work_mode
        except Exception:
            continue

    # 2. Fallback to <title> and OpenGraph meta tags
    if not fields.title:
        og_title = re.search(
            r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
            html_text,
            flags=re.IGNORECASE,
        )
        if og_title:
            fields.title = _clean_str(html.unescape(og_title.group(1)))
        else:
            title_tag = re.search(
                r"<title[^>]*>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL
            )
            if title_tag:
                fields.title = _clean_str(html.unescape(title_tag.group(1)))

    if not fields.summary_description:
        og_desc = re.search(
            r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+content=["\']([^"\']+)["\']',
            html_text,
            flags=re.IGNORECASE,
        )
        if og_desc:
            fields.summary_description = _clean_str(html.unescape(og_desc.group(1)))

    if fields.summary_description and not fields.required_skills:
        parsed_from_desc = parse_job_text_deterministically(fields.summary_description)
        fields.required_skills = parsed_from_desc.required_skills
        fields.salary = fields.salary or parsed_from_desc.salary
        fields.experience = fields.experience or parsed_from_desc.experience
        fields.work_mode = fields.work_mode or parsed_from_desc.work_mode

    return fields


def parse_job_text_deterministically(text: str) -> ExtractedJobFields:
    """Extract only explicitly present job details from pasted text.

    Unknown or unmentioned fields are returned as `None` (never invented).
    """
    cleaned = text.strip()
    if not cleaned:
        return ExtractedJobFields()

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]

    # Title extraction: explicit "Job Title:" / "Role:" or "hiring a <Role>"
    title: str | None = None
    title_label_match = re.search(
        r"(?:job\s*title|role|position)\s*[:\-]\s*([^\n\r]+)",
        cleaned,
        flags=re.IGNORECASE,
    )
    if title_label_match:
        title = _clean_str(title_label_match.group(1))
    else:
        hiring_match = re.search(
            r"(?:hiring|looking\s+for)\s+(?:a|an)\s+([A-Z][A-Za-z0-9\s\-\/\(\)\+&]{3,65}?)(?:\s+to\s+|\s+at\s+|\s+in\s+|\.|\n|$)",
            cleaned,
        )
        if hiring_match:
            title = _clean_str(hiring_match.group(1))
        elif lines and 4 <= len(lines[0]) <= 75 and not lines[0].endswith("."):
            title = _clean_str(lines[0])

    # Company extraction: explicit "Company:" or "<Company> is hiring/looking for"
    company: str | None = None
    company_label_match = re.search(
        r"(?:company|organization|employer)\s*[:\-]\s*([^\n\r]+)",
        cleaned,
        flags=re.IGNORECASE,
    )
    if company_label_match:
        company = _clean_str(company_label_match.group(1))
    else:
        is_hiring_match = re.search(
            r"^([A-Z][A-Za-z0-9\s\.\-&]{1,45}?)\s+is\s+(?:hiring|looking\s+for)\b",
            cleaned,
            flags=re.MULTILINE,
        )
        if is_hiring_match:
            company = _clean_str(is_hiring_match.group(1))

    # Location extraction
    location: str | None = None
    loc_label_match = re.search(
        r"(?:location|city|based\s+in)\s*[:\-]\s*([^\n\r]+)",
        cleaned,
        flags=re.IGNORECASE,
    )
    if loc_label_match:
        location = _clean_str(loc_label_match.group(1))
    else:
        known_cities = re.search(
            r"\b(Bengaluru|Bangalore|Mumbai|Hyderabad|Pune|Chennai|Gurugram|Gurgaon|Noida|Delhi|Remote\s*\(India\))\b",
            cleaned,
            flags=re.IGNORECASE,
        )
        if known_cities:
            location = known_cities.group(1)

    # Work mode
    work_mode: Any = None
    lower_text = cleaned.lower()
    if "remote" in lower_text and "hybrid" not in lower_text:
        work_mode = "Remote"
    elif "hybrid" in lower_text:
        work_mode = "Hybrid"
    elif "on-site" in lower_text or "onsite" in lower_text:
        work_mode = "On-site"

    # Salary extraction
    salary: str | None = None
    salary_label = re.search(
        r"(?:salary|compensation|ctc|pay)\s*[:\-]\s*([^\n\r]+)",
        cleaned,
        flags=re.IGNORECASE,
    )
    if salary_label:
        salary = _clean_str(salary_label.group(1))
    else:
        currency_match = re.search(
            r"((?:₹|\$|INR|USD)\s?[0-9]+(?:\.[0-9]+)?\s?(?:L|LPA|K|M|Cr)?(?:\s?[\-–to]+\s?(?:₹|\$|INR|USD)?\s?[0-9]+(?:\.[0-9]+)?\s?(?:L|LPA|K|M|Cr)?(?:\s?PA)?)?)",
            cleaned,
            flags=re.IGNORECASE,
        )
        if currency_match:
            salary = _clean_str(currency_match.group(1))

    # Experience extraction
    experience: str | None = None
    exp_match = re.search(
        r"([0-9]+(?:\s?[\-–to]+\s?[0-9]+|\+)\s*(?:years|yrs)(?:\s+of\s+experience)?)",
        cleaned,
        flags=re.IGNORECASE,
    )
    if exp_match:
        experience = _clean_str(exp_match.group(1))

    # Skills extraction
    required_skills: list[str] = []
    for skill in KNOWN_TECH_SKILLS:
        pattern = r"(?<![A-Za-z0-9])" + re.escape(skill) + r"(?![A-Za-z0-9])"
        if re.search(pattern, cleaned, flags=re.IGNORECASE):
            required_skills.append(skill)

    # Contact details (email & phone if explicitly present in text)
    email_match = re.search(
        r"\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b", cleaned
    )
    phone_match = re.search(
        r"(\+?[0-9]{1,3}[\s\-]?[6-9][0-9]{4}[\s\-]?[0-9]{5})", cleaned
    )
    recruiter_name: str | None = None
    recruiter_match = re.search(
        r"(?:recruiter|contact|hiring\s+manager)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})",
        cleaned,
    )
    if recruiter_match:
        recruiter_name = _clean_str(recruiter_match.group(1))

    # URL in text if present
    url_match = re.search(r"(https?://[^\s\)\]\>\"']+)", cleaned)
    app_url = url_match.group(1) if url_match else None

    return ExtractedJobFields(
        title=title,
        company=company,
        location=location,
        work_mode=work_mode,
        salary=salary,
        experience=experience,
        required_skills=required_skills,
        application_url=app_url,
        contact=ContactDetails(
            recruiter_name=recruiter_name,
            recruiter_email=email_match.group(1) if email_match else None,
            recruiter_phone=phone_match.group(1) if phone_match else None,
        ),
        summary_description=cleaned[:4000],
    )


def call_vision_ai_provider(
    settings: BackendSettings,
    image_mime: str | None,
    image_bytes: bytes | None,
    text_context: str,
    client: httpx.Client | None = None,
) -> ExtractedJobFields:
    """Call configured Gemini or OpenAI vision/structured extraction endpoint.

    Raises `ProviderExtractionError` on timeout, HTTP error, or malformed JSON output.
    """
    system_instruction = (
        "You are a precise job-posting information extractor. "
        "Extract ONLY facts explicitly visible in the provided job screenshot and/or text. "
        "NEVER guess or fabricate values. If any field is not explicitly present, set it to null. "
        "Return strict JSON matching this exact structure: "
        '{"title": string|null, "company": string|null, "location": string|null, '
        '"work_mode": "Remote"|"Hybrid"|"On-site"|null, "salary": string|null, '
        '"experience": string|null, "required_skills": string[], '
        '"application_url": string|null, "recruiter_name": string|null, '
        '"recruiter_title": string|null, "recruiter_email": string|null, '
        '"recruiter_phone": string|null, "summary_description": string|null}'
    )

    should_close = client is None
    http_client = client or httpx.Client(timeout=settings.http_timeout_seconds)

    try:
        if settings.ai_provider == "gemini" and settings.gemini_api_key:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{settings.gemini_model}:generateContent"
            )
            parts: list[dict[str, Any]] = [{"text": system_instruction}]
            if text_context.strip():
                parts.append({"text": f"Job Text Context:\n{text_context[:12000]}"})
            if image_bytes and image_mime:
                parts.append(
                    {
                        "inline_data": {
                            "mime_type": image_mime,
                            "data": base64.b64encode(image_bytes).decode("ascii"),
                        }
                    }
                )
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"responseMimeType": "application/json"},
            }
            resp = http_client.post(
                url,
                params={"key": settings.gemini_api_key},
                json=payload,
            )
            if resp.status_code >= 400:
                raise ProviderExtractionError(
                    f"Gemini API returned HTTP {resp.status_code}."
                )
            body = resp.json()
            raw_json_text = (
                body.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            return _parse_provider_json(raw_json_text)

        if settings.ai_provider == "openai" and settings.openai_api_key:
            url = "https://api.openai.com/v1/chat/completions"
            user_content: list[dict[str, Any]] = []
            if text_context.strip():
                user_content.append(
                    {"type": "text", "text": f"Job Text Context:\n{text_context[:12000]}"}
                )
            if image_bytes and image_mime:
                b64_str = base64.b64encode(image_bytes).decode("ascii")
                user_content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{image_mime};base64,{b64_str}"},
                    }
                )
            payload = {
                "model": settings.openai_model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_content or "Extract job fields."},
                ],
            }
            resp = http_client.post(
                url,
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json=payload,
            )
            if resp.status_code >= 400:
                raise ProviderExtractionError(
                    f"OpenAI API returned HTTP {resp.status_code}."
                )
            body = resp.json()
            raw_json_text = (
                body.get("choices", [{}])[0].get("message", {}).get("content", "")
            )
            return _parse_provider_json(raw_json_text)

        raise ProviderExtractionError("No vision/LLM provider is configured.")
    except httpx.TimeoutException as exc:
        raise ProviderExtractionError(
            f"AI provider request timed out after {settings.http_timeout_seconds}s."
        ) from exc
    except httpx.RequestError as exc:
        raise ProviderExtractionError(
            f"AI provider network error: {exc.__class__.__name__}."
        ) from exc
    finally:
        if should_close:
            http_client.close()


def _parse_provider_json(raw_text: str) -> ExtractedJobFields:
    if not raw_text or not raw_text.strip():
        raise ProviderExtractionError("AI provider returned an empty response payload.")
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?|```$", "", cleaned, flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(cleaned)
    except Exception as exc:
        raise ProviderExtractionError(
            "AI provider returned malformed JSON output."
        ) from exc

    if not isinstance(parsed, dict):
        raise ProviderExtractionError("AI provider JSON root must be an object.")

    work_mode = parsed.get("work_mode")
    if work_mode not in ("Remote", "Hybrid", "On-site"):
        work_mode = None

    raw_skills = parsed.get("required_skills")
    skills = (
        [str(s).strip() for s in raw_skills if str(s).strip()]
        if isinstance(raw_skills, list)
        else []
    )

    return ExtractedJobFields(
        title=_clean_str(parsed.get("title")),
        company=_clean_str(parsed.get("company")),
        location=_clean_str(parsed.get("location")),
        work_mode=work_mode,
        salary=_clean_str(parsed.get("salary")),
        experience=_clean_str(parsed.get("experience")),
        required_skills=skills,
        application_url=_clean_str(parsed.get("application_url")),
        contact=ContactDetails(
            recruiter_name=_clean_str(parsed.get("recruiter_name")),
            recruiter_title=_clean_str(parsed.get("recruiter_title")),
            recruiter_email=_clean_str(parsed.get("recruiter_email")),
            recruiter_phone=_clean_str(parsed.get("recruiter_phone")),
        ),
        summary_description=_clean_str(parsed.get("summary_description")),
    )


def merge_extractions_with_provenance(
    request: JobAnalyzeRequest,
    vision_fields: ExtractedJobFields | None,
    webpage_fields: ExtractedJobFields | None,
    text_fields: ExtractedJobFields | None,
) -> tuple[ExtractedJobFields, FieldProvenanceMap]:
    """Merge extracted fields across sources and record exact provenance per field.

    Priority order:
    1. Explicit user hints (`user_input`)
    2. Vision AI screenshot extraction (`screenshot_vision`)
    3. Public webpage metadata (`webpage_public`)
    4. Deterministic pasted description extraction (`pasted_description`)
    5. Otherwise `None` with provenance `"missing"`
    """
    final = ExtractedJobFields()
    prov = FieldProvenanceMap()

    def pick_scalar(
        attr: str,
        user_val: str | None = None,
    ) -> tuple[str | None, ProvenanceSourceLiteral]:
        if _clean_str(user_val):
            return _clean_str(user_val), "user_input"
        if vision_fields and _clean_str(getattr(vision_fields, attr, None)):
            return _clean_str(getattr(vision_fields, attr)), "screenshot_vision"
        if webpage_fields and _clean_str(getattr(webpage_fields, attr, None)):
            return _clean_str(getattr(webpage_fields, attr)), "webpage_public"
        if text_fields and _clean_str(getattr(text_fields, attr, None)):
            return _clean_str(getattr(text_fields, attr)), "pasted_description"
        return None, "missing"

    final.title, prov.title = pick_scalar("title", request.title_hint)
    final.company, prov.company = pick_scalar("company", request.company_hint)
    final.location, prov.location = pick_scalar("location", request.location_hint)
    final.salary, prov.salary = pick_scalar("salary", request.salary_hint)
    final.experience, prov.experience = pick_scalar(
        "experience", request.experience_hint
    )
    final.application_url, prov.application_url = pick_scalar(
        "application_url", request.application_url
    )

    # Work mode
    for candidate in (vision_fields, webpage_fields, text_fields):
        if candidate and candidate.work_mode:
            final.work_mode = candidate.work_mode
            break

    # Required skills (combine unique skills preserving order)
    combined_skills: list[str] = []
    skills_prov: ProvenanceSourceLiteral = "missing"
    for source_obj, source_tag in (
        (vision_fields, "screenshot_vision"),
        (webpage_fields, "webpage_public"),
        (text_fields, "pasted_description"),
    ):
        if source_obj and source_obj.required_skills:
            if skills_prov == "missing":
                skills_prov = source_tag  # type: ignore[assignment]
            for s in source_obj.required_skills:
                if not any(existing.lower() == s.lower() for existing in combined_skills):
                    combined_skills.append(s)
    final.required_skills = combined_skills
    prov.required_skills = skills_prov

    # Contact details
    for source_obj, source_tag in (
        (vision_fields, "screenshot_vision"),
        (webpage_fields, "webpage_public"),
        (text_fields, "pasted_description"),
    ):
        if source_obj and any(
            [
                source_obj.contact.recruiter_name,
                source_obj.contact.recruiter_email,
                source_obj.contact.recruiter_phone,
            ]
        ):
            final.contact = source_obj.contact
            prov.contact = source_tag  # type: ignore[assignment]
            break

    # Summary description
    for source_obj in (text_fields, vision_fields, webpage_fields):
        if source_obj and source_obj.summary_description:
            final.summary_description = source_obj.summary_description
            break

    return final, prov


def evaluate_skill_match(
    extracted: ExtractedJobFields,
    candidate: CandidateProfileSnapshot | None,
) -> SkillMatchEvaluation:
    profile_skills = candidate.skills if candidate and candidate.skills else []
    req_skills = extracted.required_skills

    if not req_skills:
        return SkillMatchEvaluation(
            match_score=50,
            matched_skills=[],
            missing_skills=[],
            match_summary=(
                "No explicit technical skills were detected in the job input. "
                "Add a full job description or review the required skills before saving."
            ),
            is_heuristic=True,
        )

    profile_lower = {s.lower() for s in profile_skills}
    matched = [s for s in req_skills if s.lower() in profile_lower]
    missing = [s for s in req_skills if s.lower() not in profile_lower]

    ratio = len(matched) / len(req_skills)
    score = min(98, max(35, round(45 + ratio * 52)))

    return SkillMatchEvaluation(
        match_score=score,
        matched_skills=matched,
        missing_skills=missing,
        match_summary=(
            f"Matched {len(matched)} of {len(req_skills)} extracted skills against your profile "
            f"({', '.join(matched) if matched else 'none matched'})."
        ),
        is_heuristic=True,
    )


def _clean_str(val: Any) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _strip_html_tags(raw_html: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", raw_html)
    return re.sub(r"\s+", " ", html.unescape(no_tags)).strip()
