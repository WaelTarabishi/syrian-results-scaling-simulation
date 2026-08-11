import type { StudentResult } from "@edge-results/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultPanel, type ViewState } from "./ResultPanel";

const result: StudentResult = {
  studentId: "STU-000001",
  studentName: "Lina Haddad",
  fatherName: "Fadi Haddad",
  academicYear: "2025-2026",
  score: 45,
  grade: "F",
  status: "fail"
};

function renderState(state: ViewState): string {
  return renderToStaticMarkup(<ResultPanel state={state} onRetry={() => undefined} />);
}

describe("ResultPanel", () => {
  it("announces loading and marks the region busy", () => {
    const html = renderState({ kind: "loading" });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Finding the result");
  });

  it("renders the complete shared result contract", () => {
    const html = renderState({ kind: "success", result });
    expect(html).toContain("Lina Haddad");
    expect(html).toContain("STU-000001");
    expect(html).toContain("2025-2026");
    expect(html).toContain("Not passed");
  });

  it("gives not-found and failure states distinct accessible messages", () => {
    expect(renderState({ kind: "not-found" })).toContain("Result not found");
    const failure = renderState({ kind: "failure", message: "Network unavailable" });
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("Network unavailable");
    expect(failure).toContain("Try again");
  });
});
