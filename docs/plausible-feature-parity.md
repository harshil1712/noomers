# Plausible feature parity

This document tracks the remaining work required for noomers to behave like Plausible Analytics. It covers the hosted product and its public APIs, not Plausible's billing, support, or internal administration systems.

Last reviewed: 2026-11-05.

## Status definitions

| Status    | Meaning                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Supported | The current implementation covers the documented behavior closely enough for normal use.                |
| Partial   | A usable subset exists, but documented behavior or important semantics are missing.                     |
| Missing   | No implementation exists.                                                                               |
| Deferred  | Explicitly out of scope for the single-organization product; not planned work.                          |
| Blocked   | Implementation or validation requires external infrastructure, credentials, or upstream product access. |

noomers has never been deployed, so nothing below has been validated against live Cloudflare resources. Passing unit tests only prove noomers's local contracts; all generated Basin SQL (formerly R2 SQL), the Basin Pipeline path, and the SiteEvents Durable Object must be exercised against a real deployment before parity can be claimed.

## Current baseline

noomers currently has:

- Plausible-compatible `POST /api/event`, native `GET /collect`, and `GET /api/health` endpoints.
- A partial `POST /api/v2/query` Stats API.
- Partial Sites API provisioning, goals, and custom-property registration.
- A Better Auth–gated, single-owner dashboard (session user with `role === "admin"`; `OWNER_ADMIN_EMAIL` bootstraps the first admin) with summary, time-series, page, referrer, event, goal, property, browser, country, device, and UTM reports, plus a realtime tab served by the SiteEvents Durable Object over WebSocket.
- Canonical event storage through Basin Pipelines (formerly Cloudflare Pipelines), Basin Catalog (formerly R2 Data Catalog), and Basin SQL, all provisioned by `alchemy.run.ts`.
- A D1 site registry, permanent deletion tombstones, per-site SiteEvents Durable Objects (purged on delete), and deletion-job records tracking Iceberg maintenance state.
- Deployment-wide bearer tokens for the Plausible APIs (`SITES_API_TOKEN`, `STATS_API_TOKEN`) and an optional first-party server tracker token (`SERVER_EVENTS_TOKEN`).
- A historical-import path: `scripts/plausible-import/` loads a self-hosted Plausible `events_v2` export into a second Iceberg table that `R2_SQL_IMPORT_TABLE` merges into every query.
- A token-gated `/api/health/ready` readiness endpoint that checks D1, per-site Durable Object backlog, and Basin SQL reachability/freshness.

This is not yet a drop-in replacement for the full Plausible product.

## Highest-priority gaps

P0 items block safe installation, correct core analytics, or complete deletion. P1 items expand compatibility after that baseline is reliable.

| Priority | Feature                                          | Why it matters                                                                                                                                                                  |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Live deployment and Basin SQL validation         | noomers has never been deployed; generated SQL, response shapes, the Pipeline sink, and the Durable Object are unvalidated against real Cloudflare resources.                   |
| P0       | Complete deletion execution                      | Site deletion tombstones the site, purges its Durable Object, and records a deletion job, but Iceberg rows are not erased — no processor runs and cleanup is manual.            |
| P1       | Entry and exit page dimensions and reports       | Sessions are reconstructed for visit metrics, but first/last pageview attribution is not exposed as entry/exit dimensions in the Stats API or the dashboard.                    |
| P1       | Goal, revenue, and conversion reporting          | Goal definitions and revenue fields exist and the dashboard reports per-goal conversions, but the Stats API has no goal dimension, conversion metrics, or revenue metrics.      |
| P1       | Visit dimensions in the Stats API                | `visit:*` first-pageview attribution exists internally for dashboard cards but is not exposed through `/api/v2/query`; channel classification is missing.                       |
| P1       | Historical imports beyond self-hosted raw export | Only the self-hosted Plausible `events_v2` → Iceberg import path exists; GA4, CSV, and hosted-Plausible imports are missing, and imports have no job tracking or deduplication. |
| P1       | Broader Stats API query model                    | Multiple dimensions, logical filters, regex, behavioral filters, and property filters are missing.                                                                              |

## Events API and tracking

### Supported

