"""Database schema DDL for JobPilot AI SaaS platform.

Supports SQLite (local & testing) and PostgreSQL with identical relational semantics:
- Foreign keys with ON DELETE CASCADE for clean tenant data deletion
- JSON serialization for structured provenance and drafts
- User tenant isolation on all workspace records
"""

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'user' NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT,
    preferred_role TEXT,
    preferred_location TEXT,
    years_of_experience TEXT,
    experience_summary TEXT,
    skills_json TEXT DEFAULT '[]' NOT NULL,
    portfolio_url TEXT,
    linkedin_url TEXT,
    education_entries_json TEXT DEFAULT '[]' NOT NULL,
    employment_entries_json TEXT DEFAULT '[]' NOT NULL,
    certifications_json TEXT DEFAULT '[]' NOT NULL,
    updated_at TEXT NOT NULL
);

-- 3. Resumes Table
CREATE TABLE IF NOT EXISTS candidate_resumes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    extracted_text TEXT,
    structured_data_json TEXT,
    parse_status TEXT DEFAULT 'pending' NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_resumes_user ON candidate_resumes(user_id);

-- 4. Jobs Table (Tenant Isolated)
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    work_mode TEXT DEFAULT 'Remote' NOT NULL,
    salary TEXT,
    experience TEXT,
    required_skills_json TEXT DEFAULT '[]' NOT NULL,
    matched_skills_json TEXT DEFAULT '[]' NOT NULL,
    missing_skills_json TEXT DEFAULT '[]' NOT NULL,
    source TEXT DEFAULT 'Company Website' NOT NULL,
    application_url TEXT,
    description TEXT,
    match_score INTEGER DEFAULT 0 NOT NULL,
    match_summary TEXT,
    status TEXT DEFAULT 'Saved' NOT NULL,
    review_state TEXT DEFAULT 'Draft' NOT NULL,
    verification_state TEXT DEFAULT 'Pending Manual Verification' NOT NULL,
    verification_note TEXT,
    field_provenance_json TEXT DEFAULT '{}' NOT NULL,
    web_research_json TEXT,
    recruiter_contact_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC);

-- 5. Application Drafts Table
CREATE TABLE IF NOT EXISTS job_application_drafts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_letter TEXT,
    cover_letter_needs_input INTEGER DEFAULT 0 NOT NULL,
    questions_and_answers_json TEXT DEFAULT '[]' NOT NULL,
    grounding_warnings_json TEXT DEFAULT '[]' NOT NULL,
    approved_at TEXT,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_draft_job_user UNIQUE (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_drafts_job_user ON job_application_drafts(job_id, user_id);

-- 6. Application Attempts & Audit Trail
CREATE TABLE IF NOT EXISTS application_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination_url TEXT NOT NULL,
    source TEXT NOT NULL,
    mode TEXT NOT NULL,
    outcome TEXT NOT NULL,
    final_status TEXT NOT NULL,
    confirmation_details TEXT,
    error_message TEXT,
    answers_submitted_count INTEGER DEFAULT 0 NOT NULL,
    duplicate_warning_acknowledged INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_job_user ON application_attempts(job_id, user_id);

-- 7. Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    tier TEXT DEFAULT 'free' NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 8. Usage Metering Ledger
CREATE TABLE IF NOT EXISTS usage_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_year_month TEXT NOT NULL,
    resumes_parsed INTEGER DEFAULT 0 NOT NULL,
    jobs_analyzed INTEGER DEFAULT 0 NOT NULL,
    ai_extractions_count INTEGER DEFAULT 0 NOT NULL,
    web_searches_count INTEGER DEFAULT 0 NOT NULL,
    applications_assisted INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_user_period UNIQUE (user_id, period_year_month)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_period ON usage_ledger(user_id, period_year_month);

-- 9. Idempotent Processed Stripe Webhook Events
CREATE TABLE IF NOT EXISTS processed_stripe_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TEXT NOT NULL
);
"""
