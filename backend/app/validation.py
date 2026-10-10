
from typing import Any


REQUIRED_SECTIONS = {
    "completed_features": "Completed features",
    "bug_fixes": "Bug fixes",
    "changed_behaviour": "Changed behaviour",
    "qa_summary": "QA summary",
    "known_limitations": "Known limitations",
    "migration_notes": "Migration or configuration notes",
    "affected_user_groups": "Affected user groups",
}


def validate_package(package: dict[str, Any]) -> dict[str, Any]:
    """Check required sections without relying on an AI model."""
    missing_sections: list[str] = []
    section_status: dict[str, bool] = {}

    for field, label in REQUIRED_SECTIONS.items():
        value = package.get(field)

        if isinstance(value, list):
            present = any(
                isinstance(item, str) and bool(item.strip())
                for item in value
            )
        else:
            present = isinstance(value, str) and bool(value.strip())

        section_status[field] = present

        if not present:
            missing_sections.append(label)

    warnings: list[str] = []

    if not package.get("qa_evidence"):
        warnings.append(
            "No explicit QA evidence was supplied. "
            "Claims about test results must not be presented as verified."
        )

    return {
        "is_complete": len(missing_sections) == 0,
        "missing_sections": missing_sections,
        "section_status": section_status,
        "warnings": warnings,
    }
