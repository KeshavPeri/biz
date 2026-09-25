"""Phase 8 Cluster C — B2-004 connect test.

Drives POST /deals/connect END-TO-END through the real FastAPI TestClient with
real Supabase JWTs (fictional users sign in), so auth + RBAC run for real. The
service_role admin sets up brands/creators/a prior exclusivity, and verifies the
seeded deal state directly. RLS sanity uses plain anon clients.

Covers: create (pending + 2 participants + 1 NULL→pending 'auto' transition),
duplicate guard (created=false, no dup), RBAC (brand user with no membership →
403), exclusivity warning, and participant vs non-participant read.

Note: brand_id is DERIVED server-side from the caller's active membership (never a
client input), so a caller can only ever act for their own brand. The enforceable
RBAC path is therefore "no active membership → 403", which we assert.

Run: python backend/tests/test_connect.py
"""

import copy
import os
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))  # so `from main import app` resolves

from dotenv import load_dotenv  # noqa: E402
import httpx  # noqa: E402
from supabase import Client, create_client  # noqa: E402

load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from test_contract_alignment_unit import payload as alignment_payload  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

TEST_PASSWORD = "Monsoon2026!Inflo"

USERS = {
    "B": {"email": "brandadmin@connect-inflo.test", "display_name": "Bela Admin", "account_type": "brand"},
    "C": {"email": "creator@connect-inflo.test", "display_name": "Chandni Roy", "account_type": "creator"},
    "NOBRAND": {"email": "nobrand@connect-inflo.test", "display_name": "Nikhil NoBrand", "account_type": "brand"},
    "U": {"email": "unrelated@connect-inflo.test", "display_name": "Uma Unrelated", "account_type": "creator"},
}

api = TestClient(app)
results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def mgmt_sql(sql: str) -> None:
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"}, json={"query": sql}, timeout=30,
    )
    response.raise_for_status()


def cleanup(admin: Client) -> None:
    emails = {u["email"] for u in USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    ids = [u.id for u in leftover]
    if ids:
        quoted = ",".join(f"'{value}'" for value in ids)
        response = httpx.post(
            f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            json={"query": "SET session_replication_role = replica; " f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); " "SET session_replication_role = origin;"},
            timeout=30,
        )
        response.raise_for_status()
        # Delete any deals touching these users (cascades participants/messages/
        # transitions/exclusivity), then their brands, then the users.
        deals = admin.table("deals").select("id, brand_id").or_(
            f"creator_id.in.({','.join(ids)}),created_by.in.({','.join(ids)})"
        ).execute()
        brand_ids = set()
        for d in deals.data:
            admin.table("deals").delete().eq("id", d["id"]).execute()
            if d.get("brand_id"):
                brand_ids.add(d["brand_id"])
        members = admin.table("brand_members").select("brand_id").in_("profile_id", ids).execute()
        brand_ids.update(m["brand_id"] for m in members.data)
        for bid in brand_ids:
            admin.table("brands").delete().eq("id", bid).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def token_for(email: str) -> str:
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    session = c.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD})
    return session.session.access_token


