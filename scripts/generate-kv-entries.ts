import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createResultLookupKey,
  normalizePersonName,
  type KvStudentResult
} from "@edge-results/shared";
import type { SyntheticStudentRecord } from "./synthetic-data.js";

interface KvBulkEntry {
  key: string;
  value: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(scriptDirectory, "../database/generated/student-results.json");
const outputDirectory = resolve(scriptDirectory, "../database/generated");
const outputPath = resolve(outputDirectory, "student-results.kv.json");
const secret = process.env.LOOKUP_KEY_SECRET;

if (!secret) {
  throw new Error("LOOKUP_KEY_SECRET must be set in the environment or root .env file");
}

const records = JSON.parse(await readFile(inputPath, "utf8")) as SyntheticStudentRecord[];
const entries: KvBulkEntry[] = await Promise.all(
  records.map(async (record) => {
    const value: KvStudentResult = {
      data: record,
      studentNameNormalized: normalizePersonName(record.studentName),
      fatherNameNormalized: normalizePersonName(record.fatherName)
    };

    return {
      key: await createResultLookupKey(secret, record.studentId),
      value: JSON.stringify(value)
    };
  })
);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
console.log(`Generated ${entries.length} Workers KV entries at ${outputPath}`);
