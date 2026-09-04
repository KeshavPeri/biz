"""Development-Supabase/API coverage for workplan 9.16-A payment disputes."""

from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services.dispute_service import (  # noqa: E402
    _PUBLIC_DNS_NAME_LIMIT,
    _PUBLIC_TEXT_INPUT_LIMIT,
    _public_text,
)


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Dispute-{RUN_ID}-Fictional!"
REPORTED_PRIVATE_VALUES = (
    "123server:5432/private",
    "user@localhost",
    "user@internalbox",
    "//internalbox/private",
    "::ffff:10.24.18.9",
)
USERS = {
    "C": (f"dispute.creator.{RUN_ID}@inflo.test", "Fictional Dispute Creator", "creator"),
    "B": (f"dispute.admin.{RUN_ID}@inflo.test", "Fictional Dispute Admin", "brand"),
    "M": (f"dispute.maker.{RUN_ID}@inflo.test", "Fictional Dispute Maker", "brand"),
    "K": (f"dispute.checker.{RUN_ID}@inflo.test", "Fictional Dispute Checker", "brand"),
    "I": (f"dispute.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Checker", "brand"),
    "O": (f"dispute.outsider.{RUN_ID}@inflo.test", "Fictional Dispute Outsider", "brand"),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
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
        timeout=60,
    )
    if not response.is_success:
        raise RuntimeError(f"Management SQL failed ({response.status_code})")
    return response.json()


def call(method: str, path: str, actor: str, payload: object | None = None):
    return api.request(
        method,
        path,
        headers={"Authorization": f"Bearer {tokens[actor]}"},
        json=payload,
    )


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[actor][0], "password": PASSWORD})
    return client


def make_deal(label: str, *, stage: str = "payment", structured: bool = False) -> dict[str, str]:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"],
        "brand_id": brand_id,
        "deal_name": f"Fictional dispute {label} {RUN_ID}",
        "direction": "inbound",
        "created_by": ids["B"],
        "stage": stage,
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["M"], "participant_role": "brand_maker"},
        {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
        {"deal_id": deal_id, "profile_id": ids["I"], "participant_role": "brand_checker"},
    ]).execute()
    summary_id = admin.table("ai_summaries").insert({
        "deal_id": deal_id,
        "raw_output": {"source": "fictional dispute fixture"},
        "structured_terms": {},
        "status": "approved",
    }).execute().data[0]["id"]
    structure = "milestone" if structured else "single"
    payment_id = admin.table("payments").insert({
        "deal_id": deal_id,
        "source_summary_id": summary_id,
        "amount": "84000",
        "currency": "INR",
        "structure": structure,
        "state": "paid_partial",
        "due_date_pending": False,
        "version": 3,
        "updated_by": ids["B"],
    }).execute().data[0]["id"]
    milestone_id = ""
    if structured:
        milestone_id = admin.table("payment_milestones").insert({
            "payment_id": payment_id,
            "sequence": 1,
            "trigger_description": "Fictional deliverable accepted",
            "amount": "84000",
            "due_date": "2026-09-30",
            "state": "paid_partial",
            "version": 2,
            "updated_by": ids["B"],
            "updated_at": "2026-09-02T00:00:00+00:00",
        }).execute().data[0]["id"]
    message_id = admin.table("messages").insert({
        "deal_id": deal_id,
        "sender_id": ids["C"],
        "body": "Fictional payment follow-up confirming the agreed transfer window.",
    }).execute().data[0]["id"]
    return {
        "deal_id": deal_id,
        "summary_id": summary_id,
        "payment_id": payment_id,
        "milestone_id": milestone_id,
        "message_id": message_id,
    }


