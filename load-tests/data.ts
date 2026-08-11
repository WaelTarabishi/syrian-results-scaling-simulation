import { SharedArray } from "k6/data";

export interface StudentLookup {
  studentId: string;
  studentName: string;
  fatherName: string;
}

export const studentLookups = new SharedArray<StudentLookup>("synthetic student lookup identities", () => {
  const parsed = JSON.parse(open("./generated/student-lookups.json")) as StudentLookup[];
  if (parsed.length === 0) {
    throw new Error("The k6 lookup fixture is empty; run npm run k6:fixture");
  }
  return parsed;
});
