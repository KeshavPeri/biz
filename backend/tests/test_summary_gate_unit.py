"""Pure contract checks for the 12-item Chatting summary gate.

Run: python backend/tests/test_summary_gate_unit.py
The end-to-end companion is test_summary_gate.py and uses the development DB.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from services.ai_service import ChecklistAnalysis  # noqa: E402
from services.summary_gate import MINIMUM_CHECKLIST, _item_status  # noqa: E402


def check(label: str, condition: bool) -> None:
    print(f"{'PASS' if condition else 'FAIL'} - {label}")
    if not condition:
        raise AssertionError(label)


def main() -> None:
    check('exactly 12 minimum checklist items', len(MINIMUM_CHECKLIST) == 12)
    check('all item keys are unique', len({item.key for item in MINIMUM_CHECKLIST}) == 12)

    exclusivity = next(item for item in MINIMUM_CHECKLIST if item.key == 'exclusivity')
    no_exclusivity = _item_status(exclusivity, ChecklistAnalysis('found', value=False), None)
    check('explicit no resolves a yes/no parent', no_exclusivity['is_complete'] and no_exclusivity['status'] == 'found')

    yes_missing_child = _item_status(exclusivity, ChecklistAnalysis('found', value=True), None)
    check('yes parent requires its conditional children', not yes_missing_child['is_complete'] and yes_missing_child['status'] == 'ambiguous')
    check('missing child details are precise', yes_missing_child['missing_children'] == ['duration', 'category'])

    yes_complete = _item_status(
        exclusivity,
        ChecklistAnalysis('found', children={'duration': 'found', 'category': 'found'}, value=True),
        None,
    )
    check('yes parent clears once both conditional children are found', yes_complete['is_complete'])
    override = _item_status(exclusivity, ChecklistAnalysis('not_discussed'), {'status': 'confirmed', 'proposed_by': 'a', 'proposer_side': 'creator', 'confirmed_by': 'b'})
    check('two-side override clears the one checklist item', override['is_complete'] and override['status'] == 'found')


if __name__ == '__main__':
    main()
