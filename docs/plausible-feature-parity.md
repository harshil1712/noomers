# Plausible feature parity

This document tracks the remaining work required for noomers to behave like Plausible Analytics. It covers the hosted product and its public APIs, not Plausible's billing, support, or internal administration systems.

Last reviewed: 2026-08-22.

## Status definitions

| Status    | Meaning                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Supported | The current implementation covers the documented behavior closely enough for normal use.                |
| Partial   | A usable subset exists, but documented behavior or important semantics are missing.                     |
| Missing   | No implementation exists.                                                                               |
| Deferred  | Explicitly out of scope for the single-organization product; not planned work.                          |
| Blocked   | Implementation or validation requires external infrastructure, credentials, or upstream product access. |

Passing unit tests only prove noomers's local contracts. Basin SQL (formerly R2 SQL) and the SiteEvents Durable Object behavior must also be validated against deployed Cloudflare resources before full parity can be claimed.

## Current baseline

noomers currently has:

- Plausible-compatible `POST /api/event` and `GET /api/health` endpoints.
- A partial `POST /api/v2/query` Stats API.
- Partial Sites API provisioning, goals, and custom-property registration.
- A noomers dashboard with summary, time-series, page, referrer, event, goal, browser, country, device, and UTM reports.
- Optional canonical event storage through Basin Pipelines (formerly Cloudflare Pipelines), Basin Catalog (formerly R2 Data Catalog), and Basin SQL.
- A D1 site registry, permanent deletion tombstones, per-site SiteEvents Durable Objects (purged on delete), and deletion-job records tracking Iceberg maintenance state (including explicit `blocked`).
- A single shared-password dashboard and deployment-wide API tokens.

This is not yet a drop-in replacement for the full Plausible product.

## Highest-priority gaps

P0 items block safe installation, correct core analytics, or complete deletion. P1 items expand compatibility after that baseline is reliable.

| Priority | Feature                                         | Why it matters                                                                                                                                                                                                                                                             |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Initial site provisioning and upgrade migration | Collection rejects unknown sites; the installer creates a site and backfills site IDs from a legacy Analytics Engine dataset, pending live validation.                                                                                                                              |
| P0       | Session-correct visit dimensions                | Source, campaign, geography, technology, entry, and exit reports require first-page session attribution rather than event-row grouping.                                                                                                                                    |
| P0       | Complete deletion execution                     | Site deletion tombstones the site, purges its Durable Object, and records a deletion job, but Iceberg rows are not automatically erased (manual cleanup) and no automatic processor runs. |
| P1       | Automated durable-event provisioning            | Exact session metrics require Pipeline, Basin Catalog, and Basin SQL resources that are currently configured manually.                                                                                                                                                         |
| P1       | Goal and revenue reporting                      | Revenue and goal definitions exist, but Stats API and dashboard reporting remain incomplete.                                                                                                                                                                               |
| P1       | Historical imports                              | There is no Plausible, Google Analytics, or CSV migration path.                                                                                                                                                                                                            |
| P1       | Broader Stats API query model                   | Multiple dimensions, logical filters, regex, behavioral filters, and property filters are missing.                                                                                                                                                                         |
| P1       | Scalable R2 query pagination                    | Dimension queries use a ROW_NUMBER CTE with `row_num` range filters for deterministic server-side ordering and bounded pagination.                                                                                                                                         |

## Events API and tracking

### Supported

- Pageviews, custom events, and engagement events through `POST /api/event`.
- Long-form and compact Plausible payload fields.
- Scalar event properties, revenue payloads, `interactive`, engagement time, scroll depth, and hash-based routing input.
- CORS preflight, `X-Forwarded-For`, `X-Debug-Request`, bot dropping, URL normalization, and static health endpoint compatibility.
- Browser and server noomers tracker modules with manual pageviews and custom events.

### Remaining parity

