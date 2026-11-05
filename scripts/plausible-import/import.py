# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyiceberg[pyarrow]==0.12.0",
#   "pyiceberg-core",
#   "pyarrow>=17,<24",
# ]
# ///
"""Import Plausible ClickHouse events into the noomers Basin catalog.

Usage:
  uv run scripts/plausible-import/import.py --env dev [--sites example.com,...]
      [--dry-run] [--replace]

Prereqs:
  - SSH access to the Plausible host (NOOMERS_PLAUSIBLE_HOST, optional
    NOOMERS_SSH_KEY for the identity file)
  - NOOMERS_CF_TOKEN_FILE pointing at a Cloudflare API token file
  - apps/web/.dev.vars (KEY=VALUE) for Basin wiring
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

REPO = Path(__file__).resolve().parents[2]
EXPORT_DIR = Path.home() / ".noomers-import"
_SSH_KEY = os.environ.get("NOOMERS_SSH_KEY")
_SSH_HOST = os.environ.get("NOOMERS_PLAUSIBLE_HOST")
SSH = (
    ["ssh"]
    + (["-i", os.path.expanduser(_SSH_KEY)] if _SSH_KEY else [])
    + ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
       _SSH_HOST or "root@plausible-host"]
)
CH = ("docker exec plausible_plausible_events_db_1 "
      "clickhouse-client --readonly=1 -q ")
PG = ("docker exec plausible_plausible_db_1 "
      "psql -U postgres -d plausible -At -c ")

EVENT_COLUMNS = (
    "timestamp, name, site_id, user_id, session_id, hostname, pathname, "
    "referrer, referrer_source, country_code, screen_size, operating_system, "
    "browser, browser_version, operating_system_version, subdivision1_code, "
    "city_geoname_id, utm_medium, utm_source, utm_campaign, utm_content, "
    "utm_term, meta.key, meta.value, revenue_reporting_amount, "
    "revenue_reporting_currency, scroll_depth, engagement_time, "
    "region_name, city_name"
)

# noomers collector conventions (from live dev rows + collect.ts)
OS_MAP = {
    "Mac": "Mac OS", "Mac OS": "Mac OS", "Windows": "Windows",
    "Linux": "Linux", "Android": "Android", "iOS": "iOS",
    "Chrome OS": "Chrome OS", "Windows Phone": "Windows Phone",
}
DEVICE_MAP = {
    "desktop": "desktop", "laptop": "desktop", "mobile": "mobile",
    "tablet": "tablet", "console": "console", "smarttv": "smarttv",
    "wearable": "wearable", "tv": "smarttv",
}
NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")  # DNS namespace


def sh(cmd: list[str], **kw) -> bytes:
    return subprocess.check_output(cmd, **kw)


def site_map() -> dict[str, int]:
    """Plausible numeric site_id -> domain."""
    out = sh(SSH + [PG + '"SELECT id, domain FROM sites ORDER BY id"'])
    return {int(a): b for a, b in (l.split("|") for l in out.decode().split())}


def export_events(domain: str, ch_site_id: int, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    sql = (
        f"SELECT {EVENT_COLUMNS} FROM plausible.events_v2 "
        f"WHERE site_id = {ch_site_id} ORDER BY timestamp, session_id "
        "FORMAT Parquet"
    )
    tmp = dest.with_suffix(".part")
    for attempt in range(8):
        try:
            with open(tmp, "wb") as fh:
                subprocess.run(
                    SSH + [CH + f'"{sql}"'], stdout=fh, check=True,
                )
            tmp.rename(dest)
            return dest
        except subprocess.CalledProcessError:
            wait = min(15 * 2**attempt, 120)
            print(f"  export failed for {domain}; retrying in {wait}s")
            import time
            time.sleep(wait)
    raise SystemExit(f"could not export {domain} after retries")


def norm_referrer(v: str, host: str) -> str:
    """Drop self-referrals like the collector does (host match ignoring www.)."""
    if not v:
        return ""
    try:
        from urllib.parse import urlparse
        ref = urlparse(v).hostname or ""
        if ref.removeprefix("www.") == (host or "").removeprefix("www."):
            return ""
    except Exception:
        pass
    return v


def fixed3(v: str) -> str:
    return "" if v in ("", "\x00\x00\x00") else v


def transform(rows, domain: str):
    """Yield dicts matching the noomers.events schema."""
    seen: dict[str, int] = {}
    for raw in rows:
        r = {
            k: (v.decode("utf-8", "replace") if isinstance(v, bytes) else v)
            for k, v in raw.items()
        }
        base = (
            f"{domain}|{r['timestamp']}|{r['user_id']}|{r['session_id']}|"
            f"{r['name']}|{r['pathname']}|{r['engagement_time']}|"
            f"{r['scroll_depth']}"
        )
        ord_ = seen.get(base, 0)
        seen[base] = ord_ + 1
        event_id = str(uuid.uuid5(NS, f"{base}|{ord_}"))

        name = r["name"]
        if name == "pageview":
            etype, ename, interactive = "pageview", "pageview", True
        elif name == "engagement":
            etype, ename, interactive = "engagement", "engagement", False
        else:
            etype, ename, interactive = "custom", name, True

        props = dict(zip(r["meta.key"] or [], r["meta.value"] or []))
        cc = (r["country_code"] or "").replace("\x00", "")
        ts = (
            r["timestamp"].strftime("%Y-%m-%dT%H:%M:%S")
            if hasattr(r["timestamp"], "strftime")
            else __import__("datetime")
            .datetime.fromtimestamp(int(r["timestamp"]), __import__("datetime").timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%S")
        ) + ".000Z"
        yield {
            "schema_version": 2,
            "event_id": event_id,
            "received_at": ts,
            "site_id": domain,
            "event_type": etype,
            "event_name": ename,
            "event_properties": json.dumps(props) if props else "",
            "url": f"https://{r['hostname']}{r['pathname']}",
            "hostname": r["hostname"] or "",
            "pathname": r["pathname"] or "/",
            "referrer": norm_referrer(r["referrer"], r["hostname"]),
            "interactive": interactive,
            "revenue_amount": (
                "" if r["revenue_reporting_amount"] is None
                else str(r["revenue_reporting_amount"])
            ),
            "revenue_currency": fixed3(r["revenue_reporting_currency"]),
            "engagement_time": int(r["engagement_time"] or 0),
            "scroll_depth": int(r["scroll_depth"] or 0),
            "country": cc if cc != "ZZ" else "",
            "region": r["region_name"] or "",
            "city": r["city_name"] or "",
            "browser": r["browser"] or "",
            "browser_version": r["browser_version"] or "",
            "operating_system": OS_MAP.get(r["operating_system"], r["operating_system"] or ""),
            "operating_system_version": r["operating_system_version"] or "",
            "device_type": DEVICE_MAP.get((r["screen_size"] or "").lower(), "desktop"),
            "device_model": "",
            "utm_source": r["utm_source"] or "",
            "utm_medium": r["utm_medium"] or "",
            "utm_campaign": r["utm_campaign"] or "",
            "utm_term": r["utm_term"] or "",
            "utm_content": r["utm_content"] or "",
            "visitor_id": str(r["user_id"]),
        }


def catalog(env: str):
    # Reads `apps/web/.dev.vars` (KEY=VALUE lines) for the Basin wiring.
    # `env` selects `.dev.vars.<env>` if present, else `.dev.vars`.
    candidates = [
        REPO / f"apps/web/.dev.vars.{env}",
        REPO / "apps/web/.dev.vars",
    ]
    vars_file = next((p for p in candidates if p.exists()), None)
    if vars_file is None:
        raise SystemExit(f"No .dev.vars found (looked: {', '.join(str(p) for p in candidates)})")
    vars_map = {
        k.strip(): v.strip()
        for line in vars_file.read_text().splitlines()
        if (kv := line.split("=", 1)) and len(kv) == 2
        for k, v in [kv]
        if k.strip() and not k.strip().startswith("#")
    }
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or vars_map.get("CF_ACCOUNT_ID")
    bucket = vars_map.get("R2_SQL_BUCKET")
    token = Path(os.environ["NOOMERS_CF_TOKEN_FILE"]).read_text().strip()
    from pyiceberg.catalog import load_catalog

    cat = load_catalog(
        "basin",
        **{
            "uri": f"https://catalog.cloudflarestorage.com/{account}/{bucket}",
            "warehouse": f"{account}_{bucket}",
            "token": token,
        },
    )
    return cat, cfg


def import_table(cat, source_table, events_table, replace: bool):
    try:
        t = cat.load_table(source_table)
        if replace:
            return t
        if t.scan().to_arrow().num_rows:
            raise SystemExit(
                f"{source_table} is non-empty; pass --replace to overwrite"
            )
        return t
    except SystemExit:
        raise
    except Exception:
        pass
    schema = events_table.schema().as_arrow()
    keep = [f for f in schema.names if not f.startswith("__")]
    import pyiceberg.schema as ps
    from pyiceberg.types import NestedField

    fields = [
        f for f in events_table.schema().fields
        if not f.name.startswith("__")
    ]
    new_schema = ps.Schema(*[NestedField(f.field_id, f.name, f.field_type, required=False) for f in fields])
    return cat.create_table(source_table, schema=new_schema)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["dev", "prod"], required=True)
    ap.add_argument("--sites", help="comma-separated domains")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--replace", action="store_true")
    a = ap.parse_args()

    id2domain = site_map()
    domain2id = {v: k for k, v in id2domain.items()}
    wanted = a.sites.split(",") if a.sites else sorted(domain2id)
    missing = [d for d in wanted if d not in domain2id]
    if missing:
        raise SystemExit(f"unknown plausible domains: {missing}")

    cat, cfg = catalog(a.env)
    source = f"noomers.events_import"
    ev = cat.load_table("noomers.events")
    if not a.dry_run:
        tbl = import_table(cat, source, ev, a.replace)

    for domain in wanted:
        ch_id = domain2id[domain]
        dest = export_events(domain, ch_id, EXPORT_DIR / f"{domain}.parquet")
        table = pq.read_table(dest)
        rows = table.to_pylist()
        out = list(transform(rows, domain))
        counts = {}
        for r in out:
            counts[r["event_type"]] = counts.get(r["event_type"], 0) + 1
        print(
            f"{domain}: {len(out)} rows ({counts}) "
            f"from {table.num_rows} exported"
        )
        if a.dry_run:
            continue
        if not out:
            continue
        batch = pa.Table.from_pylist(out, schema=pa.schema([
            pa.field(f.name, pa.schema(ev.schema().as_arrow()).field(f.name).type)
            for f in ev.schema().fields if not f.name.startswith("__")
        ]))
        tbl.append(batch)
        print(f"  appended {len(out)} rows to {source}")


if __name__ == "__main__":
    main()
