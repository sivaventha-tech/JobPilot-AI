"""Data Access and Multi-Tenant Repository for JobPilot AI.

Guarantees:
1. Strict user-level tenant isolation: Every query scopes to `user_id`.
2. Safe parameterized SQL queries preventing SQL injection.
3. Atomic transaction handling and clean JSON serialization.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

from app.db.connection import DatabaseManager, db_manager


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _month_period() -> str:
    return time.strftime("%Y-%m", time.gmtime())


class UserRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def create(self, email: str, password_hash: str, full_name: str, role: str = "user") -> dict[str, Any]:
        user_id = str(uuid.uuid4())
        now = _now_iso()
        email_clean = email.lower().strip()
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, email_clean, password_hash, full_name.strip(), role, now, now),
            )
            # Create default empty profile
            conn.execute(
                """
                INSERT INTO user_profiles (user_id, phone, preferred_role, preferred_location,
                                           years_of_experience, experience_summary, skills_json,
                                           portfolio_url, linkedin_url, education_entries_json,
                                           employment_entries_json, certifications_json, updated_at)
                VALUES (?, '', '', '', '', '', '[]', '', '', '[]', '[]', '[]', ?)
                """,
                (user_id, now),
            )
            # Create default free subscription record
            conn.execute(
                """
                INSERT INTO subscriptions (id, user_id, tier, status, created_at, updated_at)
                VALUES (?, ?, 'free', 'active', ?, ?)
                """,
                (str(uuid.uuid4()), user_id, now, now),
            )
        return self.get_by_id(user_id) or {}

    def get_by_email(self, email: str) -> dict[str, Any] | None:
        conn = self.db.get_connection()
        cur = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),))
        row = cur.fetchone()
        return dict(row) if row else None

    def get_by_id(self, user_id: str) -> dict[str, Any] | None:
        conn = self.db.get_connection()
        cur = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None

    def delete(self, user_id: str) -> bool:
        """Deletes user and cascades to all child workspace tables."""
        with self.db.transaction() as conn:
            cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            return cur.rowcount > 0


class ProfileRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def get(self, user_id: str) -> dict[str, Any] | None:
        conn = self.db.get_connection()
        cur = conn.execute(
            """
            SELECT u.email, u.full_name, p.*
            FROM users u
            JOIN user_profiles p ON u.id = p.user_id
            WHERE u.id = ?
            """,
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        res = dict(row)
        res["skills"] = json.loads(res.pop("skills_json", "[]"))
        res["education_entries"] = json.loads(res.pop("education_entries_json", "[]"))
        res["employment_entries"] = json.loads(res.pop("employment_entries_json", "[]"))
        res["certifications"] = json.loads(res.pop("certifications_json", "[]"))
        return res

    def update(self, user_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        now = _now_iso()
        fields: list[str] = ["updated_at = ?"]
        values: list[Any] = [now]

        if "full_name" in updates:
            with self.db.transaction() as conn:
                conn.execute(
                    "UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?",
                    (updates["full_name"], now, user_id),
                )

        scalar_mapping = {
            "phone": "phone",
            "preferred_role": "preferred_role",
            "preferred_location": "preferred_location",
            "years_of_experience": "years_of_experience",
            "experience_summary": "experience_summary",
            "portfolio_url": "portfolio_url",
            "linkedin_url": "linkedin_url",
        }
        for key, col in scalar_mapping.items():
            if key in updates:
                fields.append(f"{col} = ?")
                values.append(updates[key])

        json_mapping = {
            "skills": "skills_json",
            "education_entries": "education_entries_json",
            "employment_entries": "employment_entries_json",
            "certifications": "certifications_json",
        }
        for key, col in json_mapping.items():
            if key in updates:
                fields.append(f"{col} = ?")
                values.append(json.dumps(updates[key]))

        values.append(user_id)
        with self.db.transaction() as conn:
            conn.execute(
                f"UPDATE user_profiles SET {', '.join(fields)} WHERE user_id = ?",
                values,
            )
        return self.get(user_id)


class JobRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        d["requiredSkills"] = json.loads(d.pop("required_skills_json", "[]"))
        d["matchedSkills"] = json.loads(d.pop("matched_skills_json", "[]"))
        d["missingSkills"] = json.loads(d.pop("missing_skills_json", "[]"))
        d["workMode"] = d.pop("work_mode", "Remote")
        d["matchScore"] = d.pop("match_score", 0)
        d["matchSummary"] = d.pop("match_summary", "")
        d["reviewState"] = d.pop("review_state", "Draft")
        d["verificationState"] = d.pop("verification_state", "Pending Manual Verification")
        d["verificationNote"] = d.pop("verification_note", "")
        d["applicationUrl"] = d.pop("application_url", "") or ""
        d["provenance"] = json.loads(d.pop("field_provenance_json", "{}"))
        d["webResearch"] = json.loads(d.pop("web_research_json", "null") or "null")
        d["outreach"] = json.loads(d.pop("recruiter_contact_json", "null") or "null") or {}
        d["createdAt"] = d.pop("created_at")
        d["updatedAt"] = d.pop("updated_at")
        return d

    def list_by_user(
        self,
        user_id: str,
        status: str | None = None,
        source: str | None = None,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        """Strictly tenant-isolated job query."""
        conn = self.db.get_connection()
        query = "SELECT * FROM jobs WHERE user_id = ?"
        params: list[Any] = [user_id]

        if status and status != "All":
            query += " AND status = ?"
            params.append(status)
        if source and source != "All":
            query += " AND source = ?"
            params.append(source)
        if search and search.strip():
            q = f"%{search.strip().lower()}%"
            query += " AND (LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(location) LIKE ?)"
            params.extend([q, q, q])

        query += " ORDER BY created_at DESC"
        cur = conn.execute(query, params)
        rows = cur.fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_by_user(self, user_id: str, job_id: str) -> dict[str, Any] | None:
        """Tenant-isolated single job lookup. Returns None if job does not belong to user."""
        conn = self.db.get_connection()
        cur = conn.execute("SELECT * FROM jobs WHERE user_id = ? AND id = ?", (user_id, job_id))
        row = cur.fetchone()
        return self._row_to_dict(row) if row else None

    def create(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        job_id = data.get("id") or str(uuid.uuid4())
        now = _now_iso()
        required_skills = json.dumps(data.get("requiredSkills", []))
        matched_skills = json.dumps(data.get("matchedSkills", []))
        missing_skills = json.dumps(data.get("missingSkills", []))
        provenance = json.dumps(data.get("provenance", {}))
        web_research = json.dumps(data.get("webResearch", None))
        outreach = json.dumps(data.get("outreach", {}))

        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO jobs (
                    id, user_id, title, company, location, work_mode, salary, experience,
                    required_skills_json, matched_skills_json, missing_skills_json, source,
                    application_url, description, match_score, match_summary, status,
                    review_state, verification_state, verification_note, field_provenance_json,
                    web_research_json, recruiter_contact_json, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    job_id,
                    user_id,
                    data.get("title", "Untitled Role"),
                    data.get("company", "Unknown Company"),
                    data.get("location", "Remote"),
                    data.get("workMode", "Remote"),
                    data.get("salary", "Not Disclosed"),
                    data.get("experience", "Not Specified"),
                    required_skills,
                    matched_skills,
                    missing_skills,
                    data.get("source", "Company Website"),
                    data.get("applicationUrl", "") or "",
                    data.get("description", ""),
                    int(data.get("matchScore", 0)),
                    data.get("matchSummary", ""),
                    data.get("status", "Saved"),
                    data.get("reviewState", "Draft"),
                    data.get("verificationState", "Pending Manual Verification"),
                    data.get("verificationNote", ""),
                    provenance,
                    web_research,
                    outreach,
                    now,
                    now,
                ),
            )
        return self.get_by_user(user_id, job_id) or {}

    def update(self, user_id: str, job_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        """Tenant-isolated job update."""
        existing = self.get_by_user(user_id, job_id)
        if not existing:
            return None

        now = _now_iso()
        fields: list[str] = ["updated_at = ?"]
        values: list[Any] = [now]

        direct_map = {
            "title": "title",
            "company": "company",
            "location": "location",
            "workMode": "work_mode",
            "salary": "salary",
            "experience": "experience",
            "source": "source",
            "applicationUrl": "application_url",
            "description": "description",
            "matchScore": "match_score",
            "matchSummary": "match_summary",
            "status": "status",
            "reviewState": "review_state",
            "verificationState": "verification_state",
            "verificationNote": "verification_note",
        }
        for key, col in direct_map.items():
            if key in updates:
                fields.append(f"{col} = ?")
                values.append(updates[key])

        json_map = {
            "requiredSkills": "required_skills_json",
            "matchedSkills": "matched_skills_json",
            "missingSkills": "missing_skills_json",
            "provenance": "field_provenance_json",
            "webResearch": "web_research_json",
            "outreach": "recruiter_contact_json",
        }
        for key, col in json_map.items():
            if key in updates:
                fields.append(f"{col} = ?")
                values.append(json.dumps(updates[key]))

        values.extend([user_id, job_id])
        with self.db.transaction() as conn:
            conn.execute(
                f"UPDATE jobs SET {', '.join(fields)} WHERE user_id = ? AND id = ?",
                values,
            )
        return self.get_by_user(user_id, job_id)

    def delete(self, user_id: str, job_id: str) -> bool:
        """Tenant-isolated job deletion."""
        with self.db.transaction() as conn:
            cur = conn.execute("DELETE FROM jobs WHERE user_id = ? AND id = ?", (user_id, job_id))
            return cur.rowcount > 0


class DraftRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def get(self, user_id: str, job_id: str) -> dict[str, Any] | None:
        conn = self.db.get_connection()
        cur = conn.execute(
            "SELECT * FROM job_application_drafts WHERE user_id = ? AND job_id = ?",
            (user_id, job_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["questionsAndAnswers"] = json.loads(d.pop("questions_and_answers_json", "[]"))
        d["groundingWarnings"] = json.loads(d.pop("grounding_warnings_json", "[]"))
        d["coverLetter"] = d.pop("cover_letter", "")
        d["coverLetterNeedsInput"] = bool(d.pop("cover_letter_needs_input", 0))
        return d

    def upsert(self, user_id: str, job_id: str, draft_data: dict[str, Any]) -> dict[str, Any]:
        now = _now_iso()
        cover_letter = draft_data.get("coverLetter", "")
        needs_input = 1 if draft_data.get("coverLetterNeedsInput") else 0
        q_and_a = json.dumps(draft_data.get("questionsAndAnswers", []))
        warnings = json.dumps(draft_data.get("groundingWarnings", []))
        approved_at = draft_data.get("approvedAt")

        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO job_application_drafts (
                    id, job_id, user_id, cover_letter, cover_letter_needs_input,
                    questions_and_answers_json, grounding_warnings_json, approved_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id, user_id) DO UPDATE SET
                    cover_letter = excluded.cover_letter,
                    cover_letter_needs_input = excluded.cover_letter_needs_input,
                    questions_and_answers_json = excluded.questions_and_answers_json,
                    grounding_warnings_json = excluded.grounding_warnings_json,
                    approved_at = excluded.approved_at,
                    updated_at = excluded.updated_at
                """,
                (
                    str(uuid.uuid4()),
                    job_id,
                    user_id,
                    cover_letter,
                    needs_input,
                    q_and_a,
                    warnings,
                    approved_at,
                    now,
                ),
            )
        return self.get(user_id, job_id) or {}


class AttemptRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def record(self, user_id: str, job_id: str, attempt: dict[str, Any]) -> dict[str, Any]:
        attempt_id = attempt.get("id") or str(uuid.uuid4())
        now = _now_iso()
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO application_attempts (
                    id, job_id, user_id, destination_url, source, mode, outcome,
                    final_status, confirmation_details, error_message,
                    answers_submitted_count, duplicate_warning_acknowledged, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    attempt_id,
                    job_id,
                    user_id,
                    attempt.get("destinationUrl", ""),
                    attempt.get("source", "Company Website"),
                    attempt.get("mode", "browser_assisted"),
                    attempt.get("outcome", "Submitted"),
                    attempt.get("finalStatus", "Submitted"),
                    attempt.get("confirmationDetails"),
                    attempt.get("errorMessage"),
                    int(attempt.get("answersSubmittedCount", 0)),
                    1 if attempt.get("duplicateWarningAcknowledged") else 0,
                    attempt.get("timestamp") or now,
                ),
            )
        return attempt

    def list_by_job(self, user_id: str, job_id: str) -> list[dict[str, Any]]:
        conn = self.db.get_connection()
        cur = conn.execute(
            """
            SELECT * FROM application_attempts
            WHERE user_id = ? AND job_id = ?
            ORDER BY created_at DESC
            """,
            (user_id, job_id),
        )
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            result.append({
                "id": d["id"],
                "timestamp": d["created_at"],
                "destinationUrl": d["destination_url"],
                "source": d["source"],
                "mode": d["mode"],
                "outcome": d["outcome"],
                "finalStatus": d["final_status"],
                "confirmationDetails": d["confirmation_details"],
                "errorMessage": d["error_message"],
                "answersSubmittedCount": d["answers_submitted_count"],
                "duplicateWarningAcknowledged": bool(d["duplicate_warning_acknowledged"]),
            })
        return result


class UsageRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def get_or_create(self, user_id: str) -> dict[str, Any]:
        period = _month_period()
        now = _now_iso()
        conn = self.db.get_connection()
        cur = conn.execute(
            "SELECT * FROM usage_ledger WHERE user_id = ? AND period_year_month = ?",
            (user_id, period),
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        with self.db.transaction() as t_conn:
            t_conn.execute(
                """
                INSERT OR IGNORE INTO usage_ledger (
                    id, user_id, period_year_month, resumes_parsed, jobs_analyzed,
                    ai_extractions_count, web_searches_count, applications_assisted, updated_at
                ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?)
                """,
                (str(uuid.uuid4()), user_id, period, now),
            )
        cur = conn.execute(
            "SELECT * FROM usage_ledger WHERE user_id = ? AND period_year_month = ?",
            (user_id, period),
        )
        return dict(cur.fetchone())

    def increment(self, user_id: str, metric: str) -> None:
        allowed = {
            "resumes_parsed",
            "jobs_analyzed",
            "ai_extractions_count",
            "web_searches_count",
            "applications_assisted",
        }
        if metric not in allowed:
            return
        period = _month_period()
        self.get_or_create(user_id)
        now = _now_iso()
        with self.db.transaction() as conn:
            conn.execute(
                f"""
                UPDATE usage_ledger
                SET {metric} = {metric} + 1, updated_at = ?
                WHERE user_id = ? AND period_year_month = ?
                """,
                (now, user_id, period),
            )

    def reserve(self, user_id: str, metric: str, max_allowed: int) -> tuple[bool, int]:
        """Atomically checks and reserves 1 unit of quota for the user.

        Uses an atomic conditional SQL UPDATE with WHERE {metric} < max_allowed.
        Returns:
            (True, new_count) if reservation succeeded.
            (False, current_count) if quota is already reached.
        """
        allowed = {
            "resumes_parsed",
            "jobs_analyzed",
            "ai_extractions_count",
            "web_searches_count",
            "applications_assisted",
        }
        if metric not in allowed:
            return True, 0

        period = _month_period()
        self.get_or_create(user_id)
        now = _now_iso()

        with self.db.transaction() as conn:
            cur = conn.execute(
                f"""
                UPDATE usage_ledger
                SET {metric} = {metric} + 1, updated_at = ?
                WHERE user_id = ? AND period_year_month = ? AND {metric} < ?
                """,
                (now, user_id, period, max_allowed),
            )
            if cur.rowcount > 0:
                cur2 = conn.execute(
                    f"SELECT {metric} FROM usage_ledger WHERE user_id = ? AND period_year_month = ?",
                    (user_id, period),
                )
                return True, cur2.fetchone()[0]

            # Quota reached; fetch current count
            cur2 = conn.execute(
                f"SELECT {metric} FROM usage_ledger WHERE user_id = ? AND period_year_month = ?",
                (user_id, period),
            )
            current = cur2.fetchone()[0]
            return False, current

    def release(self, user_id: str, metric: str) -> None:
        """Atomically releases / refunds 1 unit of previously reserved quota if an operation failed before consuming resources."""
        allowed = {
            "resumes_parsed",
            "jobs_analyzed",
            "ai_extractions_count",
            "web_searches_count",
            "applications_assisted",
        }
        if metric not in allowed:
            return

        period = _month_period()
        now = _now_iso()
        with self.db.transaction() as conn:
            conn.execute(
                f"""
                UPDATE usage_ledger
                SET {metric} = MAX(0, {metric} - 1), updated_at = ?
                WHERE user_id = ? AND period_year_month = ?
                """,
                (now, user_id, period),
            )


class ResumeRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def save(
        self,
        user_id: str,
        filename: str,
        file_size_bytes: int,
        content_type: str = "application/pdf",
        sha256_hash: str = "",
        parsed_data: dict[str, Any] | None = None,
        ocr_required: bool = False,
        storage_path: str = "",
        resume_id: str | None = None,
    ) -> dict[str, Any]:
        res_id = resume_id or str(uuid.uuid4())
        now = _now_iso()
        parsed_json = json.dumps(parsed_data or {})
        storage_key = storage_path or f"resumes/{user_id}/{res_id}.pdf"
        parse_status = "ocr_required" if ocr_required else "parsed"
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO candidate_resumes (
                    id, user_id, file_name, file_size_bytes, storage_key,
                    structured_data_json, parse_status, is_active, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    res_id,
                    user_id,
                    filename,
                    file_size_bytes,
                    storage_key,
                    parsed_json,
                    parse_status,
                    now,
                ),
            )
        return {
            "id": res_id,
            "filename": filename,
            "file_size_bytes": file_size_bytes,
            "storage_key": storage_key,
            "ocr_required": ocr_required,
            "created_at": now,
        }

    def get_latest(self, user_id: str) -> dict[str, Any] | None:
        conn = self.db.get_connection()
        cur = conn.execute(
            "SELECT * FROM candidate_resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["filename"] = d.get("file_name", "")
        d["parsed_data"] = json.loads(d.get("structured_data_json") or "{}")
        d["ocr_required"] = d.get("parse_status") == "ocr_required"
        return d


class SubscriptionRepository:
    def __init__(self, manager: DatabaseManager = db_manager) -> None:
        self.db = manager

    def get_by_user(self, user_id: str) -> dict[str, Any] | None:
        conn = self.db.get_connection()
        cur = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def get_by_stripe_customer_id(self, stripe_customer_id: str) -> dict[str, Any] | None:
        """Finds subscription by Stripe customer ID."""
        if not stripe_customer_id or not stripe_customer_id.strip():
            return None
        conn = self.db.get_connection()
        cur = conn.execute(
            "SELECT * FROM subscriptions WHERE stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1",
            (stripe_customer_id.strip(),),
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def is_event_processed(self, event_id: str) -> bool:
        if not event_id:
            return False
        conn = self.db.get_connection()
        cur = conn.execute("SELECT 1 FROM processed_stripe_events WHERE event_id = ?", (event_id,))
        return cur.fetchone() is not None

    def record_processed_event(self, event_id: str, event_type: str) -> bool:
        """Returns True if the event was newly recorded, False if it was already processed."""
        if not event_id:
            return False
        if self.is_event_processed(event_id):
            return False
        now = _now_iso()
        try:
            with self.db.transaction() as conn:
                conn.execute(
                    "INSERT INTO processed_stripe_events (event_id, event_type, processed_at) VALUES (?, ?, ?)",
                    (event_id, event_type, now),
                )
            return True
        except Exception:
            return False

    def upsert(
        self,
        user_id: str,
        plan_tier: str,
        status: str = "active",
        stripe_customer_id: str | None = None,
        stripe_subscription_id: str | None = None,
        current_period_end: str | None = None,
    ) -> dict[str, Any]:
        existing = self.get_by_user(user_id)
        now = _now_iso()
        sub_id = existing["id"] if existing else str(uuid.uuid4())
        cust_id = stripe_customer_id if (stripe_customer_id and stripe_customer_id.strip()) else None
        sub_id_val = stripe_subscription_id if (stripe_subscription_id and stripe_subscription_id.strip()) else None

        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO subscriptions (
                    id, user_id, stripe_customer_id, stripe_subscription_id,
                    tier, status, current_period_end, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
                    stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
                    tier = excluded.tier,
                    status = excluded.status,
                    current_period_end = excluded.current_period_end,
                    updated_at = excluded.updated_at
                """,
                (
                    sub_id,
                    user_id,
                    cust_id,
                    sub_id_val,
                    plan_tier,
                    status,
                    current_period_end,
                    now,
                    now,
                ),
            )
        return self.get_by_user(user_id) or {}


# Global repository instances
user_repo = UserRepository()
profile_repo = ProfileRepository()
job_repo = JobRepository()
draft_repo = DraftRepository()
attempt_repo = AttemptRepository()
usage_repo = UsageRepository()
resume_repo = ResumeRepository()
subscription_repo = SubscriptionRepository()