| Feature                           | Status    | Remaining work                                                                                                                              |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Official Plausible tracker script | Partial   | noomers accepts official tracker payloads but serves its own tracker. Validate current official tracker versions continuously.              |
| Outbound-link tracking            | Missing   | Add automatic browser instrumentation and compatible event/property names.                                                                  |
| File-download tracking            | Missing   | Detect configured file extensions and emit compatible events.                                                                               |
| Form-submission tracking          | Missing   | Add form instrumentation and compatible properties.                                                                                         |
| Tagged-event tracking             | Missing   | Support Plausible's CSS-class and data-attribute conventions.                                                                               |
| Automatic 404 tracking            | Missing   | Detect and report 404 pages through the served tracker integration.                                                                         |
| Automatic scroll-depth reporting  | Supported | The noomers tracker now generates bounded scroll-depth values and sends them with engagement events; durable storage requires Pipeline/Basin SQL. Stats API `scroll_depth` metrics and dashboard scroll reports are still missing. |
| Revenue tracking                  | Partial   | Revenue is validated and stored in durable events, but Stats API, goals, and the dashboard do not report it.                |
| Engagement reporting              | Partial   | The native tracker emits bounded engagement-time deltas and scroll-depth values. Engagement events are stored in the Basin/Iceberg table and queryable through Basin SQL.                         |
| Tracker configuration             | Partial   | Sites API stores Plausible-style tracker settings, but most settings do not alter the served noomers tracker.                               |
| Native `/collect` bot filtering   | Supported | Native `/collect` now shares the UA-based bot policy with `/api/event`, exempting only the first-party `noomers-tracker-server/` UA prefix. |

## Stats API v2

### Supported

Metrics:

- `visitors`
- `visits` with Basin SQL
- `pageviews`
- `views_per_visit` with Basin SQL
- `bounce_rate` with Basin SQL
- `visit_duration` with Basin SQL
- `events`

Dimensions:

- `event:page`
- `event:hostname`
- `time`, `time:hour`, `time:day`, `time:week`, and `time:month`

Hostname breakdowns support `visitors`, `pageviews`, and `events`. Hostname-only queries using session metrics are rejected because the currently supported Plausible combination also requires `event:page`, while noomers supports only one dimension.

Filters:

- `is`
- `is_not`
- `contains`
- `contains_not`
- Multiple values and repeated filters, with top-level implicit AND

Filters use the three-element `[operator, dimension, values]` form, are case-sensitive, and currently support only `event:page` and `event:hostname`.

Query behavior:

- Documented date presets and custom date/date-time ranges.
- Site reporting timezones and DST-aware time boundaries.
- One order clause, pagination, `include.time_labels`, and `include.total_rows`.
- `include.imports` is accepted but always reports `imports_included: false`.

### Remaining metrics

| Metric                          | Status  | Remaining work                                                              |
| ------------------------------- | ------- | --------------------------------------------------------------------------- |
| `scroll_depth`                  | Missing | Query durable scroll data and define page/session aggregation.              |
| `percentage`                    | Missing | Implement breakdown percentage semantics.                                   |
| `conversion_rate`               | Missing | Join configured goals and visitor/session denominators.                     |
| `group_conversion_rate`         | Missing | Implement grouped conversion semantics.                                     |
| `average_revenue`               | Missing | Aggregate revenue by goal and currency.                                     |
| `total_revenue`                 | Missing | Aggregate revenue by goal and currency.                                     |
| `time_on_page`                  | Missing | Derive page engagement from engagement events.                              |
| Revenue formatting and warnings | Missing | Return currency metadata and metric warnings in Plausible's response shape. |

### Remaining dimensions

| Dimension family                            | Status  | Remaining work                                                                                                 |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `event:goal`                                | Missing | Resolve event and page goals, including property constraints.                                                  |
| `event:props:*`                             | Missing | Query registered event properties safely in Basin SQL.                                       |
| Entry and exit page/hostname                | Missing | Sessionize first and last pageviews.                                                                           |
| Source, referrer, and channel               | Missing | Attribute values from the first pageview and implement channel classification.                                 |
| UTM medium/source/campaign/content/term     | Missing | Attribute campaign values from the first pageview.                                                             |
| Device, browser, and versions               | Missing | Attribute technology values from the first pageview.                                                           |
| Operating system and version                | Missing | Stored in durable events; apply first-page attribution in Basin SQL.                                     |
| Country, region, and city identifiers/names | Missing | Preserve the required geographic identifiers and apply first-page attribution.                                 |
| Multiple dimensions                         | Missing | Replace scalar dimension rows with tuples across validation, SQL, ordering, totals, and response construction. |

