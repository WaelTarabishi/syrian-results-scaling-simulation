import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client, type QueryResultRow } from "pg";

interface DatabaseStatisticsRow extends QueryResultRow {
  database_name: string;
  connections: number;
  transactions_committed: string;
  transactions_rolled_back: string;
  blocks_read: string;
  blocks_hit: string;
  tuples_returned: string;
  tuples_fetched: string;
}

interface StatementStatisticsRow extends QueryResultRow {
  calls: string;
  total_exec_time_ms: string;
  mean_exec_time_ms: string;
  rows: string;
  shared_blocks_hit: string;
  shared_blocks_read: string;
}

interface ActivityStatisticsRow extends QueryResultRow {
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  connections: string;
}

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const resultsDirectory = resolve(repositoryRoot, "results");
const databaseUrl = process.env.DATABASE_URL;
const requestedRunId = process.env.K6_RUN_ID?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in the environment or root .env file");
}
if (!requestedRunId) {
  throw new Error("K6_RUN_ID must match the k6 run being captured");
}

const runId = requestedRunId.replace(/[^a-zA-Z0-9._-]/gu, "-");
const outputPath = resolve(resultsDirectory, `${runId}.traditional-resources.json`);
const client = new Client({ connectionString: databaseUrl });

try {
  const composeResult = await execFileAsync("docker", ["compose", "ps", "-q", "postgres"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  const containerId = composeResult.stdout.trim();
  if (!containerId) {
    throw new Error("The PostgreSQL Docker Compose service is not running");
  }

  const dockerResult = await execFileAsync(
    "docker",
    ["stats", "--no-stream", "--format", "{{json .}}", containerId],
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  const dockerStatistics = JSON.parse(dockerResult.stdout.trim()) as Record<string, string>;

  await client.connect();
  const databaseStatistics = await client.query<DatabaseStatisticsRow>(`
    select
      datname as database_name,
      numbackends as connections,
      xact_commit as transactions_committed,
      xact_rollback as transactions_rolled_back,
      blks_read as blocks_read,
      blks_hit as blocks_hit,
      tup_returned as tuples_returned,
      tup_fetched as tuples_fetched
    from pg_stat_database
    where datname = current_database()
  `);
  const statementStatistics = await client.query<StatementStatisticsRow>(`
    select
      calls,
      round(total_exec_time::numeric, 2) as total_exec_time_ms,
      round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
      rows,
      shared_blks_hit as shared_blocks_hit,
      shared_blks_read as shared_blocks_read
    from pg_stat_statements
    where query ilike '%student_results%'
    order by total_exec_time desc
  `);
  const activityStatistics = await client.query<ActivityStatisticsRow>(`
    select state, wait_event_type, wait_event, count(*) as connections
    from pg_stat_activity
    where datname = current_database()
    group by state, wait_event_type, wait_event
    order by count(*) desc
  `);

  const report = {
    runId,
    capturedAt: new Date().toISOString(),
    docker: dockerStatistics,
    postgres: {
      database: databaseStatistics.rows[0] ?? null,
      statements: statementStatistics.rows,
      activity: activityStatistics.rows
    }
  };

  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Captured traditional-path metrics at ${outputPath}`);
} finally {
  await client.end();
}
