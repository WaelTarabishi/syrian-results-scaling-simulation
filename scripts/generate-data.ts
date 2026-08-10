import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createSyntheticRecords } from "./synthetic-data.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../database/generated");
const outputPath = resolve(outputDirectory, "student-results.json");
const records = createSyntheticRecords();

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

console.log(`Generated ${records.length} synthetic records at ${outputPath}`);