Visit dimensions must not be implemented by grouping raw event rows. Plausible attributes visit dimensions from the session's first pageview.

### Remaining filters and query semantics

| Feature                       | Status   | Remaining work                                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `matches` and `matches_not`   | Missing  | Add RE2-compatible validation and Basin SQL rendering.       |
| Case-insensitive modifiers    | Missing  | Support `{case_sensitive:false}` where Plausible permits it.                                |
| Nested `and`, `or`, and `not` | Missing  | Introduce a bounded filter AST and safe SQL compilers.                                      |
| `has_done` and `has_not_done` | Missing  | Evaluate behavioral conditions over reconstructed sessions.                                 |
| Saved-segment filters         | Missing  | Persist segments and expand them into validated filters.                                    |
| Goal filters                  | Missing  | Resolve goal definitions and supported goal operators.                                      |
| Visit-scoped filters          | Missing  | Apply filters to first-page/session attributes rather than individual events.               |
| Multiple `order_by` clauses   | Missing  | Add deterministic tuple ordering in both data sources.                                      |
| Imported-data queries         | Missing  | Add import storage, restrictions, warnings, and merge behavior.                             |
| Metric warnings               | Missing  | Return warnings for unavailable or partially evaluated metrics/dimensions.                  |
| Comparison periods            | Missing  | Add previous-period and year-over-year comparison output if targeting product-query parity. |
| API rate limiting             | Missing  | Enforce a configurable equivalent of Plausible's API limits.                                |
| Scoped API keys               | Deferred | Current tokens authorize every registered site in one deployment.                           |

### Correctness and scale gaps

| Gap                                         | Status  | Remaining work                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Basin SQL arithmetic validation | Done | Session metrics verified against JS ground truth on the live spike dataset (views/events/visitors/visits/bounces/duration all exact). |
| Live Basin SQL validation                      | Blocked | Validate generated SQL and response shapes against the current Basin SQL service.                                                                                                                                                                       |
| Session behavior across UTC midnight        | Partial | Daily visitor IDs intentionally prevent cross-day linkage; document and test resulting visit differences.                                                                                                                                            |
| Page session attribution                    | Partial | Verify whether entry-page attribution for visit metrics matches each supported page query combination.                                                                                                                                               |
| R2 row pagination                           | Partial | Basin SQL has no OFFSET; breakdowns now paginate deterministically with `ROW_NUMBER() OVER (...)` + a `dimension` tie-breaker and bounded `row_num` filters, matching the requested Stats API metric order. Validate against a deployed Basin SQL service. |
| Long R2 time ranges                         | Partial | Prevent very large generated bucket expressions or use native timezone-aware bucketing.                                                                                                                                                              |
| R2 total rows                               | Partial | `COUNT(*) OVER ()` returns the full matching group count independently of the fetched page; `include.total_rows` reports it. Validate against a deployed Basin SQL service.                                                                             |
| R2 query-time event deduplication           | Partial | `getSessionMetrics`, `getBasicMetrics`, and `getSessionBreakdown` collapse duplicate durable copies that share a non-empty canonical `event_id` before aggregation/sessionization. Empty or missing IDs remain distinct; client retries receive new IDs, and storage-level durable idempotency is still unimplemented. |

### Legacy Stats API v1

| Feature                                                           | Status  | Remaining work                                                                                                                                         |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Realtime visitors, aggregate, timeseries, and breakdown endpoints | Missing | Implement `/api/v1/stats/realtime/visitors`, `/aggregate`, `/timeseries`, and `/breakdown` only if compatibility with legacy clients remains a target. |

