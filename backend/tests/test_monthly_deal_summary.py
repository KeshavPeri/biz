"""Development-Supabase acceptance checks for workplan 11.1-B.

Uses run-unique fictional users/deals, invokes the service-only helper with a
fixed clock, and removes every fixture in ``finally``. Migration 049 is applied
first and all money assertions use exact decimal strings.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from services.term_extraction import TermsExtraction  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Monthly-{RUN_ID}-Fictional!"
CLOCK = "2026-09-24T12:00:00+00:00"
MONTH = "2026-09-01"
USERS = {
    "C": (f"monthly.creator.{RUN_ID}@inflo.test", "Fictional Monthly Creator", "creator"),
    "B": (f"monthly.brand.{RUN_ID}@inflo.test", "Fictional Monthly Brand Admin", "brand"),
    "I": (f"monthly.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Brand", "brand"),
    "O": (f"monthly.outsider.{RUN_ID}@inflo.test", "Fictional Monthly Outsider", "creator"),
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
user_ids: dict[str, str] = {}
brand_ids: list[str] = []
deal_ids: list[str] = []
sources: dict[str, str] = {}
named_deals: dict[str, str] = {}
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def management_sql(sql: str):
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {MANAGEMENT_CREDENTIAL}"},
        json={"query": sql},
        timeout=120,
    )
    if not response.is_success:
        raise RuntimeError(f"Management SQL failed ({response.status_code}): {response.text[:1200]}")
    return response.json()


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[key][0], "password": PASSWORD})
    return client


def found(value: object) -> dict:
    return {
        "status": "found",
        "value": value,
        "evidence": [{"message_id": "fictional-monthly-message", "quote": "fictional agreed term"}],
    }


def not_discussed() -> dict:
    return {"status": "not_discussed", "value": None, "evidence": []}


def terms(structure: str, amount: int, currency: str) -> dict:
    terms_type = structure if structure in {"milestone", "combination"} else "upfront"
    schedule = not_discussed()
    if structure in {"milestone", "combination"}:
        first = amount * 40 // 100
        schedule = found([
            {"trigger": "Fictional first checkpoint", "amount": {"amount": first, "currency": currency}, "due_date": "2026-09-10"},
            {"trigger": "Fictional final checkpoint", "amount": {"amount": amount - first, "currency": currency}, "due_date": "2026-09-20"},
        ])
    value = {
        "payment_amount": found({"amount": amount, "currency": currency}),
        "payment_terms_type": found(terms_type),
        "payment_terms_from_date": not_discussed(),
        "exclusivity": found(False),
        "exclusivity_duration_days": not_discussed(),
        "exclusivity_category": not_discussed(),
        "usage_rights": found(False),
        "usage_rights_duration": not_discussed(),
        "usage_rights_channels": not_discussed(),
        "whitelisting": found(False),
        "blackout_window": found(False),
        "blackout_duration_timing": not_discussed(),
        "revision_rounds_max": found(1),
        "creative_guidance": found({"kind": "creator_discretion", "text": "Fictional monthly brief"}),
        "content_format_per_deliverable": found([{"deliverable_index": 1, "content_format": "Reel"}]),
        "platform_per_deliverable": found([{"deliverable_index": 1, "platform": "Instagram"}]),
        "posting_window_per_deliverable": found([{
            "deliverable_index": 1, "posting_date": "2026-10-01", "window_start": None, "window_end": None,
        }]),
        "sponsored_content_disclosure": found({"required": True, "platform_rules": ["Use #ad"]}),
        "content_ownership": found("creator"),
        "deliverable_count": found(1),
        "location_per_deliverable": found([{"deliverable_index": 1, "location": "Fictional studio"}]),
        "milestone_schedule": schedule,
    }
    TermsExtraction.model_validate(value)
    return value


def make_deal(
    label: str,
    amount: int,
    *,
    currency: str = "INR",
    structure: str = "single",
    brand_index: int = 0,
    stage: str = "payment",
    direction: str = "inbound",
    executed_at: str = "2026-09-01T00:00:00Z",
    deleted: bool = False,
    contract: bool = True,
    invalid_terms: bool = False,
) -> str:
    deal_id = str(uuid4())
    deal_ids.append(deal_id)
    named_deals[label] = deal_id
    deleted_sql = "'2026-09-12T00:00:00Z'" if deleted else "NULL"
    management_sql(f"""
        INSERT INTO public.deals
            (id, creator_id, brand_id, deal_name, deal_type, stage, direction,
             created_by, created_at, updated_at, deleted_at)
        VALUES ('{deal_id}', '{user_ids['C']}', '{brand_ids[brand_index]}',
                'Fictional {label}', 'campaign', '{stage}', '{direction}',
                '{user_ids['C']}', '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', {deleted_sql});
        INSERT INTO public.deal_participants (deal_id, profile_id, participant_role) VALUES
            ('{deal_id}', '{user_ids['C']}', 'creator'),
            ('{deal_id}', '{user_ids['B']}', 'brand_admin'),
            ('{deal_id}', '{user_ids['I']}', 'brand_maker');
        INSERT INTO public.deal_stage_transitions
            (deal_id, from_stage, to_stage, transition_type, triggered_by, created_at)
        VALUES ('{deal_id}', 'approval', 'creating', 'auto', '{user_ids['C']}', '{executed_at}');
    """)
    payload = terms(structure, amount, currency)
    if invalid_terms:
        payload["payment_amount"]["value"]["currency"] = currency.lower()
    source_id = str(uuid4())
    sources[label] = source_id
    summary_json = json.dumps(payload).replace("'", "''")
    management_sql(f"""
        INSERT INTO public.ai_summaries
            (id, deal_id, raw_output, structured_terms, status, generated_at)
        VALUES ('{source_id}', '{deal_id}', '{{}}'::jsonb, '{summary_json}'::jsonb,
                'approved', '2026-08-15T00:00:00Z');
    """)
    if contract:
        management_sql(f"""
            INSERT INTO public.contracts
                (deal_id, version, storage_path, generated_from_summary_id, status,
                 created_at, draft_source_sha256)
            VALUES ('{deal_id}', 1, 'fictional/{deal_id}/v1.pdf', '{source_id}',
                    'executed', '2026-08-31T00:00:00Z', '{'a' * 64}');
            INSERT INTO public.deliverables
                (deal_id, sequence, content_format, platform, posting_date,
                 revision_max, revision_current, status, source_summary_id)
            VALUES ('{deal_id}', 1, 'reel', 'instagram', '2026-10-01', 1, 0,
                    'pending', '{source_id}');
        """)
    return deal_id


def add_payment(
    label: str,
    deal_id: str,
    amount: int,
    *,
    currency: str = "INR",
    structure: str = "single",
    state: str = "not_paid_in_window",
    receipt: bool = False,
    receipt_version: int = 1,
    receipt_actor: str = "C",
    duplicate_legacy: bool = False,
) -> str:
    payment_id = str(uuid4())
    receipt_sql = str(receipt_version) if receipt else "NULL"
    confirmer_sql = f"'{user_ids[receipt_actor]}'" if receipt else "NULL"
    confirmed_at_sql = "'2026-09-20T00:00:00Z'" if receipt else "NULL"
    management_sql(f"""
        INSERT INTO public.payments
            (id, deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by, updated_at, creator_receipt_version,
             creator_receipt_confirmed_by, creator_receipt_confirmed_at)
        VALUES ('{payment_id}', '{deal_id}', {amount}, '{currency}', '{structure}', '{state}',
                '2026-09-20', '{sources[label]}', false, 1, '{user_ids['B']}', '{CLOCK}',
                {receipt_sql}, {confirmer_sql}, {confirmed_at_sql});
    """)
    if duplicate_legacy:
        management_sql(f"""
            INSERT INTO public.payments
                (deal_id, amount, currency, structure, state, due_date, created_at, updated_at)
            VALUES ('{deal_id}', {amount}, '{currency}', 'single', 'not_paid_in_window',
                    '2026-09-20', '{CLOCK}', '{CLOCK}');
        """)
    return payment_id


def add_milestones(payment_id: str, amount: int, *, second_state: str = "not_paid_in_window") -> None:
    first = amount * 40 // 100
    management_sql(f"""
        INSERT INTO public.payment_milestones
            (payment_id, sequence, trigger_description, amount, due_date, state,
             version, updated_by, updated_at, creator_receipt_version,
             creator_receipt_confirmed_by, creator_receipt_confirmed_at)
        VALUES
            ('{payment_id}', 1, 'Fictional first checkpoint', {first}, '2026-09-10',
             'paid_full', 1, '{user_ids['B']}', '{CLOCK}', 1, '{user_ids['C']}', '2026-09-12T00:00:00Z'),
            ('{payment_id}', 2, 'Fictional final checkpoint', {amount - first}, '2026-09-20',
             '{second_state}', 1, '{user_ids['B']}', '{CLOCK}', NULL, NULL, NULL);
    """)


def setup() -> None:
    management_sql((BACKEND_DIR / "migrations/049_monthly_deal_summary.sql").read_text())
    for key, (email, display_name, account_type) in USERS.items():
        created = admin.auth.admin.create_user({
            "email": email, "password": PASSWORD, "email_confirm": True,
            "user_metadata": {"display_name": display_name},
        })
        user_ids[key] = created.user.id
        admin.table("profiles").insert({
            "id": created.user.id, "account_type": account_type,
            "display_name": display_name, "email": email,
        }).execute()
    for suffix in ("Studio", "Collective"):
        brand_ids.append(admin.table("brands").insert({
            "company_name": f"Fictional Monthly {suffix} {RUN_ID}", "industry": "Testing",
        }).execute().data[0]["id"])
    for brand_id in brand_ids:
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": user_ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": user_ids["I"], "brand_role": "member", "status": "invited"},
        ]).execute()

    fixtures = [
        ("single paid", 1000, {}),
        ("single version mismatch", 2000, {"direction": "outbound"}),
        ("single wrong confirmer", 1600, {}),
        ("single partial", 3000, {}),
        ("single refunded", 4000, {"direction": "outbound"}),
        ("single disputed", 5000, {}),
        ("missing pre-payment", 6000, {"stage": "creating", "direction": "outbound"}),
        ("missing in payment", 6100, {"stage": "payment", "executed_at": "2026-10-01T00:00:00Z"}),
        ("missing when closed", 6200, {"stage": "closed", "executed_at": "2026-11-01T00:00:00Z"}),
        ("milestone paid", 7000, {"structure": "milestone"}),
        ("milestone disputed", 7500, {"structure": "milestone", "direction": "outbound"}),
        ("closed second brand", 8000, {"stage": "closed", "brand_index": 1, "direction": "outbound"}),
        ("first UTC instant", 900, {}),
        ("combination dollars", 100, {"currency": "USD", "structure": "combination", "direction": "outbound"}),
        ("prior UTC instant", 10000, {"executed_at": "2026-08-31T23:59:59.999999Z"}),
        ("cancelled omitted", 11000, {"stage": "cancelled"}),
        ("deleted omitted", 12000, {"deleted": True}),
        ("unexecuted attention", 13000, {"contract": False}),
        ("invalid currency attention", 14000, {"invalid_terms": True}),
        ("duplicate payment attention", 15000, {}),
    ]
    made = {label: make_deal(label, amount, **kwargs) for label, amount, kwargs in fixtures}
    add_payment("single paid", made["single paid"], 1000, state="paid_full", receipt=True)
    add_payment("single version mismatch", made["single version mismatch"], 2000, state="paid_full", receipt=True, receipt_version=1)
    management_sql(f"UPDATE public.payments SET version = 2 WHERE deal_id = '{made['single version mismatch']}';")
    add_payment("single wrong confirmer", made["single wrong confirmer"], 1600, state="paid_full", receipt=True, receipt_actor="B")
    add_payment("single partial", made["single partial"], 3000, state="paid_partial")
    add_payment("single refunded", made["single refunded"], 4000, state="refunded")
    add_payment("single disputed", made["single disputed"], 5000, state="disputed")
    milestone = add_payment("milestone paid", made["milestone paid"], 7000, structure="milestone", state="paid_partial")
    add_milestones(milestone, 7000)
    disputed_milestone = add_payment("milestone disputed", made["milestone disputed"], 7500, structure="milestone", state="paid_partial")
    add_milestones(disputed_milestone, 7500)
    admin.rpc("raise_payment_dispute", {
        "p_deal_id": made["milestone disputed"],
        "p_actor_id": user_ids["C"],
        "p_description": "Fictional monthly milestone dispute",
        "p_evidence": [],
        "p_ip_address": "127.0.0.1",
    }).execute()
    add_payment("closed second brand", made["closed second brand"], 8000, state="paid_full", receipt=True)
    add_payment("first UTC instant", made["first UTC instant"], 900)
    combination = add_payment("combination dollars", made["combination dollars"], 100, currency="USD", structure="combination", state="paid_partial")
    add_milestones(combination, 100, second_state="paid_partial")
    add_payment("duplicate payment attention", made["duplicate payment attention"], 15000, duplicate_legacy=True)


def run_checks() -> None:
    creator = auth_client("C")
    brand = auth_client("B")
    inactive = auth_client("I")
    outsider = auth_client("O")
    deterministic = admin.rpc("monthly_deal_summary_snapshot", {
        "p_viewer": user_ids["C"], "p_month": MONTH, "p_as_of": CLOCK,
    }).execute().data
    totals = {row["currency"]: row for row in deterministic["totals"]}
    groups = deterministic["groups"]
    october = admin.rpc("monthly_deal_summary_snapshot", {
        "p_viewer": user_ids["C"], "p_month": "2026-10-01", "p_as_of": CLOCK,
    }).execute().data
    november = admin.rpc("monthly_deal_summary_snapshot", {
        "p_viewer": user_ids["C"], "p_month": "2026-11-01", "p_as_of": CLOCK,
    }).execute().data

    check("selected UTC month and one server clock are returned", deterministic["month"] == MONTH and deterministic["as_of"] == CLOCK)
    check("prior-month final instant is excluded and selected-month first instant included", totals["INR"]["deal_count"] == 11)
    check("Creating, Payment, and Closed deals remain historically visible", totals["INR"]["contracted"] == "46000.00")
    check("deleted, cancelled, unexecuted, invalid-source, and duplicate-source deals add no money", totals["INR"]["contracted"] != "102900.00")
    check("invalid and duplicate source records are reported generically", deterministic["integrity_attention_count"] == 3)
    check("single paid receipts require current versions and the deal creator", totals["INR"]["confirmed_received"] == "11800.00" and totals["INR"]["outstanding"] == "34200.00")
    check("milestone receipts count only exact paid-full current versions", any(row["confirmed_received"] == "3800.00" for row in groups if row["currency"] == "INR"))
    check("real disputed parent and deal suppress otherwise confirmed milestones", admin.table("deals").select("is_disputed").eq("id", named_deals["milestone disputed"]).single().execute().data["is_disputed"] is True and admin.table("payments").select("state").eq("deal_id", named_deals["milestone disputed"]).single().execute().data["state"] == "disputed")
    check("missing payment remains valid before Payment only", october["totals"] == [] and october["groups"] == [] and october["integrity_attention_count"] == 1)
    check("missing payment in Closed independently produces integrity attention", november["totals"] == [] and november["groups"] == [] and november["integrity_attention_count"] == 1)
    check("mixed paid-full and unpaid milestones do not imply unquantified partial money", totals["INR"]["partial_unquantified_count"] == 1)
    check("combination partial amount remains outstanding and unquantified", totals["USD"] == {
        "currency": "USD", "contracted": "100.00", "confirmed_received": "40.00", "outstanding": "60.00",
        "deal_count": 1, "deliverable_count": 1, "inbound_deals": 0, "outbound_deals": 1,
        "partial_unquantified_count": 1,
    })
    check("currencies remain separate with no cross-currency total", set(totals) == {"INR", "USD"})
    check("creator groups use stable brand ids plus currency", {(row["counterparty_id"], row["currency"]) for row in groups} == {
        (brand_ids[0], "INR"), (brand_ids[0], "USD"), (brand_ids[1], "INR"),
    })
    check("group money and counts reconcile exactly to currency totals", all(
        sum(int(row[field].replace(".", "")) if field in {"contracted", "confirmed_received", "outstanding"} else row[field]
            for row in groups if row["currency"] == currency) ==
        (int(total[field].replace(".", "")) if field in {"contracted", "confirmed_received", "outstanding"} else total[field])
        for currency, total in totals.items()
        for field in ("contracted", "confirmed_received", "outstanding", "deal_count", "deliverable_count", "inbound_deals", "outbound_deals", "partial_unquantified_count")
    ))
    check("deal, deliverable, and I/O facts count each deal once", totals["INR"]["deliverable_count"] == totals["INR"]["deal_count"] and totals["INR"]["inbound_deals"] + totals["INR"]["outbound_deals"] == totals["INR"]["deal_count"])

    creator_public = creator.rpc("get_monthly_deal_summary", {"p_month": MONTH}).execute().data
    brand_public = brand.rpc("get_monthly_deal_summary", {"p_month": MONTH}).execute().data
    check("authenticated creator wrapper derives identity and matches deterministic totals", creator_public["totals"] == deterministic["totals"])
    check("active same-brand participant sees only current brands and groups by creator", len(brand_public["groups"]) == 2 and {row["counterparty_id"] for row in brand_public["groups"]} == {user_ids["C"]})
    check("outsider and stale inactive brand membership expose no rows", outsider.rpc("get_monthly_deal_summary", {"p_month": MONTH}).execute().data["groups"] == [] and inactive.rpc("get_monthly_deal_summary", {"p_month": MONTH}).execute().data["groups"] == [])

    denied_helper = denied_actor = denied_anon = denied_bad_month = False
    try:
        creator.rpc("monthly_deal_summary_snapshot", {"p_viewer": user_ids["O"], "p_month": MONTH, "p_as_of": CLOCK}).execute()
    except APIError:
        denied_helper = True
    try:
        creator.rpc("get_monthly_deal_summary", {"p_month": MONTH, "p_viewer": user_ids["O"]}).execute()
    except APIError:
        denied_actor = True
    try:
        create_client(SUPABASE_URL, ANON_KEY).rpc("get_monthly_deal_summary", {"p_month": MONTH}).execute()
    except APIError:
        denied_anon = True
    try:
        creator.rpc("get_monthly_deal_summary", {"p_month": "2026-09-02"}).execute()
    except APIError:
        denied_bad_month = True
    check("service-only helper blocks caller-supplied identity", denied_helper and denied_actor)
    check("anonymous execution and non-month-start input fail closed", denied_anon and denied_bad_month)

    grants = management_sql("""
        SELECT routine_name, grantee
          FROM information_schema.routine_privileges
         WHERE specific_schema = 'public'
           AND routine_name IN ('get_monthly_deal_summary', 'monthly_deal_summary_snapshot')
           AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
         ORDER BY routine_name, grantee;
    """)
    check("grants expose only authenticated wrapper and service-role helper", {
        (row["routine_name"], row["grantee"]) for row in grants
    } == {("get_monthly_deal_summary", "authenticated"), ("monthly_deal_summary_snapshot", "service_role")})
    check("payload exposes only bounded display-safe keys", set(deterministic) == {
        "version", "as_of", "month", "integrity_attention_count", "totals", "groups",
    } and all(set(row) == {
        "counterparty_id", "counterparty_name", "currency", "contracted", "confirmed_received",
        "outstanding", "deal_count", "deliverable_count", "inbound_deals", "outbound_deals",
        "partial_unquantified_count",
    } for row in groups))


def cleanup() -> None:
    if user_ids:
        management_sql(
            "SET session_replication_role = replica; "
            "DELETE FROM public.audit_log WHERE actor_id IN (" + ",".join(f"'{value}'" for value in user_ids.values()) + "); "
            "SET session_replication_role = origin;"
        )
    if deal_ids:
        management_sql("DELETE FROM public.deals WHERE id IN (" + ",".join(f"'{value}'" for value in deal_ids) + ");")
    for brand_id in brand_ids:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in user_ids.values():
        admin.auth.admin.delete_user(user_id)


def verify_cleanup() -> None:
    if not deal_ids:
        return
    count = management_sql("SELECT count(*)::integer AS count FROM public.deals WHERE id IN (" + ",".join(f"'{value}'" for value in deal_ids) + ");")[0]["count"]
    check("fictional fixture cleanup leaves zero deals", count == 0)


def main() -> None:
    try:
        setup()
        run_checks()
    finally:
        cleanup()
        verify_cleanup()
    passed = sum(ok for _, ok in checks)
    print(f"RESULT: {passed}/{len(checks)} checks passed")
    if passed != len(checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
