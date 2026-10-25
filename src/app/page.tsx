"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJobPilot } from "@/context/JobPilotContext";
import {
  ApplicationStatusBadge,
  MatchScoreBadge,
  ReviewStateBadge,
} from "@/components/StatusBadge";
import {
  Briefcase,
  Send,
  Clock,
  CalendarCheck,
  PlusCircle,
  ArrowUpRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileText,
  ScanSearch,
  CheckSquare,
  MessageSquareShare,
} from "lucide-react";

export default function DashboardPage() {
  const { jobs, profile, selectJob, isHydrated } = useJobPilot();
  const router = useRouter();

  const totalJobsReviewed = jobs.length;
  const applicationsSubmitted = jobs.filter(
    (j) =>
      j.status === "Submitted" ||
      j.status === "Interview" ||
      j.reviewState === "Submitted"
  ).length;
  const pendingApprovals = jobs.filter(
    (j) =>
      j.status === "Awaiting Approval" ||
      (j.reviewState === "Draft" &&
        j.status !== "Rejected" &&
        j.status !== "Failed")
  ).length;
  const interviewsScheduled = jobs.filter((j) => j.status === "Interview").length;

  const averageMatchScore =
    jobs.length > 0
      ? Math.round(jobs.reduce((acc, j) => acc + j.matchScore, 0) / jobs.length)
      : 0;

  const highMatchJobs = jobs.filter((j) => j.matchScore >= 80);

  // Aggregate missing skills across jobs to show actionable skill gap summary
  const missingSkillCounts: Record<string, number> = {};
  jobs.forEach((job) => {
    job.missingSkills.forEach((skill) => {
      missingSkillCounts[skill] = (missingSkillCounts[skill] || 0) + 1;
    });
  });
  const topMissingSkills = Object.entries(missingSkillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const handleOpenJobRoute = (jobId: string, route: string) => {
    selectJob(jobId);
    router.push(route);
  };

  if (!isHydrated) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-slate-200 rounded-xl" />
          ))}
        </div>
        <div className="h-80 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Application Command Center
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Welcome back, <span className="font-semibold text-slate-800">{profile.fullName}</span>. Review explainable job matches, edit grounded application drafts, and approve submissions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/resume"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <FileText className="w-4 h-4 text-slate-600" />
            Profile & Resume
          </Link>
          <Link
            href="/add-job"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-xs"
          >
            <PlusCircle className="w-4 h-4" />
            Add New Job
          </Link>
        </div>
      </div>

      {/* 4 Core KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Jobs Reviewed
            </span>
            <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900">
              {totalJobsReviewed}
            </span>
            <Link
              href="/tracker"
              className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-0.5"
            >
              View tracker <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Applications Submitted
            </span>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900">
              {applicationsSubmitted}
            </span>
            <span className="text-xs text-slate-500">
              User-approved & submitted
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pending Approvals
            </span>
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900">
              {pendingApprovals}
            </span>
            <Link
              href="/review"
              className="text-xs font-medium text-amber-800 hover:underline inline-flex items-center gap-0.5"
            >
              Review drafts <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Interviews Scheduled
            </span>
            <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900">
              {interviewsScheduled}
            </span>
            <span className="text-xs text-purple-700 font-medium">
              Active pipeline
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Recent Applications Table + Job Match Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Applications Table (2 columns wide on xl) */}
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Recent Applications
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any job to inspect its analysis, edit answers, or prepare recruiter outreach.
              </p>
            </div>
            <Link
              href="/tracker"
              className="text-xs font-semibold text-slate-800 hover:text-slate-900 inline-flex items-center gap-1"
            >
              Open Full Tracker <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {jobs.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <p className="text-sm text-slate-600">
                No job applications recorded yet.
              </p>
              <Link
                href="/add-job"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium"
              >
                <PlusCircle className="w-4 h-4" />
                Add Your First Job
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Role & Company</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Match</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Approval State</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {jobs.slice(0, 6).map((job) => (
                    <tr
                      key={job.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">
                          {job.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {job.company} • {job.location}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                          {job.source}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <MatchScoreBadge score={job.matchScore} />
                      </td>
                      <td className="py-3.5 px-4">
                        <ApplicationStatusBadge status={job.status} />
                      </td>
                      <td className="py-3.5 px-4">
                        <ReviewStateBadge state={job.reviewState} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenJobRoute(job.id, "/analysis")}
                            title="View Job Analysis"
                            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
                          >
                            <ScanSearch className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenJobRoute(job.id, "/review")}
                            title="Review & Approve Application"
                            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
                          >
                            <CheckSquare className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenJobRoute(job.id, "/outreach")}
                            title="Recruiter Outreach Drafts"
                            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
                          >
                            <MessageSquareShare className="w-4 h-4" />
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

        {/* Job Match Summary Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-slate-700" />
                  Explainable Match Summary
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deterministic weighted alignment (Skills 55%, Exp 25%, Edu/Certs 10%, Role/Loc 10%)
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white">
                Avg {averageMatchScore}%
              </span>
            </div>

            {/* Match distribution */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">
                  Strong Matches (80%+ score)
                </span>
                <span className="font-semibold text-emerald-700">
                  {highMatchJobs.length} of {jobs.length} roles
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{
                    width: `${
                      jobs.length > 0
                        ? Math.round((highMatchJobs.length / jobs.length) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Top Matching Jobs List */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Top Ranked Opportunities
              </div>
              {[...jobs]
                .sort((a, b) => b.matchScore - a.matchScore)
                .slice(0, 3)
                .map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => handleOpenJobRoute(job.id, "/analysis")}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {job.title}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {job.company} • {job.matchedSkills.length}/
                        {job.requiredSkills.length} skills matched
                      </div>
                    </div>
                    <MatchScoreBadge score={job.matchScore} />
                  </button>
                ))}
            </div>

            {/* Skill Gap Spotlight */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                Frequent Missing Skills Across Jobs
              </div>
              {topMissingSkills.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No missing skills detected across your current jobs!
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {topMissingSkills.map(([skill, count]) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200"
                    >
                      {skill}
                      <span className="text-[10px] text-amber-700">
                        ({count})
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Core Profile Skills Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {profile.skills.length} active profile skills
            </span>
            <Link
              href="/resume"
              className="font-semibold text-slate-900 hover:underline"
            >
              Edit Skills →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