## Sites API

### Supported

- List, create, read, update configuration, and delete sites.
- Cursor pagination with bounded limits.
- Stable tracker IDs and IANA reporting timezones.
- List, find or create, and delete event or exact-page goals.
- List, create, and delete custom-property registrations.
- One synthetic `default` team for single-organization deployments.

### Remaining parity

| Feature                              | Status   | Remaining work                                                                                                    |
| ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Domain rename                        | Missing  | Define a migration/alias strategy because existing durable event records are immutable.                        |
| Page-goal wildcards                  | Missing  | Add Plausible-compatible wildcard validation and query behavior.                                                  |
| Property-filtered goals              | Partial  | `custom_props` are stored but ignored when counting conversions.                                                  |
| Revenue goals                        | Missing  | Store goal currency/configuration and connect revenue events to reporting.                                        |
| Tracker URL generation               | Partial  | Stored tracker configuration does not produce Plausible's configuration-specific script behavior.                 |
| Full validation/status compatibility | Partial  | Conformance-test cursor, request-content, error, and status behavior against the live API.                        |
| Real teams                           | Deferred | Replace the synthetic team with persisted ownership and membership only if multi-organization support is adopted. |
| Site transfers                       | Deferred | Requires real teams and ownership.                                                                                |
| Guests                               | Deferred | Authenticated endpoints currently return `501 Not Implemented`.                                                   |
| Shared links                         | Deferred | Authenticated endpoints currently return `501 Not Implemented`.                                                   |
| Subscription/site limits             | Deferred | No billing or plan enforcement exists.                                                                            |

## Goals, properties, and ecommerce

| Feature                           | Status    | Remaining work                                                              |
| --------------------------------- | --------- | --------------------------------------------------------------------------- |
| Exact event goals                 | Supported | Maintain Events API and dashboard compatibility tests.                      |
| Exact page goals                  | Supported | Maintain query and provisioning compatibility tests.                        |
| Wildcard page goals               | Missing   | Add wildcard syntax and matching semantics.                                 |
| Unique conversions                | Supported | Counts follow the privacy-preserving daily visitor identity model.          |
| Total conversions                 | Missing   | Expose non-unique conversion counts.                                        |
| Conversion rates in Stats API     | Missing   | Implement conversion metrics and goal dimensions.                           |
| Property-filtered conversions     | Partial   | Definitions persist properties, but queries ignore them.                    |
| Revenue goals and attribution     | Missing   | Connect durable revenue records to goals, currency, and conversion reports. |
| Custom-property registration      | Supported | Keep Sites API metadata behavior compatible.                                |
| Property dimensions and filters   | Missing   | Add Stats API and dashboard reporting.                                      |
| Property registration enforcement | Missing   | Decide whether unregistered keys are accepted, hidden, or rejected.         |
| Ecommerce reports                 | Missing   | Add purchase/product revenue, attribution, and breakdowns.                  |
| WooCommerce/Shopify integrations  | Missing   | No first-party commerce integrations or setup automation exist.             |

## Dashboard and analysis

### Current reports

- Visitors, pageviews, bounce rate, visits, and average visit duration (when engagement data is present through Pipeline/Basin SQL).
- Visitors, views, and bounce time series.
- Pages, referrers, events, goals, browsers, browser versions, countries, devices, and UTM breakdowns.
- Equality filters through URL parameters and paginated tables.

### Remaining parity

