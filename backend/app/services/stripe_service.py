"""Stripe Webhook Signature Verification and Event Processing Service."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any


class StripeSignatureVerificationError(ValueError):
    """Raised when Stripe signature header is missing, malformed, expired, or invalid."""

    pass


def verify_stripe_webhook_signature(
    raw_payload: bytes,
    signature_header: str | None,
    secret: str,
    tolerance_seconds: int = 300,
) -> dict[str, Any]:
    """Validates Stripe-Signature header against the raw request body.

    Follows Stripe's official specification:
    Header format: t=timestamp,v1=signature[,v1=signature2,...]
    Signed payload: {timestamp}.{raw_payload}
    Signature: HMAC-SHA256(secret, signed_payload)
    """
    if not secret or not secret.strip():
        raise StripeSignatureVerificationError("Stripe webhook secret is not configured on the server.")

    if not signature_header or not signature_header.strip():
        raise StripeSignatureVerificationError("Missing Stripe-Signature header.")

    # Parse header items
    timestamp: int | None = None
    signatures: list[str] = []

    for item in signature_header.split(","):
        parts = item.strip().split("=", 1)
        if len(parts) == 2:
            key, val = parts[0].strip(), parts[1].strip()
            if key == "t":
                try:
                    timestamp = int(val)
                except ValueError:
                    pass
            elif key == "v1":
                signatures.append(val)

    if timestamp is None:
        raise StripeSignatureVerificationError("Invalid Stripe-Signature header: missing timestamp.")

    if not signatures:
        raise StripeSignatureVerificationError("Invalid Stripe-Signature header: missing v1 signature.")

    # Check timestamp tolerance (prevent replay attacks)
    now = int(time.time())
    if abs(now - timestamp) > tolerance_seconds:
        raise StripeSignatureVerificationError(
            f"Stripe webhook timestamp is outside tolerance ({tolerance_seconds}s)."
        )

    # Compute expected signature
    signed_payload = f"{timestamp}.".encode("utf-8") + raw_payload
    expected_sig = hmac.new(
        secret.strip().encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    # Timing-safe comparison against any matching v1 signature
    matches = any(hmac.compare_digest(expected_sig, s) for s in signatures)
    if not matches:
        raise StripeSignatureVerificationError("Invalid Stripe-Signature: signature mismatch.")

    try:
        event = json.loads(raw_payload.decode("utf-8"))
        if not isinstance(event, dict):
            raise StripeSignatureVerificationError("Malformed JSON webhook payload.")
        return event
    except Exception as exc:
        raise StripeSignatureVerificationError(f"Failed to parse webhook JSON: {exc}") from exc


def compute_stripe_test_signature(
    raw_payload: bytes,
    secret: str,
    timestamp: int | None = None,
) -> str:
    """Computes a valid Stripe-Signature header string for testing."""
    ts = timestamp if timestamp is not None else int(time.time())
    signed_payload = f"{ts}.".encode("utf-8") + raw_payload
    sig = hmac.new(
        secret.strip().encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    return f"t={ts},v1={sig}"

