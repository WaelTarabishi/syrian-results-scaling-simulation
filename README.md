# edge-results-benchmark

A portfolio project for comparing two read paths for a synthetic student-results workload:

```text
Traditional: k6 -> Fastify API -> PostgreSQL
Edge:        k6 -> Cloudflare Worker -> Workers KV
```

Phases 1 through 4 are implemented. The repository contains the shared behavior, synthetic dataset, PostgreSQL-backed traditional API, Cloudflare Worker backed only by Workers KV, equivalent k6 workload profiles, and a React interface for selecting either lookup path. The measured comparison report is intentionally deferred to Phase 5.

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
| `npm run dev:web` | Run the React/Vite interface on `http://127.0.0.1:5173`. |
| `npm run worker:kv:local` | Load the generated KV entries into Wrangler's local KV state. |
| `npm run worker:dev` | Run the Worker locally on `http://localhost:8787`. |
| `npm run worker:kv:remote` | Upload the generated KV entries to the configured Cloudflare namespace. |
| `npm run worker:deploy` | Deploy the Worker with Wrangler. |
| `npm run test:worker` | Run the Worker lookup and normalization tests. |
| `npm run k6:fixture` | Derive the shared k6 identity pool from the canonical synthetic corpus. |
| `npm run k6:inspect` | Parse and inspect the smoke suite without sending requests. |
| `npm run k6:smoke` | Run the low-rate correctness profile against the selected target. |
| `npm run k6:load` | Run the sustained 50 requests/second profile. |
| `npm run k6:stress` | Ramp from 25 to 300 requests/second. |
| `npm run k6:spike` | Jump from 20 to 400 requests/second and recover. |
| `npm run benchmark:capture:traditional` | Save PostgreSQL and container metrics for the current `K6_RUN_ID`. |
| `npm run ec2:provision` | Provision and bootstrap the traditional API/PostgreSQL path on EC2. |
| `npm run ec2:status` | Print the EC2 instance state, API URL, and Session Manager command. |
| `npm run ec2:connect` | Open a Session Manager shell without exposing SSH. |
| `npm run ec2:destroy` | Delete the benchmark CloudFormation stack after explicit confirmation. |
| `npm run build` | Build the shared package and type-check both implementations. |
| `npm test` | Run normalization, generator, and HTTP contract tests. |
| `npm run typecheck` | Strictly type-check packages and scripts. |
| `npm run verify:phase1` | Run type-checking, all tests, and production builds. |
| `npm run verify:phase2` | Verify shared, traditional API, Worker, scripts, and builds. |
| `npm run verify:phase3` | Verify the full repository, generate the k6 fixture, and inspect the suite. |
| `npm run verify:phase4` | Type-check, test, and production-build the complete repository including the web interface. |

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

Copy the namespace ID printed by Wrangler over the placeholder `id` in `apps/worker/wrangler.jsonc`. Keep the same `LOOKUP_KEY_SECRET` in the root `.env` and `apps/worker/.dev.vars`, then generate and upload the entries. A Worker's first deployment must supply its required secret with the code:

```powershell
npm run data:generate
npm run kv:generate
npm run worker:kv:remote
npx --no-install wrangler deploy --config apps/worker/wrangler.jsonc --secrets-file apps/worker/.dev.vars
```

After the first deployment, `npm run worker:deploy` updates the code while preserving the configured secret.

Changing the HMAC secret changes every KV key. Rotate it only by regenerating and republishing the complete corpus with the new value before switching the Worker secret. Cloudflare KV is eventually consistent, so secret rotation and dataset replacement should be treated as a coordinated deployment rather than an atomic update.

## Phase 3 load testing

Prerequisites are k6 1.7 or newer and a prepared canonical corpus. Generate the small lookup-only fixture from the exact corpus used by PostgreSQL and KV:

```powershell
npm run data:generate
npm run k6:fixture
```

Every profile uses the same TypeScript request function, deterministic record order, complete student/father-name inputs, and a default 5% expected not-found distribution. Expected `404` responses are contract-checked but are not counted as HTTP failures. A separate 5 requests/second, 10-second warm-up runs first; all thresholds and report fields select only `phase:measured` metrics.

| Profile | Measured offered load | Purpose |
|---|---:|---|
| Smoke | 1 request/second for 10 seconds | Verify connectivity, response contracts, and configuration; do not use its tiny sample for performance conclusions. |
| Load | 50 requests/second for 3 minutes | Measure a steady, controlled offered rate. |
| Stress | Ramp 25 → 50 → 100 → 200 → 300 requests/second over 4 minutes, then ramp down for 30 seconds | Find degradation and saturation behavior. |
| Spike | Hold 20, jump to 400 for 30 seconds, then return to 20 requests/second | Measure sudden-load response and recovery. |