| Feature                        | Status   | Remaining work                                                                                                                                                                                      |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime/current visitors      | Missing  | Add five-minute current visitor and rolling 30-minute views.                                                                                                                                        |
| Previous-period comparison     | Missing  | Add aligned comparison ranges and deltas.                                                                                                                                                           |
| Year-over-year comparison      | Missing  | Add timezone-aware annual comparison.                                                                                                                                                               |
| Custom comparison              | Missing  | Support arbitrary comparison ranges.                                                                                                                                                                |
| Visit/source/channel reports   | Partial  | Referrer and UTM event reports exist; session-correct source/channel reports do not.                                                                                                                |
| Entry/exit reports             | Missing  | Derive first/last pageviews per visit.                                                                                                                                                              |
| Region/city maps               | Missing  | Add geographic storage, aggregation, and visualization.                                                                                                                                             |
| OS and version reports         | Missing  | Add report routes and cards.                                                                                                                                                                        |
| Scroll depth                   | Missing  | Tracker generation is supported; add page-level average scroll reporting via Stats API and dashboard.                                                                                         |
| Time on page                   | Missing  | Derive engagement and expose page metrics.                                                                                                                                                          |
| Native average visit duration    | Supported | The native tracker emits bounded engagement-time deltas; the dashboard/Basin SQL average visit duration metric reports them. Average duration is computed from session event spans in Basin SQL. |
| Revenue/ecommerce dashboard    | Missing  | Add revenue goal cards, trends, and breakdowns.                                                                                                                                                     |
| Custom-property reports        | Missing  | Add property dimensions, filters, and cards.                                                                                                                                                        |
| Expanded report metrics        | Missing  | Allow report-specific engagement, conversion, and revenue columns.                                                                                                                                  |
| Multi-select/exclusion filters | Partial  | Stats API supports richer filters; dashboard controls remain equality-oriented.                                                                                                                     |
| Saved segments                 | Missing  | Add personal and, if multi-user support is adopted, shared segments.                                                                                                                                |
| Funnels                        | Missing  | Add persisted 2-8 step sequential/strict funnels and drop-off reporting.                                                                                                                            |
| User journeys                  | Missing  | Add forward/backward session-path exploration and grouping.                                                                                                                                         |
| Annotations                    | Missing  | Persist dated notes and show them on charts.                                                                                                                                                        |
| CSV/ZIP export                 | Missing  | Export the current dashboard query and reports.                                                                                                                                                     |
| Full queued export             | Missing  | Generate downloadable native aggregate exports with expiry.                                                                                                                                         |
| Consolidated multi-site view   | Deferred | Requires cross-site query semantics, team scope, and independent configuration.                                                                                                                     |
| Site settings UI               | Missing  | Provisioning and tracker configuration are API/CLI-only.                                                                                                                                            |
| Long-term dashboard history    | Supported | Basin SQL serves all stored history with no 90-day cap; queries lag collection by a few minutes. |

Analytics Engine and the daily Arrow rollups were removed. Every accepted event is buffered in the site's SiteEvents Durable Object (a DO error returns 500) and shipped to the Basin Pipeline with retries, so a successful response means the event is durably buffered. Queryable exact session history uses the Basin SQL path over the R2 Iceberg table (plus an optional import table via `R2_SQL_IMPORT_TABLE`), which lags realtime collection by a few minutes.

The dashboard reads everything through Basin SQL sessionization; the realtime panel reads the SiteEvents Durable Object over an authenticated WebSocket.

## Collaboration and access control

noomers intentionally uses a single-organization, shared-password model. Individual identities, teams, roles, invitations, SSO, and billing-related access controls are non-goals rather than pending parity work.

| Feature                         | Status    | Remaining work                                                         |
| ------------------------------- | --------- | ---------------------------------------------------------------------- |
| Shared-password dashboard       | Supported | Current single-organization baseline.                                  |
| Individual user accounts        | Deferred  | Add identity, verification, password recovery, and profile management. |
| Roles and permissions           | Deferred  | Add owner, admin, editor, billing, viewer, and site guest roles.       |
| Team invitations                | Deferred  | Requires users, teams, email delivery, and invitation expiry.          |
| Guest editor/viewer access      | Deferred  | Current guest endpoints return `501`.                                  |
| Public dashboards               | Missing   | Add explicit per-site visibility and revocation.                       |
| Named shared links              | Deferred  | Current shared-link endpoint returns `501`.                            |
| Password-protected shared links | Deferred  | Requires shared links and secure password handling.                    |
| Segment-constrained links       | Deferred  | Requires segments and shared links.                                    |
| Embedded dashboards             | Missing   | Add embeddable, constrained, unbranded views and theme controls.       |
| Team-wide 2FA                   | Deferred  | Requires individual identities.                                        |
| SAML SSO/JIT provisioning       | Deferred  | Requires Enterprise-style identity and organization support.           |
| Per-site/scoped API keys        | Deferred  | Current API tokens are deployment-wide.                                |
| Audit logs                      | Deferred  | Requires individual identity and role-aware mutations.                 |

