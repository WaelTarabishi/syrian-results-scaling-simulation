import { useEffect, useRef, useState, type FormEvent } from "react";
import { lookupResult, type Backend } from "./client";
import { CloudIcon, DatabaseIcon, LockIcon, SearchIcon } from "./icons";
import { ResultPanel, type ViewState } from "./ResultPanel";
import { sanitizeStudentIdDigits, toCanonicalStudentId } from "./student-id";

export function App() {
  const [backend, setBackend] = useState<Backend>("traditional");
  const [studentId, setStudentId] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function submitLookup(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const requestedId = toCanonicalStudentId(studentId);
    if (requestedId === null) return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ kind: "loading" });

    try {
      const outcome = await lookupResult(backend, requestedId, controller.signal);
      if (controller.signal.aborted) return;
      setState(outcome);
    } catch {
      if (controller.signal.aborted) return;
      setState({ kind: "failure", message: "We couldn’t reach the selected backend." });
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  function chooseBackend(nextBackend: Backend) {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBackend(nextBackend);
    setState({ kind: "idle" });
  }

  const isLoading = state.kind === "loading";
  const isStudentIdComplete = toCanonicalStudentId(studentId) !== null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Result Relay home">Result Relay</a>
      </header>

      <main className="main-layout">
        <section className="intro" aria-labelledby="page-title">
          <h1 id="page-title">Check a<br />synthetic result</h1>
          <span className="title-rule" aria-hidden="true" />
          <p>Choose a backend and enter a generated student ID.</p>
          <div className="privacy-note"><LockIcon /> Synthetic data only</div>
        </section>

        <section className="lookup-panel" aria-label="Student result lookup">
          <form onSubmit={submitLookup}>
            <fieldset className="backend-fieldset" disabled={isLoading}>
              <legend>Backend</legend>
              <div className="backend-options">
                <label className={backend === "traditional" ? "backend-option is-selected" : "backend-option"}>
                  <input
                    type="radio"
                    name="backend"
                    value="traditional"
                    checked={backend === "traditional"}
                    onChange={() => chooseBackend("traditional")}
                  />
                  <DatabaseIcon className="backend-icon" />
                  <span><strong>Traditional</strong><small>PostgreSQL API</small></span>
                </label>
                <label className={backend === "edge" ? "backend-option is-selected" : "backend-option"}>
                  <input
                    type="radio"
                    name="backend"
                    value="edge"
                    checked={backend === "edge"}
                    onChange={() => chooseBackend("edge")}
                  />
                  <CloudIcon className="backend-icon" />
                  <span><strong>Edge</strong><small>Workers KV</small></span>
                </label>
              </div>
            </fieldset>

            <div className="student-field">
              <label htmlFor="student-id">Student ID</label>
              <div className="student-id-control">
                <span className="student-id-prefix" aria-hidden="true">STU-</span>
                <input
                  id="student-id"
                  name="studentId"
                  value={studentId}
                  onChange={(event) => setStudentId(sanitizeStudentIdDigits(event.target.value))}
                  placeholder="000001"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="student-id-hint"
                  required
                  disabled={isLoading}
                />
              </div>
              <small id="student-id-hint">Enter the six digits shown after STU-.</small>
            </div>

            <button className="submit-button" type="submit" disabled={isLoading || !isStudentIdComplete}>
              <span>{isLoading ? "Finding result…" : "Find result"}</span>
              {isLoading ? <span className="button-spinner" aria-hidden="true" /> : <SearchIcon />}
            </button>
          </form>

          <ResultPanel state={state} onRetry={() => void submitLookup()} />
        </section>
      </main>
    </div>
  );
}
