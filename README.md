# edge-results-benchmark

A portfolio project for comparing two read paths for a synthetic student-results workload:

```text
Traditional: k6 -> Fastify API -> PostgreSQL
Edge:        k6 -> Cloudflare Worker -> Workers KV
```

Phases 1 and 2 are implemented. The repository contains the shared behavior, synthetic dataset, PostgreSQL-backed traditional API, and a Cloudflare Worker backed only by Workers KV. The k6 suites, web interface, and measured benchmark report are intentionally deferred to later phases.

> All names, IDs, and results in this repository are deterministic synthetic data. Never import or test with real student data.

## Final architecture

One deterministic generator produces the canonical corpus used by both storage systems and by k6. Shared TypeScript owns normalization and the HTTP response types, which prevents the two implementations from quietly diverging.

```text
                         deterministic synthetic corpus
                         /            |              \
                        v             v               v
                 PostgreSQL       Workers KV       k6 ID pool
                      ^                ^
                      |                |
k6 / React UI -> Fastify API     Cloudflare Worker
                    traditional          edge
```

The traditional API performs one parameterized lookup through a bounded PostgreSQL connection pool. The normalized ID has a unique constraint, which also supplies its B-tree lookup index.

The Worker normalizes the ID with the same shared function and derives a key in this form:

```text
result:v1:<HMAC-SHA-256(LOOKUP_KEY_SECRET, normalizedStudentId)>
```

The secret-keyed digest is deterministic but does not expose predictable raw IDs in KV. This is appropriate for a demo lookup key, not a substitute for authentication or authorization. The Worker will have a KV binding only—no API service binding or origin URL. An edge read can therefore be demonstrated while the API and PostgreSQL are stopped.

## API contract

Lookup:

```http
GET /api/result?studentId=STU-000001
```

`studentName` and `fatherName` are optional, backward-compatible verification fields. When present, both are normalized and must match the stored synthetic record. A mismatch returns the same `RESULT_NOT_FOUND` response as an unknown ID:

```http
GET /api/result?studentId=STU-000001&studentName=Lina%20Haddad&fatherName=Fadi%20Haddad
```

Successful response (`200`):

```json
{
  "success": true,
  "data": {
    "studentId": "STU-000001",
    "studentName": "Lina Haddad",
    "fatherName": "Fadi Haddad",
    "academicYear": "2025-2026",
    "score": 45,
    "grade": "F",
    "status": "fail"
  }
}
```

Errors use the same envelope in both architectures:

```json
{
  "success": false,
  "error": {
    "code": "RESULT_NOT_FOUND",
    "message": "No result was found for that student ID"
  }
}
```

The stable error codes are `INVALID_REQUEST`, `RESULT_NOT_FOUND`, and `INTERNAL_ERROR`.

## Normalization rules

- Student ID: Unicode NFKC, trim, remove all whitespace, uppercase with the `en-US` locale.
- Student and father names: Unicode NFKC, trim, collapse whitespace, lowercase with the `en-US` locale for their stored normalized forms.
- Display values retain their generated capitalization.

The endpoint indexes by student ID. Optional student and father names verify the record after lookup; normalized names are stored with both PostgreSQL and KV data so ingestion rules do not diverge.

## Repository structure

```text
apps/
  api/                    # Fastify/PostgreSQL implementation
  web/                    # Phase 4 React/Vite UI
  worker/                 # Cloudflare Worker/Workers KV implementation
packages/
  shared/                 # Normalization and response contract
scripts/                  # Deterministic generation, migration, and seed tools
load-tests/               # Phase 3 k6 scenarios and shared ID fixture
database/
  migrations/             # PostgreSQL schema
  generated/              # Local generated corpus (gitignored)
  observability.sql       # pg_stat_statements and connection queries
results/                  # Phase 5 raw and summarized benchmark output
```

## Phase 1 quick start

Prerequisites: Node.js 22+, npm, Docker, and Docker Compose.

```powershell
npm install
npm run db:up
npm run db:prepare
npm run dev:api
```

