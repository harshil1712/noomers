# Cutover: pa.harshil.app → noomers (Workers Custom Domain)

Target: all 7 sites' `pa-*.js` embeds keep working unchanged; events flow
to noomers; Plausible is frozen, imported, then decommissioned.

Prod worker: `noomers` (https://noomers.api-harshil.workers.dev),
account `cf583c9be8982922212ed2e432115f57` ("Harshil").
Zone: `harshil.app` (proxied). Current state: `pa.harshil.app` is a
proxied A record → 167.172.160.245 (the Plausible droplet).

## 0. Preflight

- `node scripts/deploy.mjs prod` is live (done).
- 7 sites + 28 goals registered (done). `/js/pa-*.js` verified for all ids.
- `R2_SQL_IMPORT_TABLE=noomers.events_import` set; empty import table created.

## 1. Attach pa.harshil.app as a Workers Custom Domain

A Workers Custom Domain takes over DNS for the hostname — the existing
proxied A record to 167.172.160.245 must be **deleted first** (the custom
domain creates its own managed record; conflicting records block it).

Via dashboard: Workers & Pages → noomers → Settings → Domains & Routes →
Add → Custom Domain → enter `pa.harshil.app`, select zone `harshil.app`.

Via API (token: Workers Routes Edit + Zone DNS Edit on the account token):
```bash
# 1a. find + delete the existing DNS record
CLOUDFLARE_API_TOKEN=$(cat $NOOMERS_CF_TOKEN_FILE)
ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=harshil.app" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
REC_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=pa.harshil.app" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$REC_ID" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# 1b. create the custom domain
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/cf583c9be8982922212ed2e432115f57/workers/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production","hostname":"pa.harshil.app","service":"noomers","zone_id":"'$ZONE_ID'"}'
```
Note: the API token's permission set may not include Workers Domains —
if it 403s, do step 1 in the dashboard instead (OAuth'd in browser).

## 2. Verify the switch

```bash
curl -s "https://pa.harshil.app/js/pa-95hrLE5MtziwhDlHiZjl1.js" | grep -o 'domain:"[^"]*"'
# → domain:"harshil.dev", endpoint:"https://pa.harshil.app/api/event"
curl -s -X POST https://pa.harshil.app/api/event -H "Content-Type: text/plain" \
  -H "User-Agent: <real UA>" -d '{"n":"pageview","u":"https://harshil.dev/x","d":"harshil.dev"}'
# → 202; row appears in noomers.events within ~3 min
```

## 3. Confirm Plausible stopped receiving

```bash
ssh -i ~/.ssh/id_ed25519_do root@167.172.160.245 \
  "docker exec plausible_plausible_events_db_1 clickhouse-client --readonly=1 -q \
   'SELECT site_id, max(timestamp) FROM plausible.events_v2 GROUP BY site_id ORDER BY site_id'"
```
When `max(timestamp)` stops advancing (a few minutes after the DNS cut +
cache TTLs), Plausible is frozen. Record the freeze time.

## 4. Import into prod

```bash
# only data up to the freeze time is in events_v2 — safe to import all
NOOMERS_CF_TOKEN_FILE=~/.noomers-prod/token-file uv run scripts/plausible-import/import.py --env prod --dry-run
NOOMERS_CF_TOKEN_FILE=~/.noomers-prod/token-file uv run scripts/plausible-import/import.py --env prod --sites harshil.dev
# validate, then the rest:
NOOMERS_CF_TOKEN_FILE=~/.noomers-prod/token-file uv run scripts/plausible-import/import.py --env prod --replace

# validation query (numbers must match ClickHouse per validation.md):
wrangler basin sql query cf583c9be8982922212ed2e432115f57_noomers-prod-events \
  "SELECT site_id, COUNT(*) FILTER (WHERE event_type='pageview') pv, COUNT(DISTINCT visitor_id) visitors FROM noomers.events_import GROUP BY site_id ORDER BY site_id"
```

After the switch, point an uptime monitor at
`GET /api/health/ready` (Sites API key) — it checks D1, Basin SQL, and
per-site DO backlog (`oldestUnshippedAgeMs > 15 min` fails). `/api/event`
is rate-limited to 100 req/60s per ip:site; server-side ingest needs
`Authorization: Bearer <SERVER_EVENTS_TOKEN>` for a real-IP override.

## 5. Rollback

Re-create the A record in zone `harshil.app`: `pa → 167.172.160.245`,
proxied. Then delete the Workers Custom Domain (dashboard or
`DELETE /accounts/<acct>/workers/domains/<id>`). noomers stays deployed;
old Plausible keeps serving until the droplet is stopped.

## 6. Decommission Plausible (later, after validation window)

- Stop the droplet's docker stack (or the droplet itself) once imports +
  spot-checks pass and a freeze window has elapsed.
- Keep a final ClickHouse export of `events_v2`/`sessions_v2` as backup.
- R2 `noomers-prod-events` retains everything; nooers.events rows for any
  deleted smoke/test data remain in Iceberg (accepted).
