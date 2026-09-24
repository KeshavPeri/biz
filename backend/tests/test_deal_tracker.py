"""Development-Supabase acceptance checks for workplan 11.1-A.

Uses run-unique fictional users/deals, a fixed helper clock for boundary proofs,
and removes every fixture in ``finally``. Migration 048 is applied first.
"""

from __future__ import annotations

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
load_dotenv(BACKEND_DIR.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Tracker-{RUN_ID}-Fictional!"
CLOCK = "2026-09-24T12:00:00+00:00"
USERS = {
    "C": (f"tracker.creator.{RUN_ID}@inflo.test", "Fictional Tracker Creator", "creator"),
    "B": (f"tracker.admin.{RUN_ID}@inflo.test", "Fictional Tracker Admin", "brand"),
    "M": (f"tracker.maker.{RUN_ID}@inflo.test", "Fictional Tracker Maker", "brand"),
    "I": (f"tracker.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Member", "brand"),
    "O": (f"tracker.outsider.{RUN_ID}@inflo.test", "Fictional Tracker Outsider", "creator"),
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
user_ids: dict[str, str] = {}
deal_ids: dict[str, str] = {}
brand_id: str | None = None
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
        raise RuntimeError(f"Management SQL failed ({response.status_code}): {response.text[:1000]}")
    return response.json()


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[key][0], "password": PASSWORD})
    return client


def uid() -> str:
    return str(uuid4())


def deal(name: str, stage: str, direction: str = "inbound", *, deleted: bool = False,
         disputed: bool = False, expires_at: str | None = None) -> str:
    deal_id = uid()
    deal_ids[name] = deal_id
    deleted_sql = "'2026-09-23T00:00:00Z'" if deleted else "NULL"
    expires_sql = f"'{expires_at}'::timestamptz" if expires_at else "NULL"
    management_sql(f"""
        INSERT INTO public.deals
            (id, creator_id, brand_id, deal_name, deal_type, stage, is_disputed,
             direction, created_by, created_at, updated_at, deleted_at, expires_at)
        VALUES
            ('{deal_id}', '{user_ids['C']}', '{brand_id}', 'Fictional {name}',
             'campaign', '{stage}', {str(disputed).lower()}, '{direction}',
             '{user_ids['C']}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z',
             {deleted_sql}, {expires_sql});
        INSERT INTO public.deal_participants (deal_id, profile_id, participant_role) VALUES
            ('{deal_id}', '{user_ids['C']}', 'creator'),
            ('{deal_id}', '{user_ids['B']}', 'brand_admin'),
            ('{deal_id}', '{user_ids['M']}', 'brand_maker'),
            ('{deal_id}', '{user_ids['I']}', 'brand_checker');
    """)
    return deal_id


def canonical_summary(deal_id: str) -> str:
    summary_id = uid()
    management_sql(f"""
        INSERT INTO public.ai_summaries
            (id, deal_id, raw_output, structured_terms, status, generated_at)
        VALUES ('{summary_id}', '{deal_id}', '{{}}'::jsonb, '{{}}'::jsonb,
                'approved', '2026-09-01T00:00:00Z');
    """)
    return summary_id


def deliverable(deal_id: str, due: str | None, status: str = "pending") -> str:
    summary_id = canonical_summary(deal_id)
    deliverable_id = uid()
    due_sql = f"'{due}'::date" if due else "NULL"
    window_start = "NULL" if due else "'2026-10-01'::date"
    window_end = "NULL" if due else "'2026-10-02'::date"
    management_sql(f"""
        INSERT INTO public.deliverables
            (id, deal_id, sequence, content_format, platform, posting_date,
             posting_window_start, posting_window_end, revision_max, revision_current,
             status, source_summary_id)
        VALUES ('{deliverable_id}', '{deal_id}', 1, 'reel', 'instagram', {due_sql},
                {window_start}, {window_end}, 2, 0, '{status}', '{summary_id}');
    """)
    return summary_id


def payment(deal_id: str, due: str, state: str = "not_paid_in_window",
            structure: str = "single") -> tuple[str, str]:
    summary_id = canonical_summary(deal_id)
    payment_id = uid()
    management_sql(f"""
        INSERT INTO public.payments
            (id, deal_id, amount, currency, structure, state, due_date, source_summary_id,
             due_date_pending, version, updated_by, updated_at)
        VALUES ('{payment_id}', '{deal_id}', 1000, 'INR', '{structure}', '{state}',
                '{due}', '{summary_id}', false, 1, '{user_ids['B']}', '{CLOCK}');
    """)
    return payment_id, summary_id


