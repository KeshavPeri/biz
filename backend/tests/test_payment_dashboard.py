"""Development-Supabase acceptance checks for workplan 11.2.

Applies migration 050, creates only run-unique fictional payment fixtures, and
removes every fixture in ``finally``. No private financial or real payment data
is created or read.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Dashboard-{RUN_ID}-Fictional!"
CLOCK = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
TODAY = CLOCK.date()
USERS = {
    "C": (f"dashboard.creator.{RUN_ID}@inflo.test", "Fictional Dashboard Creator", "creator"),
    "B": (f"dashboard.brand.{RUN_ID}@inflo.test", "Fictional Dashboard Brand", "brand"),
    "S": (f"dashboard.stale.{RUN_ID}@inflo.test", "Fictional Stale Brand Member", "brand"),
    "O": (f"dashboard.outsider.{RUN_ID}@inflo.test", "Fictional Other Creator", "creator"),
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
user_ids: dict[str, str] = {}
brand_ids: list[str] = []
deal_ids: list[str] = []
named_deals: dict[str, str] = {}
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def management_sql(sql: str):
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {MANAGEMENT_CREDENTIAL}"},
        json={"query": sql}, timeout=120,
    )
    if not response.is_success:
        raise RuntimeError(f"Management SQL failed ({response.status_code}): {response.text[:1600]}")
    return response.json()


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[key][0], "password": PASSWORD})
    return client


def snapshot(viewer: str, **overrides):
    params = {
        "p_viewer": user_ids[viewer], "p_as_of": CLOCK.isoformat(),
        "p_deal_id": None, "p_counterparty_id": None,
        "p_due_from": None, "p_due_to": None,
        "p_bucket": None, "p_state": None, "p_limit": 100, "p_cursor": None,
    }
    params.update(overrides)
    return admin.rpc("payment_dashboard_snapshot", params).execute().data


def create_deal(label: str, creator: str = "C", brand_index: int = 0, brand_actor: str = "B") -> str:
    deal_id = str(uuid4())
    source_id = str(uuid4())
    deal_ids.append(deal_id)
    named_deals[label] = deal_id
    management_sql(f"""
        INSERT INTO public.deals
            (id, creator_id, brand_id, deal_name, deal_type, stage, direction, created_by)
        VALUES ('{deal_id}', '{user_ids[creator]}', '{brand_ids[brand_index]}',
                'Fictional {label} {RUN_ID}', 'campaign', 'payment', 'inbound', '{user_ids[creator]}');
        INSERT INTO public.deal_participants (deal_id, profile_id, participant_role) VALUES
            ('{deal_id}', '{user_ids[creator]}', 'creator'),
            ('{deal_id}', '{user_ids[brand_actor]}', 'brand_admin');
        INSERT INTO public.ai_summaries
            (id, deal_id, raw_output, structured_terms, status)
        VALUES ('{source_id}', '{deal_id}', '{{}}'::jsonb, '{{}}'::jsonb, 'approved');
    """)
    return source_id


def add_single(
    label: str, amount: str, state: str, due: str | None, *, currency: str = "INR",
    receipt_actor: str | None = None, version: int = 1, receipt_version: int | None = None,
) -> str:
    source_id = create_deal(label)
    payment_id = str(uuid4())
    due_sql = f"'{due}'" if due else "NULL"
    pending = "false" if due else "true"
    receipt_version_sql = str(receipt_version if receipt_version is not None else version) if receipt_actor else "NULL"
    receipt_actor_sql = f"'{user_ids[receipt_actor]}'" if receipt_actor else "NULL"
    receipt_at_sql = f"'{CLOCK.isoformat()}'" if receipt_actor else "NULL"
    management_sql(f"""
        INSERT INTO public.payments
            (id, deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by, creator_receipt_version,
             creator_receipt_confirmed_by, creator_receipt_confirmed_at)
        VALUES ('{payment_id}', '{named_deals[label]}', {amount}, '{currency}', 'single', '{state}',
                {due_sql}, '{source_id}', {pending}, {version}, '{user_ids['B']}',
                {receipt_version_sql}, {receipt_actor_sql}, {receipt_at_sql});
    """)
    return payment_id


def add_structured(label: str, structure: str, currency: str, first_state: str, second_state: str) -> None:
    source_id = create_deal(label)
    payment_id = str(uuid4())
    due_one = TODAY.isoformat()
    due_two = (TODAY + timedelta(days=3)).isoformat()
    first_receipt = first_state == "paid_full"
    management_sql(f"""
        INSERT INTO public.payments
            (id, deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by)
        VALUES ('{payment_id}', '{named_deals[label]}', 1000.00, '{currency}', '{structure}',
                'paid_partial', '{due_two}', '{source_id}', false, 1, '{user_ids['B']}');
        INSERT INTO public.payment_milestones
            (payment_id, sequence, trigger_description, amount, due_date, state,
             version, updated_by, updated_at, creator_receipt_version,
             creator_receipt_confirmed_by, creator_receipt_confirmed_at)
        VALUES
            ('{payment_id}', 1, 'Fictional first checkpoint', 400.00, '{due_one}', '{first_state}',
             1, '{user_ids['B']}', '{CLOCK.isoformat()}', {1 if first_receipt else 'NULL'},
             {repr(user_ids['C']) if first_receipt else 'NULL'}, {repr(CLOCK.isoformat()) if first_receipt else 'NULL'}),
            ('{payment_id}', 2, 'Fictional final checkpoint', 600.00, '{due_two}', '{second_state}',
             1, '{user_ids['B']}', '{CLOCK.isoformat()}', NULL, NULL, NULL);
    """)


def assert_unknown_milestone_through_rpc() -> None:
    """Exercise the real projection branch while preserving the locked source schema.

    The current table keeps milestone due dates NOT NULL. PostgreSQL DDL is
    transactional, so this serialized test relaxes that constraint only inside
    one transaction, asserts both RPC responses, and rolls every change back.
    """
    source_id = create_deal("unknown milestone date")
    deal_id = named_deals["unknown milestone date"]
    payment_id = str(uuid4())
    unknown_id = str(uuid4())
    dated_id = str(uuid4())
    management_sql(f"""
        BEGIN;
        ALTER TABLE public.payment_milestones ALTER COLUMN due_date DROP NOT NULL;
        INSERT INTO public.payments
            (id, deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by)
        VALUES ('{payment_id}', '{deal_id}', 1000.00, 'INR', 'milestone', 'paid_partial',
                '{TODAY.isoformat()}', '{source_id}', false, 1, '{user_ids['B']}');
        INSERT INTO public.payment_milestones
            (id, payment_id, sequence, trigger_description, amount, due_date, state,
             version, updated_by, updated_at)
        VALUES
            ('{unknown_id}', '{payment_id}', 1, 'Fictional pending-date checkpoint', 400.00,
             NULL, 'not_paid_in_window', 1, '{user_ids['B']}', '{CLOCK.isoformat()}'),
            ('{dated_id}', '{payment_id}', 2, 'Fictional dated checkpoint', 600.00,
             '{TODAY.isoformat()}', 'not_paid_in_window', 1, '{user_ids['B']}', '{CLOCK.isoformat()}');
        DO $assertions$
        DECLARE
            v_all jsonb;
            v_ranged jsonb;
        BEGIN
            v_all := public.payment_dashboard_snapshot(
                '{user_ids['C']}', '{CLOCK.isoformat()}', '{deal_id}', NULL,
                NULL, NULL, NULL, NULL, 100, NULL
            );
            IF NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_all->'rows') AS item
                 WHERE item->>'obligation_id' = '{unknown_id}'
                   AND item->'due_date' = 'null'::jsonb
                   AND item->>'due_date_pending' = 'true'
                   AND item->>'history_bucket' = 'pending'
            ) THEN
                RAISE EXCEPTION 'UNKNOWN_MILESTONE_NOT_VISIBLE_PENDING';
            END IF;

            v_ranged := public.payment_dashboard_snapshot(
                '{user_ids['C']}', '{CLOCK.isoformat()}', '{deal_id}', NULL,
                '{TODAY.isoformat()}', '{TODAY.isoformat()}', NULL, NULL, 100, NULL
            );
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_ranged->'rows') AS item
                 WHERE item->>'obligation_id' = '{unknown_id}'
            ) THEN
                RAISE EXCEPTION 'UNKNOWN_MILESTONE_SURVIVED_DATE_RANGE';
            END IF;
        END
        $assertions$;
        ROLLBACK;
    """)
    check("real unknown-date milestone is visible and pending through dashboard RPC", True)
    check("real unknown-date milestone is excluded by dashboard RPC date range", True)
    admin.table("deals").delete().eq("id", deal_id).execute()


def setup() -> None:
    management_sql((BACKEND_DIR / "migrations/050_payment_dashboard.sql").read_text())
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
    for name in ("Ledger Studio", "Other Studio"):
        brand_ids.append(admin.table("brands").insert({
            "company_name": f"Fictional {name} {RUN_ID}", "industry": "Testing",
        }).execute().data[0]["id"])
    admin.table("brand_members").insert([
        {"brand_id": brand_ids[0], "profile_id": user_ids["B"], "brand_role": "admin", "status": "active"},
        {"brand_id": brand_ids[0], "profile_id": user_ids["S"], "brand_role": "member", "status": "invited"},
        {"brand_id": brand_ids[1], "profile_id": user_ids["S"], "brand_role": "admin", "status": "active"},
    ]).execute()

    add_single("received", "1000.10", "paid_full", TODAY.isoformat(), receipt_actor="C")
    add_single("brand report", "2000.20", "paid_full", (TODAY + timedelta(days=1)).isoformat())
    add_single("stale receipt", "3000.30", "paid_full", (TODAY + timedelta(days=2)).isoformat(), receipt_actor="C", version=2, receipt_version=1)
    add_single("partial overdue", "40.40", "paid_partial", (TODAY - timedelta(days=1)).isoformat(), currency="USD")
    add_single("bad debt", "5000.50", "bad_debt", (TODAY + timedelta(days=5)).isoformat())
    add_single("disputed", "6000.60", "disputed", (TODAY + timedelta(days=5)).isoformat())
    add_single("refunded pending date", "7000.70", "refunded", None)
    add_structured("milestones", "milestone", "INR", "paid_full", "not_paid_delayed")
    add_structured("combination", "combination", "USD", "not_paid_in_window", "paid_partial")

    foreign_source = create_deal("foreign", creator="O", brand_index=1, brand_actor="S")
    management_sql(f"""
        INSERT INTO public.payments
            (deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by)
        VALUES ('{named_deals['foreign']}', 9999.99, 'INR', 'single', 'bad_debt',
                '{TODAY.isoformat()}', '{foreign_source}', false, 1, '{user_ids['S']}');
    """)


def assert_page_reconciles(page: dict) -> None:
    for total in page["totals"]:
        rows = [row for row in page["rows"] if row["currency"] == total["currency"]]
        amount = sum(int(value["amount"].replace(".", "")) for value in rows)
        received = sum(int(value["amount"].replace(".", "")) for value in rows if value["history_bucket"] == "received")
        check(f"{total['currency']} page obligation total reconciles", amount == int(total["obligation_total"].replace(".", "")))
        check(f"{total['currency']} page received total reconciles", received == int(total["confirmed_received"].replace(".", "")))
        check(f"{total['currency']} page count reconciles", len(rows) == total["obligation_count"])


def expect_api_error(label: str, call) -> None:
    try:
        call()
    except APIError:
        check(label, True)
    else:
        check(label, False)


def run_checks() -> None:
    creator = snapshot("C")
    check("creator viewer kind is derived server-side", creator["viewer_kind"] == "creator")
    check("creator sees each canonical obligation once", len(creator["rows"]) == 11 and len({row["obligation_id"] for row in creator["rows"]}) == 11)
    check("foreign deal is excluded from creator ledger", named_deals["foreign"] not in {row["deal_id"] for row in creator["rows"]})
    check("receipt facts are strict booleans without actor ids", all(isinstance(row["creator_receipt_confirmed"], bool) and "creator_receipt_confirmed_by" not in row for row in creator["rows"]))
    check("single and milestone structures do not double-count", sum(row["deal_id"] == named_deals["milestones"] for row in creator["rows"]) == 2 and sum(row["deal_id"] == named_deals["combination"] for row in creator["rows"]) == 2)
    buckets = {row["deal_name"]: row["history_bucket"] for row in creator["rows"] if row["item_kind"] == "single"}
    check("current creator evidence is received", buckets[f"Fictional received {RUN_ID}"] == "received")
    check("brand-only report is not received", buckets[f"Fictional brand report {RUN_ID}"] == "pending")
    check("stale receipt evidence is not received", buckets[f"Fictional stale receipt {RUN_ID}"] == "pending")
    check("past partial is overdue without fabricated receipt", buckets[f"Fictional partial overdue {RUN_ID}"] == "overdue")
    check("explicit bad debt sorts first", creator["rows"][0]["history_bucket"] == "bad_debt")
    check("disputed and refunded remain truthful", {row["canonical_state"] for row in creator["rows"]} >= {"disputed", "refunded"} and all(row["history_bucket"] != "received" for row in creator["rows"] if row["canonical_state"] in {"disputed", "refunded"}))
    check("unknown due date is visible without a range", any(row["due_date_pending"] for row in creator["rows"]))
    assert_unknown_milestone_through_rpc()
    assert_page_reconciles(creator)

    ranged = snapshot("C", p_due_from=TODAY.isoformat(), p_due_to=TODAY.isoformat())
    check("inclusive UTC date range includes boundary", all(row["due_date"] == TODAY.isoformat() for row in ranged["rows"]))
    check("date range excludes unknown due dates", all(not row["due_date_pending"] for row in ranged["rows"]))
    received = snapshot("C", p_bucket="received")
    check("received shortcut is enforced server-side", received["rows"] and all(row["history_bucket"] == "received" for row in received["rows"]))
    disputed = snapshot("C", p_state="disputed")
    check("canonical state filter preserves disputed truth", len(disputed["rows"]) == 1 and disputed["rows"][0]["canonical_state"] == "disputed")
    by_deal = snapshot("C", p_deal_id=named_deals["combination"])
    check("source-deal filter and deep-link ids are exact", len(by_deal["rows"]) == 2 and all(row["source_deal_id"] == named_deals["combination"] for row in by_deal["rows"]))
    by_counterparty = snapshot("C", p_counterparty_id=brand_ids[0])
    check("counterparty filter is server-side", len(by_counterparty["rows"]) == 11)

    brand_page = snapshot("B")
    check("brand viewer requires current participation", brand_page["viewer_kind"] == "brand" and len(brand_page["rows"]) == 11)
    stale_page = snapshot("S")
    check("inactive cross-brand participant sees no first-brand rows", len(stale_page["rows"]) == 1 and stale_page["rows"][0]["deal_id"] == named_deals["foreign"])
    outsider_page = snapshot("O")
    check("privacy holds both ways", len(outsider_page["rows"]) == 1 and outsider_page["rows"][0]["deal_id"] == named_deals["foreign"])
    admin.table("brand_members").update({"status": "invited"}).eq("brand_id", brand_ids[0]).eq("profile_id", user_ids["B"]).execute()
    check("active membership loss removes brand access", snapshot("B")["rows"] == [])
    admin.table("brand_members").update({"status": "active"}).eq("brand_id", brand_ids[0]).eq("profile_id", user_ids["B"]).execute()

    paged_ids: list[str] = []
    cursor = None
    pages = 0
    while True:
        page = snapshot("C", p_limit=2, p_cursor=cursor)
        pages += 1
        assert_page_reconciles(page)
        paged_ids.extend(row["obligation_id"] for row in page["rows"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    check("stable pagination covers first middle and final pages", pages >= 6)
    check("pagination has no duplicates or skips", paged_ids == [row["obligation_id"] for row in creator["rows"]])

    terminal_cursor = None
    while True:
        terminal = snapshot("C", p_bucket="received", p_limit=1, p_cursor=terminal_cursor)
        if terminal["rows"] == []:
            break
        terminal_cursor = terminal["next_cursor"]
        if terminal_cursor is None:
            break
    check("exact-multiple pagination returns an empty terminal page", terminal["rows"] == [] and terminal["next_cursor"] is None)
    expect_api_error("cursor is rejected outside its filter context", lambda: snapshot("C", p_limit=2, p_bucket="pending", p_cursor=snapshot("C", p_limit=2)["next_cursor"]))
    expect_api_error("invalid filter combinations fail closed", lambda: snapshot("C", p_bucket="received", p_state="disputed"))
    expect_api_error("invalid limits fail closed", lambda: snapshot("C", p_limit=101))
    expect_api_error("malformed cursors fail closed", lambda: snapshot("C", p_cursor="not-a-cursor"))

    create_deal("invalid source")
    wrong_source = admin.table("ai_summaries").select("id").eq("deal_id", named_deals["received"]).single().execute().data["id"]
    management_sql(f"""
        INSERT INTO public.payments
            (deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by)
        VALUES ('{named_deals['invalid source']}', 123.45, 'INR', 'single', 'not_paid_in_window',
                '{TODAY.isoformat()}', '{wrong_source}', false, 1, '{user_ids['B']}');
    """)
    expect_api_error("cross-deal canonical sources fail the ledger closed", lambda: snapshot("C"))
    admin.table("deals").delete().eq("id", named_deals["invalid source"]).execute()

    anonymous = create_client(SUPABASE_URL, ANON_KEY)
    expect_api_error("anonymous caller cannot execute dashboard", lambda: anonymous.rpc("get_payment_dashboard", {}).execute())
    creator_client = auth_client("C")
    expect_api_error("authenticated caller cannot execute service helper", lambda: creator_client.rpc("payment_dashboard_snapshot", {"p_viewer": user_ids["O"], "p_as_of": CLOCK.isoformat()}).execute())
    try:
        creator_client.rpc("get_payment_dashboard", {"p_limit": None}).execute()
    except APIError as exc:
        check("authenticated null limit fails generically without an oversized page", "PAYMENT_DASHBOARD_INVALID_REQUEST" in str(exc))
    else:
        check("authenticated null limit fails generically without an oversized page", False)
    auth_rows = creator_client.rpc("get_payment_dashboard", {"p_limit": 100}).execute().data["rows"]
    check("authenticated wrapper derives identity from auth uid", len(auth_rows) == 11 and named_deals["foreign"] not in {row["deal_id"] for row in auth_rows})


def cleanup() -> None:
    if deal_ids:
        admin.table("deals").delete().in_("id", deal_ids).execute()
    if brand_ids:
        admin.table("brands").delete().in_("id", brand_ids).execute()
    for user_id in user_ids.values():
        try:
            admin.auth.admin.delete_user(user_id)
        except Exception as exc:  # pragma: no cover - cleanup must keep trying
            print(f"Cleanup warning for fictional user: {type(exc).__name__}")


def verify_cleanup() -> None:
    if deal_ids:
        check("all fictional deals were cleaned", not admin.table("deals").select("id").in_("id", deal_ids).execute().data)
    if brand_ids:
        check("all fictional brands were cleaned", not admin.table("brands").select("id").in_("id", brand_ids).execute().data)


if __name__ == "__main__":
    failure: Exception | None = None
    try:
        setup()
        run_checks()
    except Exception as exc:
        failure = exc
        print(f"FAIL - unexpected exception: {type(exc).__name__}: {exc}")
    finally:
        cleanup()
        verify_cleanup()
    passed = sum(result for _, result in checks)
    print(f"\n{passed}/{len(checks)} payment dashboard checks passed")
    if failure or passed != len(checks):
        raise SystemExit(1)