- Pageviews, custom events, and engagement events through `POST /api/event` and `GET /collect`.
- Long-form and compact Plausible payload fields.
- Scalar event properties, revenue payloads, `interactive`, engagement time, scroll depth, and hash-based routing input.
- CORS preflight, `X-Forwarded-For`, `X-Debug-Request`, bot dropping, URL normalization, and static health endpoint compatibility.
- Browser and server noomers tracker modules with manual pageviews and custom events.

### Remaining parity

| Feature                           | Status    | Remaining work                                                                                                                                                                             |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Official Plausible tracker script | Partial   | noomers accepts official tracker payloads and serves a per-site `pa-<id>.js` Plausible-compat snippet from a template. Validate current official tracker versions continuously.            |
| Outbound-link tracking            | Missing   | Add automatic browser instrumentation and compatible event/property names.                                                                                                                 |
| File-download tracking            | Missing   | Detect configured file extensions and emit compatible events.                                                                                                                              |
| Form-submission tracking          | Missing   | Add form instrumentation and compatible properties.                                                                                                                                        |
| Tagged-event tracking             | Missing   | Support Plausible's CSS-class and data-attribute conventions.                                                                                                                              |
| Automatic 404 tracking            | Missing   | Detect and report 404 pages through the served tracker integration.                                                                                                                        |
| Automatic scroll-depth reporting  | Supported | The noomers tracker generates bounded scroll-depth values sent with engagement events and stored in the Iceberg table. Stats API `scroll_depth` metrics and dashboard reports are missing. |
| Revenue tracking                  | Partial   | Revenue is validated and stored in durable events, but Stats API, goals, and the dashboard do not report it.                                                                               |
| Engagement reporting              | Partial   | The native tracker emits bounded engagement-time deltas and scroll-depth values. Engagement events are stored in the Iceberg table; visit duration is computed from session event spans.   |
| Tracker configuration             | Partial   | Sites API stores Plausible-style tracker settings, but most settings do not alter the served noomers tracker.                                                                              |
| Native `/collect` bot filtering   | Supported | `/collect` shares the UA-based bot policy with `/api/event`, exempting only the first-party `noomers-tracker-server/` UA prefix.                                                           |
| Collection rate limiting          | Partial   | `COLLECT_RATE_LIMIT` throttles `/collect` and `/api/event` per IP+site; per-site quotas and fair-use limits beyond that are missing.                                                       |

## Stats API v2

### Supported

Metrics:

- `visitors`
- `visits`
- `pageviews`
- `views_per_visit`
- `bounce_rate`
- `visit_duration`
- `events`

All metrics are computed through Basin SQL; session metrics require it and the query fails with a clear error when it is not configured. None of this has been validated against a live Basin SQL service.

Dimensions:

