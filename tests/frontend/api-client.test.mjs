import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Helper to transpile and load src/services/api-client.ts in Node's native test runner
 * without external test runner dependencies.
 */
function loadApiClientModule() {
  const filePath = path.resolve("src/services/api-client.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const moduleObj = { exports: {} };
  const context = vm.createContext({
    exports: moduleObj.exports,
    module: moduleObj,
    require: (id) => {
      throw new Error(`Unexpected require: ${id}`);
    },
    process: { env: {} },
    fetch: globalThis.fetch,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    URL: globalThis.URL,
  });

  vm.runInContext(transpiled.outputText, context);
  return moduleObj.exports;
}

const sampleProfile = {
  fullName: "Aarav Mehta",
  email: "aarav@example.com",
  phone: "+91 98765 43210",
  preferredRole: "Senior Full-Stack AI Engineer",
  preferredLocation: "Bengaluru",
  experienceSummary: "4.5 years building Next.js and FastAPI systems.",
  yearsOfExperience: "4.5 Years",
  education: "B.Tech CS",
  skills: ["TypeScript", "React", "Next.js", "Python", "FastAPI", "PostgreSQL"],
  portfolioOrGithubUrl: "https://github.com/aarav",
  resumeFile: null,
  updatedAt: "2026-10-25T00:00:00Z",
};

test("buildLocalSimulatedAnalysis returns null for unknown fields and tracks provenance", () => {
  const { buildLocalSimulatedAnalysis } = loadApiClientModule();

  const res = buildLocalSimulatedAnalysis(
    {
      source: "LinkedIn",
      applicationUrl: "",
      description:
        "OrbitAI is hiring a Staff Backend Engineer to build Python and FastAPI microservices.",
    },
    sampleProfile
  );

  assert.equal(res.analysis_mode, "local_simulated");
  assert.equal(res.extracted.company, "OrbitAI");
  assert.equal(res.extracted.title, "Staff Backend Engineer");
  // Unmentioned fields must be null, never fabricated
  assert.equal(res.extracted.salary, null);
  assert.equal(res.extracted.experience, null);
  assert.equal(res.extracted.location, null);
  assert.equal(res.provenance.company, "pasted_description");
  assert.equal(res.provenance.salary, "missing");
  assert.equal(res.web_research.company_verified, false);
});

test("analyzeJobViaFastApi handles valid response, HTTP 400/413 errors, malformed JSON, and timeouts", async () => {
  const { analyzeJobViaFastApi, JobAnalysisClientError } = loadApiClientModule();

  // 1. Valid FastAPI response
  const mockValidResponse = {
    analysis_mode: "deterministic_only",
    ai_provider_used: "unconfigured",
    webpage_fetched: false,
    extracted: {
      title: "AI Engineer",
      company: "NovaLabs",
      location: "Bengaluru",
      work_mode: "Hybrid",
      salary: null,
      experience: "3+ years",
      required_skills: ["Python", "FastAPI"],
      application_url: null,
      contact: {
        recruiter_name: null,
        recruiter_title: null,
        recruiter_email: null,
        recruiter_phone: null,
      },
      summary_description: "Build Python services.",
    },
    provenance: {
      title: "pasted_description",
      company: "pasted_description",
      location: "pasted_description",
      salary: "missing",
      experience: "pasted_description",
      required_skills: "pasted_description",
      application_url: "missing",
      contact: "missing",
    },
    web_research: {
      provider_used: "unconfigured",
      search_performed: false,
      verification_status: "Search Not Configured",
      company_verified: false,
      recruiter_verified: false,
      summary_note: "Not configured",
      evidence_items: [],
      comparisons: [],
      limitations: [],
    },
    skill_match: {
      match_score: 90,
      matched_skills: ["Python", "FastAPI"],
      missing_skills: [],
      match_summary: "Matched 2/2",
      is_heuristic: true,
    },
    warnings: [],
  };

  const result = await analyzeJobViaFastApi(
    {
      source: "LinkedIn",
      applicationUrl: "",
      description: "NovaLabs is hiring an AI Engineer in Bengaluru.",
    },
    sampleProfile,
    {
      baseUrl: "http://localhost:8000",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => mockValidResponse,
      }),
    }
  );
  assert.equal(result.extracted.company, "NovaLabs");
  assert.equal(result.extracted.salary, null);

  // 2. HTTP 400 Invalid Image error handling
  await assert.rejects(
    () =>
      analyzeJobViaFastApi(
        { source: "Other", applicationUrl: "", description: "test" },
        sampleProfile,
        {
          fetchImpl: async () => ({
            ok: false,
            status: 400,
            json: async () => ({
              detail: "Unsupported image content_type 'application/pdf'.",
            }),
          }),
        }
      ),
    (err) => {
      assert.ok(err instanceof JobAnalysisClientError);
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Unsupported image content_type/);
      return true;
    }
  );

  // 3. Malformed response rejection
  await assert.rejects(
    () =>
      analyzeJobViaFastApi(
        { source: "Other", applicationUrl: "", description: "test" },
        sampleProfile,
        {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ unexpected: "object" }),
          }),
        }
      ),
    (err) => {
      assert.ok(err instanceof JobAnalysisClientError);
      assert.match(err.message, /Malformed response/);
      return true;
    }
  );

  // 4. Request timeout handling
  await assert.rejects(
    () =>
      analyzeJobViaFastApi(
        { source: "Other", applicationUrl: "", description: "test" },
        sampleProfile,
        {
          timeoutMs: 30,
          fetchImpl: async (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => {
                const abortErr = new Error("Aborted");
                abortErr.name = "AbortError";
                reject(abortErr);
              });
            }),
        }
      ),
    (err) => {
      assert.ok(err instanceof JobAnalysisClientError);
      assert.match(err.message, /timed out/i);
      return true;
    }
  );
});

