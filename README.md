# JobPilot AI — Human-in-the-Loop Job Application Copilot

A full-stack SaaS web application built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, **Lucide Icons**, and a **Python FastAPI** backend for **Job Screenshot Analysis + Evidence-Based Web Research**.

---

## Architecture Overview

1. **Next.js Frontend (`src/`)**
   - Preserves all 7 workspace pages: **Dashboard** (`/`), **Add Job** (`/add-job`), **Job Analysis** (`/analysis`), **Resume & Profile** (`/resume`), **Application Review** (`/review`), **Recruiter Outreach** (`/outreach`), and **Application Tracker** (`/tracker`).
   - Supports switching between **Connected FastAPI Mode** (`POST /api/v1/jobs/analyze`) and **Local Simulated Prototype Mode** (`localStorage`).
   - Displays per-field **Provenance Badges** (`Screenshot Vision`, `Public Webpage`, `Pasted Description`, `User Input`, or `Null / Not Found`), web research verification evidence, and an interactive **Review & Edit Before Saving** workflow on the Add Job page.
2. **Python FastAPI Backend (`backend/app/`)**
   - `GET /api/v1/health` — Reports server status and whether vision AI, web search, and PDF resume parsing (`pypdf`) are active without exposing API keys.
   - `POST /api/v1/resume/parse` (and `/api/v1/resume/upload` alias) — Validates PDF files (`%PDF-` signature, MIME type, max `10 MB`, encryption and corruption checks), extracts structured candidate profile sections from text-based PDFs using `pypdf`, and detects scanned/image-only PDFs (`parse_status="ocr_required"`, `ocr_required=true`) without fabricating data or logging resume contents.
   - `POST /api/v1/jobs/match` — Computes a deterministic, explainable job match (`0–100`) with configurable component weights (`skills=0.55`, `experience=0.25`, `education_certs=0.10`, `role_location=0.10`), distinguishing skills not mentioned in the resume (`not_mentioned_in_resume`) from partial/below-requirement experience.
   - `POST /api/v1/jobs/drafts` — Generates editable, job-specific cover letters and application answers grounded strictly in verified candidate profile fields, explicitly marking questions that require user input (`needs_user_input=true`, `[USER INPUT NEEDED]`).
   - `POST /api/v1/jobs/analyze` — Validates screenshots (`PNG`, `JPEG`, `WEBP`, `GIF`, max `8 MB`, magic-byte header verification), extracts structured job fields with provenance, fetches public webpage metadata (JSON-LD `JobPosting` / OpenGraph) only when permitted, conducts configurable web research, and returns explainable match + tailored application drafts.
   - `POST /api/v1/applications/assist` — Safe semi-automatic application workflow. Classifies destination portal policy (`permitted_direct_assisted` vs `restricted_manual_guided` for LinkedIn/Naukri), enforces mandatory user confirmation (`confirmed_by_user`), generates copyable clipboard packets, detects security challenges / CAPTCHAs, and validates credible submission receipts before marking any job as submitted.
   - `GET /api/v1/mock-career-portal` & `POST /api/v1/mock-career-portal/submit` — Safe local simulated career portal for automated end-to-end browser testing without touching live third-party sites.