- `event:page`
- `event:hostname`
- `event:name`
- `event:props:<key>` (requires an `event:name` `is`-filter naming exactly one event, matching Plausible's constraint; keys are not checked against registered custom properties)
- `time`, `time:hour`, `time:day`, `time:week`, and `time:month`

Hostname breakdowns support `visitors`, `pageviews`, and `events`. Hostname-only queries using session metrics are rejected because the supported Plausible combination also requires `event:page`, while noomers supports only one dimension.

Filters:

- `is`
- `is_not`
- `contains`
- `contains_not`
- Multiple values and repeated filters, with top-level implicit AND

Filters use the three-element `[operator, dimension, values]` form, are case-sensitive, and support `event:page`, `event:hostname`, and `event:name`.

Query behavior:

- Documented date presets and custom date/date-time ranges.
- Site reporting timezones and DST-aware time boundaries.
- One order clause, pagination, `include.time_labels`, and `include.total_rows`.
- `include.imports` is accepted but `meta.imports_included` always reports `false`. When `R2_SQL_IMPORT_TABLE` is configured, imported rows are merged into every query regardless of this flag.
- Visit duration is computed over non-engagement events only (max−min of the session's interactive events), matching Plausible's session-window semantics.

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

| Dimension family                            | Status  | Remaining work                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `event:goal`                                | Missing | Resolve event and page goals, including property constraints.                                                                                                                                                                                                                        |
| `event:props:*`                             | Partial | Supported with an `event:name` `is`-filter naming one event. Registration is not enforced — any well-formed key is queried; filters on property values are missing.                                                                                                                  |
| Entry and exit page/hostname                | Missing | Sessionization computes an internal entry page for visit-dimension attribution; expose `visit:entry_page`/`visit:exit_page` first/last pageview dimensions.                                                                                                                          |
| Source, referrer, and channel               | Partial | `visit:source` (utm_source → referrer hostname sans www → Direct) and `visit:referrer` are attributed from the session's first pageview for dashboard cards; they are not exposed through `/api/v2/query` and channel classification is missing. Unvalidated against live Basin SQL. |
| UTM medium/source/campaign/content/term     | Partial | `visit:utm_*` first-pageview attribution exists for dashboard cards; not exposed through `/api/v2/query`. Unvalidated against live Basin SQL.                                                                                                                                        |
| Device, browser, and versions               | Partial | `visit:browser`, `visit:browser_version`, `visit:device_type`, and `visit:device_model` are first-pageview-attributed for dashboard cards; not exposed through `/api/v2/query`. Unvalidated against live Basin SQL.                                                                  |
| Operating system and version                | Missing | Stored in durable events; no visit-dimension, Stats API, or dashboard wiring exists yet.                                                                                                                                                                                             |
| Country, region, and city identifiers/names | Partial | `visit:country` is first-pageview-attributed and the dashboard country card renders ISO codes with display names; region/city are stored but not queryable, and the Stats API exposes no geography dimension. Unvalidated against live Basin SQL.                                    |
| Multiple dimensions                         | Missing | Replace scalar dimension rows with tuples across validation, SQL, ordering, totals, and response construction.                                                                                                                                                                       |

Visit dimensions must not be implemented by grouping raw event rows. Plausible attributes visit dimensions from the session's first pageview; the internal implementation does so through a `FIRST_VALUE(dimension_value) FILTER (WHERE event_type = 'pageview')` expression over reconstructed 30-minute sessions.

### Remaining filters and query semantics

| Feature                       | Status   | Remaining work                                                                                                                                                                                   |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matches` and `matches_not`   | Missing  | Add RE2-compatible validation and Basin SQL rendering.                                                                                                                                           |
| Case-insensitive modifiers    | Missing  | Support `{case_sensitive:false}` where Plausible permits it.                                                                                                                                     |
| Nested `and`, `or`, and `not` | Missing  | Introduce a bounded filter AST and safe SQL compilers.                                                                                                                                           |
| `has_done` and `has_not_done` | Missing  | Evaluate behavioral conditions over reconstructed sessions.                                                                                                                                      |
| Saved-segment filters         | Missing  | Persist segments and expand them into validated filters.                                                                                                                                         |
| Goal filters                  | Missing  | Resolve goal definitions and supported goal operators.                                                                                                                                           |
| Property filters              | Missing  | Filter by `event:props:*` values; today props work only as a breakdown dimension.                                                                                                                |
| Visit-scoped filters          | Missing  | Apply filters to first-page/session attributes rather than individual events.                                                                                                                    |
| Multiple `order_by` clauses   | Missing  | Add deterministic tuple ordering in both data sources.                                                                                                                                           |
| Imported-data queries         | Partial  | `R2_SQL_IMPORT_TABLE` unions a compatible Iceberg import table into every query. Plausible aggregate-import semantics, `include.imports` behavior, warnings, and overlap prevention are missing. |
| Metric warnings               | Missing  | Return warnings for unavailable or partially evaluated metrics/dimensions.                                                                                                                       |
| Comparison periods            | Missing  | Add previous-period and year-over-year comparison output if targeting product-query parity.                                                                                                      |
| API rate limiting             | Missing  | `/api/v2/query` has no token-level limits; only collection and auth endpoints are throttled.                                                                                                     |
| Scoped API keys               | Deferred | Current tokens authorize every registered site in one deployment.                                                                                                                                |

### Correctness and scale gaps

| Gap                                  | Status    | Remaining work                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Basin SQL validation            | Blocked   | noomers has never been deployed, so generated SQL, response shapes, and session arithmetic are validated only by tests over a mocked query seam. Validate basic, session, filter, time-bucket, pagination, and error behavior against the live service once a deployment exists.                                                             |
| Session behavior across UTC midnight | Partial   | Daily visitor IDs intentionally prevent cross-day linkage; document and test resulting visit differences.                                                                                                                                                                                                                                    |
| Page session attribution             | Supported | Visit dimensions are attributed from each session's first pageview via `FIRST_VALUE ... FILTER (WHERE event_type = 'pageview')`; SQL-generation tests assert the construct. Unvalidated against live Basin SQL.                                                                                                                              |
| R2 row pagination                    | Partial   | Basin SQL has no OFFSET; breakdowns paginate deterministically with `ROW_NUMBER() OVER (...)` + a `dimension` tie-breaker and bounded `row_num` filters, matching the requested Stats API metric order. Unvalidated against live Basin SQL.                                                                                                  |
| Long R2 time ranges                  | Partial   | Bucketed dimensions compile to generated `CASE` expressions bounded to 10,000 labels (and 500 buckets for session time dimensions, which reject with an error). Prefer native timezone-aware bucketing for very long ranges.                                                                                                                 |
| R2 total rows                        | Partial   | `COUNT(*) OVER ()` returns the full matching group count independently of the fetched page; `include.total_rows` reports it. Unvalidated against live Basin SQL.                                                                                                                                                                             |
| R2 query-time event deduplication    | Partial   | `getSessionMetrics`, `getBasicMetrics`, `getSessionBreakdown`, and `getGoalConversions` collapse duplicate durable copies that share a non-empty canonical `event_id` before aggregation/sessionization. Empty or missing IDs remain distinct; client retries receive new IDs, and storage-level durable idempotency is still unimplemented. |

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
| Domain rename                        | Missing  | Define a migration/alias strategy because existing durable event records are immutable.                           |
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

| Feature                           | Status    | Remaining work                                                                                                                                                         |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact event goals                 | Supported | Maintain Events API and dashboard compatibility tests.                                                                                                                 |
| Exact page goals                  | Supported | Maintain query and provisioning compatibility tests.                                                                                                                   |
| Wildcard page goals               | Missing   | Add wildcard syntax and matching semantics.                                                                                                                            |
| Unique conversions                | Supported | Counts follow the privacy-preserving daily visitor identity model (`COUNT(DISTINCT visitor_id)` per goal).                                                             |
| Total conversions                 | Partial   | The dashboard goals endpoint reports non-unique conversion counts per goal; the Stats API has no conversion metric.                                                    |
| Conversion rates in Stats API     | Missing   | Implement conversion metrics and goal dimensions. The dashboard reports a per-goal rate against total visitors.                                                        |
| Property-filtered conversions     | Partial   | Definitions persist properties, but queries ignore them.                                                                                                               |
| Revenue goals and attribution     | Missing   | Connect durable revenue records to goals, currency, and conversion reports.                                                                                            |
| Custom-property registration      | Supported | Keep Sites API metadata behavior compatible.                                                                                                                           |
| Property dimensions and filters   | Partial   | `event:props:<key>` breakdowns work in the Stats API (with an `event:name` filter) and the dashboard; property-value filters and registration enforcement are missing. |
| Property registration enforcement | Missing   | Decide whether unregistered keys are accepted, hidden, or rejected — today any well-formed key is queryable.                                                           |
| Ecommerce reports                 | Missing   | Add purchase/product revenue, attribution, and breakdowns.                                                                                                             |
| WooCommerce/Shopify integrations  | Missing   | No first-party commerce integrations or setup automation exist.                                                                                                        |

## Dashboard and analysis

### Current reports

- Visitors, pageviews, bounce rate, visits, and average visit duration through Basin SQL sessionization.
- Previous-period summary metrics (the immediately preceding equal-length range) with delta badges.
- Visitors, views, and bounce time series.
- Pages, referrers, events, goals (with per-goal conversion rate), event properties, browsers, browser versions, countries, devices, and UTM breakdowns.
- A realtime tab: 5-minute current visitors, rolling 30-minute visitors/pageviews, per-minute pageviews, and top pages/referrers/countries, pushed over an admin-authenticated WebSocket by the site's SiteEvents Durable Object.
- Equality filters through URL parameters and paginated tables.

### Remaining parity

| Feature                        | Status    | Remaining work                                                                                                                                                                                    |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime/current visitors      | Supported | The realtime tab shows 5-minute current visitors and rolling 30-minute activity via the SiteEvents DO WebSocket (`/realtime/:siteId`, admin session only). Unvalidated against a live deployment. |
| Previous-period comparison     | Partial   | The summary endpoint returns metrics for the immediately preceding equal-length period; no selectable comparison ranges.                                                                          |
| Year-over-year comparison      | Missing   | Add timezone-aware annual comparison.                                                                                                                                                             |
| Custom comparison              | Missing   | Support arbitrary comparison ranges.                                                                                                                                                              |
| Visit/source/channel reports   | Partial   | Referrer, source, and UTM reports are session-correct (first-pageview attribution); channel classification and entry/exit reports are missing.                                                    |
| Entry/exit reports             | Missing   | Derive first/last pageviews per visit.                                                                                                                                                            |
| Region/city maps               | Missing   | Region and city are stored on durable events; add aggregation and visualization.                                                                                                                  |
| OS and version reports         | Missing   | Add report routes and cards.                                                                                                                                                                      |
| Scroll depth                   | Missing   | Tracker generation is supported; add page-level average scroll reporting via Stats API and dashboard.                                                                                             |
| Time on page                   | Missing   | Derive engagement and expose page metrics.                                                                                                                                                        |
| Native average visit duration  | Supported | Computed from session event spans (max−min of non-engagement events) in Basin SQL. Unvalidated live.                                                                                              |
| Revenue/ecommerce dashboard    | Missing   | Add revenue goal cards, trends, and breakdowns.                                                                                                                                                   |
| Custom-property reports        | Partial   | A per-event property breakdown card exists (`/api/dashboard/props`); no property filters or standalone property report.                                                                           |
| Expanded report metrics        | Missing   | Allow report-specific engagement, conversion, and revenue columns.                                                                                                                                |
| Multi-select/exclusion filters | Partial   | Stats API supports richer filters; dashboard controls remain equality-oriented.                                                                                                                   |
| Saved segments                 | Missing   | Add personal and, if multi-user support is adopted, shared segments.                                                                                                                              |
| Funnels                        | Missing   | Add persisted 2-8 step sequential/strict funnels and drop-off reporting.                                                                                                                          |
| User journeys                  | Missing   | Add forward/backward session-path exploration and grouping.                                                                                                                                       |
| Annotations                    | Missing   | Persist dated notes and show them on charts.                                                                                                                                                      |
| CSV/ZIP export                 | Missing   | Export the current dashboard query and reports.                                                                                                                                                   |
| Full queued export             | Missing   | Generate downloadable native aggregate exports with expiry.                                                                                                                                       |
| Consolidated multi-site view   | Deferred  | Requires cross-site query semantics, team scope, and independent configuration.                                                                                                                   |
| Site settings UI               | Partial   | Admins can add a site (domain + reporting timezone), change its timezone, and delete it from the dashboard. Tracker configuration, goal management UI, and deletion status remain API-only.       |
| Long-term dashboard history    | Supported | Basin SQL serves all stored history with no fixed retention cap; queries lag collection by a few minutes.                                                                                         |

Every accepted event is buffered in the site's SiteEvents Durable Object (a DO error returns 500) and shipped to the Basin Pipeline with backoff retries, so a successful response means the event is durably buffered — not that it is queryable yet. Exact session history comes from Basin SQL over the `noomers.events` Iceberg table (plus an optional import table via `R2_SQL_IMPORT_TABLE`), which lags realtime collection by a few minutes.

The dashboard reads everything through Basin SQL sessionization; the realtime tab reads the SiteEvents Durable Object over an authenticated WebSocket.

## Collaboration and access control

noomers is a single-owner deployment: Better Auth provides sign-up/sign-in (with email verification, optional Google OAuth, Turnstile, and `SIGNUP_DISABLED`), and every dashboard surface requires a session user with `role === "admin"`; `OWNER_ADMIN_EMAIL` bootstraps the first admin. Non-admin signed-in users get 403. Teams, per-user roles, invitations, SSO, and billing-related access controls are non-goals rather than pending parity work.

| Feature                         | Status    | Remaining work                                                                                 |
| ------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| Single-owner admin dashboard    | Supported | Better Auth session with `role === "admin"` gates `/api/dashboard/*` and `/realtime/:siteId`.  |
| Additional non-admin users      | Partial   | Other accounts can sign up/sign in but receive 403 on all dashboard surfaces.                  |
| Roles and permissions           | Deferred  | Add owner, admin, editor, billing, viewer, and site guest roles beyond the single-admin model. |
| Team invitations                | Deferred  | Requires teams, email delivery beyond auth mail, and invitation expiry.                        |
| Guest editor/viewer access      | Deferred  | Current guest endpoints return `501`.                                                          |
| Public dashboards               | Missing   | Add explicit per-site visibility and revocation.                                               |
| Named shared links              | Deferred  | Current shared-link endpoint returns `501`.                                                    |
| Password-protected shared links | Deferred  | Requires shared links and secure password handling.                                            |
| Segment-constrained links       | Deferred  | Requires segments and shared links.                                                            |
| Embedded dashboards             | Missing   | Add embeddable, constrained, unbranded views and theme controls.                               |
| Team-wide 2FA                   | Deferred  | Requires multi-user identity policy beyond Better Auth's built-in options.                     |
| SAML SSO/JIT provisioning       | Deferred  | Requires Enterprise-style identity and organization support.                                   |
| Per-site/scoped API keys        | Deferred  | Current API tokens are deployment-wide.                                                        |
| Audit logs                      | Deferred  | Requires multi-actor identity and role-aware mutations.                                        |

## Imports, migration, and exports

| Feature                                | Status  | Remaining work                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted Plausible raw-event import | Partial | `scripts/plausible-import/` exports `plausible.events_v2` over SSH from a self-hosted Plausible host and appends rows to an Iceberg import table merged via `R2_SQL_IMPORT_TABLE`. Append-only with a `--replace` guard; no job tracking or overlap prevention. Hosted Plausible export formats are unsupported. |
| Lossless hosted Plausible import       | Blocked | Determine available hosted export formats; scheduled hosted raw export may require Enterprise access.                                                                                                                                                                                                            |
| Google Analytics 4 import              | Missing | Add OAuth, property selection, aggregate mapping, progress, and overlap prevention.                                                                                                                                                                                                                              |
| Plausible aggregate CSV import         | Missing | Parse supported table formats and preserve imported-data limitations.                                                                                                                                                                                                                                            |
| Historical raw-event ingestion         | Partial | The importer writes timestamped rows directly into the import Iceberg table; there is no authenticated in-app ingestion path for backdated events.                                                                                                                                                               |
| Import job state                       | Missing | Persist progress, failures, retries, source, and coverage dates.                                                                                                                                                                                                                                                 |
| Import/native deduplication            | Missing | Prevent overlapping date ranges and double counting; the import table is unioned unconditionally.                                                                                                                                                                                                                |
| Import-aware queries                   | Partial | `R2_SQL_IMPORT_TABLE` rows are merged into all queries; `include.imports` is accepted but `meta.imports_included` always reports `false`, and there are no warnings.                                                                                                                                             |
| Dashboard export                       | Missing | Export visible reports with current date range and filters.                                                                                                                                                                                                                                                      |
| Full aggregate export                  | Missing | Add queued archive generation and expiring downloads.                                                                                                                                                                                                                                                            |
| Scheduled raw-event export             | Missing | Add configurable schema, schedule, format, and object-storage destination.                                                                                                                                                                                                                                       |

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

| Feature                      | Status  | Remaining work                                                                                                                                                                                           |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete site data erasure   | Partial | Collection stops immediately, the SiteEvents Durable Object is purged, and a `site_deletion_jobs` row is recorded, but Iceberg rows are not deleted — cleanup is manual.                                 |
| Iceberg row deletion         | Missing | Execute row-level deletion through a writable Iceberg engine (e.g. PyIceberg via Basin Catalog), then expire snapshots and remove orphan files. No such job exists yet, so deletion jobs stay `pending`. |
| Deletion-job processor       | Missing | No processor runs: deletion tombstones and purges the Durable Object synchronously and records a job for manual follow-up. Add an automated processor only if a writable Iceberg engine is adopted.      |
| User-visible deletion status | Missing | Expose progress without leaking internal infrastructure details.                                                                                                                                         |
| Configurable retention       | Missing | Add per-deployment or per-site durable-data policies.                                                                                                                                                    |
| Deletion SLA                 | Missing | Monitor and alert on overdue jobs.                                                                                                                                                                       |
| Traffic shields              | Missing | Add future-traffic exclusions by country, hostname, IP, and page.                                                                                                                                        |
| Data residency controls      | Missing | noomers inherits the selected Cloudflare account/resources and does not enforce a region.                                                                                                                |
| Export/data-subject workflow | Missing | Add a documented administrative export and deletion process.                                                                                                                                             |
| Broader bot filtering        | Partial | The implementation does not match Plausible's full UA, referrer, data-center, and behavioral filtering.                                                                                                  |

## Deployment and operations

All infrastructure is provisioned by `alchemy.run.ts` (Alchemy v2): the D1 database and migrations, the R2 warehouse bucket and Basin Data Catalog, the Pipeline stream/sink/pipeline, the Basin SQL read token and sink token (minted as account API tokens), generated `BETTER_AUTH_SECRET`/`VISITOR_SALT` secrets, Turnstile and email-sending resources on prod, and both Workers. Deploys happen only through the PR preview/production CI workflows.

### Remaining parity and operations

| Feature                             | Status    | Remaining work                                                                                                                                                                                   |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial site creation               | Supported | Admins add sites from the dashboard's add-site dialog, which then shows the tracker snippet; `POST /api/v1/sites` remains available for automation. Unvalidated live.                            |
| Basin Pipeline/Catalog provisioning | Supported | Stream, sink, pipeline, catalog, bucket, and both API tokens are created by `alchemy.run.ts`; unvalidated until a real deploy runs.                                                              |
| Basin SQL credential provisioning   | Supported | A least-privilege read token is minted as an account API token by `alchemy.run.ts`; unvalidated until a real deploy runs.                                                                        |
| Stats/Sites API token configuration | Partial   | `SITES_API_TOKEN` and `STATS_API_TOKEN` are operator-provided secrets read from env; there is no assisted setup or rotation flow.                                                                |
| Pipeline binding metadata           | Supported | The runtime `EVENT_STREAM` binding is provisioned and bound by `alchemy.run.ts`.                                                                                                                 |
| Dependency-aware health checks      | Supported | `/api/health/ready` (token-gated) checks D1, per-site DO backlog/failures, Basin SQL reachability, and durable freshness; `/api/health` stays a static compatibility response. Unvalidated live. |
| Pipeline retry/dead-letter handling | Partial   | The DO retries failed `EVENT_STREAM` sends with exponential backoff and keeps unshipped rows; there is no dead-letter destination or operator alert on sustained failure.                        |
| Collection/auth rate limiting       | Partial   | `COLLECT_RATE_LIMIT` throttles `/collect` and `/api/event` per IP+site; `RATE_LIMITER` throttles auth POSTs per IP. Stats and Sites APIs have no limits.                                         |
| Monitoring and SLOs                 | Partial   | Workers observability (logs and traces) is enabled; there are no defined SLOs, dashboards, or alerts for ingestion/query latency, durable lag, or deletion.                                      |
| Pipeline lag visibility             | Partial   | Readiness reports DO backlog and Basin freshness per site, and realtime stats expose unshipped counts; no freshness surface in Stats API or dashboard responses.                                 |
| Backup and restore                  | Missing   | Document and automate D1 backup plus durable-event recovery.                                                                                                                                     |
| Disaster recovery                   | Missing   | Define resource recreation and data restoration procedures.                                                                                                                                      |
| Migration rollback                  | Missing   | Define safe behavior for failed schema or deployment upgrades.                                                                                                                                   |

## Additional production hardening

These are noomers reliability improvements, not documented Plausible public API parity requirements.

| Feature                       | Status  | Remaining work                                                                                                                                                                                                                                       |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted event timestamps      | Missing | Add a restricted path for backdated migration events without weakening public ingestion.                                                                                                                                                             |
| Event deduplication           | Partial | Basin SQL read paths collapse duplicate durable copies that share a non-empty canonical `event_id` before aggregation/sessionization. Empty or missing IDs and client retries remain distinct; storage-level idempotent writes remain unimplemented. |
| Batch ingestion               | Missing | Add a bounded administrative batch path if migration throughput requires it.                                                                                                                                                                         |
| Ingestion rate limits         | Partial | Per-IP+site collection limits exist; add deployment-wide and per-site limits without allowing one site to starve others.                                                                                                                             |
| Durable-write acknowledgement | Partial | A successful collection response confirms the event is durably buffered in the site's SiteEvents DO (a DO error returns 500); it is not proof of Pipeline delivery or a Basin SQL-visible Iceberg record, which lag by minutes.                      |

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
- Revenue analytics or custom-property filters.
- Property-filtered goal reporting.
- Entry/exit page or channel reporting.
- Plausible or Google Analytics imports beyond the self-hosted `events_v2` path.
- Complete data erasure immediately after deleting a site.
- Real teams, guests, or shared links.
- Any behavior validated against live Cloudflare resources — nothing has been deployed yet.

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
