"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  ApplicationAttempt,
  ApplicationQuestionAnswer,
  ApplicationStatus,
  CandidateProfile,
  CandidateResumeFile,
  JobRecord,
  NewJobInput,
  RecruiterOutreachDraft,
  ReviewState,
  UserAuthSession,
  UserLoginInput,
  UserRegistrationInput,
} from "@/types/jobpilot";
import { INITIAL_CANDIDATE_PROFILE, INITIAL_JOBS } from "@/lib/mock-data";
import {
  buildSimulatedJobRecord,
  computeExplainableJobMatch,
  createWorkspaceJobApi,
  deleteAccountApi,
  deleteWorkspaceJobApi,
  fetchUserProfileApi,
  fetchWorkspaceJobsApi,
  generateTailoredApplicationDrafts,
  getCurrentUserApi,
  loginUserApi,
  registerUserApi,
  updateUserProfileApi,
  updateWorkspaceJobApi,
} from "@/services/api-client";

const STORAGE_KEYS = {
  JOBS: "jobpilot_ai_jobs_v1",
  PROFILE: "jobpilot_ai_profile_v1",
  SELECTED_JOB_ID: "jobpilot_ai_selected_job_id_v1",
  AUTH_SESSION: "jobpilot_ai_session_v1",
};

const MAX_PERSISTED_DATA_URL_LENGTH = 300_000; // ~220KB binary image limit for safe localStorage quota

function recalculateJobSkillMatch(job: JobRecord, updatedProfile: CandidateProfile): JobRecord {
  const explainableMatch = computeExplainableJobMatch(
    {
      title: job.title,
      company: job.company,
      location: job.location,
      work_mode: job.workMode,
      salary: job.salary,
      experience: job.experience,
      required_skills: job.requiredSkills,
      application_url: job.applicationUrl || null,
      contact: {
        recruiter_name: job.outreach.recruiterName || null,
        recruiter_title: job.outreach.recruiterTitle || null,
        recruiter_email: job.outreach.recruiterEmail || null,
        recruiter_phone: job.outreach.recruiterPhoneOrWhatsApp || null,
      },
      summary_description: job.description,
    },
    updatedProfile
  );

  return {
    ...job,
    matchedSkills: explainableMatch.matched_skills,
    missingSkills: explainableMatch.missing_skills,
    matchScore: explainableMatch.match_score,
    matchSummary: explainableMatch.match_summary,
    explainableMatch,
  };
}

interface JobPilotContextValue {
  jobs: JobRecord[];
  profile: CandidateProfile;
  selectedJobId: string;
  selectedJob: JobRecord | null;
  isHydrated: boolean;
  selectJob: (id: string) => void;
  addSimulatedJob: (input: NewJobInput) => JobRecord;
  updateJobStatus: (jobId: string, status: ApplicationStatus) => void;
  updateJobQuestions: (jobId: string, questions: ApplicationQuestionAnswer[]) => void;
  updateJobCoverLetter: (jobId: string, coverLetter: string) => void;
  regenerateJobDrafts: (jobId: string) => void;
  approveApplication: (jobId: string) => void;
  revertToDraft: (jobId: string) => void;
  markAsManuallySubmitted: (jobId: string) => void;
  recordApplicationAttempt: (
    jobId: string,
    attempt: ApplicationAttempt,
    updatedStatus?: ApplicationStatus
  ) => void;
  retryApplication: (jobId: string) => void;
  updateOutreachDraft: (jobId: string, outreach: RecruiterOutreachDraft) => void;
  updateProfile: (updated: CandidateProfile) => void;
  uploadResumeMetadata: (fileMeta: CandidateResumeFile) => void;
  removeResumeMetadata: () => void;
  deleteJob: (jobId: string) => void;
  resetDemoData: () => void;

  // SaaS Multi-Tenant & Account Isolation
  user: UserAuthSession | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  login: (input: UserLoginInput, importLocalJobs?: boolean) => Promise<void>;
  register: (input: UserRegistrationInput, importLocalJobs?: boolean) => Promise<void>;
  logout: () => void;
  deleteAccount: () => Promise<void>;
  syncCloudWorkspace: () => Promise<void>;
}

const JobPilotContext = createContext<JobPilotContextValue | undefined>(undefined);