## Imports, migration, and exports

| Feature                             | Status  | Remaining work                                                                                                                                         |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing noomers upgrade backfill   | Partial | Installer backfills D1 from bounded distinct site IDs in a legacy Analytics Engine dataset (upgrade-only path); live validation pending. |
| Lossless Plausible raw-event import | Blocked | Determine available hosted/self-hosted export formats; scheduled hosted raw export may require Enterprise access.                                      |
| Google Analytics 4 import           | Missing | Add OAuth, property selection, aggregate mapping, progress, and overlap prevention.                                                                    |
| Plausible aggregate CSV import      | Missing | Parse supported table formats and preserve imported-data limitations.                                                                                  |
| Historical raw-event ingestion      | Missing | Add trusted timestamped ingestion, validation, idempotency, and durable writes.                                                                        |
| Import job state                    | Missing | Persist progress, failures, retries, source, and coverage dates.                                                                                       |
| Import/native deduplication         | Missing | Prevent overlapping date ranges and double counting.                                                                                                   |
| Import-aware queries                | Missing | Merge daily aggregate imports with native data and return compatibility warnings.                                                                      |
| Dashboard export                    | Missing | Export visible reports with current date range and filters.                                                                                            |
| Full aggregate export               | Missing | Add queued archive generation and expiring downloads.                                                                                                  |
| Scheduled raw-event export          | Missing | Add configurable schema, schedule, format, and object-storage destination.                                                                             |

## Reports, alerts, and integrations

| Feature                      | Status  | Remaining work                                                                                     |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Weekly email reports         | Missing | Add scheduling, recipients, rendering, and transactional email.                                    |
| Monthly email reports        | Missing | Add scheduling, recipients, rendering, and transactional email.                                    |
| Traffic-spike alerts         | Missing | Define current-visitor thresholds, cooldowns, and delivery.                                        |
| Traffic-drop alerts          | Missing | Add trailing-period baseline evaluation and delivery.                                              |
| Slack reports                | Missing | Add Slack-compatible email or direct integration.                                                  |
| Google Search Console        | Missing | Add OAuth, property mapping, delayed query data, and reports.                                      |
| Looker Studio connector      | Missing | Expose compatible scoped queries and connector authentication.                                     |
| WordPress plugin             | Missing | No official installation, proxy, or WooCommerce plugin exists.                                     |
| Google Tag Manager template  | Missing | No maintained template exists.                                                                     |
| Managed proxy                | Missing | Add a first-party-domain proxy deployment path if blocker resistance is required.                  |
| Framework integration guides | Partial | Generic tracker documentation exists; Plausible's breadth of maintained framework guides does not. |

## Privacy, retention, and deletion

### Supported privacy properties

- No raw IP address or full user-agent storage.
- Salted visitor IDs rotate daily in UTC.
- Site and hostname are included in visitor hashing.
- Ordinary URL query strings are discarded while campaign fields are extracted.
- Plausible referrer query strings and fragments are discarded.

### Remaining parity and operations

