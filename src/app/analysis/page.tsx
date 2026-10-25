"use client";

import React from "react";
import Link from "next/link";
import { useJobPilot } from "@/context/JobPilotContext";
import { computeExplainableJobMatch } from "@/services/api-client";
import { JobSelectorBar } from "@/components/JobSelectorBar";
import {
  ApplicationStatusBadge,
  ProvenanceBadge,
  ReviewStateBadge,
  VerificationBadge,
} from "@/components/StatusBadge";
import {
  Building2,
  MapPin,
  Banknote,
  Briefcase,
  Globe,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  CheckSquare,
  MessageSquareShare,
  Image as ImageIcon,
  GraduationCap,
  SlidersHorizontal,
  Info,
} from "lucide-react";

export default function JobAnalysisPage() {
  const { selectedJob, profile, isHydrated } = useJobPilot();

  if (!isHydrated) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-14 bg-slate-200 rounded-xl" />
        <div className="h-96 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  const explainableMatch = selectedJob
    ? selectedJob.explainableMatch ||
      computeExplainableJobMatch(
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
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Job Analysis & Verification
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Inspect structured job details, field provenance, deterministic explainable match scoring, and evidence-based verification status.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/review"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
          >
            <CheckSquare className="w-4 h-4" />
            Review Application Answers
          </Link>
          <Link
            href="/outreach"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <MessageSquareShare className="w-4 h-4 text-slate-600" />
            Outreach Drafts
          </Link>
        </div>
      </div>

      {/* Job Selector */}
      <JobSelectorBar label="Inspecting Job" />

      {!selectedJob ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-sm text-slate-600">
            Select or add a job to view its detailed analysis.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left 2 Columns: Core Job Details, Provenance, Explainable Match & Description */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-slate-100 text-slate-800">
                      Source: {selectedJob.source}
                    </span>
                    <ApplicationStatusBadge status={selectedJob.status} />
                    <ReviewStateBadge state={selectedJob.reviewState} />
                    {selectedJob.analysisMode && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {selectedJob.analysisMode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                      {selectedJob.title}
                    </h2>
                    {selectedJob.provenance && (
                      <ProvenanceBadge source={selectedJob.provenance.title} />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <span>{selectedJob.company}</span>
                    {selectedJob.provenance && (
                      <ProvenanceBadge
                        source={selectedJob.provenance.company}
                      />
                    )}
                  </div>
                </div>

                {/* Match Score Gauge */}
                <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 shrink-0">
                  <div className="text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Explainable Match
                    </div>
                    <div className="text-2xl font-extrabold text-slate-900">
                      {explainableMatch
                        ? explainableMatch.match_score
                        : selectedJob.matchScore}
                      %
                    </div>
                  </div>
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm ${
                      selectedJob.matchScore >= 80
                        ? "bg-emerald-100 text-emerald-800"
                        : selectedJob.matchScore >= 60
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    <Sparkles className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* 4 Metadata Tiles: Location, Salary, Experience, Application URL */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Location & Work Mode
                      </span>
                      {selectedJob.provenance && (
                        <ProvenanceBadge
                          source={selectedJob.provenance.location}
                        />
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">
                      {selectedJob.location} ({selectedJob.workMode})
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                  <Banknote className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Compensation / Salary
                      </span>
                      {selectedJob.provenance && (
                        <ProvenanceBadge
                          source={selectedJob.provenance.salary}
                        />
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">
                      {selectedJob.salary}
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                  <Briefcase className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Experience Required
                      </span>
                      {selectedJob.provenance && (
                        <ProvenanceBadge
                          source={selectedJob.provenance.experience}
                        />
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">
                      {selectedJob.experience}
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-3">
                  <Globe className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Application URL ({selectedJob.source})
                      </span>
                      {selectedJob.provenance && (
                        <ProvenanceBadge
                          source={selectedJob.provenance.application_url}
                        />
                      )}
                    </div>
                    {selectedJob.applicationUrl ? (
                      <a
                        href={selectedJob.applicationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-blue-700 hover:underline inline-flex items-center gap-1 truncate max-w-full mt-0.5"
                      >
                        <span className="truncate">
                          {selectedJob.applicationUrl}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    ) : (
                      <div className="text-sm font-medium text-amber-800 mt-0.5">
                        Not provided (Screenshot / Text intake)
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Explainable Match & Skills Breakdown */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Explainable Job Match & Qualification Alignment
                    </h3>
                    {selectedJob.provenance && (
                      <ProvenanceBadge
                        source={selectedJob.provenance.required_skills}
                      />
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    Matched {selectedJob.matchedSkills.length} of{" "}
                    {selectedJob.requiredSkills.length} required skills
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {explainableMatch?.explanation || selectedJob.matchSummary}
                  </p>

                  {/* Deterministic Weighted Score Components */}
                  {explainableMatch && explainableMatch.score_breakdown && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-200/80">
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                        Deterministic Weighted Score Breakdown
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          {
                            name: "Required Skills",
                            weight:
                              explainableMatch.score_breakdown.weights_used
                                ?.skills ?? 0.55,
                            raw: explainableMatch.score_breakdown.skills_score,
                            reason: `Matched ${selectedJob.matchedSkills.length} of ${selectedJob.requiredSkills.length} required skills.`,
                          },
                          {
                            name: "Relevant Experience",
                            weight:
                              explainableMatch.score_breakdown.weights_used
                                ?.experience ?? 0.25,
                            raw: explainableMatch.score_breakdown
                              .experience_score,
                            reason: `Experience alignment: ${(
                              explainableMatch.experience_alignment_status ||
                              "not_explicitly_required"
                            ).replace(/_/g, " ")}.`,
                          },
                          {
                            name: "Education & Certs",
                            weight:
                              explainableMatch.score_breakdown.weights_used
                                ?.education_certs ?? 0.1,
                            raw: explainableMatch.score_breakdown
                              .education_certs_score,
                            reason:
                              explainableMatch
                                .education_certification_alignment?.summary ||
                              "Credential alignment.",
                          },
                          {
                            name: "Role & Location",
                            weight:
                              explainableMatch.score_breakdown.weights_used
                                ?.role_location ?? 0.1,
                            raw: explainableMatch.score_breakdown
                              .role_location_score,
                            reason:
                              "Alignment with preferred role and work mode.",
                          },
                        ].map((comp) => {
                          const weightedPts = (comp.weight * comp.raw).toFixed(
                            1
                          );
                          return (
                            <div
                              key={comp.name}
                              className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5"
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-slate-900">
                                  {comp.name} ({Math.round(comp.weight * 100)}%
                                  weight)
                                </span>
                                <span className="font-bold text-slate-900">
                                  +{weightedPts} pts ({Math.round(comp.raw)}%)
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-slate-900 rounded-full"
                                  style={{ width: `${comp.raw}%` }}
                                />
                              </div>
                              <p className="text-[11px] text-slate-600 leading-snug">
                                {comp.reason}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div>
                      <div className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5 mb-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Matched in Your Profile ({selectedJob.matchedSkills.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedJob.matchedSkills.length > 0 ? (
                          selectedJob.matchedSkills.map((skill) => (
                            <span
                              key={skill}
                              className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-100/80 text-emerald-900 border border-emerald-200"
                            >
                              {skill}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500">
                            No direct overlap found
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-amber-900 flex items-center gap-1.5 mb-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        Not Mentioned in Resume / Missing (
                        {selectedJob.missingSkills.length})
                      </div>
                      {explainableMatch &&
                      explainableMatch.uncertain_or_unmentioned_skills &&
                      explainableMatch.uncertain_or_unmentioned_skills.length >
                        0 ? (
                        <div className="space-y-1.5">
                          {explainableMatch.uncertain_or_unmentioned_skills.map(
                            (gap) => (
                              <div
                                key={gap.skill}
                                className="p-2 rounded-lg bg-amber-50/90 border border-amber-200 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-amber-950">
                                    {gap.skill}
                                  </span>
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-900">
                                    {gap.status === "not_mentioned_in_resume"
                                      ? "Not Mentioned in Resume"
                                      : "Explicitly Missing"}
                                  </span>
                                </div>
                                <p className="text-[11px] text-amber-800 mt-0.5">
                                  {gap.note || gap.detail}
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedJob.missingSkills.length > 0 ? (
                            selectedJob.missingSkills.map((skill) => (
                              <span
                                key={skill}
                                className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-100/80 text-amber-900 border border-amber-200"
                              >
                                {skill}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-emerald-700 font-medium">
                              All required skills present in your profile!
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Relevant Experience Evidence & Education/Certification Alignment */}
                  {explainableMatch && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200/80 text-xs">
                      <div className="space-y-1.5">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <Briefcase className="w-3.5 h-3.5 text-slate-600" />
                          Relevant Experience Evidence (
                          {(
                            explainableMatch.experience_alignment_status ||
                            "not_explicitly_required"
                          ).replace(/_/g, " ")}
                          )
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-slate-700">
                          {(
                            explainableMatch.relevant_experience_evidence || []
                          ).map((ev, i) => (
                            <li key={i}>{ev}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-1.5">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <GraduationCap className="w-3.5 h-3.5 text-slate-600" />
                          Education & Certification Alignment
                        </div>
                        {explainableMatch.education_certification_alignment ? (
                          <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-1">
                            <div className="flex items-center justify-between gap-2 font-semibold text-slate-800">
                              <span>
                                {explainableMatch.education_certification_alignment.required_credentials.join(
                                  ", "
                                ) || "Degree / Certifications"}
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                                  explainableMatch
                                    .education_certification_alignment
                                    .status === "aligned"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : explainableMatch
                                        .education_certification_alignment
                                        .status === "not_explicitly_required"
                                    ? "bg-slate-100 text-slate-700"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {explainableMatch.education_certification_alignment.status.replace(
                                  /_/g,
                                  " "
                                )}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600">
                              {
                                explainableMatch
                                  .education_certification_alignment.summary
                              }
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-500">
                            No explicit requirements specified.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Limitations Notice */}
                  {explainableMatch &&
                    explainableMatch.limitations &&
                    explainableMatch.limitations.length > 0 && (
                      <div className="p-3 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
                        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-800">
                            Scoring Methodology & Limitations
                          </div>
                          {explainableMatch.limitations.map((lim, i) => (
                            <p key={i}>{lim}</p>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>

              {/* Job Description & Screenshot Attachment */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">
                  Job Description & Intake Context
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
                  {selectedJob.description}
                </p>

                {selectedJob.uploadedFileName && (
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {selectedJob.uploadedImagePreviewUrl ? (
                        <img
                          src={selectedJob.uploadedImagePreviewUrl}
                          alt="Uploaded job screenshot"
                          className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                          <ImageIcon className="w-5 h-5 text-slate-600" />
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-semibold text-slate-900">
                          Attached Screenshot: {selectedJob.uploadedFileName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {selectedJob.uploadedFileSize
                            ? `${(selectedJob.uploadedFileSize / 1024).toFixed(1)} KB`
                            : "Image attachment"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Company Verification, Web Research Comparisons & Source Links */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900">
                  Company & Source Verification
                </h3>
              </div>

              <div>
                <VerificationBadge state={selectedJob.verificationState} />
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed space-y-2">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  {selectedJob.verificationState === "Verified Facts" ||
                  selectedJob.verificationState === "Source URL Provided" ? (
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  Transparency & Anti-Hallucination Policy
                </div>
                <p>{selectedJob.verificationNote}</p>
                <p className="text-slate-500 pt-1 border-t border-slate-200/80">
                  JobPilot AI never fabricates company registration data, funding numbers, or verified badges. Only user-provided URLs or search-corroborated sources are displayed below.
                </p>
              </div>

              {/* Web Research Field Comparisons if present */}
              {selectedJob.webResearch &&
                selectedJob.webResearch.comparisons.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Web Research Field Comparisons
                    </div>
                    {selectedJob.webResearch.comparisons.map((cmp, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-semibold text-slate-800 capitalize">
                          <span>{cmp.field_name}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                              cmp.status === "matched"
                                ? "bg-emerald-100 text-emerald-800"
                                : cmp.status === "conflicting"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {cmp.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {cmp.research_finding}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {/* Source Links */}
              <div className="space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Recorded Source Links ({selectedJob.sourceLinks.length})
                </div>
                {selectedJob.sourceLinks.length === 0 ? (
                  <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-xs text-amber-900">
                    No external source URLs are attached to this job record. Verify the company independently before submitting personal information.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedJob.sourceLinks.map((link, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-slate-200 bg-white space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900">
                            {link.label}
                          </div>
                          {link.classification && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                link.classification === "verified_fact"
                                  ? "bg-emerald-50 text-emerald-800"
                                  : link.classification === "conflicting_info"
                                  ? "bg-rose-50 text-rose-800"
                                  : "bg-amber-50 text-amber-800"
                              }`}
                            >
                              {link.classification.replace("_", " ")}
                            </span>
                          )}
                        </div>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 break-all"
                        >
                          {link.url}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                        <div className="text-[11px] text-slate-500">
                          {link.note}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Candidate Profile Comparison Snapshot */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="text-sm font-bold text-slate-900">
                Compared Against Your Profile
              </div>
              <div className="text-xs text-slate-600 space-y-1.5">
                <div>
                  <span className="text-slate-400">Target Role:</span>{" "}
                  <span className="font-medium text-slate-800">
                    {profile.preferredRole}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Preferred Location:</span>{" "}
                  <span className="font-medium text-slate-800">
                    {profile.preferredLocation}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Experience:</span>{" "}
                  <span className="font-medium text-slate-800">
                    {profile.yearsOfExperience}
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <Link
                  href="/resume"
                  className="text-xs font-semibold text-slate-900 hover:underline"
                >
                  Update Profile or Resume →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