export function JobPilotProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<JobRecord[]>(INITIAL_JOBS);
  const [profile, setProfile] = useState<CandidateProfile>(INITIAL_CANDIDATE_PROFILE);
  const [selectedJobId, setSelectedJobId] = useState<string>(INITIAL_JOBS[0].id);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [user, setUser] = useState<UserAuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Hydrate from localStorage on mount & verify session
  useEffect(() => {
    try {
      const savedJobs = localStorage.getItem(STORAGE_KEYS.JOBS);
      const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
      const savedSelectedId = localStorage.getItem(STORAGE_KEYS.SELECTED_JOB_ID);
      const savedSession = localStorage.getItem(STORAGE_KEYS.AUTH_SESSION);

      let loadedJobs: JobRecord[] | null = null;
      if (savedJobs) {
        const parsedJobs = JSON.parse(savedJobs) as JobRecord[];
        if (Array.isArray(parsedJobs)) {
          loadedJobs = parsedJobs;
          setJobs(parsedJobs);
        }
      }
      if (savedProfile) {
        const parsedProfile = JSON.parse(savedProfile) as CandidateProfile;
        if (parsedProfile && typeof parsedProfile.fullName === "string") {
          setProfile(parsedProfile);
        }
      }
      if (savedSelectedId) {
        const activeList = loadedJobs ?? INITIAL_JOBS;
        const exists = activeList.some((j) => j.id === savedSelectedId);
        setSelectedJobId(exists ? savedSelectedId : activeList[0]?.id || "");
      }

      if (savedSession) {
        try {
          const parsedSession = JSON.parse(savedSession) as UserAuthSession;
          if (parsedSession && parsedSession.access_token) {
            setUser(parsedSession);
            // Refresh from cloud in background
            fetchWorkspaceJobsApi(parsedSession.access_token)
              .then((cloudJobs) => {
                if (Array.isArray(cloudJobs) && cloudJobs.length > 0) {
                  setJobs(cloudJobs);
                  setSelectedJobId(cloudJobs[0].id);
                }
              })
              .catch((err) => {
                console.warn("Using local workspace fallback due to:", err);
              });
          }
        } catch (e) {
          console.error("Failed to parse saved session:", e);
        }
      }
    } catch (err) {
      console.error("Failed to read JobPilot state from localStorage:", err);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Persist jobs with quota fallback for large screenshot data URLs
  useEffect(() => {
    if (!isHydrated) return;
    try {
      const sanitizedForStorage = jobs.map((j) =>
        j.uploadedImagePreviewUrl &&
        j.uploadedImagePreviewUrl.length > MAX_PERSISTED_DATA_URL_LENGTH
          ? { ...j, uploadedImagePreviewUrl: undefined }
          : j
      );
      localStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(sanitizedForStorage));
    } catch (err) {
      console.error("Failed to persist jobs to localStorage:", err);
    }
  }, [jobs, isHydrated]);

  // Persist profile
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
    } catch (err) {
      console.error("Failed to persist profile to localStorage:", err);
    }
  }, [profile, isHydrated]);

  // Persist selectedJobId
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_JOB_ID, selectedJobId);
    } catch (err) {
      console.error("Failed to persist selectedJobId to localStorage:", err);
    }
  }, [selectedJobId, isHydrated]);

  const selectJob = useCallback((id: string) => {
    setSelectedJobId(id);
  }, []);

  const addSimulatedJob = useCallback(
    (input: NewJobInput): JobRecord => {
      const newJob = buildSimulatedJobRecord(input, profile);
      setJobs((prev) => [newJob, ...prev]);
      setSelectedJobId(newJob.id);
      if (user?.access_token) {
        createWorkspaceJobApi(user.access_token, newJob).catch((err) => {
          console.warn("Could not sync created job to cloud workspace:", err);
        });
      }
      return newJob;
    },
    [profile, user]
  );

  const updateJobStatus = useCallback(
    (jobId: string, status: ApplicationStatus) => {
      const now = new Date().toISOString();
      let updatedReviewState: ReviewState = "Draft";
      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;
          let reviewState = job.reviewState;
          if (status === "Approved") {
            reviewState = "Approved";
          } else if (status === "Submitted" || status === "Interview") {
            reviewState = "Submitted";
          } else if (
            status === "Saved" ||
            status === "Analysing" ||
            status === "Awaiting Approval"
          ) {
            reviewState = "Draft";
          }
          updatedReviewState = reviewState;
          return {
            ...job,
            status,
            reviewState,
            updatedAt: now,
            approvedAt:
              status === "Approved" || status === "Submitted" || status === "Interview"
                ? job.approvedAt || now
                : job.approvedAt,
            submittedAt:
              status === "Submitted" || status === "Interview"
                ? job.submittedAt || now
                : job.submittedAt,
          };
        })
      );
      if (user?.access_token) {
        updateWorkspaceJobApi(user.access_token, jobId, {
          status,
          reviewState: updatedReviewState,
        }).catch((err) => {
          console.warn("Could not sync job status update to cloud:", err);
        });
      }
    },
    [user]
  );

  const updateJobQuestions = useCallback(
    (jobId: string, questions: ApplicationQuestionAnswer[]) => {
      const now = new Date().toISOString();
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                questionsAndAnswers: questions,
                updatedAt: now,
              }
            : job
        )
      );
    },
    []
  );

  const updateJobCoverLetter = useCallback(
    (jobId: string, coverLetter: string) => {
      const now = new Date().toISOString();
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                coverLetter,
                updatedAt: now,
              }
            : job
        )
      );
    },
    []
  );

  const regenerateJobDrafts = useCallback(
    (jobId: string) => {
      const now = new Date().toISOString();
      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;
          const extractedFields = {
            title: job.title,
            company: job.company,
            location: job.location,
            work_mode: job.workMode,
            salary: job.salary,
            experience: job.experience,
            required_skills: job.requiredSkills,
            application_url: job.applicationUrl || null,
            contact: {
              recruiter_name: job.outreach.recruiterName || null,
              recruiter_title: job.outreach.recruiterTitle || null,
              recruiter_email: job.outreach.recruiterEmail || null,
              recruiter_phone: job.outreach.recruiterPhoneOrWhatsApp || null,
            },
            summary_description: job.description,
          };
          const explainableMatch = computeExplainableJobMatch(
            extractedFields,
            profile
          );
          const drafts = generateTailoredApplicationDrafts(
            extractedFields,
            profile,
            explainableMatch
          );
          return {
            ...job,
            matchedSkills: explainableMatch.matched_skills,
            missingSkills: explainableMatch.missing_skills,
            matchScore: explainableMatch.match_score,
            matchSummary: explainableMatch.match_summary,
            explainableMatch,
            coverLetter: drafts.cover_letter,
            questionsAndAnswers: drafts.questions_and_answers.map((q: any) => ({
              id: q.id,
              category: q.category,
              question: q.question,
              answer: q.answer,
              needsUserInput: q.needs_user_input,
              missingProfileFields: q.missing_profile_fields,
              groundingSources: q.grounding_sources,
            })),
            updatedAt: now,
          };
        })
      );
    },
    [profile]
  );

  /**
   * Explicitly approves an application for user submission.
   * Per safety rules: Approval NEVER automatically submits the application.
   */
  const approveApplication = useCallback((jobId: string) => {
    const now = new Date().toISOString();
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: "Approved",
              reviewState: "Approved",
              approvedAt: now,
              updatedAt: now,
            }
          : job
      )
    );
  }, []);

  const revertToDraft = useCallback((jobId: string) => {
    const now = new Date().toISOString();
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: "Awaiting Approval",
              reviewState: "Draft",
              updatedAt: now,
            }
          : job
      )
    );
  }, []);

  const markAsManuallySubmitted = useCallback((jobId: string) => {
    const now = new Date().toISOString();
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: "Submitted",
              reviewState: "Submitted",
              approvedAt: job.approvedAt || now,
              submittedAt: now,
              updatedAt: now,
              submissionHistory: [
                {
                  id: `manual-${Date.now()}`,
                  timestamp: now,
                  destinationUrl: job.applicationUrl || "Manual Entry",
                  source: job.source,
                  mode: "manual_guided",
                  outcome: "Submitted",
                  finalStatus: "Submitted",
                  confirmationDetails: "Manually confirmed by candidate",
                  answersSubmittedCount: job.questionsAndAnswers.length,
                },
                ...(job.submissionHistory || []),
              ],
            }
          : job
      )
    );
  }, []);

  const recordApplicationAttempt = useCallback(
    (
      jobId: string,
      attempt: ApplicationAttempt,
      updatedStatus?: ApplicationStatus
    ) => {
      const now = new Date().toISOString();
      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;
          const status = updatedStatus || attempt.finalStatus;
          const reviewState: ReviewState =
            status === "Submitted"
              ? "Submitted"
              : status === "Approved"
              ? "Approved"
              : "Draft";

          const history = [attempt, ...(job.submissionHistory || [])];
          return {
            ...job,
            status,
            reviewState,
            submissionHistory: history,
            submittedAt: status === "Submitted" ? now : job.submittedAt,
            updatedAt: now,
          };
        })
      );
    },
    []
  );

  const retryApplication = useCallback((jobId: string) => {
    const now = new Date().toISOString();
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: "Awaiting Approval",
              reviewState: "Draft",
              updatedAt: now,
            }
          : job
      )
    );
  }, []);

  const updateOutreachDraft = useCallback(
    (jobId: string, outreach: RecruiterOutreachDraft) => {
      const now = new Date().toISOString();
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                outreach: { ...outreach, lastUpdatedAt: now },
                updatedAt: now,
              }
            : job
        )
      );
    },
    []
  );

  const updateProfile = useCallback(
    (updated: CandidateProfile) => {
      const now = new Date().toISOString();
      setProfile({
        ...updated,
        updatedAt: now,
      });
      setJobs((prev) =>
        prev.map((job) => recalculateJobSkillMatch(job, updated))
      );
      if (user?.access_token) {
        updateUserProfileApi(user.access_token, updated).catch((err) => {
          console.warn("Could not sync profile to cloud:", err);
        });
      }
    },
    [user]
  );

  const uploadResumeMetadata = useCallback((fileMeta: CandidateResumeFile) => {
    setProfile((prev) => ({
      ...prev,
      resumeFile: fileMeta,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const removeResumeMetadata = useCallback(() => {
    setProfile((prev) => ({
      ...prev,
      resumeFile: null,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const deleteJob = useCallback(
    (jobId: string) => {
      setJobs((prev) => {
        const filtered = prev.filter((j) => j.id !== jobId);
        if (selectedJobId === jobId) {
          setSelectedJobId(filtered[0]?.id || "");
        }
        return filtered;
      });
      if (user?.access_token) {
        deleteWorkspaceJobApi(user.access_token, jobId).catch((err) => {
          console.warn("Could not delete job from cloud:", err);
        });
      }
    },
    [selectedJobId, user]
  );

  const resetDemoData = useCallback(() => {
    setJobs(INITIAL_JOBS);
    setProfile(INITIAL_CANDIDATE_PROFILE);
    setSelectedJobId(INITIAL_JOBS[0].id);
    try {
      localStorage.removeItem(STORAGE_KEYS.JOBS);
      localStorage.removeItem(STORAGE_KEYS.PROFILE);
      localStorage.removeItem(STORAGE_KEYS.SELECTED_JOB_ID);
    } catch (err) {
      console.error("Failed to clear localStorage:", err);
    }
  }, []);

  const login = useCallback(
    async (input: UserLoginInput, importLocalJobs = false) => {
      setAuthLoading(true);
      try {
        const session = await loginUserApi(input);
        setUser(session);
        localStorage.setItem(STORAGE_KEYS.AUTH_SESSION, JSON.stringify(session));

        if (importLocalJobs && jobs.length > 0) {
          for (const job of jobs) {
            try {
              await createWorkspaceJobApi(session.access_token, job);
            } catch (e) {
              console.warn("Error migrating job to cloud:", job.title, e);
            }
          }
        }

        try {
          const cloudJobs = await fetchWorkspaceJobsApi(session.access_token);
          if (Array.isArray(cloudJobs) && cloudJobs.length > 0) {
            setJobs(cloudJobs);
            setSelectedJobId(cloudJobs[0].id);
          }
        } catch (e) {
          console.warn("Error fetching cloud jobs after login:", e);
        }

        try {
          const cloudProfile = await fetchUserProfileApi(session.access_token);
          if (cloudProfile && cloudProfile.full_name) {
            setProfile((prev) => ({
              ...prev,
              fullName: cloudProfile.full_name || prev.fullName,
              phone: cloudProfile.phone || prev.phone,
              preferredRole: cloudProfile.preferred_role || prev.preferredRole,
              preferredLocation: cloudProfile.preferred_location || prev.preferredLocation,
              yearsOfExperience: cloudProfile.years_of_experience || prev.yearsOfExperience,
              experienceSummary: cloudProfile.experience_summary || prev.experienceSummary,
              skills: Array.isArray(cloudProfile.skills) && cloudProfile.skills.length > 0 ? cloudProfile.skills : prev.skills,
              portfolioOrGithubUrl: cloudProfile.portfolio_url || prev.portfolioOrGithubUrl,
            }));
          }
        } catch (e) {
          console.warn("Error fetching cloud profile:", e);
        }
      } finally {
        setAuthLoading(false);
      }
    },
    [jobs]
  );

  const register = useCallback(
    async (input: UserRegistrationInput, importLocalJobs = true) => {
      setAuthLoading(true);
      try {
        const session = await registerUserApi(input);
        setUser(session);
        localStorage.setItem(STORAGE_KEYS.AUTH_SESSION, JSON.stringify(session));

        if (importLocalJobs && jobs.length > 0) {
          for (const job of jobs) {
            try {
              await createWorkspaceJobApi(session.access_token, job);
            } catch (e) {
              console.warn("Error migrating job to cloud:", job.title, e);
            }
          }
        }

        try {
          const cloudJobs = await fetchWorkspaceJobsApi(session.access_token);
          if (Array.isArray(cloudJobs) && cloudJobs.length > 0) {
            setJobs(cloudJobs);
            setSelectedJobId(cloudJobs[0].id);
          }
        } catch (e) {
          console.warn("Error fetching cloud jobs after register:", e);
        }
      } finally {
        setAuthLoading(false);
      }
    },
    [jobs]
  );

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
    const savedJobs = localStorage.getItem(STORAGE_KEYS.JOBS);
    if (savedJobs) {
      try {
        const parsed = JSON.parse(savedJobs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setJobs(parsed);
          setSelectedJobId(parsed[0].id);
          return;
        }
      } catch {}
    }
    setJobs(INITIAL_JOBS);
    setSelectedJobId(INITIAL_JOBS[0].id);
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!user) return;
    setAuthLoading(true);
    try {
      await deleteAccountApi(user.access_token);
      setUser(null);
      localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
      resetDemoData();
    } finally {
      setAuthLoading(false);
    }
  }, [user, resetDemoData]);

  const syncCloudWorkspace = useCallback(async () => {
    if (!user) return;
    const cloudJobs = await fetchWorkspaceJobsApi(user.access_token);
    if (Array.isArray(cloudJobs)) {
      setJobs(cloudJobs);
      if (cloudJobs.length > 0 && !cloudJobs.some((j) => j.id === selectedJobId)) {
        setSelectedJobId(cloudJobs[0].id);
      }
    }
  }, [user, selectedJobId]);

  const selectedJob =
    jobs.find((j) => j.id === selectedJobId) || (jobs.length > 0 ? jobs[0] : null);

  return (
    <JobPilotContext.Provider
      value={{
        jobs,
        profile,
        selectedJobId: selectedJob?.id || "",
        selectedJob,
        isHydrated,
        selectJob,
        addSimulatedJob,
        updateJobStatus,
        updateJobQuestions,
        updateJobCoverLetter,
        regenerateJobDrafts,
        approveApplication,
        revertToDraft,
        markAsManuallySubmitted,
        recordApplicationAttempt,
        retryApplication,
        updateOutreachDraft,
        updateProfile,
        uploadResumeMetadata,
        removeResumeMetadata,
        deleteJob,
        resetDemoData,

        user,
        isAuthenticated: Boolean(user),
        authLoading,
        login,
        register,
        logout,
        deleteAccount,
        syncCloudWorkspace,
      }}
    >
      {children}
    </JobPilotContext.Provider>
  );
}

export function useJobPilot() {
  const ctx = useContext(JobPilotContext);
  if (!ctx) {
    throw new Error("useJobPilot must be used within a JobPilotProvider");
  }
  return ctx;
}