| Feature                        | Status  | Remaining work                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete site data erasure     | Partial | Collection stops immediately, the SiteEvents Durable Object is purged, and a deletion job is recorded, but Iceberg rows are not deleted (manual cleanup) and no automatic processor runs. |
| Iceberg row deletion           | Blocked | Execute row-level deletion through a writable Iceberg engine, then expire snapshots and remove orphan files; the processor records the explicit `blocked` state with the reason until such an engine exists.                                                                                                                                                          |
| Deletion-job processor         | Removed | The scheduled processor was removed with Analytics Engine; deletion tombstones and purges the Durable Object synchronously. |
| User-visible deletion status   | Missing | Expose progress without leaking internal infrastructure details.                                                                                                                                                                                                                                                                                                      |
| Configurable retention         | Missing | Add per-deployment or per-site durable-data policies.                                                                                                                                                                                                                                                                                                                 |
| Deletion SLA                   | Missing | Monitor and alert on overdue jobs.                                                                                                                                                                                                                                                                                                                                    |
| Traffic shields                | Missing | Add future-traffic exclusions by country, hostname, IP, and page.                                                                                                                                                                                                                                                                                                     |
| Data residency controls        | Missing | noomers inherits the selected Cloudflare account/resources and does not enforce a region.                                                                                                                                                                                                                                                                             |
| Export/data-subject workflow   | Missing | Add a documented administrative export and deletion process.                                                                                                                                                                                                                                                                                                          |
| Broader bot filtering          | Partial | The implementation does not match Plausible's full UA, referrer, data-center, and behavioral filtering.                                                                                                                                                                                                                                                               |

## Deployment and operations

### Automated today

- Worker deployment.
- D1 creation/reuse and migrations.
- Visitor salt and dashboard password configuration.
- Persisted local deployment metadata.

### Remaining parity and production hardening

| Feature                              | Status    | Remaining work                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial site creation                | Partial   | Installer prompts for/accepts a domain and IANA timezone and provisions the site idempotently; live validation against a deployed Worker pending.                                                                                                                                                                                                               |
| Existing-site upgrade migration      | Partial   | Installer discovers bounded distinct site IDs in a legacy Analytics Engine dataset as backfill candidates and inserts them into D1 before fail-closed collection; backfill is fail-closed (aborts on discovery error, malformed ID, over-bounds, decline, or insert failure) and inserts skip already-registered and tombstoned sites; live validation pending. |
| Pipeline/Basin Catalog provisioning   | Blocked   | Wrangler's setup is credential-dependent and interactive; automate when a stable non-interactive path exists.                                                                                                                                                                                                                                                   |
| Basin SQL credential provisioning       | Blocked   | Create/scoped credentials and configure secrets through a supported API flow.                                                                                                                                                                                                                                                                                   |
| Stats/Sites API token configuration  | Partial   | Fresh installs securely accept a strong user-provided token and write it to `STATS_API_TOKEN` and `SITES_API_TOKEN`; existing installs securely prompt for the existing token and are never silently rotated; an `env api-token` alias rotates both; live verification pending.                                                                                 |
| Pipeline binding metadata            | Supported | Reinstalls preserve the runtime `EVENT_STREAM` binding and reject stale `EVENTS_PIPELINE` metadata before deployment.                                                                                                                                                                                                                                           |
| Dependency-aware health checks       | Missing   | Check D1, the SiteEvents binding, Pipeline configuration, and Basin SQL rather than always returning `ok`. |
| Pipeline retry/dead-letter handling  | Missing   | Durable send failures are currently logged while collection succeeds.                                                                                                                                                                                                                                                                                           |

| Rate limiting and quotas             | Missing   | Protect Events, Stats, and Sites APIs.                                                                                                                                                                                                                                                                                                                          |
| Monitoring and SLOs                  | Missing   | Add ingestion/query latency, error, lag, and deletion dashboards and alerts.                                                                                                                                                                                                                                                                                    |
| Backup and restore                   | Missing   | Document and automate D1 backup plus durable-event recovery.                                                                                                                                                                                                                                                                                                    |
| Disaster recovery                    | Missing   | Define resource recreation and data restoration procedures.                                                                                                                                                                                                                                                                                                     |
| Migration rollback                   | Missing   | Define safe behavior for failed schema or deployment upgrades.                                                                                                                                                                                                                                                                                                  |
| Pipeline lag visibility              | Missing   | Surface durable-data freshness in API/dashboard responses.                                                                                                                                                                                                                                                                                                      |

## Additional production hardening

