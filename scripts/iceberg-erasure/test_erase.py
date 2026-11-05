"""pytest suite for erase_jobs — real pyiceberg SqlCatalog over sqlite."""

import pyarrow as pa
import pytest
from pyiceberg.catalog.sql import SqlCatalog
from pyiceberg.schema import Schema
from pyiceberg.types import NestedField, StringType

from erase import erase_jobs

SCHEMA = Schema(
    NestedField(1, "site_id", StringType(), required=True),
    NestedField(2, "event_id", StringType(), required=False),
    NestedField(3, "timestamp", StringType(), required=False),
)


@pytest.fixture()
def catalog(tmp_path):
    return SqlCatalog(
        "test",
        **{
            "uri": f"sqlite:///{tmp_path}/catalog.db",
            "warehouse": f"file://{tmp_path}/warehouse",
        },
    )


def make_table(catalog, name="noomers.events", rows=()):
    namespace, _ = name.split(".", 1)
    try:
        catalog.create_namespace(namespace)
    except Exception:
        pass
    try:
        table = catalog.create_table(name, schema=SCHEMA)
    except Exception:
        table = catalog.load_table(name)
    if rows:
        table.append(
            pa.table(
                {k: [r[k] for r in rows] for k in ("site_id", "event_id", "timestamp")},
                schema=pa.schema(
                    [
                        pa.field("site_id", pa.string(), nullable=False),
                        pa.field("event_id", pa.string()),
                        pa.field("timestamp", pa.string()),
                    ]
                ),
            )
        )
    return table


class FakeJobsClient:
    def __init__(self, jobs):
        self.jobs = jobs
        self.reports = []

    def list_due(self):
        return self.jobs

    def report(self, job_id, status, error=None):
        self.reports.append((job_id, status, error))


def row_count(table, site_id):
    from pyiceberg.expressions import EqualTo

    table.refresh()
    return table.scan(
        row_filter=EqualTo("site_id", site_id), selected_fields=("site_id",)
    ).to_arrow().num_rows


def test_erases_only_the_deleted_site(catalog):
    table = make_table(
        catalog,
        rows=[
            {"site_id": "a.example", "event_id": "e1", "timestamp": "2026-01-01"},
            {"site_id": "b.example", "event_id": "e2", "timestamp": "2026-01-01"},
        ],
    )
    jobs = FakeJobsClient([{"id": "j1", "site_id": "a.example"}])
    results = erase_jobs(catalog, ["noomers.events"], jobs)
    assert results[0].status == "completed"
    assert row_count(table, "a.example") == 0
    assert row_count(table, "b.example") == 1
    assert jobs.reports == [("j1", "completed", None)]


def test_missing_table_is_skipped(catalog):
    make_table(catalog, rows=[{"site_id": "a.example", "event_id": "e1", "timestamp": "t"}])
    jobs = FakeJobsClient([{"id": "j2", "site_id": "a.example"}])
    results = erase_jobs(catalog, ["noomers.events", "noomers.events_import"], jobs)
    assert results[0].status == "completed"


def test_invalid_site_id_reported_failed(catalog):
    table = make_table(
        catalog, rows=[{"site_id": "a.example", "event_id": "e1", "timestamp": "t"}]
    )
    jobs = FakeJobsClient([{"id": "j3", "site_id": "bad site!"}])
    results = erase_jobs(catalog, ["noomers.events"], jobs)
    assert results[0].status == "failed"
    assert jobs.reports[0][2] == "invalid site_id"
    assert row_count(table, "a.example") == 1


def test_exception_reported_failed_and_next_job_runs(catalog):
    table = make_table(
        catalog,
        rows=[
            {"site_id": "a.example", "event_id": "e1", "timestamp": "t"},
            {"site_id": "b.example", "event_id": "e2", "timestamp": "t"},
        ],
    )

    class FailingCatalog:
        def __init__(self, real):
            self.real = real
            self.calls = 0

        def load_table(self, name):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("catalog down")
            return self.real.load_table(name)

    jobs = FakeJobsClient(
        [{"id": "j4", "site_id": "a.example"}, {"id": "j5", "site_id": "b.example"}]
    )
    results = erase_jobs(FailingCatalog(catalog), ["noomers.events"], jobs)
    assert [r.status for r in results] == ["failed", "completed"]
    assert row_count(table, "b.example") == 0
    assert row_count(table, "a.example") == 1


def test_idempotent_second_run(catalog):
    table = make_table(
        catalog, rows=[{"site_id": "a.example", "event_id": "e1", "timestamp": "t"}]
    )
    jobs = FakeJobsClient([{"id": "j6", "site_id": "a.example"}])
    erase_jobs(catalog, ["noomers.events"], jobs)
    erase_jobs(catalog, ["noomers.events"], jobs)
    assert jobs.reports == [("j6", "completed", None), ("j6", "completed", None)]
    assert row_count(table, "a.example") == 0