Copy `.env.example` to `.env`, then choose a local password and keep `DATABASE_URL` consistent with `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. Docker Compose reads `.env` automatically, and the npm development commands load the same file. The API serves on `http://localhost:3001` unless `API_PORT` is changed.

Try a normalized lookup:

```powershell
Invoke-RestMethod 'http://localhost:3001/api/result?studentId=%20stu-%20000001%20'
```

Stop local PostgreSQL without deleting its named volume:

```powershell
npm run db:down
```

### Commands

| Command | Purpose |
|---|---|
| `npm run data:generate` | Write exactly 10,000 deterministic fake records to `database/generated/student-results.json`. |
| `npm run kv:generate` | Convert that corpus into HMAC-keyed Wrangler bulk KV entries. |
| `npm run db:migrate` | Apply the idempotent Phase 1 schema and enable `pg_stat_statements`. |
| `npm run db:seed` | Replace table contents from the generated corpus in 500-row batches. |
| `npm run db:prepare` | Migrate, generate, and seed in order. |
| `npm run dev:api` | Run Fastify in watch mode. |
| `npm run worker:kv:local` | Load the generated KV entries into Wrangler's local KV state. |
| `npm run worker:dev` | Run the Worker locally on `http://localhost:8787`. |
| `npm run worker:kv:remote` | Upload the generated KV entries to the configured Cloudflare namespace. |
| `npm run worker:deploy` | Deploy the Worker with Wrangler. |
| `npm run test:worker` | Run the Worker lookup and normalization tests. |
| `npm run build` | Build the shared package and type-check both implementations. |
| `npm test` | Run normalization, generator, and HTTP contract tests. |
| `npm run typecheck` | Strictly type-check packages and scripts. |
| `npm run verify:phase1` | Run type-checking, all tests, and production builds. |
| `npm run verify:phase2` | Verify shared, traditional API, Worker, scripts, and builds. |

## Phase 2 Worker quick start

