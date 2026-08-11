import type { SyntheticStudentRecord } from "./synthetic-data.js";

export interface K6StudentLookup {
  studentId: string;
  studentName: string;
  fatherName: string;
}

export function createK6LookupFixture(records: SyntheticStudentRecord[]): K6StudentLookup[] {
  if (records.length === 0) {
    throw new Error("The synthetic corpus must contain at least one record");
  }

  return records.map(({ studentId, studentName, fatherName }) => ({
    studentId,
    studentName,
    fatherName
  }));
}