### 4. Production Security Architecture & Next.js Server-Side Proxy
- **Zero Client-Side Secrets**: Backend authorization tokens (`FASTAPI_API_KEY` / `JOBPILOT_API_AUTH_TOKEN`) are strictly server-side and never prefixed with `NEXT_PUBLIC_`. Browser bundles contain no backend secrets.
- **Next.js Server Proxy (`/api/backend/[...path]`)**:
  - Browser requests route through same-origin Next.js Route Handlers ([`src/app/api/backend/[...path]/route.ts`](file:///c:/Users/karthick/Desktop/JobPilot%20AI/src/app/api/backend/%5B...path%5D/route.ts)).
  - Next.js server injects `Authorization: Bearer <token>` and `X-API-Key` during transit to the FastAPI backend.
  - Whitelists permitted paths (`jobs/analyze`, `resume/parse`, `jobs/match`, `jobs/drafts`, `applications/assist`, `health`) and rejects unwhitelisted routes with `HTTP 403 Forbidden`.
  - Rejects oversized requests (> 15MB) early with `HTTP 413 Content Too Large`.
- **Authentication Model Scope & Limitations**:
  - The shared token (`JOBPILOT_API_AUTH_TOKEN`) provides **server-to-server perimeter authentication** to prevent anonymous internet scrapers from abusing FastAPI endpoints directly.
  - It does **not** provide individual user authentication or multi-tenant database row-level security. User accounts, multi-tenancy, and cloud data persistence will require an identity/database integration (e.g., Supabase Auth + PostgreSQL).
- **In-Memory Rate Limiting**:
  - Sliding-window limiter on FastAPI guards against abuse (`JOBPILOT_RATE_LIMIT_RPM=60`, `JOBPILOT_EXPENSIVE_RATE_LIMIT_RPM=15`).
- **Strict CORS**:
  - Backend CORS is locked to explicit production origins in `JOBPILOT_CORS_ORIGINS`. Preview domain wildcards are disabled by default.

---

## Provider Configuration Documentation

Copy [`.env.example`](file:///c:/Users/karthick/Desktop/JobPilot%20AI/.env.example) to `.env.local` (for Next.js) and set server-side environment variables before starting the FastAPI backend. **Keep all API keys strictly on the backend server.**

### 1. Vision & Structured Extraction AI Providers (`backend/app/services/extractor.py`)
- **`JOBPILOT_AI_PROVIDER=gemini`**
  - Requires `GEMINI_API_KEY` (and optional `GEMINI_MODEL`, default `gemini-2.5-flash`).
  - Extracts structured fields from uploaded job screenshots and descriptions via the Gemini REST API.
- **`JOBPILOT_AI_PROVIDER=openai`**
  - Requires `OPENAI_API_KEY` (and optional `OPENAI_MODEL`, default `gpt-4o-mini`).
  - Uses OpenAI chat completions with vision & JSON mode.
- **`JOBPILOT_AI_PROVIDER=none` (Default when unconfigured)**
  - Uses deterministic text & public HTML/JSON-LD extraction and returns `null` for any unknown or missing field without inventing values. If a screenshot is uploaded without a vision key configured, the API returns an explicit warning disclosure.

### 2. Web Search Research Providers (`backend/app/services/researcher.py`)
- **`JOBPILOT_SEARCH_PROVIDER=duckduckgo` (or `ddgs`)** — Free public web search via the maintained [`ddgs`](https://pypi.org/project/ddgs/) library (`DuckDuckGoSearchProvider`). **Requires no API keys** (`TAVILY_API_KEY`, `SERPER_API_KEY`, and `BRAVE_SEARCH_API_KEY` can remain unset). Handles rate limits, timeouts, network errors, and empty results honestly without fabricating evidence.
- **`JOBPILOT_SEARCH_PROVIDER=tavily`** — Requires `TAVILY_API_KEY`.
- **`JOBPILOT_SEARCH_PROVIDER=serper`** — Requires `SERPER_API_KEY`.
- **`JOBPILOT_SEARCH_PROVIDER=brave`** — Requires `BRAVE_SEARCH_API_KEY`.
- **`JOBPILOT_SEARCH_PROVIDER=none` (Default when unconfigured)** — Returns `verification_status: "Search Not Configured"` and `company_verified: false`. Never labels a company or recruiter as verified without supporting search evidence.

### 3. Safe Semi-Automatic Application & Platform Policies (`backend/app/services/browser_assistant.py`)
- **Target Classification Policy**:
  - `restricted_manual_guided`: LinkedIn and Naukri. Strictly disables direct bot automation, credential capture, and CAPTCHA/OTP bypass to protect account security and comply with Terms of Service. Assembles a structured clipboard packet (candidate details, tailored answers, cover letter) with one-click copying and directs the user through an assisted manual submission flow.
  - `permitted_direct_assisted`: Permitted public company portals and application forms with Playwright browser automation (`JOBPILOT_ENABLE_BROWSER_AUTOMATION=true`).
- **Mandatory Approval Gate**:
  - Halts execution with `confirmed_by_user=False` until the user reviews the exact target URL, company, role, attached resume, and answers in the Final Approval modal.
  - Never transitions application status to `Submitted` simply upon opening a URL or filling a form.
  - Requires credible proof of receipt (confirmation text, submission ID) to mark as `Submitted`. Uncertain results transition to `Failed` or require manual human verification.
- **Application History & Duplicate Prevention**:
  - Full attempt history (`submissionHistory`) persists timestamps, URLs, outcomes, and non-sensitive notes.
  - Detects duplicate roles at the same company or identical application URLs, presenting a high-visibility warning and requiring explicit user acknowledgment.
  - Failed applications offer a one-click Retry workflow that redirects to Review for pre-submission edits.

### 4. Production Security Architecture & Next.js Server-Side Proxy
- **Zero Client-Side Secrets**: Backend authorization tokens (`FASTAPI_API_KEY` / `JOBPILOT_API_AUTH_TOKEN`) are strictly server-side and never prefixed with `NEXT_PUBLIC_`. Browser bundles contain no backend secrets.
- **Next.js Server Proxy (`/api/backend/[...path]`)**:
  - Browser requests route through same-origin Next.js Route Handlers ([`src/app/api/backend/[...path]/route.ts`](file:///c:/Users/karthick/Desktop/JobPilot%20AI/src/app/api/backend/%5B...path%5D/route.ts)).
  - Next.js server injects `Authorization: Bearer <token>` and `X-API-Key` during transit to the FastAPI backend.
  - Whitelists permitted paths (`jobs/analyze`, `resume/parse`, `jobs/match`, `jobs/drafts`, `applications/assist`, `health`) and rejects unwhitelisted routes with `HTTP 403 Forbidden`.
  - Rejects oversized requests (> 15MB) early with `HTTP 413 Content Too Large`.
- **Authentication Model Scope & Limitations**:
  - The shared token (`JOBPILOT_API_AUTH_TOKEN`) provides **server-to-server perimeter authentication** to prevent anonymous internet scrapers from abusing FastAPI endpoints directly.
  - It does **not** provide individual user authentication or multi-tenant database row-level security. User accounts, multi-tenancy, and cloud data persistence will require an identity/database integration (e.g., Supabase Auth + PostgreSQL).
- **In-Memory Rate Limiting**:
  - Sliding-window limiter on FastAPI guards against abuse (`JOBPILOT_RATE_LIMIT_RPM=60`, `JOBPILOT_EXPENSIVE_RATE_LIMIT_RPM=15`).
- **Strict CORS**:
  - Backend CORS is locked to explicit production origins in `JOBPILOT_CORS_ORIGINS`. Preview domain wildcards are disabled by default.

---

## Running Locally

### 1. Start the Python FastAPI Backend
```powershell
# Create virtual environment and install dependencies (already set up in backend/.venv)
uv venv backend/.venv
uv pip install --python backend/.venv/Scripts/python.exe -r backend/requirements.txt

# Start FastAPI server on http://localhost:8000
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

### 2. Start the Next.js Frontend
```powershell
# Install frontend packages
npm install

# Run development server on http://localhost:3000
npm run dev
```

### 3. Run Automated Tests & Checks
```powershell
# Backend unit & API tests (pytest)
backend\.venv\Scripts\python.exe -m pytest -v

# Frontend unit & integration tests (Node test runner)
npm test

# TypeScript & production Next.js build checks
npm run typecheck
npm run build
```
#   J o b P i l o t - A I  
 