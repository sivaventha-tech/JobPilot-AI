"""Explainable Deterministic Job Matching Service.

Documented Scoring Algorithm:
-----------------------------
The match score (0–100) is computed deterministically as a weighted linear combination
of four normalized component scores (each in [0, 100]):

1. Skills Alignment (`skills_score`, default weight = 0.55):
   - Compares `extracted_job.required_skills` against the candidate's verified skills
     plus skills evidenced in `employment_history` and `projects`.
   - If `required_skills` is non-empty:
       `skills_score = (len(matched_skills) / len(required_skills)) * 100`
   - If `required_skills` is empty (job input did not specify technical skills):
       `skills_score = 50.0` (neutral baseline; noted in limitations).

2. Experience Alignment (`experience_score`, default weight = 0.25):
   - Parses minimum required years of experience from `extracted_job.experience`
     or `extracted_job.summary_description` (e.g., "4 - 6 years" -> min 4.0 years).
   - Parses candidate years of experience from `candidate_profile.years_of_experience`.
   - Also extracts relevant experience evidence lines from `employment_history`,
     `projects`, and `experience_summary`.
   - Scoring:
     - If job specifies required years and candidate specifies years:
       - `candidate_years >= required_min_years`: `100.0` (`status = "aligned"`)
       - `candidate_years < required_min_years`: proportional ratio `max(20.0, (candidate_years / required_min_years) * 85.0)`
         (`status = "partial_or_below"`)
     - If job specifies required years but candidate profile does not mention years:
       - `45.0` if relevant employment/project evidence exists, else `30.0`
         (`status = "not_mentioned_in_resume"`)
     - If job does not specify required years:
       - `85.0` if candidate has experience evidence, else `60.0`
         (`status = "not_explicitly_required"`)

3. Education & Certification Alignment (`education_certs_score`, default weight = 0.10):
   - Scans `extracted_job.summary_description` for explicit degree requirements
     (e.g., Bachelor's/B.Tech/B.S., Master's/M.Tech/M.S., Ph.D.) and explicit
     certifications (e.g., AWS Certified, CKA, PMP, Security+).
   - If no degree/certification is explicitly required by the job:
     - `100.0` (`status = "not_explicitly_required"`)
   - If required by the job:
     - All matched in candidate `education` / `education_entries` / `certifications`: `100.0` (`status = "aligned"`)
     - Candidate has not provided education/certification fields on their resume: `40.0` (`status = "not_mentioned_in_resume"`)
     - Candidate provided education/certifications that do not include the required credential: `20.0` (`status = "explicitly_missing"`)

4. Role & Location Alignment (`role_location_score`, default weight = 0.10):
   - Evaluates overlap between `extracted_job.title` and `candidate_profile.preferred_role` (up to 60 pts)
     and between `extracted_job.location` / `work_mode` and `candidate_profile.preferred_location` (up to 40 pts).

Guardrails:
- Never uses an LLM's unsupported numerical opinion.
- Explicitly distinguishes qualifications not mentioned in the resume (`not_mentioned_in_resume`)
  from qualifications where the candidate is explicitly below/missing a stated requirement (`explicitly_missing` / `partial_or_below`).
- Never invents candidate qualifications or guarantees hiring outcomes.
"""

from __future__ import annotations

import re

from app.config import BackendSettings
from app.schemas import (
    CandidateProfileSnapshot,
    EducationCertAlignment,
    ExtractedJobFields,
    ScoreComponentBreakdown,
    SkillGapItem,
    SkillMatchEvaluation,
)