The generated KV keys depend on `LOOKUP_KEY_SECRET`, so the converter and Worker must use exactly the same value. Put a long random development value in the root `.env` file. Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` and put that same value there. Both files are ignored by Git.

Generate the canonical synthetic corpus, convert it to Wrangler's bulk KV format, populate local KV, and start the Worker:

```powershell
npm run data:generate
npm run kv:generate
npm run worker:kv:local
npm run worker:dev
```

Wrangler's local KV simulation is independent of PostgreSQL. With Fastify and PostgreSQL stopped, this request still succeeds:

```powershell
Invoke-RestMethod 'http://localhost:8787/api/result?studentId=STU-000001&studentName=Lina%20Haddad&fatherName=Fadi%20Haddad'
```

### Cloudflare deployment

Authenticate Wrangler and create the remote KV namespace:

```powershell
npx wrangler login
npx wrangler kv namespace create RESULTS_KV --config apps/worker/wrangler.jsonc
```

Copy the namespace ID printed by Wrangler over the placeholder `id` in `apps/worker/wrangler.jsonc`. Keep the same `LOOKUP_KEY_SECRET` in the root `.env`, generate and upload the entries, then deploy the Worker and enter that same secret when prompted:

```powershell
npm run data:generate
npm run kv:generate
npm run worker:kv:remote
npm run worker:deploy
npx wrangler secret put LOOKUP_KEY_SECRET --config apps/worker/wrangler.jsonc
```

Changing the HMAC secret changes every KV key. Rotate it only by regenerating and republishing the complete corpus with the new value before switching the Worker secret. Cloudflare KV is eventually consistent, so secret rotation and dataset replacement should be treated as a coordinated deployment rather than an atomic update.

## Observing the traditional path

PostgreSQL starts with `pg_stat_statements` and I/O timing enabled. During a later k6 run, use separate terminals for container resource usage and database activity:

```powershell
docker stats
Get-Content database/observability.sql | docker compose exec -T postgres psql -U benchmark -d results_benchmark
```

Reset statement statistics immediately before a measured run:

```powershell
docker compose exec postgres psql -U benchmark -d results_benchmark -c "select pg_stat_statements_reset();"
```

Record API process CPU and memory as well as PostgreSQL container CPU, memory, active connections, query calls, mean execution time, and total execution time. Connection-pool size is an experimental parameter and must stay fixed across repeated traditional runs.

## Benchmark methodology

The later benchmark implementation will follow these rules:

1. Generate the corpus once, then publish that exact file to PostgreSQL and KV.
2. Generate the k6 student-ID pool from the same corpus; do not create users independently inside each test.
3. Give both endpoints identical methods, query parameters, status codes, JSON fields, headers where practical, and hit/miss distribution.
4. Run smoke, load, stress, and spike profiles separately. Include a warm-up that is excluded from reported samples.
5. Run both targets from the same k6 generator and region, alternate target order, and repeat each measured scenario at least three times.
6. Pin infrastructure sizes, pool settings, Worker/KV configuration, dataset version, k6 version, date, and generator location in every result report.
7. Capture k6 `http_reqs`, `http_req_duration` p(50)/p(95)/p(99), and `http_req_failed`, with explicit thresholds. Save raw summaries under `results/`.
8. Track the offered request rate and dropped iterations. A saturated load generator is not evidence that either backend saturated.
9. Report cold and warm behavior separately. Do not silently combine cold starts, DNS/TLS setup, and steady-state latency.
10. For the edge-only proof, stop Fastify and PostgreSQL, perform successful Worker reads, and corroborate zero traditional-path activity with API logs and PostgreSQL statement counters.

### Benchmarking mistakes to avoid

- Comparing different records, payload sizes, success rates, or lookup distributions.
- Letting a CDN or local proxy cache one architecture but not the other.
- Using only a tiny hot-key set; KV and database cache warmth can dominate the result.
- Using only uniformly random keys; real result-release traffic may be much more skewed.
- Ignoring database connection-pool waiting, client timeouts, rate limits, or k6 dropped iterations.
- Treating one run, one client geography, or a laptop Docker result as universal capacity.
- Reporting average latency alone. Tail latency and error rate are central scalability results.
- Changing application logging or observability overhead between compared runs.
- Claiming causal superiority when the architectures have different consistency, cost, and operational trade-offs.

## Implementation phases

### Phase 1 — traditional baseline (implemented)

- npm TypeScript workspace and shared contract
- Docker Compose PostgreSQL with health check and observability settings
- constrained, indexed schema
- deterministic 10,000-record fake-data generator and batched seed
- pooled Fastify `/api/result` endpoint
- normalization, generator, and HTTP contract tests

### Phase 2 — edge implementation (implemented)

- Cloudflare Worker and Wrangler configuration
- portable HMAC lookup-key helper and fixed secret handling
- KV publisher reading the canonical generated corpus
- Worker endpoint with the exact Phase 1 response contract
- contract tests run against both implementations
- explicit proof that Worker reads have no origin dependency

### Phase 3 — load testing

- one shared k6 data fixture
- smoke, load, stress, and spike executors
- fixed thresholds and summary export for requests/sec, p50, p95, p99, and error rate
- reproducible run metadata and traditional-path resource capture

### Phase 4 — frontend

- small React/Vite form for student ID
- backend selector for Traditional or Edge
- accessible loading, result, not-found, and failure states

### Phase 5 — experiments and report

- repeated controlled runs
- raw result artifacts and comparison table
- interpretation of saturation points, tail latency, errors, resource use, consistency, cost, and limitations

## Current limitations

- No k6 suites or React application exists yet.
- Workers KV is eventually consistent; the Worker is not suitable for immediate cross-region read-after-write workflows.
- HMAC lookup keys reduce raw-ID exposure in KV tooling, but the unauthenticated demo endpoint is not a production privacy boundary.
- No comparative performance result is claimed yet.
- The schema models one result per student ID and one academic year for a focused read benchmark, not a production education domain.
- There is no authentication. A real results system must add authorization, privacy controls, audit logging, key rotation, retention policy, and abuse protection.
- Synthetic names intentionally repeat and must never be mistaken for a production-like identity model.
- Local Docker measurements are useful for repeatable development, not a substitute for controlled hosted infrastructure.
