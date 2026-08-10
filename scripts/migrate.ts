import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(scriptDirectory, "../database/migrations/001_create_student_results.sql");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in the environment or root .env file");
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query(await readFile(migrationPath, "utf8"));
  console.log("Applied database migration 001_create_student_results.sql");
} finally {
  await client.end();
}
