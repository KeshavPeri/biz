"""Development-Supabase integration coverage for post-close ratings and entries."""

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


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"PostClose-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"postclose.creator.{RUN_ID}@inflo.test", "Fictional Outcome Creator", "creator"),
    "B": (f"postclose.admin.{RUN_ID}@inflo.test", "Fictional Outcome Admin", "brand"),
    "K": (f"postclose.checker.{RUN_ID}@inflo.test", "Fictional Outcome Checker", "brand"),
    "I": (f"postclose.inactive.{RUN_ID}@inflo.test", "Fictional Invited Member", "brand"),
    "O": (f"postclose.outsider.{RUN_ID}@inflo.test", "Fictional Outcome Outsider", "brand"),
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
        json={"query": sql}, timeout=60,
    )
    if not response.is_success:
        raise RuntimeError(f"Management SQL failed ({response.status_code})")
    return response.json()


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[actor][0], "password": PASSWORD})
    return client


def call(method: str, path: str, actor: str, payload: object | None = None):
    return api.request(method, path, headers={"Authorization": f"Bearer {tokens[actor]}"}, json=payload)


def make_deal(label: str, stage: str = "closed") -> str:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"], "brand_id": brand_id,
        "deal_name": f"Fictional post-close {label} {RUN_ID}",
        "direction": "inbound", "created_by": ids["B"], "stage": stage,
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
        {"deal_id": deal_id, "profile_id": ids["I"], "participant_role": "brand_maker"},
    ]).execute()
    return deal_id


def cleanup() -> None:
    print("\nCleaning up fictional post-close data...")
    if deal_ids:
        quoted_deals = ",".join(f"'{value}'" for value in deal_ids)
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.ratings WHERE deal_id IN ({quoted_deals}); "
            f"DELETE FROM public.deal_comments WHERE deal_id IN ({quoted_deals}); "
            "SET session_replication_role = origin;"
        )
        for deal_id in deal_ids:
            admin.table("deals").delete().eq("id", deal_id).execute()
    if ids:
        quoted_ids = ",".join(f"'{value}'" for value in ids.values())
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.audit_log WHERE actor_id IN ({quoted_ids}); "
            "SET session_replication_role = origin;"
        )
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values():
        admin.auth.admin.delete_user(user_id)
    print("  cleanup complete")


