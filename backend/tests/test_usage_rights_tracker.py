"""Focused no-network checks for the shared usage-rights tracker seam."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.deliverable_detail_service import rights_status  # noqa: E402
from services.stage_engine import DealError  # noqa: E402
from services.usage_rights_service import _fact_payload  # noqa: E402


def main() -> None:
    checks = 0

    def check(label: str, condition: bool) -> None:
        nonlocal checks
        assert condition, label
        checks += 1

    finite = {"has_usage_rights": True, "channels": ["Fictional web"], "start_date": "2028-02-27", "end_date": "2028-03-02", "is_perpetual": False}
    check("explicit no-rights stays none", rights_status({"has_usage_rights": False, "channels": [], "start_date": None, "end_date": None, "is_perpetual": False}, "2028-02-29") == "none")
    check("perpetual has no expiry", rights_status({**finite, "is_perpetual": True, "end_date": None}, "2030-01-01") == "perpetual")
    check("finite is active before fourteen-date window", rights_status(finite, "2028-02-16") == "active")
    check("leap-boundary first expiring date is inclusive", rights_status(finite, "2028-02-17") == "expiring")
    check("expiry day is expiring", rights_status(finite, "2028-03-02") == "expiring")
    check("day after expiry is expired", rights_status(finite, "2028-03-03") == "expired")
    check("valid canonical fact narrows to safe present payload", _fact_payload({**finite, "status": "active"})["rights_presence"] == "present")
    check("explicit no-rights narrows without dates", _fact_payload({"has_usage_rights": False, "channels": [], "start_date": None, "end_date": None, "is_perpetual": False, "status": "none"})["status"] == "none")
    for malformed in (
        {**finite, "channels": ["same", "same"], "status": "active"},
        {**finite, "end_date": None, "status": "active"},
        {"has_usage_rights": False, "channels": ["leak"], "start_date": None, "end_date": None, "is_perpetual": False, "status": "none"},
    ):
        try:
            _fact_payload(malformed)
        except DealError:
            checks += 1
        else:
            raise AssertionError("malformed canonical fact must fail closed")
    print(f"TEST-USAGE-RIGHTS-TRACKER ({checks})")


if __name__ == "__main__":
    main()
