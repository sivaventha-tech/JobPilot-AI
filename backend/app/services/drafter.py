"""Tailored Application Drafts Service (Cover Letter & Portal Q&A).

Anti-Fabrication & Grounding Rules:
-----------------------------------
- Uses ONLY verified candidate profile data (`CandidateProfileSnapshot`) and extracted job details (`ExtractedJobFields`).
- NEVER invents:
  - Years of experience
  - Employers or job titles
  - Degrees or academic institutions
  - Certifications
  - Quantitative achievements or metrics not present in the profile
  - Work authorization, visa status, or notice period
- Explicitly flags any draft or question that requires human completion (`needs_user_input=True`,
  `missing_profile_fields=[...]`, and inline `[USER INPUT NEEDED: ...]` markers).
"""

from __future__ import annotations

from app.schemas import (
    CandidateProfileSnapshot,
    DraftQuestionAnswer,
    ExtractedJobFields,
    TailoredDraftsResponse,
)


def generate_tailored_application_drafts(
    extracted_job: ExtractedJobFields,
    candidate_profile: CandidateProfileSnapshot | None,
    custom_questions: list[str] | None = None,
) -> TailoredDraftsResponse:
    """Generate a grounded cover letter and structured Q&A drafts without fabricating facts."""
    profile = candidate_profile or CandidateProfileSnapshot()
    name = (profile.full_name or "").strip() or "[USER INPUT NEEDED: Your Full Name]"
    role_title = (extracted_job.title or "").strip() or "the open role"
    company = (extracted_job.company or "").strip() or "your organization"
    job_location = (extracted_job.location or "").strip()

    req_skills = extracted_job.required_skills or []
    profile_skill_set = {s.strip().lower() for s in profile.skills if s.strip()}
    for proj in profile.projects:
        for t in proj.technologies:
            if t.strip():
                profile_skill_set.add(t.strip().lower())

    matched_skills = [s for s in req_skills if s.strip().lower() in profile_skill_set]
    missing_skills = [s for s in req_skills if s.strip().lower() not in profile_skill_set]
    verified_skills_list = matched_skills or [s for s in profile.skills if s.strip()][:6]

    grounding_warnings: list[str] = []
    cover_letter_needs_input = False

    # --- 1. Build Grounded Cover Letter ---
    cl_paragraphs: list[str] = [f"Dear Hiring Team at {company},"]

    # Opening paragraph
    opening_parts = [f"I am writing to express my interest in the {role_title} position at {company}."]
    if profile.years_of_experience.strip():
        opening_parts.append(
            f"My profile includes {profile.years_of_experience.strip()} of experience"
            + (
                f" working with {', '.join(verified_skills_list[:5])}."
                if verified_skills_list
                else "."
            )
        )
    elif verified_skills_list:
        opening_parts.append(
            f"My technical background includes hands-on work with {', '.join(verified_skills_list[:5])}."
        )
    else:
        cover_letter_needs_input = True
        opening_parts.append(
            "[USER INPUT NEEDED: Add your years of experience and core technical skills in your Candidate Profile.]"
        )
    cl_paragraphs.append(" ".join(opening_parts))

    # Experience / Project Evidence paragraph (strictly from verified profile)
    evidence_sentences: list[str] = []
    if profile.employment_history:
        top_emp = profile.employment_history[0]
        emp_desc = " at ".join(filter(None, [top_emp.title, top_emp.company]))
        if emp_desc:
            sentence = f"In my role as {emp_desc}"
            if top_emp.duration:
                sentence += f" ({top_emp.duration})"
            if top_emp.highlights:
                sentence += f", I focused on: {top_emp.highlights[0]}"
            else:
                sentence += ", I contributed to engineering delivery."
            evidence_sentences.append(sentence)
    if profile.projects:
        top_proj = profile.projects[0]
        proj_tech = f" using {', '.join(top_proj.technologies)}" if top_proj.technologies else ""
        proj_desc = f": {top_proj.description}" if top_proj.description else "."
        evidence_sentences.append(f"Key project experience includes '{top_proj.name}'{proj_tech}{proj_desc}")
    if not evidence_sentences and profile.experience_summary.strip():
        evidence_sentences.append(profile.experience_summary.strip())

    if evidence_sentences:
        cl_paragraphs.append(" ".join(evidence_sentences))
    else:
        cover_letter_needs_input = True
        cl_paragraphs.append(
            "[USER INPUT NEEDED: Add a brief summary of a relevant role or project from your resume—no employer or achievement details were auto-generated.]"
        )

    # Education & Certifications paragraph (only if present in profile)
    edu_parts: list[str] = []
    if profile.education.strip():
        edu_parts.append(f"Education: {profile.education.strip()}.")
    elif profile.education_entries:
        first_edu = profile.education_entries[0]
        edu_str = ", ".join(filter(None, [first_edu.degree, first_edu.institution, first_edu.year]))
        if edu_str:
            edu_parts.append(f"Education: {edu_str}.")
    if profile.certifications:
        edu_parts.append(f"Certifications: {', '.join(profile.certifications)}.")
    if edu_parts:
        cl_paragraphs.append(" ".join(edu_parts))

    # Closing paragraph
    contact_items = [
        c.strip()
        for c in (profile.email, profile.phone, profile.portfolio_or_github_url)
        if c and c.strip()
    ]
    contact_line = f" You can reach me at {' | '.join(contact_items)}." if contact_items else ""
    cl_paragraphs.append(
        f"Thank you for reviewing my application for {role_title} at {company}.{contact_line}\n\nSincerely,\n{name}"
    )

    cover_letter = "\n\n".join(cl_paragraphs)

    # --- 2. Build Grounded Application Questions & Answers ---
    qas: list[DraftQuestionAnswer] = []

    # Q1: Role Motivation & Skill Alignment
    q1_missing: list[str] = []
    q1_sources: list[str] = []
    q1_parts: list[str] = [
        f"I am applying for the {role_title} role at {company}."
    ]
    if profile.years_of_experience.strip():
        q1_parts.append(f"I bring {profile.years_of_experience.strip()} of experience.")
        q1_sources.append("profile.years_of_experience")
    else:
        q1_missing.append("years_of_experience")

    if matched_skills:
        q1_parts.append(
            f"My profile directly matches {len(matched_skills)} of your stated technical skills: {', '.join(matched_skills)}."
        )
        q1_sources.append("profile.skills")
    elif verified_skills_list:
        q1_parts.append(
            f"My verified profile skills include: {', '.join(verified_skills_list)}."
        )
        q1_sources.append("profile.skills")
    else:
        q1_missing.append("skills")
        q1_parts.append(
            "[USER INPUT NEEDED: Specify which of your technical skills align with this role.]"
        )

    if missing_skills:
        q1_missing.append(f"unmentioned_skills ({', '.join(missing_skills)})")
        q1_parts.append(
            f"[USER INPUT NEEDED: The job lists {', '.join(missing_skills)}, which are not mentioned in your current profile. Edit this section if you have verifiable experience with them, or remove this note before approving.]"
        )

    qas.append(
        DraftQuestionAnswer(
            id="qa-draft-1",
            category="Motivation",
            question=f"Why are you a strong fit for the {role_title} role at {company}?",
            answer=" ".join(q1_parts),
            needs_user_input=bool(q1_missing),
            missing_profile_fields=q1_missing,
            grounding_sources=q1_sources,
        )
    )

    # Q2: Relevant Technical Experience & Projects
    q2_missing: list[str] = []
    q2_sources: list[str] = []
    q2_parts: list[str] = []

    if profile.employment_history:
        q2_sources.append("profile.employment_history")
        for emp in profile.employment_history[:2]:
            role_header = " at ".join(filter(None, [emp.title, emp.company])) or "Previous Role"
            dur = f" ({emp.duration})" if emp.duration else ""
            hl_text = " ".join(emp.highlights[:2]) if emp.highlights else "Delivered software engineering tasks."
            q2_parts.append(f"{role_header}{dur}: {hl_text}")
    if profile.projects:
        q2_sources.append("profile.projects")
        for proj in profile.projects[:2]:
            tech_str = f" [{', '.join(proj.technologies)}]" if proj.technologies else ""
            q2_parts.append(
                f"Project — {proj.name}{tech_str}: {proj.description or 'Technical project recorded in profile.'}"
            )
    if not q2_parts and profile.experience_summary.strip():
        q2_sources.append("profile.experience_summary")
        q2_parts.append(profile.experience_summary.strip())

    if not q2_parts:
        q2_missing.extend(["employment_history", "experience_summary"])
        q2_parts.append(
            "[USER INPUT NEEDED: Your profile does not yet contain employment history bullets or an experience summary. Describe a real system or project you have built—JobPilot AI never fabricates employers or achievements.]"
        )

    qas.append(
        DraftQuestionAnswer(
            id="qa-draft-2",
            category="Experience",
            question="Summarize your relevant hands-on experience and projects for this position.",
            answer=" ".join(q2_parts),
            needs_user_input=bool(q2_missing),
            missing_profile_fields=q2_missing,
            grounding_sources=q2_sources,
        )
    )

    # Q3: Logistics, Location, Work Authorization & Notice Period
    q3_missing: list[str] = []
    q3_sources: list[str] = []
    q3_parts: list[str] = []

    if profile.preferred_location.strip():
        q3_sources.append("profile.preferred_location")
        loc_note = f"Preferred location/work mode: {profile.preferred_location.strip()}."
        if job_location:
            loc_note += f" (Job location: {job_location})."
        q3_parts.append(loc_note)
    else:
        q3_missing.append("preferred_location")
        q3_parts.append("[USER INPUT NEEDED: Specify your current/preferred location.]")

    if profile.work_authorization and profile.work_authorization.strip():
        q3_sources.append("profile.work_authorization")
        q3_parts.append(f"Work authorization: {profile.work_authorization.strip()}.")
    else:
        q3_missing.append("work_authorization")
        q3_parts.append(
            "[USER INPUT NEEDED: Confirm your work authorization / visa status for this location.]"
        )

    if profile.notice_period and profile.notice_period.strip():
        q3_sources.append("profile.notice_period")
        q3_parts.append(f"Notice period / availability: {profile.notice_period.strip()}.")
    else:
        q3_missing.append("notice_period")
        q3_parts.append(
            "[USER INPUT NEEDED: Specify your notice period or earliest start date.]"
        )

    qas.append(
        DraftQuestionAnswer(
            id="qa-draft-3",
            category="Logistics",
            question="What is your location preference, work authorization status, and notice period?",
            answer=" ".join(q3_parts),
            needs_user_input=bool(q3_missing),
            missing_profile_fields=q3_missing,
            grounding_sources=q3_sources,
        )
    )

    # Optional custom portal questions
    for idx, custom_q in enumerate(custom_questions or [], start=4):
        cq_clean = custom_q.strip()
        if not cq_clean:
            continue
        cq_low = cq_clean.lower()
        cq_missing: list[str] = []
        cq_sources: list[str] = []

        if any(k in cq_low for k in ("degree", "education", "university", "college", "gpa")):
            edu_val = profile.education.strip() or (
                f"{profile.education_entries[0].degree} ({profile.education_entries[0].institution or ''})"
                if profile.education_entries
                else ""
            )
            if edu_val:
                cq_sources.append("profile.education")
                ans = f"Education recorded in profile: {edu_val}."
            else:
                cq_missing.append("education")
                ans = "[USER INPUT NEEDED: Provide your degree, institution, and graduation year.]"
        elif any(k in cq_low for k in ("certification", "certified", "license")):
            if profile.certifications:
                cq_sources.append("profile.certifications")
                ans = f"Certifications recorded in profile: {', '.join(profile.certifications)}."
            else:
                cq_missing.append("certifications")
                ans = "[USER INPUT NEEDED: No certifications are listed in your profile. Confirm whether you hold the requested certification.]"
        else:
            cq_missing.append("custom_question_response")
            ans = (
                f"[USER INPUT NEEDED: Please provide your specific answer for '{cq_clean}'. "
                "JobPilot AI leaves custom factual questions for your input rather than guessing.]"
            )

        qas.append(
            DraftQuestionAnswer(
                id=f"qa-draft-{idx}",
                category="Custom",
                question=cq_clean,
                answer=ans,
                needs_user_input=bool(cq_missing),
                missing_profile_fields=cq_missing,
                grounding_sources=cq_sources,
            )
        )

    needs_input_count = sum(1 for q in qas if q.needs_user_input)
    if needs_input_count > 0:
        grounding_warnings.append(
            f"{needs_input_count} application question(s) contain '[USER INPUT NEEDED]' placeholders for details not present in your verified profile (e.g., work authorization, notice period, or unmentioned skills). Review and complete them before approving."
        )
    grounding_warnings.append(
        "All drafts were generated strictly from your verified profile fields without inventing employers, years of experience, degrees, certifications, or achievements."
    )

    return TailoredDraftsResponse(
        cover_letter=cover_letter,
        cover_letter_needs_user_input=cover_letter_needs_input,
        questions_and_answers=qas,
        grounding_warnings=grounding_warnings,
    )
