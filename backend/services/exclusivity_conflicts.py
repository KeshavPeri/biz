"""Creator-only, exact-category conflict projection for Connect and Pending accept.

The database snapshot binds this read to the final transaction. The executed
contract and canonical clause are validated here using the tracker authority;
only the small warning projection ever leaves the backend.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from datetime import date
from typing import Any

from supabase import Client

from services.exclusivity_service import _executed_source, _expected_fact
from services.stage_engine import DealError

MAX_CONFLICTS = 50
MAX_INVENTORY = 500
UNAVAILABLE = "Exclusivity information is temporarily unavailable. Please refresh and try again."
BIDI_FORMAT = {0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}


def valid_category(value: Any, *, trim: bool) -> str:
    if not isinstance(value, str):
        raise ValueError("Enter a campaign category.")
    display = value.strip() if trim else value
    if not display or len(display) > 200:
        raise ValueError("Enter a campaign category of 1–200 characters.")
    if not trim and display != display.strip():
        raise ValueError("The campaign category has extra space at its edges.")
    if any(unicodedata.category(ch) == "Cc" or ord(ch) in BIDI_FORMAT for ch in display):
        raise ValueError("Remove control or direction-formatting characters from the category.")
    return display


def category_identity(value: str) -> str:
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def _unavailable() -> None:
    raise DealError(409, UNAVAILABLE)


def project_conflicts(client: Client, creator_id: str, display_category: str) -> dict[str, Any]:
    try:
        inventory = client.rpc("exclusivity_conflict_snapshot", {"p_creator_id": creator_id}).execute().data
        rows = inventory[0] if isinstance(inventory, list) else inventory
        today = date.fromisoformat(rows["as_of"])
        snapshot = rows["snapshot"]
        clauses = rows["rows"]
        if not isinstance(snapshot, str) or len(snapshot) != 32 or not isinstance(clauses, list):
            _unavailable()
        if len(clauses) > MAX_INVENTORY:
            _unavailable()
        conflicts: list[dict[str, Any]] = []
        seen: set[str] = set()
        proposed_identity = category_identity(display_category)
        for row in clauses:
            clause_id, source_deal, source_id = row["id"], row["deal_id"], row["source_summary_id"]
            if not all(isinstance(item, str) for item in (clause_id, source_deal, source_id)):
                _unavailable()
            if clause_id in seen:
                _unavailable()
            seen.add(clause_id)
            contract, summary, terms = _executed_source(client, source_deal)
            if summary["id"] != source_id:
                _unavailable()
            expected = _expected_fact(client, source_deal, contract, terms, fallback=False)
            if any(row.get(key) != expected[key] for key in expected):
                _unavailable()
            if not expected["has_exclusivity"]:
                continue
            category = valid_category(expected["category"], trim=False)
            brand = row.get("brand_name")
            if (not isinstance(brand, str) or not 1 <= len(brand) <= 160
                    or any(unicodedata.category(ch) == "Cc" or ord(ch) in BIDI_FORMAT for ch in brand)):
                _unavailable()
            start = date.fromisoformat(expected["start_date"])
            end = date.fromisoformat(expected["end_date"])
            if start <= today <= end and category_identity(category) == proposed_identity:
                conflicts.append({
                    "clause_id": clause_id, "deal_id": source_deal,
                    "source_summary_id": source_id,
                    "brand": brand, "category": category, "expiry": end.isoformat(),
                    "start_date": start.isoformat(), "duration_days": expected["duration_days"],
                })
        if len(conflicts) > MAX_CONFLICTS:
            _unavailable()
        conflicts.sort(key=lambda c: (
            c["expiry"], category_identity(c["brand"]), category_identity(c["category"]), c["clause_id"]
        ))
        identity_set = [{key: c[key] for key in (
            "clause_id", "deal_id", "source_summary_id", "brand", "category",
            "start_date", "expiry", "duration_days"
        )}
                        for c in conflicts]
        binding = {
            "version": 1, "as_of": today.isoformat(),
            "category": display_category, "category_identity": proposed_identity,
            "conflicts": identity_set,
        }
        digest = hashlib.sha256(json.dumps(
            binding, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")).hexdigest()
        public_conflicts = [
            {key: c[key] for key in ("brand", "category", "expiry")} for c in conflicts
        ]
        return {
            "snapshot": snapshot,
            "digest": digest,
            "warning": {"version": 1, "conflicts": public_conflicts, "digest": digest},
            "audit": {
                "version": 1,
                "proposed_category": display_category,
                "proposed_category_identity": proposed_identity,
                "conflict_count": len(conflicts),
                "digest": digest,
                "clause_ids": [c["clause_id"] for c in conflicts],
                "deal_ids": [c["deal_id"] for c in conflicts],
            },
        }
    except DealError:
        _unavailable()
    except (KeyError, TypeError, ValueError, IndexError, OverflowError, Exception) as exc:
        raise DealError(409, UNAVAILABLE) from exc
