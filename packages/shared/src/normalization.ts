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
