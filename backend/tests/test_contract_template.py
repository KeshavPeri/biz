"""Local contract-template safety/render smoke test (no database required)."""
import io
import sys
from pathlib import Path

from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.contract_service import TEMPLATES, _pdf, _safe_svg

html = TEMPLATES.get_template('agreement.html').render(
    contract_id='00000000-0000-0000-0000-000000000001', version=1,
    generated_date='23 August 2026', creator_name='<Creator>', brand_name='<Brand>',
    approved_summary_id='00000000-0000-0000-0000-000000000002',
    deal_name='Fictional launch <script>', currency='INR',
    terms=[{'label': 'Payment amount', 'value': '25,000'}, {'label': 'Deliverables', 'value': 'One Reel'}],
    signatures=[], executed=False,
)
assert '&lt;Creator&gt;' in html and '<script>' not in html
pdf = _pdf(html)
assert pdf.startswith(b'%PDF') and len(pdf) > 1000 and len(PdfReader(io.BytesIO(pdf)).pages) >= 1
valid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path d="M 1 1 L 2 2" fill="none" stroke="#1C1B18" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
assert _safe_svg(valid).startswith('<svg')
for bad in (
    '<svg><script/></svg>',
    '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M 1 1 L 2 2" onload="x"/></svg>',
    '<svg viewBox="0 0 10 10" width="10" height="10"><image href="https://evil.invalid/x"/></svg>',
):
    try: _safe_svg(bad)
    except Exception: pass
    else: raise AssertionError('unsafe svg accepted')
print('PASS - contract template and SVG safety')
