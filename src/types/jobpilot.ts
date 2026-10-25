export type JobSource = "LinkedIn" | "Naukri" | "Company Website" | "Other";

export type ApplicationStatus =
  | "Saved"
  | "Analysing"
  | "Awaiting Approval"
  | "Approved"
  | "Submitted"
  | "Interview"
  | "Rejected"
  | "Failed";

export type ReviewState = "Draft" | "Approved" | "Submitted";

export type VerificationState =
  | "Verified Facts"
  | "Conflicting Information"
  | "Unverified Claims"
  | "Search Not Configured"
  | "Source URL Provided"
  | "Unverified (Screenshot / Text Only)"
  | "Pending Manual Verification";

export type ProvenanceSource =
  | "screenshot_vision"
  | "webpage_public"
  | "pasted_description"
  | "user_input"
  | "missing";

export interface FieldProvenanceMap {
  title: ProvenanceSource;
  company: ProvenanceSource;
  location: ProvenanceSource;
  salary: ProvenanceSource;
  experience: ProvenanceSource;
  required_skills: ProvenanceSource;
  application_url: ProvenanceSource;
  contact: ProvenanceSource;
}

export interface ResearchEvidenceItem {
  category: "vacancy" | "company_careers" | "recruiter" | "general";
  title: string;
  url: string;
  snippet: string;
  classification: "verified_fact" | "conflicting_info" | "unverified_claim";
}

export interface FieldComparisonResult {
  field_name: string;
  extracted_value: string | null;
  research_finding: string;
  status: "matched" | "conflicting" | "unverified";
}

export interface WebResearchReport {
  provider_used: string;
  search_performed: boolean;
  verification_status:
    | "Verified Facts"
    | "Conflicting Information"
    | "Unverified Claims"
    | "Search Not Configured";
  company_verified: boolean;
  recruiter_verified: boolean;
  summary_note: string;
  evidence_items: ResearchEvidenceItem[];
  comparisons: FieldComparisonResult[];
  limitations: string[];
}

export interface ExtractedJobFields {
  title: string | null;
  company: string | null;
  location: string | null;
  work_mode: "Remote" | "Hybrid" | "On-site" | null;
  salary: string | null;
  experience: string | null;
  required_skills: string[];
  application_url: string | null;
  contact: {
    recruiter_name: string | null;
    recruiter_title: string | null;
    recruiter_email: string | null;
    recruiter_phone: string | null;
  };
  summary_description: string | null;
}

export interface EmploymentEntry {
  company: string | null;
  title?: string | null;
  role?: string | null;
  duration: string | null;
  highlights: string[];
}

export interface EducationEntry {
  degree: string;
  institution: string | null;
  year: string | null;
}

export interface ProjectEntry {
  name: string;
  description: string | null;
  technologies: string[];
}

export interface ParsedResumeData {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  preferred_role: string | null;
  years_of_experience: string | null;
  experience_summary: string | null;
  portfolio_or_github_url: string | null;
  github_or_portfolio_url?: string | null;
  linkedin_url?: string | null;
  skills: string[];
  employment_history: EmploymentEntry[];
  education: EducationEntry[];
  certifications: string[];
  projects: ProjectEntry[];
}

export interface ResumeParseApiResponse {
  parse_status: "parsed" | "ocr_required" | "empty_text";
  is_scanned_or_image_only: boolean;
  ocr_required: boolean;
  page_count: number;
  extracted_char_count: number;
  parsed: ParsedResumeData;
  status_message: string;
  warnings: string[];
}

export interface SkillGapItem {
  skill: string;
  status: "not_mentioned_in_resume" | "explicitly_missing";
  detail: string;
  note?: string;
}

export interface EducationCertAlignment {
  status:
    | "aligned"
    | "not_mentioned_in_resume"
    | "explicitly_missing"
    | "not_explicitly_required";
  required_credentials: string[];
  matched_credentials: string[];
  missing_or_unmentioned_credentials: string[];
  summary: string;
}

export interface ScoreComponentBreakdown {
  skills_score: number;
  experience_score: number;
  education_certs_score: number;
  role_location_score: number;
  weights_used: Record<string, number>;
}

export interface ExplainableSkillMatch {
  match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  uncertain_or_unmentioned_skills?: SkillGapItem[];
  relevant_experience_evidence?: string[];
  experience_alignment_status?:
    | "aligned"
    | "partial_or_below"
    | "not_mentioned_in_resume"
    | "not_explicitly_required";
  education_certification_alignment?: EducationCertAlignment;
  score_breakdown?: ScoreComponentBreakdown;
  match_summary: string;
  summary?: string;
  explanation?: string;
  limitations?: string[];
  is_heuristic: boolean;
}

export interface TailoredDraftsApiResponse {
  cover_letter: string;
  cover_letter_needs_user_input: boolean;
  questions_and_answers: {
    id: string;
    category: "Motivation" | "Experience" | "Logistics" | "Custom";
    question: string;
    answer: string;
    needs_user_input: boolean;
    missing_profile_fields: string[];
    grounding_sources: string[];
  }[];
  grounding_warnings: string[];
}

