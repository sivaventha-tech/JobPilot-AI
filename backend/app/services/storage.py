"""Secure Tenant-Isolated Resume Storage Service for JobPilot AI.

Enforces per-tenant directory isolation, strict path traversal validation,
and GDPR-compliant data cleanup on account deletion.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Optional

from app.db.connection import DEFAULT_DB_PATH

SAFE_IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]+$")
DEFAULT_MAX_USER_STORAGE_BYTES = int(os.getenv("JOBPILOT_MAX_USER_STORAGE_BYTES", str(25 * 1024 * 1024)))  # 25 MB default


class StorageQuotaExceededError(ValueError):
    """Raised when tenant's aggregate stored resume bytes exceed their quota."""
    pass


def get_storage_root() -> Path:
    """Returns the base storage directory for uploaded files.

    If JOBPILOT_STORAGE_DIR is set, uses that. Otherwise, defaults to a
    'storage' directory adjacent to the active database path.
    """
    configured = os.getenv("JOBPILOT_STORAGE_DIR")
    if configured:
        root = Path(configured).resolve()
    else:
        db_path = os.getenv("JOBPILOT_DB_PATH", DEFAULT_DB_PATH)
        if db_path == ":memory:" or db_path.startswith("file:"):
            root = Path(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "storage"))).resolve()
        else:
            db_dir = Path(db_path).resolve().parent
            root = (db_dir / "storage").resolve()

    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise PermissionError(
            f"FATAL: Storage directory '{root}' cannot be accessed or created: {exc}. "
            "Ensure persistent storage is mounted with write permissions."
        ) from exc

    if not os.access(root, os.W_OK):
        raise PermissionError(
            f"FATAL: Storage directory '{root}' is not writable by current user. "
            "Ensure persistent storage permissions allow write access for the application user."
        )

    return root


def _validate_identifier(value: str, name: str) -> None:
    if not value or not SAFE_IDENTIFIER_PATTERN.match(value):
        raise ValueError(f"Invalid {name}: must be non-empty and contain only alphanumeric, dash, or underscore characters.")


def get_user_resumes_dir(user_id: str) -> Path:
    """Returns the verified directory path for a tenant's resumes."""
    _validate_identifier(user_id, "user_id")
    root = get_storage_root()
    user_dir = (root / "resumes" / user_id).resolve()

    # Ensure path stays within root
    if not str(user_dir).startswith(str(root)):
        raise ValueError("Invalid storage path: directory traversal detected.")

    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


def get_user_storage_bytes(user_id: str) -> int:
    """Returns the total disk storage in bytes used by a tenant's stored resumes."""
    _validate_identifier(user_id, "user_id")
    root = get_storage_root()
    user_dir = (root / "resumes" / user_id).resolve()
    if not user_dir.exists() or not str(user_dir).startswith(str(root)):
        return 0
    total = 0
    for child in user_dir.iterdir():
        if child.is_file():
            total += child.stat().st_size
    return total


def save_resume_file(
    user_id: str,
    resume_id: str,
    file_bytes: bytes,
    max_user_storage_bytes: int | None = None,
) -> str:
    """Saves a tenant's resume PDF bytes to disk with strict isolation and storage quota enforcement.

    Returns the relative storage key (e.g., 'resumes/<user_id>/<resume_id>.pdf').
    Raises StorageQuotaExceededError if tenant's aggregate disk quota would be exceeded.
    """
    _validate_identifier(user_id, "user_id")
    _validate_identifier(resume_id, "resume_id")

    limit = (
        max_user_storage_bytes
        if max_user_storage_bytes is not None
        else int(os.getenv("JOBPILOT_MAX_USER_STORAGE_BYTES", str(DEFAULT_MAX_USER_STORAGE_BYTES)))
    )
    current_bytes = get_user_storage_bytes(user_id)
    if current_bytes + len(file_bytes) > limit:
        raise StorageQuotaExceededError(
            f"Storage quota exceeded: current usage ({current_bytes} bytes) plus new file "
            f"({len(file_bytes)} bytes) exceeds tenant limit of {limit} bytes."
        )

    user_dir = get_user_resumes_dir(user_id)
    file_path = (user_dir / f"{resume_id}.pdf").resolve()

    # Verify no escape
    if not str(file_path).startswith(str(user_dir)):
        raise ValueError("Invalid file path: path traversal detected.")

    file_path.write_bytes(file_bytes)
    return f"resumes/{user_id}/{resume_id}.pdf"


def delete_resume_file(user_id_or_key: str, resume_id: str | None = None) -> bool:
    """Deletes an individual resume file from disk, e.g. for rolling back a failed transaction."""
    if resume_id is None and user_id_or_key.startswith("resumes/"):
        parts = user_id_or_key.split("/")
        if len(parts) == 3:
            user_id = parts[1]
            resume_id = parts[2].removesuffix(".pdf")
        else:
            return False
    else:
        user_id = user_id_or_key
        if resume_id is None:
            return False

    _validate_identifier(user_id, "user_id")
    _validate_identifier(resume_id, "resume_id")

    user_dir = get_user_resumes_dir(user_id)
    file_path = (user_dir / f"{resume_id}.pdf").resolve()

    if not str(file_path).startswith(str(user_dir)):
        raise ValueError("Invalid file path: path traversal detected.")

    if file_path.exists() and file_path.is_file():
        file_path.unlink()
        return True
    return False


def get_resume_file(user_id: str, resume_id: str) -> Optional[bytes]:
    """Retrieves resume bytes for the authenticated user, or None if not found."""
    _validate_identifier(user_id, "user_id")
    _validate_identifier(resume_id, "resume_id")

    user_dir = get_user_resumes_dir(user_id)
    file_path = (user_dir / f"{resume_id}.pdf").resolve()

    if not str(file_path).startswith(str(user_dir)):
        raise ValueError("Invalid file path: path traversal detected.")

    if not file_path.exists() or not file_path.is_file():
        return None

    return file_path.read_bytes()


def delete_user_resumes(user_id: str) -> int:
    """Deletes all resume files for a tenant upon account deletion.

    Returns the count of files removed.
    """
    _validate_identifier(user_id, "user_id")
    root = get_storage_root()
    user_dir = (root / "resumes" / user_id).resolve()

    if not str(user_dir).startswith(str(root)):
        raise ValueError("Invalid storage path: directory traversal detected.")

    if not user_dir.exists():
        return 0

    count = 0
    for child in user_dir.iterdir():
        if child.is_file():
            count += 1

    shutil.rmtree(user_dir, ignore_errors=True)
    return count
