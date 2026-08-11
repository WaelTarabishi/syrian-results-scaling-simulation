export const STUDENT_ID_DIGIT_COUNT = 6;

export function sanitizeStudentIdDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, STUDENT_ID_DIGIT_COUNT);
}

export function toCanonicalStudentId(digits: string): string | null {
  return digits.length === STUDENT_ID_DIGIT_COUNT ? `STU-${digits}` : null;
}