Measured thresholds are fixed for both targets: HTTP and contract failure rates below 1%, check success above 99%, p95 below 1,000 ms, p99 below 2,000 ms, at least one request, and zero dropped iterations. A threshold failure is a result to investigate, especially for stress and spike; it does not make runs incomparable.

### Run k6 against the local traditional API

PowerShell environment variables remain set for the current terminal session. Set `K6_TARGET` and `K6_BASE_URL` explicitly before every run so that a previous edge test does not accidentally send the next test to the deployed Worker.

In the first terminal, prepare PostgreSQL and start the traditional API. `db:prepare` is only required initially or when the synthetic database needs to be rebuilt; keep `dev:api` running while k6 executes:

```powershell
npm run db:up
npm run db:prepare
npm run dev:api
```

In a second terminal, generate the lookup fixture and run a local smoke test:

```powershell
npm run k6:fixture

$env:K6_TARGET = 'traditional'
$env:K6_BASE_URL = 'http://127.0.0.1:3001'
$env:K6_RUN_ID = 'traditional-local-smoke-1'
$env:K6_GENERATOR_LOCATION = 'local-windows'

npm run k6:smoke
```

To see a live dashboard and export a self-contained HTML report, enable k6's built-in web dashboard before running the test:

```powershell
$env:K6_WEB_DASHBOARD = 'true'
$env:K6_WEB_DASHBOARD_PERIOD = '1s'
$env:K6_WEB_DASHBOARD_EXPORT = "results/$($env:K6_RUN_ID).html"

npm run k6:smoke
```

Open `http://127.0.0.1:5665` while the test is running. The run writes the machine-readable summary to `results/traditional-local-smoke-1.summary.json` and the shareable dashboard to `results/traditional-local-smoke-1.html`. The HTML report is for visualization; the `measured` section of the JSON summary remains the authoritative aggregate result because it excludes warm-up traffic.

Set the target explicitly before every run. For the traditional API:

```powershell
$env:K6_TARGET = 'traditional'
$env:K6_BASE_URL = 'http://127.0.0.1:3001'
$env:K6_RUN_ID = 'traditional-smoke-1'
$env:K6_GENERATOR_LOCATION = 'local-windows'
npm run k6:smoke
```

For the deployed Worker:

```powershell
$env:K6_TARGET = 'edge'
$env:K6_BASE_URL = 'https://edge-results-worker.<your-subdomain>.workers.dev'
$env:K6_RUN_ID = 'edge-smoke-1'
$env:K6_GENERATOR_LOCATION = 'local-windows'
npm run k6:smoke
```

Replace `k6:smoke` with `k6:load`, `k6:stress`, or `k6:spike`. Optional variables are `K6_MISS_PERCENT` (integer 0–100, default 5), `K6_REQUEST_TIMEOUT` (default `10s`), and `K6_DATASET_VERSION` (default `synthetic-v1`). Each run writes `results/<K6_RUN_ID>.summary.json` containing metadata, measured p50/p95/p99, achieved request rate, failures, checks, dropped iterations, hit/miss counts, and the full k6 end-of-test summary.

Run each measured profile at least three times per target, alternate target order, and use unique IDs such as `traditional-load-1`, `edge-load-1`, `edge-load-2`, and `traditional-load-2`. Keep the generator machine and location, corpus, hit/miss ratio, traditional pool size, logging, and infrastructure unchanged.

For a traditional run, reset PostgreSQL statement counters immediately before k6 and capture the aggregate database/container snapshot immediately afterward, keeping the same `K6_RUN_ID`:

```powershell
docker compose exec postgres psql -U benchmark -d results_benchmark -c "select pg_stat_statements_reset();"
npm run k6:load
npm run benchmark:capture:traditional
```

This writes `results/<K6_RUN_ID>.traditional-resources.json`. Monitor the Fastify process concurrently with `Get-Process -Id <API_PID>` and record representative CPU/memory samples; a single post-run process value does not represent utilization during the run.

## Observing the traditional path

PostgreSQL starts with `pg_stat_statements` and I/O timing enabled. During a k6 run, use separate terminals for container resource usage and database activity:

```powershell
docker stats
Get-Content database/observability.sql | docker compose exec -T postgres psql -U benchmark -d results_benchmark
```

Reset statement statistics immediately before a measured run:

```powershell
docker compose exec postgres psql -U benchmark -d results_benchmark -c "select pg_stat_statements_reset();"
```