test("buildSimulatedJobRecord never sets status to Submitted upon analysis", () => {
  const { buildSimulatedJobRecord } = loadApiClientModule();

  const job = buildSimulatedJobRecord(
    {
      title: "Reviewed Title",
      company: "Reviewed Co",
      source: "Company Website",
      applicationUrl: "https://careers.reviewed.example.com/1",
      description: "Looking for TypeScript and FastAPI.",
    },
    sampleProfile
  );

  assert.equal(job.title, "Reviewed Title");
  assert.equal(job.company, "Reviewed Co");
  assert.equal(job.status, "Awaiting Approval");
  assert.equal(job.reviewState, "Draft");
  assert.equal(job.submittedAt, undefined);
  assert.ok(job.explainableMatch);
  assert.ok(typeof job.coverLetter === "string" && job.coverLetter.length > 0);
});

test("parseResumePdfViaFastApi handles parsed PDFs, scanned OCR-required PDFs, and HTTP 400 validation errors", async () => {
  const { parseResumePdfViaFastApi, JobAnalysisClientError } = loadApiClientModule();

  // 1. Valid parsed PDF response
  const parsedResponse = await parseResumePdfViaFastApi(
    {
      file_base64: "JVBERi0xLjQK",
      file_name: "resume.pdf",
      mime_type: "application/pdf",
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          parse_status: "parsed",
          ocr_required: false,
          page_count: 1,
          extracted_character_count: 420,
          status_message: "Extracted 420 characters.",
          parsed_resume: {
            full_name: "Aarav Mehta",
            email: "aarav@example.com",
            phone: "+91 98765 43210",
            location: "Bengaluru",
            preferred_role: "Senior Full-Stack Engineer",
            years_of_experience: "4.5 Years",
            experience_summary: "Built Next.js and FastAPI apps.",
            skills: ["TypeScript", "Python", "FastAPI"],
            employment_history: [],
            education: [],
            certifications: [],
            projects: [],
            linkedin_url: null,
            github_or_portfolio_url: null,
          },
          warnings: [],
        }),
      }),
    }
  );
  assert.equal(parsedResponse.parse_status, "parsed");
  assert.equal(parsedResponse.ocr_required, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(parsedResponse.parsed.skills)),
    ["TypeScript", "Python", "FastAPI"]
  );

  // 2. Scanned / Image-Only PDF (ocr_required = true, never fabricates fields)
  const scannedResponse = await parseResumePdfViaFastApi(
    {
      file_base64: "JVBERi0xLjQK",
      file_name: "scanned_resume.pdf",
      mime_type: "application/pdf",
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          parse_status: "ocr_required",
          ocr_required: true,
          page_count: 1,
          extracted_character_count: 0,
          status_message: "OCR is required to extract text from scanned PDFs.",
          parsed_resume: {
            full_name: null,
            email: null,
            phone: null,
            location: null,
            preferred_role: null,
            years_of_experience: null,
            experience_summary: null,
            skills: [],
            employment_history: [],
            education: [],
            certifications: [],
            projects: [],
            linkedin_url: null,
            github_or_portfolio_url: null,
          },
          warnings: ["Scanned PDF detected."],
        }),
      }),
    }
  );
  assert.equal(scannedResponse.parse_status, "ocr_required");
  assert.equal(scannedResponse.ocr_required, true);
  assert.equal(scannedResponse.parsed.full_name, null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(scannedResponse.parsed.skills)),
    []
  );

  // 3. Corrupt / Invalid PDF HTTP 400 error
  await assert.rejects(
    () =>
      parseResumePdfViaFastApi(
        {
          file_base64: "bm90LWEtcGRm",
          file_name: "bad.pdf",
          mime_type: "application/pdf",
        },
        {
          fetchImpl: async () => ({
            ok: false,
            status: 400,
            json: async () => ({
              detail: "Invalid PDF signature.",
            }),
          }),
        }
      ),
    (err) => {
      assert.ok(err instanceof JobAnalysisClientError);
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Invalid PDF signature/);
      return true;
    }
  );
});

