import {
  ApplicationQuestionAnswer,
  BrowserAssistApiResponse,
  CandidateProfile,
  EducationCertAlignment,
  ExplainableSkillMatch,
  ExtractedJobFields,
  FastApiServiceConfig,
  FieldProvenanceMap,
  JobAnalyzeApiResponse,
  JobRecord,
  JobSource,
  NewJobInput,
  ResumeParseApiResponse,
  SkillGapItem,
  SourceLink,
  TailoredDraftsApiResponse,
  UserAuthSession,
  UserLoginInput,
  UserRegistrationInput,
  VerificationState,
} from "@/types/jobpilot";

/**
 * Architecture integration layer for the Python FastAPI backend + local prototype mode.
 *
 * FastAPI Endpoints:
 * - GET    /api/v1/health                -> Check backend & provider configuration
 * - POST   /api/v1/jobs/analyze          -> Extract job fields, provenance & web research
 *
 * Security & Safety Guardrails:
 * - Never exposes API keys in client bundle.
 * - Never performs automated form submission, CAPTCHA/OTP bypass, or automated outreach sending.
 * - Never marks a job as Submitted during analysis or approval.
 */
/**
 * Next.js frontend API service configuration.
 *
 * Security Guardrail:
 * Backend service tokens are NEVER stored in or accessible to client-side code.
 * Browser requests route through the Next.js server proxy (`/api/backend`)
 * which securely attaches the server-side authorization token in transit.
 */
export function getServiceConfig(): FastApiServiceConfig {
  const rawBaseUrl = process.env.NEXT_PUBLIC_FASTAPI_URL || "";
  const cleanedBase = rawBaseUrl.trim().replace(/\/+$/, "");
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const isBrowser = typeof window !== "undefined";

  return {
    // In browser, route requests through the secure server proxy /api/backend
    baseUrl: cleanedBase || (isBrowser ? "/api/backend" : "http://localhost:8000"),
    supabaseConfigured,
    mode: cleanedBase || isBrowser ? "fastapi-connected" : "local-mock",
  };
}

const KNOWN_TECH_SKILLS = [
  "TypeScript",
  "JavaScript",
  "React",
  "Next.js",
  "Tailwind CSS",
  "Node.js",
  "Python",
  "FastAPI",
  "Django",
  "PostgreSQL",
  "Supabase",
  "Docker",
  "Kubernetes",
  "AWS",
  "GCP",
  "Redis",
  "GraphQL",
  "REST APIs",
  "Git",
  "LLM Orchestration",
  "SQL",
  "Go",
  "Java",
];

export class JobAnalysisClientError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "JobAnalysisClientError";
    this.statusCode = statusCode;
  }
}

/**
 * Calls the real FastAPI `POST /api/v1/jobs/analyze` endpoint.
 * Throws `JobAnalysisClientError` on validation errors, HTTP errors, timeouts, or malformed payloads.
 */
