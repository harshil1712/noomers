# Plausible feature parity

This document tracks the remaining work required for noomers to behave like Plausible Analytics. It covers the hosted product and its public APIs, not Plausible's billing, support, or internal administration systems.

Last reviewed: 2026-08-04.

## Status definitions

| Status    | Meaning                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Supported | The current implementation covers the documented behavior closely enough for normal use.                |
| Partial   | A usable subset exists, but documented behavior or important semantics are missing.                     |
| Missing   | No implementation exists.                                                                               |
| Deferred  | Intentionally excluded from the current single-organization architecture.                               |
| Blocked   | Implementation or validation requires external infrastructure, credentials, or upstream product access. |

Passing unit tests only prove noomers's local contracts. Analytics Engine and R2 SQL behavior must also be validated against deployed Cloudflare resources before full parity can be claimed.

## Current baseline

noomers currently has:

- Plausible-compatible `POST /api/event` and `GET /api/health` endpoints.
- A partial `POST /api/v2/query` Stats API.
- Partial Sites API provisioning, goals, and custom-property registration.
- A noomers dashboard with summary, time-series, page, referrer, event, goal, browser, country, device, and UTM reports.
- Optional canonical event storage through Cloudflare Pipelines, Data Catalog, and R2 SQL.
- A D1 site registry, permanent deletion tombstones, and deletion-job records.
- A single shared-password dashboard and deployment-wide API tokens.

This is not yet a drop-in replacement for the full Plausible product.

## Highest-priority gaps

P0 items block safe installation, correct core analytics, or complete deletion. P1 items expand compatibility after that baseline is reliable.

| Priority | Feature                                         | Why it matters                                                                                                                          |
| -------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Initial site provisioning and upgrade migration | Collection rejects unknown sites, but the installer does not create a site or backfill existing Analytics Engine site IDs.              |
| P0       | Session-correct visit dimensions                | Source, campaign, geography, technology, entry, and exit reports require first-page session attribution rather than event-row grouping. |
| P0       | Complete deletion execution                     | Iceberg rows and daily Arrow rollups are not automatically erased when a site is deleted.                                               |
| P1       | Automated durable-event provisioning            | Exact session metrics require Pipeline, Data Catalog, and R2 SQL resources that are currently configured manually.                      |
| P1       | Goal and revenue reporting                      | Revenue and goal definitions exist, but Stats API and dashboard reporting remain incomplete.                                            |
| P1       | Historical imports                              | There is no Plausible, Google Analytics, or CSV migration path.                                                                         |
| P1       | Broader Stats API query model                   | Multiple dimensions, logical filters, regex, behavioral filters, and property filters are missing.                                      |
| P1       | Scalable R2 query pagination                    | Dimension queries currently stop at 10,000 rows instead of performing bounded server-side ordering and pagination.                      |

## Events API and tracking

### Supported

- Pageviews, custom events, and engagement events through `POST /api/event`.
- Long-form and compact Plausible payload fields.
- Scalar event properties, revenue payloads, `interactive`, engagement time, scroll depth, and hash-based routing input.
- CORS preflight, `X-Forwarded-For`, `X-Debug-Request`, bot dropping, URL normalization, and static health endpoint compatibility.
- Browser and server noomers tracker modules with manual pageviews and custom events.

### Remaining parity

| Feature                           | Status  | Remaining work                                                                                                                      |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Official Plausible tracker script | Partial | noomers accepts official tracker payloads but serves its own tracker. Validate current official tracker versions continuously. |
| Outbound-link tracking            | Missing | Add automatic browser instrumentation and compatible event/property names.                                                          |
| File-download tracking            | Missing | Detect configured file extensions and emit compatible events.                                                                       |
| Form-submission tracking          | Missing | Add form instrumentation and compatible properties.                                                                                 |
| Tagged-event tracking             | Missing | Support Plausible's CSS-class and data-attribute conventions.                                                                       |
| Automatic 404 tracking            | Missing | Detect and report 404 pages through the served tracker integration.                                                                 |
| Automatic scroll-depth reporting  | Partial | Input is accepted and durably stored, but the noomers tracker does not generate it and no query/report exposes it.             |
| Revenue tracking                  | Partial | Revenue is validated and sent to the durable stream, but Analytics Engine, Stats API, goals, and dashboard do not report it.        |
| Engagement reporting              | Partial | Engagement events are stored only in the optional durable stream and are not queryable directly.                                    |
| Tracker configuration             | Partial | Sites API stores Plausible-style tracker settings, but most settings do not alter the served noomers tracker.                  |
| Native `/collect` bot filtering   | Partial | Bot filtering exists for `/api/event`, not for native collection.                                                                   |

