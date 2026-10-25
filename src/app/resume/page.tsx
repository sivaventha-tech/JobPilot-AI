"use client";

import React, { useState, useEffect } from "react";
import { useJobPilot } from "@/context/JobPilotContext";
import { parseResumePdfViaFastApi } from "@/services/api-client";
import {
  EducationEntry,
  EmploymentEntry,
  ParsedResumeData,
  ProjectEntry,
  ResumeParseApiResponse,
} from "@/types/jobpilot";
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Plus,
  X,
  Save,
  Info,
  UserCheck,
  Loader2,
  Sparkles,
  Award,
  Briefcase,
  FolderGit2,
} from "lucide-react";

export default function ResumePage() {
  const {
    profile,
    updateProfile,
    uploadResumeMetadata,
    removeResumeMetadata,
    isHydrated,
  } = useJobPilot();

  const [fullName, setFullName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email);
  const [phone, setPhone] = useState(profile.phone);
  const [preferredRole, setPreferredRole] = useState(profile.preferredRole);
  const [preferredLocation, setPreferredLocation] = useState(
    profile.preferredLocation
  );
  const [yearsOfExperience, setYearsOfExperience] = useState(
    profile.yearsOfExperience
  );
  const [experienceSummary, setExperienceSummary] = useState(
    profile.experienceSummary
  );
  const [education, setEducation] = useState(profile.education);
  const [portfolioOrGithubUrl, setPortfolioOrGithubUrl] = useState(
    profile.portfolioOrGithubUrl
  );
  const [workAuthorization, setWorkAuthorization] = useState(
    profile.workAuthorization || ""
  );
  const [noticePeriod, setNoticePeriod] = useState(profile.noticePeriod || "");
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [certifications, setCertifications] = useState<string[]>(
    profile.certifications || []
  );
  const [employmentHistory, setEmploymentHistory] = useState<EmploymentEntry[]>(
    profile.employmentHistory || []
  );
  const [educationEntries, setEducationEntries] = useState<EducationEntry[]>(
    profile.educationEntries || []
  );
  const [projects, setProjects] = useState<ProjectEntry[]>(
    profile.projects || []
  );

  const [newSkillInput, setNewSkillInput] = useState("");
  const [newCertInput, setNewCertInput] = useState("");

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [parseResultBanner, setParseResultBanner] = useState<{
    status: "parsed" | "ocr_required" | "empty_text" | "offline";
    message: string;
    warnings: string[];
  } | null>(null);

  // Staged extracted resume data awaiting explicit user review before profile update
  const [stagedParsedData, setStagedParsedData] =
    useState<ParsedResumeData | null>(null);
  const [stagedSkillsText, setStagedSkillsText] = useState("");
  const [stagedCertsText, setStagedCertsText] = useState("");
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isHydrated) {
      setFullName(profile.fullName);
      setEmail(profile.email);
      setPhone(profile.phone);
      setPreferredRole(profile.preferredRole);
      setPreferredLocation(profile.preferredLocation);
      setYearsOfExperience(profile.yearsOfExperience);
      setExperienceSummary(profile.experienceSummary);
      setEducation(profile.education);
      setPortfolioOrGithubUrl(profile.portfolioOrGithubUrl);
      setWorkAuthorization(profile.workAuthorization || "");
      setNoticePeriod(profile.noticePeriod || "");
      setSkills(profile.skills);
      setCertifications(profile.certifications || []);
      setEmploymentHistory(profile.employmentHistory || []);
      setEducationEntries(profile.educationEntries || []);
      setProjects(profile.projects || []);
    }
  }, [profile, isHydrated]);

  const persistProfileDraft = (
    overrides?: Partial<{
      fullName: string;
      email: string;
      phone: string;
      preferredRole: string;
      preferredLocation: string;
      yearsOfExperience: string;
      experienceSummary: string;
      education: string;
      portfolioOrGithubUrl: string;
      workAuthorization: string;
      noticePeriod: string;
      skills: string[];
      certifications: string[];
      employmentHistory: EmploymentEntry[];
      educationEntries: EducationEntry[];
      projects: ProjectEntry[];
    }>
  ) => {
    updateProfile({
      fullName: (overrides?.fullName ?? fullName).trim() || "Candidate",
      email: (overrides?.email ?? email).trim(),
      phone: (overrides?.phone ?? phone).trim(),
      preferredRole: (overrides?.preferredRole ?? preferredRole).trim(),
      preferredLocation: (
        overrides?.preferredLocation ?? preferredLocation
      ).trim(),
      yearsOfExperience: (
        overrides?.yearsOfExperience ?? yearsOfExperience
      ).trim(),
      experienceSummary: overrides?.experienceSummary ?? experienceSummary,
      education: (overrides?.education ?? education).trim(),
      portfolioOrGithubUrl: (
        overrides?.portfolioOrGithubUrl ?? portfolioOrGithubUrl
      ).trim(),
      workAuthorization: (
        overrides?.workAuthorization ?? workAuthorization
      ).trim(),
      noticePeriod: (overrides?.noticePeriod ?? noticePeriod).trim(),
      skills: overrides?.skills ?? skills,
      certifications: overrides?.certifications ?? certifications,
      employmentHistory: overrides?.employmentHistory ?? employmentHistory,
      educationEntries: overrides?.educationEntries ?? educationEntries,
      projects: overrides?.projects ?? projects,
      resumeFile: profile.resumeFile,
      updatedAt: new Date().toISOString(),
    });
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(new Error("Failed to read PDF file in browser."));
      reader.readAsDataURL(file);
    });

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setParseResultBanner(null);
    setStagedParsedData(null);

    const file = e.target.files?.[0];
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadError(
        `Invalid file type ("${file.name}"). Please select a valid PDF file (.pdf).`
      );
      e.target.value = "";
      return;
    }

    if (file.size === 0) {
      setUploadError("The selected PDF file is empty (0 bytes).");
      e.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(
          1
        )} MB) exceeds the 10 MB maximum size limit.`
      );
      e.target.value = "";
      return;
    }

    e.target.value = "";
    setIsParsingPdf(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response: ResumeParseApiResponse = await parseResumePdfViaFastApi({
        file_base64: dataUrl,
        file_name: file.name,
        mime_type: file.type || "application/pdf",
      });

      if (response.parse_status === "ocr_required") {
        uploadResumeMetadata({
          fileName: file.name,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          uploadStatus: "OCR Required — Image-Only / Scanned PDF",
          pageCount: response.page_count,
          extractedCharCount: response.extracted_char_count,
          ocrRequired: true,
        });
        setParseResultBanner({
          status: "ocr_required",
          message: response.status_message,
          warnings: response.warnings,
        });
      } else if (response.parse_status === "empty_text") {
        uploadResumeMetadata({
          fileName: file.name,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          uploadStatus: "Uploaded — No Extractable Text",
          pageCount: response.page_count,
          extractedCharCount: response.extracted_char_count,
          ocrRequired: response.ocr_required,
        });
        setParseResultBanner({
          status: "empty_text",
          message: response.status_message,
          warnings: response.warnings,
        });
      } else {
        uploadResumeMetadata({
          fileName: file.name,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          uploadStatus: "Parsed via FastAPI (Awaiting User Review)",
          pageCount: response.page_count,
          extractedCharCount: response.extracted_char_count,
          ocrRequired: false,
        });
        setStagedParsedData(response.parsed);
        setStagedSkillsText(response.parsed.skills.join(", "));
        setStagedCertsText(response.parsed.certifications.join(", "));
        setParseResultBanner({
          status: "parsed",
          message: response.status_message,
          warnings: response.warnings,
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to parse resume PDF.";
      const isValidationOrPdfError =
        msg.includes("400") ||
        msg.includes("413") ||
        msg.includes("415") ||
        msg.includes("422") ||
        msg.toLowerCase().includes("signature") ||
        msg.toLowerCase().includes("corrupt") ||
        msg.toLowerCase().includes("encrypted") ||
        msg.toLowerCase().includes("empty") ||
        msg.toLowerCase().includes("exceeds");

      if (isValidationOrPdfError) {
        setUploadError(msg);
      } else {
        uploadResumeMetadata({
          fileName: file.name,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          uploadStatus:
            "Uploaded (Local Storage — FastAPI Parser Offline)",
        });
        setParseResultBanner({
          status: "offline",
          message: `Recorded "${file.name}" in local storage. Real PDF text extraction could not run because the FastAPI backend is unreachable (${msg}). Start the backend server or edit your profile manually below.`,
          warnings: [],
        });
      }
    } finally {
      setIsParsingPdf(false);
    }
  };

  const handleApplyStagedResumeToProfile = () => {
    if (!stagedParsedData) return;

    const parsedSkills = stagedSkillsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const mergedSkills = Array.from(
      new Set(parsedSkills.length > 0 ? parsedSkills : skills)
    );

    const parsedCerts = stagedCertsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const formattedEducation =
      stagedParsedData.education.length > 0
        ? stagedParsedData.education
            .map((ed) =>
              [ed.degree, ed.institution, ed.year ? `(${ed.year})` : ""]
                .filter(Boolean)
                .join(", ")
            )
            .join(" | ")
        : education;

    const nextFullName = stagedParsedData.full_name?.trim() || fullName;
    const nextEmail = stagedParsedData.email?.trim() || email;
    const nextPhone = stagedParsedData.phone?.trim() || phone;
    const nextPreferredRole =
      stagedParsedData.preferred_role?.trim() || preferredRole;
    const nextPreferredLocation =
      stagedParsedData.location?.trim() || preferredLocation;
    const nextYearsExp =
      stagedParsedData.years_of_experience?.trim() || yearsOfExperience;
    const nextExpSummary =
      stagedParsedData.experience_summary?.trim() || experienceSummary;
    const nextPortfolio =
      stagedParsedData.github_or_portfolio_url?.trim() ||
      stagedParsedData.linkedin_url?.trim() ||
      portfolioOrGithubUrl;
    const nextEmploymentHistory =
      stagedParsedData.employment_history.length > 0
        ? stagedParsedData.employment_history
        : employmentHistory;
    const nextEducationEntries =
      stagedParsedData.education.length > 0
        ? stagedParsedData.education
        : educationEntries;
    const nextProjects =
      stagedParsedData.projects.length > 0
        ? stagedParsedData.projects
        : projects;

    setFullName(nextFullName);
    setEmail(nextEmail);
    setPhone(nextPhone);
    setPreferredRole(nextPreferredRole);
    setPreferredLocation(nextPreferredLocation);
    setYearsOfExperience(nextYearsExp);
    setExperienceSummary(nextExpSummary);
    setEducation(formattedEducation);
    setPortfolioOrGithubUrl(nextPortfolio);
    setSkills(mergedSkills);
    setCertifications(parsedCerts);
    setEmploymentHistory(nextEmploymentHistory);
    setEducationEntries(nextEducationEntries);
    setProjects(nextProjects);

    const updatedResumeMeta = profile.resumeFile
      ? {
          ...profile.resumeFile,
          uploadStatus: "Parsed & Applied to Candidate Profile" as const,
        }
      : null;

    updateProfile({
      fullName: nextFullName,
      email: nextEmail,
      phone: nextPhone,
      preferredRole: nextPreferredRole,
      preferredLocation: nextPreferredLocation,
      yearsOfExperience: nextYearsExp,
      experienceSummary: nextExpSummary,
      education: formattedEducation,
      portfolioOrGithubUrl: nextPortfolio,
      workAuthorization,
      noticePeriod,
      skills: mergedSkills,
      certifications: parsedCerts,
      employmentHistory: nextEmploymentHistory,
      educationEntries: nextEducationEntries,
      projects: nextProjects,
      resumeFile: updatedResumeMeta,
      updatedAt: new Date().toISOString(),
    });

    setStagedParsedData(null);
    setSaveSuccess(
      "Reviewed resume data applied to your Candidate Profile and all job match scores recalculated!"
    );
    setTimeout(() => setSaveSuccess(null), 5000);
  };

  const handleAddSkill = () => {
    const trimmed = newSkillInput.trim();
    if (!trimmed) return;
    if (skills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setNewSkillInput("");
      return;
    }
    const nextSkills = [...skills, trimmed];
    setSkills(nextSkills);
    setNewSkillInput("");
    persistProfileDraft({ skills: nextSkills });
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    const nextSkills = skills.filter((s) => s !== skillToRemove);
    setSkills(nextSkills);
    persistProfileDraft({ skills: nextSkills });
  };

  const handleAddCertification = () => {
    const trimmed = newCertInput.trim();
    if (!trimmed) return;
    if (certifications.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setNewCertInput("");
      return;
    }
    const nextCerts = [...certifications, trimmed];
    setCertifications(nextCerts);
    setNewCertInput("");
    persistProfileDraft({ certifications: nextCerts });
  };

  const handleRemoveCertification = (certToRemove: string) => {
    const nextCerts = certifications.filter((c) => c !== certToRemove);
    setCertifications(nextCerts);
    persistProfileDraft({ certifications: nextCerts });
  };

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    persistProfileDraft();
    setSaveSuccess(
      "Candidate profile saved to local workspace and explainable job match scores recalculated."
    );
    setTimeout(() => setSaveSuccess(null), 4000);
  };

  if (!isHydrated) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 rounded-lg" />
        <div className="h-96 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Resume & Candidate Profile
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload a text-based PDF resume to extract candidate details with human-in-the-loop review, or edit your profile directly for deterministic job matching and tailored drafts.
        </p>
      </div>

      {/* Resume Parsing Privacy & OCR Honesty Notice */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-950 space-y-1">
          <div className="font-semibold text-sm">
            Real Text-Based PDF Parsing with Human Review Gate
          </div>
          <p className="leading-relaxed">
            When you upload a PDF below, JobPilot AI validates the PDF signature (<code className="bg-blue-100 px-1 py-0.5 rounded">%PDF-</code>) and extracts text via <code className="bg-blue-100 px-1 py-0.5 rounded">POST /api/v1/resume/parse</code>. Extracted fields are shown in a <strong>Review & Edit panel</strong> first—your profile is never overwritten without your confirmation. Scanned or image-only PDFs are detected and reported honestly as requiring OCR rather than returning fabricated data.
          </p>
        </div>
      </div>

      {/* Parse Result / OCR Required Banner */}
      {parseResultBanner && (
        <div
          role="status"
          className={`rounded-xl border p-4 flex items-start gap-3 ${
            parseResultBanner.status === "parsed"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-950"
              : parseResultBanner.status === "ocr_required" ||
                parseResultBanner.status === "empty_text"
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-slate-300 bg-slate-100 text-slate-800"
          }`}
        >
          {parseResultBanner.status === "parsed" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="text-xs space-y-1.5 flex-1">
            <div className="font-bold text-sm">
              {parseResultBanner.status === "parsed"
                ? "PDF Resume Parsed — Review Extracted Information Below"
                : parseResultBanner.status === "ocr_required"
                ? "Scanned or Image-Only PDF Detected — OCR Required"
                : parseResultBanner.status === "empty_text"
                ? "No Extractable Text Found in PDF"
                : "Local Storage Fallback (FastAPI Backend Offline)"}
            </div>
            <p className="leading-relaxed">{parseResultBanner.message}</p>
            {parseResultBanner.warnings.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] opacity-90">
                {parseResultBanner.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Human-in-the-Loop Review & Edit Panel for Newly Parsed Resume Data */}
      {stagedParsedData && (
        <div className="bg-white border-2 border-emerald-500 rounded-xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-900">
                <Sparkles className="w-3 h-3" />
                Review Before Saving
              </span>
              <h2 className="text-lg font-bold text-slate-900 mt-1">
                Review & Edit Extracted Resume Information
              </h2>
              <p className="text-xs text-slate-600">
                Verify the fields extracted from your PDF. Missing fields are left blank—never invented. Edit anything below before applying to your Candidate Profile.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStagedParsedData(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Discard Preview
              </button>
              <button
                type="button"
                onClick={handleApplyStagedResumeToProfile}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4" />
                Apply Reviewed Data to Candidate Profile
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Extracted Full Name
              </label>
              <input
                type="text"
                value={stagedParsedData.full_name || ""}
                onChange={(e) =>
                  setStagedParsedData({
                    ...stagedParsedData,
                    full_name: e.target.value || null,
                  })
                }
                placeholder="Not detected in PDF"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Extracted Email
              </label>
              <input
                type="email"
                value={stagedParsedData.email || ""}
                onChange={(e) =>
                  setStagedParsedData({
                    ...stagedParsedData,
                    email: e.target.value || null,
                  })
                }
                placeholder="Not detected in PDF"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Extracted Phone
              </label>
              <input
                type="text"
                value={stagedParsedData.phone || ""}
                onChange={(e) =>
                  setStagedParsedData({
                    ...stagedParsedData,
                    phone: e.target.value || null,
                  })
                }
                placeholder="Not detected in PDF"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Detected Role / Headline
              </label>
              <input
                type="text"
                value={stagedParsedData.preferred_role || ""}
                onChange={(e) =>
                  setStagedParsedData({
                    ...stagedParsedData,
                    preferred_role: e.target.value || null,
                  })
                }
                placeholder="Not detected in PDF"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Detected Location
              </label>
              <input
                type="text"
                value={stagedParsedData.location || ""}
                onChange={(e) =>
                  setStagedParsedData({
                    ...stagedParsedData,
                    location: e.target.value || null,
                  })
                }
                placeholder="Not detected in PDF"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Detected Years of Experience
              </label>
              <input
                type="text"
                value={stagedParsedData.years_of_experience || ""}
                onChange={(e) =>
                  setStagedParsedData({
                    ...stagedParsedData,
                    years_of_experience: e.target.value || null,
                  })
                }
                placeholder="Not explicitly stated"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Extracted Summary
            </label>
            <textarea
              rows={2}
              value={stagedParsedData.experience_summary || ""}
              onChange={(e) =>
                setStagedParsedData({
                  ...stagedParsedData,
                  experience_summary: e.target.value || null,
                })
              }
              placeholder="No summary paragraph detected"
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Extracted Skills (comma-separated)
              </label>
              <input
                type="text"
                value={stagedSkillsText}
                onChange={(e) => setStagedSkillsText(e.target.value)}
                placeholder="No skills detected"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Extracted Certifications (comma-separated)
              </label>
              <input
                type="text"
                value={stagedCertsText}
                onChange={(e) => setStagedCertsText(e.target.value)}
                placeholder="No certifications detected"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-bold text-slate-800">
                Employment History ({stagedParsedData.employment_history.length})
              </div>
              {stagedParsedData.employment_history.length === 0 ? (
                <p className="text-slate-500">None extracted</p>
              ) : (
                stagedParsedData.employment_history.map((emp, idx) => (
                  <div key={idx} className="text-slate-700">
                    <span className="font-semibold">
                      {emp.title || emp.role}
                    </span>
                    {emp.company ? ` at ${emp.company}` : ""}
                    {emp.duration ? ` (${emp.duration})` : ""}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-bold text-slate-800">
                Education ({stagedParsedData.education.length})
              </div>
              {stagedParsedData.education.length === 0 ? (
                <p className="text-slate-500">None extracted</p>
              ) : (
                stagedParsedData.education.map((ed, idx) => (
                  <div key={idx} className="text-slate-700">
                    <span className="font-semibold">{ed.degree}</span>
                    {ed.institution ? `, ${ed.institution}` : ""}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-bold text-slate-800">
                Projects ({stagedParsedData.projects.length})
              </div>
              {stagedParsedData.projects.length === 0 ? (
                <p className="text-slate-500">None extracted</p>
              ) : (
                stagedParsedData.projects.map((proj, idx) => (
                  <div key={idx} className="text-slate-700">
                    <span className="font-semibold">{proj.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Resume PDF Upload & Status */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-700" />
              Resume PDF Upload & Parser
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload a text-based PDF to extract skills, roles, and education
            </p>
          </div>

          {uploadError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {isParsingPdf && (
            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 text-xs text-blue-900 flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-blue-700 shrink-0" />
              <span>
                Validating PDF signature and extracting structured resume sections...
              </span>
            </div>
          )}

          {/* Current Upload Status Card */}
          {profile.resumeFile ? (
            <div
              className={`rounded-xl border p-4 space-y-3 ${
                profile.resumeFile.ocrRequired
                  ? "border-amber-300 bg-amber-50/60"
                  : "border-emerald-200 bg-emerald-50/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  {profile.resumeFile.ocrRequired ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div
                      className={`text-xs font-semibold uppercase tracking-wider ${
                        profile.resumeFile.ocrRequired
                          ? "text-amber-900"
                          : "text-emerald-800"
                      }`}
                    >
                      {profile.resumeFile.uploadStatus}
                    </div>
                    <div className="text-sm font-bold text-slate-900 break-all mt-1">
                      {profile.resumeFile.fileName}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70">
                <span>
                  Size: {(profile.resumeFile.fileSize / 1024).toFixed(1)} KB
                </span>
                {typeof profile.resumeFile.pageCount === "number" && (
                  <span>Pages: {profile.resumeFile.pageCount}</span>
                )}
                <span>
                  Uploaded:{" "}
                  {new Date(profile.resumeFile.uploadedAt).toLocaleDateString()}
                </span>
              </div>

              <div className="pt-1 flex items-center justify-between gap-2">
                <label
                  htmlFor="replace-resume-pdf"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  Replace & Re-Parse PDF
                  <input
                    id="replace-resume-pdf"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleResumeUpload}
                    className="sr-only"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => {
                    removeResumeMetadata();
                    setStagedParsedData(null);
                    setParseResultBanner(null);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-100/70 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-900 space-y-1">
              <div className="font-semibold">Status: No Resume PDF Uploaded</div>
              <p>
                Select a text-based PDF file below to parse candidate skills, experience, and education.
              </p>
            </div>
          )}

          {/* Dropzone / File Picker */}
          <label
            htmlFor="resume-pdf-input"
            className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-6 bg-slate-50/70 hover:bg-slate-50 hover:border-slate-400 transition-colors cursor-pointer text-center"
          >
            <UploadCloud className="w-8 h-8 text-slate-500 mb-2" />
            <span className="text-sm font-semibold text-slate-800">
              Select Resume PDF to Parse
            </span>
            <span className="text-xs text-slate-500 mt-1">
              PDF format only (.pdf) up to 10 MB
            </span>
            <input
              id="resume-pdf-input"
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleResumeUpload}
              className="sr-only"
            />
          </label>

          {/* Parsed Structured Sections Summary */}
          <div className="space-y-3 pt-2 border-t border-slate-100 text-xs">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-slate-600" />
              Recorded Employment History ({employmentHistory.length})
            </div>
            {employmentHistory.length === 0 ? (
              <p className="text-slate-500">
                No structured employment roles recorded yet.
              </p>
            ) : (
              <div className="space-y-2">
                {employmentHistory.slice(0, 3).map((emp, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                  >
                    <div className="font-semibold text-slate-900">
                      {emp.title || emp.role}
                      {emp.company ? ` • ${emp.company}` : ""}
                    </div>
                    {emp.duration && (
                      <div className="text-[11px] text-slate-500">
                        {emp.duration}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="font-bold text-slate-800 flex items-center gap-1.5 pt-2">
              <FolderGit2 className="w-3.5 h-3.5 text-slate-600" />
              Recorded Projects ({projects.length})
            </div>
            {projects.length === 0 ? (
              <p className="text-slate-500">No projects recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {projects.slice(0, 3).map((proj, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                  >
                    <div className="font-semibold text-slate-900">
                      {proj.name}
                    </div>
                    {proj.description && (
                      <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">
                        {proj.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right 2 Columns: Candidate Profile Form */}
        <form
          onSubmit={handleProfileSave}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-slate-700" />
                Candidate Profile Form
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Used by the deterministic matching engine and grounded cover letter / Q&A generator
              </p>
            </div>
            {saveSuccess && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {saveSuccess}
              </span>
            )}
          </div>

          {/* Personal & Contact Info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="profile-fullname"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Full Name
              </label>
              <input
                id="profile-fullname"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  persistProfileDraft({ fullName: e.target.value });
                }}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="profile-email"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  persistProfileDraft({ email: e.target.value });
                }}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="profile-phone"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Phone / WhatsApp
              </label>
              <input
                id="profile-phone"
                type="text"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  persistProfileDraft({ phone: e.target.value });
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Preferred Role & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="profile-preferred-role"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Preferred Role
              </label>
              <input
                id="profile-preferred-role"
                type="text"
                value={preferredRole}
                onChange={(e) => {
                  setPreferredRole(e.target.value);
                  persistProfileDraft({ preferredRole: e.target.value });
                }}
                required
                placeholder="e.g., Senior Full-Stack AI Engineer"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="profile-preferred-location"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Preferred Location & Work Mode
              </label>
              <input
                id="profile-preferred-location"
                type="text"
                value={preferredLocation}
                onChange={(e) => {
                  setPreferredLocation(e.target.value);
                  persistProfileDraft({ preferredLocation: e.target.value });
                }}
                required
                placeholder="e.g., Bengaluru, India (Hybrid / Remote)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Experience & Education */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="profile-years-exp"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Years of Experience
              </label>
              <input
                id="profile-years-exp"
                type="text"
                value={yearsOfExperience}
                onChange={(e) => {
                  setYearsOfExperience(e.target.value);
                  persistProfileDraft({ yearsOfExperience: e.target.value });
                }}
                placeholder="e.g., 4.5 Years"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="profile-education"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Education
              </label>
              <input
                id="profile-education"
                type="text"
                value={education}
                onChange={(e) => {
                  setEducation(e.target.value);
                  persistProfileDraft({ education: e.target.value });
                }}
                placeholder="e.g., B.Tech in Computer Science, NIT Trichy"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Work Authorization & Notice Period */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="profile-work-auth"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Work Authorization (Never Invented by AI)
              </label>
              <input
                id="profile-work-auth"
                type="text"
                value={workAuthorization}
                onChange={(e) => {
                  setWorkAuthorization(e.target.value);
                  persistProfileDraft({ workAuthorization: e.target.value });
                }}
                placeholder="e.g., Authorized to work in India without sponsorship"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="profile-notice-period"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Notice Period / Availability
              </label>
              <input
                id="profile-notice-period"
                type="text"
                value={noticePeriod}
                onChange={(e) => {
                  setNoticePeriod(e.target.value);
                  persistProfileDraft({ noticePeriod: e.target.value });
                }}
                placeholder="e.g., 30 days / Immediate"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="profile-exp-summary"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Experience Summary
            </label>
            <textarea
              id="profile-exp-summary"
              rows={3}
              value={experienceSummary}
              onChange={(e) => {
                setExperienceSummary(e.target.value);
                persistProfileDraft({ experienceSummary: e.target.value });
              }}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* Skills Tag Editor */}
          <div className="space-y-2.5">
            <label
              htmlFor="profile-add-skill"
              className="block text-xs font-semibold text-slate-700"
            >
              Skills ({skills.length})
            </label>
            <div className="flex gap-2">
              <input
                id="profile-add-skill"
                type="text"
                value={newSkillInput}
                onChange={(e) => setNewSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSkill();
                  }
                }}
                placeholder="Add a skill (e.g., Redis, GraphQL, AWS) and press Enter"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddSkill}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Skill
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    aria-label={`Remove ${skill}`}
                    className="hover:text-rose-300 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Certifications Tag Editor */}
          <div className="space-y-2.5">
            <label
              htmlFor="profile-add-cert"
              className="block text-xs font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <Award className="w-3.5 h-3.5 text-slate-600" />
              Certifications ({certifications.length})
            </label>
            <div className="flex gap-2">
              <input
                id="profile-add-cert"
                type="text"
                value={newCertInput}
                onChange={(e) => setNewCertInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCertification();
                  }
                }}
                placeholder="Add a verified certification (e.g., AWS Certified Developer, CKA)"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCertification}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Certification
              </button>
            </div>

            {certifications.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {certifications.map((cert) => (
                  <span
                    key={cert}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-900 border border-blue-200"
                  >
                    {cert}
                    <button
                      type="button"
                      onClick={() => handleRemoveCertification(cert)}
                      aria-label={`Remove ${cert}`}
                      className="hover:text-rose-600 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="profile-portfolio"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Portfolio / GitHub URL
            </label>
            <input
              id="profile-portfolio"
              type="url"
              value={portfolioOrGithubUrl}
              onChange={(e) => {
                setPortfolioOrGithubUrl(e.target.value);
                persistProfileDraft({ portfolioOrGithubUrl: e.target.value });
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Last updated: {new Date(profile.updatedAt).toLocaleString()}
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors shadow-xs"
            >
              <Save className="w-4 h-4" />
              Save Profile Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
