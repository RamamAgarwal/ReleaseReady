import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import "./App.css";

const API = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

type ListField =
  | "completed_features"
  | "bug_fixes"
  | "changed_behaviour"
  | "qa_evidence"
  | "known_limitations"
  | "migration_notes"
  | "affected_user_groups";

type ReleasePackage = {
  name: string;
  completed_features: string[];
  bug_fixes: string[];
  changed_behaviour: string[];
  qa_summary: string;
  qa_evidence: string[];
  known_limitations: string[];
  migration_notes: string[];
  affected_user_groups: string[];
};

type ValidationResult = {
  is_complete: boolean;
  missing_sections: string[];
  section_status: Record<string, boolean>;
  warnings: string[];
};

type ReleaseSummary = {
  id: number;
  name: string;
  current_version: number;
  updated_at: string;
  is_complete: boolean;
  missing_sections: string[];
};

type VersionEntry = {
  version_number: number;
  created_at: string;
  validation: ValidationResult;
};

type ReleaseDetail = {
  id: number;
  name: string;
  current_version: number;
  package: ReleasePackage;
  validation: ValidationResult;
  versions: VersionEntry[];
};

type Change = {
  field: string;
  before: unknown;
  after: unknown;
};

type CompareResult = {
  from_version: number;
  to_version: number;
  changes: Change[];
};


type AIStatement = {
  statement_id: string;
  text: string;
  edited_text: string;
  source_refs: string[];
  qa_support: string;
  review_status: string;
};

type AISource = {
  id: string;
  field: string;
  text: string;
  fingerprint: string;
};

type AIAnalysis = {
  impact_classifications: {
    source_ref: string;
    impact_level: "high" | "medium" | "low" | "unclear";
    reason: string;
  }[];
  missing_information: {
    field: string;
    issue: string;
    clarification_question: string;
  }[];
  unsupported_qa_claims: {
    claim_text: string;
    source_ref: string;
    qa_evidence_refs: string[];
    reason: string;
  }[];
  technical_brief: AIStatement[];
  stakeholder_brief: AIStatement[];
  risks_and_limitations: {
    description: string;
    severity: "high" | "medium" | "low" | "unclear";
    source_refs: string[];
  }[];
  clarification_questions: string[];
  integrity_warnings?: string[];
};

type AIAnalysisResponse = {
  analysis_id: number;
  release_id: number;
  release_version: number;
  created_at: string;
  analysis: AIAnalysis;
  sources: AISource[];
};


type ReviewEvent = {
  id: number;
  statement_id: string | null;
  action: string;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

type FinalBriefStatement = {
  statement_id: string;
  text: string;
  source_refs: string[];
  qa_support: string;
};

type FinalBrief = {
  release_id: number;
  release_name: string;
  release_version: number;
  analysis_id: number;
  created_at: string;
  technical_brief: FinalBriefStatement[];
  stakeholder_brief: FinalBriefStatement[];
  excluded_rejected_count: number;
  reviewed_statement_count: number;
};

type FinalBriefResponse = {
  final_brief_id: number;
  brief: FinalBrief;
};

type ReviewUpdatePayload = {
  edited_text?: string;
  review_status?: "pending" | "approved" | "rejected";
};

const emptyPackage = (): ReleasePackage => ({
  name: "",
  completed_features: [],
  bug_fixes: [],
  changed_behaviour: [],
  qa_summary: "",
  qa_evidence: [],
  known_limitations: [],
  migration_notes: [],
  affected_user_groups: [],
});

const listFields: { key: ListField; label: string; hint: string }[] = [
  {
    key: "completed_features",
    label: "Completed features",
    hint: "One feature per line",
  },
  {
    key: "bug_fixes",
    label: "Bug fixes",
    hint: "One fix per line",
  },
  {
    key: "changed_behaviour",
    label: "Changed behaviour",
    hint: "Describe changes users may notice",
  },
  {
    key: "known_limitations",
    label: "Known limitations",
    hint: "Be explicit about remaining constraints",
  },
  {
    key: "migration_notes",
    label: "Migration or configuration notes",
    hint: "Include required actions, or state that none are required",
  },
  {
    key: "affected_user_groups",
    label: "Affected user groups",
    hint: "One user group per line",
  },
];

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const raw = await response.text();

  if (!response.ok) {
    let message = raw || `Request failed (${response.status})`;

    try {
      const parsed = JSON.parse(raw);
      message =
        typeof parsed.detail === "string"
          ? parsed.detail
          : JSON.stringify(parsed.detail ?? parsed);
    } catch {
      // Keep the original response text.
    }

    throw new Error(message);
  }

  return (raw ? JSON.parse(raw) : {}) as T;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value || "(empty)";
  return JSON.stringify(value, null, 2) ?? "—";
}

