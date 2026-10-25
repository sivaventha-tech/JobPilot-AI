"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useJobPilot } from "@/context/JobPilotContext";
import {
  callBrowserAssistantApi,
  findPotentialDuplicateApplications,
  generateTailoredApplicationDrafts,
} from "@/services/api-client";
import { JobSelectorBar } from "@/components/JobSelectorBar";
import {
  ApplicationAttempt,
  ApplicationQuestionAnswer,
  BrowserAssistApiResponse,
} from "@/types/jobpilot";
import {
  CheckCircle2,
  FileEdit,
  Send,
  ShieldCheck,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  RotateCcw,
  Save,
  AlertCircle,
  AlertTriangle,
  FileText,
  Sparkles,
  Building2,
  Compass,
  History,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";

export default function ApplicationReviewPage() {
  const {
    jobs,
    selectedJob,
    profile,
    updateJobQuestions,
    updateJobCoverLetter,
    regenerateJobDrafts,
    approveApplication,
    revertToDraft,
    markAsManuallySubmitted,
    recordApplicationAttempt,
    retryApplication,
    isHydrated,
  } = useJobPilot();

  const [questions, setQuestions] = useState<ApplicationQuestionAnswer[]>([]);
  const [coverLetter, setCoverLetter] = useState<string>("");
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newAnswerText, setNewAnswerText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Mandatory Approval Gate Modal & Duplicate Check
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalCheckbox, setApprovalCheckbox] = useState(false);
  const [duplicateAckCheckbox, setDuplicateAckCheckbox] = useState(false);

  // Browser-Assisted Execution & Guided Manual Flow state
  const [isAssisting, setIsAssisting] = useState(false);
  const [assistStep, setAssistStep] = useState<string | null>(null);
  const [assistResult, setAssistResult] =
    useState<BrowserAssistApiResponse | null>(null);

  useEffect(() => {
    if (selectedJob) {
      setQuestions(selectedJob.questionsAndAnswers);
      if (selectedJob.coverLetter) {
        setCoverLetter(selectedJob.coverLetter);
      } else {
        const generated = generateTailoredApplicationDrafts(
          {
            title: selectedJob.title,
            company: selectedJob.company,
            location: selectedJob.location,
            work_mode: selectedJob.workMode,
            salary: selectedJob.salary,
            experience: selectedJob.experience,
            required_skills: selectedJob.requiredSkills,
            application_url: selectedJob.applicationUrl || null,
            contact: {
              recruiter_name: selectedJob.outreach.recruiterName || null,
              recruiter_title: selectedJob.outreach.recruiterTitle || null,
              recruiter_email: selectedJob.outreach.recruiterEmail || null,
              recruiter_phone:
                selectedJob.outreach.recruiterPhoneOrWhatsApp || null,
            },
            summary_description: selectedJob.description,
          },
          profile
        );
        setCoverLetter(generated.cover_letter);
      }
    }
  }, [
    selectedJob?.id,
    selectedJob?.questionsAndAnswers,
    selectedJob?.coverLetter,
    profile,
  ]);

  // Duplicate Application Detection
  const duplicateReport = useMemo(() => {
    if (!selectedJob) {
      return { isDuplicate: false, duplicateMatches: [], warningReason: null };
    }
    return findPotentialDuplicateApplications(
      {
        id: selectedJob.id,
        title: selectedJob.title,
        company: selectedJob.company,
        applicationUrl: selectedJob.applicationUrl,
      },
      jobs
    );
  }, [selectedJob, jobs]);

  // Unanswered / Incomplete Input Check
  const questionsNeedingInputCount = useMemo(
    () =>
      questions.filter(
        (q) => q.needsUserInput || q.answer.includes("[USER INPUT NEEDED")
      ).length,
    [questions]
  );
  const coverLetterNeedsInput = coverLetter.includes("[USER INPUT NEEDED");
  const hasIncompleteItems =
    questionsNeedingInputCount > 0 || coverLetterNeedsInput;

  const handleCoverLetterChange = (updatedText: string) => {
    if (!selectedJob) return;
    setCoverLetter(updatedText);
    updateJobCoverLetter(selectedJob.id, updatedText);
  };

  const handleAnswerChange = (id: string, updatedAnswer: string) => {
    if (!selectedJob) return;
    const stillNeedsInput = updatedAnswer.includes("[USER INPUT NEEDED");
    const updated = questions.map((q) =>
      q.id === id
        ? {
            ...q,
            answer: updatedAnswer,
            needsUserInput: stillNeedsInput,
            lastEditedAt: new Date().toISOString(),
          }
        : q
    );
    setQuestions(updated);
    updateJobQuestions(selectedJob.id, updated);
  };

  const handleQuestionTitleChange = (id: string, updatedQuestion: string) => {
    if (!selectedJob) return;
    const updated = questions.map((q) =>
      q.id === id
        ? {
            ...q,
            question: updatedQuestion,
            lastEditedAt: new Date().toISOString(),
          }
        : q
    );
    setQuestions(updated);
    updateJobQuestions(selectedJob.id, updated);
  };

  const handleSaveEdits = () => {
    if (!selectedJob) return;
    updateJobQuestions(selectedJob.id, questions);
    updateJobCoverLetter(selectedJob.id, coverLetter);
    setFeedbackBanner("Cover letter and application answer edits saved to draft.");
    setTimeout(() => setFeedbackBanner(null), 3500);
  };

  const handleRegenerateDrafts = () => {
    if (!selectedJob) return;
    regenerateJobDrafts(selectedJob.id);
    setFeedbackBanner(
      "Regenerated tailored cover letter and application answers using only verified Candidate Profile facts."
    );
    setTimeout(() => setFeedbackBanner(null), 4000);
  };

  const handleAddQuestion = () => {
    if (!selectedJob || !newQuestionText.trim()) return;
    const added: ApplicationQuestionAnswer = {
      id: `qa-${Date.now()}`,
      category: "Custom",
      question: newQuestionText.trim(),
      answer:
        newAnswerText.trim() ||
        "[USER INPUT NEEDED: Provide your verified answer before submitting]",
      needsUserInput: !newAnswerText.trim(),
      lastEditedAt: new Date().toISOString(),
    };
    const updated = [...questions, added];
    setQuestions(updated);
    updateJobQuestions(selectedJob.id, updated);
    setNewQuestionText("");
    setNewAnswerText("");
  };

  const handleDeleteQuestion = (id: string) => {
    if (!selectedJob) return;
    const updated = questions.filter((q) => q.id !== id);
    setQuestions(updated);
    updateJobQuestions(selectedJob.id, updated);
  };

  const handleApprove = () => {
    if (!selectedJob) return;
    updateJobQuestions(selectedJob.id, questions);
    updateJobCoverLetter(selectedJob.id, coverLetter);
    approveApplication(selectedJob.id);
    setFeedbackBanner(
      "Application marked as Approved! Review answers below, then use the Mandatory Approval Gate to launch browser assistance or manual submission."
    );
  };

  const handleRevertDraft = () => {
    if (!selectedJob) return;
    revertToDraft(selectedJob.id);
    setFeedbackBanner(
      "Application moved back to Draft state for further editing."
    );
  };

  const handleRetryApplication = () => {
    if (!selectedJob) return;
    retryApplication(selectedJob.id);
    setAssistResult(null);
    setFeedbackBanner(
      "Application reset to Draft state for mandatory review before resubmission."
    );
  };

  const handleCopyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
    }
  };

  /**
   * Executes the Browser-Assisted Application workflow after passing the Mandatory Approval Gate.
   */
  const handleLaunchAssistedApplication = async () => {
    if (!selectedJob || !approvalCheckbox) return;
    if (duplicateReport.isDuplicate && !duplicateAckCheckbox) return;

    setIsApprovalModalOpen(false);
    setIsAssisting(true);
    setAssistStep("Validating approved answers and verifying portal policy...");
    setAssistResult(null);

    try {
      // Small simulated step progression for clear visual feedback
      await new Promise((r) => setTimeout(r, 600));
      setAssistStep(
        selectedJob.source === "LinkedIn" || selectedJob.source === "Naukri"
          ? `Preparing guided manual clipboard packet for restricted portal (${selectedJob.source})...`
          : "Connecting to public company portal and mapping application fields..."
      );

      const resp = await callBrowserAssistantApi({
        job_id: selectedJob.id,
        destination_url: selectedJob.applicationUrl || "https://company.example.com",
        source: selectedJob.source,
        candidate_profile: profile,
        cover_letter: coverLetter,
        answers: questions,
        confirmed_by_user: true,
        acknowledged_duplicate: duplicateAckCheckbox,
      });

      setAssistResult(resp);
      recordApplicationAttempt(selectedJob.id, resp.attempt_record, resp.final_status);

      if (resp.submission_confirmed) {
        setFeedbackBanner(
          "Application submitted successfully! Credible confirmation was detected and recorded in your application history."
        );
      } else if (resp.outcome === "Manual Action Required") {
        setFeedbackBanner(
          `Guided packet ready for ${selectedJob.source}. Open portal, paste pre-copied answers, and confirm upon completion.`
        );
      } else {
        setFeedbackBanner(
          `Application attempt ended with outcome: ${resp.outcome}. Review the status in your attempt history below.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Assist attempt failed.";
      const attempt: ApplicationAttempt = {
        id: `attempt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        destinationUrl: selectedJob.applicationUrl || "Portal",
        source: selectedJob.source,
        mode: "browser_assisted",
        outcome: "Validation Error",
        finalStatus: "Failed",
        errorMessage: msg,
        answersSubmittedCount: questions.length,
      };
      recordApplicationAttempt(selectedJob.id, attempt, "Failed");
      setFeedbackBanner(`Submission error: ${msg}`);
    } finally {
      setIsAssisting(false);
      setAssistStep(null);
    }
  };

  const handleUserConfirmedManualPortalSubmission = () => {
    if (!selectedJob) return;
    const attempt: ApplicationAttempt = {
      id: `attempt-manual-${Date.now()}`,
      timestamp: new Date().toISOString(),
      destinationUrl: selectedJob.applicationUrl || "Portal",
      source: selectedJob.source,
      mode: "manual_guided",
      outcome: "Submitted",
      finalStatus: "Submitted",
      confirmationDetails: "Candidate manually confirmed completion on employer portal",
      answersSubmittedCount: questions.length,
      duplicateWarningAcknowledged: duplicateAckCheckbox,
    };
    recordApplicationAttempt(selectedJob.id, attempt, "Submitted");
    markAsManuallySubmitted(selectedJob.id);
    setAssistResult(null);
    setFeedbackBanner(
      "Application recorded as Submitted in your tracker and history."
    );
  };

  if (!isHydrated) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-14 bg-slate-200 rounded-xl" />
        <div className="h-96 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Application Preparation & Mandatory Approval Gate
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Review grounded cover letters and answers, check duplicate alerts, and approve semi-automatic or manual submission.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          {selectedJob && (
            <button
              type="button"
              onClick={handleRegenerateDrafts}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-slate-700" />
              Regenerate Grounded Drafts
            </button>
          )}
          <Link
            href="/outreach"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Prepare Recruiter Outreach →
          </Link>
        </div>
      </div>

      {/* Job Selector */}
      <JobSelectorBar label="Reviewing Application For" />

      {!selectedJob ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <p className="text-sm text-slate-600">
            Select or add a job to review its application materials.
          </p>
        </div>
      ) : (
        <>
          {/* Preparation & Pipeline Context Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Target Opportunity
                </div>
                <div className="text-lg font-bold text-slate-900 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{selectedJob.title}</span>
                  <span className="text-slate-400 font-normal">at</span>
                  <span className="text-slate-800">{selectedJob.company}</span>
                </div>
              </div>

              {/* Match Score & Destination Link */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    Match Score
                  </div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {selectedJob.matchScore}%
                  </div>
                </div>
                {selectedJob.applicationUrl ? (
                  <a
                    href={selectedJob.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                  >
                    Open {selectedJob.source} Portal
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded border border-amber-200">
                    No Destination URL Provided
                  </span>
                )}
              </div>
            </div>

            {/* Preparation Summary Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="text-slate-500 font-medium">Job Source & Policy</div>
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-slate-600" />
                  {selectedJob.source} (
                  {selectedJob.source === "LinkedIn" || selectedJob.source === "Naukri"
                    ? "Restricted Manual Guided"
                    : "Permitted Company Portal"}
                  )
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="text-slate-500 font-medium">Resume File Attached</div>
                <div className="font-bold text-slate-800 truncate">
                  {profile.resumeFile?.fileName || "No PDF Attached (Profile Text Only)"}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="text-slate-500 font-medium">Missing Skills / Gaps</div>
                <div className="font-bold text-slate-800">
                  {selectedJob.missingSkills.length === 0
                    ? "Zero technical skill gaps detected"
                    : `${selectedJob.missingSkills.length} unmentioned/missing (${selectedJob.missingSkills.slice(0, 3).join(", ")})`}
                </div>
              </div>
            </div>

            {/* Duplicate Application Warning */}
            {duplicateReport.isDuplicate && (
              <div className="p-4 rounded-xl border border-amber-300 bg-amber-50/90 text-xs text-amber-950 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                  Duplicate Application Detected
                </div>
                <p>{duplicateReport.warningReason}</p>
                <label className="flex items-center gap-2 pt-1 font-semibold text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={duplicateAckCheckbox}
                    onChange={(e) => setDuplicateAckCheckbox(e.target.checked)}
                    className="rounded text-amber-800 focus:ring-amber-500"
                  />
                  <span>I acknowledge this existing application and intentionally wish to proceed with a new submission attempt.</span>
                </label>
              </div>
            )}

            {/* Unverified Placeholder Markers Alert */}
            {hasIncompleteItems && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold">
                    User Input Needed Before Submission ({questionsNeedingInputCount}{" "}
                    {questionsNeedingInputCount === 1 ? "question" : "questions"}
                    {coverLetterNeedsInput ? " + cover letter" : ""})
                  </div>
                  <p>
                    Items marked with{" "}
                    <code className="bg-amber-100 px-1 py-0.5 rounded font-semibold">
                      [USER INPUT NEEDED]
                    </code>{" "}
                    require your verified personal information. JobPilot AI never invents employers, years of experience, or work authorization.
                  </p>
                </div>
              </div>
            )}

            {/* Stepper: Draft -> Approved -> Submitted */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-2">
              <div
                className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  selectedJob.reviewState === "Draft"
                    ? "bg-amber-50 border-amber-300 text-amber-900 ring-2 ring-amber-500/20"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                <FileEdit className="w-4 h-4 shrink-0" />
                <div>
                  <div>1. Draft</div>
                  <div className="text-[10px] font-normal opacity-80">
                    Reviewing & Editing
                  </div>
                </div>
              </div>

              <div
                className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  selectedJob.reviewState === "Approved"
                    ? "bg-emerald-50 border-emerald-300 text-emerald-900 ring-2 ring-emerald-500/20"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <div>
                  <div>2. Approved</div>
                  <div className="text-[10px] font-normal opacity-80">
                    Ready for Approval Gate
                  </div>
                </div>
              </div>

              <div
                className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  selectedJob.reviewState === "Submitted"
                    ? "bg-indigo-50 border-indigo-300 text-indigo-900 ring-2 ring-indigo-500/20"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                <Send className="w-4 h-4 shrink-0" />
                <div>
                  <div>3. Submitted</div>
                  <div className="text-[10px] font-normal opacity-80">
                    Confirmed Submission
                  </div>
                </div>
              </div>
            </div>

            {/* Prominent Action Bar */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start gap-3 text-xs text-slate-700">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-900">
                    Human-in-the-Loop Application Guarantee
                  </div>
                  <p>
                    Applications require explicit candidate authorization. Status is only updated to <strong>Submitted</strong> after credible confirmation is detected or verified.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {selectedJob.reviewState === "Draft" && (
                  <button
                    type="button"
                    onClick={handleApprove}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve Application Drafts
                  </button>
                )}

                {selectedJob.reviewState === "Approved" && (
                  <>
                    <button
                      type="button"
                      onClick={handleRevertDraft}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Move Back to Draft
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setApprovalCheckbox(false);
                        setIsApprovalModalOpen(true);
                      }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors shadow-xs"
                    >
                      <Send className="w-4 h-4" />
                      Proceed to Mandatory Approval Gate
                    </button>
                  </>
                )}

                {selectedJob.reviewState === "Submitted" && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200">
                      Submitted{" "}
                      {selectedJob.submittedAt
                        ? `on ${new Date(selectedJob.submittedAt).toLocaleDateString()}`
                        : ""}
                    </span>
                    <button
                      type="button"
                      onClick={handleRetryApplication}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Re-review for Resubmission
                    </button>
                  </div>
                )}
              </div>
            </div>

            {feedbackBanner && (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{feedbackBanner}</span>
              </div>
            )}
          </div>

          {/* Active Browser-Assisted Execution Progress Drawer */}
          {isAssisting && (
            <div className="p-5 rounded-xl border border-indigo-300 bg-indigo-50/70 text-indigo-950 space-y-3">
              <div className="flex items-center gap-2.5 font-bold text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-700 shrink-0" />
                <span>Executing Safe Browser-Assisted Workflow...</span>
              </div>
              <p className="text-xs text-indigo-800">{assistStep}</p>
            </div>
          )}

          {/* Assisted Workflow Result / Guided Manual Steps */}
          {assistResult && (
            <div className="bg-white border-2 border-indigo-400 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Compass className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-sm text-slate-900">
                    Application Assist Workflow Result: {assistResult.outcome}
                  </h3>
                </div>
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded ${
                    assistResult.submission_confirmed
                      ? "bg-emerald-100 text-emerald-800"
                      : assistResult.outcome === "Manual Action Required"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  Status: {assistResult.final_status}
                </span>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                {assistResult.step_summary}
              </p>

              {assistResult.confirmation_evidence && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{assistResult.confirmation_evidence}</span>
                </div>
              )}

              {/* Guided Manual Clipboard Packet for LinkedIn / Naukri */}
              {assistResult.platform_policy === "restricted_manual_guided" && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="text-xs font-bold text-slate-800">
                    Pre-Packaged Copy-Paste Materials for {selectedJob.source}:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {Object.entries(assistResult.clipboard_packet).map(
                      ([key, val]) => (
                        <div
                          key={key}
                          className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-700 block truncate">
                              {key}
                            </span>
                            <span className="text-[11px] text-slate-500 truncate block">
                              {val.slice(0, 45)}...
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyText(key, val)}
                            className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 text-[11px] shrink-0 font-medium"
                          >
                            {copiedId === key ? "Copied" : "Copy"}
                          </button>
                        </div>
                      )
                    )}
                  </div>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">
                      Paste into the employer portal, complete human security checks, and confirm submission below.
                    </span>
                    <button
                      type="button"
                      onClick={handleUserConfirmedManualPortalSubmission}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      I Finished Submitting on {selectedJob.source}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tailored Cover Letter Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-700" />
                  Tailored Cover Letter (Grounded in Verified Profile)
                  {coverLetterNeedsInput && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300">
                      Needs User Input
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Uses only verified skills, employers, and education from your Candidate Profile.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopyText("cover-letter", coverLetter)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200 transition-colors self-start sm:self-auto"
              >
                {copiedId === "cover-letter" ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Copied Cover Letter
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Cover Letter
                  </>
                )}
              </button>
            </div>

            <textarea
              rows={9}
              value={coverLetter}
              onChange={(e) => handleCoverLetterChange(e.target.value)}
              aria-label="Tailored cover letter"
              className="w-full rounded-xl border border-slate-300 bg-slate-50/40 p-3.5 text-sm text-slate-900 leading-relaxed focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* Proposed & Editable Application Answers */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Application Answers ({questions.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Edit any response below before submission.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveEdits}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors self-start sm:self-auto"
              >
                <Save className="w-3.5 h-3.5" />
                Save Answer Edits
              </button>
            </div>

            {questions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                No questions listed yet. Add a custom portal question below.
              </div>
            ) : (
              <div className="space-y-4">
                {questions.map((qa, index) => {
                  const requiresInput =
                    Boolean(qa.needsUserInput) ||
                    qa.answer.includes("[USER INPUT NEEDED");
                  return (
                    <div
                      key={qa.id}
                      className={`p-4 rounded-xl border space-y-3 ${
                        requiresInput
                          ? "border-amber-300 bg-amber-50/40"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-200 text-slate-800">
                            Q{index + 1} • {qa.category}
                          </span>
                          {requiresInput && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-200 text-amber-950">
                              <AlertTriangle className="w-3 h-3" />
                              Needs User Input
                            </span>
                          )}
                          <input
                            type="text"
                            value={qa.question}
                            onChange={(e) =>
                              handleQuestionTitleChange(qa.id, e.target.value)
                            }
                            aria-label={`Application question ${index + 1}`}
                            className="flex-1 min-w-[200px] bg-transparent font-semibold text-sm text-slate-900 border-b border-transparent focus:border-slate-400 focus:bg-white px-1.5 py-0.5 rounded focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={() => handleCopyText(qa.id, qa.answer)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
                          >
                            {copiedId === qa.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                Copy Answer
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(qa.id)}
                            aria-label="Delete question"
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={4}
                        value={qa.answer}
                        onChange={(e) =>
                          handleAnswerChange(qa.id, e.target.value)
                        }
                        aria-label={`Answer for ${qa.question}`}
                        className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 leading-relaxed focus:border-slate-900 focus:outline-none"
                      />

                      {(qa.missingProfileFields &&
                        qa.missingProfileFields.length > 0) ||
                      (qa.groundingSources &&
                        qa.groundingSources.length > 0) ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                          {qa.groundingSources &&
                            qa.groundingSources.length > 0 && (
                              <span>
                                Grounded in:{" "}
                                <strong className="text-slate-700">
                                  {qa.groundingSources.join(", ")}
                                </strong>
                              </span>
                            )}
                          {qa.missingProfileFields &&
                            qa.missingProfileFields.length > 0 && (
                              <span className="text-amber-800 font-medium">
                                Unverified / Missing in profile:{" "}
                                {qa.missingProfileFields.join(", ")}
                              </span>
                            )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Custom Question Section */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Add Custom Portal Question
              </div>
              <div className="grid grid-cols-1 gap-3">
                <input
                  type="text"
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="Enter an additional question from the job application form..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <textarea
                  rows={2}
                  value={newAnswerText}
                  onChange={(e) => setNewAnswerText(e.target.value)}
                  placeholder="Write your tailored answer..."
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <div>
                  <button
                    type="button"
                    onClick={handleAddQuestion}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Question to Application
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Application Submission History Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-700" />
                <h3 className="text-base font-bold text-slate-900">
                  Application Submission History (
                  {selectedJob.submissionHistory?.length || 0})
                </h3>
              </div>
              {selectedJob.status === "Failed" && (
                <button
                  type="button"
                  onClick={handleRetryApplication}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retry Application
                </button>
              )}
            </div>

            {!selectedJob.submissionHistory ||
            selectedJob.submissionHistory.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                No submission attempts recorded yet. Applications require explicit approval in the Mandatory Approval Gate before any attempt is logged.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedJob.submissionHistory.map((attempt) => (
                  <div
                    key={attempt.id}
                    className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                      attempt.outcome === "Submitted"
                        ? "border-emerald-200 bg-emerald-50/40"
                        : attempt.outcome === "Manual Action Required"
                        ? "border-blue-200 bg-blue-50/40"
                        : "border-rose-200 bg-rose-50/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                            attempt.outcome === "Submitted"
                              ? "bg-emerald-100 text-emerald-900"
                              : attempt.outcome === "Manual Action Required"
                              ? "bg-blue-100 text-blue-900"
                              : "bg-rose-100 text-rose-900"
                          }`}
                        >
                          {attempt.outcome}
                        </span>
                        <span className="text-slate-500 font-mono text-[11px]">
                          {new Date(attempt.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-slate-600 uppercase">
                        Mode: {attempt.mode.replace("_", " ")}
                      </span>
                    </div>

                    <div className="text-slate-700">
                      <strong>Destination:</strong> {attempt.destinationUrl}
                    </div>

                    {attempt.confirmationDetails && (
                      <div className="text-emerald-800 font-medium">
                        Receipt: {attempt.confirmationDetails}
                      </div>
                    )}
                    {attempt.errorMessage && (
                      <div className="text-rose-800 font-medium">
                        Error / Interruption: {attempt.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mandatory Approval Gate Modal */}
          {isApprovalModalOpen && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    Mandatory Final Approval Gate
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsApprovalModalOpen(false)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                <div className="text-xs text-slate-700 space-y-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div>
                      <strong>Target Company:</strong> {selectedJob.company}
                    </div>
                    <div>
                      <strong>Role Title:</strong> {selectedJob.title}
                    </div>
                    <div>
                      <strong>Destination Portal:</strong>{" "}
                      <span className="break-all font-mono text-[11px]">
                        {selectedJob.applicationUrl || "Direct Company Website"}
                      </span>
                    </div>
                    <div>
                      <strong>Attached Resume:</strong>{" "}
                      {profile.resumeFile?.fileName || "Candidate Profile Form Data"}
                    </div>
                    <div>
                      <strong>Application Answers:</strong> {questions.length} tailored responses prepared
                    </div>
                  </div>

                  {/* Platform Policy Notice */}
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-bold">
                        {selectedJob.source === "LinkedIn" || selectedJob.source === "Naukri"
                          ? `Restricted Workflow for ${selectedJob.source}`
                          : "Permitted Company Portal Workflow"}
                      </div>
                      <p className="leading-relaxed">
                        {selectedJob.source === "LinkedIn" || selectedJob.source === "Naukri"
                          ? "Direct third-party bot submission is restricted on this platform. JobPilot AI will launch a guided manual walkthrough with one-click clipboard packets and prompt you to confirm receipt once submitted."
                          : "JobPilot AI will pre-fill permitted form fields and inspect the destination page for a verified submission confirmation."}
                      </p>
                    </div>
                  </div>

                  {/* Duplicate Warning Check if duplicate detected */}
                  {duplicateReport.isDuplicate && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-1.5">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-700" />
                        Duplicate Warning
                      </div>
                      <p>{duplicateReport.warningReason}</p>
                      <label className="flex items-center gap-2 pt-1 font-semibold text-amber-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={duplicateAckCheckbox}
                          onChange={(e) => setDuplicateAckCheckbox(e.target.checked)}
                          className="rounded text-amber-800 focus:ring-amber-500"
                        />
                        <span>I acknowledge duplicate submission risk and confirm proceeding.</span>
                      </label>
                    </div>
                  )}

                  {/* Incomplete items warning if any */}
                  {hasIncompleteItems && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs">
                      <strong>Warning:</strong> Application answers still contain{" "}
                      <code>[USER INPUT NEEDED]</code> placeholders. Submitting unverified answers is not recommended.
                    </div>
                  )}

                  {/* Final explicit confirmation checkbox */}
                  <div className="pt-2">
                    <label className="flex items-start gap-2.5 font-bold text-slate-900 cursor-pointer bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <input
                        type="checkbox"
                        checked={approvalCheckbox}
                        onChange={(e) => setApprovalCheckbox(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 mt-0.5"
                      />
                      <span>
                        I have verified all application materials, approve the submission details, and authorize JobPilot AI to proceed with this application.
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsApprovalModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      !approvalCheckbox ||
                      (duplicateReport.isDuplicate && !duplicateAckCheckbox)
                    }
                    onClick={handleLaunchAssistedApplication}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Authorize & Launch Application
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
