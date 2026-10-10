
from pydantic import BaseModel, Field, field_validator


class ReleasePackage(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    completed_features: list[str] = Field(default_factory=list)
    bug_fixes: list[str] = Field(default_factory=list)
    changed_behaviour: list[str] = Field(default_factory=list)

    qa_summary: str = Field(default="", max_length=10000)
    qa_evidence: list[str] = Field(default_factory=list)

    known_limitations: list[str] = Field(default_factory=list)
    migration_notes: list[str] = Field(default_factory=list)
    affected_user_groups: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Release name cannot be blank.")
        return value