export interface JobAnalyzeApiResponse {
  analysis_mode:
    | "live_ai_and_search"
    | "live_ai_only"
    | "deterministic_and_search"
    | "deterministic_only"
    | "local_simulated";
  ai_provider_used: string;
  webpage_fetched: boolean;
  webpage_fetch_note?: string | null;
  extracted: ExtractedJobFields;
  provenance: FieldProvenanceMap;
  web_research: WebResearchReport;
  skill_match: ExplainableSkillMatch;
  tailored_drafts?: TailoredDraftsApiResponse | null;
  warnings: string[];
}

export interface SourceLink {
  label: string;
  url: string;
  note: string;
  classification?: "verified_fact" | "conflicting_info" | "unverified_claim";
}

export interface ApplicationQuestionAnswer {
  id: string;
  question: string;
  answer: string;
  category: "Motivation" | "Experience" | "Logistics" | "Custom";
  needsUserInput?: boolean;
  missingProfileFields?: string[];
  groundingSources?: string[];
  lastEditedAt?: string;
}

export interface RecruiterOutreachDraft {
  recruiterName: string;
  recruiterTitle: string;
  recruiterEmail: string;
  recruiterPhoneOrWhatsApp: string;
  emailSubject: string;
  emailBody: string;
  whatsappMessage: string;
  lastUpdatedAt: string;
}

export type SubmissionOutcome =
  | "Submitted"
  | "Uncertain Confirmation"
  | "CAPTCHA / Security Check"
  | "Validation Error"
  | "Timeout"
  | "User Cancelled"
  | "Manual Action Required";

export interface ApplicationAttempt {
  id: string;
  timestamp: string;
  destinationUrl: string;
  source: JobSource;
  mode: "browser_assisted" | "manual_guided";
  outcome: SubmissionOutcome;
  finalStatus: ApplicationStatus;
  confirmationDetails?: string | null;
  errorMessage?: string | null;
  answersSubmittedCount: number;
  duplicateWarningAcknowledged?: boolean;
}

export interface BrowserAssistApiResponse {
  job_id: string;
  destination_url: string;
  platform_policy: "permitted_direct_assistant" | "restricted_manual_guided";
  outcome: SubmissionOutcome;
  final_status: ApplicationStatus;
  submission_confirmed: boolean;
  confirmation_evidence?: string | null;
  step_summary: string;
  filled_fields: string[];
  clipboard_packet: Record<string, string>;
  attempt_record: ApplicationAttempt;
  warnings: string[];
  errors: string[];
}

export interface JobRecord {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: "Remote" | "Hybrid" | "On-site";
  salary: string;
  experience: string;
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  source: JobSource;
  applicationUrl: string;
  description: string;
  matchScore: number;
  matchSummary: string;
  explainableMatch?: ExplainableSkillMatch;
  coverLetter?: string;
  status: ApplicationStatus;
  reviewState: ReviewState;
  verificationState: VerificationState;
  verificationNote: string;
  sourceLinks: SourceLink[];
  provenance?: FieldProvenanceMap;
  webResearch?: WebResearchReport;
  analysisMode?: JobAnalyzeApiResponse["analysis_mode"];
  aiProviderUsed?: string;
  uploadedFileName?: string;
  uploadedFileSize?: number;
  uploadedImagePreviewUrl?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  submittedAt?: string;
  questionsAndAnswers: ApplicationQuestionAnswer[];
  outreach: RecruiterOutreachDraft;
  submissionHistory?: ApplicationAttempt[];
  notes?: string;
}

export interface CandidateResumeFile {
  fileName: string;
  fileSize: number; // in bytes
  uploadedAt: string;
  uploadStatus:
    | "Parsed & Reviewed (FastAPI)"
    | "Parsed & Applied to Candidate Profile"
    | "Parsed via FastAPI (Awaiting User Review)"
    | "Uploaded (OCR Required)"
    | "OCR Required — Image-Only / Scanned PDF"
    | "Uploaded — No Extractable Text"
    | "Uploaded (Local Prototype Storage)"
    | "Uploaded (Local Storage — FastAPI Parser Offline)"
    | "Not Uploaded";
  pageCount?: number;
  extractedCharCount?: number;
  ocrRequired?: boolean;
}

export interface CandidateProfile {
  fullName: string;
  email: string;
  phone: string;
  preferredRole: string;
  preferredLocation: string;
  experienceSummary: string;
  yearsOfExperience: string;
  education: string;
  skills: string[];
  portfolioOrGithubUrl: string;
  employmentHistory?: EmploymentEntry[];
  educationList?: EducationEntry[];
  educationEntries?: EducationEntry[];
  certifications?: string[];
  projects?: ProjectEntry[];
  workAuthorization?: string;
  noticePeriod?: string;
  resumeFile: CandidateResumeFile | null;
  updatedAt: string;
}

export interface NewJobInput {
  title?: string;
  company?: string;
  location?: string;
  workMode?: "Remote" | "Hybrid" | "On-site";
  salary?: string;
  experience?: string;
  requiredSkills?: string[];
  recruiterName?: string;
  recruiterTitle?: string;
  recruiterEmail?: string;
  recruiterPhone?: string;
  source: JobSource;
  applicationUrl: string;
  description: string;
  screenshotFile?: {
    name: string;
    size: number;
    type: string;
    previewDataUrl?: string;
  } | null;
  analysisResult?: JobAnalyzeApiResponse | null;
}

export interface FastApiServiceConfig {
  baseUrl: string;
  supabaseConfigured: boolean;
  mode: "local-mock" | "fastapi-connected";
}