def setup() -> None:
    global brand_id
    management_sql((BACKEND_DIR / "migrations/048_deal_tracker_projection.sql").read_text())
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
    brand_id = admin.table("brands").insert({
        "company_name": f"Fictional Tracker Brand {RUN_ID}", "industry": "Testing",
    }).execute().data[0]["id"]
    admin.table("brand_members").insert([
        {"brand_id": brand_id, "profile_id": user_ids["B"], "brand_role": "admin", "status": "active"},
        {"brand_id": brand_id, "profile_id": user_ids["M"], "brand_role": "member", "status": "active"},
        {"brand_id": brand_id, "profile_id": user_ids["I"], "brand_role": "member", "status": "invited"},
    ]).execute()

    disputed = deal("Red disputed", "payment", disputed=True)
    disputed_payment, _ = payment(disputed, "2026-10-10", "disputed")
    deliverable(disputed, "2026-10-01", "posted")
    management_sql(f"""
        INSERT INTO public.disputes (deal_id, raised_by, description, status, created_at)
        VALUES ('{disputed}', '{user_ids['C']}', 'Fictional tracker dispute', 'open', '2026-09-24T10:00:00Z');
    """)
    assert disputed_payment

    delayed = deal("Red delayed payment", "payment", "outbound")
    payment(delayed, "2026-10-10", "not_paid_delayed")
    deliverable(delayed, "2026-10-01", "posted")

    overdue = deal("Red payment boundary", "payment")
    payment(overdue, "2026-09-21")
    deliverable(overdue, "2026-10-01", "posted")
    management_sql(f"""
        INSERT INTO public.deal_summary_gates
            (deal_id, request_status, requested_by, requester_side, requested_at, updated_at)
        VALUES ('{overdue}', 'awaiting_confirmation', '{user_ids['C']}', 'creator',
                '2026-09-23T12:00:00Z', '2026-09-23T12:00:00Z');
    """)

    overdue_deliverable = deal("Red deliverable", "creating", "outbound")
    deliverable(overdue_deliverable, "2026-09-23")

    confirm_red = deal("Red confirmation boundary", "chatting")
    management_sql(f"""
        INSERT INTO public.deal_summary_gates
            (deal_id, request_status, requested_by, requester_side, requested_at, updated_at)
        VALUES ('{confirm_red}', 'awaiting_confirmation', '{user_ids['C']}', 'creator',
                '2026-09-22T12:00:00Z', '2026-09-22T12:00:00Z');
    """)

    deal("Red expired connection", "pending", "outbound", expires_at=CLOCK)
    red_integrity = deal("Red integrity", "payment")
    deliverable(red_integrity, "2026-10-01", "posted")

    confirm_amber = deal("Amber confirmation boundary", "chatting", "outbound")
    management_sql(f"""
        INSERT INTO public.deal_summary_gates
            (deal_id, request_status, requested_by, requester_side, requested_at, updated_at)
        VALUES ('{confirm_amber}', 'awaiting_confirmation', '{user_ids['C']}', 'creator',
                '2026-09-23T12:00:00Z', '2026-09-23T12:00:00Z');
    """)
    due_deliverable = deal("Amber deliverable", "creating")
    deliverable(due_deliverable, "2026-09-26")
    due_payment = deal("Amber payment boundary", "payment", "outbound")
    payment(due_payment, "2026-09-27")
    deliverable(due_payment, "2026-10-01", "posted")
    deal("Amber expiring connection", "pending", expires_at="2026-09-25T00:00:00Z")

    structured = deal("Amber milestone", "payment", "outbound")
    payment_id, summary_id = payment(structured, "2026-10-01", "paid_partial", "milestone")
    management_sql(f"""
        INSERT INTO public.payment_milestones
            (payment_id, sequence, trigger_description, amount, due_date, state,
             version, updated_by, updated_at)
        VALUES
            ('{payment_id}', 1, 'Fictional first milestone', 500, '2026-09-24', 'paid_full', 1, '{user_ids['B']}', '{CLOCK}'),
            ('{payment_id}', 2, 'Fictional second milestone', 500, '2026-09-27', 'not_paid_in_window', 1, '{user_ids['B']}', '{CLOCK}');
        INSERT INTO public.deliverables
            (deal_id, sequence, content_format, platform, posting_date, revision_max,
             revision_current, status, source_summary_id)
        VALUES ('{structured}', 1, 'reel', 'instagram', '2026-10-03', 2, 0, 'posted', '{summary_id}');
    """)

    deal("Green no deadline", "chatting")
    paid = deal("Green paid", "payment", "outbound")
    payment(paid, "2026-09-24", "refunded")
    deliverable(paid, "2026-09-20", "posted")
    deal("Closed omitted", "closed")
    deal("Deleted omitted", "chatting", deleted=True)


