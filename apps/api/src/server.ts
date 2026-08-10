import { Pool } from "pg";
import { buildApp } from "./app.js";
import { PostgresResultRepository } from "./repository.js";

const databaseUrl = process.env.DATABASE_URL;
const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10);
const port = Number.parseInt(process.env.API_PORT ?? "3001", 10);
const host = process.env.API_HOST ?? "127.0.0.1";

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in the environment or root .env file");
}

if (!Number.isInteger(poolMax) || poolMax < 1) {
  throw new Error("DATABASE_POOL_MAX must be a positive integer");
}

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("API_PORT must be a valid TCP port");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: poolMax,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000
});
const repository = new PostgresResultRepository(pool);
const app = buildApp({ repository, logger: true });

app.addHook("onClose", async () => {
  await pool.end();
});

await app.listen({ host, port });
