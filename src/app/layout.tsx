import type { Metadata } from "next";
import "./globals.css";
import { JobPilotProvider } from "@/context/JobPilotContext";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "JobPilot AI — Human-in-the-Loop Job Application Copilot",
  description:
    "Professional AI Job Application Automation SaaS web app for managing job applications, reviewing tailored answers, and approving applications before submission.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        <JobPilotProvider>
          <AppShell>{children}</AppShell>
        </JobPilotProvider>
      </body>
    </html>
  );
}
