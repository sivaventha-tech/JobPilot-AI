"""Thread-safe Database Connection Manager for JobPilot AI.

Manages SQLite connection pools with RLock concurrency, foreign-key enforcement,
and idempotent schema initialization.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Generator

from app.db.schema import SCHEMA_SQL

_LOCAL_STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
DEFAULT_DB_PATH = os.path.join(_LOCAL_STORAGE_DIR, "jobpilot.db")


class DatabaseManager:
    """Thread-safe database manager with lock synchronization."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or os.getenv("JOBPILOT_DB_PATH", DEFAULT_DB_PATH)
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None

        if self.db_path != ":memory:" and not self.db_path.startswith("file:"):
            os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)

        self.ensure_initialized()

    def get_connection(self) -> sqlite3.Connection:
        with self._lock:
            if self._conn is None:
                is_mem = self.db_path == ":memory:" or "mode=memory" in self.db_path
                is_uri = self.db_path.startswith("file:") or is_mem
                target = "file:jobpilot_mem?mode=memory&cache=shared" if is_mem else self.db_path
                self._conn = sqlite3.connect(
                    target,
                    check_same_thread=False,
                    timeout=30.0,
                    uri=is_uri,
                )
                self._conn.row_factory = sqlite3.Row
                self._conn.execute("PRAGMA foreign_keys = ON;")
                if not is_mem:
                    try:
                        self._conn.execute("PRAGMA journal_mode = WAL;")
                        self._conn.execute("PRAGMA synchronous = NORMAL;")
                    except Exception:
                        pass
            return self._conn

    def ensure_initialized(self) -> None:
        with self._lock:
            conn = self.get_connection()
            conn.executescript(SCHEMA_SQL)
            conn.commit()

    @contextmanager
    def transaction(self) -> Generator[sqlite3.Connection, None, None]:
        with self._lock:
            conn = self.get_connection()
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None


# Global singleton database manager instance
db_manager = DatabaseManager()