Record API process CPU and memory as well as PostgreSQL container CPU, memory, active connections, query calls, mean execution time, and total execution time. Connection-pool size is an experimental parameter and must stay fixed across repeated traditional runs.

## EC2 traditional-path deployment

The TypeScript provisioning command creates one Amazon Linux 2023 EC2 instance for the traditional benchmark path. CloudFormation owns the instance, encrypted 20 GB gp3 root volume, security group, Systems Manager role, optional SSH key-pair attachment, and optional Secrets Manager read permission. EC2 bootstrap installs Docker, Git, Node.js 22, and npm; clones the selected repository branch; creates instance-local random development secrets; generates and seeds the deterministic synthetic corpus; and starts Fastify as a systemd service. PostgreSQL runs directly as a restartable Docker container bound only to EC2 loopback and is not exposed by the EC2 security group.

Prerequisites:

- AWS CLI v2 authenticated locally. Do not put AWS access keys in this repository.
- The [AWS Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) if `npm run ec2:connect` will be used.
- Permission to manage CloudFormation, EC2, IAM roles and instance profiles, and Systems Manager in the selected account.
- All code to deploy committed and pushed. EC2 clones GitHub and cannot see uncommitted local files.
- Either permission for the stack to create a minimal public VPC, or explicit `EC2_VPC_ID` and `EC2_SUBNET_ID` values for an existing public subnet.
- A public repository, or a fine-grained read-only GitHub token stored as a plain secret value in AWS Secrets Manager.

Find the public IPv4 address of the local k6 generator and restrict the API to that one address:

```powershell
$publicIp = (Invoke-RestMethod 'https://checkip.amazonaws.com').Trim()
$env:EC2_ALLOWED_CIDR = "$publicIp/32"
$env:AWS_REGION = 'us-east-1'
$env:AWS_PROFILE = 'default'
$env:EC2_INSTANCE_TYPE = 'c7i.large'

npm run ec2:provision
```

To enable manual SSH debugging on a newly created instance, supply an existing EC2 key pair name before provisioning. By default the same CIDR used for the benchmark API is also used for SSH:

```powershell
$env:EC2_KEY_NAME = 'your-existing-keypair-name'
$env:EC2_SSH_ALLOWED_CIDR = $env:EC2_ALLOWED_CIDR
npm run ec2:provision
```

The defaults are stack name `edge-results-benchmark`, branch currently checked out locally, region `us-east-1` when neither AWS region variable is set, `c7i.large`, and detailed EC2 monitoring enabled. Override them when necessary:

| Variable | Meaning |
|---|---|
| `EC2_ALLOWED_CIDR` | Required IPv4 CIDR permitted to call port 3001; normally the k6 generator's public IP with `/32`. |
| `AWS_REGION` | AWS deployment region. |
| `AWS_PROFILE` | Optional local AWS CLI profile. |
| `EC2_INSTANCE_TYPE` | EC2 size; use the same fixed type for every reported run. |
| `EC2_KEY_NAME` | Optional existing EC2 key pair name; when set, the instance accepts SSH on port 22. |
| `EC2_STACK_NAME` | CloudFormation stack name. |
| `EC2_REPOSITORY_URL` | Optional GitHub HTTPS or SSH-style URL; the script converts GitHub SSH remotes to token-free HTTPS. |
| `EC2_REPOSITORY_REF` | Git branch or tag to clone. |
| `EC2_GITHUB_TOKEN_SECRET_ARN` | Optional Secrets Manager ARN for a private repository's fine-grained read-only GitHub token. |
| `EC2_SSH_ALLOWED_CIDR` | Optional IPv4 CIDR allowed to SSH on port 22 when `EC2_KEY_NAME` is set; defaults to `EC2_ALLOWED_CIDR`. |
| `EC2_VPC_ID`, `EC2_SUBNET_ID` | Optional existing VPC and public subnet; both must be set together, otherwise the stack creates and later deletes its own minimal public VPC. |
| `EC2_DETAILED_MONITORING` | `true` by default; set `false` to avoid the additional detailed-monitoring charge. |
| `EC2_BOOTSTRAP_TIMEOUT_SECONDS` | Local health-wait timeout from 30 to 3,600 seconds; default 900. |

For a private repository, create the read-only GitHub token in Secrets Manager without printing or committing it, then provide only its ARN:

```powershell
$env:EC2_GITHUB_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:me-south-1:123456789012:secret:github/edge-results-read-xxxxx'
npm run ec2:provision
```

The command waits for EC2 status checks and `GET /health`, then prints the public base URL. Inspect the stack or connect to the host without opening port 22:

