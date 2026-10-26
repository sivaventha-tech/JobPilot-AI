"""Tests for Render Production Startup, Persistent Disk Permissions, and Entrypoint Configuration.

Covers:
1. DatabaseManager fail-closed behavior when persistent mount is non-writable (no silent fallback).
2. get_storage_root fail-closed behavior when storage directory is non-writable.
3. docker-entrypoint.sh integrity (LF line endings, gosu privilege drop, ownership configuration).
4. Dockerfile least-privilege configuration and entrypoint wiring.
5. render.yaml disk mount and JOBPILOT_DB_PATH alignment.
"""

from __future__ import annotations

import os
from pathlib import Path
import pytest


def test_database_manager_fails_fast_on_non_writable_directory(monkeypatch, tmp_path):
    """Ensures DatabaseManager raises PermissionError when mount directory is not writable,
    and never silently falls back to ephemeral storage or memory.
    """
    from app.db.connection import DatabaseManager

    db_path = str(tmp_path / "protected_mount" / "jobpilot.db")

    # Simulate non-writable mount directory
    orig_access = os.access

    def mock_access(path, mode, *args, **kwargs):
        if mode == os.W_OK and "protected_mount" in str(path):
            return False
        return orig_access(path, mode, *args, **kwargs)

    monkeypatch.setattr(os, "access", mock_access)

    with pytest.raises(PermissionError) as exc_info:
        DatabaseManager(db_path=db_path)

    error_msg = str(exc_info.value)
    assert "FATAL" in error_msg
    assert "not writable by current user" in error_msg
    assert "protected_mount" in error_msg


def test_storage_root_fails_fast_on_non_writable_directory(monkeypatch, tmp_path):
    """Ensures get_storage_root raises PermissionError when storage directory is not writable."""
    from app.services.storage import get_storage_root

    storage_dir = str(tmp_path / "non_writable_storage")
    monkeypatch.setenv("JOBPILOT_STORAGE_DIR", storage_dir)

    orig_access = os.access

    def mock_access(path, mode, *args, **kwargs):
        if mode == os.W_OK and "non_writable_storage" in str(path):
            return False
        return orig_access(path, mode, *args, **kwargs)

    monkeypatch.setattr(os, "access", mock_access)

    with pytest.raises(PermissionError) as exc_info:
        get_storage_root()

    error_msg = str(exc_info.value)
    assert "FATAL" in error_msg
    assert "not writable" in error_msg


def test_docker_entrypoint_script_integrity():
    """Validates docker-entrypoint.sh structure, privilege de-escalation, and line endings."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    entrypoint_path = repo_root / "backend" / "docker-entrypoint.sh"

    assert entrypoint_path.is_file(), f"Missing entrypoint script at {entrypoint_path}"

    raw_bytes = entrypoint_path.read_bytes()
    # Must NOT contain CRLF line endings (would break on Linux containers)
    assert b"\r\n" not in raw_bytes, "docker-entrypoint.sh must use Linux LF (\\n) line endings"

    content = raw_bytes.decode("utf-8")

    # Must have strict error handling
    assert content.startswith("#!/bin/sh")
    assert "set -e" in content

    # Must configure ownership of persistent data directory
    assert "chown -R appuser:appuser" in content
    assert "chmod 750" in content

    # Must verify write access before execution
    assert "test -w" in content

    # Must drop privileges to unprivileged appuser using gosu
    assert "exec gosu appuser" in content


def test_dockerfile_startup_configuration():
    """Validates Dockerfile installs gosu, configures entrypoint, and defines non-root user."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    dockerfile_path = repo_root / "backend" / "Dockerfile"

    assert dockerfile_path.is_file(), f"Missing Dockerfile at {dockerfile_path}"
    content = dockerfile_path.read_text(encoding="utf-8")

    # Must install gosu for safe runtime privilege dropping
    assert "gosu" in content

    # Must create non-root appuser
    assert "useradd" in content
    assert "appuser" in content

    # Must wire the entrypoint script
    assert "COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh" in content
    assert "chmod +x /usr/local/bin/docker-entrypoint.sh" in content
    assert 'ENTRYPOINT ["docker-entrypoint.sh"]' in content

    # Must NOT run permanently as USER root or force USER appuser before entrypoint executes
    lines = [line.strip() for line in content.splitlines() if line.strip() and not line.strip().startswith("#")]
    user_directives = [line for line in lines if line.startswith("USER ")]
    assert len(user_directives) == 0, (
        "Dockerfile must not specify 'USER appuser' permanently; the entrypoint must start as PID 1 to prepare "
        "volume permissions and immediately drop privileges via 'gosu appuser'."
    )


def test_render_yaml_persistent_disk_alignment():
    """Validates render.yaml mounts persistent disk to /var/data and aligns JOBPILOT_DB_PATH."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    render_yaml_path = repo_root / "render.yaml"

    assert render_yaml_path.is_file(), f"Missing render.yaml at {render_yaml_path}"
    content = render_yaml_path.read_text(encoding="utf-8")

    assert "mountPath: /var/data" in content
    assert "value: /var/data/jobpilot.db" in content