def add_live_post(deal: dict[str, str]) -> str:
    row = management_sql(
        "INSERT INTO public.deliverables "
        "(deal_id,sequence,content_format,platform,posting_date,revision_max,revision_current,status,source_summary_id) "
        f"VALUES ('{deal['deal_id']}',1,'reel','instagram','2026-09-01',1,0,'posted','{deal['summary_id']}') "
        "RETURNING id"
    )[0]
    deliverable_id = row["id"]
    submission = management_sql(
        "INSERT INTO public.live_post_submissions "
        "(deliverable_id,version,submitted_url,final_url,final_host,preview_title,status,submitted_by,confirmed_by,confirmed_at) "
        f"VALUES ('{deliverable_id}',1,'https://example.test/fictional','https://example.test/fictional',"
        f"'example.test','Fictional campaign proof','confirmed','{ids['C']}','{ids['B']}',now()) RETURNING id"
    )[0]
    management_sql(
        f"UPDATE public.deliverables SET current_live_post_submission_id='{submission['id']}' WHERE id='{deliverable_id}'"
    )
    return submission["id"]


def artifact_counts(deal_id: str) -> dict[str, int]:
    audit = admin.table("audit_log").select("id", count="exact").eq("entity_type", "dispute").eq(
        "metadata->>deal_id", deal_id
    ).execute()
    return {
        "disputes": admin.table("disputes").select("id", count="exact").eq("deal_id", deal_id).execute().count or 0,
        "notifications": admin.table("notifications").select("id", count="exact").eq("deal_id", deal_id).execute().count or 0,
        "audits": audit.count or 0,
    }


def cleanup() -> None:
    print("\nCleaning up fictional dispute data...")
    if deal_ids:
        quoted_deals = ",".join(f"'{value}'" for value in deal_ids)
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.audit_log WHERE metadata->>'deal_id' IN ({quoted_deals}); "
            "SET session_replication_role = origin; "
            f"DELETE FROM public.notifications WHERE deal_id IN ({quoted_deals});"
        )
        for deal_id in deal_ids:
            admin.table("deals").delete().eq("id", deal_id).execute()
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values():
        admin.auth.admin.delete_user(user_id)
    print("  cleanup complete")