def run_checks() -> None:
    creator = auth_client("C")
    brand = auth_client("B")
    maker = auth_client("M")
    inactive = auth_client("I")
    outsider = auth_client("O")
    deterministic = admin.rpc(
        "deal_tracker_snapshot", {"p_viewer": user_ids["C"], "p_as_of": CLOCK}
    ).execute().data
    rows = deterministic["deals"]
    by_name = {row["name"].removeprefix("Fictional "): row for row in rows}

    check("one bounded row per active deal despite multiple participants", len(rows) == 14)
    check("terminal and soft-deleted deals are absent", "Closed omitted" not in by_name and "Deleted omitted" not in by_name)
    check("red conditions and exact 48h/three-day boundaries", all(by_name[name]["status"] == "red" for name in [
        "Red disputed", "Red delayed payment", "Red payment boundary", "Red deliverable",
        "Red confirmation boundary", "Red expired connection", "Red integrity",
    ]))
    check("stable red reason codes cover every red rule", {
        by_name[name]["reason_code"] for name in by_name if name.startswith("Red ")
    } == {"payment_disputed", "payment_overdue", "deliverable_overdue", "confirmation_overdue", "connection_expired", "needs_attention"})
    check("red precedence beats a younger amber confirmation", by_name["Red payment boundary"]["reason_code"] == "payment_overdue")
    check("amber conditions and exact 12h/24h/+2d/+3d boundaries", all(by_name[name]["status"] == "amber" for name in [
        "Amber confirmation boundary", "Amber deliverable", "Amber payment boundary", "Amber expiring connection", "Amber milestone",
    ]))
    check("green fallback includes null and settled deadlines", by_name["Green no deadline"]["status"] == "green" and by_name["Green paid"]["status"] == "green")
    check("milestones replace aggregate obligation and settled items are excluded", deterministic["summary"]["payments_due_this_week"] == 2)
    check("dashboard arithmetic reconciles", deterministic["summary"] == {
        "active_deals": 14, "action_needed": 7, "payments_due_this_week": 2,
        "next_deadline": "2026-09-26", "overdue_deliverables": 1,
        "inbound_deals": 7, "outbound_deals": 7,
    })
    check("single server clock is returned exactly", deterministic["as_of"] == CLOCK)
    check("default order is red, amber, green with deterministic deadline/name ties", [
        {"red": 0, "amber": 1, "green": 2}[row["status"]] for row in rows
    ] == sorted({"red": 0, "amber": 1, "green": 2}[row["status"]] for row in rows))
    allowed_root = {"version", "as_of", "summary", "deals"}
    allowed_row = {"id", "name", "status", "reason_code", "reason_label", "relevant_at", "next_deadline", "stage", "deal_type", "direction", "created_at"}
    check("projection is versioned and contains only bounded display keys", set(deterministic) == allowed_root and all(set(row) == allowed_row for row in rows))

    creator_public = creator.rpc("get_deal_tracker").execute().data
    check("authenticated creator wrapper derives its viewer", creator_public["summary"]["active_deals"] == 14)
    check("active brand participants receive the same deduplicated deals", brand.rpc("get_deal_tracker").execute().data["summary"]["active_deals"] == 14 and maker.rpc("get_deal_tracker").execute().data["summary"]["active_deals"] == 14)
    check("outsider and inactive stale brand membership receive no deals", outsider.rpc("get_deal_tracker").execute().data["deals"] == [] and inactive.rpc("get_deal_tracker").execute().data["deals"] == [])

    denied_helper = denied_actor = denied_anon = False
    try:
        creator.rpc("deal_tracker_snapshot", {"p_viewer": user_ids["O"], "p_as_of": CLOCK}).execute()
    except APIError:
        denied_helper = True
    try:
        creator.rpc("get_deal_tracker", {"p_viewer": user_ids["O"]}).execute()
    except APIError:
        denied_actor = True
    try:
        create_client(SUPABASE_URL, ANON_KEY).rpc("get_deal_tracker").execute()
    except APIError:
        denied_anon = True
    check("authenticated callers cannot invoke the actor-controlled helper", denied_helper)
    check("public wrapper accepts no caller-controlled actor", denied_actor)
    check("anonymous execution is revoked", denied_anon)

    grants = management_sql("""
        SELECT routine_name, grantee
          FROM information_schema.routine_privileges
         WHERE specific_schema = 'public'
           AND routine_name IN ('get_deal_tracker', 'deal_tracker_snapshot')
           AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
         ORDER BY routine_name, grantee;
    """)
    grant_pairs = {(row["routine_name"], row["grantee"]) for row in grants}
    check("grants expose only wrapper to authenticated and helper to service_role", grant_pairs == {
        ("get_deal_tracker", "authenticated"), ("deal_tracker_snapshot", "service_role"),
    })


def cleanup() -> None:
    if deal_ids:
        management_sql("DELETE FROM public.deals WHERE id IN (" + ",".join(f"'{value}'" for value in deal_ids.values()) + ");")
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in user_ids.values():
        admin.auth.admin.delete_user(user_id)


def verify_cleanup() -> None:
    if not deal_ids:
        return
    count = management_sql("SELECT count(*)::integer AS count FROM public.deals WHERE id IN (" + ",".join(f"'{value}'" for value in deal_ids.values()) + ");")[0]["count"]
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
