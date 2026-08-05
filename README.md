# Counterscale

![](/packages/server/public/counterscale-logo-300x300.webp)

![ci status](https://github.com/benvinegar/counterscale/actions/workflows/ci.yaml/badge.svg)
[![License](https://img.shields.io/github/license/benvinegar/counterscale)](https://github.com/benvinegar/counterscale/blob/master/LICENSE)
[![codecov](https://codecov.io/gh/benvinegar/counterscale/graph/badge.svg?token=NUHURNB682)](https://codecov.io/gh/benvinegar/counterscale)

Counterscale is a simple web analytics tracker and dashboard that you self-host on Cloudflare.

It's designed to be easy to deploy and maintain, and should cost you near-zero to operate – even at high levels of traffic (Cloudflare's [free tier](https://developers.cloudflare.com/workers/platform/pricing/#workers) could hypothetically support up to 100k hits/day).

_Counterscale is sponsored by [Modem, your dev-team's auto-triage PM](https://modem.dev)._

## License

Counterscale is free, open source software made available under the MIT license. See: [LICENSE](LICENSE).

## Limitations

Counterscale is powered primarily by Cloudflare Workers and [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/). As of February 2025, Workers Analytics Engine has _maximum 90 days retention_, which means Counterscale can only show the last 90 days of recorded data. We do, however, provide long term storage of your data in an R2 bucket using Apache Arrow files. This long term storage is enabled by default and can be disabled using the CLI.

Counterscale implements a subset of Plausible's APIs and product features. See [Plausible feature parity](docs/plausible-feature-parity.md) for the supported baseline, remaining work, deferred features, and infrastructure-dependent gaps. See the [feature implementation roadmap](docs/implementation-roadmap.md) for sequencing, dependencies, and completion criteria.

## Installation

### Requirements

- macOS or Linux environment
- Node v20 or above
- An active [Cloudflare](https://cloudflare.com) account (either free or paid)

### Cloudflare Preparation

If you don't have one already, [create a Cloudflare account here](https://dash.cloudflare.com/sign-up) and verify your email address.

1. Go to your Cloudflare dashboard and, if you do not already have one, set up a [Cloudflare Workers subdomain](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
1. Enable [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) beta for your account. To enable, navigate to Storage & Databases > Analytics Engine and click the "Enable" button ([screenshot](./docs/enable-analytics-engine.png)). You can ignore and exit out of the "Create Dataset" menu that will pop up next.
    - Note: If this is your first time using Workers, you have to create a Worker before you can enable the Analytics Engine. Navigate to Workers & Pages > Overview, click the "Create Worker" button ([screenshot](./docs/create-worker.png)) to create a "Hello World" worker (it doesn't matter what you name this Worker as you can delete it later).
1. Create a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/). This token needs `Account.Account Analytics` permissions at a minimum ([screenshot](./docs/api-token.png)).
    - _WARNING: Keep this window open or copy your API token somewhere safe (e.g. a password manager), because if you close this window you will not be able to access this API token again and have to start over._

### Deploy Counterscale

First, sign into Cloudflare and authorize the Cloudflare CLI (Wrangler) using:

```bash
npx wrangler login
```

Afterwards, run the Counterscale installer:

```bash
npx @counterscale/cli@latest install
```

Follow the prompts. You will be asked for the Cloudflare API token you created earlier. You'll also be asked if you want to protect your dashboard with a password:

- If you choose **Yes** (recommended for public deployments), you'll be prompted to create a password that will be required to access your analytics dashboard.
- If you choose **No**, your dashboard will be publicly accessible without authentication.

Once the script has finished, the server application should be deployed. Visit `https://{subdomain-emitted-during-deploy}.workers.dev` to verify.

The installer also creates a D1 database for goal definitions, applies its migrations, and configures a rotating, salted visitor identifier used for unique conversion rates. Raw IP addresses are never stored.

NOTE: _If this is your first time deploying Counterscale, it may take take a few minutes before the Worker subdomain becomes live._

### Start Recording Web Traffic from Your Website(s)

You can load the tracking code using one of two methods:

#### 1. Script Loader (CDN)

When Counterscale is deployed, it makes `tracker.js` available at the URL you deployed to:

```
https://{subdomain-emitted-during-deploy}.workers.dev/tracker.js
```

To start reporting website traffic from your web property, copy/paste the following snippet into your website HTML:

```html
<script
    id="counterscale-script"
    data-site-id="your-unique-site-id"
    src="https://{subdomain-emitted-during-deploy}.workers.dev/tracker.js"
    defer
></script>
```

#### 2. Package/Module

The Counterscale tracker is published as an npm module:

```bash
npm install @counterscale/tracker
```

Initialize Counterscale with your site ID and the URL of your deployed reporting endpoint:

```typescript
import * as Counterscale from "@counterscale/tracker";

Counterscale.init({
    siteId: "your-unique-site-id",
    reporterUrl:
        "https://{subdomain-emitted-during-deploy}.workers.dev/collect",
});

Counterscale.trackEvent("Signup", {
    props: { plan: "pro", trial: true },
});
```

**Available Methods**
| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| `init(opts)` | `ClientOpts` | `void` | Initializes the Counterscale client with site configuration. Creates a global client instance if one doesn't exist. |
| `isInitialized()` | None | `boolean` | Checks if the Counterscale client has been initialized. Returns true if client exists, false otherwise. |
| `getInitializedClient()` | None | `Client \| undefined` | Returns the initialized client instance or undefined if not initialized. |
| `trackPageview(opts?)` | `TrackPageviewOpts?` | `void` | Tracks a pageview event. Requires client to be initialized first. Automatically detects URL and referrer if not provided. |
| `trackEvent(name, opts?)` | `string, TrackEventOpts?` | `void` | Tracks a named custom event with optional string, number, or boolean properties. |
| `cleanup()` | None | `void` | Cleans up the client instance and removes event listeners. Sets global client to undefined. |

#### 3. Server-Side Module

If you'd prefer to track analytics on the server, instead of running the tracker in the browser, use the `/server` module:

```bash
npm install @counterscale/tracker
```

```typescript
import * as Counterscale from "@counterscale/tracker/server";

// Initialize the tracker
Counterscale.init({
    siteId: "your-unique-site-id",
    reporterUrl:
        "https://{subdomain-emitted-during-deploy}.workers.dev/collect",
    reportOnLocalhost: false, // optional, defaults to false
    timeout: 2000, // optional, defaults to 1000ms
});

// Track a pageview
await Counterscale.trackPageview({
    url: "https://example.com/page", // or relative: '/page'
    hostname: "example.com", // required for relative URLs
    referrer: "https://google.com",
    utmSource: "social",
    utmMedium: "twitter",
});

await Counterscale.trackEvent("Signup", {
    url: "https://example.com/signup",
    ip: requestIp,
    props: { plan: "pro" },
});
```

**Server Module Methods**
| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| `init(opts)` | `ServerClientOpts` | `void` | Initializes the server-side tracker. |
| `isInitialized()` | None | `boolean` | Checks if the tracker has been initialized. |
| `getInitializedClient()` | None | `ServerClient \| undefined` | Returns the initialized server client instance. |
| `trackPageview(opts)` | `TrackPageviewOpts` | `Promise<void>` | Tracks a pageview event. Requires explicit URL and hostname parameters. |
| `trackEvent(name, opts)` | `string, ServerTrackEventOpts` | `Promise<void>` | Tracks a custom event. Pass `ip` to attribute server-side conversions without storing the raw address. |
| `cleanup()` | None | `void` | Cleans up the server client instance. |

The server module is designed for backend applications and differs from the client-side version:

- No DOM-dependent features (auto-tracking, browser instrumentation)
- Uses fetch API instead of XMLHttpRequest
- Requires explicit URL and hostname parameters
- Fire-and-forget - tracking errors won't throw exceptions

### Goals and conversions

Use the **Goals** card in the dashboard to create either an event goal (for example, `Signup`) or an exact pageview goal (for example, `/thank-you`). Goal management requires dashboard authentication to be enabled. The dashboard reports unique daily converters and conversion rate for the selected interval and filters.

### Durable event history

Counterscale can optionally send a canonical copy of each event to a Cloudflare Pipeline for storage as an R2 Iceberg table. Analytics Engine remains the realtime data source. The durable record contains parsed browser and device fields plus a rotating visitor hash; it does not contain raw IP addresses or user-agent strings.

Create a Pipeline using `npx wrangler@latest pipelines setup`, load the schema from `packages/server/pipelines/events.schema.json`, and choose simple ingestion into an R2 Data Catalog sink. Then add the Pipeline name to the Worker configuration used for deployment:

```json
{
    "pipelines": [
        {
            "binding": "EVENT_STREAM",
            "pipeline": "<PIPELINE_NAME>"
        }
    ]
}
```

The binding is optional. Without it, collection continues to use Analytics Engine and the existing daily R2 rollups. New rollup objects use site-scoped keys under `sites/<site-id>/`; existing date-only objects are not rewritten.

To calculate exact 30-minute visits, bounce rate, and average visit duration from the Iceberg table, configure these Worker values:

| Value           | Purpose                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `R2_SQL_BUCKET` | R2 bucket backing the Data Catalog warehouse                                   |
| `R2_SQL_TABLE`  | Iceberg table in `namespace.table` format, for example `default.events`        |
| `R2_SQL_TOKEN`  | Secret API token with R2 SQL read, R2 Data Catalog read, and R2 storage access |

Set `R2_SQL_BUCKET` and `R2_SQL_TABLE` as Worker variables and set `R2_SQL_TOKEN` with `wrangler secret put R2_SQL_TOKEN`. When all three are present, dashboard summary metrics use R2 SQL sessionization. If they are absent or R2 SQL is temporarily unavailable, the dashboard falls back to Analytics Engine. The fallback counts Plausible visitors by distinct daily ID, but exact Plausible bounce and visit metrics require R2 SQL. Pipeline data is batched, so exact session metrics can lag realtime collection by several minutes.

Visitor identifiers follow Plausible's privacy model: they rotate each UTC day. Sessions and unique visitors are therefore isolated to one day and cannot be linked across day boundaries.

### Plausible tracker compatibility

Existing Plausible clients can send pageviews, custom events, revenue, properties, and engagement events to CounterScale using the standard Events API endpoint:

```text
https://{subdomain-emitted-during-deploy}.workers.dev/api/event
```

Both the documented Plausible Events API JSON fields and the compact payload emitted by `@plausible-analytics/tracker` are accepted. The compatibility endpoint supports `POST /api/event`, CORS preflight requests, `X-Forwarded-For`, `X-Debug-Request`, and `GET /api/health`.

Set the `STATS_API_TOKEN` Worker secret to enable Plausible-compatible queries at `POST /api/v2/query`, then send it as `Authorization: Bearer <token>`. Aggregate visitor, pageview, and event metrics work with Analytics Engine. Exact visits, views per visit, bounce rate, and visit duration require R2 SQL. The compatibility layer supports `day`, `24h`, `7d`, `28d`, `30d`, `91d`, `month`, `6mo`, `12mo`, `year`, and `all` ranges in each site's reporting timezone; custom date ranges; case-sensitive, multi-value `is`, `is_not`, `contains`, and `contains_not` filters on page and hostname; page breakdowns; basic-metric hostname breakdowns; and hour, day, week, month, or automatic time dimensions with optional time labels. Visit-scoped dimensions are rejected until they can be sessionized from the first pageview.

Set the optional `SITES_API_TOKEN` Worker secret to use Plausible's site provisioning endpoints under `/api/v1/sites`. When it is omitted, `STATS_API_TOKEN` authenticates both APIs. The supported provisioning operations are listing, creating, reading, updating configuration, and deleting sites, plus listing, finding or creating, and deleting event or page goals. Provision each site before collecting or querying its statistics. Domain renames are rejected because Analytics Engine records are immutable. Deleting a site immediately tombstones it: Stats API access, new collection, and re-registration are blocked, D1 configuration is removed, and an internal deletion job is recorded. Analytics Engine data then expires through its fixed three-month retention.

Deleting an Iceberg table's underlying R2 objects with an R2 lifecycle rule is unsafe and is not a supported erasure process because those objects include table metadata and shared snapshots. A deletion worker or operator must issue a row-level `DELETE` for the site's records through an Iceberg-compatible engine, commit the table change, and then expire snapshots and remove orphan files according to the table's retention policy. The deletion job tracks that external Iceberg purge as `pending`, `completed`, or `failed`; the Plausible-compatible DELETE response does not expose this internal state. The D1 migrations for the site registry, goals, and deletion jobs are applied automatically by the installer.

## Upgrading

For most releases, upgrading is as simple as re-running the CLI installer:

```bash
npx @counterscale/cli@latest install

# OR
# npx @counterscale/cli@VERSION install
```

You won't have to enter a new API key, and your data will carry forrward.

Counterscale uses [semantic versioning](https://semver.org/). If upgrading to a major version (e.g. 2.x, 3.x, 4.x), there may be extra steps. Please consult the [release notes](https://github.com/benvinegar/counterscale/releases).

## Troubleshooting

If the website is not immediately available (e.g. "Secure Connection Failed"), it could be because Cloudflare has not yet activated your subdomain (yoursubdomain.workers.dev). This process can take a minute; you can check in on the progress by visiting the newly created worker in your Cloudflare dashboard (Workers & Pages → counterscale).

## Advanced

### Manually Track Pageviews

When you initialize the Counterscale tracker, set `autoTrackPageviews` to `false`. Then, you can manually call `Counterscale.trackPageview()` when you want to record a pageview.

```typescript
import * as Counterscale from "@counterscale/tracker";

Counterscale.init({
    siteId: "your-unique-site-id",
    reporterUrl:
        "https://{subdomain-emitted-during-deploy}.workers.dev/collect",
    autoTrackPageviews: false, // <- don't forget this
});

// ... when a pageview happens
Counterscale.trackPageview();
```

### Custom Domains

The deployment URL can always be changed to go behind a custom domain you own. [More here](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## CLI Commands

Counterscale provides a command-line interface (CLI) to help you install, configure, and manage your deployment.

### Available Commands

#### `install`

The main command for installing and deploying Counterscale to Cloudflare.

```bash
npx @counterscale/cli@latest install
```

Options:

- `--advanced` - Enable advanced mode to customize worker name and analytics dataset
- `--verbose` - Show additional logging information

#### `auth`

Manage authentication settings for your Counterscale deployment.

```bash
npx @counterscale/cli@latest auth [subcommand]
```

Available subcommands:

- `enable` - Enable authentication for your Counterscale deployment
- `disable` - Disable authentication for your Counterscale deployment
- `roll` - Update/roll the authentication password

##### Examples:

Enable authentication:

```bash
npx @counterscale/cli@latest auth enable
```

Disable authentication:

```bash
npx @counterscale/cli@latest auth disable
```

Update/roll the password:

```bash
npx @counterscale/cli@latest auth roll
```

#### `storage`

Manage long term storage settings for your Counterscale deployment.

```bash
npx @counterscale/cli@latest storage [subcommand]
```

Available subcommands:

- `enable` - Enable storage for your Counterscale deployment
- `disable` - Disable storage for your Counterscale deployment

##### Examples:

Enable storage:

```bash
npx @counterscale/cli@latest storage enable
```

Disable storage:

```bash
npx @counterscale/cli@latest storage disable
```

## Development

See [Contributing](CONTRIBUTING.md) for information on how to get started.

## Notes

### Database

There is only one "database": the Cloudflare Analytics Engine dataset, which is communicated entirely over HTTP using Cloudflare's API.

Right now there is no local "test" database. This means in local development:

- Writes will no-op (no hits will be recorded)
- Reads will be read from the production Analaytics Engine dataset (local development shows production data)

### Sampling

Cloudflare Analytics Engine uses sampling to make high volume data ingestion/querying affordable at scale (this is similar to most other analytics tools, see [Google Analytics on Sampling](https://support.google.com/analytics/answer/2637192?hl=en#zippy=%2Cin-this-article)). You can find out more how [sampling works with CF AE here](https://developers.cloudflare.com/analytics/analytics-engine/sampling/).
