# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyiceberg[pyarrow]==0.12.0",
#   "pyiceberg-core",
#   "pyarrow>=17,<24",
# ]
# ///
"""Erase deleted sites' rows from the noomers Basin Iceberg tables.

Runs daily from .github/workflows/iceberg-erasure.yml. Asks the Worker's
/api/maintenance/deletion-jobs endpoints for due jobs, row-deletes each
site's rows through the Basin Catalog REST endpoint, verifies nothing is
left, and reports the result back. Basin's managed snapshot expiration
(configured in alchemy.run.ts) then removes the orphaned data files.

Env (all required except ICEBERG_TABLES):
  NOOMERS_APP_URL, SITES_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN, R2_SQL_BUCKET
  ICEBERG_TABLES — comma-separated, default "noomers.events"
"""

import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass

SITE_ID_RE = re.compile(r"^[a-z0-9.-]+$")


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


class HttpJobsClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(self, method: str, path: str, body=None):
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        if body is not None:
            req.data = json.dumps(body).encode()
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read())

    def list_due(self) -> list[dict]:
        return self._request("GET", "/api/maintenance/deletion-jobs")["jobs"]

    def report(self, job_id: str, status: str, error=None):
        body = {"status": status}
        if error is not None:
            body["error"] = error
        self._request("POST", f"/api/maintenance/deletion-jobs/{job_id}", body)


@dataclass
class Result:
    job_id: str
    status: str
    error: str | None = None


def erase_jobs(catalog, tables: list[str], jobs_client) -> list[Result]:
    """Erase each due job's site rows from every table; report back per job."""
    from pyiceberg.catalog import NoSuchTableError
    from pyiceberg.expressions import EqualTo

    results: list[Result] = []
    for job in jobs_client.list_due():
        job_id = job["id"]
        site_id = job["site_id"]
        try:
            if not site_id or not site_id.strip() or not SITE_ID_RE.match(site_id):
                jobs_client.report(job_id, "failed", "invalid site_id")
                results.append(Result(job_id, "failed", "invalid site_id"))
                print(f"job {job_id}: failed (invalid site_id)")
                continue
            for name in tables:
                try:
                    table = catalog.load_table(name)
                except NoSuchTableError:
                    continue
                table.delete(delete_filter=EqualTo("site_id", site_id))
                table.refresh()
                remaining = table.scan(
                    row_filter=EqualTo("site_id", site_id),
                    selected_fields=("site_id",),
                ).to_arrow().num_rows
                if remaining != 0:
                    raise RuntimeError(f"{name} still has {remaining} rows")
            jobs_client.report(job_id, "completed")
            results.append(Result(job_id, "completed"))
            print(f"job {job_id}: completed")
        except Exception as e:  # noqa: BLE001 — report and continue
            detail = f"{type(e).__name__}: {str(e)[:300]}"
            try:
                jobs_client.report(job_id, "failed", detail)
            except Exception:
                pass
            results.append(Result(job_id, "failed", detail))
            print(f"job {job_id}: failed ({type(e).__name__})")
    return results


def main() -> int:
    app_url = required_env("NOOMERS_APP_URL")
    sites_token = required_env("SITES_API_TOKEN")
    account = required_env("CLOUDFLARE_ACCOUNT_ID")
    api_token = required_env("CLOUDFLARE_API_TOKEN")
    bucket = required_env("R2_SQL_BUCKET")
    tables = [t.strip() for t in os.environ.get("ICEBERG_TABLES", "noomers.events").split(",") if t.strip()]

    from pyiceberg.catalog import load_catalog

    catalog = load_catalog(
        "basin",
        **{
            "uri": f"https://catalog.cloudflarestorage.com/{account}/{bucket}",
            "warehouse": f"{account}_{bucket}",
            "token": api_token,
        },
    )
    jobs = HttpJobsClient(app_url, sites_token)
    results = erase_jobs(catalog, tables, jobs)
    return 1 if any(r.status == "failed" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
