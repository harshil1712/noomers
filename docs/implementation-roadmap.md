# Feature implementation roadmap

This document turns the gaps in [Plausible feature parity](plausible-feature-parity.md) into an ordered engineering backlog. The parity document is the source of truth for product coverage; this roadmap describes implementation sequence and dependencies.

Last reviewed: 2026-11-05.

## Status definitions

| Status   | Meaning                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------- |
| Ready    | The item is not complete, and its prerequisites are available now.                                 |
| Planned  | The item is not complete and waits on another roadmap item; that dependency may itself be blocked. |
| Partial  | A usable implementation exists, but the acceptance criteria are incomplete.                        |
| Blocked  | Completion requires live infrastructure, credentials, or an upstream export.                       |
| Deferred | Explicitly out of scope for the single-organization product; not planned work.                     |
| Complete | Every acceptance criterion and the definition of done has been met.                                |

## Delivery principles

- Correct analytics semantics take priority over exposing more dimension names.
- Privacy invariants and fail-closed collection cannot be weakened for compatibility.
- Every API feature needs closed validation, bounded resource use, dialect-specific SQL tests, and route-level response tests.
- Nothing has been deployed to Cloudflare yet; features that depend on Basin SQL, the Pipeline, or the SiteEvents Durable Object need live validation before being marked complete.
- Deletion is complete only when every storage layer is erased or expired and the deletion job records that outcome.
- Documentation must describe deployed behavior, not planned behavior.

## Ordered backlog

### 1. First-run experience

| Feature                    | Status  | Notes                                                                                                                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard site management  | Partial | Admins can add, re-time-zone, and delete sites from the dashboard. Goal management and tracker configuration UI remain API-only.                                          |
| Guided first deploy        | Blocked | The stack has never been applied to a live account. Run a real `alchemy deploy`, then validate collection, Pipeline delivery, and Basin SQL reads end to end.             |
| Live Basin SQL conformance | Blocked | Depends on the first deploy. Run representative basic, session, filter, time-bucket, pagination, and error queries against the live service and pin supported constructs. |

### 2. Complete deletion

| Feature                      | Status  | Notes                                                                                                                                                                                    |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iceberg row erasure          | Partial | A daily PyIceberg job erases due sites' rows through Basin Catalog (≥1 hour after deletion) and managed snapshot expiration removes the files. Live validation pending — never deployed. |
| User-visible deletion status | Planned | Expose per-layer deletion progress without leaking infrastructure details, once automated erasure exists.                                                                                |
| Deletion monitoring and SLA  | Planned | Alert on overdue jobs once a processor exists.                                                                                                                                           |

### 3. Core analytics correctness

| Feature                              | Status  | Notes                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry and exit page dimensions       | Partial | `visit:entry_page`/`visit:exit_page` ship in the Stats API and dashboard (first/last pageview, ties by `event_id`). Left: `exit_rate`, hostname variants, visit filters, live validation.                                                                                     |
| Visit dimensions in the Stats API    | Ready   | `visit:source`, `visit:referrer`, `visit:utm_*`, `visit:country`, `visit:browser`, `visit:browser_version`, `visit:device_type`, and `visit:device_model` are implemented internally for dashboard cards; expose them through `/api/v2/query` and add channel classification. |
| Operating-system dimensions          | Ready   | OS and OS version are stored on durable events; add visit-dimension, Stats API, and dashboard wiring.                                                                                                                                                                         |
| Region/city geography                | Ready   | Region and city are stored; add queryable dimensions and map/visualization.                                                                                                                                                                                                   |
| Goal dimension, filters, and metrics | Partial | `event:goal`, `is`-filters, and `conversion_rate` ship in the Stats API; the dashboard reports uniques/totals/rates. Left: `group_conversion_rate`, revenue metrics, wildcard goals, live validation.                                                                         |
| Property-filtered goals              | Partial | Exact-match `custom_props` constraints are counted in conversions in the dashboard and Stats API; live validation pending.                                                                                                                                                    |
| Wildcard page goals                  | Planned | Plausible-compatible wildcard syntax and matching across provisioning, dashboard, and Stats API.                                                                                                                                                                              |
| Revenue metrics and goals            | Partial | Revenue fields are validated and stored; add goal currency, `total_revenue`, `average_revenue`, currency formatting, and metric warnings.                                                                                                                                     |
| Scroll-depth and time-on-page        | Planned | Durable engagement fields exist; define page/session aggregation and unsupported-combination warnings.                                                                                                                                                                        |

### 4. Query model breadth