```powershell
npm run ec2:status
npm run ec2:connect
```

If `EC2_KEY_NAME` was set during provisioning, `npm run ec2:status` also prints the SSH command shape. The private key itself is never stored in this repository; it remains the `.pem` file you originally created and downloaded for that EC2 key pair.

Provision intentionally refuses to update an existing stack because EC2 user data runs only during the instance's initial boot. If the repository revision, generator CIDR, instance type, or bootstrap configuration changes, destroy the existing benchmark stack and provision a new one so every reported environment starts from the same clean process.

Inside the Session Manager shell, bootstrap output and API logs are available through:

```text
sudo less /var/log/edge-results-bootstrap.log
sudo journalctl -u edge-results-api.service --no-pager -n 200
sudo docker ps --filter name=edge-results-postgres
```

Run k6 locally against the CloudFormation output, not against the old local API URL:

```powershell
$env:K6_TARGET = 'traditional'
$env:K6_BASE_URL = aws cloudformation describe-stacks `
  --stack-name edge-results-benchmark `
  --region $env:AWS_REGION `
  --profile $env:AWS_PROFILE `
  --query "Stacks[0].Outputs[?OutputKey=='ApiBaseUrl'].OutputValue | [0]" `
  --output text
$env:K6_RUN_ID = 'traditional-ec2-load-1'
$env:K6_GENERATOR_LOCATION = 'local-windows-damascus'
npm run k6:load
```

Use the same local k6 machine, generator location, dataset version, request mix, and alternating run order for the deployed Worker. The EC2 endpoint currently uses HTTP while the Worker uses HTTPS, so the final report must disclose transport and network-path differences rather than attributing all latency differences solely to application architecture.

Delete the stack promptly after the experiments. The confirmation value prevents an accidental deletion caused by merely running the command:

```powershell
$env:EC2_CONFIRM_DESTROY = 'edge-results-benchmark'
npm run ec2:destroy
```

Deletion terminates the instance and deletes its root volume, security group, and stack-created IAM resources. Detailed monitoring, the instance, EBS, public IPv4, and Secrets Manager can incur charges while their resources exist; a separately created GitHub token secret is not owned or deleted by this stack.

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

## Phase 4 frontend

Start the traditional API, local Worker, and Vite interface in separate terminals. Prepare PostgreSQL and local KV first if they do not already contain the generated corpus:

```powershell
npm run db:up
npm run db:prepare
npm run worker:kv:local
```

```powershell
npm run dev:api
```

```powershell
npm run worker:dev
```

```powershell
npm run dev:web
```

Open `http://127.0.0.1:5173`. Vite proxies Traditional requests to `http://127.0.0.1:3001` and Edge requests to `http://127.0.0.1:8787`, so both local implementations keep the same `/api/result` contract.

To use deployed services instead, set the complete lookup endpoint URLs before starting or building the web app:

```powershell
$env:VITE_TRADITIONAL_API_URL = 'https://api.example.com/api/result'
$env:VITE_EDGE_API_URL = 'https://edge-results-worker.example.workers.dev/api/result'
npm run dev:web
```

The interface includes keyboard-operable backend selection, a required student-ID field, polite loading and result announcements, a distinct not-found message, and an assertive service-failure state with retry. Both lookup services allow browser GET requests and continue returning the same JSON response envelopes.

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

### Phase 3 — load testing (implemented)

- one shared k6 data fixture
- smoke, load, stress, and spike executors
- fixed thresholds and summary export for requests/sec, p50, p95, p99, and error rate
- reproducible run metadata and traditional-path resource capture

### Phase 4 — frontend (implemented)

- small React/Vite form for student ID
- backend selector for Traditional or Edge
- accessible loading, result, not-found, and failure states

### Phase 5 — experiments and report

- repeated controlled runs
- raw result artifacts and comparison table
- interpretation of saturation points, tail latency, errors, resource use, consistency, cost, and limitations

## Current limitations

- Workers KV is eventually consistent; the Worker is not suitable for immediate cross-region read-after-write workflows.
- HMAC lookup keys reduce raw-ID exposure in KV tooling, but the unauthenticated demo endpoint is not a production privacy boundary.
- No comparative performance result is claimed yet.
- The schema models one result per student ID and one academic year for a focused read benchmark, not a production education domain.
- There is no authentication. A real results system must add authorization, privacy controls, audit logging, key rotation, retention policy, and abuse protection.
- Synthetic names intentionally repeat and must never be mistaken for a production-like identity model.
- Local Docker measurements are useful for repeatable development, not a substitute for controlled hosted infrastructure.
