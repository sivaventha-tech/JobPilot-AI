"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJobPilot } from "@/context/JobPilotContext";
import { ApplicationStatus, JobSource } from "@/types/jobpilot";
import { findPotentialDuplicateApplications } from "@/services/api-client";
import {
  ApplicationStatusBadge,
  MatchScoreBadge,
  ReviewStateBadge,
  VerificationBadge,
} from "@/components/StatusBadge";
import {
  Search,
  Filter,
  PlusCircle,
  ScanSearch,
  CheckSquare,
  MessageSquareShare,
  Trash2,
  ExternalLink,
  RotateCcw,
  AlertTriangle,
  History,
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

const ALL_SOURCES: ("All" | JobSource)[] = [
  "All",
  "LinkedIn",
  "Naukri",
  "Company Website",
  "Other",
];

export default function ApplicationTrackerPage() {
  const router = useRouter();
  const {
    jobs,
    selectJob,
    updateJobStatus,
    deleteJob,
    retryApplication,
    isHydrated,
  } = useJobPilot();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<"All" | ApplicationStatus>(
    "All"
  );
  const [selectedSource, setSelectedSource] = useState<"All" | JobSource>("All");

  // Status counts across all 8 states
  const statusCounts = useMemo(() => {
    const counts: Record<ApplicationStatus, number> = {
      Saved: 0,
      Analysing: 0,
      "Awaiting Approval": 0,
      Approved: 0,
      Submitted: 0,
      Interview: 0,
      Rejected: 0,
      Failed: 0,
    };
    jobs.forEach((job) => {
      counts[job.status] = (counts[job.status] || 0) + 1;
    });
    return counts;
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesStatus =
        selectedStatus === "All" || job.status === selectedStatus;
      const matchesSource =
        selectedSource === "All" || job.source === selectedSource;

      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        job.title.toLowerCase().includes(q) ||
        job.company.toLowerCase().includes(q) ||
        job.location.toLowerCase().includes(q) ||
        job.requiredSkills.some((s) => s.toLowerCase().includes(q));

      return matchesStatus && matchesSource && matchesSearch;
    });
  }, [jobs, selectedStatus, selectedSource, searchQuery]);

  const handleOpenJobRoute = (jobId: string, route: string) => {
    selectJob(jobId);
    router.push(route);
  };

  if (!isHydrated) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 rounded-lg" />
        <div className="h-24 bg-slate-200 rounded-xl" />
        <div className="h-96 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Application Tracker
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Filter, search, and manage every job across all 8 lifecycle states.
          </p>
        </div>
        <Link
          href="/add-job"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          Add Job
        </Link>
      </div>

      {/* 8-State Pipeline Filter Pills */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Pipeline Status Breakdown (Click to filter)
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedStatus("All")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              selectedStatus === "All"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
            }`}
          >
            All Jobs ({jobs.length})
          </button>
          {ALL_STATUSES.map((st) => {
            const active = selectedStatus === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setSelectedStatus(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {st} ({statusCounts[st]})
              </button>
            );
          })}
        </div>
      </div>

      {/* Search & Source Filter Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by job title, company, location, or skill (e.g., FastAPI, React)..."
            aria-label="Search applications"
            className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <label
              htmlFor="tracker-source-filter"
              className="text-xs font-semibold text-slate-600"
            >
              Source:
            </label>
            <select
              id="tracker-source-filter"
              value={selectedSource}
              onChange={(e) =>
                setSelectedSource(e.target.value as "All" | JobSource)
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none"
            >
              {ALL_SOURCES.map((src) => (
                <option key={src} value={src}>
                  {src === "All" ? "All Sources" : src}
                </option>
              ))}
            </select>
          </div>

          {(selectedStatus !== "All" ||
            selectedSource !== "All" ||
            searchQuery.trim() !== "") && (
            <button
              type="button"
              onClick={() => {
                setSelectedStatus("All");
                setSelectedSource("All");
                setSearchQuery("");
              }}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Applications List / Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {filteredJobs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-800">
              No matching applications found
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Try clearing your search query or status filter, or add a new job to your workspace.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Job & Company</th>
                  <th className="py-3.5 px-4">Source & Verification</th>
                  <th className="py-3.5 px-4">Mock Match</th>
                  <th className="py-3.5 px-4">Current Status</th>
                  <th className="py-3.5 px-4">Update Status</th>
                  <th className="py-3.5 px-4">Review Gate</th>
                  <th className="py-3.5 px-4 text-right">Workspace Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-4 px-4">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>{job.title}</span>
                        {findPotentialDuplicateApplications(job, jobs).isDuplicate && (
                          <span
                            title="Another active opportunity with the same role or application URL exists"
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300"
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Duplicate Alert
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        {job.company} • {job.location} ({job.workMode})
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Salary: {job.salary} • Exp: {job.experience}
                      </div>
                      {job.submissionHistory && job.submissionHistory.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
                          <History className="w-3 h-3 text-slate-400" />
                          <span>
                            {job.submissionHistory.length} attempt(s) • Latest:{" "}
                            <strong className="text-slate-700">
                              {job.submissionHistory[0].outcome}
                            </strong>
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-4 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
                          {job.source}
                        </span>
                        {job.applicationUrl && (
                          <a
                            href={job.applicationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open posting URL"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      <div>
                        <VerificationBadge state={job.verificationState} />
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <MatchScoreBadge score={job.matchScore} />
                      <div className="text-[11px] text-slate-500 mt-1">
                        {job.matchedSkills.length}/{job.requiredSkills.length} skills
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <ApplicationStatusBadge status={job.status} />
                    </td>

                    <td className="py-4 px-4">
                      <select
                        aria-label={`Change status for ${job.title}`}
                        value={job.status}
                        onChange={(e) =>
                          updateJobStatus(
                            job.id,
                            e.target.value as ApplicationStatus
                          )
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none"
                      >
                        {ALL_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-4 px-4">
                      <ReviewStateBadge state={job.reviewState} />
                    </td>

                    <td className="py-4 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        {job.status === "Failed" && (
                          <button
                            type="button"
                            onClick={() => {
                              retryApplication(job.id);
                              handleOpenJobRoute(job.id, "/review");
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-800 hover:bg-rose-100 transition-colors"
                            title="Retry application after review"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Retry
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenJobRoute(job.id, "/analysis")}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                          title="Inspect Job Analysis"
                        >
                          <ScanSearch className="w-3.5 h-3.5" />
                          Analysis
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenJobRoute(job.id, "/review")}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                          title="Review & Approve Answers"
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenJobRoute(job.id, "/outreach")}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                          title="Recruiter Outreach"
                        >
                          <MessageSquareShare className="w-3.5 h-3.5" />
                          Outreach
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteJob(job.id)}
                          aria-label={`Remove ${job.title}`}
                          title="Delete job from tracker"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
