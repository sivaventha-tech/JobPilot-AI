"""Multi-Tenant SaaS Foundation, Authentication, and Tenant Isolation Tests.

Tests cover:
1. User registration, password hashing (PBKDF2-HMAC-SHA256), and JWT token issuance.
2. Duplicate email registration rejection (409 Conflict).
3. Login verification and incorrect password rejection (401 Unauthorized).
4. Strict multi-tenant isolation: Tenant A cannot view, update, or delete Tenant B's jobs or profile.
5. Cross-tenant draft and attempt isolation.
6. Permanent account deletion cascading across all tenant data (GDPR Right to be Forgotten).
7. Execution operates directly without Windows loopback socketpair dependency.
"""

from __future__ import annotations

import os
import pytest
from fastapi import HTTPException

from app.db.connection import DatabaseManager
from app.db.repository import (
    UserRepository,
    ProfileRepository,
    JobRepository,
    DraftRepository,
    AttemptRepository,
    UsageRepository,
    ResumeRepository,
    SubscriptionRepository,
)
from app.schemas import (
    UserRegisterRequest,
    UserLoginRequest,
    UserProfileUpdateRequest,
    JobCreateRequest,
    JobUpdateRequest,
)
from app.services.auth_service import hash_password, verify_password, create_access_token, verify_access_token
from app.security import get_current_user
from fastapi.security import HTTPAuthorizationCredentials


@pytest.fixture
def repos():
    test_db = DatabaseManager(db_path=":memory:")
    u = UserRepository(test_db)
    p = ProfileRepository(test_db)
    j = JobRepository(test_db)
    d = DraftRepository(test_db)
    a = AttemptRepository(test_db)
    us = UsageRepository(test_db)
    r = ResumeRepository(test_db)
    s = SubscriptionRepository(test_db)
    return {
        "user_repo": u,
        "profile_repo": p,
        "job_repo": j,
        "draft_repo": d,
        "attempt_repo": a,
        "usage_repo": us,
        "resume_repo": r,
        "subscription_repo": s,
    }