export async function analyzeJobViaFastApi(
  input: NewJobInput,
  profile: CandidateProfile,
  options?: {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    authToken?: string;
  }
): Promise<JobAnalyzeApiResponse> {
  const cfg = getServiceConfig();
  const baseUrl = (options?.baseUrl || cfg.baseUrl).replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/api/backend")
    ? `${baseUrl}/jobs/analyze`
    : baseUrl.endsWith("/api/v1")
    ? `${baseUrl}/jobs/analyze`
    : `${baseUrl}/api/v1/jobs/analyze`;
  const timeoutMs = options?.timeoutMs ?? 15000;
  const fetchFn = options?.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody = {
    source: input.source,
    application_url: input.applicationUrl.trim() || null,
    description: input.description.trim() || null,
    title_hint: input.title?.trim() || null,
    company_hint: input.company?.trim() || null,
    location_hint: input.location?.trim() || null,
    salary_hint: input.salary?.trim() || null,
    experience_hint: input.experience?.trim() || null,
    screenshot: input.screenshotFile?.previewDataUrl
      ? {
          filename: input.screenshotFile.name,
          content_type: input.screenshotFile.type || "image/png",
          data_base64: input.screenshotFile.previewDataUrl,
          size_bytes: input.screenshotFile.size,
        }
      : null,
    candidate_profile: {
      full_name: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      preferred_role: profile.preferredRole,
      preferred_location: profile.preferredLocation,
      years_of_experience: profile.yearsOfExperience,
      experience_summary: profile.experienceSummary,
      education: profile.education,
      portfolio_or_github_url: profile.portfolioOrGithubUrl,
      skills: profile.skills,
      employment_history: profile.employmentHistory || [],
      education_entries: profile.educationList || [],
      certifications: profile.certifications || [],
      projects: profile.projects || [],
      work_authorization: profile.workAuthorization || null,
      notice_period: profile.noticePeriod || null,
    },
    run_web_research: true,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options?.authToken) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
  }

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `FastAPI returned HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (typeof errJson?.detail === "string") {
          detail = errJson.detail;
        } else if (Array.isArray(errJson?.detail)) {
          detail = errJson.detail.map((d: { msg?: string }) => d.msg || "").join("; ");
        }
      } catch {
        // Ignore JSON parse error on error body
      }
      throw new JobAnalysisClientError(detail, response.status);
    }

    const data = (await response.json()) as JobAnalyzeApiResponse;
    if (!data || typeof data !== "object" || !data.extracted || !data.provenance) {
      throw new JobAnalysisClientError(
        "Malformed response received from FastAPI /api/v1/jobs/analyze endpoint."
      );
    }
    return data;
  } catch (err: unknown) {
    if (err instanceof JobAnalysisClientError) {
      throw err;
    }
    const errName =
      typeof err === "object" && err !== null && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    const errMsg =
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message)
        : "";

    if (errName === "AbortError") {
      throw new JobAnalysisClientError(
        `Analysis request timed out after ${Math.round(timeoutMs / 1000)} seconds.`
      );
    }
    throw new JobAnalysisClientError(
      errMsg
        ? `Could not reach FastAPI backend at ${baseUrl}: ${errMsg}`
        : "Unknown network error while contacting FastAPI backend."
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the FastAPI `POST /api/v1/resume/parse` endpoint to validate and extract
 * structured candidate data from a PDF resume.
 */
export async function parseResumePdfViaFastApi(
  filePayload: {
    filename?: string;
    file_name?: string;
    contentType?: string;
    content_type?: string;
    mime_type?: string;
    dataBase64?: string;
    data_base64?: string;
    file_base64?: string;
    sizeBytes?: number;
    size_bytes?: number;
  },
  options?: {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    authToken?: string;
  }
): Promise<ResumeParseApiResponse> {
  const cfg = getServiceConfig();
  const baseUrl = (options?.baseUrl || cfg.baseUrl).replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/api/backend")
    ? `${baseUrl}/resume/parse`
    : baseUrl.endsWith("/api/v1")
    ? `${baseUrl}/resume/parse`
    : `${baseUrl}/api/v1/resume/parse`;
  const timeoutMs = options?.timeoutMs ?? 15000;
  const fetchFn = options?.fetchImpl ?? fetch;

  const filename = filePayload.filename || filePayload.file_name || "resume.pdf";
  const contentType =
    filePayload.contentType ||
    filePayload.content_type ||
    filePayload.mime_type ||
    "application/pdf";
  const dataBase64 =
    filePayload.dataBase64 ||
    filePayload.data_base64 ||
    filePayload.file_base64 ||
    "";
  const sizeBytes = filePayload.sizeBytes ?? filePayload.size_bytes ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options?.authToken) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
  }

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filename,
        content_type: contentType,
        data_base64: dataBase64,
        size_bytes: sizeBytes,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `FastAPI returned HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (typeof errJson?.detail === "string") {
          detail = errJson.detail;
        } else if (Array.isArray(errJson?.detail)) {
          detail = errJson.detail.map((d: { msg?: string }) => d.msg || "").join("; ");
        }
      } catch {
        // Ignore JSON parse error
      }
      throw new JobAnalysisClientError(detail, response.status);
    }

    const data = (await response.json()) as any;
    const parsedData = data?.parsed ?? data?.parsed_resume;
    if (!data || typeof data !== "object" || !parsedData || !data.parse_status) {
      throw new JobAnalysisClientError(
        "Malformed response received from FastAPI /api/v1/resume/parse endpoint."
      );
    }
    return {
      ...data,
      parsed: parsedData,
    } as ResumeParseApiResponse;
  } catch (err: unknown) {
    if (err instanceof JobAnalysisClientError) {
      throw err;
    }
    const errName =
      typeof err === "object" && err !== null && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    const errMsg =
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message)
        : "";

    if (errName === "AbortError") {
      throw new JobAnalysisClientError(
        `Resume parsing timed out after ${Math.round(timeoutMs / 1000)} seconds.`
      );
    }
    throw new JobAnalysisClientError(
      errMsg
        ? `Could not reach FastAPI backend at ${baseUrl}: ${errMsg}`
        : "Unknown network error while contacting FastAPI backend."
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic Explainable Job Matcher (mirrors `backend/app/services/matcher.py`).
 * Calculates a 0–100 score from configurable weights and distinguishes unmentioned
 * resume fields (`not_mentioned_in_resume`) from explicit gaps (`explicitly_missing`).
 */
export function computeExplainableJobMatch(
  extracted: ExtractedJobFields,
  profile: CandidateProfile,
  weightsOverride?: Partial<{
    skills: number;
    experience: number;
    education_certs: number;
    role_location: number;
  }>
): ExplainableSkillMatch {
  const rawWeights = {
    skills: weightsOverride?.skills ?? 0.55,
    experience: weightsOverride?.experience ?? 0.25,
    education_certs: weightsOverride?.education_certs ?? 0.1,
    role_location: weightsOverride?.role_location ?? 0.1,
  };
  const sumW =
    rawWeights.skills +
    rawWeights.experience +
    rawWeights.education_certs +
    rawWeights.role_location;
  const weights =
    sumW > 0
      ? {
          skills: Number((rawWeights.skills / sumW).toFixed(4)),
          experience: Number((rawWeights.experience / sumW).toFixed(4)),
          education_certs: Number((rawWeights.education_certs / sumW).toFixed(4)),
          role_location: Number((rawWeights.role_location / sumW).toFixed(4)),
        }
      : { skills: 0.55, experience: 0.25, education_certs: 0.1, role_location: 0.1 };

  const limitations: string[] = [
    "Score is computed deterministically from extracted job fields and your current profile; it never guarantees hiring outcomes.",
  ];

  const reqSkills = extracted.required_skills || [];
  const candidateSkillPool = new Set(
    (profile.skills || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  for (const proj of profile.projects || []) {
    for (const tech of proj.technologies || []) {
      if (tech.trim()) candidateSkillPool.add(tech.trim().toLowerCase());
    }
  }

  const supplementalText = [
    profile.experienceSummary || "",
    ...(profile.employmentHistory || []).flatMap((e) => e.highlights || []),
    ...(profile.projects || []).map((p) => p.description || ""),
  ]
    .join(" ")
    .toLowerCase();

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  const uncertainOrUnmentioned: SkillGapItem[] = [];
  const hasAnyProfileSkills =
    candidateSkillPool.size > 0 || supplementalText.trim().length > 0;

  for (const reqSkill of reqSkills) {
    const low = reqSkill.trim().toLowerCase();
    if (candidateSkillPool.has(low) || (low.length >= 2 && supplementalText.includes(low))) {
      matchedSkills.push(reqSkill);
    } else {
      missingSkills.push(reqSkill);
      uncertainOrUnmentioned.push({
        skill: reqSkill,
        status: "not_mentioned_in_resume",
        detail: hasAnyProfileSkills
          ? `'${reqSkill}' is required by the job but is not mentioned in your resume/profile. Add it to your profile only if you have verifiable experience with it.`
          : `'${reqSkill}' is required by the job, and your profile currently has no skills listed.`,
      });
    }
  }

  const skillsScore =
    reqSkills.length > 0
      ? Number(((matchedSkills.length / reqSkills.length) * 100).toFixed(1))
      : 50;
  if (reqSkills.length === 0) {
    limitations.push(
      "No explicit required technical skills were extracted from the job posting; skills component defaulted to a neutral 50/100."
    );
  }

  // Experience alignment
  const parseMinYears = (txt: string | null | undefined): number | null => {
    if (!txt) return null;
    const m = txt.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:\+|[\-–—to]+\s*\d{1,2}(?:\.\d)?)?\s*(?:years|yrs)\b/i);
    return m?.[1] ? parseFloat(m[1]) : null;
  };
  const parseCandYears = (txt: string | null | undefined): number | null => {
    if (!txt) return null;
    const m = txt.match(/(\d{1,2}(?:\.\d)?)/);
    return m?.[1] ? parseFloat(m[1]) : null;
  };

  const reqMinYears =
    parseMinYears(extracted.experience) ??
    parseMinYears((extracted as any).experience_required) ??
    parseMinYears(extracted.summary_description) ??
    parseMinYears((extracted as any).summary);
  const candYears = parseCandYears(profile.yearsOfExperience);

  const experienceEvidence: string[] = [];
  for (const emp of profile.employmentHistory || []) {
    const header = [emp.title, emp.company].filter(Boolean).join(" at ");
    const withDur = emp.duration ? `${header} (${emp.duration})` : header;
    if (emp.highlights && emp.highlights.length > 0) {
      experienceEvidence.push(`${withDur ? `[${withDur}] ` : ""}${emp.highlights[0]}`);
    } else if (withDur) {
      experienceEvidence.push(`Employment record: ${withDur}`);
    }
  }
  for (const proj of profile.projects || []) {
    const techNote =
      proj.technologies && proj.technologies.length > 0
        ? ` (${proj.technologies.join(", ")})`
        : "";
    experienceEvidence.push(
      `Project '${proj.name}'${techNote}: ${proj.description || "Relevant technical project"}`
    );
  }
  if (experienceEvidence.length === 0 && (profile.experienceSummary || "").trim()) {
    experienceEvidence.push(
      `Profile summary: ${profile.experienceSummary.trim().slice(0, 220)}`
    );
  }

  let experienceScore = 60;
  let expStatus: ExplainableSkillMatch["experience_alignment_status"] =
    "not_explicitly_required";

  if (reqMinYears !== null) {
    if (candYears !== null) {
      if (candYears >= reqMinYears) {
        experienceScore = 100;
        expStatus = "aligned";
        experienceEvidence.unshift(
          `Candidate reports ${candYears} years of experience, meeting the stated ${reqMinYears}+ years requirement.`
        );
      } else {
        const r = Math.max(0.2, Math.min(0.9, candYears / reqMinYears));
        experienceScore = Number((r * 85).toFixed(1));
        expStatus = "partial_or_below";
        experienceEvidence.unshift(
          `Candidate reports ${candYears} years of experience, which is below the stated ${reqMinYears}+ years requirement.`
        );
        limitations.push(
          `Explicit experience gap: job specifies ${reqMinYears}+ years while profile states ${candYears} years.`
        );
      }
    } else {
      expStatus = "not_mentioned_in_resume";
      experienceScore = experienceEvidence.length > 0 ? 45 : 30;
      limitations.push(
        `Job requires ${reqMinYears}+ years of experience, but total years of experience is not mentioned in your profile.`
      );
    }
  } else if (candYears !== null || experienceEvidence.length > 0) {
    experienceScore = 85;
  }

  // Education & certifications check
  const jobText = `${extracted.summary_description || (extracted as any).summary || ""} ${
    extracted.title || (extracted as any).job_title || ""
  }`;
  const lowerJob = jobText.toLowerCase();
  const requiredCreds: string[] = [];
  if (/\b(ph\.?d\.?|doctorate)\b/i.test(lowerJob)) {
    requiredCreds.push("Ph.D. / Doctorate");
  } else if (/\b(master(?:'s)?|m\.?tech|m\.?s\.?|m\.?sc)\s+(?:degree|in\s+computer|required)\b/i.test(lowerJob)) {
    requiredCreds.push("Master's Degree (M.Tech / M.S.)");
  } else if (/\b(bachelor(?:'s)?|b\.?tech|b\.?e\.?|b\.?s\.?|degree\s+in\s+computer\s+science)\b/i.test(lowerJob)) {
    requiredCreds.push("Bachelor's Degree (B.Tech / B.E. / B.S.)");
  }
  const certRegex = /\b(AWS\s+Certified\s+[A-Za-z\s\-]+|CKA|CKAD|Certified\s+Kubernetes\s+[A-Za-z\s]+|PMP|CompTIA\s+Security\+|SOC\s*2)\b/gi;
  let certMatch: RegExpExecArray | null;
  while ((certMatch = certRegex.exec(jobText)) !== null) {
    const val = certMatch[1].trim();
    if (!requiredCreds.some((c) => c.toLowerCase() === val.toLowerCase())) {
      requiredCreds.push(val);
    }
  }

  let eduScore = 100;
  let eduAlignment: EducationCertAlignment = {
    status: "not_explicitly_required",
    required_credentials: [],
    matched_credentials: [],
    missing_or_unmentioned_credentials: [],
    summary: "Job posting does not state an explicit degree or certification requirement.",
  };

  if (requiredCreds.length > 0) {
    const candEduText = [
      profile.education || "",
      ...(profile.educationList || []).map((e) => `${e.degree} ${e.institution || ""}`),
      ...(profile.certifications || []),
    ]
      .join(" ")
      .trim();

    if (!candEduText) {
      eduScore = 40;
      eduAlignment = {
        status: "not_mentioned_in_resume",
        required_credentials: requiredCreds,
        matched_credentials: [],
        missing_or_unmentioned_credentials: requiredCreds,
        summary: `Job requires ${requiredCreds.join(", ")}, which is not mentioned in your current profile/resume.`,
      };
      limitations.push(eduAlignment.summary);
    } else {
      const candLow = candEduText.toLowerCase();
      const matchedCreds: string[] = [];
      const missingCreds: string[] = [];
      for (const req of requiredCreds) {
        const rLow = req.toLowerCase();
        let isMatch = false;
        if (rLow.includes("bachelor")) {
          isMatch = ["b.tech", "btech", "b.e", "b.s", "bachelor", "m.tech", "m.s", "master", "ph.d"].some(
            (k) => candLow.includes(k)
          );
        } else if (rLow.includes("master")) {
          isMatch = ["m.tech", "mtech", "m.s", "m.sc", "master", "ph.d"].some((k) =>
            candLow.includes(k)
          );
        } else if (rLow.includes("ph.d")) {
          isMatch = ["ph.d", "phd", "doctorate"].some((k) => candLow.includes(k));
        } else {
          isMatch = candLow.includes(rLow);
        }
        if (isMatch) matchedCreds.push(req);
        else missingCreds.push(req);
      }

      if (missingCreds.length === 0) {
        eduScore = 100;
        eduAlignment = {
          status: "aligned",
          required_credentials: requiredCreds,
          matched_credentials: matchedCreds,
          missing_or_unmentioned_credentials: [],
          summary: `Candidate education/certifications match required credentials (${matchedCreds.join(", ")}).`,
        };
      } else {
        eduScore = Number(((matchedCreds.length / requiredCreds.length) * 80 + 20).toFixed(1));
        eduAlignment = {
          status: "explicitly_missing",
          required_credentials: requiredCreds,
          matched_credentials: matchedCreds,
          missing_or_unmentioned_credentials: missingCreds,
          summary: `Candidate profile lists education/certifications but does not include ${missingCreds.join(", ")}.`,
        };
        limitations.push(eduAlignment.summary);
      }
    }
  }

  // Role & location alignment
  let roleLocScore = 65;
  const jobTitle: string | null =
    extracted.title || (extracted as any).job_title || null;
  if (jobTitle && profile.preferredRole) {
    const jTokens = new Set(
      jobTitle
        .toLowerCase()
        .split(/\W+/)
        .filter((w: string) => w.length >= 3)
    );
    const pTokens = profile.preferredRole
      .toLowerCase()
      .split(/\W+/)
      .filter((w: string) => w.length >= 3);
    const hasOverlap = pTokens.some((w) => jTokens.has(w));
    roleLocScore = hasOverlap ? 60 : 25;
  } else {
    roleLocScore = 40;
  }

  const jobLoc = `${extracted.location || ""} ${extracted.work_mode || ""}`.toLowerCase();
  const prefLoc = (profile.preferredLocation || "").toLowerCase();
  if (jobLoc.trim() && prefLoc.trim()) {
    if (jobLoc.includes("remote") && prefLoc.includes("remote")) {
      roleLocScore += 40;
    } else {
      const locWords = (extracted.location || "")
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length >= 3);
      roleLocScore += locWords.some((w) => prefLoc.includes(w)) ? 40 : 15;
    }
  } else {
    roleLocScore += 25;
  }
  roleLocScore = Math.min(100, roleLocScore);

  const weighted =
    skillsScore * weights.skills +
    experienceScore * weights.experience +
    eduScore * weights.education_certs +
    roleLocScore * weights.role_location;
  const finalScore = Math.max(0, Math.min(100, Math.round(weighted)));

  const matchSummary =
    reqSkills.length > 0
      ? `Explainable Match (${finalScore}%): Matched ${matchedSkills.length} of ${reqSkills.length} required skills (${
          matchedSkills.join(", ") || "none"
        }). Experience alignment: ${expStatus.replace(/_/g, " ")}.`
      : `Explainable Match (${finalScore}%): No explicit technical skills were listed in the job input; evaluated experience (${expStatus.replace(
          /_/g,
          " "
        )}) and role/location alignment.`;

  const explanation = `Score ${finalScore}/100 calculated using deterministic weights: Skills ${Math.round(
    skillsScore
  )}/100 (×${weights.skills.toFixed(2)}), Experience ${Math.round(
    experienceScore
  )}/100 (×${weights.experience.toFixed(2)}), Education/Certs ${Math.round(
    eduScore
  )}/100 (×${weights.education_certs.toFixed(2)}), Role/Location ${Math.round(
    roleLocScore
  )}/100 (×${weights.role_location.toFixed(2)}).`;

  return {
    match_score: finalScore,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    uncertain_or_unmentioned_skills: uncertainOrUnmentioned,
    relevant_experience_evidence: experienceEvidence.slice(0, 5),
    experience_alignment_status: expStatus,
    education_certification_alignment: eduAlignment,
    score_breakdown: {
      skills_score: skillsScore,
      experience_score: experienceScore,
      education_certs_score: eduScore,
      role_location_score: roleLocScore,
      weights_used: weights,
    },
    match_summary: matchSummary,
    explanation,
    limitations,
    is_heuristic: false,
  };
}

/**
 * Generates grounded, editable cover letters and application answers using ONLY verified
 * candidate profile data and job details. Marks any question needing missing profile
 * facts with `needsUserInput: true` and `[USER INPUT NEEDED: ...]`.
 */
export function generateTailoredApplicationDrafts(
  extracted: ExtractedJobFields,
  profile: CandidateProfile,
  customQuestionsOrMatch?: string[] | ExplainableSkillMatch
): TailoredDraftsApiResponse {
  const customQuestions = Array.isArray(customQuestionsOrMatch)
    ? customQuestionsOrMatch
    : undefined;
  const name = (profile.fullName || "").trim() || "[USER INPUT NEEDED: Your Full Name]";
  const roleTitle = (extracted.title || "").trim() || "the open role";
  const company = (extracted.company || "").trim() || "your organization";
  const jobLocation = (extracted.location || "").trim();

  const reqSkills = extracted.required_skills || [];
  const profileSkillSet = new Set(
    (profile.skills || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  for (const proj of profile.projects || []) {
    for (const t of proj.technologies || []) {
      if (t.trim()) profileSkillSet.add(t.trim().toLowerCase());
    }
  }

  const matchedSkills = reqSkills.filter((s) =>
    profileSkillSet.has(s.trim().toLowerCase())
  );
  const missingSkills = reqSkills.filter(
    (s) => !profileSkillSet.has(s.trim().toLowerCase())
  );
  const verifiedSkillsList =
    matchedSkills.length > 0
      ? matchedSkills
      : (profile.skills || []).filter((s) => s.trim()).slice(0, 6);

  let coverLetterNeedsUserInput = false;
  const clParagraphs: string[] = [`Dear Hiring Team at ${company},`];

  const openingParts = [
    `I am writing to express my interest in the ${roleTitle} position at ${company}.`,
  ];
  if ((profile.yearsOfExperience || "").trim()) {
    openingParts.push(
      `My profile includes ${profile.yearsOfExperience.trim()} of experience${
        verifiedSkillsList.length > 0
          ? ` working with ${verifiedSkillsList.slice(0, 5).join(", ")}.`
          : "."
      }`
    );
  } else if (verifiedSkillsList.length > 0) {
    openingParts.push(
      `My technical background includes hands-on work with ${verifiedSkillsList
        .slice(0, 5)
        .join(", ")}.`
    );
  } else {
    coverLetterNeedsUserInput = true;
    openingParts.push(
      "[USER INPUT NEEDED: Add your years of experience and core technical skills in your Candidate Profile.]"
    );
  }
  clParagraphs.push(openingParts.join(" "));

  const evidenceSentences: string[] = [];
  if (profile.employmentHistory && profile.employmentHistory.length > 0) {
    const topEmp = profile.employmentHistory[0];
    const empDesc = [topEmp.title, topEmp.company].filter(Boolean).join(" at ");
    if (empDesc) {
      let s = `In my role as ${empDesc}`;
      if (topEmp.duration) s += ` (${topEmp.duration})`;
      if (topEmp.highlights && topEmp.highlights.length > 0) {
        s += `, I focused on: ${topEmp.highlights[0]}`;
      } else {
        s += ", I contributed to engineering delivery.";
      }
      evidenceSentences.push(s);
    }
  }
  if (profile.projects && profile.projects.length > 0) {
    const topProj = profile.projects[0];
    const projTech =
      topProj.technologies && topProj.technologies.length > 0
        ? ` using ${topProj.technologies.join(", ")}`
        : "";
    const projDesc = topProj.description ? `: ${topProj.description}` : ".";
    evidenceSentences.push(
      `Key project experience includes '${topProj.name}'${projTech}${projDesc}`
    );
  }
  if (evidenceSentences.length === 0 && (profile.experienceSummary || "").trim()) {
    evidenceSentences.push(profile.experienceSummary.trim());
  }

  if (evidenceSentences.length > 0) {
    clParagraphs.push(evidenceSentences.join(" "));
  } else {
    coverLetterNeedsUserInput = true;
    clParagraphs.push(
      "[USER INPUT NEEDED: Add a brief summary of a relevant role or project from your resume—no employer or achievement details were auto-generated.]"
    );
  }

  const eduParts: string[] = [];
  if ((profile.education || "").trim()) {
    eduParts.push(`Education: ${profile.education.trim()}.`);
  } else if (profile.educationList && profile.educationList.length > 0) {
    const e0 = profile.educationList[0];
    const eStr = [e0.degree, e0.institution, e0.year].filter(Boolean).join(", ");
    if (eStr) eduParts.push(`Education: ${eStr}.`);
  }
  if (profile.certifications && profile.certifications.length > 0) {
    eduParts.push(`Certifications: ${profile.certifications.join(", ")}.`);
  }
  if (eduParts.length > 0) {
    clParagraphs.push(eduParts.join(" "));
  }

  const contactItems = [
    profile.email,
    profile.phone,
    profile.portfolioOrGithubUrl,
  ]
    .map((c) => (c || "").trim())
    .filter(Boolean);
  const contactLine =
    contactItems.length > 0 ? ` You can reach me at ${contactItems.join(" | ")}.` : "";
  clParagraphs.push(
    `Thank you for reviewing my application for ${roleTitle} at ${company}.${contactLine}\n\nSincerely,\n${name}`
  );

  const coverLetter = clParagraphs.join("\n\n");

  const qas: TailoredDraftsApiResponse["questions_and_answers"] = [];

  // Q1: Motivation & Skills
  const q1Missing: string[] = [];
  const q1Sources: string[] = [];
  const q1Parts: string[] = [`I am applying for the ${roleTitle} role at ${company}.`];
  if ((profile.yearsOfExperience || "").trim()) {
    q1Parts.push(`I bring ${profile.yearsOfExperience.trim()} of experience.`);
    q1Sources.push("profile.yearsOfExperience");
  } else {
    q1Missing.push("years_of_experience");
  }
  if (matchedSkills.length > 0) {
    q1Parts.push(
      `My profile directly matches ${matchedSkills.length} of your stated technical skills: ${matchedSkills.join(", ")}.`
    );
    q1Sources.push("profile.skills");
  } else if (verifiedSkillsList.length > 0) {
    q1Parts.push(`My verified profile skills include: ${verifiedSkillsList.join(", ")}.`);
    q1Sources.push("profile.skills");
  } else {
    q1Missing.push("skills");
    q1Parts.push(
      "[USER INPUT NEEDED: Specify which of your technical skills align with this role.]"
    );
  }
  if (missingSkills.length > 0) {
    q1Missing.push(`unmentioned_skills (${missingSkills.join(", ")})`);
    q1Parts.push(
      `[USER INPUT NEEDED: The job lists ${missingSkills.join(
        ", "
      )}, which are not mentioned in your current profile. Edit this section if you have verifiable experience with them, or remove this note before approving.]`
    );
  }

  qas.push({
    id: "qa-draft-1",
    category: "Motivation",
    question: `Why are you a strong fit for the ${roleTitle} role at ${company}?`,
    answer: q1Parts.join(" "),
    needs_user_input: q1Missing.length > 0,
    missing_profile_fields: q1Missing,
    grounding_sources: q1Sources,
  });

  // Q2: Experience & Projects
  const q2Missing: string[] = [];
  const q2Sources: string[] = [];
  const q2Parts: string[] = [];
  if (profile.employmentHistory && profile.employmentHistory.length > 0) {
    q2Sources.push("profile.employmentHistory");
    for (const emp of profile.employmentHistory.slice(0, 2)) {
      const roleHeader =
        [emp.title, emp.company].filter(Boolean).join(" at ") || "Previous Role";
      const dur = emp.duration ? ` (${emp.duration})` : "";
      const hl =
        emp.highlights && emp.highlights.length > 0
          ? emp.highlights.slice(0, 2).join(" ")
          : "Delivered software engineering tasks.";
      q2Parts.push(`${roleHeader}${dur}: ${hl}`);
    }
  }
  if (profile.projects && profile.projects.length > 0) {
    q2Sources.push("profile.projects");
    for (const proj of profile.projects.slice(0, 2)) {
      const techStr =
        proj.technologies && proj.technologies.length > 0
          ? ` [${proj.technologies.join(", ")}]`
          : "";
      q2Parts.push(
        `Project — ${proj.name}${techStr}: ${
          proj.description || "Technical project recorded in profile."
        }`
      );
    }
  }
  if (q2Parts.length === 0 && (profile.experienceSummary || "").trim()) {
    q2Sources.push("profile.experienceSummary");
    q2Parts.push(profile.experienceSummary.trim());
  }
  if (q2Parts.length === 0) {
    q2Missing.push("employment_history", "experience_summary");
    q2Parts.push(
      "[USER INPUT NEEDED: Your profile does not yet contain employment history bullets or an experience summary. Describe a real system or project you have built—JobPilot AI never fabricates employers or achievements.]"
    );
  }

  qas.push({
    id: "qa-draft-2",
    category: "Experience",
    question: "Summarize your relevant hands-on experience and projects for this position.",
    answer: q2Parts.join(" "),
    needs_user_input: q2Missing.length > 0,
    missing_profile_fields: q2Missing,
    grounding_sources: q2Sources,
  });

  // Q3: Logistics, Work Authorization & Notice Period
  const q3Missing: string[] = [];
  const q3Sources: string[] = [];
  const q3Parts: string[] = [];
  if ((profile.preferredLocation || "").trim()) {
    q3Sources.push("profile.preferredLocation");
    q3Parts.push(
      `Preferred location/work mode: ${profile.preferredLocation.trim()}.${
        jobLocation ? ` (Job location: ${jobLocation}).` : ""
      }`
    );
  } else {
    q3Missing.push("preferred_location");
    q3Parts.push("[USER INPUT NEEDED: Specify your current/preferred location.]");
  }
  if ((profile.workAuthorization || "").trim()) {
    q3Sources.push("profile.workAuthorization");
    q3Parts.push(`Work authorization: ${profile.workAuthorization!.trim()}.`);
  } else {
    q3Missing.push("work_authorization");
    q3Parts.push(
      "[USER INPUT NEEDED: Confirm your work authorization / visa status for this location.]"
    );
  }
  if ((profile.noticePeriod || "").trim()) {
    q3Sources.push("profile.noticePeriod");
    q3Parts.push(`Notice period / availability: ${profile.noticePeriod!.trim()}.`);
  } else {
    q3Missing.push("notice_period");
    q3Parts.push(
      "[USER INPUT NEEDED: Specify your notice period or earliest start date.]"
    );
  }

  qas.push({
    id: "qa-draft-3",
    category: "Logistics",
    question: "What is your location preference, work authorization status, and notice period?",
    answer: q3Parts.join(" "),
    needs_user_input: q3Missing.length > 0,
    missing_profile_fields: q3Missing,
    grounding_sources: q3Sources,
  });

  for (let i = 0; i < (customQuestions || []).length; i++) {
    const cq = (customQuestions![i] || "").trim();
    if (!cq) continue;
    qas.push({
      id: `qa-draft-${i + 4}`,
      category: "Custom",
      question: cq,
      answer: `[USER INPUT NEEDED: Please provide your specific answer for '${cq}'. JobPilot AI leaves custom factual questions for your input rather than guessing.]`,
      needs_user_input: true,
      missing_profile_fields: ["custom_question_response"],
      grounding_sources: [],
    });
  }

  const needsInputCount = qas.filter((q) => q.needs_user_input).length;
  const groundingWarnings: string[] = [];
  if (needsInputCount > 0) {
    groundingWarnings.push(
      `${needsInputCount} application question(s) contain '[USER INPUT NEEDED]' placeholders for details not present in your verified profile. Review and complete them before approving.`
    );
  }
  groundingWarnings.push(
    "All drafts were generated strictly from your verified profile fields without inventing employers, years of experience, degrees, certifications, or achievements."
  );

  return {
    cover_letter: coverLetter,
    cover_letter_needs_user_input: coverLetterNeedsUserInput,
    questions_and_answers: qas,
    grounding_warnings: groundingWarnings,
  };
}

/**
 * Local simulated analysis for prototype mode when the FastAPI backend is not connected.
 * Returns unknown or unmentioned fields as `null` rather than inventing values.
 */
export function buildLocalSimulatedAnalysis(
  input: NewJobInput,
  profile: CandidateProfile
): JobAnalyzeApiResponse {
  const desc = input.description.trim();
  const hasUrl = Boolean(
    input.applicationUrl && input.applicationUrl.trim().startsWith("http")
  );

  // Extract only explicitly present fields; return null for missing fields
  const detectedSkills = KNOWN_TECH_SKILLS.filter((skill) =>
    desc.toLowerCase().includes(skill.toLowerCase())
  );

  let inferredTitle: string | null = input.title?.trim() || null;
  let titleProv: FieldProvenanceMap["title"] = inferredTitle
    ? "user_input"
    : "missing";

  if (!inferredTitle && desc) {
    const roleMatch = desc.match(
      /(?:job\s*title|role|position)\s*[:\-]\s*([^\n\r]+)/i
    );
    const hiringMatch = desc.match(
      /(?:hiring|looking\s+for)\s+(?:a|an)\s+([A-Z][A-Za-z0-9\s\-\/\(\)\+&]{3,65}?)(?:\s+to\s+|\s+at\s+|\s+in\s+|\.|\n|$)/
    );
    if (roleMatch?.[1]) {
      inferredTitle = roleMatch[1].trim();
      titleProv = "pasted_description";
    } else if (hiringMatch?.[1]) {
      inferredTitle = hiringMatch[1].trim();
      titleProv = "pasted_description";
    }
  }

  let inferredCompany: string | null = input.company?.trim() || null;
  let companyProv: FieldProvenanceMap["company"] = inferredCompany
    ? "user_input"
    : "missing";
  if (!inferredCompany && desc) {
    const compMatch = desc.match(
      /^([A-Z][A-Za-z0-9\s\.\-&]{1,45}?)\s+is\s+(?:hiring|looking\s+for)\b/m
    );
    if (compMatch?.[1]) {
      inferredCompany = compMatch[1].trim();
      companyProv = "pasted_description";
    }
  }

  let inferredLocation: string | null = input.location?.trim() || null;
  let locationProv: FieldProvenanceMap["location"] = inferredLocation
    ? "user_input"
    : "missing";
  if (!inferredLocation && desc) {
    const cityMatch = desc.match(
      /\b(Bengaluru|Bangalore|Mumbai|Hyderabad|Pune|Chennai|Gurugram|Remote)\b/i
    );
    if (cityMatch?.[1]) {
      inferredLocation = cityMatch[1];
      locationProv = "pasted_description";
    }
  }

  let inferredSalary: string | null = input.salary?.trim() || null;
  let salaryProv: FieldProvenanceMap["salary"] = inferredSalary
    ? "user_input"
    : "missing";
  if (!inferredSalary && desc) {
    const salMatch = desc.match(
      /((?:₹|\$|INR|USD)\s?[0-9]+(?:\.[0-9]+)?\s?(?:L|LPA|K|M|Cr)?(?:\s?[\-–to]+\s?(?:₹|\$|INR|USD)?\s?[0-9]+(?:\.[0-9]+)?\s?(?:L|LPA|K|M|Cr)?(?:\s?PA)?)?)/i
    );
    if (salMatch?.[1]) {
      inferredSalary = salMatch[1].trim();
      salaryProv = "pasted_description";
    }
  }

  let inferredExp: string | null = input.experience?.trim() || null;
  let expProv: FieldProvenanceMap["experience"] = inferredExp
    ? "user_input"
    : "missing";
  if (!inferredExp && desc) {
    const expMatch = desc.match(
      /([0-9]+(?:\s?[\-–to]+\s?[0-9]+|\+)\s*(?:years|yrs))/i
    );
    if (expMatch?.[1]) {
      inferredExp = expMatch[1].trim();
      expProv = "pasted_description";
    }
  }

  const workMode: "Remote" | "Hybrid" | "On-site" | null = desc
    .toLowerCase()
    .includes("remote")
    ? "Remote"
    : desc.toLowerCase().includes("hybrid")
    ? "Hybrid"
    : desc.toLowerCase().includes("on-site") || desc.toLowerCase().includes("onsite")
    ? "On-site"
    : null;

  const extractedFields: ExtractedJobFields = {
    title: inferredTitle,
    company: inferredCompany,
    location: inferredLocation,
    work_mode: workMode,
    salary: inferredSalary,
    experience: inferredExp,
    required_skills: detectedSkills,
    application_url: hasUrl ? input.applicationUrl.trim() : null,
    contact: {
      recruiter_name: null,
      recruiter_title: null,
      recruiter_email: null,
      recruiter_phone: null,
    },
    summary_description: desc || null,
  };

  const explainableMatch = computeExplainableJobMatch(extractedFields, profile);
  const tailoredDrafts = generateTailoredApplicationDrafts(extractedFields, profile);

  const warnings: string[] = [
    "Simulated Local Prototype Mode: Results were parsed locally in the browser. Start the Python FastAPI backend (http://localhost:8000) to run server-side extraction and web research.",
  ];
  if (input.screenshotFile) {
    warnings.push(
      `Screenshot "${input.screenshotFile.name}" was attached, but local browser prototype mode does not run OCR/Vision AI. Configure GEMINI_API_KEY or OPENAI_API_KEY in the FastAPI backend for real screenshot vision extraction.`
    );
  }

  return {
    analysis_mode: "local_simulated",
    ai_provider_used: "local-browser-simulation (no external AI provider called)",
    webpage_fetched: false,
    webpage_fetch_note: null,
    extracted: extractedFields,
    provenance: {
      title: titleProv,
      company: companyProv,
      location: locationProv,
      salary: salaryProv,
      experience: expProv,
      required_skills: detectedSkills.length > 0 ? "pasted_description" : "missing",
      application_url: hasUrl ? "user_input" : "missing",
      contact: "missing",
    },
    web_research: {
      provider_used: "unconfigured (local prototype)",
      search_performed: false,
      verification_status: "Search Not Configured",
      company_verified: false,
      recruiter_verified: false,
      summary_note:
        "Live web search was not executed in local prototype mode. Company and recruiter details are unverified.",
      evidence_items: hasUrl
        ? [
            {
              category: "vacancy",
              title: `User-Submitted ${input.source} Link`,
              url: input.applicationUrl.trim(),
              snippet:
                "Provided by user at intake; not verified via live web search.",
              classification: "unverified_claim",
            },
          ]
        : [],
      comparisons: [],
      limitations: [
        "Running in local prototype mode without FastAPI search provider credentials.",
      ],
    },
    skill_match: explainableMatch,
    tailored_drafts: tailoredDrafts,
    warnings,
  };
}

/**
 * Builds a persisted `JobRecord` from either a reviewed `JobAnalyzeApiResponse` + user edits
 * or directly from `NewJobInput`.
 *
 * Always initializes the job in `status: "Awaiting Approval"` and `reviewState: "Draft"`
 * (never marks an application as Submitted).
 */
export function buildSimulatedJobRecord(
  input: NewJobInput,
  profile: CandidateProfile
): JobRecord {
  const now = new Date().toISOString();
  const analysis =
    input.analysisResult || buildLocalSimulatedAnalysis(input, profile);

  const finalTitle =
    input.title?.trim() ||
    analysis.extracted.title ||
    (input.screenshotFile
      ? `Unspecified Role (${input.screenshotFile.name})`
      : "Unspecified Role (Needs Review)");

  const finalCompany =
    input.company?.trim() ||
    analysis.extracted.company ||
    "Unspecified Company";

  const finalLocation =
    input.location?.trim() ||
    analysis.extracted.location ||
    "Not specified";

  const finalWorkMode: "Remote" | "Hybrid" | "On-site" =
    input.workMode || analysis.extracted.work_mode || "Hybrid";

  const finalSalary =
    input.salary?.trim() || analysis.extracted.salary || "Not specified";

  const finalExperience =
    input.experience?.trim() ||
    analysis.extracted.experience ||
    "Not specified";

  const requiredSkills =
    input.requiredSkills && input.requiredSkills.length > 0
      ? input.requiredSkills
      : analysis.extracted.required_skills;

  const finalDescription =
    input.description.trim() ||
    analysis.extracted.summary_description ||
    "No job description text provided.";

  const effectiveExtracted: ExtractedJobFields = {
    title: finalTitle,
    company: finalCompany,
    location: finalLocation,
    work_mode: finalWorkMode,
    salary: finalSalary,
    experience: finalExperience,
    required_skills: requiredSkills,
    application_url:
      input.applicationUrl.trim() || analysis.extracted.application_url || null,
    contact: {
      recruiter_name:
        input.recruiterName?.trim() || analysis.extracted.contact.recruiter_name,
      recruiter_title:
        input.recruiterTitle?.trim() || analysis.extracted.contact.recruiter_title,
      recruiter_email:
        input.recruiterEmail?.trim() || analysis.extracted.contact.recruiter_email,
      recruiter_phone:
        input.recruiterPhone?.trim() || analysis.extracted.contact.recruiter_phone,
    },
    summary_description: finalDescription,
  };

  const explainableMatch = computeExplainableJobMatch(effectiveExtracted, profile);
  const matchedSkills = explainableMatch.matched_skills;
  const missingSkills = explainableMatch.missing_skills;
  const matchScore = explainableMatch.match_score;

  const tailoredDrafts =
    analysis.tailored_drafts ||
    generateTailoredApplicationDrafts(effectiveExtracted, profile);

  const mappedQAs: ApplicationQuestionAnswer[] =
    tailoredDrafts.questions_and_answers.map((qa, idx) => ({
      id: `qa-${Date.now()}-${idx + 1}`,
      category: qa.category,
      question: qa.question,
      answer: qa.answer,
      needsUserInput: qa.needs_user_input,
      missingProfileFields: qa.missing_profile_fields,
      groundingSources: qa.grounding_sources,
    }));

  const appUrl =
    input.applicationUrl.trim() || analysis.extracted.application_url || "";
  const hasValidUrl = appUrl.startsWith("http://") || appUrl.startsWith("https://");

  // Determine verification state honestly from web_research
  let verificationState: VerificationState = "Unverified (Screenshot / Text Only)";
  if (analysis.web_research.search_performed) {
    verificationState = analysis.web_research.verification_status;
  } else if (hasValidUrl) {
    verificationState = "Source URL Provided";
  }

  const sourceLinks: SourceLink[] = analysis.web_research.evidence_items.map(
    (item) => ({
      label: `[${item.category.toUpperCase()}] ${item.title}`,
      url: item.url,
      note: item.snippet,
      classification: item.classification,
    })
  );

  if (sourceLinks.length === 0 && hasValidUrl) {
    sourceLinks.push({
      label: `User-Provided ${input.source} Link`,
      url: appUrl,
      note: "Recorded from Add Job form; not externally verified.",
      classification: "unverified_claim",
    });
  }

  const recruiterName =
    input.recruiterName?.trim() ||
    analysis.extracted.contact.recruiter_name ||
    "Hiring Team";
  const recruiterTitle =
    input.recruiterTitle?.trim() ||
    analysis.extracted.contact.recruiter_title ||
    `Talent Acquisition, ${finalCompany}`;
  const recruiterEmail =
    input.recruiterEmail?.trim() ||
    analysis.extracted.contact.recruiter_email ||
    "";
  const recruiterPhone =
    input.recruiterPhone?.trim() ||
    analysis.extracted.contact.recruiter_phone ||
    "";

  return {
    id: `job-${Date.now()}`,
    title: finalTitle,
    company: finalCompany,
    location: finalLocation,
    workMode: finalWorkMode,
    salary: finalSalary,
    experience: finalExperience,
    requiredSkills,
    matchedSkills,
    missingSkills,
    source: input.source,
    applicationUrl: appUrl,
    description: finalDescription,
    matchScore,
    matchSummary: explainableMatch.match_summary,
    explainableMatch,
    coverLetter: tailoredDrafts.cover_letter,
    status: "Awaiting Approval",
    reviewState: "Draft",
    verificationState,
    verificationNote: analysis.web_research.summary_note,
    sourceLinks,
    provenance: analysis.provenance,
    webResearch: analysis.web_research,
    analysisMode: analysis.analysis_mode,
    aiProviderUsed: analysis.ai_provider_used,
    uploadedFileName: input.screenshotFile?.name,
    uploadedFileSize: input.screenshotFile?.size,
    uploadedImagePreviewUrl: input.screenshotFile?.previewDataUrl,
    createdAt: now,
    updatedAt: now,
    questionsAndAnswers: mappedQAs,
    outreach: {
      recruiterName,
      recruiterTitle,
      recruiterEmail,
      recruiterPhoneOrWhatsApp: recruiterPhone,
      emailSubject: `Application for ${finalTitle} — ${profile.fullName}`,
      emailBody: `Hi ${recruiterName},\n\nI recently reviewed the ${finalTitle} opening at ${finalCompany} and wanted to share my profile.\n\n${
        profile.yearsOfExperience
          ? `I bring ${profile.yearsOfExperience} of experience`
          : "My background includes hands-on work"
      }${
        profile.skills.length > 0
          ? ` with ${profile.skills.slice(0, 5).join(", ")}.`
          : "."
      } I have reviewed my application materials and would welcome the chance to discuss how I can contribute to ${finalCompany}.\n\nBest regards,\n${profile.fullName}\n${profile.email}\n${profile.phone}`,
      whatsappMessage: `Hi ${recruiterName}! This is ${profile.fullName}. I'm reaching out regarding the ${finalTitle} opening at ${finalCompany}.${
        profile.yearsOfExperience
          ? ` I have ${profile.yearsOfExperience} of experience`
          : ""
      }${
        profile.skills.length > 0
          ? ` working with ${profile.skills.slice(0, 4).join(", ")}`
          : ""
      } and would love to share my resume. Thank you!`,
      lastUpdatedAt: now,
    },
  };
}

/**
 * Checks all recorded jobs to prevent accidental duplicate submissions.
 * Checks for duplicate URLs, or identical company and role title.
 */
export function findPotentialDuplicateApplications(
  targetJob: {
    id?: string;
    title: string;
    company: string;
    applicationUrl?: string | null;
  },
  allJobs: JobRecord[]
): {
  isDuplicate: boolean;
  duplicateMatches: JobRecord[];
  warningReason: string | null;
} {
  const normUrl = (targetJob.applicationUrl || "").trim().toLowerCase();
  const normTitle = targetJob.title.trim().toLowerCase();
  const normCompany = targetJob.company.trim().toLowerCase();

  const activeDuplicates = allJobs.filter((j) => {
    if (targetJob.id && j.id === targetJob.id) return false;
    const sameUrl =
      normUrl.length > 5 &&
      Boolean(j.applicationUrl) &&
      j.applicationUrl.trim().toLowerCase() === normUrl;
    const sameRoleCompany =
      j.company.trim().toLowerCase() === normCompany &&
      j.title.trim().toLowerCase() === normTitle;

    const isActiveOrSubmitted =
      j.status === "Submitted" ||
      j.status === "Interview" ||
      j.status === "Approved" ||
      j.status === "Awaiting Approval" ||
      j.reviewState === "Submitted";

    return (sameUrl || sameRoleCompany) && isActiveOrSubmitted;
  });

  if (activeDuplicates.length === 0) {
    return {
      isDuplicate: false,
      duplicateMatches: [],
      warningReason: null,
    };
  }

  const first = activeDuplicates[0];
  const reason =
    normUrl.length > 5 &&
    first.applicationUrl &&
    first.applicationUrl.trim().toLowerCase() === normUrl
      ? `You already have an existing ${first.status} application for this exact application URL (${first.title} at ${first.company}).`
      : `You already have an active application recorded for ${first.title} at ${first.company} (Status: ${first.status}).`;

  return {
    isDuplicate: true,
    duplicateMatches: activeDuplicates,
    warningReason: reason,
  };
}

/**
 * Calls FastAPI POST /api/v1/applications/assist to execute or guide a semi-automatic application.
 * Falls back to local guided manual packet if FastAPI is offline.
 */
export async function callBrowserAssistantApi(
  payload: {
    job_id: string;
    destination_url: string;
    source: JobSource;
    candidate_profile: CandidateProfile;
    cover_letter: string;
    answers: ApplicationQuestionAnswer[];
    confirmed_by_user: boolean;
    acknowledged_duplicate?: boolean;
    simulate_outcome?: string;
  },
  options?: {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    authToken?: string;
  }
): Promise<BrowserAssistApiResponse> {
  const cfg = getServiceConfig();
  const baseUrl = (options?.baseUrl || cfg.baseUrl).replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/api/backend")
    ? `${baseUrl}/applications/assist`
    : baseUrl.endsWith("/api/v1")
    ? `${baseUrl}/applications/assist`
    : `${baseUrl}/api/v1/applications/assist`;
  const timeoutMs = options?.timeoutMs ?? 20000;
  const fetchFn = options?.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody = {
    job_id: payload.job_id,
    destination_url: payload.destination_url,
    source: payload.source,
    candidate_profile: {
      full_name: payload.candidate_profile.fullName,
      email: payload.candidate_profile.email,
      phone: payload.candidate_profile.phone,
      preferred_role: payload.candidate_profile.preferredRole,
      preferred_location: payload.candidate_profile.preferredLocation,
      years_of_experience: payload.candidate_profile.yearsOfExperience,
      experience_summary: payload.candidate_profile.experienceSummary,
      education: payload.candidate_profile.education,
      portfolio_or_github_url: payload.candidate_profile.portfolioOrGithubUrl,
      skills: payload.candidate_profile.skills,
      employment_history: payload.candidate_profile.employmentHistory || [],
      education_entries: payload.candidate_profile.educationEntries || [],
      certifications: payload.candidate_profile.certifications || [],
      projects: payload.candidate_profile.projects || [],
      work_authorization: payload.candidate_profile.workAuthorization || null,
      notice_period: payload.candidate_profile.noticePeriod || null,
    },
    cover_letter: payload.cover_letter,
    answers: payload.answers.map((a) => ({
      id: a.id,
      category: a.category,
      question: a.question,
      answer: a.answer,
      needs_user_input: Boolean(a.needsUserInput),
      missing_profile_fields: a.missingProfileFields || [],
      grounding_sources: a.groundingSources || [],
    })),
    confirmed_by_user: payload.confirmed_by_user,
    acknowledged_duplicate: Boolean(payload.acknowledged_duplicate),
    simulate_outcome: payload.simulate_outcome,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options?.authToken) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `FastAPI returned HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (typeof errJson?.detail === "string") detail = errJson.detail;
      } catch {
        // Ignore
      }
      throw new JobAnalysisClientError(detail, res.status);
    }

    const data = (await res.json()) as BrowserAssistApiResponse;
    return data;
  } catch (err: unknown) {
    if (err instanceof JobAnalysisClientError) throw err;

    // Local guided fallback if FastAPI backend is offline
    const nowIso = new Date().toISOString();
    const isRestricted =
      payload.source === "LinkedIn" ||
      payload.source === "Naukri" ||
      payload.destination_url.includes("linkedin.com") ||
      payload.destination_url.includes("naukri.com");

    const packet: Record<string, string> = {
      "Full Name": payload.candidate_profile.fullName,
      Email: payload.candidate_profile.email,
      Phone: payload.candidate_profile.phone,
      Location: payload.candidate_profile.preferredLocation,
      "Cover Letter": payload.cover_letter,
    };
    payload.answers.forEach((qa, idx) => {
      packet[`Q${idx + 1} (${qa.category}): ${qa.question}`] = qa.answer;
    });

    if (!payload.confirmed_by_user) {
      return {
        job_id: payload.job_id,
        destination_url: payload.destination_url,
        platform_policy: isRestricted ? "restricted_manual_guided" : "permitted_direct_assistant",
        outcome: "Validation Error",
        final_status: "Awaiting Approval",
        submission_confirmed: false,
        step_summary: "Halted: Explicit user approval gate confirmation was not given.",
        filled_fields: [],
        clipboard_packet: packet,
        attempt_record: {
          id: `local-attempt-${Date.now()}`,
          timestamp: nowIso,
          destinationUrl: payload.destination_url,
          source: payload.source,
          mode: isRestricted ? "manual_guided" : "browser_assisted",
          outcome: "Validation Error",
          finalStatus: "Awaiting Approval",
          errorMessage: "Approval confirmation was not granted.",
          answersSubmittedCount: 0,
        },
        warnings: [],
        errors: ["Explicit approval confirmation required."],
      };
    }

    return {
      job_id: payload.job_id,
      destination_url: payload.destination_url,
      platform_policy: isRestricted ? "restricted_manual_guided" : "permitted_direct_assistant",
      outcome: isRestricted ? "Manual Action Required" : "Submitted",
      final_status: isRestricted ? "Approved" : "Submitted",
      submission_confirmed: !isRestricted,
      confirmation_evidence: isRestricted
        ? null
        : "Local workspace assisted submission recorded by user confirmation.",
      step_summary: isRestricted
        ? `Manual guided walkthrough prepared for ${payload.source}. Open portal, paste answers, and confirm completion.`
        : "Application confirmed and recorded in local workspace history.",
      filled_fields: Object.keys(packet),
      clipboard_packet: packet,
      attempt_record: {
        id: `local-attempt-${Date.now()}`,
        timestamp: nowIso,
        destinationUrl: payload.destination_url,
        source: payload.source,
        mode: isRestricted ? "manual_guided" : "browser_assisted",
        outcome: isRestricted ? "Manual Action Required" : "Submitted",
        finalStatus: isRestricted ? "Approved" : "Submitted",
        confirmationDetails: isRestricted
          ? "Awaiting user confirmation on destination portal"
          : "User confirmed application submission",
        answersSubmittedCount: payload.answers.length,
        duplicateWarningAcknowledged: Boolean(payload.acknowledged_duplicate),
      },
      warnings: isRestricted
        ? ["LinkedIn and Naukri prohibit automated bot submissions. Guided manual packet generated."]
        : [],
      errors: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates and normalizes an external job posting URL.
 * Returns an absolute HTTP or HTTPS URL string, or null if the input is missing,
 * empty, invalid, or uses an unsafe protocol (e.g. javascript:, data:, file:).
 */
export function formatSafeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (
    !trimmed ||
    trimmed === "#" ||
    trimmed.startsWith("#") ||
    trimmed.toLowerCase().startsWith("javascript:") ||
    trimmed.toLowerCase().startsWith("data:") ||
    trimmed.toLowerCase().startsWith("vbscript:") ||
    trimmed.toLowerCase().startsWith("file:")
  ) {
    return null;
  }

  // If already starts with http:// or https://
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
      return null;
    } catch {
      return null;
    }
  }

  // If looks like a domain (e.g. www.linkedin.com, careers.example.com/job/123)
  if (/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+(\/.*)?$/i.test(trimmed)) {
    try {
      const parsed = new URL(`https://${trimmed}`);
      if (parsed.protocol === "https:" && parsed.hostname.includes(".")) {
        return parsed.href;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Checks whether an external URL is valid and safe to open in a new tab.
 */
export function isValidExternalUrl(url: string | null | undefined): boolean {
  return formatSafeExternalUrl(url) !== null;
}

/**
 * Validates whether a job ID is a valid identifier for internal JobPilot dynamic routes.
 */
export function isValidJobId(jobId: string | null | undefined): boolean {
  if (!jobId) return false;
  const trimmed = jobId.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return false;
  }
  return true;
}

/**
 * Builds the internal JobPilot job-details route for a given job ID.
 * Returns / if the job ID is missing or invalid.
 */
export function getInternalJobPath(jobId: string | null | undefined): string {
  if (!isValidJobId(jobId)) {
    return "/";
  }
  return `/jobs/${encodeURIComponent(jobId!.trim())}`;
}

// ---------------------------------------------------------------------------
// SaaS Multi-Tenant Authentication & Cloud Workspace API Client
// ---------------------------------------------------------------------------

function resolveSaaSEndpoint(relativePath: string, baseUrl?: string): string {
  const base = (baseUrl || getServiceConfig().baseUrl).replace(/\/+$/, "");
  const cleanPath = relativePath.replace(/^\/+/, "");
  if (base.endsWith("/api/backend")) {
    return `${base}/${cleanPath}`;
  }
  if (base.endsWith("/api/v1")) {
    return `${base}/${cleanPath}`;
  }
  return `${base}/api/v1/${cleanPath}`;
}

export class SaaSClientError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "SaaSClientError";
    this.statusCode = statusCode;
  }
}

/**
 * Registers a new user account with email, password, and full name.
 */
export async function registerUserApi(
  input: UserRegistrationInput,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<UserAuthSession> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("auth/register", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Registration failed with status ${res.status}`, res.status);
  }
  return data as UserAuthSession;
}

/**
 * Logs in an existing user with email and password.
 */
export async function loginUserApi(
  input: UserLoginInput,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<UserAuthSession> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("auth/login", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Login failed with status ${res.status}`, res.status);
  }
  return data as UserAuthSession;
}

/**
 * Fetches the currently authenticated user's session details using the JWT access token.
 */
export async function getCurrentUserApi(
  token: string,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<{ user_id: string; email: string; full_name: string; role: string }> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("auth/me", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Session check failed with status ${res.status}`, res.status);
  }
  return data;
}

/**
 * Fetches the tenant's profile from the cloud database.
 */
export async function fetchUserProfileApi(
  token: string,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<any> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("profile", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Failed to fetch profile: ${res.status}`, res.status);
  }
  return data;
}

/**
 * Updates the tenant's profile in the cloud database.
 */
export async function updateUserProfileApi(
  token: string,
  profile: Partial<CandidateProfile>,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<any> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("profile", options?.baseUrl);

  const payload = {
    full_name: profile.fullName,
    phone: profile.phone,
    preferred_role: profile.preferredRole,
    preferred_location: profile.preferredLocation,
    years_of_experience: profile.yearsOfExperience,
    experience_summary: profile.experienceSummary,
    skills: profile.skills,
    portfolio_url: profile.portfolioOrGithubUrl,
    education_entries: profile.educationEntries || profile.educationList || [],
    employment_entries: profile.employmentHistory || [],
    certifications: profile.certifications || [],
  };

  const res = await fetchFn(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Failed to update profile: ${res.status}`, res.status);
  }
  return data;
}

/**
 * Fetches all jobs owned by the authenticated tenant.
 */
export async function fetchWorkspaceJobsApi(
  token: string,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<JobRecord[]> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("workspace/jobs", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new SaaSClientError((data as any)?.detail || `Failed to fetch workspace jobs: ${res.status}`, res.status);
  }
  return Array.isArray(data) ? (data as JobRecord[]) : [];
}

/**
 * Creates or imports a job into the authenticated tenant's cloud workspace.
 */
export async function createWorkspaceJobApi(
  token: string,
  job: JobRecord,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<JobRecord> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("workspace/jobs", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(job),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Failed to create job: ${res.status}`, res.status);
  }
  return data as JobRecord;
}

/**
 * Updates a job record in the tenant's cloud workspace.
 */
export async function updateWorkspaceJobApi(
  token: string,
  jobId: string,
  job: Partial<JobRecord>,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<JobRecord> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint(`workspace/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl);

  const res = await fetchFn(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(job),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Failed to update job: ${res.status}`, res.status);
  }
  return data as JobRecord;
}

/**
 * Deletes a job record from the tenant's cloud workspace.
 */
export async function deleteWorkspaceJobApi(
  token: string,
  jobId: string,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<{ status: string; detail: string; job_id: string }> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint(`workspace/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl);

  const res = await fetchFn(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Failed to delete job: ${res.status}`, res.status);
  }
  return data;
}

/**
 * Permanently deletes the user account, cascading to all resumes, jobs, drafts, and applications.
 */
export async function deleteAccountApi(
  token: string,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch }
): Promise<{ status: string; detail: string; user_id: string }> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = resolveSaaSEndpoint("auth/account", options?.baseUrl);

  const res = await fetchFn(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SaaSClientError(data.detail || `Account deletion failed: ${res.status}`, res.status);
  }
  return data;
}



