"""Authentication and Cryptographic Security Service for JobPilot AI.

Provides:
1. PBKDF2-HMAC-SHA256 password hashing with random salt & timing-safe verification.
2. Cryptographically signed, tamper-proof bearer tokens with expiration timestamps.
3. Strict payload validation for user registration, login, and tenant context.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

# Default token lifespan: 7 days
DEFAULT_TOKEN_EXPIRY_SECONDS = 7 * 24 * 3600
PBKDF2_ITERATIONS = int(os.getenv("JOBPILOT_PBKDF2_ITERATIONS", "100000"))

def get_jwt_secret() -> str:
    """Resolves the JWT signing secret from environment, failing closed in production if unset or weak.
    Requires JOBPILOT_JWT_SECRET as an independent secret with NO fallback to gateway API keys.
    """
    secret = (os.getenv("JOBPILOT_JWT_SECRET") or "").strip()

    is_production = (
        os.getenv("JOBPILOT_ENVIRONMENT", "").lower() in ("production", "prod")
        or os.getenv("ENVIRONMENT", "").lower() in ("production", "prod")
        or bool(os.getenv("RENDER") or os.getenv("VERCEL"))
    )

    if not secret:
        if is_production:
            raise ValueError(
                "CRITICAL SECURITY CONFIGURATION ERROR: JOBPILOT_JWT_SECRET is not configured in production. "
                "Failing closed to prevent unsigned or forged authentication tokens."
            )
        # Development and local test fallback only (never active in production)
        return "jobpilot-insecure-dev-secret-only-change-in-production-123456789"

    if is_production and len(secret) < 32:
        raise ValueError(
            "CRITICAL SECURITY CONFIGURATION ERROR: JOBPILOT_JWT_SECRET must be at least 32 characters in production."
        )

    return secret


def hash_password(password: str) -> str:
    """Hashes a password using PBKDF2-HMAC-SHA256 with a unique 16-byte salt."""
    if not password or len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    salt_hex = salt.hex()
    key_hex = key.hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt_hex}${key_hex}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    """Verifies a plain password against the stored PBKDF2 hash using timing-safe comparison."""
    if not stored_hash or not plain_password:
        return False
    try:
        parts = stored_hash.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected_key = bytes.fromhex(parts[3])

        computed_key = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt,
            iterations,
        )
        return hmac.compare_digest(computed_key, expected_key)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    padding = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(s + padding)


def create_access_token(
    user_id: str,
    email: str,
    role: str = "user",
    expires_delta_seconds: int = DEFAULT_TOKEN_EXPIRY_SECONDS,
    secret_key: str | None = None,
) -> str:
    """Creates a tamper-proof HMAC-SHA256 signed access token."""
    key = (secret_key or get_jwt_secret()).encode("utf-8")
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user_id,
        "email": email.lower().strip(),
        "role": role,
        "iat": now,
        "exp": now + expires_delta_seconds,
    }

    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    encoded_header = _b64url_encode(header_bytes)
    encoded_payload = _b64url_encode(payload_bytes)

    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    signature = hmac.new(key, signing_input, hashlib.sha256).digest()
    encoded_sig = _b64url_encode(signature)

    return f"{encoded_header}.{encoded_payload}.{encoded_sig}"


def verify_access_token(token: str, secret_key: str | None = None) -> dict[str, Any]:
    """Decodes and validates the signature and expiration of an access token.

    Raises:
        ValueError if the token is malformed, signature is invalid, or expired.
    """
    if not token or not token.strip():
        raise ValueError("Missing access token.")

    parts = token.strip().split(".")
    if len(parts) != 3:
        raise ValueError("Malformed access token structure.")

    encoded_header, encoded_payload, encoded_sig = parts

    # 1. Decode and strictly validate JWT algorithm and header
    try:
        header_bytes = _b64url_decode(encoded_header)
        header = json.loads(header_bytes.decode("utf-8"))
        if not isinstance(header, dict):
            raise ValueError("JWT header must be a JSON object.")
    except Exception as exc:
        raise ValueError(f"Malformed JWT header encoding: {exc}") from exc

    if header.get("alg") != "HS256":
        raise ValueError(f"Unsupported algorithm '{header.get('alg')}'. Only HS256 is accepted.")

    if header.get("typ") not in ("JWT", None):
        raise ValueError(f"Unsupported token type '{header.get('typ')}'.")

    # 2. Cryptographic signature verification using HMAC-SHA256
    key = (secret_key or get_jwt_secret()).encode("utf-8")
    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")

    expected_sig = hmac.new(key, signing_input, hashlib.sha256).digest()
    actual_sig = _b64url_decode(encoded_sig)

    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid token signature.")

    try:
        payload_bytes = _b64url_decode(encoded_payload)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception as exc:
        raise ValueError("Invalid token payload encoding.") from exc

    exp = payload.get("exp")
    if exp is None or int(exp) < int(time.time()):
        raise ValueError("Access token has expired.")

    if not payload.get("sub"):
        raise ValueError("Token missing user subject.")

    return payload
