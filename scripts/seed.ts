import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePersonName, normalizeStudentId } from "@edge-results/shared";
import { Client } from "pg";
import type { SyntheticStudentRecord } from "./synthetic-data.js";

const BATCH_SIZE = 500;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(scriptDirectory, "../database/generated/student-results.json");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in the environment or root .env file");
}

const records = JSON.parse(await readFile(inputPath, "utf8")) as SyntheticStudentRecord[];
const client = new Client({ connectionString: databaseUrl });
let transactionStarted = false;

function buildInsert(batch: SyntheticStudentRecord[]): { text: string; values: Array<string | number> } {
  const values: Array<string | number> = [];
  const tuples = batch.map((record, rowIndex) => {
    const offset = rowIndex * 10;
    values.push(
      record.studentId,
      normalizeStudentId(record.studentId),
      record.studentName,
      normalizePersonName(record.studentName),
      record.fatherName,
      normalizePersonName(record.fatherName),
      record.academicYear,
      record.score,
      record.grade,
      record.status
    );
    return `(${Array.from({ length: 10 }, (_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
  });

  return {
    text: `insert into student_results (
      student_id, student_id_normalized, student_name, student_name_normalized,
      father_name, father_name_normalized, academic_year, score, grade, status
    ) values ${tuples.join(", ")}`,
    values
  };
}

try {
  await client.connect();
  await client.query("begin");
  transactionStarted = true;
  await client.query("truncate table student_results restart identity");

  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    await client.query(buildInsert(batch));
  }

  await client.query("commit");
  transactionStarted = false;
  console.log(`Seeded ${records.length} synthetic records into PostgreSQL`);
} catch (error) {
  if (transactionStarted) {
    await client.query("rollback");
  }
  throw error;
} finally {
  await client.end();
}
