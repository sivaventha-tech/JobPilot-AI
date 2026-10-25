import React from "react";
import {
  ApplicationStatus,
  ProvenanceSource,
  ReviewState,
  VerificationState,
} from "@/types/jobpilot";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileEdit,
  Send,
  Sparkles,
  CalendarCheck,
  XCircle,
  Bookmark,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const styles: Record<ApplicationStatus, string> = {
    Saved: "bg-slate-100 text-slate-700 border-slate-200",
    Analysing: "bg-sky-50 text-sky-700 border-sky-200",
    "Awaiting Approval": "bg-amber-50 text-amber-800 border-amber-200",
    Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Submitted: "bg-indigo-50 text-indigo-700 border-indigo-200",
    Interview: "bg-purple-50 text-purple-700 border-purple-200",
    Rejected: "bg-rose-50 text-rose-700 border-rose-200",
    Failed: "bg-red-50 text-red-800 border-red-200",
  };

  const icons: Record<ApplicationStatus, React.ReactNode> = {
    Saved: <Bookmark className="w-3.5 h-3.5" />,
    Analysing: <Sparkles className="w-3.5 h-3.5 animate-pulse" />,
    "Awaiting Approval": <Clock className="w-3.5 h-3.5" />,
    Approved: <CheckCircle2 className="w-3.5 h-3.5" />,
    Submitted: <Send className="w-3.5 h-3.5" />,
    Interview: <CalendarCheck className="w-3.5 h-3.5" />,
    Rejected: <XCircle className="w-3.5 h-3.5" />,
    Failed: <AlertTriangle className="w-3.5 h-3.5" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}
    >
      {icons[status]}
      {status}
    </span>
  );
}

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  const styles: Record<ReviewState, string> = {
    Draft: "bg-amber-50 text-amber-800 border-amber-200",
    Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Submitted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  };

  const icons: Record<ReviewState, React.ReactNode> = {
    Draft: <FileEdit className="w-3.5 h-3.5" />,
    Approved: <CheckCircle2 className="w-3.5 h-3.5" />,
    Submitted: <Send className="w-3.5 h-3.5" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${styles[state]}`}
    >
      {icons[state]}
      {state === "Draft" && "Draft — Needs Approval"}
      {state === "Approved" && "Approved (Ready for Manual Submission)"}
      {state === "Submitted" && "Submitted by User"}
    </span>
  );
}

export function MatchScoreBadge({ score }: { score: number }) {
  let color = "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score < 60) {
    color = "bg-rose-50 text-rose-700 border-rose-200";
  } else if (score < 80) {
    color = "bg-amber-50 text-amber-800 border-amber-200";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${color}`}
      title="Skill match score"
    >
      {score}% Match
    </span>
  );
}

export function VerificationBadge({ state }: { state: VerificationState }) {
  if (state === "Verified Facts") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-emerald-50 text-emerald-800 border-emerald-200">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        {state}
      </span>
    );
  }
  if (state === "Conflicting Information") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-rose-50 text-rose-800 border-rose-200">
        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
        {state}
      </span>
    );
  }
  if (state === "Source URL Provided") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border bg-blue-50 text-blue-800 border-blue-200">
        <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
        {state}
      </span>
    );
  }
  if (state === "Search Not Configured") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border bg-slate-100 text-slate-700 border-slate-200">
        <ShieldQuestion className="w-3.5 h-3.5 text-slate-500" />
        {state}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border bg-amber-50 text-amber-800 border-amber-200">
      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
      {state}
    </span>
  );
}

export function ProvenanceBadge({ source }: { source: ProvenanceSource }) {
  const labels: Record<ProvenanceSource, string> = {
    screenshot_vision: "Screenshot Vision",
    webpage_public: "Public Webpage",
    pasted_description: "Pasted Description",
    user_input: "User Input",
    missing: "Null / Not Found",
  };

  const styles: Record<ProvenanceSource, string> = {
    screenshot_vision: "bg-purple-50 text-purple-800 border-purple-200",
    webpage_public: "bg-sky-50 text-sky-800 border-sky-200",
    pasted_description: "bg-emerald-50 text-emerald-800 border-emerald-200",
    user_input: "bg-blue-50 text-blue-800 border-blue-200",
    missing: "bg-slate-100 text-slate-500 border-slate-200",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}
