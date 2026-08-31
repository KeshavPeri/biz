"""Development-Supabase integration coverage for workplan 9.14-A.

All remote post verification is replaced with deterministic fictional evidence;
this test never fetches the public internet. Integration data is serialized by
the factory runner and removed in ``finally``.
"""

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
import services.posting_service as posting_service  # noqa: E402
from services.posting_service import submit_live_post  # noqa: E402
from services.url_verifier import PreviewEvidence, UrlVerificationError  # noqa: E402


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Posting-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"posting.creator.{RUN_ID}@inflo.test", "Fictional Post Creator", "creator"),
    "B": (f"posting.admin.{RUN_ID}@inflo.test", "Fictional Post Admin", "brand"),
    "M": (f"posting.maker.{RUN_ID}@inflo.test", "Fictional Post Maker", "brand"),
    "K": (f"posting.checker.{RUN_ID}@inflo.test", "Fictional Post Checker", "brand"),
    "O": (f"posting.outsider.{RUN_ID}@inflo.test", "Fictional Post Outsider", "brand"),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
brand_id: str | None = None
checks: list[tuple[str, bool]] = []
verification_calls: list[tuple[str, str]] = []


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
        raise RuntimeError(f"Management SQL failed ({response.status_code}): {response.text}")
    return response.json()


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[actor][0], "password": PASSWORD})
    return client


def call(method: str, path: str, actor: str, payload: dict | None = None):
    return api.request(
        method,
        path,
        headers={"Authorization": f"Bearer {tokens[actor]}"},
        json=payload,
    )


def fake_verifier(url: str, platform: str) -> PreviewEvidence:
    verification_calls.append((url, platform))
    if "retry-later" in url:
        raise UrlVerificationError(
            "unreachable", "The platform could not verify this post right now. Please try again.", retryable=True
        )
    if platform != "instagram":
        raise AssertionError("fixture expected an Instagram deliverable")
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    return PreviewEvidence(
        submitted_url=url,
        final_url=f"https://www.instagram.com/p/{slug}/",
        final_host="www.instagram.com",
        title=f"Fictional post {slug}",
        site_name="Instagram",
        description="Deterministic fictional public preview.",
    )