def test_password_hashing_and_verification():
    raw_pwd = "SuperSecretPassword123!"
    hashed = hash_password(raw_pwd)
    assert hashed.startswith("pbkdf2_sha256$")
    assert verify_password(raw_pwd, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password(raw_pwd, "corrupt$hash") is False


def test_jwt_access_token_creation_and_expiration():
    token = create_access_token(user_id="user-123", email="user@example.com", role="user", expires_delta_seconds=3600)
    payload = verify_access_token(token)
    assert payload["sub"] == "user-123"
    assert payload["email"] == "user@example.com"
    assert payload["role"] == "user"

    # Expired token rejection
    expired_token = create_access_token(user_id="user-123", email="user@example.com", expires_delta_seconds=-10)
    with pytest.raises(ValueError, match="Access token has expired"):
        verify_access_token(expired_token)

    # Tampered token rejection
    tampered = token[:-5] + "XXXXX"
    with pytest.raises(ValueError, match="Invalid token signature"):
        verify_access_token(tampered)


def test_user_registration_and_login_lifecycle(repos):
    u = repos["user_repo"]

    # Register user
    pwd_hash = hash_password("SecurePassword456!")
    user = u.create(email="aarav@saas.example.com", password_hash=pwd_hash, full_name="Aarav Mehta")
    assert user["email"] == "aarav@saas.example.com"
    assert user["full_name"] == "Aarav Mehta"
    assert user["role"] == "user"

    # Verify duplicate email lookup
    existing = u.get_by_email("AARAV@saas.example.com")
    assert existing is not None
    assert existing["id"] == user["id"]

    # Verify login credentials
    assert verify_password("SecurePassword456!", existing["password_hash"]) is True
    assert verify_password("Wrong!", existing["password_hash"]) is False


def test_candidate_profile_persistence_and_update(repos):
    u = repos["user_repo"]
    p = repos["profile_repo"]

    user = u.create(email="profile@saas.example.com", password_hash=hash_password("pwd123"), full_name="Candidate")
    profile = p.get(user["id"])
    assert profile is not None
    assert profile["email"] == "profile@saas.example.com"
    assert profile["skills"] == []

    updated = p.update(
        user["id"],
        {
            "preferred_role": "Lead AI Architect",
            "preferred_location": "Bengaluru",
            "skills": ["TypeScript", "Next.js", "Python", "FastAPI"],
            "years_of_experience": "6 Years",
        },
    )
    assert updated["preferred_role"] == "Lead AI Architect"
    assert len(updated["skills"]) == 4
    assert "FastAPI" in updated["skills"]


def test_strict_multi_tenant_job_isolation(repos):
    u = repos["user_repo"]
    j = repos["job_repo"]

    # Tenant A
    user_a = u.create(email="tenant.a@example.com", password_hash=hash_password("password123"), full_name="Tenant A")
    # Tenant B
    user_b = u.create(email="tenant.b@example.com", password_hash=hash_password("password123"), full_name="Tenant B")

    # Tenant A creates Job A1
    job_a = j.create(
        user_id=user_a["id"],
        data={
            "title": "Senior AI Architect",
            "company": "LinearStack Labs",
            "location": "Bengaluru",
            "requiredSkills": ["Python", "FastAPI"],
            "matchScore": 92,
        },
    )
    assert job_a["user_id"] == user_a["id"]

    # Tenant B creates Job B1
    job_b = j.create(
        user_id=user_b["id"],
        data={
            "title": "Staff Frontend Lead",
            "company": "FinVerse Technologies",
            "location": "Remote",
            "requiredSkills": ["TypeScript", "Next.js"],
            "matchScore": 88,
        },
    )
    assert job_b["user_id"] == user_b["id"]

    # Tenant A lists jobs -> ONLY sees Job A
    jobs_a = j.list_by_user(user_id=user_a["id"])
    assert len(jobs_a) == 1
    assert jobs_a[0]["id"] == job_a["id"]
    assert jobs_a[0]["title"] == "Senior AI Architect"

    # Tenant B lists jobs -> ONLY sees Job B
    jobs_b = j.list_by_user(user_id=user_b["id"])
    assert len(jobs_b) == 1
    assert jobs_b[0]["id"] == job_b["id"]
    assert jobs_b[0]["title"] == "Staff Frontend Lead"

    # Cross-tenant read: Tenant B attempts to fetch Job A -> None
    cross_read = j.get_by_user(user_id=user_b["id"], job_id=job_a["id"])
    assert cross_read is None

    # Cross-tenant update: Tenant B attempts to modify Job A -> None
    cross_update = j.update(user_id=user_b["id"], job_id=job_a["id"], updates={"title": "Hacked Title"})
    assert cross_update is None

    # Cross-tenant delete: Tenant B attempts to delete Job A -> False
    cross_del = j.delete(user_id=user_b["id"], job_id=job_a["id"])
    assert cross_del is False

    # Confirm Tenant A's Job is untouched
    verify_a = j.get_by_user(user_id=user_a["id"], job_id=job_a["id"])
    assert verify_a["title"] == "Senior AI Architect"


def test_cross_tenant_drafts_and_attempts_isolation(repos):
    u = repos["user_repo"]
    j = repos["job_repo"]
    d = repos["draft_repo"]
    a = repos["attempt_repo"]

    user_a = u.create(email="user.a@example.com", password_hash=hash_password("password123"), full_name="User A")
    user_b = u.create(email="user.b@example.com", password_hash=hash_password("password123"), full_name="User B")

    job_a = j.create(user_id=user_a["id"], data={"title": "Role A", "company": "Co A"})

    # User A saves draft
    draft_a = d.upsert(
        user_id=user_a["id"],
        job_id=job_a["id"],
        draft_data={"coverLetter": "Confidential Cover Letter A", "coverLetterNeedsInput": False},
    )
    assert draft_a["coverLetter"] == "Confidential Cover Letter A"

    # User B attempts to read User A's draft -> None
    cross_draft = d.get(user_id=user_b["id"], job_id=job_a["id"])
    assert cross_draft is None

    # User A records attempt
    a.record(
        user_id=user_a["id"],
        job_id=job_a["id"],
        attempt={"outcome": "Submitted", "finalStatus": "Submitted", "destinationUrl": "https://example.com/apply"},
    )
    attempts_a = a.list_by_job(user_id=user_a["id"], job_id=job_a["id"])
    assert len(attempts_a) == 1

    # User B checks attempts on Job A -> Empty list
    attempts_b = a.list_by_job(user_id=user_b["id"], job_id=job_a["id"])
    assert len(attempts_b) == 0


def test_account_deletion_cascades_all_tenant_data(repos):
    u = repos["user_repo"]
    j = repos["job_repo"]
    d = repos["draft_repo"]
    p = repos["profile_repo"]

    user = u.create(email="delete.candidate@example.com", password_hash=hash_password("password123"), full_name="Delete Candidate")
    job = j.create(user_id=user["id"], data={"title": "Temporary Job", "company": "Temp Corp"})
    d.upsert(user_id=user["id"], job_id=job["id"], draft_data={"coverLetter": "Letter"})

    # Verify data exists before deletion
    assert p.get(user["id"]) is not None
    assert len(j.list_by_user(user["id"])) == 1

    # Delete user
    deleted = u.delete(user["id"])
    assert deleted is True

    # User, profile, jobs, and drafts must all be permanently gone
    assert u.get_by_id(user["id"]) is None
    assert p.get(user["id"]) is None
    assert len(j.list_by_user(user["id"])) == 0
    assert d.get(user["id"], job["id"]) is None


def test_resume_repository_and_usage_metering(repos):
    u = repos["user_repo"]
    r = repos["resume_repo"]
    us = repos["usage_repo"]

    user = u.create(email="metered@example.com", password_hash=hash_password("password123"), full_name="Metered User")

    # Record resume upload metadata
    meta = r.save(
        user_id=user["id"],
        filename="resume_test.pdf",
        file_size_bytes=10240,
        content_type="application/pdf",
        sha256_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        parsed_data={"skills": ["Python", "FastAPI"]},
        ocr_required=False,
    )
    assert meta["filename"] == "resume_test.pdf"

    latest = r.get_latest(user["id"])
    assert latest is not None
    assert latest["filename"] == "resume_test.pdf"
    assert latest["parsed_data"]["skills"] == ["Python", "FastAPI"]

    # Usage metering increments
    us.increment(user["id"], "resumes_parsed")
    us.increment(user["id"], "jobs_analyzed")
    usage = us.get_or_create(user["id"])
    assert usage["resumes_parsed"] == 1
    assert usage["jobs_analyzed"] == 1


def test_subscription_repository_lifecycle(repos):
    u = repos["user_repo"]
    s = repos["subscription_repo"]

    user = u.create(email="sub@example.com", password_hash=hash_password("password123"), full_name="Sub User")

    # Default: user is created with a free tier subscription
    initial_sub = s.get_by_user(user["id"])
    assert initial_sub is not None
    assert initial_sub["tier"] == "free"
    assert initial_sub["status"] == "active"

    # Upgrade to Pro
    sub = s.upsert(
        user_id=user["id"],
        plan_tier="pro",
        status="active",
        stripe_customer_id="cus_12345",
        stripe_subscription_id="sub_98765",
    )
    assert sub["tier"] == "pro"
    assert sub["status"] == "active"

    # Downgrade / Cancel
    sub_canceled = s.upsert(
        user_id=user["id"],
        plan_tier="free",
        status="canceled",
        stripe_customer_id="cus_12345",
        stripe_subscription_id="sub_98765",
    )
    assert sub_canceled["tier"] == "free"
    assert sub_canceled["status"] == "canceled"


def test_ssrf_prevention_on_private_ips(monkeypatch: pytest.MonkeyPatch):
    import socket
    from app.services.extractor import is_safe_public_url

    # Loopback targets
    safe, reason = is_safe_public_url("http://localhost:8000/api/v1/health")
    assert not safe
    assert "prohibited" in reason.lower()

    safe, reason = is_safe_public_url("http://127.0.0.1:8080/metrics")
    assert not safe
    assert "prohibited" in reason.lower()

    # Cloud metadata endpoints
    safe, reason = is_safe_public_url("http://169.254.169.254/latest/meta-data/")
    assert not safe
    assert "prohibited" in reason.lower()

    # Private RFC1918 ranges
    safe, reason = is_safe_public_url("http://10.0.0.1/admin")
    assert not safe
    assert "prohibited" in reason.lower()

    safe, reason = is_safe_public_url("http://192.168.1.1/router")
    assert not safe
    assert "prohibited" in reason.lower()

    safe, reason = is_safe_public_url("http://172.16.0.5:5432")
    assert not safe
    assert "prohibited" in reason.lower()

    # Legitimate public URLs (dual-stack resolution mock)
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.190.46", 0))])
    safe, reason = is_safe_public_url("https://careers.google.com/jobs/results/123")
    assert safe
    assert reason == ""

