import type { StudentResult } from "@edge-results/shared";
import { AlertIcon, CheckIcon, EmptyIcon } from "./icons";

export type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: StudentResult }
  | { kind: "not-found" }
  | { kind: "failure"; message: string };

interface ResultPanelProps {
  state: ViewState;
  onRetry: () => void;
}

function StatusMessage({
  icon,
  title,
  children,
  tone = "neutral",
  role
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "danger";
  role?: "alert";
}) {
  return (
    <div className={`status-message status-message--${tone}`} role={role}>
      <span className="status-message__icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ResultPanel({ state, onRetry }: ResultPanelProps) {
  if (state.kind === "loading") {
    return (
      <div className="result-region" aria-live="polite" aria-busy="true">
        <div className="loading-state">
          <span className="spinner" aria-hidden="true" />
          <div>
            <h2>Finding the result</h2>
            <p>Checking the selected backend…</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "success") {
    const { result } = state;
    return (
      <div className="result-region" aria-live="polite">
        <div className="result-heading">
          <h2>Result</h2>
          <span className="found-status"><CheckIcon /> Found</span>
        </div>
        <dl className="result-details">
          <div><dt>Student</dt><dd>{result.studentName}</dd></div>
          <div><dt>Student ID</dt><dd>{result.studentId}</dd></div>
          <div><dt>Academic year</dt><dd>{result.academicYear}</dd></div>
          <div><dt>Score</dt><dd>{result.score}</dd></div>
          <div><dt>Grade</dt><dd>{result.grade}</dd></div>
          <div>
            <dt>Status</dt>
            <dd className={`result-status result-status--${result.status}`}>
              {result.status === "pass" ? "Passed" : "Not passed"}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  if (state.kind === "not-found") {
    return (
      <div className="result-region" aria-live="polite">
        <StatusMessage icon={<EmptyIcon />} title="Result not found">
          Check the student ID and try again.
        </StatusMessage>
      </div>
    );
  }

  if (state.kind === "failure") {
    return (
      <div className="result-region" aria-live="assertive">
        <StatusMessage icon={<AlertIcon />} title="Service unavailable" tone="danger" role="alert">
          {state.message}
        </StatusMessage>
        <button className="retry-button" type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  return (
    <div className="result-region result-region--idle" aria-live="polite">
      <StatusMessage icon={<EmptyIcon />} title="Ready to search">
        Your synthetic result will appear here.
      </StatusMessage>
    </div>
  );
}