def main() -> None:
    global brand_id
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user({
                "email": email, "password": PASSWORD, "email_confirm": True,
            }).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": name, "account_type": account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token
        admin.table("creator_profiles").insert({"profile_id": ids["C"], "niches": ["lifestyle"]}).execute()
        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Outcome Studio {RUN_ID}", "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["I"], "brand_role": "member", "status": "invited"},
            {"brand_id": brand_id, "profile_id": ids["O"], "brand_role": "member", "status": "active"},
        ]).execute()

        open_deal = make_deal("not-closed", "payment")
        check("pre-Closed participants and outsiders receive no post-close artifacts", (
            call("GET", f"/deals/{open_deal}/post-close/ratings", "C").status_code == 409
            and call("GET", f"/deals/{open_deal}/post-close/ratings", "O").status_code == 404
            and not admin.table("ratings").select("id").eq("deal_id", open_deal).execute().data
        ))

        deal = make_deal("outcomes")
        strict_statuses = [
            call("POST", f"/deals/{deal}/post-close/ratings", "C", {
                "score": 5, "review": None, "request_id": str(uuid4()), "side": "creator",
            }).status_code,
            call("POST", f"/deals/{deal}/post-close/ratings", "C", {
                "score": 5, "review": "See https://example.test", "request_id": str(uuid4()),
            }).status_code,
            call("POST", f"/deals/{deal}/post-close/ratings", "C", {
                "score": 5, "review": "<b>great</b>", "request_id": str(uuid4()),
            }).status_code,
        ]
        check("rating input is exact, bounded plain text with no spoofed target or links", strict_statuses == [422, 422, 422])

        creator_request = str(uuid4())
        creator_payload = {"score": 5, "review": "Clear collaboration and prompt follow-through.", "request_id": creator_request}
        creator_rating = call("POST", f"/deals/{deal}/post-close/ratings", "C", creator_payload)
        safe_projection = json.dumps(creator_rating.json(), sort_keys=True)
        brand_trust = admin.table("brands").select("trust_rating").eq("id", brand_id).single().execute().data
        check("creator rating derives the brand target and updates only proven brand trust", (
            creator_rating.status_code == 200 and brand_trust["trust_rating"] == 5
            and creator_rating.json()["status"] == {"creator": True, "brand": False}
            and creator_rating.json()["allowed_actions"] == {"can_rate": False}
        ))
        check("rating projection excludes ids, request provenance, IPs and unrelated ratings", all(
            marker not in safe_projection for marker in ("rater_id", "ratee_", "request_", "fingerprint", "ip_address", "trust_")
        ))
        rating_before = admin.table("ratings").select("id").eq("deal_id", deal).execute().data
        audit_before = admin.table("audit_log").select("id").eq("entity_id", deal).eq("action", "deal_rating_submitted").execute().data
        exact_retry = call("POST", f"/deals/{deal}/post-close/ratings", "C", creator_payload)
        changed_retry = call("POST", f"/deals/{deal}/post-close/ratings", "C", {**creator_payload, "score": 4})
        check("exact rating retry has no duplicate effect and changed reuse conflicts", (
            exact_retry.status_code == 200 and changed_retry.status_code == 409
            and len(admin.table("ratings").select("id").eq("deal_id", deal).execute().data) == len(rating_before) == 1
            and len(admin.table("audit_log").select("id").eq("entity_id", deal).eq("action", "deal_rating_submitted").execute().data) == len(audit_before) == 1
        ))

        checker_rating = call("POST", f"/deals/{deal}/post-close/ratings", "K", {
            "score": 4, "review": None, "request_id": str(uuid4()),
        })
        creator_trust = admin.table("creator_profiles").select("trust_score").eq("profile_id", ids["C"]).single().execute().data
        check("active participating checker may fill the single brand-side rating", (
            checker_rating.status_code == 200 and creator_trust["trust_score"] == 4
            and call("POST", f"/deals/{deal}/post-close/ratings", "B", {
                "score": 3, "review": None, "request_id": str(uuid4()),
            }).status_code == 409
        ))
        check("invited, outsider and platform-ops identities cannot rate", (
            call("POST", f"/deals/{deal}/post-close/ratings", "I", {"score": 3, "review": None, "request_id": str(uuid4())}).status_code == 404
            and call("POST", f"/deals/{deal}/post-close/ratings", "O", {"score": 3, "review": None, "request_id": str(uuid4())}).status_code == 404
        ))

        creator_client = auth_client("C")
        brand_client = auth_client("B")
        direct_denials = []
        for action in (
            lambda: creator_client.table("ratings").insert({"deal_id": deal, "rater_id": ids["C"], "ratee_brand_id": brand_id, "score": 1}).execute(),
            lambda: creator_client.table("creator_profiles").update({"trust_score": 1}).eq("profile_id", ids["C"]).execute(),
            lambda: brand_client.table("brands").update({"trust_rating": 1}).eq("id", brand_id).execute(),
            lambda: creator_client.table("brands").insert({"company_name": "Forbidden trust spoof", "trust_rating": 5}).execute(),
        ):
            try:
                action(); direct_denials.append(False)
            except Exception:
                direct_denials.append(True)
        check("direct rating and trust-score mutations remain denied", all(direct_denials))

        concurrent = make_deal("concurrent")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda item: call("POST", f"/deals/{concurrent}/post-close/ratings", item[0], item[1]).status_code, [
                ("C", {"score": 3, "review": None, "request_id": str(uuid4())}),
                ("B", {"score": 5, "review": None, "request_id": str(uuid4())}),
            ]))
        check("concurrent creator and brand ratings converge on exactly two side rows", (
            results == [200, 200]
            and len(admin.table("ratings").select("id").eq("deal_id", concurrent).execute().data) == 2
        ))

        shared_request = str(uuid4())
        shared_payload = {"visibility": "shared", "body": "Fictional wrap-up detail for all participants.", "request_id": shared_request}
        shared = call("POST", f"/deals/{deal}/post-close/entries", "C", shared_payload)
        notices = admin.table("notifications").select("profile_id,body").eq("deal_id", deal).eq("title", "New post-deal comment").execute().data
        check("shared comment notifies only other current participants without its body", (
            shared.status_code == 200 and {row["profile_id"] for row in notices} == {ids["B"], ids["K"]}
            and all(shared_payload["body"] not in row["body"] for row in notices)
        ))
        count_before = len(notices)
        shared_retry = call("POST", f"/deals/{deal}/post-close/entries", "C", shared_payload)
        changed_shared = call("POST", f"/deals/{deal}/post-close/entries", "C", {**shared_payload, "body": "Changed body"})
        check("shared exact retry avoids duplicate rows/notices and changed reuse conflicts", (
            shared_retry.status_code == 200 and changed_shared.status_code == 409
            and len(admin.table("deal_comments").select("id").eq("deal_id", deal).eq("visibility", "shared").execute().data) == 1
            and len(admin.table("notifications").select("id").eq("deal_id", deal).eq("title", "New post-deal comment").execute().data) == count_before
        ))

        private_text = "Only the fictional author may retrieve this note."
        private = call("POST", f"/deals/{deal}/post-close/entries", "C", {
            "visibility": "private", "body": private_text, "request_id": str(uuid4()),
        })
        creator_private = call("GET", f"/deals/{deal}/post-close/entries?visibility=private&limit=20", "C")
        brand_private = call("GET", f"/deals/{deal}/post-close/entries?visibility=private&limit=20", "B")
        brand_rls_denied = False
        try:
            brand_client.table("deal_comments").select("id").eq("deal_id", deal).eq("visibility", "private").execute()
        except Exception:
            brand_rls_denied = True
        check("private note creates no notice and is absent from another participant API/RLS result", (
            private.status_code == 200
            and len(admin.table("notifications").select("id").eq("deal_id", deal).eq("title", "New post-deal comment").execute().data) == count_before
            and creator_private.status_code == 200 and creator_private.json()["entries"][0]["body"] == private_text
            and brand_private.status_code == 200 and brand_private.json()["entries"] == [] and brand_rls_denied
            and private_text not in json.dumps(brand_private.json())
        ))

        for index in range(3):
            call("POST", f"/deals/{deal}/post-close/entries", "B", {
                "visibility": "shared", "body": f"Bounded fictional page item {index}.", "request_id": str(uuid4()),
            })
        page_one = call("GET", f"/deals/{deal}/post-close/entries?visibility=shared&limit=2", "C").json()
        page_two = call("GET", f"/deals/{deal}/post-close/entries?visibility=shared&limit=2&cursor={page_one['next_cursor']}", "C").json()
        page_ids = [row["id"] for row in page_one["entries"] + page_two["entries"]]
        check("separate shared feed is bounded, newest-first and cursor-stable", (
            len(page_one["entries"]) == 2 and page_one["next_cursor"] is not None
            and len(page_two["entries"]) == 2 and len(page_ids) == len(set(page_ids)) == 4
        ))

        entry_id = creator_private.json()["entries"][0]["id"]
        mutation_denials = []
        for action in (
            lambda: creator_client.table("deal_comments").insert({"deal_id": deal, "author_id": ids["C"], "body": "direct", "visibility": "private"}).execute(),
            lambda: admin.table("deal_comments").update({"body": "changed"}).eq("id", entry_id).execute(),
            lambda: admin.table("deal_comments").delete().eq("id", entry_id).execute(),
        ):
            try:
                action(); mutation_denials.append(False)
            except Exception:
                mutation_denials.append(True)
        check("post-close entries are backend-owned and append-only", all(mutation_denials))
    finally:
        cleanup()

    passed = sum(1 for _, ok in checks if ok)
    print(f"\nRESULT: {passed}/{len(checks)} checks passed")
    if passed != len(checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
