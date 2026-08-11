import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createK6LookupFixture } from "./k6-fixture.js";
import type { SyntheticStudentRecord } from "./synthetic-data.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(scriptDirectory, "../database/generated/student-results.json");
const outputDirectory = resolve(scriptDirectory, "../load-tests/generated");
const outputPath = resolve(outputDirectory, "student-lookups.json");

const records = JSON.parse(await readFile(inputPath, "utf8")) as SyntheticStudentRecord[];
const fixture = createK6LookupFixture(records);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(fixture)}\n`, "utf8");
console.log(`Generated ${fixture.length} k6 lookup identities at ${outputPath}`);