## Stats API v2

### Supported

Metrics:

- `visitors`
- `visits` with R2 SQL
- `pageviews`
- `views_per_visit` with R2 SQL
- `bounce_rate` with R2 SQL
- `visit_duration` with R2 SQL
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
| `event:props:*`                             | Missing | Query registered event properties safely in Analytics Engine and R2 SQL.                                       |
| Entry and exit page/hostname                | Missing | Sessionize first and last pageviews.                                                                           |
| Source, referrer, and channel               | Missing | Attribute values from the first pageview and implement channel classification.                                 |
| UTM medium/source/campaign/content/term     | Missing | Attribute campaign values from the first pageview.                                                             |
| Device, browser, and versions               | Missing | Attribute technology values from the first pageview.                                                           |
| Operating system and version                | Missing | Add Analytics Engine storage or use R2, then apply first-page attribution.                                     |
| Country, region, and city identifiers/names | Missing | Preserve the required geographic identifiers and apply first-page attribution.                                 |
| Multiple dimensions                         | Missing | Replace scalar dimension rows with tuples across validation, SQL, ordering, totals, and response construction. |

Visit dimensions must not be implemented by grouping raw event rows. Plausible attributes visit dimensions from the session's first pageview.

### Remaining filters and query semantics

| Feature                       | Status   | Remaining work                                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `matches` and `matches_not`   | Missing  | Add RE2-compatible validation and dialect-specific Analytics Engine/R2 SQL rendering.       |
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

| Gap                                         | Status  | Remaining work                                                                                            |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| Live Analytics Engine arithmetic validation | Blocked | Validate sampling and aggregate expressions against a deployed dataset.                                   |
| Live R2 SQL validation                      | Blocked | Validate generated SQL and response shapes against the current R2 SQL service.                            |
| Session behavior across UTC midnight        | Partial | Daily visitor IDs intentionally prevent cross-day linkage; document and test resulting visit differences. |
| Page session attribution                    | Partial | Verify whether entry-page attribution for visit metrics matches each supported page query combination.    |
| R2 row pagination                           | Partial | Replace the 10,001-row guard with server-side count, order, limit, and offset.                            |
| Long R2 time ranges                         | Partial | Prevent very large generated bucket expressions or use native timezone-aware bucketing.                   |
| R2 total rows                               | Partial | Compute total matching groups independently of the fetched rows.                                          |
| Analytics Engine sampling metadata          | Missing | Surface sampling or uncertainty warnings when applicable.                                                 |

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
| Domain rename                        | Missing  | Define a migration/alias strategy because existing Analytics Engine records are immutable.                        |
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

- Visitors, pageviews, bounce rate, visits, and average visit duration summary.
- Visitors, views, and bounce time series.
- Pages, referrers, events, goals, browsers, browser versions, countries, devices, and UTM breakdowns.
- Equality filters through URL parameters and paginated tables.

### Remaining parity

