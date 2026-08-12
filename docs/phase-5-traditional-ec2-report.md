# Phase 5 experiment report: traditional EC2 path

Date: 2026-08-12  
AWS region: `us-east-1`  
Status: traditional-path capacity discovery completed; repeated final runs and the Cloudflare comparison remain pending.

## Objective

Measure when a single Fastify/PostgreSQL deployment begins to saturate under result-release traffic, while separating target saturation from load-generator and public-network limitations.

All requests used the repository's deterministic corpus of 10,000 synthetic student records. No real student data was used.

## Architecture under test

```text
k6 generator EC2 (172.31.4.200)
        |
        | private VPC HTTP
        v
API EC2 (172.31.19.90:3001)
        |
        +-- Fastify / Node.js
        +-- PostgreSQL 16 container
```

Both machines were in the same `us-east-1` VPC. The target was a `c5.large` with 2 vCPU and 4 GiB memory. The generator was a separate 2-vCPU, approximately 4-GiB EC2 instance. k6 never ran on the target machine.

The API used its default bounded PostgreSQL pool of 10 connections. PostgreSQL contained the same generated dataset used to create the k6 lookup fixture.

## Why the generator was moved to EC2

Initial exploratory runs sent traffic from a Windows machine through a mandatory VPN to the target's public address. Those runs reported multi-second latency and timeouts while the target showed low CPU use. API logs showed received requests completing in approximately 0.5–1 ms, and the source address differed from the operator's SSH address. These public-path results therefore mixed VPN and Internet-path behavior with application behavior and are not used as target-capacity evidence.

A second EC2 instance was created as the k6 generator. It called the API through `http://172.31.19.90:3001`, removing the VPN and public Internet from the measured path.

## Procedure

The generator prepared the deterministic fixture and then ran smoke, stress, spike, and capacity profiles:

```bash
npm-22 run data:generate
npm-22 run k6:fixture
```

Example private-path execution:

```bash
K6_TARGET=traditional \
K6_BASE_URL=http://172.31.19.90:3001 \
K6_GENERATOR_LOCATION=ec2-us-east-1 \
K6_RUN_ID=traditional-private-capacity-1 \
npm-22 run k6:capacity
```

The capacity profile offered successive 45-second stages up to 5,000 iterations/s, followed by recovery:

```text
500 -> 1,000 -> 2,000 -> 3,000 -> 4,000 -> 5,000 RPS
```

It allowed at most 3,000 active VUs. Each iteration made one lookup request with the same deterministic 95% hit / 5% expected-miss mix. Expected `404` responses were contract-checked and were not counted as HTTP failures.

During the capacity run, `top` was observed on both machines and `docker stats edge-results-postgres` was observed on the target. The health endpoint was checked after the run.

## Preserved results

The JSON summaries in `results/` are the authoritative artifacts. Values below use only each artifact's measured phase and exclude warm-up traffic.

| Profile | Offered load | Completed requests | Average achieved RPS | p50 | p95 | p99 | HTTP failures | Dropped iterations |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Smoke | 1 RPS for 10 s | 11 | 1.10 | 2.074 ms | 2.126 ms | 2.143 ms | 0% | 0 |
| Stress | ramp to 300 RPS | 35,249 | 130.55 | 1.163 ms | 1.478 ms | 1.630 ms | 0% | 0 |
| Spike | peak at 400 RPS | 17,400 | 158.18 | 1.058 ms | 1.607 ms | 2.282 ms | 0% | 0 |
| Capacity | staged 500–5,000 RPS | 512,067 | 1,706.89 | 767.224 ms | 1,365.368 ms | 1,444.561 ms | 0% | 159,182 |

Raw artifacts:

- [`traditional-private-smoke-1.summary.json`](../results/traditional-private-smoke-1.summary.json)
- [`traditional-private-stress-1.summary.json`](../results/traditional-private-stress-1.summary.json)
- [`traditional-private-spike-1.summary.json`](../results/traditional-private-spike-1.summary.json)
- [`traditional-private-capacity-1.summary.json`](../results/traditional-private-capacity-1.summary.json)

## Capacity interpretation

The target was healthy through the 300-RPS stress and 400-RPS spike profiles: there were no HTTP or contract failures, no dropped iterations, and p95 remained below 2 ms over the private VPC.

The capacity profile created clear saturation:

