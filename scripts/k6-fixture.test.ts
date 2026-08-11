import { describe, expect, it } from "vitest";
import { createK6LookupFixture } from "./k6-fixture.js";
import { createSyntheticRecords } from "./synthetic-data.js";

describe("k6 lookup fixture", () => {
  it("derives lookup identities from the canonical synthetic corpus", () => {
    const records = createSyntheticRecords(3);

    expect(createK6LookupFixture(records)).toEqual(
      records.map(({ studentId, studentName, fatherName }) => ({ studentId, studentName, fatherName }))
    );
  });

  it("rejects an empty corpus", () => {
    expect(() => createK6LookupFixture([])).toThrow("at least one record");
  });
});