| Feature                        | Status   | Remaining work                                                                                        |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| Realtime/current visitors      | Missing  | Add five-minute current visitor and rolling 30-minute views.                                          |
| Previous-period comparison     | Missing  | Add aligned comparison ranges and deltas.                                                             |
| Year-over-year comparison      | Missing  | Add timezone-aware annual comparison.                                                                 |
| Custom comparison              | Missing  | Support arbitrary comparison ranges.                                                                  |
| Visit/source/channel reports   | Partial  | Referrer and UTM event reports exist; session-correct source/channel reports do not.                  |
| Entry/exit reports             | Missing  | Derive first/last pageviews per visit.                                                                |
| Region/city maps               | Missing  | Add geographic storage, aggregation, and visualization.                                               |
| OS and version reports         | Missing  | Add report routes and cards.                                                                          |
| Scroll depth                   | Missing  | Add page-level average scroll reporting.                                                              |
| Time on page                   | Missing  | Derive engagement and expose page metrics.                                                            |
| Revenue/ecommerce dashboard    | Missing  | Add revenue goal cards, trends, and breakdowns.                                                       |
| Custom-property reports        | Missing  | Add property dimensions, filters, and cards.                                                          |
| Expanded report metrics        | Missing  | Allow report-specific engagement, conversion, and revenue columns.                                    |
| Multi-select/exclusion filters | Partial  | Stats API supports richer filters; dashboard controls remain equality-oriented.                       |
| Saved segments                 | Missing  | Add personal and, if multi-user support is adopted, shared segments.                                  |
| Funnels                        | Missing  | Add persisted 2-8 step sequential/strict funnels and drop-off reporting.                              |
| User journeys                  | Missing  | Add forward/backward session-path exploration and grouping.                                           |
| Annotations                    | Missing  | Persist dated notes and show them on charts.                                                          |
| CSV/ZIP export                 | Missing  | Export the current dashboard query and reports.                                                       |
| Full queued export             | Missing  | Generate downloadable native aggregate exports with expiry.                                           |
| Consolidated multi-site view   | Deferred | Requires cross-site query semantics, team scope, and independent configuration.                       |
| Site settings UI               | Missing  | Provisioning and tracker configuration are API/CLI-only.                                              |
| Long-term dashboard history    | Partial  | Daily Arrow rollups are write-only; the dashboard remains limited to Analytics Engine/R2 query paths. |

The dashboard currently mixes R2 session summaries with Analytics Engine breakdowns and time series. It needs a unified query path before exact Plausible semantics can be claimed across every card.

## Collaboration and access control

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

| Feature                                | Status  | Remaining work                                                                                                    |
| -------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Existing noomers upgrade backfill | Missing | Populate D1 sites from existing Analytics Engine site IDs before fail-closed collection is enabled.               |
| Lossless Plausible raw-event import    | Blocked | Determine available hosted/self-hosted export formats; scheduled hosted raw export may require Enterprise access. |
| Google Analytics 4 import              | Missing | Add OAuth, property selection, aggregate mapping, progress, and overlap prevention.                               |
| Plausible aggregate CSV import         | Missing | Parse supported table formats and preserve imported-data limitations.                                             |
| Historical raw-event ingestion         | Missing | Add trusted timestamped ingestion, validation, idempotency, and durable writes.                                   |
| Import job state                       | Missing | Persist progress, failures, retries, source, and coverage dates.                                                  |
| Import/native deduplication            | Missing | Prevent overlapping date ranges and double counting.                                                              |
| Import-aware queries                   | Missing | Merge daily aggregate imports with native data and return compatibility warnings.                                 |
| Dashboard export                       | Missing | Export visible reports with current date range and filters.                                                       |
| Full aggregate export                  | Missing | Add queued archive generation and expiring downloads.                                                             |
| Scheduled raw-event export             | Missing | Add configurable schema, schedule, format, and object-storage destination.                                        |
| Daily Arrow restore/read path          | Missing | Existing daily rollups have no reader, query, or restoration command.                                             |

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

| Feature                        | Status  | Remaining work                                                                                                |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| Complete site data erasure     | Partial | Collection stops immediately, but Analytics Engine waits for expiry and durable stores need external cleanup. |
| Iceberg row deletion           | Blocked | Execute row-level deletion through a writable Iceberg engine, then expire snapshots and remove orphan files.  |
| Daily Arrow rollup deletion    | Missing | Enumerate and delete `sites/<site-id>/` objects as part of the deletion workflow.                             |
| Deletion-job processor         | Missing | Claim jobs, retry safely, record errors, and mark each storage layer complete.                                |
| Analytics Engine expiry status | Missing | Advance deletion-job state after the fixed retention period.                                                  |
| User-visible deletion status   | Missing | Expose progress without leaking internal infrastructure details.                                              |
| Configurable retention         | Missing | Add per-deployment or per-site durable-data policies.                                                         |
| Deletion SLA                   | Missing | Monitor and alert on overdue jobs.                                                                            |
| Traffic shields                | Missing | Add future-traffic exclusions by country, hostname, IP, and page.                                             |
| Data residency controls        | Missing | noomers inherits the selected Cloudflare account/resources and does not enforce a region.                |
| Export/data-subject workflow   | Missing | Add a documented administrative export and deletion process.                                                  |
| Broader bot filtering          | Partial | The implementation does not match Plausible's full UA, referrer, data-center, and behavioral filtering.       |

