# Production readiness

This document defines what it means to run noomers in production today and the gates that separate a controlled pilot from general production. It is derived from the current repository state, not a target architecture.

Last reviewed: 2026-08-20.

## Supported initial production scope

noomers is intended for a **single-organization deployment** with these constraints:

- One deployment-wide shared password for the dashboard.
- One deployment-wide API token that authorizes every registered site (`STATS_API_TOKEN` and `SITES_API_TOKEN` are the same shared secret).
- Sites must be provisioned before collection or querying; collection is fail-closed against the D1 site registry.
- Realtime analytics come from Workers Analytics Engine (retention-limited). Long-term durable storage is optional and requires manual Pipeline/Data Catalog/R2 SQL setup.
- It is **not** a drop-in replacement for full Plausible Analytics and does not support multi-user access control, billing, teams, or scoped API keys.

If these constraints match your deployment, noomers can become a supported self-hosted analytics pilot after the P0 gates below are complete. P1 closes the remaining reliability and data-lifecycle gaps required for general production.

## Readiness phases

### P0: controlled production pilot

P0 is the minimum supported production bar. It requires:

1. Safe deployment gating and a documented rollback path.
2. Live validation of installation, upgrades, migrations, Analytics Engine, Pipeline, and R2 SQL behavior.
3. Deployment-wide and per-site API rate limits and quotas.
4. Dependency-aware readiness, privacy-safe observability, alerts, and initial SLOs.
5. Tested backup, restore, and disaster-recovery procedures.

### P1: general production

P1 builds on P0 and requires:

1. Reliable durable delivery with retries, dead-letter handling, and visible lag.
2. Complete deletion across daily rollups, Iceberg, and Analytics Engine expiry.
3. Live query conformance and bounded query generation beyond the P0 validation baseline.
4. Hardened upgrade compatibility, partial-migration recovery, and rollback procedures.

Full Plausible feature parity and multi-user identity are not production-readiness gates for the supported initial scope.

## Workstreams and acceptance gates

These are the concrete workstreams and acceptance gates. Workstreams 1–5 are P0; workstreams 6–9 are P1. Items marked Complete below are complete in isolation; the workstream itself is not done until every gate is satisfied.

### 1. Deployment gating

The installer already reuses resources safely, preserves the `EVENT_STREAM` Pipeline binding, and rejects stale `EVENTS_PIPELINE` metadata ([FND-004](implementation-roadmap.md) Complete). The P0 deployment-safety gate requires:

- The CD workflow deploys only after CI succeeds and deploys the exact commit that passed CI ([OPS-006](implementation-roadmap.md), Complete).
- Production environment protection can require operator approval before deployment.
- Rollback steps identify and redeploy a known-good commit without reversing append-only migrations.

See the [production deployment runbook](production-deployment.md) for the environment configuration, SHA verification, and rollback procedures.

Non-mutating durable-resource preflight and automated provisioning remain tracked by [FND-005](implementation-roadmap.md) through [FND-007](implementation-roadmap.md). Manual provisioning is acceptable for the supported pilot while those upstream-dependent items remain blocked.

### 2. Live Cloudflare validation

Mocked tests and SQL generation tests exist; live validation against deployed Cloudflare resources does not. Required gates:

- Representative basic, session, filter, time-bucket, and error queries run against R2 SQL and pin supported SQL constructs ([DUR-001](implementation-roadmap.md), Blocked).
- Aggregate arithmetic, sampling behavior, timestamp boundaries, and response metadata validated against Analytics Engine ([DUR-010](implementation-roadmap.md), Blocked).
- Session SQL primitives verified for multi-page, inactive, engagement, and boundary sessions ([DUR-002](implementation-roadmap.md), Partial).
- Scalable grouped queries validated with server-side `ROW_NUMBER()` pagination and `COUNT(*) OVER ()` total rows ([DUR-003](implementation-roadmap.md), Partial).

### 3. Rate limits and quotas

No rate limits or per-site quotas are enforced today. Required gates:

- Configurable token-level limits on Events, Stats, Sites, and administrative endpoints ([OPS-001](implementation-roadmap.md), Planned).
- Per-site counters that prevent one site from exhausting deployment resources ([OPS-002](implementation-roadmap.md), Planned).
- Stats API rate limits with standard headers and error responses ([STA-025](implementation-roadmap.md), Planned).

### 4. Observability, readiness, and SLOs

Current `/api/health` is liveness-only; dependency state and durable lag are not exposed. Required gates:

- Count Analytics Engine write attempts, validation failures, and dropped events without logging payloads or identifiers ([DUR-007](implementation-roadmap.md), Ready).
- A protected readiness endpoint that reports dependency state and durable lag while keeping `/api/health` behavior stable ([DUR-008](implementation-roadmap.md), Planned).
- Defined SLOs and alerts for ingestion availability, query latency, durable lag, and deletion completion ([OPS-003](implementation-roadmap.md), Planned).

### 5. Backup, restore, and disaster recovery

No documented backup/restore path exists today. Required gates:

