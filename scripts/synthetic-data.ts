import type { ResultStatus } from "@edge-results/shared";

export interface SyntheticStudentRecord {
  studentId: string;
  studentName: string;
  fatherName: string;
  academicYear: string;
  score: number;
  grade: string;
  status: ResultStatus;
}

const FIRST_NAMES = [
  "Lina", "Omar", "Maya", "Sami", "Nour", "Tariq", "Rana", "Yousef", "Dalia", "Karim",
  "Hala", "Ziad", "Salma", "Nadim", "Reem", "Amin", "Leila", "Faris", "Mira", "Walid"
] as const;
const FATHER_NAMES = [
  "Adel", "Bassam", "Fadi", "Ghassan", "Hani", "Jamal", "Khaled", "Maher", "Nabil", "Rami",
  "Samir", "Talal", "Wael", "Zaki", "Anwar", "Bilal", "Fouad", "Ibrahim", "Munir"
] as const;
const LAST_NAMES = [
  "Haddad", "Khoury", "Nasser", "Saleh", "Darwish", "Hamdan", "Mansour", "Khalil", "Rahman",
  "Yasin", "Abboud", "Bakri", "Chami", "Daher", "Eid", "Habib", "Jaber"
] as const;

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 85) return "B+";
  if (score >= 80) return "B";
  if (score >= 75) return "C+";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function createSyntheticRecords(count = 10_000): SyntheticStudentRecord[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }

  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const lastName = LAST_NAMES[(index * 7) % LAST_NAMES.length]!;
    const firstName = FIRST_NAMES[(index * 3) % FIRST_NAMES.length]!;
    const fatherFirstName = FATHER_NAMES[(index * 9 + 2) % FATHER_NAMES.length]!;
    const score = 45 + ((index * 137) % 551) / 10;

    return {
      studentId: `STU-${sequence.toString().padStart(6, "0")}`,
      studentName: `${firstName} ${lastName}`,
      fatherName: `${fatherFirstName} ${lastName}`,
      academicYear: "2025-2026",
      score,
      grade: gradeFor(score),
      status: score >= 60 ? "pass" : "fail"
    };
  });
}
