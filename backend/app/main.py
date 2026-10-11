
import json
from datetime import datetime, timezone
from .ai_analysis import router as ai_router
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .database import get_db, init_db
from .schemas import ReleasePackage
from .validation import validate_package

import os 

app = FastAPI(
    title="ReleaseReady API",
    description="Release communication and readiness workbench",
    version="0.1.0",
)

frontend_origin = os.getenv(
    "FRONTEND_ORIGIN",
    "https://release-ready-ruby.vercel.app",
).strip().rstrip("/")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        frontend_origin,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(ai_router)
init_db()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_json(value: str):
    return json.loads(value)


@app.get("/")
def root():
    return {
        "application": "ReleaseReady",
        "status": "running",
        "documentation": "/docs",
    }


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "ReleaseReady API"}


@app.post("/api/releases/validate")
def validate_release(payload: ReleasePackage):
    """Validate a package without saving it."""
    return validate_package(payload.model_dump())


@app.post("/api/releases", status_code=201)
def create_release(payload: ReleasePackage):
    """Create a release and its initial version."""
    package = payload.model_dump()
    validation = validate_package(package)
    now = utc_now()

    with get_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO release_packages
                (name, current_version, created_at, updated_at)
            VALUES (?, 1, ?, ?)
            """,
            (package["name"], now, now),
        )
        release_id = cursor.lastrowid

        connection.execute(
            """
            INSERT INTO release_versions
                (release_id, version_number, data_json,
                 validation_json, created_at)
            VALUES (?, 1, ?, ?, ?)
            """,
            (
                release_id,
                json.dumps(package, ensure_ascii=False),
                json.dumps(validation, ensure_ascii=False),
                now,
            ),
        )

    return {
        "id": release_id,
        "name": package["name"],
        "current_version": 1,
        "created_at": now,
        "updated_at": now,
        "package": package,
        "validation": validation,
    }


@app.get("/api/releases")
def list_releases():
    """List releases with their latest validation status."""
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT
                p.id, p.name, p.current_version,
                p.created_at, p.updated_at,
                v.validation_json
            FROM release_packages p
            JOIN release_versions v
              ON v.release_id = p.id
             AND v.version_number = p.current_version
            ORDER BY p.updated_at DESC
            """
        ).fetchall()

    releases = []

    for row in rows:
        validation = load_json(row["validation_json"])
        releases.append(
            {
                "id": row["id"],
                "name": row["name"],
                "current_version": row["current_version"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "is_complete": validation["is_complete"],
                "missing_sections": validation["missing_sections"],
            }
        )

    return {"releases": releases}


@app.get("/api/releases/{release_id}")
def get_release(release_id: int):
    """Get the latest snapshot and version history."""
    with get_db() as connection:
        release = connection.execute(
            "SELECT * FROM release_packages WHERE id = ?",
            (release_id,),
        ).fetchone()

        if release is None:
            raise HTTPException(status_code=404, detail="Release not found.")

        version = connection.execute(
            """
            SELECT * FROM release_versions
            WHERE release_id = ? AND version_number = ?
            """,
            (release_id, release["current_version"]),
        ).fetchone()

        history = connection.execute(
            """
            SELECT version_number, created_at, validation_json
            FROM release_versions
            WHERE release_id = ?
            ORDER BY version_number DESC
            """,
            (release_id,),
        ).fetchall()

    return {
        "id": release["id"],
        "name": release["name"],
        "current_version": release["current_version"],
        "created_at": release["created_at"],
        "updated_at": release["updated_at"],
        "package": load_json(version["data_json"]),
        "validation": load_json(version["validation_json"]),
        "versions": [
            {
                "version_number": item["version_number"],
                "created_at": item["created_at"],
                "validation": load_json(item["validation_json"]),
            }
            for item in history
        ],
    }


@app.put("/api/releases/{release_id}")
def update_release(release_id: int, payload: ReleasePackage):
    """Save edits as a new version; preserve previous snapshots."""
    package = payload.model_dump()
    validation = validate_package(package)
    now = utc_now()

    with get_db() as connection:
        release = connection.execute(
            "SELECT * FROM release_packages WHERE id = ?",
            (release_id,),
        ).fetchone()

        if release is None:
            raise HTTPException(status_code=404, detail="Release not found.")

        next_version = release["current_version"] + 1

        connection.execute(
            """
            UPDATE release_packages
            SET name = ?, current_version = ?, updated_at = ?
            WHERE id = ?
            """,
            (package["name"], next_version, now, release_id),
        )

        connection.execute(
            """
            INSERT INTO release_versions
                (release_id, version_number, data_json,
                 validation_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                release_id,
                next_version,
                json.dumps(package, ensure_ascii=False),
                json.dumps(validation, ensure_ascii=False),
                now,
            ),
        )

    return {
        "id": release_id,
        "name": package["name"],
        "current_version": next_version,
        "updated_at": now,
        "package": package,
        "validation": validation,
    }


@app.get("/api/releases/{release_id}/compare")
def compare_versions(
    release_id: int,
    from_version: int = Query(ge=1),
    to_version: int = Query(ge=1),
):
    """Compare two saved package versions field by field."""
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT version_number, data_json
            FROM release_versions
            WHERE release_id = ?
              AND version_number IN (?, ?)
            """,
            (release_id, from_version, to_version),
        ).fetchall()

    snapshots = {
        row["version_number"]: load_json(row["data_json"])
        for row in rows
    }

    if from_version not in snapshots or to_version not in snapshots:
        raise HTTPException(
            status_code=404,
            detail="Release or requested version not found.",
        )

    before = snapshots[from_version]
    after = snapshots[to_version]

    changes = [
        {
            "field": field,
            "before": before.get(field),
            "after": after.get(field),
        }
        for field in sorted(set(before) | set(after))
        if before.get(field) != after.get(field)
    ]

    return {
        "release_id": release_id,
        "from_version": from_version,
        "to_version": to_version,
        "changes": changes,
    }