def make_deal(label: str, count: int = 1, *, stage: str = "creating", approved: bool = True) -> tuple[str, list[str]]:
    deal_id = admin.table("deals").insert(
        {
            "creator_id": ids["C"],
            "brand_id": brand_id,
            "deal_name": f"Fictional posting {label} {RUN_ID}",
            "direction": "inbound",
            "created_by": ids["B"],
            "stage": stage,
        }
    ).execute().data[0]["id"]
    admin.table("deal_participants").insert(
        [
            {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
            {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
            {"deal_id": deal_id, "profile_id": ids["M"], "participant_role": "brand_maker"},
            {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
        ]
    ).execute()
    summary_id = admin.table("ai_summaries").insert(
        {
            "deal_id": deal_id,
            "raw_output": {"source": "fictional posting fixture"},
            "structured_terms": {"fixture": True},
            "status": "approved",
        }
    ).execute().data[0]["id"]
    deliverable_ids = [str(uuid4()) for _ in range(count)]
    values = ",".join(
        "(" + ",".join(
            [
                f"'{deliverable_id}'",
                f"'{deal_id}'",
                str(index),
                "'reel'",
                "'instagram'",
                "'2026-09-30'",
                "2",
                "1",
                f"'{summary_id}'",
                f"'{('approved' if approved else 'submitted')}'",
                "'fictional-approved-content'" if approved else "NULL",
            ]
        ) + ")"
        for index, deliverable_id in enumerate(deliverable_ids, 1)
    )
    management_sql(
        "INSERT INTO public.deliverables "
        "(id,deal_id,sequence,content_format,platform,posting_date,revision_max,revision_current,"
        "source_summary_id,status,approved_content_url) VALUES " + values + ";"
    )
    deal_ids.append(deal_id)
    return deal_id, deliverable_ids


def stage_of(deal_id: str) -> str:
    return admin.table("deals").select("stage").eq("id", deal_id).execute().data[0]["stage"]


def live_rows(deal_id: str) -> list[dict]:
    return (
        admin.table("live_post_submissions")
        .select("*,deliverables!live_post_submissions_deliverable_id_fkey!inner(deal_id)")
        .eq("deliverables.deal_id", deal_id)
        .order("version")
        .execute()
        .data
    )


def save_payment_details(deal_id: str, *, creator_version: int = 0, creator_suffix: str = "one") -> None:
    creator = call(
        "PUT", f"/deals/{deal_id}/payment-details/creator", "C",
        {
            "expected_version": creator_version,
            "creator_legal_name": f"Fictional Posting Creator {creator_suffix}",
            "creator_bank_or_upi": f"Fictional off-platform instruction {creator_suffix}",
            "creator_tax_id": None,
        },
    )
    if creator.status_code != 200:
        raise AssertionError("fictional creator payment-detail setup failed")
    if creator_version == 0:
        brand = call(
            "PUT", f"/deals/{deal_id}/payment-details/brand", "B",
            {
                "expected_version": 0,
                "brand_billing_name": "Fictional Posting Brand",
                "brand_billing_address": "Fictional billing address, Test District",
                "brand_gst": None,
            },
        )
        if brand.status_code != 200:
            raise AssertionError("fictional brand payment-detail setup failed")


def cleanup() -> None:
    print("\nCleaning up fictional posting data...")
    if ids:
        quoted = ",".join(f"'{value}'" for value in ids.values())
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.audit_log WHERE actor_id IN ({quoted}); "
            "SET session_replication_role = origin;"
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
    posting_service.verify_live_post_url = fake_verifier
    cleanup()
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {"email": email, "password": PASSWORD, "email_confirm": True}
            ).user.id
            admin.table("profiles").insert(
                {"id": ids[key], "email": email, "display_name": name, "account_type": account_type}
            ).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table("brands").insert(
            {"company_name": f"Fictional Posting Studio {RUN_ID}", "industry": "Media"}
        ).execute().data[0]["id"]
        admin.table("brand_members").insert(
            [{"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"}]
            + [
                {"brand_id": brand_id, "profile_id": ids[key], "brand_role": "member", "status": "active"}
                for key in ("M", "K", "O")
            ]
        ).execute()

        # Authorization and state failures all happen before the network double.
        guard_deal, [guard_deliverable] = make_deal("guards")
        initial_calls = len(verification_calls)
        check("brand cannot submit creator link", call(
            "POST", f"/deals/{guard_deal}/deliverables/{guard_deliverable}/live-post", "B",
            {"url": "https://instagram.com/p/guard", "expected_version": 0},
        ).status_code == 403)
        check("outsider learns no deliverable state", call(
            "POST", f"/deals/{guard_deal}/deliverables/{guard_deliverable}/live-post", "O",
            {"url": "https://instagram.com/p/guard", "expected_version": 0},
        ).status_code == 403)
        check("stale expected version is rejected", call(
            "POST", f"/deals/{guard_deal}/deliverables/{guard_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/guard", "expected_version": 1},
        ).status_code == 409)
        check("deal-level submit-live remains a non-executable instruction", call(
            "POST", f"/deals/{guard_deal}/submit-live", "C"
        ).status_code == 409)
        unapproved_deal, [unapproved_deliverable] = make_deal("unapproved", approved=False)
        check("unapproved content is rejected", call(
            "POST", f"/deals/{unapproved_deal}/deliverables/{unapproved_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/unapproved", "expected_version": 0},
        ).status_code == 409)
        wrong_stage_deal, [wrong_stage_deliverable] = make_deal("wrong-stage", stage="approval")
        check("wrong deal stage is rejected", call(
            "POST", f"/deals/{wrong_stage_deal}/deliverables/{wrong_stage_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/wrong-stage", "expected_version": 0},
        ).status_code == 409)
        check("all authorization/state failures precede fetch", len(verification_calls) == initial_calls)

        failure_deal, [failure_deliverable] = make_deal("network-failure")
        failed = call(
            "POST", f"/deals/{failure_deal}/deliverables/{failure_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/retry-later", "expected_version": 0},
        )
        check("transient verifier failure is friendly and retryable", failed.status_code == 503 and "try again" in failed.json()["detail"].lower())
        check("verifier failure leaves row and stage unchanged", stage_of(failure_deal) == "creating" and not live_rows(failure_deal))

        # One-deliverable transition, retry, issue/correction, safe read and confirm.
        single_deal, [single_deliverable] = make_deal("single")
        first = call(
            "POST", f"/deals/{single_deal}/deliverables/{single_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/single-v1", "expected_version": 0},
        )
        check("one approved verified link atomically enters Posted", first.status_code == 200 and first.json()["transitioned"] and stage_of(single_deal) == "posted")
        calls_after_first = len(verification_calls)
        retry = call(
            "POST", f"/deals/{single_deal}/deliverables/{single_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/single-v1", "expected_version": 0},
        )
        check("identical retry is idempotent without a second fetch or row", retry.status_code == 200 and retry.json()["idempotent"] and len(verification_calls) == calls_after_first and len(live_rows(single_deal)) == 1)
        missing_details = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 1}],
                "creator_payment_version": 1,
                "brand_payment_version": 1,
            },
        )
        check("missing payment details block confirmation without changing posts or stage", (
            missing_details.status_code == 409
            and stage_of(single_deal) == "posted"
            and live_rows(single_deal)[0]["status"] == "verified"
        ))
        creator_only = call(
            "PUT", f"/deals/{single_deal}/payment-details/creator", "C",
            {
                "expected_version": 0,
                "creator_legal_name": "Fictional Posting Creator one",
                "creator_bank_or_upi": "Fictional off-platform instruction one",
                "creator_tax_id": None,
            },
        )
        incomplete_details = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 1}],
                "creator_payment_version": 1,
                "brand_payment_version": 1,
            },
        )
        check("one complete side still blocks Payment atomically", (
            creator_only.status_code == 200
            and incomplete_details.status_code == 409
            and stage_of(single_deal) == "posted"
            and live_rows(single_deal)[0]["status"] == "verified"
        ))
        brand_saved = call(
            "PUT", f"/deals/{single_deal}/payment-details/brand", "B",
            {
                "expected_version": 0,
                "brand_billing_name": "Fictional Posting Brand",
                "brand_billing_address": "Fictional billing address, Test District",
                "brand_gst": None,
            },
        )
        check("both payment-detail sides become complete in Posted", (
            brand_saved.status_code == 200
            and brand_saved.json()["creator_complete"]
            and brand_saved.json()["brand_complete"]
        ))
        checker_flag = call(
            "POST", f"/deals/{single_deal}/deliverables/{single_deliverable}/live-post/flag", "K",
            {"expected_version": 1, "reason": "This is the wrong fictional link."},
        )
        check("checker is read-only for post decisions", checker_flag.status_code == 403)
        flagged = call(
            "POST", f"/deals/{single_deal}/deliverables/{single_deliverable}/live-post/flag", "B",
            {"expected_version": 1, "reason": "This is the wrong fictional link."},
        )
        check("brand flags exact version while deal stays Posted", flagged.status_code == 200 and flagged.json()["status"] == "flagged" and stage_of(single_deal) == "posted")
        blocked_confirm = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 1}],
                "creator_payment_version": 1,
                "brand_payment_version": 1,
            },
        )
        check("open issue blocks confirmation", blocked_confirm.status_code == 409)
        replacement = call(
            "POST", f"/deals/{single_deal}/deliverables/{single_deliverable}/live-post", "C",
            {"url": "https://instagram.com/p/single-v2", "expected_version": 1},
        )
        history = live_rows(single_deal)
        check("creator replaces only flagged link and history remains append-only", replacement.status_code == 200 and replacement.json()["version"] == 2 and [row["status"] for row in history] == ["flagged", "verified"])

        safe_read = call("GET", f"/deals/{single_deal}/deliverables", "B")
        safe_text = json.dumps(safe_read.json(), sort_keys=True)
        post_state = safe_read.json()["deliverables"][0]["post_state"]
        check("participant API returns bounded current and two-version text history", safe_read.status_code == 200 and post_state["current"]["version"] == 2 and len(post_state["history"]) == 2)
        check("participant API exposes no image, HTML, network internals or private labels", all(term not in safe_text for term in ("og:image", "private_annotations", "private_label", "dns", "headers", "cookies", "<script")))
        check("existing frontend activation flag remains false", safe_read.json()["deliverables"][0]["available_actions"]["can_submit_live_url"] is False)

        stale_confirm = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 1}],
                "creator_payment_version": 1,
                "brand_payment_version": 1,
            },
        )
        check("brand confirmation requires exact current version", stale_confirm.status_code == 409)
        save_payment_details(single_deal, creator_version=1, creator_suffix="two")
        stale_detail_confirm = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 2}],
                "creator_payment_version": 1,
                "brand_payment_version": 1,
            },
        )
        check("brand confirmation fails closed on a stale payment-detail version", (
            stale_detail_confirm.status_code == 409
            and stage_of(single_deal) == "posted"
            and live_rows(single_deal)[-1]["status"] == "verified"
        ))
        confirmed = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 2}],
                "creator_payment_version": 2,
                "brand_payment_version": 1,
            },
        )
        check("brand exact confirmation atomically enters Payment", confirmed.status_code == 200 and confirmed.json()["transitioned"] and stage_of(single_deal) == "payment")
        confirm_retry = call(
            "POST", f"/deals/{single_deal}/confirm-posts", "B",
            {
                "versions": [{"deliverable_id": single_deliverable, "version": 2}],
                "creator_payment_version": 2,
                "brand_payment_version": 1,
            },
        )
        check("confirmation retry is idempotent", confirm_retry.status_code == 200 and confirm_retry.json()["idempotent"])

        # Multi-deliverable final-link concurrency produces one transition.
        multi_deal, multi_deliverables = make_deal("multi", count=2)
        partial = call(
            "POST", f"/deals/{multi_deal}/deliverables/{multi_deliverables[0]}/live-post", "C",
            {"url": "https://instagram.com/p/multi-one", "expected_version": 0},
        )
        check("multi deal waits in Creating after first verified link", partial.status_code == 200 and not partial.json()["transitioned"] and stage_of(multi_deal) == "creating")

        def concurrent_final(_index: int) -> dict:
            return submit_live_post(
                multi_deal,
                multi_deliverables[1],
                ids["C"],
                "https://instagram.com/p/multi-two",
                0,
                "127.0.0.1",
                verifier=fake_verifier,
                _client=create_client(SUPABASE_URL, SERVICE_KEY),
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            race = list(pool.map(concurrent_final, range(2)))
        transitions = admin.table("deal_stage_transitions").select("id").eq("deal_id", multi_deal).eq("to_stage", "posted").execute().data
        check("concurrent final submissions yield one row binding and one transition", len(live_rows(multi_deal)) == 2 and len(transitions) == 1 and stage_of(multi_deal) == "posted" and sum(bool(item.get("transitioned")) for item in race) == 1)
        save_payment_details(multi_deal)
        multi_confirm = call(
            "POST", f"/deals/{multi_deal}/confirm-posts", "M",
            {
                "versions": [{"deliverable_id": value, "version": 1} for value in multi_deliverables],
                "creator_payment_version": 1,
                "brand_payment_version": 1,
            },
        )
        check("active brand maker can confirm the exact multi-deliverable set", multi_confirm.status_code == 200 and stage_of(multi_deal) == "payment")
        payment_rows = admin.table("payments").select("id").eq("deal_id", multi_deal).execute().data
        check("entering Payment invents no payment records", payment_rows == [])

        # Direct participant writes/reads remain closed; audits contain metadata only.
        creator_client = auth_client("C")
        direct_update_denied = False
        try:
            creator_client.table("deliverables").update({"live_post_url": "https://evil.example"}).eq("id", single_deliverable).execute()
        except Exception:
            direct_update_denied = True
        direct_history_denied = False
        try:
            creator_client.table("live_post_submissions").select("*").execute()
        except Exception:
            direct_history_denied = True
        check("participants cannot directly mutate link/status projections", direct_update_denied)
        check("raw version history is backend-only", direct_history_denied)
        audit_rows = admin.table("audit_log").select("action,metadata").in_("entity_id", [single_deal, single_deliverable, multi_deal, *multi_deliverables]).execute().data
        audit_text = json.dumps(audit_rows, sort_keys=True)
        check("audit evidence has ids/versions/hosts/outcomes but no URL or preview text", "www.instagram.com" in audit_text and "https://" not in audit_text and "Fictional post" not in audit_text and "Deterministic fictional" not in audit_text)

    finally:
        cleanup()

    failed = [label for label, passed in checks if not passed]
    print(f"\nTEST-POSTING-GATE: {len(checks) - len(failed)}/{len(checks)} checks passed")
    if failed:
        print("Failed checks:")
        for label in failed:
            print(f"  - {label}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
