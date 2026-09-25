"""Focused deterministic arithmetic checks for the blackout tracker projection."""

from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.blackout_service import _ranges


def check(label: str, condition: bool, results: list[tuple[str, bool]]) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def main() -> None:
    results: list[tuple[str, bool]] = []
    today = date(2028, 2, 29)
    both = _ranges("fixture", [(date(2028, 2, 29), date(2028, 2, 29)), (date(2028, 3, 2), date(2028, 3, 3))], "both", 2, today)
    check("leap-day before/after ranges exclude exact posting dates and windows", both == [(date(2028, 3, 1), date(2028, 3, 1)), (date(2028, 3, 4), date(2028, 3, 5))], results)
    merged = _ranges("fixture", [(date(2028, 3, 3), date(2028, 3, 3)), (date(2028, 3, 5), date(2028, 3, 5)), (date(2028, 3, 9), date(2028, 3, 9))], "before", 2, date(2028, 3, 1))
    check("overlapping and adjacent days merge while genuine gaps stay separate", merged == [(date(2028, 3, 1), date(2028, 3, 2)), (date(2028, 3, 4), date(2028, 3, 4)), (date(2028, 3, 7), date(2028, 3, 8))], results)
    check("ended ranges are absent while active and upcoming ranges remain", _ranges("fixture", [(date(2028, 2, 20), date(2028, 2, 20)), (date(2028, 3, 2), date(2028, 3, 2))], "after", 1, today) == [(date(2028, 3, 3), date(2028, 3, 3))], results)
    failures = [label for label, passed in results if not passed]
    print(f"\n{len(results) - len(failures)}/{len(results)} blackout tracker checks passed")
    if failures:
        raise AssertionError('; '.join(failures))


if __name__ == '__main__':
    main()