def evaluate_explainable_job_match(
    extracted: ExtractedJobFields,
    candidate: CandidateProfileSnapshot | None,
    settings: BackendSettings | None = None,
    weights_override: dict[str, float] | None = None,
) -> SkillMatchEvaluation:
    """Compute an explainable, deterministic 0–100 match evaluation."""
    cfg = settings or BackendSettings()
    profile = candidate or CandidateProfileSnapshot()

    raw_weights = {
        "skills": cfg.match_weight_skills,
        "experience": cfg.match_weight_experience,
        "education_certs": cfg.match_weight_education_certs,
        "role_location": cfg.match_weight_role_location,
    }
    if weights_override:
        for k in raw_weights:
            if k in weights_override and weights_override[k] >= 0:
                raw_weights[k] = float(weights_override[k])

    weight_sum = sum(raw_weights.values())
    if weight_sum <= 0:
        weights = {
            "skills": 0.55,
            "experience": 0.25,
            "education_certs": 0.10,
            "role_location": 0.10,
        }
    else:
        weights = {k: round(v / weight_sum, 4) for k, v in raw_weights.items()}

    limitations: list[str] = [
        "Score is computed deterministically from extracted job fields and your current profile; it never guarantees hiring outcomes."
    ]

    # --- 1. Skills Component ---
    req_skills = extracted.required_skills or []
    candidate_skill_pool: set[str] = {s.strip().lower() for s in profile.skills if s.strip()}
    for proj in profile.projects:
        for tech in proj.technologies:
            if tech.strip():
                candidate_skill_pool.add(tech.strip().lower())

    # Check if any skills are mentioned in employment highlights or experience summary
    supplemental_text = " ".join(
        [profile.experience_summary]
        + [h for emp in profile.employment_history for h in emp.highlights]
        + [proj.description or "" for proj in profile.projects]
    ).lower()

    matched_skills: list[str] = []
    missing_skills: list[str] = []
    uncertain_or_unmentioned: list[SkillGapItem] = []

    has_any_profile_skills = bool(candidate_skill_pool or supplemental_text.strip())

    for req_skill in req_skills:
        req_low = req_skill.strip().lower()
        if req_low in candidate_skill_pool or (
            len(req_low) >= 2
            and re.search(
                r"(?<![a-zA-Z0-9])" + re.escape(req_low) + r"(?![a-zA-Z0-9])",
                supplemental_text,
            )
        ):
            matched_skills.append(req_skill)
        else:
            missing_skills.append(req_skill)
            if not has_any_profile_skills:
                uncertain_or_unmentioned.append(
                    SkillGapItem(
                        skill=req_skill,
                        status="not_mentioned_in_resume",
                        detail=(
                            f"'{req_skill}' is required by the job, and your profile currently has no skills listed."
                        ),
                    )
                )
            else:
                uncertain_or_unmentioned.append(
                    SkillGapItem(
                        skill=req_skill,
                        status="not_mentioned_in_resume",
                        detail=(
                            f"'{req_skill}' is required by the job but is not mentioned in your resume/profile. "
                            "Add it to your profile only if you have verifiable experience with it."
                        ),
                    )
                )

    if req_skills:
        skills_score = round((len(matched_skills) / len(req_skills)) * 100.0, 1)
    else:
        skills_score = 50.0
        limitations.append(
            "No explicit required technical skills were extracted from the job posting; skills component defaulted to a neutral 50/100."
        )

    # --- 2. Experience Component & Evidence ---
    req_min_years = _parse_min_years(extracted.experience) or _parse_min_years(
        extracted.summary_description
    )
    cand_years = _parse_candidate_years(profile.years_of_experience)

    experience_evidence = _collect_experience_evidence(profile, matched_skills, extracted.title)

    if req_min_years is not None:
        if cand_years is not None:
            if cand_years >= req_min_years:
                experience_score = 100.0
                exp_status = "aligned"
                experience_evidence.insert(
                    0,
                    f"Candidate reports {cand_years:g} years of experience, meeting the stated {req_min_years:g}+ years requirement.",
                )
            else:
                ratio_exp = max(0.20, min(0.90, cand_years / req_min_years))
                experience_score = round(ratio_exp * 85.0, 1)
                exp_status = "partial_or_below"
                experience_evidence.insert(
                    0,
                    f"Candidate reports {cand_years:g} years of experience, which is below the stated {req_min_years:g}+ years requirement.",
                )
                limitations.append(
                    f"Explicit experience gap: job specifies {req_min_years:g}+ years while profile states {cand_years:g} years."
                )
        else:
            exp_status = "not_mentioned_in_resume"
            experience_score = 45.0 if experience_evidence else 30.0
            limitations.append(
                f"Job requires {req_min_years:g}+ years of experience, but total years of experience is not mentioned in your profile."
            )
    else:
        exp_status = "not_explicitly_required"
        if cand_years is not None or experience_evidence:
            experience_score = 85.0
            if cand_years is not None:
                experience_evidence.insert(
                    0,
                    f"Candidate reports {cand_years:g} years of experience (job posting did not specify a strict minimum year count).",
                )
        else:
            experience_score = 60.0

    # --- 3. Education & Certifications Component ---
    edu_alignment, edu_score = _evaluate_education_and_certs(
        job_text=f"{extracted.summary_description or ''} {extracted.title or ''}",
        profile=profile,
    )
    if edu_alignment.status in ("not_mentioned_in_resume", "explicitly_missing"):
        limitations.append(edu_alignment.summary)

    # --- 4. Role & Location Component ---
    role_loc_score = _evaluate_role_and_location(extracted, profile)

    # --- Weighted Total Score (0–100) ---
    weighted_raw = (
        skills_score * weights["skills"]
        + experience_score * weights["experience"]
        + edu_score * weights["education_certs"]
        + role_loc_score * weights["role_location"]
    )
    final_score = int(max(0, min(100, round(weighted_raw))))

    breakdown = ScoreComponentBreakdown(
        skills_score=skills_score,
        experience_score=experience_score,
        education_certs_score=edu_score,
        role_location_score=role_loc_score,
        weights_used=weights,
    )

    if req_skills:
        match_summary = (
            f"Explainable Match ({final_score}%): Matched {len(matched_skills)} of {len(req_skills)} "
            f"required skills ({', '.join(matched_skills) if matched_skills else 'none'}). "
            f"Experience alignment: {exp_status.replace('_', ' ')}."
        )
    else:
        match_summary = (
            f"Explainable Match ({final_score}%): No explicit technical skills were listed in the job input; "
            f"evaluated experience ({exp_status.replace('_', ' ')}) and role/location alignment."
        )

    explanation = (
        f"Score {final_score}/100 calculated using deterministic weights: "
        f"Skills {skills_score:.0f}/100 (×{weights['skills']:.2f}), "
        f"Experience {experience_score:.0f}/100 (×{weights['experience']:.2f}), "
        f"Education/Certs {edu_score:.0f}/100 (×{weights['education_certs']:.2f}), "
        f"Role/Location {role_loc_score:.0f}/100 (×{weights['role_location']:.2f})."
    )

    return SkillMatchEvaluation(
        match_score=final_score,
        matched_skills=matched_skills,
        missing_skills=missing_skills,
        uncertain_or_unmentioned_skills=uncertain_or_unmentioned,
        relevant_experience_evidence=experience_evidence,
        experience_alignment_status=exp_status,  # type: ignore[arg-type]
        education_certification_alignment=edu_alignment,
        score_breakdown=breakdown,
        match_summary=match_summary,
        explanation=explanation,
        limitations=limitations,
        is_heuristic=False,
    )