def main() -> None:
    global brand_id
    try:
        safe_prefix = "Ordinary safe payment discussion remains"
        dotted_host_pathology = ("a." * 5_000) + "1"
        evidence_pathology = [
            _public_text(
                f"{safe_prefix} evidence {index}: {dotted_host_pathology}",
                "fallback",
                160,
            )
            for index in range(10)
        ]
        html_pathology = _public_text(safe_prefix + " " + "<" * 10_000, "fallback", 20_000)
        check(
            "pathological public text processing is structurally bounded and preserves safe text",
            len(evidence_pathology) == 10
            and len(dotted_host_pathology) > _PUBLIC_TEXT_INPUT_LIMIT > _PUBLIC_DNS_NAME_LIMIT
            and all(safe_prefix in result and len(result) <= 160 for result in evidence_pathology)
            and safe_prefix in html_pathology
            and len(html_pathology) <= _PUBLIC_TEXT_INPUT_LIMIT,
        )
        mapped_and_relative = _public_text(
            "Ordinary safe note //internalbox/private ::ffff:10.24.18.9 remains readable",
            "fallback",
            200,
        )
        check(
            "protocol-relative and IPv4-mapped IPv6 tokens are completely removed",
            mapped_and_relative
            == "Ordinary safe note [link removed] [link removed] remains readable",
        )
        scheme_32 = "a" * 32 + "://internalbox/private"
        scheme_33 = "a" * 33 + "://internalbox/private"
        scheme_boundary = _public_text(
            f"Ordinary safe schemes {scheme_32} {scheme_33} remain private",
            "fallback",
            300,
        )
        longest_bounded_scheme = _public_text(
            "a" * (_PUBLIC_TEXT_INPUT_LIMIT - 3) + "://",
            "fallback",
            200,
        )
        check(
            "arbitrary URI schemes are removed across the 32/33 boundary and full input bound",
            scheme_boundary
            == "Ordinary safe schemes [link removed] [link removed] remain private"
            and longest_bounded_scheme == "[link removed]",
        )

        for key, (email, display_name, account_type) in USERS.items():
            user = admin.auth.admin.create_user({
                "email": email,
                "password": PASSWORD,
                "email_confirm": True,
            }).user
            ids[key] = user.id
            admin.table("profiles").insert({
                "id": user.id,
                "account_type": account_type,
                "display_name": display_name,
                "email": email,
            }).execute()
            signed_in = create_client(SUPABASE_URL, ANON_KEY).auth.sign_in_with_password({
                "email": email,
                "password": PASSWORD,
            })
            tokens[key] = signed_in.session.access_token

        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Dispute Brand {RUN_ID}",
            "industry": "Test campaigns",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids[key], "brand_role": "admin" if key == "B" else "member", "status": status}
            for key, status in (("B", "active"), ("M", "active"), ("K", "active"), ("I", "invited"), ("O", "active"))
        ]).execute()

        pre_payment = make_deal("pre-payment", stage="posted")
        pre_read = call("GET", f"/deals/{pre_payment['deal_id']}/disputes", "C")
        check("authorized pre-Payment read is stable and unavailable", pre_read.status_code == 200 and pre_read.json()["reason"] == "not_yet_available")
        check("wrong-stage raise creates no artifacts", call(
            "POST", f"/deals/{pre_payment['deal_id']}/disputes", "C", {"description": "Fictional payment issue description."}
        ).status_code == 409 and artifact_counts(pre_payment["deal_id"]) == {"disputes": 0, "notifications": 0, "audits": 0})

        main_deal = make_deal("message-and-live-proof", structured=True)
        live_id = add_live_post(main_deal)
        admin.table("messages").update({
            "body": (
                "<b>Fictional payment proof</b> https://messages.private.internal/path?token=fixture "
                "user@corp.internal [2001:db8::25]:8443 localhost:3000 internalbox:9090 "
                "123server:5432/private user@localhost user@internalbox "
                "//internalbox/private ::ffff:10.24.18.9"
            ),
        }).eq("id", main_deal["message_id"]).execute()
        admin.table("profiles").update({
            "display_name": (
                "<b>Fictional Dispute Checker</b> checker@corp.internal "
                "[fd00::25]:9443 localhost:4000 123server:5432/private "
                "user@localhost user@internalbox //internalbox/private ::ffff:10.24.18.9"
            ),
        }).eq("id", ids["K"]).execute()
        management_sql(
            "UPDATE public.live_post_submissions SET "
            "preview_title='<img src=x>NEVER_EXPOSE_PREVIEW_TITLE https://preview.private.internal/item',"
            "preview_site_name='NEVER_EXPOSE_PREVIEW_SITE 10.24.18.9:8443',"
            "preview_description='NEVER_EXPOSE_PREVIEW_DESCRIPTION data:text/html,<script>private preview</script>' "
            f"WHERE id='{live_id}'"
        )
        creator_actions = call("GET", f"/deals/{main_deal['deal_id']}/disputes", "C").json()["allowed_actions"]
        checker_actions = call("GET", f"/deals/{main_deal['deal_id']}/disputes", "K").json()["allowed_actions"]
        check("server-derived raise actions match active participant roles", creator_actions == {"can_raise": True, "can_resolve": False} and checker_actions == creator_actions)
        outsider = call(
            "POST",
            f"/deals/{main_deal['deal_id']}/disputes",
            "O",
            {"description": "bad", "evidence": [{"kind": "message", "id": str(uuid4())}]},
        )
        check("outsider receives non-leaking response before evidence errors", outsider.status_code == 404)
        check("outsider failure creates no artifacts", artifact_counts(main_deal["deal_id"]) == {"disputes": 0, "notifications": 0, "audits": 0})

        inactive = call(
            "POST", f"/deals/{main_deal['deal_id']}/disputes", "I", {"description": "Fictional inactive member payment concern."}
        )
        inactive_read = call("GET", f"/deals/{main_deal['deal_id']}/disputes", "I")
        check("stale inactive participant receives non-leaking read/write denials", inactive.status_code == 404 and inactive_read.status_code == 404 and artifact_counts(main_deal["deal_id"]) == {"disputes": 0, "notifications": 0, "audits": 0})

        malformed_payloads = [
            {"description": "short"},
            {"description": "Fictional concern\nwith control text."},
            {"description": "Fictional <b>raw HTML</b> payment concern."},
            {"description": "Fictional external proof https://example.test/hidden"},
            {"description": "Fictional bounded payment concern.", "extra": True},
            {"description": "Fictional bounded payment concern.", "evidence": [{"kind": "message", "id": main_deal["message_id"]}] * 2},
            {"description": "Fictional bounded payment concern.", "evidence": [{"kind": "file", "id": main_deal["message_id"]}]},
        ]
        for index, payload in enumerate(malformed_payloads, 1):
            response = call("POST", f"/deals/{main_deal['deal_id']}/disputes", "C", payload)
            check(f"malformed request {index} is rejected without artifacts", response.status_code == 422 and artifact_counts(main_deal["deal_id"])["disputes"] == 0)

        other_deal = make_deal("cross-deal-evidence")
        cross_message = call(
            "POST",
            f"/deals/{main_deal['deal_id']}/disputes",
            "C",
            {"description": "Fictional cross-deal message concern.", "evidence": [{"kind": "message", "id": other_deal["message_id"]}]},
        )
        check("cross-deal message evidence is rejected", cross_message.status_code == 422)
        cross_live_id = add_live_post(other_deal)
        cross_live = call(
            "POST",
            f"/deals/{main_deal['deal_id']}/disputes",
            "C",
            {"description": "Fictional cross-deal live-post concern.", "evidence": [{"kind": "live_post", "id": cross_live_id}]},
        )
        check("cross-deal live-post evidence is rejected", cross_live.status_code == 422)

        before_milestone = admin.table("payment_milestones").select("state,version,creator_receipt_version").eq(
            "id", main_deal["milestone_id"]
        ).single().execute().data
        before_payment = admin.table("payments").select("version,amount,currency,structure").eq(
            "id", main_deal["payment_id"]
        ).single().execute().data
        transition_count = admin.table("deal_stage_transitions").select("id", count="exact").eq(
            "deal_id", main_deal["deal_id"]
        ).execute().count or 0
        payload = {
            "description": (
                "  Fictional transfer remains unmatched for user@corp.internal via "
                "[2001:db8::45]:8443, localhost:3000, settlementbox:9090, "
                "123server:5432/private, user@localhost, user@internalbox, "
                "//internalbox/private and ::ffff:10.24.18.9.  "
            ),
            "evidence": [
                {"kind": "message", "id": main_deal["message_id"]},
                {"kind": "live_post", "id": live_id},
            ],
        }
        opened = call("POST", f"/deals/{main_deal['deal_id']}/disputes", "K", payload)
        opened_json = opened.json()
        opened_ok = opened.status_code == 200 and opened_json.get("outcome", {}).get("opened") is True
        check("active checker can atomically raise a dispute", opened_ok)
        if not opened_ok:
            raise RuntimeError(f"Checker raise failed with status {opened.status_code}")
        check("safe response exposes narrative and bounded snippets", opened_json["current_open"]["description"].startswith("Fictional") and all(len(item["snippet"]) <= 160 for item in opened_json["current_open"]["evidence"]))
        opened_evidence = {
            item["kind"]: item["snippet"] for item in opened_json["current_open"]["evidence"]
        }
        current_safe_surfaces = (
            opened_json["current_open"]["description"],
            opened_json["current_open"]["raised_by"]["display_name"],
            opened_evidence["message"],
        )
        check(
            "reported private values are removed from every current participant-safe text surface",
            all(
                not any(secret in surface for secret in REPORTED_PRIVATE_VALUES)
                for surface in current_safe_surfaces
            )
            and all(
                safe in surface
                for safe, surface in zip(
                    ("Fictional transfer", "Fictional Dispute Checker", "Fictional payment proof"),
                    current_safe_surfaces,
                )
            ),
        )
        public_json = json.dumps(opened_json)
        check("safe response excludes hidden provenance, HTML, URLs and preview/network metadata", not any(secret in public_json for secret in (
            "request_fingerprint", "actor_id", "submitted_url", "final_url", "preview_site_name",
            "84000", "<", ">", "https:", "data:", "messages.private.internal",
            "preview.private.internal", "10.24.18.9", "token=fixture", "user@corp.internal",
            "checker@corp.internal", "2001:db8", "fd00::25", "localhost", "internalbox:9090",
            "settlementbox:9090", "NEVER_EXPOSE_PREVIEW_TITLE", "NEVER_EXPOSE_PREVIEW_SITE",
            "NEVER_EXPOSE_PREVIEW_DESCRIPTION",
        )) and opened_evidence["live_post"] == "Live-post evidence")
        deal_state = admin.table("deals").select("stage,is_disputed").eq("id", main_deal["deal_id"]).single().execute().data
        payment_state = admin.table("payments").select("state,version,amount,currency,structure").eq("id", main_deal["payment_id"]).single().execute().data
        dispute_row = admin.table("disputes").select("*").eq("deal_id", main_deal["deal_id"]).single().execute().data
        after_milestone = admin.table("payment_milestones").select("state,version,creator_receipt_version").eq(
            "id", main_deal["milestone_id"]
        ).single().execute().data
        check("overlay preserves stage and prior aggregate truth", deal_state == {"stage": "payment", "is_disputed": True} and payment_state["state"] == "disputed" and dispute_row["prior_payment_state"] == "paid_partial")
        check("raising writes no stage transition", (admin.table("deal_stage_transitions").select("id", count="exact").eq("deal_id", main_deal["deal_id"]).execute().count or 0) == transition_count)
        check("payment terms/version and milestone evidence remain unchanged", {
            key: payment_state[key] for key in ("version", "amount", "currency", "structure")
        } == before_payment and after_milestone == before_milestone)
        check("stored evidence is canonical and provenance-complete", dispute_row["description"] == payload["description"].strip() and dispute_row["request_fingerprint"] and dispute_row["evidence"] == sorted(dispute_row["evidence"], key=lambda item: (item["kind"], item["id"])))
        counts = artifact_counts(main_deal["deal_id"])
        check("one audit and one critical notice per current participant are atomic", counts == {"disputes": 1, "notifications": 4, "audits": 1})
        audit = admin.table("audit_log").select("metadata").eq("entity_id", dispute_row["id"]).single().execute().data["metadata"]
        notices = admin.table("notifications").select("tier,title,body,profile_id").eq("deal_id", main_deal["deal_id"]).execute().data
        check("audit metadata contains ids/state/count only", set(audit) == {
            "dispute_id", "deal_id", "actor_id", "actor_role", "actor_side",
            "prior_payment_state", "evidence_count", "outcome",
        } and audit["evidence_count"] == 2)
        notice_recipients = {item["profile_id"] for item in notices}
        check("notifications are generic, critical and limited to current eligible participants", all(item["tier"] == "critical" and "Fictional" not in item["body"] for item in notices) and notice_recipients == {ids[key] for key in ("C", "B", "M", "K")} and ids["I"] not in notice_recipients)

        retry = call("POST", f"/deals/{main_deal['deal_id']}/disputes", "K", payload)
        check("exact retry is idempotent", retry.status_code == 200 and retry.json()["outcome"]["idempotent"] and artifact_counts(main_deal["deal_id"]) == counts)
        conflict = call(
            "POST",
            f"/deals/{main_deal['deal_id']}/disputes",
            "C",
            {
                "description": "Fictional materially different payment concern.",
                "evidence": [{"kind": "message", "id": other_deal["message_id"]}],
            },
        )
        check("different repeat is a safe stable conflict", conflict.status_code == 409 and conflict.json()["detail"]["disputes"]["current_open"]["id"] == dispute_row["id"] and "request_fingerprint" not in json.dumps(conflict.json()))
        participant_reads = [
            call("GET", f"/deals/{main_deal['deal_id']}/disputes", actor)
            for actor in ("C", "B", "M", "K")
        ]
        check("every current participant reads the same bounded open history", all(
            response.status_code == 200
            and response.json()["current_open"]["id"] == dispute_row["id"]
            and response.json()["allowed_actions"] == {"can_raise": False, "can_resolve": False}
            for response in participant_reads
        ))

        frozen = call(
            "PUT",
            f"/deals/{main_deal['deal_id']}/payment-tracking/milestones/{main_deal['milestone_id']}/state",
            "B",
            {"expected_version": 2, "state": "paid_full"},
        )
        check("real structured payment mutation path fails closed after dispute", frozen.status_code == 409)

        participant_db = auth_client("C")
        anonymous_db = create_client(SUPABASE_URL, ANON_KEY)
        denied = 0
        for operation in (
            lambda: anonymous_db.table("disputes").select("*").eq("deal_id", main_deal["deal_id"]).execute(),
            lambda: participant_db.table("disputes").select("*").eq("deal_id", main_deal["deal_id"]).execute(),
            lambda: participant_db.table("disputes").insert({"deal_id": main_deal["deal_id"], "raised_by": ids["C"], "description": "Fictional forged dispute"}).execute(),
            lambda: participant_db.table("disputes").update({"status": "resolved", "resolution_note": "forged"}).eq("id", dispute_row["id"]).execute(),
            lambda: participant_db.table("disputes").delete().eq("id", dispute_row["id"]).execute(),
            lambda: participant_db.table("deals").update({"is_disputed": False}).eq("id", main_deal["deal_id"]).execute(),
            lambda: participant_db.table("payments").update({"state": "paid_full"}).eq("id", main_deal["payment_id"]).execute(),
            lambda: participant_db.rpc("raise_payment_dispute", {"p_deal_id": main_deal["deal_id"], "p_actor_id": ids["C"], "p_description": "Fictional direct RPC attempt", "p_evidence": [], "p_ip_address": "127.0.0.1"}).execute(),
        ):
            try:
                operation()
            except Exception:
                denied += 1
        check("anon/authenticated direct CRUD/flag/payment/RPC paths are denied", denied == 8)

        concurrent = make_deal("concurrent-raises")
        def concurrent_raise(actor: str, description: str) -> dict:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            return client.rpc("raise_payment_dispute", {
                "p_deal_id": concurrent["deal_id"],
                "p_actor_id": ids[actor],
                "p_description": description,
                "p_evidence": [],
                "p_ip_address": "127.0.0.1",
            }).execute().data

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(
                lambda args: concurrent_raise(args[0], args[1]),
                [("B", "Fictional admin concurrent payment concern."), ("M", "Fictional maker concurrent payment concern.")],
            ))
        check("concurrent raises converge on one open dispute", {item["outcome"] for item in responses} == {"opened", "already_open"} and artifact_counts(concurrent["deal_id"]) == {"disputes": 1, "notifications": 4, "audits": 1})

        payment_race = make_deal("payment-update-race")
        def race_update() -> str:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            try:
                client.rpc("update_payment_tracking_state", {
                    "p_deal_id": payment_race["deal_id"],
                    "p_actor_id": ids["B"],
                    "p_expected_version": 3,
                    "p_state": "paid_full",
                    "p_ip_address": "127.0.0.1",
                }).execute()
                return "updated"
            except Exception as exc:
                return "disputed" if "PAYMENT_TRACKING_DISPUTED" in str(exc) else "unexpected"

        def race_dispute() -> str:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            return client.rpc("raise_payment_dispute", {
                "p_deal_id": payment_race["deal_id"],
                "p_actor_id": ids["C"],
                "p_description": "Fictional payment race concern.",
                "p_evidence": [],
                "p_ip_address": "127.0.0.1",
            }).execute().data["outcome"]

        with ThreadPoolExecutor(max_workers=2) as pool:
            update_future = pool.submit(race_update)
            dispute_future = pool.submit(race_dispute)
            race_results = {update_future.result(), dispute_future.result()}
        race_payment = admin.table("payments").select("state").eq("id", payment_race["payment_id"]).single().execute().data
        race_dispute_row = admin.table("disputes").select("prior_payment_state").eq("deal_id", payment_race["deal_id"]).single().execute().data
        check("payment-update race serializes before or fails after overlay", "opened" in race_results and race_results <= {"opened", "updated", "disputed"} and race_payment["state"] == "disputed" and race_dispute_row["prior_payment_state"] in {"paid_partial", "paid_full"})

        receipt_race = make_deal("receipt-race")
        def race_receipt() -> str:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            try:
                client.rpc("confirm_payment_receipt", {
                    "p_deal_id": receipt_race["deal_id"],
                    "p_milestone_id": None,
                    "p_actor_id": ids["C"],
                    "p_expected_version": 3,
                    "p_ip_address": "127.0.0.1",
                }).execute()
                return "confirmed"
            except Exception as exc:
                return "disputed" if "PAYMENT_TRACKING_DISPUTED" in str(exc) else "unexpected"

        def receipt_dispute() -> str:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            return client.rpc("raise_payment_dispute", {
                "p_deal_id": receipt_race["deal_id"],
                "p_actor_id": ids["B"],
                "p_description": "Fictional receipt race concern.",
                "p_evidence": [],
                "p_ip_address": "127.0.0.1",
            }).execute().data["outcome"]

        with ThreadPoolExecutor(max_workers=2) as pool:
            receipt_future = pool.submit(race_receipt)
            dispute_future = pool.submit(receipt_dispute)
            receipt_results = {receipt_future.result(), dispute_future.result()}
        receipt_payment = admin.table("payments").select("state,creator_receipt_version").eq(
            "id", receipt_race["payment_id"]
        ).single().execute().data
        check("receipt-confirmation race serializes before or fails after overlay", "opened" in receipt_results and receipt_results <= {"opened", "confirmed", "disputed"} and receipt_payment["state"] == "disputed" and receipt_payment["creator_receipt_version"] in {None, 3})

        rollback = make_deal("transaction-rollback")
        try:
            admin.rpc("raise_payment_dispute", {
                "p_deal_id": rollback["deal_id"],
                "p_actor_id": ids["C"],
                "p_description": "Fictional rollback payment concern.",
                "p_evidence": [],
                "p_ip_address": None,
            }).execute()
            rollback_failed = False
        except Exception:
            rollback_failed = True
        rollback_deal = admin.table("deals").select("is_disputed").eq("id", rollback["deal_id"]).single().execute().data
        rollback_payment = admin.table("payments").select("state").eq("id", rollback["payment_id"]).single().execute().data
        check("audit failure rolls back dispute, overlay, payment and notifications", rollback_failed and rollback_deal["is_disputed"] is False and rollback_payment["state"] == "paid_partial" and artifact_counts(rollback["deal_id"]) == {"disputes": 0, "notifications": 0, "audits": 0})

        inconsistent = make_deal("inconsistent-read")
        management_sql(f"UPDATE public.deals SET is_disputed=true WHERE id='{inconsistent['deal_id']}'")
        bad_read = call("GET", f"/deals/{inconsistent['deal_id']}/disputes", "C")
        check("flag/row mismatch fails closed", bad_read.status_code == 409)
        management_sql(f"UPDATE public.deals SET is_disputed=false WHERE id='{inconsistent['deal_id']}'")

        closed = make_deal("closed-history", stage="closed")
        closed_live_id = add_live_post(closed)
        admin.table("messages").update({
            "body": (
                "<strong>Historical message proof</strong> http://message.private.internal/raw "
                "legacy@corp.internal 2001:db8::99 archivebox:8080 "
                "123server:5432/private user@localhost user@internalbox "
                "//internalbox/private ::ffff:10.24.18.9"
            ),
        }).eq("id", closed["message_id"]).execute()
        admin.table("profiles").update({
            "display_name": (
                "<svg>Historical Creator</svg> historian@corp.internal "
                "[fd00::99]:7443 localhost historybox:7070 123server:5432/private "
                "user@localhost user@internalbox //internalbox/private ::ffff:10.24.18.9"
            ),
        }).eq("id", ids["C"]).execute()
        management_sql(
            "UPDATE public.live_post_submissions SET preview_title=NULL,"
            "preview_site_name='NEVER_EXPOSE_HISTORICAL_SITE 172.16.4.20',"
            "preview_description='<svg onload=bad>NEVER_EXPOSE_HISTORICAL_DESCRIPTION</svg> "
            "www.preview.private.internal/raw [2001:db8::77]:6443' "
            f"WHERE id='{closed_live_id}'"
        )
        unproven_id = management_sql(
            "INSERT INTO public.disputes "
            "(deal_id,raised_by,description,evidence,status,resolution_note,resolved_at) VALUES ("
            f"'{closed['deal_id']}','{ids['C']}',"
            "$legacy$Fictional historical resolved payment concern.$legacy$,'[]'::jsonb,'resolved',"
            "$legacy$Historical note without proven resolver identity$legacy$,"
            "'2026-09-02T00:00:00+00:00') RETURNING id"
        )[0]["id"]
        proven_id = management_sql(
            "INSERT INTO public.disputes "
            "(deal_id,raised_by,description,evidence,status,resolution_note,resolved_at,resolved_by) VALUES ("
            f"'{closed['deal_id']}','{ids['C']}',"
            "$legacy$&lt;b&gt;Historical concern&lt;/b&gt; https://description.private.internal/raw "
            "owner@corp.internal [2001:db8::88]:5443 localhost:5050 historynode:6060 "
            "123server:5432/private user@localhost user@internalbox "
            "//internalbox/private ::ffff:10.24.18.9$legacy$,"
            "jsonb_build_array("
            f"jsonb_build_object('kind','message','id','{closed['message_id']}'),"
            f"jsonb_build_object('kind','live_post','id','{closed_live_id}')),"
            "'resolved',"
            "$legacy$<script>private</script> Resolved safely at file:///private/network/location "
            "resolver@corp.internal fd00::88 localhost resolutionbox:3030 "
            "123server:5432/private user@localhost user@internalbox "
            "//internalbox/private ::ffff:10.24.18.9$legacy$,"
            f"'2026-09-03T00:00:00+00:00','{ids['B']}') RETURNING id"
        )[0]["id"]
        closed_read = call("GET", f"/deals/{closed['deal_id']}/disputes", "B")
        closed_json = closed_read.json()
        closed_rows = {item["id"]: item for item in closed_json["history"]}
        check("Closed history is read-only and hides unproven historical resolution", closed_read.status_code == 200 and closed_json["allowed_actions"] == {"can_raise": False, "can_resolve": False} and closed_rows[unproven_id]["resolution_note"] is None)
        historical_json = json.dumps(closed_rows[proven_id])
        historical_evidence = {
            item["kind"]: item["snippet"] for item in closed_rows[proven_id]["evidence"]
        }
        historical_safe_surfaces = (
            closed_rows[proven_id]["description"],
            closed_rows[proven_id]["resolution_note"],
            closed_rows[proven_id]["raised_by"]["display_name"],
            historical_evidence["message"],
        )
        check(
            "reported private values are removed from every historical participant-safe text surface",
            all(
                not any(secret in surface for secret in REPORTED_PRIVATE_VALUES)
                for surface in historical_safe_surfaces
            )
            and all(
                safe in surface
                for safe, surface in zip(
                    ("Historical concern", "Resolved safely", "Historical Creator", "Historical message proof"),
                    historical_safe_surfaces,
                )
            ),
        )
        check("historical descriptions, resolution notes, display names and evidence snippets are public-text sanitized", "Historical concern" in closed_rows[proven_id]["description"] and "Resolved safely" in closed_rows[proven_id]["resolution_note"] and "Historical Creator" in closed_rows[proven_id]["raised_by"]["display_name"] and not any(secret in historical_json for secret in (
            "<", ">", "http:", "https:", "file:", "www.", "description.private.internal",
            "message.private.internal", "preview.private.internal", "172.16.4.20", "network/location",
            "legacy@corp.internal", "historian@corp.internal", "owner@corp.internal",
            "resolver@corp.internal", "2001:db8", "fd00::", "localhost", "archivebox:8080",
            "historybox:7070", "historynode:6060", "resolutionbox:3030",
            "NEVER_EXPOSE_HISTORICAL_SITE", "NEVER_EXPOSE_HISTORICAL_DESCRIPTION",
        )) and historical_evidence["live_post"] == "Live-post evidence")

    finally:
        cleanup()

    passed = sum(1 for _, ok in checks if ok)
    print(f"\nRESULT: {passed}/{len(checks)} checks passed")
    if passed != len(checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