| Feature                            | Status  | Notes                                                                                                                              |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Multiple dimensions and orderings  | Planned | Dimension tuples and deterministic multi-key ordering across validation, SQL, totals, pagination, and response construction.       |
| Logical filter AST                 | Ready   | Nested `and`/`or`/`not` with depth/clause/value limits and safe SQL compilers.                                                     |
| Regex and case-insensitive filters | Planned | `matches`/`matches_not` with RE2-compatible validation; `{case_sensitive:false}` where Plausible permits it.                       |
| Behavioral filters                 | Planned | `has_done`/`has_not_done` over reconstructed sessions.                                                                             |
| `percentage` metric                | Planned | Each result against the unpaginated filtered total.                                                                                |
| Comparison periods                 | Ready   | The dashboard already returns previous-period summary metrics; extend to selectable ranges and year-over-year in Stats API and UI. |
| Stats API rate limiting            | Planned | Token-level limits; today only collection and auth endpoints are throttled.                                                        |

### 5. Imports and exports

| Feature                       | Status  | Notes                                                                                                                                                 |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import job model and dedup    | Ready   | `R2_SQL_IMPORT_TABLE` unions an import table into every query unconditionally; persist job state and prevent overlapping date ranges/double counting. |
| Hosted Plausible import       | Blocked | The self-hosted `events_v2` → Iceberg path exists (`scripts/plausible-import/`); hosted export formats may require Enterprise access.                 |
| Plausible CSV and GA4 imports | Planned | Aggregate formats need mapping, overlap prevention, and documented uniqueness limitations.                                                            |
| Import-aware responses        | Planned | Honor `include.imports` and return warnings instead of always reporting `imports_included: false`.                                                    |
| Dashboard and queued exports  | Planned | Export visible reports; later, full aggregate archives with expiry.                                                                                   |

### 6. Tracker parity

| Feature                              | Status  | Notes                                                                                            |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| Configuration-driven tracker         | Partial | Stored tracker settings do not yet alter the served `tracker.js`/`pa-*.js` behavior or URL.      |
| Outbound links, downloads, forms     | Planned | Automatic instrumentation with compatible event/property names.                                  |
| Tagged events and automatic 404s     | Planned | CSS-class/data-attribute conventions and 404 detection.                                          |
| Official-tracker compatibility suite | Ready   | Run captured browser payloads from current official tracker versions against `/api/event` in CI. |

### 7. Product workflows and integrations

| Feature                          | Status   | Notes                                                                                      |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Saved segments                   | Planned  | Personal segments first; sharing is deferred with multi-user scope.                        |
| Funnels and user journeys        | Planned  | Session-path features; depend on the richer query model.                                   |
| Annotations                      | Ready    | Persist dated notes on charts.                                                             |
| Email reports and traffic alerts | Planned  | Scheduling, recipients, rendering, and delivery; transactional email exists only for auth. |
| Public/embedded dashboards       | Deferred | Belongs with the deferred sharing surface, not the single-owner baseline.                  |
| GSC, Looker Studio, WP, GTM      | Deferred | Integrations pending product-scope decisions and credentials.                              |
| Traffic shields                  | Planned  | Future-traffic exclusions with privacy-preserving IP handling.                             |

### 8. Operations and hardening

| Feature                                  | Status  | Notes                                                                                                   |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| Dead-letter / sustained-failure alerting | Ready   | The DO retries `EVENT_STREAM` sends with backoff; add dead-letter handling and operator alerts.         |
| Monitoring and SLOs                      | Planned | Workers observability is enabled; define ingestion/query latency, durable lag, and deletion indicators. |
| Backup, restore, DR, rollback            | Planned | Document and test D1 backup, durable-event recovery, and safe behavior after failed upgrades.           |
| Trusted timestamps and batch ingestion   | Planned | Restricted administrative paths for backdated events, if import throughput requires it.                 |
| Storage-level write idempotency          | Planned | Query-time dedup exists; idempotent durable writes would remove reliance on `event_id` collapsing.      |

## Deferred: multi-user and organization features

noomers is a single-owner deployment: Better Auth provides identities, and the admin role gates every dashboard surface. These items are recorded as non-goals, not future phases:

- Teams, memberships, roles beyond the single admin, and invitations.
- Guests and shared links (the Sites API stubs return `501`).
- Scoped API keys, audit logs, team-wide 2FA, SAML SSO/JIT.
- Consolidated multi-site views.
- Billing, subscriptions, and plan enforcement.

Move deferred items into the backlog only after an explicit product-scope decision.
