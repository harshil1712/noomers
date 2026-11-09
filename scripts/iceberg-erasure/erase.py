# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyiceberg[pyarrow]==0.12.0",
#   "pyiceberg-core",
#   "pyarrow>=17,<24",
# ]
# ///
"""Manually erase a deleted site's rows from the Basin Iceberg tables.

Run this ONLY after deleting the site in the dashboard — deletion
tombstones it, purges its Durable Object, and stops collection, but the
historical rows stay in the warehouse until this command removes them.
Basin's managed snapshot expiration (configured in alchemy.run.ts) then
removes the old data files. Basin SQL is read-only, so physical row
deletion must go through PyIceberg here, by hand.

Usage:
  uv run scripts/iceberg-erasure/erase.py [--yes] <domain> [<domain> ...]

Env:
  CLOUDFLARE_ACCOUNT_ID   — Cloudflare account id
  CLOUDFLARE_API_TOKEN    — needs Basin Catalog Write + R2 Storage Write
  R2_SQL_BUCKET           — the stage's warehouse bucket (R2 dashboard)
  ICEBERG_TABLES          — comma-separated, default "noomers.events"
"""

import os
import re
import sys

SITE_ID_RE = re.compile(r"^[a-z0-9.-]+$")


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


def erase_domain(catalog, tables: list[str], domain: str, assume_yes: bool) -> bool:
    """Delete one site's rows from every table. Returns True on success."""
    from pyiceberg.catalog import NoSuchTableError
    from pyiceberg.expressions import EqualTo

    if not SITE_ID_RE.match(domain):
        print(f"{domain}: invalid domain, skipping")
        return False

    for name in tables:
        try:
            table = catalog.load_table(name)
        except NoSuchTableError:
            print(f"{domain}: table {name} not found, skipping")
            continue
        count = (
            table.scan(
                row_filter=EqualTo("site_id", domain),
                selected_fields=("site_id",),
            )
            .to_arrow()
            .num_rows
        )
        if count == 0:
            print(f"{domain}: no rows in {name}, skipping")
            continue
        if not assume_yes:
            if input(f"{count} rows for {domain} in {name} — delete? [y/N] ").strip().lower() != "y":
                print(f"{domain}: declined, nothing deleted in {name}")
                continue
        table.delete(delete_filter=EqualTo("site_id", domain))
        table.refresh()
        remaining = (
            table.scan(
                row_filter=EqualTo("site_id", domain),
                selected_fields=("site_id",),
            )
            .to_arrow()
            .num_rows
        )
        if remaining != 0:
            raise RuntimeError(f"{name} still has {remaining} rows for {domain}")
        print(f"{domain}: deleted {count} rows from {name}")
    return True


def main() -> int:
    args = [a for a in sys.argv[1:]]
    assume_yes = "--yes" in args
    domains = [a for a in args if not a.startswith("--")]
    if not domains:
        print(__doc__)
        return 1

    account = required_env("CLOUDFLARE_ACCOUNT_ID")
    api_token = required_env("CLOUDFLARE_API_TOKEN")
    bucket = required_env("R2_SQL_BUCKET")
    tables = [
        t.strip()
        for t in os.environ.get("ICEBERG_TABLES", "noomers.events").split(",")
        if t.strip()
    ]

    from pyiceberg.catalog import load_catalog

    catalog = load_catalog(
        "basin",
        **{
            "uri": f"https://catalog.cloudflarestorage.com/{account}/{bucket}",
            "warehouse": f"{account}_{bucket}",
            "token": api_token,
        },
    )

    ok = True
    for domain in domains:
        try:
            if not erase_domain(catalog, tables, domain, assume_yes):
                ok = False
        except Exception as e:  # noqa: BLE001 — continue with other domains
            ok = False
            print(f"{domain}: failed ({type(e).__name__}: {str(e)[:300]})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