def connect(token: str, target_type: str, target_id: str):
    return api.post(
        "/deals/connect",
        json={"target_type": target_type, "target_id": target_id},
        headers={"Authorization": f"Bearer {token}"},
    )


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup(admin)

    ids: dict[str, str] = {}
    brand_b_id = None
    brand_b2_id = None

    try:
        for key, info in USERS.items():
            resp = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            )
            ids[key] = resp.user.id
        admin.table("profiles").insert(
            [
                {"id": ids[k], "account_type": v["account_type"], "display_name": v["display_name"], "email": v["email"]}
                for k, v in USERS.items()
            ]
        ).execute()

        # Brand B with admin member = user B.
        brand_b_id = admin.table("brands").insert({"company_name": "Aster Labs", "industry": "Beauty"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            {"brand_id": brand_b_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"}
        ).execute()

        # A PRIOR deal (creator C × another brand B2) carrying an ACTIVE exclusivity
        # clause — so the fresh B×C connect fires the warning without tripping the
        # duplicate guard (different brand).
        brand_b2_id = admin.table("brands").insert({"company_name": "Rival Co", "industry": "Beauty"}).execute().data[0]["id"]
        prior = admin.table("deals").insert(
            {"creator_id": ids["C"], "brand_id": brand_b2_id, "deal_name": "Prior", "direction": "inbound", "created_by": ids["C"], "stage": "approval"}
        ).execute().data[0]["id"]
        admin.table("deal_participants").insert({"deal_id": prior, "profile_id": ids["C"], "participant_role": "creator"}).execute()
        prior_terms = copy.deepcopy(alignment_payload())
        evidence = prior_terms["exclusivity"]["evidence"]
        prior_terms["exclusivity"] = {"status": "found", "value": True, "evidence": evidence}
        prior_terms["exclusivity_duration_days"] = {"status": "found", "value": 36500, "evidence": evidence}
        prior_terms["exclusivity_category"] = {"status": "found", "value": "skincare", "evidence": evidence}
        prior_source = admin.table("ai_summaries").insert({"deal_id": prior, "raw_output": {"source": "fictional connect warning"}, "structured_terms": prior_terms, "status": "approved"}).execute().data[0]
        prior_contract = admin.table("contracts").insert({"deal_id": prior, "version": 1, "status": "executed", "storage_path": f"{prior}/fictional-v1.pdf", "generated_from_summary_id": prior_source["id"], "draft_source_sha256": "0" * 64}).execute().data[0]
        admin.table("audit_log").insert({"actor_id": ids["C"], "action": "contract_executed", "entity_type": "deal", "entity_id": prior, "metadata": {"contract_id": prior_contract["id"], "version": 1}, "ip_address": "127.0.0.1"}).execute()
        admin.rpc("materialize_canonical_exclusivity", {"p_deal_id": prior, "p_source_summary_id": prior_source["id"], "p_actor_id": ids["C"], "p_ip_address": "127.0.0.1"}).execute()
        mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='closed' WHERE id='{prior}'; " "SET session_replication_role = origin;")

        token_b = token_for(USERS["B"]["email"])
        token_nobrand = token_for(USERS["NOBRAND"]["email"])

        # ── 1. Create ──────────────────────────────────────────────────────────
        r1 = connect(token_b, "creator", ids["C"])
        body1 = r1.json()
        check("connect returns 200", r1.status_code == 200)
        check("deal created at stage 'pending' (created=true)", body1.get("stage") == "pending" and body1.get("created") is True)
        deal_id = body1.get("deal_id")

        deal = admin.table("deals").select("brand_id, stage, direction").eq("id", deal_id).execute().data[0]
        check("deal.brand_id = caller's OWN brand (can't forge another)", deal["brand_id"] == brand_b_id)
        check("direction = 'inbound' (brand→creator)", deal["direction"] == "inbound")

        parts = admin.table("deal_participants").select("participant_role").eq("deal_id", deal_id).execute().data
        roles = sorted(p["participant_role"] for p in parts)
        check("exactly 2 participants: brand_admin + creator", roles == ["brand_admin", "creator"])

        trans = admin.table("deal_stage_transitions").select("from_stage, to_stage, transition_type").eq("deal_id", deal_id).execute().data
        check(
            "exactly 1 transition NULL→pending 'auto'",
            len(trans) == 1 and trans[0]["from_stage"] is None and trans[0]["to_stage"] == "pending" and trans[0]["transition_type"] == "auto",
        )

        msgs = admin.table("messages").select("id").eq("deal_id", deal_id).execute().data
        check("chat-thread stub seeded (1 message)", len(msgs) == 1)

        # ── Exclusivity warning ──────────────────────────────────────────────────
        check("exclusivity_warning present (creator has active clause)", "exclusivity_warning" in body1 and "skincare" in body1["exclusivity_warning"])

        # ── 2. Duplicate guard ───────────────────────────────────────────────────
        r2 = connect(token_b, "creator", ids["C"])
        body2 = r2.json()
        check("second connect returns the SAME deal (created=false)", body2.get("created") is False and body2.get("deal_id") == deal_id)
        dup_count = len(admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_b_id).execute().data)
        check("no duplicate deal row created", dup_count == 1)

        # ── 3. RBAC: brand user with NO membership → 403 ─────────────────────────
        r3 = connect(token_nobrand, "creator", ids["C"])
        check("brand user with no active membership is blocked (403)", r3.status_code == 403)

        # ── 4. RLS sanity: participant reads, non-participant doesn't ────────────
        c_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        c_client.auth.sign_in_with_password({"email": USERS["C"]["email"], "password": TEST_PASSWORD})
        check("participant (creator) CAN read the deal", len(c_client.table("deals").select("id").eq("id", deal_id).execute().data) == 1)

        u_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        u_client.auth.sign_in_with_password({"email": USERS["U"]["email"], "password": TEST_PASSWORD})
        check("non-participant CANNOT read the deal (0 rows)", len(u_client.table("deals").select("id").eq("id", deal_id).execute().data) == 0)

    finally:
        print()
        print("Cleaning up test data...")
        cleanup(admin)
        print("  done")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
