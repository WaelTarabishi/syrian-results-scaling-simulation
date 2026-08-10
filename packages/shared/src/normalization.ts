import type { StudentResult } from "./contracts.js";

const WHITESPACE = /\s+/gu;

/**
 * Canonicalizes human-readable identity text without destroying word boundaries.
 * NFKC makes visually equivalent Unicode input deterministic for both backends.
 */
export function normalizePersonName(value: string): string {
  return value.normalize("NFKC").trim().replace(WHITESPACE, " ").toLocaleLowerCase("en-US");
}

/** Student IDs are case-insensitive and may contain accidental whitespace. */
export function normalizeStudentId(value: string): string {
  return value.normalize("NFKC").trim().replace(WHITESPACE, "").toLocaleUpperCase("en-US");
}

/** Optional identity fields preserve the existing student-ID-only lookup behavior. */
export function matchesResultIdentity(
  result: StudentResult,
  studentName: string | undefined,
  fatherName: string | undefined
): boolean {
  return matchesNormalizedIdentity(
    normalizePersonName(result.studentName),
    normalizePersonName(result.fatherName),
    studentName,
    fatherName
  );
}

export function matchesNormalizedIdentity(
  studentNameNormalized: string,
  fatherNameNormalized: string,
  studentName: string | undefined,
  fatherName: string | undefined
): boolean {
  return (
    (studentName === undefined || normalizePersonName(studentName) === studentNameNormalized) &&
    (fatherName === undefined || normalizePersonName(fatherName) === fatherNameNormalized)
  );
}