def _parse_min_years(text: str | None) -> float | None:
    if not text:
        return None
    m = re.search(
        r"\b(\d{1,2}(?:\.\d)?)\s*(?:\+|[\-–—to]+\s*\d{1,2}(?:\.\d)?)?\s*(?:years|yrs)\b",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _parse_candidate_years(text: str | None) -> float | None:
    if not text:
        return None
    m = re.search(r"(\d{1,2}(?:\.\d)?)", text)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _collect_experience_evidence(
    profile: CandidateProfileSnapshot,
    matched_skills: list[str],
    job_title: str | None,
) -> list[str]:
    evidence: list[str] = []
    skill_tokens = [s.lower() for s in matched_skills]
    title_tokens = [
        w.lower()
        for w in re.split(r"\W+", job_title or "")
        if len(w) >= 4 and w.lower() not in ("senior", "junior", "role", "with")
    ]

    for emp in profile.employment_history:
        header = " at ".join(filter(None, [emp.title, emp.company]))
        if emp.duration:
            header = f"{header} ({emp.duration})" if header else emp.duration
        matched_hl = [
            hl
            for hl in emp.highlights
            if any(tok in hl.lower() for tok in skill_tokens + title_tokens)
        ]
        if matched_hl:
            prefix = f"[{header}] " if header else ""
            evidence.append(f"{prefix}{matched_hl[0]}")
        elif header:
            evidence.append(f"Employment record: {header}")

    for proj in profile.projects:
        overlap = [
            t for t in proj.technologies if t.lower() in skill_tokens
        ]
        if overlap or (
            proj.description
            and any(tok in proj.description.lower() for tok in skill_tokens)
        ):
            tech_note = f" ({', '.join(proj.technologies)})" if proj.technologies else ""
            evidence.append(
                f"Project '{proj.name}'{tech_note}: {proj.description or 'Relevant technical project'}"
            )

    if not evidence and profile.experience_summary.strip():
        evidence.append(f"Profile summary: {profile.experience_summary.strip()[:220]}")

    return evidence[:5]


def _evaluate_education_and_certs(
    job_text: str,
    profile: CandidateProfileSnapshot,
) -> tuple[EducationCertAlignment, float]:
    lower_job = job_text.lower()
    required_creds: list[str] = []

    # Check explicit degree requirements in job text
    if re.search(
        r"\b(ph\.?d\.?|doctorate)\b",
        lower_job,
    ):
        required_creds.append("Ph.D. / Doctorate")
    elif re.search(
        r"\b(master(?:'s)?|m\.?tech|m\.?s\.?|m\.?sc)\s+(?:degree|in\s+computer|required)\b",
        lower_job,
    ):
        required_creds.append("Master's Degree (M.Tech / M.S.)")
    elif re.search(
        r"\b(bachelor(?:'s)?|b\.?tech|b\.?e\.?|b\.?s\.?|degree\s+in\s+computer\s+science)\b",
        lower_job,
    ):
        required_creds.append("Bachelor's Degree (B.Tech / B.E. / B.S.)")

    # Check explicit certification requirements in job text
    for cert_m in re.finditer(
        r"\b(AWS\s+Certified\s+[A-Za-z\s\-]+|CKA|CKAD|Certified\s+Kubernetes\s+[A-Za-z\s]+|PMP|CompTIA\s+Security\+|SOC\s*2)\b",
        job_text,
        re.IGNORECASE,
    ):
        c_val = cert_m.group(1).strip()
        if not any(rc.lower() == c_val.lower() for rc in required_creds):
            required_creds.append(c_val)

    if not required_creds:
        return (
            EducationCertAlignment(
                status="not_explicitly_required",
                required_credentials=[],
                matched_credentials=[],
                missing_or_unmentioned_credentials=[],
                summary="Job posting does not state an explicit degree or certification requirement.",
            ),
            100.0,
        )

    candidate_edu_text = " ".join(
        [profile.education]
        + [f"{e.degree} {e.institution or ''}" for e in profile.education_entries]
        + profile.certifications
    ).strip()

    if not candidate_edu_text:
        return (
            EducationCertAlignment(
                status="not_mentioned_in_resume",
                required_credentials=required_creds,
                matched_credentials=[],
                missing_or_unmentioned_credentials=required_creds,
                summary=(
                    f"Job requires {', '.join(required_creds)}, which is not mentioned in your current profile/resume."
                ),
            ),
            40.0,
        )

    cand_lower = candidate_edu_text.lower()
    matched_creds: list[str] = []
    missing_creds: list[str] = []

    for req in required_creds:
        req_low = req.lower()
        if "bachelor" in req_low:
            is_match = any(
                k in cand_lower
                for k in ("b.tech", "btech", "b.e", "b.s", "bachelor", "m.tech", "m.s", "master", "ph.d")
            )
        elif "master" in req_low:
            is_match = any(
                k in cand_lower for k in ("m.tech", "mtech", "m.s", "m.sc", "master", "ph.d")
            )
        elif "ph.d" in req_low:
            is_match = any(k in cand_lower for k in ("ph.d", "phd", "doctorate"))
        else:
            is_match = req_low in cand_lower

        if is_match:
            matched_creds.append(req)
        else:
            missing_creds.append(req)

    if not missing_creds:
        return (
            EducationCertAlignment(
                status="aligned",
                required_credentials=required_creds,
                matched_credentials=matched_creds,
                missing_or_unmentioned_credentials=[],
                summary=f"Candidate education/certifications match required credentials ({', '.join(matched_creds)}).",
            ),
            100.0,
        )

    score = round((len(matched_creds) / len(required_creds)) * 80.0 + 20.0, 1)
    return (
        EducationCertAlignment(
            status="explicitly_missing",
            required_credentials=required_creds,
            matched_credentials=matched_creds,
            missing_or_unmentioned_credentials=missing_creds,
            summary=(
                f"Candidate profile lists education/certifications but does not include {', '.join(missing_creds)}."
            ),
        ),
        score,
    )


def _evaluate_role_and_location(
    extracted: ExtractedJobFields,
    profile: CandidateProfileSnapshot,
) -> float:
    score = 0.0
    # Role alignment (up to 60 pts)
    if extracted.title and profile.preferred_role:
        job_tokens = {
            w.lower()
            for w in re.split(r"\W+", extracted.title)
            if len(w) >= 3
        }
        pref_tokens = {
            w.lower()
            for w in re.split(r"\W+", profile.preferred_role)
            if len(w) >= 3
        }
        if job_tokens and pref_tokens:
            overlap = job_tokens & pref_tokens
            score += 60.0 if overlap else 25.0
        else:
            score += 40.0
    else:
        score += 40.0

    # Location / work mode alignment (up to 40 pts)
    job_loc = f"{extracted.location or ''} {extracted.work_mode or ''}".lower().strip()
    pref_loc = (profile.preferred_location or "").lower().strip()
    if job_loc and pref_loc:
        if "remote" in job_loc and "remote" in pref_loc:
            score += 40.0
        else:
            loc_tokens = [
                w for w in re.split(r"\W+", extracted.location or "") if len(w) >= 3
            ]
            if any(tok.lower() in pref_loc for tok in loc_tokens):
                score += 40.0
            else:
                score += 15.0
    else:
        score += 25.0

    return min(100.0, score)
