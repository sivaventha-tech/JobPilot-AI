"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useJobPilot } from "@/context/JobPilotContext";
import { ApplicationStatus } from "@/types/jobpilot";
import { formatSafeExternalUrl, isValidJobId } from "@/services/api-client";
import {
  ApplicationStatusBadge,
  MatchScoreBadge,
  ReviewStateBadge,
  VerificationBadge,
} from "@/components/StatusBadge";
import {
  ArrowLeft,
  ExternalLink,
  Briefcase,
  MapPin,
  Building2,
  DollarSign,
  Clock,
  Sparkles,
  CheckSquare,
  ScanSearch,
  MessageSquareShare,
  CalendarCheck,
  AlertCircle,
  AlertTriangle,
  History,
  CheckCircle2,
  FileText,
  Mail,
  User,
  Phone,
  ShieldCheck,
  Info,
  ChevronRight,
  PlusCircle,
} from "lucide-react";

const ALL_STATUSES: ApplicationStatus[] = [
  "Saved",
  "Analysing",
  "Awaiting Approval",
  "Approved",
  "Submitted",
  "Interview",
  "Rejected",
  "Failed",
];

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id;
  const jobId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const {
    jobs,
    selectJob,
    updateJobStatus,
    isHydrated,
  } = useJobPilot();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const job = useMemo(() => {
    if (!jobId) return null;
    return jobs.find((j) => j.id === jobId) || null;
  }, [jobs, jobId]);

  // Keep active job context synchronized when viewing this job
  useEffect(() => {
    if (job) {
      selectJob(job.id);
    }
  }, [job, selectJob]);

  const safeExternalUrl = useMemo(() => {
    return formatSafeExternalUrl(job?.applicationUrl);
  }, [job?.applicationUrl]);

  const handleStatusChange = (newStatus: ApplicationStatus) => {
    if (!job) return;
    updateJobStatus(job.id, newStatus);
    setStatusMessage(`Application status updated to "${newStatus}"`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const navigateToFeature = (route: string) => {
    if (job) {
      selectJob(job.id);
      router.push(route);
    }
  };

  // Loading skeleton while localStorage is hydrating
  if (!isHydrated) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-48 bg-slate-200 rounded-lg" />
        <div className="h-40 bg-slate-200 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-slate-200 rounded-xl" />
          ))}
        </div>
        <div className="h-96 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  // Graceful handling for missing or invalid job ID
  if (!isValidJobId(jobId) || !job) {
    return (
      <div className="space-y-8 max-w-4xl mx-auto py-8">
        <div className="bg-white border border-amber-200 rounded-2xl p-8 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Job Application Not Found
            </h1>
            <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
              No job record was found for ID{" "}
              <code className="px-2 py-0.5 rounded bg-slate-100 font-mono text-xs text-slate-800">
                {jobId || "(empty ID)"}
              </code>
              . It may have been deleted, or the link may be invalid.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Dashboard
            </Link>
            <Link
              href="/tracker"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              <Briefcase className="w-4 h-4 text-slate-600" />
              Browse Tracker ({jobs.length} Jobs)
            </Link>
            <Link
              href="/add-job"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              <PlusCircle className="w-4 h-4 text-slate-600" />
              Add New Job
            </Link>
          </div>
        </div>

        {jobs.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Available Jobs in Your Workspace
            </h2>
            <div className="divide-y divide-slate-100">
              {jobs.slice(0, 5).map((availableJob) => (
                <div
                  key={availableJob.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <Link
                      href={`/jobs/${availableJob.id}`}
                      className="text-sm font-semibold text-slate-900 hover:text-blue-600 hover:underline"
                    >
                      {availableJob.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {availableJob.company} • {availableJob.location}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MatchScoreBadge score={availableJob.matchScore} />
                    <ApplicationStatusBadge status={availableJob.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-500">
        <Link
          href="/"
          className="hover:text-slate-900 inline-flex items-center gap-1 font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        <Link
          href="/tracker"
          className="hover:text-slate-900 font-medium transition-colors"
        >
          Tracker
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        <span className="font-semibold text-slate-900 truncate max-w-xs sm:max-w-md">
          {job.title}
        </span>
      </nav>

      {/* Status Update Banner */}
      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Hero Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-800">
                {job.source}
              </span>
              <VerificationBadge state={job.verificationState} />
              <ReviewStateBadge state={job.reviewState} />
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {job.title}
            </h1>

            <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-sm text-slate-600">
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-slate-500" />
                {job.company}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4 text-slate-500" />
                {job.location} ({job.workMode})
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4 text-slate-500" />
                Exp: {job.experience || "Not Specified"}
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="w-4 h-4 text-slate-500" />
                {job.salary || "Not Disclosed"}
              </span>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
            {/* Safe External Job Posting Link */}
            {safeExternalUrl ? (
              <a
                href={safeExternalUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open original job posting on ${job.source} in new tab`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs sm:text-sm font-semibold hover:bg-blue-700 transition-colors shadow-xs"
              >
                <span>Open Original Posting ({job.source})</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <div
                title="No external URL was recorded for this job. Intake was provided via manual input or screenshot."
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200"
              >
                <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                <span>No External Posting URL</span>
              </div>
            )}

            {/* Internal JobPilot Workflow Actions */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigateToFeature("/review")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Review & Approve
              </button>
              <button
                type="button"
                onClick={() => navigateToFeature("/analysis")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                <ScanSearch className="w-3.5 h-3.5" />
                Deep Analysis
              </button>
              <button
                type="button"
                onClick={() => navigateToFeature("/outreach")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                <MessageSquareShare className="w-3.5 h-3.5" />
                Recruiter Outreach
              </button>
            </div>
          </div>
        </div>

        {/* 4 Metric Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
          <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Match Score
            </div>
            <div className="mt-1 flex items-center gap-2">
              <MatchScoreBadge score={job.matchScore} />
              <span className="text-xs font-semibold text-slate-700">
                {job.matchedSkills.length}/{job.requiredSkills.length} skills
              </span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Current Status
            </div>
            <div className="mt-1">
              <ApplicationStatusBadge status={job.status} />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Review Gate
            </div>
            <div className="mt-1">
              <ReviewStateBadge state={job.reviewState} />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Application Attempts
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900">
              {job.submissionHistory?.length || 0} recorded
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols wide on lg): Match Breakdown + Full Description */}
        <div className="lg:col-span-2 space-y-6">
          {/* Explainable Match Evaluation */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-slate-700" />
                Explainable Match Analysis ({job.matchScore}%)
              </h2>
              <span className="text-xs text-slate-500 font-medium">
                Deterministic Weighted Scoring
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-200/80">
              {job.matchSummary}
            </p>

            <div className="space-y-3">
              <div>
                <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                  Matched Skills ({job.matchedSkills.length})
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {job.matchedSkills.length > 0 ? (
                    job.matchedSkills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-900 border border-emerald-200"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        {skill}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500 italic">
                      No direct skill matches found in profile.
                    </span>
                  )}
                </div>
              </div>

              {job.missingSkills.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                    Identified Skill Gaps ({job.missingSkills.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {job.missingSkills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200"
                      >
                        <AlertCircle className="w-3 h-3 text-amber-600" />
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  All Required Job Skills ({job.requiredSkills.length})
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {job.requiredSkills.map((skill) => (
                    <span
                      key={skill}
                      className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Full Job Description */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <FileText className="w-4 h-4 text-slate-700" />
              Role Description & Requirements
            </h2>
            <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {job.description || (
                <span className="text-slate-400 italic">
                  No detailed description recorded for this job.
                </span>
              )}
            </div>
          </div>

          {/* Application Submission History */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <History className="w-4 h-4 text-slate-700" />
              Submission Attempt History
            </h2>

            {!job.submissionHistory || job.submissionHistory.length === 0 ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                No application submission attempts recorded yet. Applications must be explicitly approved in the Review step before submission.
              </div>
            ) : (
              <div className="space-y-3">
                {job.submissionHistory.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">
                        {attempt.outcome} ({attempt.mode.replace("_", " ")})
                      </span>
                      <span className="text-slate-500 font-mono text-[11px]">
                        {new Date(attempt.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      Destination:{" "}
                      <span className="font-mono text-[11px] text-slate-800">
                        {attempt.destinationUrl}
                      </span>
                    </div>
                    {attempt.confirmationDetails && (
                      <div className="text-emerald-800 bg-emerald-50 p-2 rounded border border-emerald-200">
                        Confirmation: {attempt.confirmationDetails}
                      </div>
                    )}
                    {attempt.errorMessage && (
                      <div className="text-rose-800 bg-rose-50 p-2 rounded border border-rose-200">
                        Error: {attempt.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 Col wide on lg): Lifecycle Status Controls & External Links */}
        <div className="space-y-6">
          {/* Lifecycle Status Management */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Manage Lifecycle Status
            </h3>
            <div className="space-y-2">
              <label
                htmlFor="lifecycle-status-selector"
                className="text-xs text-slate-600 font-medium block"
              >
                Update Application State:
              </label>
              <select
                id="lifecycle-status-selector"
                value={job.status}
                onChange={(e) =>
                  handleStatusChange(e.target.value as ApplicationStatus)
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {ALL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              Note: Marking as <strong>Submitted</strong> requires human review and confirmation of actual submission.
            </div>
          </div>

          {/* External Posting Information */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
              External Job Posting Link
            </h3>

            {safeExternalUrl ? (
              <div className="space-y-2">
                <a
                  href={safeExternalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-between p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-blue-900 hover:bg-blue-100 transition-colors text-xs font-semibold group"
                >
                  <span className="truncate mr-2">Open Original Link ({job.source})</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </a>
                <div className="text-[11px] text-slate-500 break-all font-mono bg-slate-50 p-2 rounded border border-slate-100">
                  {safeExternalUrl}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <div className="font-semibold text-slate-800">No External URL Stored</div>
                <div className="text-[11px] text-slate-500">
                  This job opportunity was added via screenshot extraction or text description. You can review or edit details internally.
                </div>
              </div>
            )}

            {job.sourceLinks && job.sourceLinks.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-semibold text-slate-700">
                  Additional Recorded Links ({job.sourceLinks.length}):
                </div>
                {job.sourceLinks.map((link, idx) => {
                  const safeLinkUrl = formatSafeExternalUrl(link.url);
                  return (
                    <div key={idx} className="text-xs">
                      {safeLinkUrl ? (
                        <a
                          href={safeLinkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1 font-medium break-all"
                        >
                          <span>{link.label || link.url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-slate-500">{link.label || link.url}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Verification & Evidence */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
              Verification State
            </h3>
            <VerificationBadge state={job.verificationState} />
            <p className="text-xs text-slate-600 leading-relaxed">
              {job.verificationNote || "No independent verification notes available."}
            </p>
          </div>

          {/* Recruiter / Contact Card */}
          {job.outreach && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-600" />
                Recruiter Contact
              </h3>
              <div className="text-xs space-y-1.5 text-slate-700">
                <div className="font-semibold text-slate-900">
                  {job.outreach.recruiterName || "Name not disclosed"}
                </div>
                {job.outreach.recruiterTitle && (
                  <div className="text-slate-500">{job.outreach.recruiterTitle}</div>
                )}
                {job.outreach.recruiterEmail && (
                  <div className="flex items-center gap-1.5 text-blue-700">
                    <Mail className="w-3 h-3" />
                    <span>{job.outreach.recruiterEmail}</span>
                  </div>
                )}
                {job.outreach.recruiterPhoneOrWhatsApp && (
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Phone className="w-3 h-3" />
                    <span>{job.outreach.recruiterPhoneOrWhatsApp}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => navigateToFeature("/outreach")}
                className="w-full text-center text-xs font-semibold text-slate-800 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 py-2 rounded-lg transition-colors"
              >
                Open Outreach Message Generator →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
