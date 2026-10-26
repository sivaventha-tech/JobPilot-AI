"use client";

import React from "react";
import Link from "next/link";
import { useJobPilot } from "@/context/JobPilotContext";
import { ApplicationStatusBadge, MatchScoreBadge } from "./StatusBadge";
import { Briefcase, PlusCircle } from "lucide-react";

interface JobSelectorBarProps {
  label?: string;
}

export function JobSelectorBar({ label = "Active Job Context" }: JobSelectorBarProps) {
  const { jobs, selectedJobId, selectJob, selectedJob } = useJobPilot();

  if (jobs.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2.5 text-slate-600 text-sm">
          <Briefcase className="w-4 h-4 text-slate-400" />
          <span>No jobs in your workspace yet. Add a job to begin analysis.</span>
        </div>
        <Link
          href="/add-job"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Add First Job
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
        <label
          htmlFor="active-job-selector"
          className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap flex items-center gap-1.5"
        >
          <Briefcase className="w-3.5 h-3.5 text-slate-600" />
          {label}:
        </label>
        <select
          id="active-job-selector"
          value={selectedJobId}
          onChange={(e) => selectJob(e.target.value)}
          className="w-full sm:max-w-md rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        >
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title} — {job.company} ({job.matchScore}% Match • {job.status})
            </option>
          ))}
        </select>
      </div>

      {selectedJob && (
        <div className="flex flex-wrap items-center gap-2.5">
          <MatchScoreBadge score={selectedJob.matchScore} />
          <ApplicationStatusBadge status={selectedJob.status} />
          <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-100 rounded-md">
            Source: {selectedJob.source}
          </span>
          <Link
            href={`/jobs/${selectedJob.id}`}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-0.5 ml-1"
            title={`View full details for ${selectedJob.title}`}
          >
            Details →
          </Link>
        </div>
      )}
    </div>
  );
}