test("computeExplainableJobMatch and generateTailoredApplicationDrafts enforce deterministic weights and anti-fabrication", () => {
  const { computeExplainableJobMatch, generateTailoredApplicationDrafts } =
    loadApiClientModule();

  const extractedFields = {
    job_title: "Senior Cloud Engineer",
    company: "SkyNet Cloud",
    location: "Bengaluru",
    work_mode: "Hybrid",
    salary: "₹35L PA",
    experience_required: "6 - 8 years",
    required_skills: ["Python", "FastAPI", "Kubernetes", "Terraform"],
    application_url: "https://careers.skynet.example.com",
    recruiter_name: "Riya Sharma",
    recruiter_email: "riya@skynet.example.com",
    recruiter_phone: null,
    summary:
      "Requires 6 - 8 years experience, Master's degree in Computer Science, and AWS Certified Solutions Architect.",
  };

  const match = computeExplainableJobMatch(
    extractedFields,
    sampleProfile,
    extractedFields.summary
  );

  assert.equal(typeof match.match_score, "number");
  assert.ok(match.match_score >= 0 && match.match_score <= 100);
  assert.deepEqual(
    JSON.parse(JSON.stringify(match.matched_skills)),
    ["Python", "FastAPI"]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(match.missing_skills)),
    ["Kubernetes", "Terraform"]
  );
  assert.equal(match.experience_alignment_status, "partial_or_below");
  assert.ok(
    match.uncertain_or_unmentioned_skills.every(
      (g) => g.status === "not_mentioned_in_resume"
    )
  );
  assert.equal(typeof match.score_breakdown.skills_score, "number");
  assert.equal(typeof match.score_breakdown.experience_score, "number");
  assert.equal(typeof match.score_breakdown.education_certs_score, "number");
  assert.equal(typeof match.score_breakdown.role_location_score, "number");
  assert.equal(typeof match.score_breakdown.weights_used.skills, "number");

  // Draft generation with sparse profile must NOT fabricate degrees, employers, or work auth
  const sparseProfile = {
    ...sampleProfile,
    yearsOfExperience: "",
    education: "",
    experienceSummary: "",
    employmentHistory: [],
    certifications: [],
    workAuthorization: "",
    noticePeriod: "",
  };

  const drafts = generateTailoredApplicationDrafts(
    extractedFields,
    sparseProfile,
    match
  );

  assert.ok(drafts.cover_letter.includes("SkyNet Cloud"));
  assert.ok(drafts.cover_letter.includes("[USER INPUT NEEDED"));
  assert.ok(drafts.questions_and_answers.some((q) => q.needs_user_input));
});