These are noomers reliability improvements, not documented Plausible public API parity requirements.

| Feature                       | Status  | Remaining work                                                                                                                                                                                                                                 |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted event timestamps      | Missing | Add a restricted path for backdated migration events without weakening public ingestion.                                                                                                                                                       |
| Event deduplication           | Partial | Basin SQL read paths collapse duplicate durable copies that share a non-empty canonical `event_id` before aggregation/sessionization. Empty or missing IDs and client retries remain distinct; duplicate Iceberg rows are not erased and storage-level idempotent writes remain unimplemented. |
| Batch ingestion               | Missing | Add a bounded administrative batch path if migration throughput requires it.                                                                                                                                                                   |
| Ingestion rate limits         | Missing | Add deployment-wide and per-site limits without allowing one site to starve others.                                                                                                                                                            |
| Durable-write acknowledgement | Missing | A successful collection response confirms request validation/acceptance and that realtime Analytics Engine and optional durable writes were attempted; it is not proof of provider persistence or a durable Pipeline/Iceberg or Basin SQL record. |

## Explicit non-goals

The following Plausible features depend on a multi-user SaaS or commercial control plane and are outside noomers's product scope:

- Billing, trials, subscriptions, plan limits, and usage lockouts.
- Separately billed teams and cross-team site transfers.
- Enterprise support workflows and managed onboarding.
- SAML SSO, organization policy, and JIT user provisioning.
- Contract-defined raw-event exports and data-retention agreements.

These items are not part of the implementation roadmap.

## Compatibility claims

Until the relevant rows above are complete, documentation should avoid claiming:

- Full or drop-in Plausible compatibility.
- Full Stats API v2 support.
- Revenue analytics or custom-property analytics.
- Property-filtered goal reporting.
- Exact Plausible session metrics without Basin SQL.
- Long-term dashboard analytics from the daily Arrow archive.
- Complete data erasure immediately after deleting a site.
- Real teams, guests, or shared links.
- Plausible or Google Analytics imports.
- Fully automated infrastructure provisioning.

## Official Plausible references

- [Events API](https://plausible.io/docs/events-api)
- [Stats API](https://plausible.io/docs/stats-api)
- [Legacy Stats API v1](https://plausible.io/docs/stats-api-v1)
- [Sites API](https://plausible.io/docs/sites-api)
- [Goals and conversions](https://plausible.io/docs/goal-conversions)
- [Custom properties](https://plausible.io/docs/custom-props/introduction)
- [Ecommerce and revenue](https://plausible.io/docs/ecommerce-revenue-tracking)
- [Dashboard tour](https://plausible.io/docs/guided-tour)
- [Filters and segments](https://plausible.io/docs/filters-segments)
- [Funnels](https://plausible.io/docs/funnel-analysis)
- [User journeys](https://plausible.io/docs/user-journeys)
- [Users and roles](https://plausible.io/docs/users-roles)
- [Shared links](https://plausible.io/docs/shared-links)
- [Google Analytics import](https://plausible.io/docs/google-analytics-import)
- [CSV import](https://plausible.io/docs/csv-import)
- [Statistics export](https://plausible.io/docs/export-stats)
- [Raw data export](https://plausible.io/docs/raw-data-export)
- [Email reports](https://plausible.io/docs/email-reports)
- [Traffic alerts](https://plausible.io/docs/traffic-spikes)
- [Privacy data policy](https://plausible.io/data-policy)
- [Bot filtering](https://plausible.io/docs/bot-traffic-filtering)

These upstream documents change over time. Recheck them before declaring a parity item complete.


## Notes (hardening round)

- `visit:source` (utm_source → referrer hostname sans www → Direct) is the
  canonical source dimension for the dashboard Sources card.
- `event:props:<key>` (custom-event property breakdown) requires an
  `event:name` `is`-filter naming one event.
- Visit duration is computed over non-engagement events only
  (max−min of the session's interactive events), matching Plausible's
  session-window semantics — imported `sessions_v2.duration` and live
  durations line up.
