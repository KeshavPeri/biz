"""Pure exact-match, UTC boundary, digest and fail-closed conflict checks."""

import copy
import os
import sys
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("SUPABASE_URL", "https://example.invalid")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from services.exclusivity_conflicts import category_identity, project_conflicts  # noqa: E402
from services.stage_engine import DealError  # noqa: E402


class _Response:
    def __init__(self, data): self.data = data


class _Rpc:
    def __init__(self, data): self.data = data
    def execute(self): return _Response(self.data)


class _Client:
    def __init__(self, rows, day="2028-02-29"):
        self.rows, self.day = rows, day
    def rpc(self, name, params):
        assert name == "exclusivity_conflict_snapshot"
        assert params == {"p_creator_id": "fictional-creator"}
        return _Rpc({"as_of": self.day, "snapshot": "a" * 32, "rows": self.rows})


def clause(number, **overrides):
    row = {
        "id": f"clause-{number}", "deal_id": f"deal-{number}", "source_summary_id": f"summary-{number}",
        "brand_name": f"Fictional Brand {number}", "has_exclusivity": True,
        "category": "skincare", "duration_days": 10,
        "start_date": "2028-02-20", "end_date": "2028-02-29",
    }
    row.update(overrides)
    return row


def project(rows, category="Skincare", day="2028-02-29"):
    by_deal = {row["deal_id"]: row for row in rows}
    def source(_client, deal_id):
        row = by_deal[deal_id]
        return {}, {"id": row["source_summary_id"]}, None
    def expected(_client, deal_id, _contract, _terms, *, fallback):
        assert fallback is False
        row = by_deal[deal_id]
        return {key: row[key] for key in ("has_exclusivity", "category", "duration_days", "start_date", "end_date")}
    with patch("services.exclusivity_conflicts._executed_source", source), patch(
        "services.exclusivity_conflicts._expected_fact", expected
    ):
        return project_conflicts(_Client(rows, day), "fictional-creator", category)


def main():
    assert category_identity(" ＳＳＫＩＮＣＡＲＥ ") == "sskincare"
    assert category_identity("Straße") == category_identity("STRASSE")
    assert category_identity("beauty") != category_identity("skincare")
    assert category_identity("skin") != category_identity("skincare")
    assert category_identity("ѕkincare") != category_identity("skincare")  # Cyrillic confusable

    rows = [
        clause(1, category="ＳＫＩＮＣＡＲＥ", brand_name="Zulu Fictional"),
        clause(2, category="skincare", brand_name="Alpha Fictional"),
        clause(3, category="beauty"),
        clause(4, category="skin"),
        clause(5, category="ѕkincare"),
        clause(6, start_date="2028-03-02", end_date="2028-03-11"),
        clause(7, start_date="2028-02-01", end_date="2028-02-28"),
        clause(8, has_exclusivity=False, category=None, duration_days=None, start_date=None, end_date=None),
    ]
    result = project(rows)
    assert [c["brand"] for c in result["warning"]["conflicts"]] == ["Alpha Fictional", "Zulu Fictional"]
    assert result["audit"]["conflict_count"] == 2
    assert result["audit"]["clause_ids"] == ["clause-2", "clause-1"]
    assert set(result["warning"]) == {"version", "conflicts", "digest"}
    assert set(result["warning"]["conflicts"][0]) == {"brand", "category", "expiry"}
    assert not {"contract", "summary", "raw_output", "deal_name"} & set(result["audit"])
    assert project(rows)["digest"] == result["digest"]
    changed = copy.deepcopy(rows)
    changed[1]["end_date"] = "2028-03-01"
    assert project(changed)["digest"] != result["digest"]
    changed_start = copy.deepcopy(rows)
    changed_start[1]["start_date"] = "2028-02-21"
    assert project(changed_start)["digest"] != result["digest"]
    assert project(rows, category="beauty")["warning"]["conflicts"] == [
        {"brand": "Fictional Brand 3", "category": "beauty", "expiry": "2028-02-29"}
    ]
    assert project(rows, day="2028-03-01")["warning"]["conflicts"] == []
    try:
        project([clause(9, has_exclusivity=True, category=None)])
        raise AssertionError("malformed authoritative clause was accepted")
    except DealError as error:
        assert error.status_code == 409
    try:
        project([clause(i) for i in range(51)])
        raise AssertionError("overflow was silently truncated")
    except DealError as error:
        assert error.status_code == 409
    print("RESULT: 18/18 conflict projection assertions passed")


if __name__ == "__main__": main()
