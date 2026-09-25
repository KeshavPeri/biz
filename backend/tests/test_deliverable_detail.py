"""Focused no-network checks for the deliverable-detail UTC rights seam."""

from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.deliverable_detail_service import rights_status  # noqa: E402


def check(label: str, value: bool) -> None:
    assert value, label
    print(f"PASS - {label}")


def main() -> None:
    base = {"has_usage_rights": True, "is_perpetual": False, "end_date": "2026-10-15"}
    check("no rights are explicit", rights_status({"has_usage_rights": False, "is_perpetual": False, "end_date": None}, "2026-10-15") == "none")
    check("perpetual rights never expire", rights_status({"has_usage_rights": True, "is_perpetual": True, "end_date": None}, "2030-01-01") == "perpetual")
    check("finite rights are active before the inclusive fourteen-date window", rights_status(base, "2026-09-30") == "active")
    check("finite rights become expiring exactly fourteen UTC dates before expiry", rights_status(base, "2026-10-01") == "expiring")
    check("expiry date remains expiring", rights_status(base, "2026-10-15") == "expiring")
    check("the following UTC date is expired", rights_status(base, "2026-10-16") == "expired")
    print("TEST-DELIVERABLE-DETAIL (6)")


if __name__ == "__main__":
    main()