test("findPotentialDuplicateApplications detects matching company+title and duplicate URLs", () => {
  const { findPotentialDuplicateApplications } = loadApiClientModule();

  const existingJobs = [
    {
      id: "job-1",
      title: "Senior Full-Stack Engineer",
      company: "LinearStack Labs",
      applicationUrl: "https://careers.linearstack.example.com/apply/101",
      status: "Submitted",
      reviewState: "Submitted",
    },
    {
      id: "job-2",
      title: "Backend Engineer",
      company: "Acme Corp",
      applicationUrl: "https://acme.example.com/jobs/99",
      status: "Saved",
      reviewState: "Draft",
    },
  ];

  // 1. Exact match on company and title
  const dup1 = findPotentialDuplicateApplications(
    {
      id: "job-new-1",
      title: "Senior Full-Stack Engineer",
      company: "LinearStack Labs",
      applicationUrl: "https://different-url.example.com",
    },
    existingJobs
  );
  assert.equal(dup1.isDuplicate, true);
  assert.equal(dup1.duplicateMatches.length, 1);
  assert.match(dup1.warningReason || "", /active application recorded/);

  // 2. Exact match on application URL
  const dup2 = findPotentialDuplicateApplications(
    {
      id: "job-new-2",
      title: "Lead Platform Engineer",
      company: "Different Entity",
      applicationUrl: "https://careers.linearstack.example.com/apply/101",
    },
    existingJobs
  );
  assert.equal(dup2.isDuplicate, true);
  assert.match(dup2.warningReason || "", /exact application URL/);

  // 3. Unique role & URL
  const unique = findPotentialDuplicateApplications(
    {
      id: "job-new-3",
      title: "Data Engineer",
      company: "NovaPulse AI",
      applicationUrl: "https://novapulse.example.com/apply/103",
    },
    existingJobs
  );
  assert.equal(unique.isDuplicate, false);
  assert.equal(unique.duplicateMatches.length, 0);
});

test("callBrowserAssistantApi enforces mandatory user confirmation and handles restricted portals", async () => {
  const { callBrowserAssistantApi } = loadApiClientModule();

  // 1. Mandatory approval gate: halts if confirmed_by_user is false
  const unconfirmed = await callBrowserAssistantApi({
    job_id: "test-job-1",
    destination_url: "https://careers.example.com/apply/1",
    source: "Company Website",
    candidate_profile: sampleProfile,
    cover_letter: "Cover letter",
    answers: [],
    confirmed_by_user: false, // Unconfirmed!
  });
  assert.equal(unconfirmed.submission_confirmed, false);
  assert.equal(unconfirmed.outcome, "Validation Error");
  assert.equal(unconfirmed.final_status, "Awaiting Approval");

  // 2. Restricted LinkedIn portal: returns guided manual packet
  const linkedInResp = await callBrowserAssistantApi({
    job_id: "test-job-2",
    destination_url: "https://www.linkedin.com/jobs/view/12345",
    source: "LinkedIn",
    candidate_profile: sampleProfile,
    cover_letter: "Tailored letter",
    answers: [{ id: "q1", category: "Motivation", question: "Why?", answer: "Good fit" }],
    confirmed_by_user: true,
  });
  assert.equal(linkedInResp.platform_policy, "restricted_manual_guided");
  assert.equal(linkedInResp.outcome, "Manual Action Required");
  assert.equal(linkedInResp.final_status, "Approved");
  assert.equal(linkedInResp.submission_confirmed, false);
  assert.ok(linkedInResp.clipboard_packet["Full Name"] === "Aarav Mehta");

  // 3. Permitted portal confirmed submission via FastAPI mock
  const permittedResp = await callBrowserAssistantApi(
    {
      job_id: "test-job-3",
      destination_url: "https://careers.company.example.com/apply",
      source: "Company Website",
      candidate_profile: sampleProfile,
      cover_letter: "Grounded cover letter",
      answers: [],
      confirmed_by_user: true,
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: "test-job-3",
          destination_url: "https://careers.company.example.com/apply",
          platform_policy: "permitted_direct_assistant",
          outcome: "Submitted",
          final_status: "Submitted",
          submission_confirmed: true,
          confirmation_evidence: "Found receipt: Application submitted successfully",
          step_summary: "Confirmed application",
          filled_fields: ["fullName", "email", "coverLetter"],
          clipboard_packet: {},
          attempt_record: {
            id: "attempt-1",
            timestamp: "2026-10-25T00:00:00Z",
            destinationUrl: "https://careers.company.example.com/apply",
            source: "Company Website",
            mode: "browser_assisted",
            outcome: "Submitted",
            finalStatus: "Submitted",
            confirmationDetails: "Receipt #12345",
            answersSubmittedCount: 0,
          },
          warnings: [],
          errors: [],
        }),
      }),
    }
  );
  assert.equal(permittedResp.submission_confirmed, true);
  assert.equal(permittedResp.outcome, "Submitted");
  assert.equal(permittedResp.final_status, "Submitted");
});