- Documented and tested D1 backup, configuration restore, durable-table recovery, and expected Analytics Engine limitations ([DUR-009](implementation-roadmap.md), Ready).
- Disaster-recovery runbook covering resource recreation, data restoration, credential rotation, and service validation ([OPS-004](implementation-roadmap.md), Planned).

### 6. Durable retries and lag

Durable send failures are logged while collection succeeds; there is no retry or dead-letter path. Required gates:

- Retryable-failure classification, ordering/idempotency preservation, dead-letter handling, and alerting on sustained failure ([DUR-006](implementation-roadmap.md), Blocked).
- Exposure of durable-data freshness to internal query callers and user-facing responses where appropriate ([DUR-005](implementation-roadmap.md), Planned).
- Clear documentation that a successful collection response confirms validation/acceptance and attempted writes, not guaranteed provider persistence or durable records ([OPS-009](implementation-roadmap.md), Ready).

### 7. Complete deletion

Site deletion immediately tombstones the site and records a per-layer deletion job. The job processor claims, leases, retries, and advances jobs, marking Iceberg as `blocked` because no writable Iceberg engine is provisioned ([DEL-001](implementation-roadmap.md) and [DEL-005](implementation-roadmap.md) Complete). What remains:

- Delete site-scoped daily Arrow rollup objects and rewrite shared legacy objects ([DEL-002](implementation-roadmap.md), Planned).
- Execute Iceberg row deletion through a writable Iceberg engine, then expire snapshots and remove orphan files ([DEL-003](implementation-roadmap.md), Blocked).
- Transition Analytics Engine expiry from `pending_expiry` to `expired` after the calculated retention time ([DEL-004](implementation-roadmap.md), Planned).
- Operator-visible deletion status endpoint that does not leak internal details ([DEL-006](implementation-roadmap.md), Planned).
- Alerts for failed, stalled, or overdue jobs and a published runbook ([DEL-007](implementation-roadmap.md), Planned).

### 8. Live query conformance and bounded bucketing

Generated queries must be validated against live services and bounded in complexity. Required gates:

- Live R2 SQL and Analytics Engine conformance suites pass for supported metrics, dimensions, filters, and time buckets ([DUR-001](implementation-roadmap.md), [DUR-010](implementation-roadmap.md), both Blocked).
- Avoid generated multi-megabyte `CASE` expressions, cap query complexity, and preserve site-timezone/DST correctness ([DUR-004](implementation-roadmap.md), Planned).
- Deterministic server-side pagination and total-row behavior validated against R2 SQL ([DUR-003](implementation-roadmap.md), Partial).

### 9. Upgrade rollback

A strategy must exist for failed schema or deployment upgrades. Required gate:

- Documented forward-fix and compatibility-window behavior, plus safe behavior after partial migration failure ([OPS-005](implementation-roadmap.md), Ready).

## P0 pilot-ready release gate

A release can be considered pilot-ready when:

1. Every acceptance gate in workstreams 1–5 is satisfied.
2. The full CI-equivalent suite, including tracker integration tests, passes for the release commit.
3. A staged deployment has exercised installation, upgrade, dependency failure, rate limiting, alerting, backup, and restore.
4. The supported initial production scope and known P1 limitations are accurate in release documentation.
5. Deletion immediately tombstones sites, removes D1 configuration, and records a deletion job ([DEL-001](implementation-roadmap.md), [DEL-005](implementation-roadmap.md)); release notes state that complete durable erasure remains a P1 gate.

## General-production-ready release gate

A release can be considered general-production-ready only when all of the following are true:

1. The P0 pilot-ready release gate remains satisfied.
2. Every acceptance gate in workstreams 6–9 is satisfied.
3. Complete deletion executes across D1, daily rollups, Iceberg, and Analytics Engine expiry.
4. Durable delivery failures are retried or dead-lettered and visible to operators.
5. Upgrade and partial-migration recovery behavior is documented and exercised.
6. The README and parity documents still do not claim full Plausible parity, multi-user support, or automated infrastructure provisioning.

## What we do not claim

Until the gates above are met, noomers documentation and release messaging must not claim:

- Full or drop-in Plausible compatibility.
- Multi-organization, multi-user, team, role, SSO, or scoped API key support.
- Complete data erasure immediately after deleting a site.
- Revenue analytics, custom-property analytics, or property-filtered goal reporting.
- Long-term dashboard history from the daily Arrow archive.
- Fully automated Pipeline/Data Catalog/R2 SQL provisioning.
- Guaranteed durable-event delivery from a successful `/collect` or `/api/event` response.

## Related documents

- [Plausible feature parity](plausible-feature-parity.md) — detailed supported baseline and gaps.
- [Feature implementation roadmap](implementation-roadmap.md) — ordered backlog with IDs referenced above.
- [Convergence provisioning](convergence-provisioning.md) — manual Pipeline/Data Catalog setup steps.
- [Production deployment](production-deployment.md) — environment approval, SHA verification, and rollback runbook.
- [README](../README.md) — installation, validation, and current limitations.
