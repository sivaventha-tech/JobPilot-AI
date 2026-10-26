"""Verification tests for the SaaS architecture review findings.
"""

import time
import pytest
import httpx
from fastapi import HTTPException
from app.services.auth_service import create_access_token, verify_access_token
from app.services.extractor import is_safe_public_url, fetch_public_job_webpage
from app.db.connection import DatabaseManager
from app.db.repository import SubscriptionRepository, UsageRepository, UserRepository
from app.schemas import BillingUsageResponse


def test_auth_token_expiration_and_tampering():
    user_id = "test-usr-123"
    email = "audit@example.com"

    # 1. Valid token
    token = create_access_token(user_id, email, expires_delta_seconds=60, secret_key="audit-secret")
    payload = verify_access_token(token, secret_key="audit-secret")
    assert payload["sub"] == user_id
    assert payload["email"] == email

    # 2. Expired token
    expired_token = create_access_token(user_id, email, expires_delta_seconds=-10, secret_key="audit-secret")
    with pytest.raises(ValueError, match="expired"):
        verify_access_token(expired_token, secret_key="audit-secret")

    # 3. Tampered signature
    parts = token.split(".")
    tampered = f"{parts[0]}.{parts[1]}.tampered_signature"
    with pytest.raises(ValueError, match="signature"):
        verify_access_token(tampered, secret_key="audit-secret")

    # 4. Wrong secret
    with pytest.raises(ValueError, match="signature"):
        verify_access_token(token, secret_key="wrong-secret")


def test_ssrf_validation_reproduction():
    # Loopback targets
    assert not is_safe_public_url("http://127.0.0.1:8000")[0]
    assert not is_safe_public_url("http://localhost:3000")[0]
    assert not is_safe_public_url("http://[::1]:8000")[0]

    # Cloud metadata IP
    assert not is_safe_public_url("http://169.254.169.254/latest/meta-data")[0]

    # Private RFC1918
    assert not is_safe_public_url("http://10.0.0.5")[0]
    assert not is_safe_public_url("http://172.16.1.1")[0]
    assert not is_safe_public_url("http://192.168.1.1")[0]

    # Public valid (mocking public DNS response for deterministic test)
    monkeypatch = pytest.MonkeyPatch()
    import socket
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.190.46", 0))])
    assert is_safe_public_url("https://careers.google.com/jobs")[0]
    monkeypatch.undo()


def test_billing_webhook_requires_signature_remediation():
    """Confirms that stripe_billing_webhook strictly rejects requests with missing or invalid signatures."""
    import json
    import uuid
    from app.main import create_app
    from app.config import BackendSettings
    app = create_app()

    webhook_route = None
    for route in app.routes:
        if getattr(route, "path", None) == "/api/v1/billing/webhook":
            webhook_route = route
            break

    assert webhook_route is not None, "Webhook route exists"

    from app.db.repository import user_repo as global_user_repo, subscription_repo as global_sub_repo

    unique_email = f"victim_{uuid.uuid4().hex[:8]}@example.com"
    user = global_user_repo.create(email=unique_email, password_hash="dummy_hash_123456", full_name="Victim")
    assert global_sub_repo.get_by_user(user["id"])["tier"] == "free"

    fake_payload = {
        "id": f"evt_forged_{uuid.uuid4().hex[:8]}",
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "customer": "cus_forged",
                "id": "sub_forged",
                "status": "active",
                "metadata": {
                    "user_id": user["id"],
                    "plan_tier": "enterprise",
                },
            }
        },
    }
    raw_body = json.dumps(fake_payload).encode("utf-8")
    settings = BackendSettings(stripe_webhook_secret="whsec_test_secret_key_12345")

    # 1. Missing Stripe-Signature header must be rejected with 400
    with pytest.raises(HTTPException) as exc_info:
        webhook_route.endpoint(raw_body=raw_body, stripe_signature=None, settings=settings)
    assert exc_info.value.status_code == 400
    assert "Missing Stripe-Signature header" in str(exc_info.value.detail)

    # User tier must remain free
    assert global_sub_repo.get_by_user(user["id"])["tier"] == "free"

    # Clean up test user
    global_user_repo.delete(user["id"])