function App() {
  const [packageData, setPackageData] =
    useState<ReleasePackage>(emptyPackage());
  const [validation, setValidation] =
    useState<ValidationResult | null>(null);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] =
    useState<number | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [fromVersion, setFromVersion] = useState(1);
  const [toVersion, setToVersion] = useState(1);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiAnalysis, setAiAnalysis] =
  useState<AIAnalysisResponse | null>(null);
  const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]);
  const [finalBrief, setFinalBrief] = useState<FinalBriefResponse | null>(null);
  const [briefAudience, setBriefAudience] =
  useState<"technical" | "stakeholder">("technical");

  const refreshReleases = useCallback(async () => {
    const result = await apiRequest<{ releases: ReleaseSummary[] }>(
      "/api/releases",
    );
    setReleases(result.releases);
  }, []);


    useEffect(() => {
      let cancelled = false;

      apiRequest<{ releases: ReleaseSummary[] }>("/api/releases")
        .then((result) => {
          if (!cancelled) {
            setReleases(result.releases);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not load releases.",
            );
          }
        });

      return () => {
        cancelled = true;
      };
    }, []);

  const readyCount = useMemo(
    () => releases.filter((release) => release.is_complete).length,
    [releases],
  );

  async function openRelease(id: number) {
    setError("");
    setNotice("");
    setBusy("open");

    try {
      const detail = await apiRequest<ReleaseDetail>(`/api/releases/${id}`);

      setPackageData(detail.package);
      setValidation(detail.validation);
      setSelectedReleaseId(detail.id);
      setCurrentVersion(detail.current_version);
      setVersions(detail.versions);
      setComparison(null);
      setAiAnalysis(null);
      setReviewEvents([]);
      setFinalBrief(null);

      const numbers = detail.versions.map((version) => version.version_number);
      setFromVersion(numbers.length ? Math.min(...numbers) : 1);
      setToVersion(detail.current_version);

      setNotice(`Opened ${detail.name}, version ${detail.current_version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open release.");
    } finally {
      setBusy("");
    }
  }

  function startNewRelease() {
    setPackageData(emptyPackage());
    setValidation(null);
    setSelectedReleaseId(null);
    setCurrentVersion(null);
    setVersions([]);
    setAiAnalysis(null);
    setBriefAudience("technical");
    setComparison(null);
    setError("");
    setNotice("");
  }

  function updateListField(field: ListField, value: string) {
    const values = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    setPackageData((previous) => ({ ...previous, [field]: values }));
    setValidation(null);
    setComparison(null);
  }

  async function validatePackage() {
    setBusy("validate");
    setError("");
    setNotice("");
    setValidation(null);

    try {
      const result = await apiRequest<ValidationResult>(
        "/api/releases/validate",
        {
          method: "POST",
          body: JSON.stringify(packageData),
        },
      );

      setValidation(result);
      setNotice(
        result.is_complete
          ? "All required release sections are present."
          : "Validation finished. Review the missing sections below.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");

    try {
      const editing = selectedReleaseId !== null;
      const saved = await apiRequest<{
        id: number;
        name: string;
        current_version: number;
        validation: ValidationResult;
      }>(
        editing
          ? `/api/releases/${selectedReleaseId}`
          : "/api/releases",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(packageData),
        },
      );

      setSelectedReleaseId(saved.id);
      setCurrentVersion(saved.current_version);
      setValidation(saved.validation);

      await refreshReleases();
      await openRelease(saved.id);

      setNotice(
        editing
          ? `Saved as version ${saved.current_version}. Previous versions are preserved.`
          : `Created ${saved.name} as version 1.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save release.");
    } finally {
      setBusy("");
    }
  }

  async function compareVersions() {
    if (selectedReleaseId === null) return;

    setBusy("compare");
    setError("");
    setComparison(null);

    try {
      const result = await apiRequest<CompareResult>(
        `/api/releases/${selectedReleaseId}/compare?from_version=${fromVersion}&to_version=${toVersion}`,
      );
      setComparison(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed.");
    } finally {
      setBusy("");
    }
  }

  async function analyzeRelease() {
    if (selectedReleaseId === null) {
      setError("Save the release before running AI analysis.");
      return;
    }

    setBusy("analyze");
    setError("");
    setNotice("");
    setAiAnalysis(null);

    try {
      const result = await apiRequest<AIAnalysisResponse>(
        `/api/releases/${selectedReleaseId}/analyze`,
        { method: "POST" },
      );

      setAiAnalysis(result);
      setBriefAudience("technical");
      setReviewEvents([]);
      setFinalBrief(null);

await loadReviewHistory(result.release_id, result.analysis_id);

      setNotice(
        `AI analysis completed for release version ${result.release_version}. Generated statements are awaiting human review.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "AI analysis failed. Check the backend.",
      );
    } finally {
      setBusy("");
    }
  }


async function loadReviewHistory(
  releaseId: number,
  analysisId: number,
) {
  try {
    const result = await apiRequest<{ events: ReviewEvent[] }>(
      `/api/releases/${releaseId}/analyses/${analysisId}/review-history`,
    );

    setReviewEvents(result.events);
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Could not load review history.",
    );
  }
}

function updateStatementDraft(statementId: string, text: string) {
  setAiAnalysis((previous) => {
    if (!previous) return previous;

    const updateList = (items: AIStatement[]) =>
      items.map((item) =>
        item.statement_id === statementId
          ? { ...item, edited_text: text }
          : item,
      );

    return {
      ...previous,
      analysis: {
        ...previous.analysis,
        technical_brief: updateList(
          previous.analysis.technical_brief,
        ),
        stakeholder_brief: updateList(
          previous.analysis.stakeholder_brief,
        ),
      },
    };
  });
}

async function persistStatementUpdate(
  statement: AIStatement,
  payload: ReviewUpdatePayload,
) {
  if (!aiAnalysis) return;

  setBusy(`review-${statement.statement_id}`);
  setError("");
  setNotice("");

  try {
    const result = await apiRequest<{
      analysis_id: number;
      statement_id: string;
      statement: AIStatement;
    }>(
      `/api/releases/${aiAnalysis.release_id}/analyses/` +
        `${aiAnalysis.analysis_id}/statements/` +
        encodeURIComponent(statement.statement_id),
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );

    setAiAnalysis((previous) => {
      if (!previous) return previous;

      const updateList = (items: AIStatement[]) =>
        items.map((item) =>
          item.statement_id === result.statement_id
            ? result.statement
            : item,
        );

      return {
        ...previous,
        analysis: {
          ...previous.analysis,
          technical_brief: updateList(
            previous.analysis.technical_brief,
          ),
          stakeholder_brief: updateList(
            previous.analysis.stakeholder_brief,
          ),
        },
      };
    });

    setFinalBrief(null);

    if (payload.review_status) {
      setNotice(
        `Statement ${payload.review_status}. The decision has been saved.`,
      );
    } else {
      setNotice(
        "Statement edit saved. Changed wording requires review again.",
      );
    }

    await loadReviewHistory(
      aiAnalysis.release_id,
      aiAnalysis.analysis_id,
    );
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Could not save the review action.",
    );
  } finally {
    setBusy("");
  }
}

async function finalizeReviewedBrief() {
  if (!aiAnalysis) return;

  setBusy("finalize");
  setError("");
  setNotice("");

  try {
    const result = await apiRequest<FinalBriefResponse>(
      `/api/releases/${aiAnalysis.release_id}/analyses/` +
        `${aiAnalysis.analysis_id}/finalize`,
      { method: "POST" },
    );

    setFinalBrief(result);
    setNotice(
      `Final reviewed brief #${result.final_brief_id} was saved.`,
    );

    await loadReviewHistory(
      aiAnalysis.release_id,
      aiAnalysis.analysis_id,
    );
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Could not generate the final brief.",
    );
  } finally {
    setBusy("");
  }
}

async function copyFinalBrief() {
  if (!finalBrief) return;

  const text = [
    finalBrief.brief.release_name,
    "",
    "TECHNICAL BRIEF",
    ...finalBrief.brief.technical_brief.map(
      (item) => `- ${item.text} [${item.source_refs.join(", ")}]`,
    ),
    "",
    "STAKEHOLDER BRIEF",
    ...finalBrief.brief.stakeholder_brief.map(
      (item) => `- ${item.text} [${item.source_refs.join(", ")}]`,
    ),
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    setError("");
    setNotice("Final brief copied to clipboard.");
  } catch {
    setError(
      "Unable to copy the brief. Check your browser's clipboard permissions.",
    );
  }
}

  const requiredLabels = [
    { key: "completed_features", label: "Completed features" },
    { key: "bug_fixes", label: "Bug fixes" },
    { key: "changed_behaviour", label: "Changed behaviour" },
    { key: "qa_summary", label: "QA summary" },
    { key: "known_limitations", label: "Known limitations" },
    { key: "migration_notes", label: "Migration / configuration notes" },
    { key: "affected_user_groups", label: "Affected user groups" },
  ];


  const visibleBrief =
    aiAnalysis?.analysis[
      briefAudience === "technical"
        ? "technical_brief"
        : "stakeholder_brief"
    ] ?? [];

  const sourceById = useMemo(
    () =>
      new Map(
        (aiAnalysis?.sources ?? []).map(
          (source) => [source.id, source] as const,
        ),
      ),
    [aiAnalysis],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">ReleaseReady</div>
            <div className="brand-subtitle">Release workspace</div>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <button className="nav-item active" type="button">
          <span>▦</span> Releases
        </button>
        <button className="nav-item" type="button" onClick={startNewRelease}>
          <span>＋</span> New release
        </button>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="note-icon">i</div>
            <strong>Human-led review</strong>
            <p>AI suggestions will remain reviewable. Approval stays with a human.</p>
          </div>
          <div className="api-status">
            <span className="status-dot" />
            Connected to local API
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> Releases
          </div>
          <div className="topbar-right">
            <span className="local-badge">LOCAL ENVIRONMENT</span>
            <div className="avatar">RA</div>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <div className="eyebrow">RELEASE OPERATIONS</div>
            <h1>Release workspace</h1>
            <p>
              Organise release details, check readiness, and preserve a clear
              history of every change.
            </p>
          </div>
          <button className="button button-primary" onClick={startNewRelease}>
            <span>＋</span> New release
          </button>
        </section>

        {error && (
          <div className="message error-message" role="alert">
            <strong>Something went wrong</strong>
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="message success-message" role="status">
            <span className="message-check">✓</span>
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="Dismiss message">
              ×
            </button>
          </div>
        )}

        <section className="stats-grid">
          <article className="stat-card">
            <div className="stat-topline">
              <span>Total releases</span>
              <span className="stat-icon purple">▤</span>
            </div>
            <div className="stat-value">{releases.length}</div>
            <div className="stat-caption">Saved in your workspace</div>
          </article>

          <article className="stat-card">
            <div className="stat-topline">
              <span>Complete packages</span>
              <span className="stat-icon green">✓</span>
            </div>
            <div className="stat-value">{readyCount}</div>
            <div className="stat-caption">All required sections present</div>
          </article>

          <article className="stat-card">
            <div className="stat-topline">
              <span>Incomplete packages</span>
              <span className="stat-icon amber">!</span>
            </div>
            <div className="stat-value">{releases.length - readyCount}</div>
            <div className="stat-caption">Need additional information</div>
          </article>
        </section>

        <div className="workspace-grid">
          <section className="panel editor-panel">
            <div className="panel-header">
              <div>
                <div className="panel-kicker">
                  {selectedReleaseId === null ? "CREATE" : "EDIT"}
                </div>
                <h2>
                  {selectedReleaseId === null
                    ? "Release package"
                    : "Edit release package"}
                </h2>
                <p>
                  {selectedReleaseId === null
                    ? "Capture the information needed for a reliable release brief."
                    : `Editing release #${selectedReleaseId}${
                        currentVersion ? ` · current version ${currentVersion}` : ""
                      }.`}
                </p>
              </div>
              {selectedReleaseId !== null && (
                <span className="version-badge">v{currentVersion}</span>
              )}
            </div>

            <form onSubmit={saveRelease}>
              <div className="field">
                <label htmlFor="release-name">Release name *</label>
                <input
                  id="release-name"
                  value={packageData.name}
                  onChange={(event) => {
                    setPackageData((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }));
                    setValidation(null);
                  }}
                  placeholder="e.g. Payments API 1.4.0"
                  maxLength={120}
                  required
                />
              </div>

              <div className="form-section-heading">
                <span className="section-number">01</span>
                <div>
                  <h3>Release contents</h3>
                  <p>Use one item per line for list fields.</p>
                </div>
              </div>

              <div className="field-grid">
                {listFields
                  .filter((field) => field.key !== "qa_evidence")
                  .map((field) => (
                    <div className="field" key={field.key}>
                      <label htmlFor={field.key}>{field.label} *</label>
                      <textarea
                        id={field.key}
                        rows={3}
                        value={packageData[field.key].join("\n")}
                        onChange={(event) =>
                          updateListField(field.key, event.target.value)
                        }
                        placeholder={field.hint}
                      />
                      <span className="field-hint">{field.hint}</span>
                    </div>
                  ))}
              </div>

              <div className="field">
                <label htmlFor="qa-summary">QA summary *</label>
                <textarea
                  id="qa-summary"
                  rows={3}
                  value={packageData.qa_summary}
                  onChange={(event) => {
                    setPackageData((previous) => ({
                      ...previous,
                      qa_summary: event.target.value,
                    }));
                    setValidation(null);
                  }}
                  placeholder="Summarise what was tested and the observed results."
                />
                <span className="field-hint">
                  Describe the testing that actually took place.
                </span>
              </div>

              <div className="field">
                <label htmlFor="qa-evidence">QA evidence</label>
                <textarea
                  id="qa-evidence"
                  rows={3}
                  value={packageData.qa_evidence.join("\n")}
                  onChange={(event) =>
                    updateListField("qa_evidence", event.target.value)
                  }
                  placeholder={"QA-01: Regression suite passed, 118/118 tests.\nQA-02: Export tested with 5,000 invoices."}
                />
                <span className="field-hint">
                  Add specific test results or evidence IDs to support claims.
                </span>
              </div>

              <div className="form-actions">
                <button
                className="button button-secondary"
                type="button"
                disabled={busy !== ""}
                onClick={() => void validatePackage()}
              >
                {busy === "validate" ? "Checking…" : "Check readiness"}
              </button>

              <button
                className="button button-secondary"
                type="button"
                disabled={busy !== "" || selectedReleaseId === null}
                onClick={() => void analyzeRelease()}
                title={
                  selectedReleaseId === null
                    ? "Save the release before analysing it"
                    : "Analyse the saved release with Gemini"
                }
              >
                {busy === "analyze" ? "Analysing…" : "✦ Analyse with AI"}
              </button>

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={busy !== ""}
                >
                  {busy === "save"
                    ? "Saving…"
                    : selectedReleaseId === null
                      ? "Save release"
                      : "Save new version"}
                  <span>→</span>
                </button>
              </div>
              <p className="save-hint">
                Incomplete drafts can be saved. Saving edits creates a new
                version rather than overwriting the previous one.
              </p>
            </form>

            {validation && (
              <section className="validation-panel" aria-live="polite">
                <div className="validation-title-row">
                  <h3>Readiness check</h3>
                  <span
                    className={`status-pill ${validation.is_complete ? "ready" : "incomplete"}`}
                  >
                    {validation.is_complete ? "Complete" : "Incomplete"}
                  </span>
                </div>

                <div className="checklist">
                  {requiredLabels.map((section) => {
                    const present = validation.section_status[section.key];
                    return (
                      <div className="checklist-item" key={section.key}>
                        <span className={present ? "check-icon" : "missing-icon"}>
                          {present ? "✓" : "!"}
                        </span>
                        <span>{section.label}</span>
                        <span className="checklist-status">
                          {present ? "Present" : "Missing"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {validation.warnings.map((warning) => (
                  <div className="warning-note" key={warning}>
                    <strong>Evidence warning:</strong> {warning}
                  </div>
                ))}
              </section>
            )}
          </section>

          <div className="right-column">
            <section className="panel library-panel">
              <div className="panel-header compact">
                <div>
                  <div className="panel-kicker">YOUR WORKSPACE</div>
                  <h2>Saved releases</h2>
                </div>
                <span className="count-badge">{releases.length}</span>
              </div>

              {releases.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">▤</div>
                  <h3>No releases yet</h3>
                  <p>Create your first package. It will appear here after saving.</p>
                </div>
              ) : (
                <div className="release-list">
                  {releases.map((release) => (
                    <button
                      type="button"
                      key={release.id}
                      className={`release-item ${
                        selectedReleaseId === release.id ? "selected" : ""
                      }`}
                      onClick={() => void openRelease(release.id)}
                      disabled={busy !== ""}
                    >
                      <div className="release-item-top">
                        <span
                          className={`release-file-icon ${
                            release.is_complete ? "file-ready" : "file-draft"
                          }`}
                        >
                          ▤
                        </span>
                        <span
                          className={`status-pill ${
                            release.is_complete ? "ready" : "incomplete"
                          }`}
                        >
                          {release.is_complete ? "Complete" : "Incomplete"}
                        </span>
                      </div>
                      <strong>{release.name}</strong>
                      <span className="release-item-meta">
                        Version {release.current_version}
                      </span>
                      <span className="release-item-date">
                        Updated {formatDate(release.updated_at)}
                      </span>
                      {!release.is_complete && (
                        <span className="release-missing">
                          {release.missing_sections.length} section(s) missing
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="text-button"
                onClick={() => void refreshReleases()}
                disabled={busy !== ""}
              >
                ↻ Refresh release list
              </button>
            </section>

            {selectedReleaseId !== null && (
              <section className="panel history-panel">
                <div className="panel-header compact">
                  <div>
                    <div className="panel-kicker">CHANGE TRACKING</div>
                    <h2>Version history</h2>
                  </div>
                  <span className="count-badge">{versions.length}</span>
                </div>

                <div className="version-list">
                  {versions.map((version) => (
                    <div className="version-item" key={version.version_number}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>Version {version.version_number}</strong>
                        <div className="version-meta">
                          {formatDate(version.created_at)}
                        </div>
                      </div>
                      <span
                        className={`version-state ${
                          version.validation.is_complete ? "good" : "muted"
                        }`}
                      >
                        {version.validation.is_complete
                          ? "Complete"
                          : "Draft"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="compare-form">
                  <h3>Compare versions</h3>
                  <div className="compare-selects">
                    <div className="field">
                      <label htmlFor="from-version">From</label>
                      <select
                        id="from-version"
                        value={fromVersion}
                        onChange={(event) =>
                          setFromVersion(Number(event.target.value))
                        }
                      >
                        {versions.map((version) => (
                          <option
                            key={version.version_number}
                            value={version.version_number}
                          >
                            v{version.version_number}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="to-version">To</label>
                      <select
                        id="to-version"
                        value={toVersion}
                        onChange={(event) =>
                          setToVersion(Number(event.target.value))
                        }
                      >
                        {versions.map((version) => (
                          <option
                            key={version.version_number}
                            value={version.version_number}
                          >
                            v{version.version_number}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    className="button button-secondary full-width"
                    type="button"
                    disabled={busy !== "" || versions.length < 2}
                    onClick={() => void compareVersions()}
                  >
                    {busy === "compare" ? "Comparing…" : "Compare changes"}
                  </button>
                  {versions.length < 2 && (
                    <p className="field-hint">
                      Save another version to compare changes.
                    </p>
                  )}
                </div>

                {comparison && (
                  <div className="comparison-results">
                    <h3>
                      Changes: v{comparison.from_version} → v
                      {comparison.to_version}
                    </h3>
                    {comparison.changes.length === 0 ? (
                      <p>No field changes found between these versions.</p>
                    ) : (
                      comparison.changes.map((change) => (
                        <div className="change-item" key={change.field}>
                          <strong>{change.field.replaceAll("_", " ")}</strong>
                          <div className="change-value">
                            <span className="change-label">Before</span>
                            <pre>{formatValue(change.before)}</pre>
                          </div>
                          <div className="change-value">
                            <span className="change-label">After</span>
                            <pre>{formatValue(change.after)}</pre>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

{aiAnalysis && (
  <section className="panel ai-analysis-panel">
    <div className="panel-header ai-panel-header">
      <div>
        <div className="panel-kicker">GEMINI ANALYSIS</div>
        <h2>Release intelligence</h2>
        <p>
          Analysed release version {aiAnalysis.release_version}.
          {" "}All generated statements remain subject to human review.
        </p>
      </div>
      <span className="version-badge">
        Analysis #{aiAnalysis.analysis_id}
      </span>
    </div>

    {aiAnalysis.analysis.integrity_warnings?.map((warning, index) => (
      <div className="warning-note" key={`${warning}-${index}`}>
        <strong>Evidence check:</strong> {warning}
      </div>
    ))}

    <div className="ai-section">
      <h3>Impact classification</h3>
      {aiAnalysis.analysis.impact_classifications.length === 0 ? (
        <p className="ai-muted">No impact classifications returned.</p>
      ) : (
        <div className="ai-item-grid">
          {aiAnalysis.analysis.impact_classifications.map((item, index) => {
            const source = sourceById.get(item.source_ref);
            return (
              <article
                className="ai-item-card"
                key={`${item.source_ref}-${index}`}
              >
                <div className="ai-card-top">
                  <span className={`impact-pill ${item.impact_level}`}>
                    {item.impact_level}
                  </span>
                  <span className="citation-chip">{item.source_ref}</span>
                </div>
                <p>{item.reason}</p>
                {source && (
                  <div className="source-excerpt">
                    <strong>Source evidence</strong>
                    <p>{source.text}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>

    <div className="ai-section">
      <div className="ai-section-heading">
        <div>
          <h3>Release briefs</h3>
          <p className="ai-muted">
            Switch between the two audiences to review the proposed messaging.
          </p>
        </div>
        <div className="audience-tabs">
          <button
            type="button"
            className={briefAudience === "technical" ? "selected" : ""}
            onClick={() => setBriefAudience("technical")}
          >
            Technical
          </button>
          <button
            type="button"
            className={briefAudience === "stakeholder" ? "selected" : ""}
            onClick={() => setBriefAudience("stakeholder")}
          >
            Stakeholders
          </button>
        </div>
      </div>

      {visibleBrief.length === 0 ? (
        <div className="ai-empty">
          No statements were generated for this audience.
        </div>
      ) : (
        <div className="statement-list">
          {visibleBrief.map((statement, index) => (
            <article
              className="statement-card"
              key={statement.statement_id || `${briefAudience}-${index}`}
            >
              <div className="statement-header">
                <span className="statement-id">
                  {statement.statement_id}
                </span>
                <span
                className={`status-pill ${
                  statement.review_status === "approved"
                    ? "ready"
                    : statement.review_status === "rejected"
                      ? "rejected"
                      : "incomplete"
                }`}
              >
                {statement.review_status === "approved"
                  ? "Approved"
                  : statement.review_status === "rejected"
                    ? "Rejected"
                    : "Pending review"}
              </span>
              </div>

              <textarea
                className="statement-editor"
                aria-label={`Edit ${statement.statement_id}`}
                value={statement.edited_text ?? statement.text}
                onChange={(event) =>
                  updateStatementDraft(
                    statement.statement_id,
                    event.target.value,
                  )
                }
                rows={3}
              />

              <div className="statement-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy !== ""}
                  onClick={() =>
                    void persistStatementUpdate(statement, {
                      edited_text: statement.edited_text ?? statement.text,
                    })
                  }
                >
                  Save edit
                </button>

                <button
                  className="button button-approve"
                  type="button"
                  disabled={busy !== ""}
                  onClick={() =>
                    void persistStatementUpdate(statement, {
                      edited_text: statement.edited_text ?? statement.text,
                      review_status: "approved",
                    })
                  }
                >
                  ✓ Approve
                </button>

                <button
                  className="button button-reject"
                  type="button"
                  disabled={busy !== ""}
                  onClick={() =>
                    void persistStatementUpdate(statement, {
                      edited_text: statement.edited_text ?? statement.text,
                      review_status: "rejected",
                    })
                  }
                >
                  Reject
                </button>
              </div>


              <div className="statement-meta">
                <span
                  className={`support-pill ${
                    statement.qa_support === "supported"
                      ? "supported"
                      : statement.qa_support === "partially_supported"
                        ? "partial"
                        : statement.qa_support === "unsupported"
                          ? "unsupported"
                          : "neutral"
                  }`}
                >
                  {statement.qa_support.replaceAll("_", " ")}
                </span>
              </div>

              <div className="citation-list">
                <strong>Source references</strong>
                {statement.source_refs.length === 0 ? (
                  <span className="support-pill unsupported">
                    No verified citations
                  </span>
                ) : (
                  statement.source_refs.map((ref) => {
                    const source = sourceById.get(ref);
                    return (
                      <span
                        className="citation-chip"
                        key={ref}
                        title={source?.text ?? "Source not found"}
                      >
                        {ref}
                      </span>
                    );
                  })
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>


{(() => {
  const allStatements = [
    ...aiAnalysis.analysis.technical_brief,
    ...aiAnalysis.analysis.stakeholder_brief,
  ];

  const pendingCount = allStatements.filter(
    (item) =>
      item.review_status !== "approved" &&
      item.review_status !== "rejected",
  ).length;

  const approvedCount = allStatements.filter(
    (item) => item.review_status === "approved",
  ).length;

  return (
    <>
      <div className="ai-section">
        <h3>Final reviewed brief</h3>
        <p className="ai-muted">
          Only approved statements will be included. Rejected statements
          are excluded, and every generated statement must be reviewed.
        </p>

        <div className="finalization-stats">
          <span>{approvedCount} approved</span>
          <span>{pendingCount} pending</span>
          <span>
            {allStatements.filter(
              (item) => item.review_status === "rejected",
            ).length} rejected
          </span>
        </div>

        <button
          className="button button-primary"
          type="button"
          disabled={
            busy !== "" ||
            pendingCount > 0 ||
            approvedCount === 0
          }
          onClick={() => void finalizeReviewedBrief()}
        >
          {busy === "finalize"
            ? "Generating…"
            : "Generate final reviewed brief"}
        </button>

        {pendingCount > 0 && (
          <p className="field-hint">
            Review all {pendingCount} remaining statement(s) before
            generating the final brief.
          </p>
        )}
      </div>

      {finalBrief && (
        <div className="final-brief-output">
          <div className="panel-kicker">
            FINAL BRIEF #{finalBrief.final_brief_id}
          </div>

          <h3>{finalBrief.brief.release_name}</h3>

          <p className="ai-muted">
            Release version {finalBrief.brief.release_version}
            {" · "}
            Created {formatDate(finalBrief.brief.created_at)}
          </p>

          <h4>Technical brief</h4>
          {finalBrief.brief.technical_brief.length === 0 ? (
            <p className="ai-muted">No technical statements were approved.</p>
          ) : (
            finalBrief.brief.technical_brief.map((item) => (
              <article className="final-statement" key={item.statement_id}>
                <p>{item.text}</p>
                <div className="citation-list">
                  {item.source_refs.map((ref) => (
                    <span className="citation-chip" key={ref}>
                      {ref}
                    </span>
                  ))}
                </div>
              </article>
            ))
          )}

          <h4>Stakeholder brief</h4>
          {finalBrief.brief.stakeholder_brief.length === 0 ? (
            <p className="ai-muted">
              No stakeholder statements were approved.
            </p>
          ) : (
            finalBrief.brief.stakeholder_brief.map((item) => (
              <article className="final-statement" key={item.statement_id}>
                <p>{item.text}</p>
                <div className="citation-list">
                  {item.source_refs.map((ref) => (
                    <span className="citation-chip" key={ref}>
                      {ref}
                    </span>
                  ))}
                </div>
              </article>
            ))
          )}

          <button
          type="button"
          className="button button-secondary"
          onClick={() => void copyFinalBrief()}
          disabled={!finalBrief}
        >
          Copy final brief
        </button>
                </div>
      )}
    </>
  );
})()}


<div className="ai-section">
  <h3>Review history</h3>

  {reviewEvents.length === 0 ? (
    <p className="ai-muted">
      No review actions recorded for this analysis yet.
    </p>
  ) : (
    <div className="review-history-list">
      {reviewEvents.map((event) => (
        <div className="review-history-item" key={event.id}>
          <div>
            <strong>
              {event.action.replaceAll("_", " ")}
            </strong>
            <p>
              {event.statement_id ?? "Release-level action"}
              {" · "}
              {event.actor}
            </p>
            <span>{formatDate(event.created_at)}</span>
          </div>
          <details>
            <summary>Details</summary>
            <pre>
              {JSON.stringify(
                { before: event.before, after: event.after },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ))}
    </div>
  )}
</div>

    <div className="ai-section">
      <h3>Risks and limitations</h3>
      {aiAnalysis.analysis.risks_and_limitations.length === 0 ? (
        <p className="ai-muted">No risks were returned. Review the source package for completeness.</p>
      ) : (
        <div className="ai-item-grid">
          {aiAnalysis.analysis.risks_and_limitations.map((risk, index) => (
            <article className="ai-item-card" key={`${risk.description}-${index}`}>
              <div className="ai-card-top">
                <span className={`impact-pill ${risk.severity}`}>
                  {risk.severity} severity
                </span>
              </div>
              <p>{risk.description}</p>
              <div className="citation-list">
                <strong>Sources</strong>
                {risk.source_refs.length === 0
                  ? <span className="support-pill unsupported">No verified citations</span>
                  : risk.source_refs.map((ref) => (
                      <span className="citation-chip" key={ref} title={sourceById.get(ref)?.text ?? ""}>
                        {ref}
                      </span>
                    ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>

    <div className="ai-section">
      <h3>Missing information and clarification questions</h3>
      {aiAnalysis.analysis.missing_information.length === 0 &&
       aiAnalysis.analysis.clarification_questions.length === 0 ? (
        <p className="ai-muted">
          No additional questions were returned. This is not a guarantee that
          the package is complete.
        </p>
      ) : (
        <div className="question-list">
          {aiAnalysis.analysis.missing_information.map((item, index) => (
            <article className="question-item" key={`${item.field}-${index}`}>
              <strong>{item.field.replaceAll("_", " ")}</strong>
              <p>{item.issue}</p>
              <p className="question-text">
                <span>Clarification:</span> {item.clarification_question}
              </p>
            </article>
          ))}
          {aiAnalysis.analysis.clarification_questions.map((question, index) => (
            <article className="question-item" key={`question-${index}`}>
              {question}
            </article>
          ))}
        </div>
      )}
    </div>

    <div className="source-catalog">
      <h3>Source catalogue</h3>
      <p className="ai-muted">
        Hover over a citation ID in the brief to see its source text.
        These IDs refer to the package version analysed above.
      </p>
      <div className="source-list">
        {aiAnalysis.sources.map((source) => (
          <details className="source-row" key={source.id}>
            <summary>
              <span className="citation-chip">{source.id}</span>
              <span>{source.field.replaceAll("_", " ")}</span>
            </summary>
            <p>{source.text}</p>
          </details>
        ))}
      </div>
    </div>
  </section>
)}

        <footer className="page-footer">
          <span>ReleaseReady · Local development</span>
          <span>Evidence first. Human reviewed.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
