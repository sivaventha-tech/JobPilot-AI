"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useJobPilot } from "@/context/JobPilotContext";
import {
  LayoutDashboard,
  PlusSquare,
  ScanSearch,
  FileText,
  CheckSquare,
  MessageSquareShare,
  Kanban,
  Menu,
  X,
  Compass,
  RotateCcw,
  ShieldCheck,
  Database,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: "pendingApproval" | "totalJobs";
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Add Job", href: "/add-job", icon: PlusSquare },
  { label: "Job Analysis", href: "/analysis", icon: ScanSearch },
  { label: "Resume & Profile", href: "/resume", icon: FileText },
  {
    label: "Application Review",
    href: "/review",
    icon: CheckSquare,
    badgeKey: "pendingApproval",
  },
  { label: "Recruiter Outreach", href: "/outreach", icon: MessageSquareShare },
  {
    label: "Application Tracker",
    href: "/tracker",
    icon: Kanban,
    badgeKey: "totalJobs",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { jobs, profile, resetDemoData } = useJobPilot();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const pendingApprovals = jobs.filter(
    (j) =>
      j.status === "Awaiting Approval" ||
      (j.reviewState === "Draft" &&
        j.status !== "Rejected" &&
        j.status !== "Failed")
  ).length;

  const handleReset = () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 4000);
      return;
    }
    resetDemoData();
    setResetConfirm(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-slate-900">
              JobPilot AI
            </span>
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
              Prototype
            </span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation menu"
          className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-68 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 lg:w-64 lg:shrink-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight text-slate-900 leading-none">
                JobPilot AI
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Human-in-the-Loop Copilot
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Main Navigation">
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            const badgeValue =
              item.badgeKey === "pendingApproval"
                ? pendingApprovals
                : item.badgeKey === "totalJobs"
                ? jobs.length
                : null;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? "text-white" : "text-slate-500"
                    }`}
                  />
                  {item.label}
                </span>
                {badgeValue !== null && badgeValue > 0 && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isActive
                        ? "bg-white/20 text-white"
                        : item.badgeKey === "pendingApproval"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {badgeValue}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Architecture & Safety Status Card */}
        <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/60">
          <div className="rounded-lg bg-white border border-slate-200 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-slate-600" />
                Local Prototype Mode
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            </div>
            <p className="text-slate-500 leading-relaxed">
              Persisted in browser <code className="text-[11px] bg-slate-100 px-1 rounded">localStorage</code>. Ready for FastAPI + Supabase connection.
            </p>
            <div className="pt-1 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Manual approval enforced
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <div className="truncate pr-2">
              <div className="text-xs font-semibold text-slate-800 truncate">
                {profile.fullName}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {profile.preferredRole}
              </div>
            </div>
            <button
              type="button"
              onClick={handleReset}
              title="Reset localStorage to initial demo data"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors shrink-0 ${
                resetConfirm
                  ? "bg-rose-600 text-white border-rose-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <RotateCcw className="w-3 h-3" />
              {resetConfirm ? "Confirm?" : "Reset"}
            </button>
          </div>
        </div>
      </aside>

      {/* Backdrop for mobile sidebar */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Safety & Prototype Banner */}
        <div className="bg-white border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded font-semibold bg-slate-900 text-white text-[11px]">
              Simulated AI Prototype
            </span>
            <span>
              AI analysis & match scoring use local mock heuristics until the Python FastAPI backend is connected.
            </span>
          </div>
          <div className="flex items-center gap-4 text-slate-500">
            <span>No auto-submissions • No automatic emails/WhatsApp</span>
          </div>
        </div>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