- k6 completed 512,067 requests and could not schedule 159,182 additional iterations on time.
- Completed plus dropped work was 671,249 iterations; 23.71% was dropped before an HTTP request began.
- p95 increased from 1.607 ms in the 400-RPS spike to 1,365.368 ms in the capacity profile.
- Every request that reached the API still returned the expected HTTP status and response contract.
- The API remained healthy after the test, so this was severe degradation with recovery rather than a permanent outage.

The reported 1,706.89 RPS is an average over the complete changing-rate profile. It is not the exact maximum sustainable throughput. The current aggregate artifact establishes that saturation occurred somewhere in the high-rate stages, but it does not isolate the first failing stage.

## Resource evidence

During the high-rate portion of the capacity run:

- On the target, each of the two CPUs was approximately 86–87% busy in the captured observation.
- The Node.js API process used approximately 94% CPU, close to one complete vCPU.
- PostgreSQL workers used much of the remaining CPU; the PostgreSQL container was observed around 50–56% CPU.
- Target memory remained healthy, with approximately 3 GiB available and no swap use.
- On the generator, the k6 process used approximately 96% CPU in total, while both CPUs remained approximately 50% idle. Generator memory also remained healthy.

These simultaneous observations show that generator CPU was not exhausted while the target was under substantial CPU pressure. Reaching the 3,000-VU ceiling was related to growing request duration and the configured concurrency ceiling, not a lack of generator CPU alone.

## Database investigation

An earlier diagnostic captured 35,208 lookup calls in `pg_stat_statements`:

```text
mean execution time: 0.038 ms
total execution time: 1,327.92 ms
shared buffer hits: 103,864
shared blocks read: 0
```

This showed that the indexed query itself was fast and fully cached at that diagnostic load. Under the stronger capacity profile, PostgreSQL CPU increased alongside the API. The evidence supports combined target CPU saturation—Node.js request processing, PostgreSQL, logging, Docker proxy, and kernel/network work—rather than a missing index or slow disk reads.

## Errors and recovery

The capacity test crossed these k6 thresholds:

- `http_req_duration{phase:measured}` because p95 exceeded 1,000 ms.
- `dropped_iterations` because k6 could not schedule all offered iterations within the 3,000-VU ceiling.

It did not cross HTTP failure, contract failure, or check-success thresholds. After the test:

```bash
curl http://172.31.19.90:3001/health
```

returned `{"status":"ok"}`.

## Conclusions

For this single two-vCPU EC2 deployment:

1. The traditional path comfortably handled the tested 300–400 RPS profiles over the private VPC.
2. The 500–5,000 RPS capacity profile saturated the target, increased tail latency by roughly three orders of magnitude compared with the 400-RPS spike, and caused 23.71% of offered iterations to be dropped before execution.
3. The service degraded but did not return incorrect data or HTTP failures, and it recovered after the load ended.
4. The public VPN-based runs measured a different bottleneck and must not be mixed with the private-VPC capacity results.
5. This experiment does not yet establish that Cloudflare is better. The same behavior, dataset, request mix, generator, and controlled run order must be used for the edge target before making that comparison.

## Limitations and remaining work

- Only one final private-path artifact per profile is currently preserved. At least three uniquely named capacity runs are required for consistency statistics.
- The capacity summary aggregates all stages, so the exact saturation point is not yet known. A follow-up profile should tag or separate each fixed-rate stage around the transition.
- Resource values were observed from terminal snapshots rather than exported as time-series artifacts.
- The result applies only to this instance size, Node.js process model, PostgreSQL configuration, pool size, dataset, and same-VPC generator location.
- The deployment had no load balancer, horizontal scaling, autoscaling, read replicas, or multi-process Node.js workers.
- Cost was not captured as an exact experiment total. EC2 compute, EBS, and public IPv4 charges should be calculated from actual instance uptime.
- No Cloudflare capacity artifact or traditional-versus-edge comparison table exists yet.
- Cloudflare Free-plan quotas cannot support this full 671,249-iteration capacity profile in one day; the paid plan or a quota-safe revised methodology is required for an equivalent run.

## Repetition checklist

For future final runs:

1. Start both instances and confirm private health.
2. Keep instance types, dataset, pool size, logging, and k6 version unchanged.
3. Use unique IDs such as `traditional-private-capacity-2` and `traditional-private-capacity-3` so artifacts are not overwritten.
4. Capture target and generator CPU continuously or at every capacity stage.
5. Check `/health` after every run and allow the target to recover before the next run.
6. Copy every JSON artifact off the generator before stopping the instances.
