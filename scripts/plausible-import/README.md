# Plausible → noomers importer

One-shot importer that exports `plausible.events_v2` from a self-hosted
Plausible (ClickHouse) over SSH and appends the events to the Basin
`noomers.events_import` Iceberg table, so historical data shows up in
noomers queries via `R2_SQL_IMPORT_TABLE`.

## Usage

```bash
NOOMERS_CF_TOKEN_FILE=/path/to/token uv run scripts/plausible-import/import.py \
  --env dev [--sites harshil.dev,images-ai.app] [--dry-run] [--replace]
```

- `--env dev|prod` reads `apps/web/.dev.vars[.<env>]` (KEY=VALUE) for the
  bucket/warehouse wiring; the account id comes from
  `CLOUDFLARE_ACCOUNT_ID` (or `CF_ACCOUNT_ID` in the file). The
  wrangler config files it used to read are gone since the Alchemy
  migration.
- `--dry-run` prints the row counts per site/event_type without writing.
- `--replace` allows appending to a non-empty import table (imports are
  append-only; the guard exists to stop accidental mixed-data runs).
- Export files are cached under `~/.noomers-import/<domain>.parquet`
  (outside the repo; never commit them).

Prereqs: SSH key `~/.ssh/id_ed25519_do` to the Plausible host, and the
target sites must already be registered in noomers.

See `~/projects/noomers-spike/import/validation.md` for the field mapping
and validation results.
