"""pytest suite for erase_domain — real pyiceberg SqlCatalog over sqlite."""

import pyarrow as pa
import pytest
from pyiceberg.catalog.sql import SqlCatalog
from pyiceberg.expressions import EqualTo
from pyiceberg.schema import Schema
from pyiceberg.types import NestedField, StringType

from erase import erase_domain

SCHEMA = Schema(
    NestedField(1, "site_id", StringType(), required=True),
    NestedField(2, "event_id", StringType(), required=False),
    NestedField(3, "timestamp", StringType(), required=False),
)

TABLE = "noomers.events"


@pytest.fixture()
def catalog(tmp_path):
    return SqlCatalog(
        "test",
        **{
            "uri": f"sqlite:///{tmp_path}/catalog.db",
            "warehouse": f"file://{tmp_path}/warehouse",
        },
    )


def make_table(catalog, rows=()):
    try:
        catalog.create_namespace("noomers")
    except Exception:
        pass
    try:
        table = catalog.create_table(TABLE, schema=SCHEMA)
    except Exception:
        table = catalog.load_table(TABLE)
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


def row(site_id, event_id="e1", ts="2026-01-01T00:00:00Z"):
    return {"site_id": site_id, "event_id": event_id, "timestamp": ts}


def remaining(catalog, domain):
    table = catalog.load_table(TABLE)
    return (
        table.scan(row_filter=EqualTo("site_id", domain), selected_fields=("site_id",))
        .to_arrow()
        .num_rows
    )


def test_skip_when_zero_rows(catalog):
    make_table(catalog, rows=[row("other.example")])
    assert erase_domain(catalog, [TABLE], "gone.example", assume_yes=True) is True
    assert remaining(catalog, "other.example") == 1


def test_delete_and_verify(catalog):
    make_table(catalog, rows=[row("gone.example"), row("gone.example", "e2"), row("keep.example")])
    assert erase_domain(catalog, [TABLE], "gone.example", assume_yes=True) is True
    assert remaining(catalog, "gone.example") == 0
    assert remaining(catalog, "keep.example") == 1


def test_invalid_domain_rejected(catalog):
    make_table(catalog, rows=[row("gone.example")])
    assert erase_domain(catalog, [TABLE], "bad domain!", assume_yes=True) is False
    assert remaining(catalog, "gone.example") == 1


def test_decline_at_prompt_deletes_nothing(catalog, monkeypatch):
    make_table(catalog, rows=[row("gone.example")])
    monkeypatch.setattr("builtins.input", lambda _: "n")
    assert erase_domain(catalog, [TABLE], "gone.example", assume_yes=False) is True
    assert remaining(catalog, "gone.example") == 1
