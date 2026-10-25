"use client";

import React, { useState, useEffect } from "react";
import { useJobPilot } from "@/context/JobPilotContext";
import { JobSelectorBar } from "@/components/JobSelectorBar";
import {
  Mail,
  MessageCircle,
  User,
  Copy,
  Check,
  Save,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

export default function RecruiterOutreachPage() {
  const { selectedJob, updateOutreachDraft, isHydrated } = useJobPilot();

  const [recruiterName, setRecruiterName] = useState("");
  const [recruiterTitle, setRecruiterTitle] = useState("");
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [recruiterPhoneOrWhatsApp, setRecruiterPhoneOrWhatsApp] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    if (selectedJob) {
      const o = selectedJob.outreach;
      setRecruiterName(o.recruiterName);
      setRecruiterTitle(o.recruiterTitle);
      setRecruiterEmail(o.recruiterEmail);
      setRecruiterPhoneOrWhatsApp(o.recruiterPhoneOrWhatsApp);
      setEmailSubject(o.emailSubject);
      setEmailBody(o.emailBody);
      setWhatsappMessage(o.whatsappMessage);
    }
  }, [selectedJob?.id, selectedJob?.outreach]);

  const persistOutreachChanges = (
    overrides?: Partial<{
      recruiterName: string;
      recruiterTitle: string;
      recruiterEmail: string;
      recruiterPhoneOrWhatsApp: string;
      emailSubject: string;
      emailBody: string;
      whatsappMessage: string;
    }>
  ) => {
    if (!selectedJob) return;
    updateOutreachDraft(selectedJob.id, {
      recruiterName: overrides?.recruiterName ?? recruiterName,
      recruiterTitle: overrides?.recruiterTitle ?? recruiterTitle,
      recruiterEmail: overrides?.recruiterEmail ?? recruiterEmail,
      recruiterPhoneOrWhatsApp:
        overrides?.recruiterPhoneOrWhatsApp ?? recruiterPhoneOrWhatsApp,
      emailSubject: overrides?.emailSubject ?? emailSubject,
      emailBody: overrides?.emailBody ?? emailBody,
      whatsappMessage: overrides?.whatsappMessage ?? whatsappMessage,
      lastUpdatedAt: new Date().toISOString(),
    });
  };

  const handleSaveOutreach = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedJob) return;

    updateOutreachDraft(selectedJob.id, {
      recruiterName: recruiterName.trim(),
      recruiterTitle: recruiterTitle.trim(),
      recruiterEmail: recruiterEmail.trim(),
      recruiterPhoneOrWhatsApp: recruiterPhoneOrWhatsApp.trim(),
      emailSubject: emailSubject.trim(),
      emailBody,
      whatsappMessage,
      lastUpdatedAt: new Date().toISOString(),
    });

    setSavedToast("Outreach drafts saved to local workspace.");
    setTimeout(() => setSavedToast(null), 3500);
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
    }
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
            Recruiter Outreach Studio
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Review and customise personalised Email and WhatsApp outreach drafts. Messages are never sent automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleSaveOutreach()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors self-start sm:self-auto"
        >
          <Save className="w-4 h-4" />
          Save All Drafts
        </button>
      </div>

      {/* Safety Notice */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-start gap-3 text-xs text-emerald-950">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">No Automatic Sending:</span> JobPilot AI never sends emails or WhatsApp messages on your behalf in this prototype. Edit the recipient details and message templates below, then use the <strong>Copy</strong> buttons to paste them into your own mail client or WhatsApp.
        </div>
      </div>

      {/* Job Selector */}
      <JobSelectorBar label="Outreach Context For" />

      {savedToast && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{savedToast}</span>
        </div>
      )}

      {!selectedJob ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-600">
          Select a job to edit its recruiter outreach drafts.
        </div>
      ) : (
        <form onSubmit={handleSaveOutreach} className="space-y-6">
          {/* Recipient Details Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <User className="w-4 h-4 text-slate-700" />
                Recipient Details ({selectedJob.company})
              </h2>
              <span className="text-xs text-slate-500">
                Verify contact details before reaching out
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label
                  htmlFor="recruiter-name"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Recruiter / Hiring Manager Name
                </label>
                <input
                  id="recruiter-name"
                  type="text"
                  value={recruiterName}
                  onChange={(e) => {
                    setRecruiterName(e.target.value);
                    persistOutreachChanges({ recruiterName: e.target.value });
                  }}
                  placeholder="e.g., Priya Nair"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="recruiter-title"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Role / Title
                </label>
                <input
                  id="recruiter-title"
                  type="text"
                  value={recruiterTitle}
                  onChange={(e) => {
                    setRecruiterTitle(e.target.value);
                    persistOutreachChanges({ recruiterTitle: e.target.value });
                  }}
                  placeholder="e.g., Technical Recruiter"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="recruiter-email"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Recipient Email
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="recruiter-email"
                    type="email"
                    value={recruiterEmail}
                    onChange={(e) => {
                      setRecruiterEmail(e.target.value);
                      persistOutreachChanges({ recruiterEmail: e.target.value });
                    }}
                    placeholder="recruiter@company.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  {recruiterEmail && (
                    <button
                      type="button"
                      onClick={() => handleCopy("email-addr", recruiterEmail)}
                      title="Copy email address"
                      className="px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    >
                      {copiedField === "email-addr" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="recruiter-phone"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  WhatsApp / Phone Number
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="recruiter-phone"
                    type="text"
                    value={recruiterPhoneOrWhatsApp}
                    onChange={(e) => {
                      setRecruiterPhoneOrWhatsApp(e.target.value);
                      persistOutreachChanges({
                        recruiterPhoneOrWhatsApp: e.target.value,
                      });
                    }}
                    placeholder="+91 98XXX XXXXX"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  {recruiterPhoneOrWhatsApp && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy("phone-num", recruiterPhoneOrWhatsApp)
                      }
                      title="Copy phone number"
                      className="px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    >
                      {copiedField === "phone-num" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Two-Column Draft Editors: Email Draft & WhatsApp Draft */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Email Outreach Draft */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-600" />
                  Email Outreach Draft
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy("email-subject", emailSubject)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    {copiedField === "email-subject" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Subject Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Subject
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy("email-body", emailBody)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
                  >
                    {copiedField === "email-body" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-300" />
                        Copied Email Body!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Email Body
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="outreach-email-subject"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Subject Line
                </label>
                <input
                  id="outreach-email-subject"
                  type="text"
                  value={emailSubject}
                  onChange={(e) => {
                    setEmailSubject(e.target.value);
                    persistOutreachChanges({ emailSubject: e.target.value });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="outreach-email-body"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Email Message Body
                </label>
                <textarea
                  id="outreach-email-body"
                  rows={11}
                  value={emailBody}
                  onChange={(e) => {
                    setEmailBody(e.target.value);
                    persistOutreachChanges({ emailBody: e.target.value });
                  }}
                  className="w-full rounded-lg border border-slate-300 p-3.5 text-sm text-slate-900 leading-relaxed focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {/* WhatsApp Outreach Draft */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-emerald-600" />
                  WhatsApp / Direct Message Draft
                </h3>
                <button
                  type="button"
                  onClick={() => handleCopy("whatsapp-msg", whatsappMessage)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors"
                >
                  {copiedField === "whatsapp-msg" ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      Copied WhatsApp Draft!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy WhatsApp Message
                    </>
                  )}
                </button>
              </div>

              <div>
                <label
                  htmlFor="outreach-whatsapp-body"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Short Message (Editable)
                </label>
                <textarea
                  id="outreach-whatsapp-body"
                  rows={7}
                  value={whatsappMessage}
                  onChange={(e) => {
                    setWhatsappMessage(e.target.value);
                    persistOutreachChanges({ whatsappMessage: e.target.value });
                  }}
                  className="w-full rounded-lg border border-slate-300 p-3.5 text-sm text-slate-900 leading-relaxed focus:border-slate-900 focus:outline-none"
                />
                <div className="flex items-center justify-between text-xs text-slate-500 mt-1.5">
                  <span>Keep concise and polite for mobile reading</span>
                  <span>{whatsappMessage.length} characters</span>
                </div>
              </div>

              {/* Message Preview Bubble */}
              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                  Live Message Preview
                </div>
                <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed bg-white p-3 rounded-lg border border-emerald-100 shadow-2xs">
                  {whatsappMessage || "Type a WhatsApp draft above to preview..."}
                </p>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
