"""Comprehensive Regression Tests for JobPilot AI Security Remediation.

Covers:
- BILL-01: Stripe Webhook Cryptographic Verification & Deduplication
- BILL-02: Server-Side Quota Enforcement (Free vs Pro)
- SSRF-01 / SSRF-02: Redirect Protection, Private IP/Metadata Blocking, IPv6 Mappings
- AUTH-01 / AUTH-02: Strict JWT Alg Validation & Production Secret Requirements
- PRIV-01: Tenant Resume Storage Isolation, Path Traversal Defense, GDPR Cleanup
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
import pytest
from starlette.requests import Request
from fastapi import HTTPException

from app.main import create_app
from app.services.auth_service import (
    create_access_token,
    verify_access_token,
    get_jwt_secret,
)
from app.services.extractor import is_safe_public_url, fetch_public_job_webpage
from app.services.stripe_service import (
    verify_stripe_webhook_signature,
    compute_stripe_test_signature,
)
from app.services.storage import (
    save_resume_file,
    get_resume_file,
    delete_user_resumes,
    get_user_resumes_dir,
)
from app.db.repository import (
    user_repo,
    subscription_repo,
    usage_repo,
    resume_repo,
)


# =============================================================================
# 1. BILL-01: Stripe Webhook Cryptographic Signature & Deduplication
# =============================================================================

def test_stripe_webhook_missing_signature_rejected():
    app = create_app()
    webhook_route = next(r for r in app.routes if getattr(r, "path", None) == "/api/v1/billing/webhook")

    payload = {"id": "evt_test_1", "type": "customer.subscription.created"}
    raw_body = json.dumps(payload).encode("utf-8")

    from app.config import BackendSettings
    settings = BackendSettings(stripe_webhook_secret="whsec_test_secret_123")

    with pytest.raises(HTTPException) as exc:
        webhook_route.endpoint(raw_body=raw_body, stripe_signature=None, settings=settings)
    assert exc.value.status_code == 400
    assert "Missing Stripe-Signature" in str(exc.value.detail)


def test_stripe_webhook_forged_signature_rejected():
    app = create_app()
    webhook_route = next(r for r in app.routes if getattr(r, "path", None) == "/api/v1/billing/webhook")

    payload = {"id": "evt_test_2", "type": "customer.subscription.created"}
    raw_body = json.dumps(payload).encode("utf-8")

    from app.config import BackendSettings
    settings = BackendSettings(stripe_webhook_secret="whsec_test_secret_123")

    forged_sig = f"t={int(time.time())},v1=deadbeefcafebabe00112233445566778899aabbccddeeff"
    with pytest.raises(HTTPException) as exc:
        webhook_route.endpoint(raw_body=raw_body, stripe_signature=forged_sig, settings=settings)
    assert exc.value.status_code == 400
    assert "Invalid Stripe-Signature" in str(exc.value.detail)


def test_stripe_webhook_expired_timestamp_rejected():
    secret = "whsec_test_secret_key_12345"
    payload = {"id": "evt_test_3", "type": "customer.subscription.created"}
    raw_body = json.dumps(payload).encode("utf-8")

    # Timestamp 600s in the past (tolerance is 300s)
    old_ts = int(time.time()) - 600
    signed_payload = f"{old_ts}.".encode("utf-8") + raw_body
    sig = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    header = f"t={old_ts},v1={sig}"

    from app.services.stripe_service import StripeSignatureVerificationError
    with pytest.raises(StripeSignatureVerificationError, match="outside tolerance"):
        verify_stripe_webhook_signature(raw_body, header, secret)


def test_stripe_webhook_valid_signature_and_deduplication():
    import uuid
    secret = "whsec_production_ready_secret_888"
    os.environ["STRIPE_WEBHOOK_SECRET"] = secret

    app = create_app()
    webhook_route = next(r for r in app.routes if getattr(r, "path", None) == "/api/v1/billing/webhook")

    from app.config import BackendSettings
    settings = BackendSettings(stripe_webhook_secret=secret)

    # Create test tenant
    unique_email = f"stripe_tenant_{uuid.uuid4().hex[:8]}@example.com"
    user = user_repo.create(
        email=unique_email,
        password_hash="pwd_hash_sample_123",
        full_name="Stripe Tenant",
    )
    user_id = user["id"]

    event_id = f"evt_valid_{int(time.time())}"
    payload = {
        "id": event_id,
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "id": "sub_live_123",
                "customer": "cus_live_abc",
                "status": "active",
                "metadata": {
                    "user_id": user_id,
                    "plan_tier": "pro",
                },
            }
        },
    }
    raw_body = json.dumps(payload).encode("utf-8")
    sig_header = compute_stripe_test_signature(raw_body, secret)

    # 1. First invocation: Successfully processes event and updates tier
    res_first = webhook_route.endpoint(raw_body=raw_body, stripe_signature=sig_header, settings=settings)
    assert res_first["status"] == "processed"
    assert res_first["event"] == "customer.subscription.created"

    sub = subscription_repo.get_by_user(user_id)
    assert sub["tier"] == "pro"
    assert sub["status"] == "active"

    # 2. Duplicate invocation with same event_id: Ignored idempotently
    res_dup = webhook_route.endpoint(raw_body=raw_body, stripe_signature=sig_header, settings=settings)
    assert res_dup["status"] == "duplicate_ignored"

    # 3. Cancellation event: Downgrades tier
    cancel_event_id = f"evt_cancel_{int(time.time())}"
    cancel_payload = {
        "id": cancel_event_id,
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "id": "sub_live_123",
                "customer": "cus_live_abc",
                "status": "canceled",
                "metadata": {"user_id": user_id},
            }
        },
    }
    raw_cancel = json.dumps(cancel_payload).encode("utf-8")
    cancel_sig = compute_stripe_test_signature(raw_cancel, secret)

    res_cancel = webhook_route.endpoint(raw_body=raw_cancel, stripe_signature=cancel_sig, settings=settings)
    assert res_cancel["status"] == "processed"
    assert subscription_repo.get_by_user(user_id)["tier"] == "free"

    # Cleanup
    user_repo.delete(user_id)


# =============================================================================
# 2. SSRF-01 / SSRF-02: SSRF & Redirect Protection
# =============================================================================

def test_ssrf_blocks_all_private_and_metadata_destinations():
    unsafe_targets = [
        "http://127.0.0.1:8000",
        "http://127.0.0.1/admin",
        "http://localhost:3000",
        "http://10.0.0.1",
        "http://10.255.255.255",
        "http://172.16.0.1",
        "http://172.31.255.255",
        "http://192.168.1.1",
        "http://169.254.169.254/latest/meta-data/",
        "http://100.100.100.200/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://[::1]:8000",
        "http://[::ffff:127.0.0.1]:8000",
        "http://[::ffff:169.254.169.254]",
        "http://service.local",
        "http://internal.lan",
    ]
    for target in unsafe_targets:
        safe, reason = is_safe_public_url(target)
        assert not safe, f"Target '{target}' must be rejected but was allowed. Reason: {reason}"


def test_ssrf_redirect_to_private_ip_is_blocked(monkeypatch):
    """Simulates an external HTTP redirect pointing to a private IPv4 address."""
    import httpx
    import socket

    # Mock DNS resolution for initial public host
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))])

    # Create dummy client with response that redirects to 127.0.0.1
    class MockRedirectResponse:
        status_code = 302
        headers = httpx.Headers({"Location": "http://127.0.0.1:8000/sensitive-data"})
        is_redirect = True

    class MockHttpxClient:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, url, **kwargs):
            return MockRedirectResponse()
        def close(self):
            pass

    monkeypatch.setattr(httpx, "Client", MockHttpxClient)

    # Calling fetch_public_job_webpage on safe starting URL must catch the malicious redirect
    extracted, error_reason = fetch_public_job_webpage("https://public-job-board.example.com/job/123", timeout_seconds=5)
    assert extracted is None
    assert "Redirect destination blocked by SSRF policy" in error_reason


# =============================================================================
# 3. BILL-02: Server-Side Quota Enforcement
# =============================================================================

def test_server_side_quota_enforcement():
    import uuid
    from app.main import check_and_enforce_user_quota

    unique_email = f"quota_test_{uuid.uuid4().hex[:8]}@example.com"
    user = user_repo.create(
        email=unique_email,
        password_hash="pwd_hash_test_456",
        full_name="Quota Tester",
    )
    user_id = user["id"]

    try:
        # Default tier is Free (max 5 resumes, 20 jobs, 10 assists)
        # Increment to quota limit
        for _ in range(5):
            usage_repo.increment(user_id, "resumes_parsed")

        # 6th parse attempt must trigger 402 Payment Required
        with pytest.raises(HTTPException) as exc:
            check_and_enforce_user_quota(user_id, "resumes_parsed")
        assert exc.value.status_code == 402
        assert "quota" in str(exc.value.detail).lower()
        assert "reached" in str(exc.value.detail).lower()

        # Upgrade user to Pro (max 100 resumes)
        subscription_repo.upsert(user_id, plan_tier="pro", status="active")

        # Now check_and_enforce_user_quota must pass because Pro has higher limit
        check_and_enforce_user_quota(user_id, "resumes_parsed")

    finally:
        user_repo.delete(user_id)


# =============================================================================
# 4. AUTH-01 / AUTH-02: Strict JWT Alg Validation & Secret Requirements
# =============================================================================

def test_jwt_algorithm_confusion_rejected():
    user_id = "tenant-safe-1"
    email = "safe@example.com"
    secret = "production-grade-super-secret-key-32-chars-minimum"

    # Valid token
    valid_token = create_access_token(user_id, email, secret_key=secret)
    claims = verify_access_token(valid_token, secret_key=secret)
    assert claims["sub"] == user_id

    # Forged 'none' algorithm token
    header_none = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({"sub": user_id, "email": email, "exp": int(time.time()) + 3600}).encode()).decode().rstrip("=")
    none_token = f"{header_none}.{payload}."

    with pytest.raises(ValueError, match="Unsupported algorithm"):
        verify_access_token(none_token, secret_key=secret)

    # Forged 'RS256' algorithm token
    header_rs256 = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    rs_token = f"{header_rs256}.{payload}.invalidsignature"

    with pytest.raises(ValueError, match="Unsupported algorithm"):
        verify_access_token(rs_token, secret_key=secret)


def test_production_jwt_secret_fails_closed_when_weak(monkeypatch):
    # Set production mode
    monkeypatch.setenv("JOBPILOT_ENVIRONMENT", "production")
    monkeypatch.setenv("JOBPILOT_JWT_SECRET", "short_secret")

    with pytest.raises(ValueError, match="at least 32 characters"):
        get_jwt_secret()

    monkeypatch.delenv("JOBPILOT_JWT_SECRET", raising=False)
    with pytest.raises(ValueError, match="JOBPILOT_JWT_SECRET is not configured"):
        get_jwt_secret()


# =============================================================================
# 5. PRIV-01: Tenant Resume Storage Isolation & Cleanup
# =============================================================================

def test_resume_storage_isolation_and_gdpr_cleanup():
    user_id = "tenant_gdpr_1"
    resume_id = "res_doc_99"
    pdf_sample = b"%PDF-1.7\nSample resume content for storage isolation test\n%%EOF"

    # 1. Save resume to isolated directory
    storage_key = save_resume_file(user_id, resume_id, pdf_sample)
    assert storage_key == f"resumes/{user_id}/{resume_id}.pdf"

    # 2. Retrieve resume bytes
    retrieved = get_resume_file(user_id, resume_id)
    assert retrieved == pdf_sample

    # 3. Path traversal attempts are blocked
    with pytest.raises(ValueError, match="Invalid user_id"):
        save_resume_file("../evil_user", resume_id, pdf_sample)

    with pytest.raises(ValueError, match="Invalid resume_id"):
        save_resume_file(user_id, "../../etc/passwd", pdf_sample)

    # 4. Cleanup on account deletion
    deleted_count = delete_user_resumes(user_id)
    assert deleted_count >= 1
    assert get_resume_file(user_id, resume_id) is None


# =============================================================================
# 6. Final Hardening: SSRF DNS Fail-Closed & Rebinding TOCTOU Defense
# =============================================================================

def test_ssrf_dns_failure_fails_closed(monkeypatch):
    """Ensures unresolvable hostnames fail closed and are rejected as unsafe."""
    import socket

    def mock_getaddrinfo(host, port):
        raise socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)
    safe, reason = is_safe_public_url("https://unresolvable-bogus-domain-999.org/job")
    assert safe is False
    assert "DNS resolution failed" in reason


def test_ssrf_dns_rebinding_toctou_defense(monkeypatch):
    """Confirms SSRFSafeNetworkBackend blocks connection-time DNS rebinding to private IPs."""
    import socket
    import httpcore
    from app.services.extractor import SSRFSafeNetworkBackend

    backend = SSRFSafeNetworkBackend()

    # Even if initial validation passed, if socket establishment resolves to private IP, it blocks
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))])
    with pytest.raises(httpcore.ConnectError, match="SSRF policy blocked connection"):
        backend.connect_tcp("rebound-evil-domain.com", 80)


# =============================================================================
# 7. Final Hardening: Concurrency Race-Condition Quota Defense
# =============================================================================

def test_concurrent_quota_reservation_race_prevention():
    """Confirms atomic UPDATE ... WHERE condition prevents over-allocation under concurrent bursts."""
    from concurrent.futures import ThreadPoolExecutor
    import uuid

    uid = uuid.uuid4().hex[:8]
    user = user_repo.create(f"concurrent_user_{uid}@example.com", "hash", "Concurrent User")
    user_id = user["id"]
    metric = "jobs_analyzed"
    max_allowed = 1  # Exactly 1 slot available

    # 10 concurrent requests competing for 1 quota slot
    def attempt_reservation():
        reserved, count = usage_repo.reserve(user_id, metric, max_allowed)
        return reserved

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(lambda _: attempt_reservation(), range(10)))

    # Exactly 1 thread must succeed, and 9 must fail
    successes = [r for r in results if r is True]
    failures = [r for r in results if r is False]
    assert len(successes) == 1
    assert len(failures) == 9

    # Verify final usage counter in database is exactly 1
    usage = usage_repo.get_or_create(user_id)
    assert usage[metric] == 1

    # Verify release (refund) on failure works
    usage_repo.release(user_id, metric)
    usage_after_release = usage_repo.get_or_create(user_id)
    assert usage_after_release[metric] == 0


# =============================================================================
# 8. Final Hardening: Gateway Key vs User JWT Isolation
# =============================================================================

def test_gateway_key_cannot_sign_or_authenticate_user(monkeypatch):
    """Proves the server-to-server gateway key cannot be used to forge or sign valid user tokens."""
    monkeypatch.setenv("JOBPILOT_ENVIRONMENT", "production")
    monkeypatch.setenv("JOBPILOT_JWT_SECRET", "user-jwt-secret-min-32-chars-long-abc")
    monkeypatch.setenv("FASTAPI_API_KEY", "gateway-api-key-min-32-chars-long-xyz")

    # Token signed with gateway key
    forged_with_gateway = create_access_token(
        user_id="fake-admin",
        email="fake@example.com",
        secret_key="gateway-api-key-min-32-chars-long-xyz",
    )

    # Verifying against production user JWT secret must fail
    with pytest.raises(ValueError, match="Invalid token signature"):
        verify_access_token(forged_with_gateway)

    # In production, if JOBPILOT_JWT_SECRET is missing, it must fail closed and NOT fall back to FASTAPI_API_KEY
    monkeypatch.delenv("JOBPILOT_JWT_SECRET", raising=False)
    with pytest.raises(ValueError, match="JOBPILOT_JWT_SECRET is not configured"):
        get_jwt_secret()


# =============================================================================
# 9. Final Hardening: User Storage Quota & Orphaned File Cleanup
# =============================================================================

def test_user_storage_quota_enforcement_and_cleanup(monkeypatch, tmp_path):
    """Enforces aggregate per-user storage quota and verifies atomic cleanup on failure."""
    from app.services.storage import (
        save_resume_file,
        get_user_storage_bytes,
        delete_resume_file,
        StorageQuotaExceededError,
    )

    monkeypatch.setenv("JOBPILOT_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("JOBPILOT_MAX_USER_STORAGE_BYTES", "1024")  # 1 KB limit

    user_id = "quota_storage_user_1"
    pdf_500_bytes = b"A" * 500
    pdf_600_bytes = b"B" * 600

    # 1. First 500-byte upload succeeds
    key1 = save_resume_file(user_id, "doc1", pdf_500_bytes)
    assert get_user_storage_bytes(user_id) == 500

    # 2. Second 600-byte upload pushes user past 1024 bytes -> must raise StorageQuotaExceededError
    with pytest.raises(StorageQuotaExceededError, match="Storage quota exceeded"):
        save_resume_file(user_id, "doc2", pdf_600_bytes)

    # 3. Disk consumption must remain 500 bytes and orphaned second file must not exist
    assert get_user_storage_bytes(user_id) == 500
    doc2_path = tmp_path / "storage" / "resumes" / user_id / "doc2.pdf"
    assert not doc2_path.exists()

    # 4. Clean up first file
    delete_resume_file(key1)
    assert get_user_storage_bytes(user_id) == 0


# =============================================================================
# 10. Final Hardening: ACID-Safe Backup & Restore Verification
# =============================================================================

def test_backup_creation_verification_and_restore(tmp_path):
    """Verifies live SQLite snapshot backup, checksum verification, and clean restore."""
    from app.services.backup import create_backup, verify_backup, restore_backup
    import uuid

    # Create test user and record
    uid = uuid.uuid4().hex[:8]
    test_user = user_repo.create(f"backup_test_{uid}@example.com", "hash", "Backup Test")

    # 1. Create live snapshot backup
    backup_tar = create_backup(dest_dir=str(tmp_path / "backups"))
    assert Path(backup_tar).is_file()

    # 2. Verify backup manifest and checksum integrity
    report = verify_backup(backup_tar)
    assert report["valid"] is True
    assert report["integrity"] == "ok"
    assert "db_sha256" in report["manifest"]

    # 3. Restore backup to test targets
    restore_target_db = tmp_path / "restored_data" / "restored.db"
    restore_target_storage = tmp_path / "restored_data" / "storage"
    restore_result = restore_backup(
        archive_path=backup_tar,
        target_db_path=str(restore_target_db),
        target_storage_dir=str(restore_target_storage),
    )
    restored_db = restore_result["database_path"]
    assert Path(restored_db).is_file()

    # 4. Verify data in restored database
    import sqlite3
    conn = sqlite3.connect(restored_db)
    cursor = conn.cursor()
    cursor.execute("SELECT email FROM users WHERE id = ?", (test_user["id"],))
    row = cursor.fetchone()
    conn.close()
    assert row is not None
    assert row[0] == f"backup_test_{uid}@example.com"


# =============================================================================
# 11. Final Hardening: Stripe Webhook 3-Tier Customer Mapping & Past-Due Handling
# =============================================================================

def test_stripe_webhook_multitiered_customer_resolution_and_payment_failure():
    """Verifies webhook resolves users via customer_id/email when metadata is absent,
    and downgrades users to free/past_due on invoice payment failures.
    """
    app = create_app()
    webhook_route = next(r for r in app.routes if getattr(r, "path", None) == "/api/v1/billing/webhook")

    from app.config import BackendSettings
    secret = "whsec_test_secret_key_12345"
    settings = BackendSettings(stripe_webhook_secret=secret)

    # Create test user
    import uuid
    uid = uuid.uuid4().hex[:8]
    email = f"stripe_multi_{uid}@example.com"
    user = user_repo.create(email=email, password_hash="hash", full_name="Stripe Tester")
    user_id = user["id"]

    cust_id = f"cus_{uid}"
    sub_id = f"sub_{uid}"

    # Associate user with customer id
    subscription_repo.upsert(user_id=user_id, plan_tier="free", status="active", stripe_customer_id=cust_id)

    # 1. Webhook WITHOUT metadata.user_id, but containing stripe customer_id -> upgrades to pro
    event_payload = {
        "id": f"evt_cust_{uid}",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": sub_id,
                "customer": cust_id,
                "status": "active",
                "metadata": {"plan_tier": "pro"},
            }
        },
    }
    raw_body = json.dumps(event_payload).encode("utf-8")
    sig_header = compute_stripe_test_signature(raw_body, secret)
    res = webhook_route.endpoint(raw_body=raw_body, stripe_signature=sig_header, settings=settings)
    assert res["status"] == "processed"
    assert subscription_repo.get_by_user(user_id)["tier"] == "pro"

    # 2. Invoice payment failure -> downgrades plan_tier to free, status past_due
    fail_payload = {
        "id": f"evt_fail_{uid}",
        "type": "invoice.payment_failed",
        "data": {
            "object": {
                "id": f"in_{uid}",
                "customer": cust_id,
                "subscription": sub_id,
                "status": "open",
            }
        },
    }
    raw_fail = json.dumps(fail_payload).encode("utf-8")
    fail_sig = compute_stripe_test_signature(raw_fail, secret)
    res_fail = webhook_route.endpoint(raw_body=raw_fail, stripe_signature=fail_sig, settings=settings)
    assert res_fail["status"] == "processed"
    sub_after_fail = subscription_repo.get_by_user(user_id)
    assert sub_after_fail["tier"] == "free"
    assert sub_after_fail["status"] == "past_due"
