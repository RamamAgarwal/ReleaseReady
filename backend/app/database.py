
from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Iterator

# Save the database in the backend directory.
DB_PATH = Path(__file__).resolve().parents[1] / "releaseready.db"


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Provide a database connection with automatic commit/rollback."""
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    """Create the release and release-version tables if needed."""
    with get_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS release_packages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                current_version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS release_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                release_id INTEGER NOT NULL,
                version_number INTEGER NOT NULL,
                data_json TEXT NOT NULL,
                validation_json TEXT NOT NULL,
                created_at TEXT NOT NULL,

                FOREIGN KEY (release_id)
                    REFERENCES release_packages(id)
                    ON DELETE CASCADE,

                UNIQUE (release_id, version_number)
            );
            """
        )