## Deployment and operations

### Automated today

- Worker deployment.
- Analytics Engine binding configuration.
- D1 creation/reuse and migrations.
- Daily R2 rollup bucket creation/reuse.
- Visitor salt and dashboard password configuration.
- Persisted local deployment metadata.

### Remaining parity and production hardening

| Feature                              | Status  | Remaining work                                                                                                |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| Initial site creation                | Missing | Prompt for or accept a domain/timezone during installation.                                                   |
| Existing-site upgrade migration      | Missing | Backfill the D1 registry before collection becomes registry-dependent.                                        |
| Pipeline/Data Catalog provisioning   | Blocked | Wrangler's setup is credential-dependent and interactive; automate when a stable non-interactive path exists. |
| R2 SQL credential provisioning       | Blocked | Create/scoped credentials and configure secrets through a supported API flow.                                 |
| Stats/Sites API token generation     | Missing | Generate, store, rotate, and display setup instructions safely.                                               |
| Pipeline binding metadata            | Partial | Standardize on the runtime `EVENT_STREAM` binding name throughout installer metadata.                         |
| Dependency-aware health checks       | Missing | Check D1, Analytics Engine, Pipeline configuration, and R2 SQL rather than always returning `ok`.             |
| Pipeline retry/dead-letter handling  | Missing | Durable send failures are currently logged while collection succeeds.                                         |
| Analytics Engine write observability | Missing | Write failures are logged and swallowed. Add metrics and alerts.                                              |
| Rate limiting and quotas             | Missing | Protect Events, Stats, and Sites APIs.                                                                        |
| Monitoring and SLOs                  | Missing | Add ingestion/query latency, error, lag, and deletion dashboards and alerts.                                  |
| Backup and restore                   | Missing | Document and automate D1 backup plus durable-event recovery.                                                  |
| Disaster recovery                    | Missing | Define resource recreation and data restoration procedures.                                                   |
| Migration rollback                   | Missing | Define safe behavior for failed schema or deployment upgrades.                                                |
| Pipeline lag visibility              | Missing | Surface durable-data freshness in API/dashboard responses.                                                    |

## Additional production hardening

These are noomers reliability improvements, not documented Plausible public API parity requirements.

| Feature                       | Status  | Remaining work                                                                           |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Trusted event timestamps      | Missing | Add a restricted path for backdated migration events without weakening public ingestion. |
| Event deduplication           | Missing | Use event IDs or idempotency keys to prevent duplicate durable records.                  |
| Batch ingestion               | Missing | Add a bounded administrative batch path if migration throughput requires it.             |
| Ingestion rate limits         | Missing | Add deployment-wide and per-site limits without allowing one site to starve others.      |
| Durable-write acknowledgement | Missing | Distinguish realtime-only acceptance from confirmed durable delivery where possible.     |

## Explicit non-goals unless architecture changes

The following Plausible features depend on a multi-user SaaS or commercial control plane and are deferred unless noomers's product scope changes:

- Billing, trials, subscriptions, plan limits, and usage lockouts.
- Separately billed teams and cross-team site transfers.
- Enterprise support workflows and managed onboarding.
- SAML SSO, organization policy, and JIT user provisioning.
- Contract-defined raw-event exports and data-retention agreements.

Self-hosted equivalents can still be designed independently if users need them.

## Compatibility claims

Until the relevant rows above are complete, documentation should avoid claiming:

- Full or drop-in Plausible compatibility.
- Full Stats API v2 support.
- Revenue analytics or custom-property analytics.
- Property-filtered goal reporting.
- Exact Plausible session metrics without R2 SQL.
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
