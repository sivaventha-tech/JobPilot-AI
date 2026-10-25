"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useJobPilot } from "@/context/JobPilotContext";
import {
  JobAnalyzeApiResponse,
  JobSource,
} from "@/types/jobpilot";
import {
  analyzeJobViaFastApi,
  buildLocalSimulatedAnalysis,
  getServiceConfig,
} from "@/services/api-client";
import {
  MatchScoreBadge,
  ProvenanceBadge,
  VerificationBadge,
} from "@/components/StatusBadge";
import {
  UploadCloud,
  Link2,
  FileText,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Trash2,
  Info,
  ArrowRight,
  Wand2,
  Server,
  Globe,
  ExternalLink,
  Save,
  Plus,
  X,
} from "lucide-react";

const SOURCES: JobSource[] = ["LinkedIn", "Naukri", "Company Website", "Other"];

export default function AddJobPage() {
  const router = useRouter();
  const { addSimulatedJob, profile } = useJobPilot();
  const serviceCfg = getServiceConfig();

  // Mode toggle: "fastapi" (calls POST /api/v1/jobs/analyze) vs "simulated" (local prototype)
  const [executionMode, setExecutionMode] = useState<"fastapi" | "simulated">(
    serviceCfg.mode === "fastapi-connected" ? "fastapi" : "simulated"
  );
  const [fastApiBaseUrl, setFastApiBaseUrl] = useState<string>(
    serviceCfg.baseUrl || "http://localhost:8000"
  );

  // Raw intake inputs
  const [source, setSource] = useState<JobSource>("LinkedIn");
  const [applicationUrl, setApplicationUrl] = useState<string>("");
  const [titleHint, setTitleHint] = useState<string>("");
  const [companyHint, setCompanyHint] = useState<string>("");
  const [locationHint, setLocationHint] = useState<string>("");
  const [salaryHint, setSalaryHint] = useState<string>("");
  const [experienceHint, setExperienceHint] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const [screenshotFile, setScreenshotFile] = useState<{
    name: string;
    size: number;
    type: string;
    previewDataUrl?: string;
  } | null>(null);

  // Analysis execution states
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] =
    useState<JobAnalyzeApiResponse | null>(null);

  // Editable post-analysis review fields (populated when analysisResult arrives)
  const [reviewedTitle, setReviewedTitle] = useState<string>("");
  const [reviewedCompany, setReviewedCompany] = useState<string>("");
  const [reviewedLocation, setReviewedLocation] = useState<string>("");
  const [reviewedWorkMode, setReviewedWorkMode] = useState<
    "Remote" | "Hybrid" | "On-site"
  >("Hybrid");
  const [reviewedSalary, setReviewedSalary] = useState<string>("");
  const [reviewedExperience, setReviewedExperience] = useState<string>("");
  const [reviewedUrl, setReviewedUrl] = useState<string>("");
  const [reviewedSkills, setReviewedSkills] = useState<string[]>([]);
  const [newSkillText, setNewSkillText] = useState<string>("");
  const [reviewedRecruiterName, setReviewedRecruiterName] =
    useState<string>("");
  const [reviewedRecruiterTitle, setReviewedRecruiterTitle] =
    useState<string>("");
  const [reviewedRecruiterEmail, setReviewedRecruiterEmail] =
    useState<string>("");
  const [reviewedRecruiterPhone, setReviewedRecruiterPhone] =
    useState<string>("");

  const populateReviewFormFromAnalysis = (res: JobAnalyzeApiResponse) => {
    setAnalysisResult(res);
    setReviewedTitle(res.extracted.title ?? "");
    setReviewedCompany(res.extracted.company ?? "");
    setReviewedLocation(res.extracted.location ?? "");
    setReviewedWorkMode(res.extracted.work_mode ?? "Hybrid");
    setReviewedSalary(res.extracted.salary ?? "");
    setReviewedExperience(res.extracted.experience ?? "");
    setReviewedUrl(res.extracted.application_url ?? applicationUrl.trim());
    setReviewedSkills(res.extracted.required_skills ?? []);
    setReviewedRecruiterName(res.extracted.contact.recruiter_name ?? "");
    setReviewedRecruiterTitle(res.extracted.contact.recruiter_title ?? "");
    setReviewedRecruiterEmail(res.extracted.contact.recruiter_email ?? "");
    setReviewedRecruiterPhone(res.extracted.contact.recruiter_phone ?? "");
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    const hasAllowedExt = allowedExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!file.type.startsWith("image/") && !hasAllowedExt) {
      setScreenshotFile(null);
      setErrorMessage(
        "Invalid file type. Please select a valid image file (PNG, JPG, WEBP, GIF) for the job screenshot."
      );
      e.target.value = "";
      return;
    }

    if (file.size === 0) {
      setScreenshotFile(null);
      setErrorMessage("The selected image file is empty (0 bytes).");
      e.target.value = "";
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setScreenshotFile(null);
      setErrorMessage(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(
          1
        )} MB) exceeds the 8 MB maximum size limit.`
      );
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotFile({
        name: file.name,
        size: file.size,
        type: file.type || "image/png",
        previewDataUrl:
          typeof reader.result === "string" ? reader.result : undefined,
      });
    };
    reader.onerror = () => {
      setErrorMessage("Failed to read the selected image file.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const validateUrl = (urlStr: string): boolean => {
    if (!urlStr.trim()) return true;
    try {
      const parsed = new URL(urlStr.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const isUrlValid = validateUrl(applicationUrl);
  const hasAnyInput =
    Boolean(screenshotFile) ||
    description.trim().length >= 10 ||
    (applicationUrl.trim().length > 0 && isUrlValid);

  const handleLoadSampleInput = () => {
    setErrorMessage(null);
    setAnalysisResult(null);
    setSource("LinkedIn");
    setTitleHint("");
    setCompanyHint("");
    setLocationHint("");
    setSalaryHint("");
    setExperienceHint("");
    setApplicationUrl("https://www.linkedin.com/jobs/view/vertexflow-ai-sample");
    setDescription(
      `VertexFlow AI is hiring a Senior AI Product Engineer to build our enterprise agent review dashboard in Bengaluru.\n\nCompensation: ₹34L – ₹46L PA\nExperience: 4 - 6 years\n\nRequirements:\n- 4+ years building modern web apps with TypeScript, React, Next.js, and Tailwind CSS\n- Strong backend experience with Python, FastAPI, PostgreSQL, and Supabase\n- Experience with Docker, REST APIs, and LLM Orchestration\n- Contact:Hiring Manager: Neha Kapoor (neha.kapoor@vertexflow.example.com)`
    );
  };

  const handleAnalyzeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isUrlValid) {
      setErrorMessage(
        "Please enter a valid http:// or https:// job posting URL, or leave the URL field blank."
      );
      return;
    }

    if (!hasAnyInput) {
      setErrorMessage(
        "Provide at least one job input: upload a job screenshot, paste a job description (at least 10 characters), or enter a valid job posting URL."
      );
      return;
    }

    const rawInput = {
      title: titleHint,
      company: companyHint,
      location: locationHint,
      salary: salaryHint,
      experience: experienceHint,
      source,
      applicationUrl,
      description,
      screenshotFile,
    };

    setIsAnalyzing(true);
    try {
      if (executionMode === "fastapi") {
        const apiRes = await analyzeJobViaFastApi(rawInput, profile, {
          baseUrl: fastApiBaseUrl,
        });
        populateReviewFormFromAnalysis(apiRes);
      } else {
        await new Promise((r) => setTimeout(r, 350));
        const simRes = buildLocalSimulatedAnalysis(rawInput, profile);
        populateReviewFormFromAnalysis(simRes);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Job analysis failed due to an unexpected error."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddReviewedSkill = () => {
    const trimmed = newSkillText.trim();
    if (!trimmed) return;
    if (!reviewedSkills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setReviewedSkills((prev) => [...prev, trimmed]);
    }
    setNewSkillText("");
  };

  const handleSaveReviewedJob = () => {
    if (!analysisResult) return;

    addSimulatedJob({
      title: reviewedTitle.trim() || undefined,
      company: reviewedCompany.trim() || undefined,
      location: reviewedLocation.trim() || undefined,
      workMode: reviewedWorkMode,
      salary: reviewedSalary.trim() || undefined,
      experience: reviewedExperience.trim() || undefined,
      requiredSkills: reviewedSkills,
      recruiterName: reviewedRecruiterName.trim() || undefined,
      recruiterTitle: reviewedRecruiterTitle.trim() || undefined,
      recruiterEmail: reviewedRecruiterEmail.trim() || undefined,
      recruiterPhone: reviewedRecruiterPhone.trim() || undefined,
      source,
      applicationUrl: reviewedUrl.trim(),
      description,
      screenshotFile,
      analysisResult,
    });

    router.push("/analysis");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Add Job & Run Extraction
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Upload a job screenshot, paste job details, or enter a URL. Inspect extracted fields, provenance, and web research before saving.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLoadSampleInput}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors self-start sm:self-auto"
        >
          <Wand2 className="w-3.5 h-3.5 text-slate-600" />
          Fill Sample Job Input
        </button>
      </div>

      {/* Analysis Engine Selector Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 mt-0.5">
            <Server className="w-4 h-4" />
          </div>
          <div className="text-xs space-y-1">
            <div className="font-bold text-sm text-slate-900">
              Analysis Mode Configuration
            </div>
            <p className="text-slate-600">
              Choose <strong>FastAPI Backend (`POST /api/v1/jobs/analyze`)</strong> for server-side extraction, provenance tracking, and configurable web research, or <strong>Local Simulated Mode</strong> when working offline.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setExecutionMode("fastapi");
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                executionMode === "fastapi"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              FastAPI Backend
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setExecutionMode("simulated");
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                executionMode === "simulated"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Local Prototype (Simulated)
            </button>
          </div>

          {executionMode === "fastapi" && (
            <input
              type="url"
              value={fastApiBaseUrl}
              onChange={(e) => setFastApiBaseUrl(e.target.value)}
              aria-label="FastAPI Base URL"
              placeholder="http://localhost:8000"
              className="w-48 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:border-slate-900 focus:outline-none"
            />
          )}
        </div>
      </div>

      {/* Mode Transparency Notice */}
      {executionMode === "simulated" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 space-y-1">
            <div className="font-semibold text-sm">
              Simulated Local Prototype Mode Active
            </div>
            <p className="leading-relaxed">
              In local prototype mode, extraction is simulated in your browser using deterministic regex rules and returns <code className="bg-amber-100 px-1 rounded">null</code> for unmentioned fields. Switch to <strong>FastAPI Backend</strong> above when running <code className="bg-amber-100 px-1 rounded">uvicorn app.main:app --port 8000</code>.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-950 space-y-1">
            <div className="font-semibold text-sm">
              Connected FastAPI Endpoint: {fastApiBaseUrl}/api/v1/jobs/analyze
            </div>
            <p className="leading-relaxed">
              Sends your job screenshot, description, and URL to the Python FastAPI service. Unknown fields are returned as <code className="bg-blue-100 px-1 rounded">null</code> with field-level provenance. Live vision AI and web search run only when <code className="bg-blue-100 px-1 rounded">GEMINI_API_KEY</code> / <code className="bg-blue-100 px-1 rounded">OPENAI_API_KEY</code> and <code className="bg-blue-100 px-1 rounded">TAVILY_API_KEY</code> / <code className="bg-blue-100 px-1 rounded">SERPER_API_KEY</code> are configured on the server.
            </p>
          </div>
        </div>
      )}

      {/* Error State Banner */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-medium text-rose-900"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">Analysis Error</div>
              <div>{errorMessage}</div>
            </div>
          </div>
          {executionMode === "fastapi" && (
            <button
              type="button"
              onClick={() => {
                setExecutionMode("simulated");
                setErrorMessage(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 shrink-0 self-start sm:self-center"
            >
              Switch to Local Simulated Mode
            </button>
          )}
        </div>
      )}

      {/* Step 2: Post-Analysis Review & Edit Panel (Displayed after analysis succeeds) */}
      {analysisResult && (
        <div
          id="analysis-review-panel"
          className="bg-white border-2 border-slate-900 rounded-xl p-6 shadow-sm space-y-6"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  Analysis Complete — Review Before Saving
                </span>
                <span className="px-2.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-800 border border-slate-200">
                  mode: {analysisResult.analysis_mode}
                </span>
                <span className="px-2.5 py-0.5 rounded text-xs bg-slate-100 text-slate-700">
                  provider: {analysisResult.ai_provider_used}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 pt-1">
                Review & Edit Extracted Job Information
              </h2>
              <p className="text-xs text-slate-600">
                Fields that could not be verified from the input are returned as{" "}
                <code className="bg-slate-100 px-1 rounded">null</code> (shown as empty below with a{" "}
                <strong>Null / Not Found</strong> provenance badge). Review or edit any field before saving to your workspace.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <MatchScoreBadge score={analysisResult.skill_match.match_score} />
              <VerificationBadge
                state={analysisResult.web_research.verification_status}
              />
            </div>
          </div>

          {/* Warnings / Honest Provider Limitations */}
          {analysisResult.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 space-y-1.5 text-xs text-amber-950">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                Analysis Notes & Provider Disclosures
              </div>
              <ul className="list-disc list-inside space-y-1">
                {analysisResult.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Editable Extracted Fields with Provenance Badges */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-title"
                  className="text-xs font-semibold text-slate-700"
                >
                  Job Title
                </label>
                <ProvenanceBadge source={analysisResult.provenance.title} />
              </div>
              <input
                id="reviewed-title"
                type="text"
                value={reviewedTitle}
                onChange={(e) => setReviewedTitle(e.target.value)}
                placeholder="null (Not found — enter title)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-company"
                  className="text-xs font-semibold text-slate-700"
                >
                  Company
                </label>
                <ProvenanceBadge source={analysisResult.provenance.company} />
              </div>
              <input
                id="reviewed-company"
                type="text"
                value={reviewedCompany}
                onChange={(e) => setReviewedCompany(e.target.value)}
                placeholder="null (Not found — enter company)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-location"
                  className="text-xs font-semibold text-slate-700"
                >
                  Location
                </label>
                <ProvenanceBadge source={analysisResult.provenance.location} />
              </div>
              <input
                id="reviewed-location"
                type="text"
                value={reviewedLocation}
                onChange={(e) => setReviewedLocation(e.target.value)}
                placeholder="null (Not found — enter location)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-salary"
                  className="text-xs font-semibold text-slate-700"
                >
                  Salary / Compensation
                </label>
                <ProvenanceBadge source={analysisResult.provenance.salary} />
              </div>
              <input
                id="reviewed-salary"
                type="text"
                value={reviewedSalary}
                onChange={(e) => setReviewedSalary(e.target.value)}
                placeholder="null (Not specified in source)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-experience"
                  className="text-xs font-semibold text-slate-700"
                >
                  Experience Required
                </label>
                <ProvenanceBadge
                  source={analysisResult.provenance.experience}
                />
              </div>
              <input
                id="reviewed-experience"
                type="text"
                value={reviewedExperience}
                onChange={(e) => setReviewedExperience(e.target.value)}
                placeholder="null (Not specified in source)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-url"
                  className="text-xs font-semibold text-slate-700"
                >
                  Application URL
                </label>
                <ProvenanceBadge
                  source={analysisResult.provenance.application_url}
                />
              </div>
              <input
                id="reviewed-url"
                type="url"
                value={reviewedUrl}
                onChange={(e) => setReviewedUrl(e.target.value)}
                placeholder="null (No URL extracted)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Extracted Contact Details & Work Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="reviewed-recruiter-name"
                  className="text-xs font-semibold text-slate-700"
                >
                  Recruiter / Contact Name
                </label>
                <ProvenanceBadge source={analysisResult.provenance.contact} />
              </div>
              <input
                id="reviewed-recruiter-name"
                type="text"
                value={reviewedRecruiterName}
                onChange={(e) => setReviewedRecruiterName(e.target.value)}
                placeholder="null"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="reviewed-recruiter-email"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Contact Email
              </label>
              <input
                id="reviewed-recruiter-email"
                type="email"
                value={reviewedRecruiterEmail}
                onChange={(e) => setReviewedRecruiterEmail(e.target.value)}
                placeholder="null"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="reviewed-recruiter-phone"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Contact Phone
              </label>
              <input
                id="reviewed-recruiter-phone"
                type="text"
                value={reviewedRecruiterPhone}
                onChange={(e) => setReviewedRecruiterPhone(e.target.value)}
                placeholder="null"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="reviewed-work-mode"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Work Mode
              </label>
              <select
                id="reviewed-work-mode"
                value={reviewedWorkMode}
                onChange={(e) =>
                  setReviewedWorkMode(
                    e.target.value as "Remote" | "Hybrid" | "On-site"
                  )
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900"
              >
                <option value="Hybrid">Hybrid</option>
                <option value="Remote">Remote</option>
                <option value="On-site">On-site</option>
              </select>
            </div>
          </div>

          {/* Extracted Required Skills Editor */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Extracted Required Skills ({reviewedSkills.length})
              </span>
              <ProvenanceBadge
                source={analysisResult.provenance.required_skills}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {reviewedSkills.map((sk) => (
                <span
                  key={sk}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-900 text-white"
                >
                  {sk}
                  <button
                    type="button"
                    onClick={() =>
                      setReviewedSkills((prev) => prev.filter((s) => s !== sk))
                    }
                    aria-label={`Remove extracted skill ${sk}`}
                    className="hover:text-rose-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {reviewedSkills.length === 0 && (
                <span className="text-xs text-slate-500">
                  No skills extracted (null). Add skills manually below if desired.
                </span>
              )}
            </div>
            <div className="flex gap-2 max-w-md pt-1">
              <input
                type="text"
                value={newSkillText}
                onChange={(e) => setNewSkillText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddReviewedSkill();
                  }
                }}
                placeholder="Add skill before saving..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
              />
              <button
                type="button"
                onClick={handleAddReviewedSkill}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>

          {/* Web Research & Evidence Section */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-slate-700" />
                Web Research & Verification Report (Provider:{" "}
                {analysisResult.web_research.provider_used})
              </div>
              <VerificationBadge
                state={analysisResult.web_research.verification_status}
              />
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              {analysisResult.web_research.summary_note}
            </p>

            {analysisResult.web_research.comparisons.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                {analysisResult.web_research.comparisons.map((cmp, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-semibold text-slate-800 capitalize">
                      <span>{cmp.field_name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                          cmp.status === "matched"
                            ? "bg-emerald-50 text-emerald-800"
                            : cmp.status === "conflicting"
                            ? "bg-rose-50 text-rose-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {cmp.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {cmp.research_finding}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {analysisResult.web_research.evidence_items.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Research Sources & Evidence ({analysisResult.web_research.evidence_items.length})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {analysisResult.web_research.evidence_items.map((ev, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-white border border-slate-200 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">
                          {ev.title}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                            ev.classification === "verified_fact"
                              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                              : ev.classification === "conflicting_info"
                              ? "bg-rose-50 text-rose-800 border border-rose-200"
                              : "bg-amber-50 text-amber-800 border border-amber-200"
                          }`}
                        >
                          {ev.classification.replace("_", " ")}
                        </span>
                      </div>
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:underline inline-flex items-center gap-1 break-all text-[11px]"
                      >
                        {ev.url}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                      <p className="text-[11px] text-slate-600 line-clamp-2">
                        {ev.snippet}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Save Reviewed Job CTA */}
          <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              Saving creates this job in <strong>Awaiting Approval (Draft)</strong> state—never automatically submitted.
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAnalysisResult(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Discard & Edit Raw Input
              </button>
              <button
                type="button"
                onClick={handleSaveReviewedJob}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors shadow-xs"
              >
                <Save className="w-4 h-4" />
                Save Reviewed Job to Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw Intake Form + Live Input Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <form
          onSubmit={handleAnalyzeSubmit}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6"
        >
          {/* 1. Source Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              1. Select Job Source
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {SOURCES.map((item) => {
                const active = source === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setSource(item)}
                    className={`py-2.5 px-3 rounded-lg text-xs font-semibold border transition-all ${
                      active
                        ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Job Screenshot Upload */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              2. Upload Job Screenshot / Image (Optional)
            </label>
            {!screenshotFile ? (
              <label
                htmlFor="job-screenshot-upload"
                className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-6 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-400 transition-colors cursor-pointer text-center"
              >
                <UploadCloud className="w-8 h-8 text-slate-500 mb-2" />
                <span className="text-sm font-semibold text-slate-800">
                  Click to select a job screenshot image
                </span>
                <span className="text-xs text-slate-500 mt-1">
                  Supports PNG, JPG, WEBP, GIF up to 8 MB
                </span>
                <input
                  id="job-screenshot-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="sr-only"
                />
              </label>
            ) : (
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {screenshotFile.previewDataUrl ? (
                    <img
                      src={screenshotFile.previewDataUrl}
                      alt="Uploaded job screenshot preview"
                      className="w-14 h-14 object-cover rounded-lg border border-slate-200 bg-white shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                      <ImageIcon className="w-5 h-5 text-slate-600" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {screenshotFile.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {(screenshotFile.size / 1024).toFixed(1)} KB • Ready for analysis
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setScreenshotFile(null)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* 3. Job Posting URL */}
          <div className="space-y-1.5">
            <label
              htmlFor="job-url-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
            >
              3. Job Posting URL
            </label>
            <div className="relative">
              <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                id="job-url-input"
                type="url"
                value={applicationUrl}
                onChange={(e) => setApplicationUrl(e.target.value)}
                placeholder="https://www.linkedin.com/jobs/view/... or company careers URL"
                className={`w-full rounded-lg border pl-10 pr-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                  !isUrlValid
                    ? "border-rose-400 bg-rose-50/30 focus:ring-rose-500/20"
                    : "border-slate-300 bg-white focus:border-slate-900 focus:ring-slate-900/10"
                }`}
              />
            </div>
            {!isUrlValid && (
              <p className="text-xs text-rose-600">
                URL must start with http:// or https://
              </p>
            )}
          </div>

          {/* 4. Optional User Hints */}
          <div className="space-y-3 pt-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              4. Known Job Hints (Optional — Leave blank to test extraction)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="job-title-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Job Title Hint
                </label>
                <input
                  id="job-title-input"
                  type="text"
                  value={titleHint}
                  onChange={(e) => setTitleHint(e.target.value)}
                  placeholder="Extracted from input if blank"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="job-company-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Company Name Hint
                </label>
                <input
                  id="job-company-input"
                  type="text"
                  value={companyHint}
                  onChange={(e) => setCompanyHint(e.target.value)}
                  placeholder="Extracted from input if blank"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="job-location-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Location Hint
                </label>
                <input
                  id="job-location-input"
                  type="text"
                  value={locationHint}
                  onChange={(e) => setLocationHint(e.target.value)}
                  placeholder="Extracted from input if blank"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="job-salary-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Salary Hint
                  </label>
                  <input
                    id="job-salary-input"
                    type="text"
                    value={salaryHint}
                    onChange={(e) => setSalaryHint(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="job-exp-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Experience Hint
                  </label>
                  <input
                    id="job-exp-input"
                    type="text"
                    value={experienceHint}
                    onChange={(e) => setExperienceHint(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 5. Paste Job Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="job-description-textarea"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
            >
              5. Paste Job Description
            </label>
            <textarea
              id="job-description-textarea"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Paste the full job description, responsibilities, and required technical skills here..."
              className="w-full rounded-lg border border-slate-300 p-3.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Unmentioned fields are returned as <code>null</code> so you can verify them before saving.
              </span>
              <span>{description.length} chars</span>
            </div>
          </div>

          {/* Submit Action */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
            <div className="text-xs text-slate-500">
              Step 1: Run extraction & research • Step 2: Review & save to workspace
            </div>
            <button
              type="submit"
              disabled={isAnalyzing}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-xs"
            >
              <Sparkles className="w-4 h-4" />
              {isAnalyzing
                ? executionMode === "fastapi"
                  ? "Calling FastAPI /api/v1/jobs/analyze..."
                  : "Running Local Simulated Analysis..."
                : executionMode === "fastapi"
                ? "Analyse Job via FastAPI"
                : "Analyse Job (Simulated Prototype)"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Right Column: Live Input Preview & Validation Checklist */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-5 sticky top-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-700" />
              Live Input Preview & Validation
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verify what will be sent to the job analyser
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <div className="font-semibold uppercase tracking-wider text-slate-400 text-[11px]">
              Intake Readiness Checklist
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Mode:{" "}
                <strong>
                  {executionMode === "fastapi"
                    ? "FastAPI Backend"
                    : "Local Simulated"}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Source selected: <strong>{source}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              {hasAnyInput ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <span>
                {hasAnyInput
                  ? "At least one job input provided"
                  : "Waiting for screenshot, description, or URL"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              {isUrlValid ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>
                {applicationUrl.trim()
                  ? isUrlValid
                    ? "Valid URL format"
                    : "Invalid URL format"
                  : "No URL provided"}
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold">
                {source}
              </span>
              <span className="text-slate-500">
                {applicationUrl.trim() ? "Source URL Attached" : "No URL"}
              </span>
            </div>
            <div>
              <div className="font-bold text-sm text-slate-900">
                {titleHint.trim() || "Title will be extracted from input"}
              </div>
              <div className="text-slate-600 mt-0.5">
                {companyHint.trim() || "Company will be extracted"} •{" "}
                {locationHint.trim() || "Location will be extracted"}
              </div>
            </div>
            {screenshotFile && (
              <div className="pt-2 border-t border-slate-200/80 flex items-center gap-2 text-emerald-800 font-medium">
                <ImageIcon className="w-3.5 h-3.5" />
                Screenshot: {screenshotFile.name}
              </div>
            )}
            <div className="pt-2 border-t border-slate-200/80 text-slate-600 line-clamp-4">
              {description.trim()
                ? description
                : "No description pasted yet. Paste job details or upload a screenshot."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
