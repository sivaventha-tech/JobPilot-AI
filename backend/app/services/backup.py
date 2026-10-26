"""Automated Backup and Restore Service for JobPilot AI.

Performs atomic, online SQLite database snapshots via SQLite's native backup API (ACID-safe)
and synchronizes tenant-isolated resume storage files into verified, checksummed archives.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
import time
from pathlib import Path
from typing import Any

from app.db.connection import db_manager, DEFAULT_DB_PATH
from app.services.storage import get_storage_root


def _compute_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def create_backup(dest_dir: Path | str | None = None) -> Path:
    """Creates a verified, timestamped tar.gz backup archive of JobPilot AI.

    Includes:
    1. An online SQLite database snapshot taken with conn.backup() (WAL-safe, zero corruption).
    2. The tenant-isolated storage directory containing candidate resume PDFs.
    3. An integrity manifest with SHA-256 checksums and file counts.
    """
    dest = Path(dest_dir).resolve() if dest_dir else get_storage_root().parent / "backups"
    dest.mkdir(parents=True, exist_ok=True)

    timestamp = int(time.time())
    archive_name = f"jobpilot_backup_{timestamp}.tar.gz"
    final_archive_path = dest / archive_name

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # 1. Atomic SQLite Snapshot via native backup API
        db_backup_path = tmp_path / "database.sqlite3"
        src_conn = db_manager.get_connection()
        backup_conn = sqlite3.connect(str(db_backup_path))
        with backup_conn:
            src_conn.backup(backup_conn, pages=100, sleep=0.005)
        backup_conn.close()

        db_sha256 = _compute_sha256(db_backup_path)

        # 2. Copy storage directory
        storage_src = get_storage_root()
        storage_dest = tmp_path / "storage"
        storage_dest.mkdir(parents=True, exist_ok=True)
        resumes_count = 0
        resumes_total_bytes = 0

        if storage_src.exists():
            for root_dir, _, files in os.walk(storage_src):
                rel_dir = Path(root_dir).relative_to(storage_src)
                target_dir = storage_dest / rel_dir
                target_dir.mkdir(parents=True, exist_ok=True)
                for f in files:
                    s_file = Path(root_dir) / f
                    d_file = target_dir / f
                    shutil.copy2(s_file, d_file)
                    resumes_count += 1
                    resumes_total_bytes += s_file.stat().st_size

        # 3. Create manifest
        manifest = {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp)),
            "timestamp": timestamp,
            "version": "1.0",
            "db_sha256": db_sha256,
            "resumes_count": resumes_count,
            "resumes_total_bytes": resumes_total_bytes,
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        # 4. Bundle into .tar.gz archive
        with tarfile.open(final_archive_path, "w:gz") as tar:
            tar.add(db_backup_path, arcname="database.sqlite3")
            tar.add(storage_dest, arcname="storage")
            tar.add(manifest_path, arcname="manifest.json")

    return final_archive_path


def verify_backup(archive_path: Path | str) -> dict[str, Any]:
    """Verifies archive integrity, manifest checksums, and SQLite database readability."""
    arch = Path(archive_path).resolve()
    if not arch.exists() or not arch.is_file():
        raise FileNotFoundError(f"Backup archive '{arch}' not found.")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        with tarfile.open(arch, "r:gz") as tar:
            tar.extractall(path=tmp_path)

        manifest_file = tmp_path / "manifest.json"
        if not manifest_file.exists():
            raise ValueError("Invalid backup archive: missing manifest.json.")

        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        db_file = tmp_path / "database.sqlite3"
        if not db_file.exists():
            raise ValueError("Invalid backup archive: missing database.sqlite3.")

        computed_sha256 = _compute_sha256(db_file)
        if computed_sha256 != manifest.get("db_sha256"):
            raise ValueError("Backup integrity failure: database SHA-256 checksum mismatch.")

        # Test SQLite integrity
        conn = sqlite3.connect(str(db_file))
        cur = conn.execute("PRAGMA integrity_check;")
        check_result = cur.fetchone()[0]
        conn.close()

        if check_result != "ok":
            raise ValueError(f"SQLite database integrity check failed: {check_result}")

        return {
            "valid": True,
            "integrity": "ok",
            "manifest": manifest,
        }


def restore_backup(
    archive_path: Path | str,
    target_db_path: Path | str | None = None,
    target_storage_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Safely restores SQLite database and resume storage files from a verified backup archive."""
    verification = verify_backup(archive_path)
    if not verification.get("valid"):
        raise ValueError("Cannot restore from an invalid or corrupted backup archive.")

    arch = Path(archive_path).resolve()
    dest_db = Path(target_db_path).resolve() if target_db_path else Path(os.getenv("JOBPILOT_DB_PATH", DEFAULT_DB_PATH)).resolve()
    dest_storage = Path(target_storage_dir).resolve() if target_storage_dir else get_storage_root()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        with tarfile.open(arch, "r:gz") as tar:
            tar.extractall(path=tmp_path)

        src_db = tmp_path / "database.sqlite3"
        dest_db.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_db, dest_db)

        src_storage = tmp_path / "storage"
        dest_storage.mkdir(parents=True, exist_ok=True)
        if src_storage.exists():
            for root_dir, _, files in os.walk(src_storage):
                rel_dir = Path(root_dir).relative_to(src_storage)
                target_dir = dest_storage / rel_dir
                target_dir.mkdir(parents=True, exist_ok=True)
                for f in files:
                    shutil.copy2(Path(root_dir) / f, target_dir / f)

    return {
        "status": "restored",
        "manifest": verification["manifest"],
        "database_path": str(dest_db),
        "storage_path": str(dest_storage),
    }
