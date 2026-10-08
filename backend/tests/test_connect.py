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
from concurrent.futures import ThreadPoolExecutor
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
from services.term_extraction import SCHEMA_VERSION, PROMPT_VERSION  # noqa: E402
from services.exclusivity_conflicts import project_conflicts  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

TEST_PASSWORD = "Monsoon2026!Inflo"

USERS = {
    "B": {"email": "brandadmin@connect-inflo.test", "display_name": "Bela Admin", "account_type": "brand"},
    "B2": {"email": "brandtwo@connect-inflo.test", "display_name": "Bina Admin", "account_type": "brand"},
    "BM": {"email": "brandmember@connect-inflo.test", "display_name": "Bimal Member", "account_type": "brand"},
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


def connect(token: str, target_type: str, target_id: str, category: str = "beauty", digest: str | None = None):
    return api.post(
        "/deals/connect",
        json={"target_type": target_type, "target_id": target_id, "category": category,
              "acknowledgement_digest": digest},
        headers={"Authorization": f"Bearer {token}"},
    )


def notices(admin: Client, deal_id: str) -> list[dict]:
    return admin.table("notifications").select("id,profile_id,tier,title,body,deal_id,read,created_at").eq("deal_id", deal_id).execute().data


def notice_count(admin: Client, ids: dict[str, str]) -> int:
    return len(admin.table("notifications").select("id").in_("profile_id", list(ids.values())).execute().data)


def seed_canonical_clause(admin: Client, creator_id: str, brand_id: str, category: str) -> str:
    prior = admin.table("deals").insert(
        {"creator_id": creator_id, "brand_id": brand_id, "deal_name": "Fictional prior agreement",
         "direction": "inbound", "created_by": creator_id, "stage": "approval"}
    ).execute().data[0]["id"]
    admin.table("deal_participants").insert(
        {"deal_id": prior, "profile_id": creator_id, "participant_role": "creator"}
    ).execute()
    terms = copy.deepcopy(alignment_payload())
    evidence = terms["exclusivity"]["evidence"]
    terms["exclusivity"] = {"status": "found", "value": True, "evidence": evidence}
    terms["exclusivity_duration_days"] = {"status": "found", "value": 36500, "evidence": evidence}
    terms["exclusivity_category"] = {"status": "found", "value": category, "evidence": evidence}
    source = admin.table("ai_summaries").insert(
        {"deal_id": prior, "raw_output": {"source": "fictional connect warning"},
         "structured_terms": terms, "status": "approved",
         "schema_version": SCHEMA_VERSION, "prompt_version": PROMPT_VERSION}
    ).execute().data[0]
    contract = admin.table("contracts").insert(
        {"deal_id": prior, "version": 1, "status": "executed",
         "storage_path": f"{prior}/fictional-v1.pdf",
         "generated_from_summary_id": source["id"], "draft_source_sha256": "0" * 64}
    ).execute().data[0]
    admin.table("audit_log").insert(
        {"actor_id": creator_id, "action": "contract_executed", "entity_type": "deal",
         "entity_id": prior, "metadata": {"contract_id": contract["id"], "version": 1},
         "ip_address": "127.0.0.1"}
    ).execute()
    admin.rpc("materialize_canonical_exclusivity", {
        "p_deal_id": prior, "p_source_summary_id": source["id"],
        "p_actor_id": creator_id, "p_ip_address": "127.0.0.1"
    }).execute()
    mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='closed' WHERE id='{prior}'; " "SET session_replication_role = origin;")
    return prior


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup(admin)

    ids: dict[str, str] = {}
    brand_b_id = None
    brand_b2_id = None
    brand_b3_id = None
    brand_b4_id = None
    brand_no_admin_id = None

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
        brand_b3_id = admin.table("brands").insert({"company_name": "Fictional Three", "industry": "Beauty"}).execute().data[0]["id"]
        brand_no_admin_id = admin.table("brands").insert({"company_name": "Fictional Unstaffed", "industry": "Beauty"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            [
                {"brand_id": brand_b3_id, "profile_id": ids["B2"], "brand_role": "admin", "status": "active"},
                {"brand_id": brand_b3_id, "profile_id": ids["BM"], "brand_role": "member", "status": "active"},
            ]
        ).execute()
        prior = seed_canonical_clause(admin, ids["C"], brand_b2_id, "skincare")
        mgmt_sql(
            "INSERT INTO exclusivity_clauses "
            "(deal_id, has_exclusivity, category, duration_days, start_date, end_date) "
            f"VALUES ('{prior}', true, 'skincare', 36500, current_date, current_date + 36499)"
        )

        token_b = token_for(USERS["B"]["email"])
        token_c = token_for(USERS["C"]["email"])
        token_nobrand = token_for(USERS["NOBRAND"]["email"])

        # ── 1. Create ──────────────────────────────────────────────────────────
        r1 = connect(token_b, "creator", ids["C"])
        body1 = r1.json()
        check("connect returns 200", r1.status_code == 200)
        check("deal created at stage 'pending' (created=true)", body1.get("stage") == "pending" and body1.get("created") is True)
        deal_id = body1.get("deal_id")

        deal = admin.table("deals").select("brand_id, stage, direction, category").eq("id", deal_id).execute().data[0]
        check("deal.brand_id = caller's OWN brand (can't forge another)", deal["brand_id"] == brand_b_id)
        check("direction = 'inbound' (brand→creator)", deal["direction"] == "inbound")
        check("explicit category persisted", deal["category"] == "beauty")

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
        inbound_notices = notices(admin, deal_id)
        check("brand Connect writes one generic Important notice for creator only",
              len(inbound_notices) == 1 and inbound_notices[0]["profile_id"] == ids["C"] and
              inbound_notices[0]["tier"] == "important" and
              inbound_notices[0]["title"] == "Connection request received" and
              inbound_notices[0]["body"] == "You have a new connection request to review." and
              inbound_notices[0]["deal_id"] == deal_id and
              inbound_notices[0]["read"] is False and bool(inbound_notices[0]["created_at"]))

        # ── Exclusivity warning ──────────────────────────────────────────────────
        check("brand Connect reveals no cross-deal conflict", "exclusivity_warning" not in body1 and "exclusivity_conflicts" not in body1)

        # ── 2. Duplicate guard ───────────────────────────────────────────────────
        r2 = connect(token_b, "creator", ids["C"])
        body2 = r2.json()
        check("second connect returns the SAME deal (created=false)", body2.get("created") is False and body2.get("deal_id") == deal_id)
        dup_count = len(admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_b_id).execute().data)
        check("no duplicate deal row created", dup_count == 1)
        check("brand duplicate leaves exactly one request notice", len(notices(admin, deal_id)) == 1)

        # A creator cannot create a Pending request that no active admin can answer.
        before_unstaffed = notice_count(admin, ids)
        unstaffed = connect(token_c, "brand", brand_no_admin_id)
        check("brand without active admin returns stable friendly error",
              unstaffed.status_code == 409 and
              unstaffed.json().get("detail") == "This brand can't receive connection requests right now. Try again later.")
        check("unstaffed brand writes no deal graph or notice",
              not admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_no_admin_id).execute().data and
              notice_count(admin, ids) == before_unstaffed)

        # Creator Connect compares exact Unicode identity before creating anything.
        before = admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_b3_id).execute().data
        preflight = connect(token_c, "brand", brand_b3_id, "ＳＫＩＮＣＡＲＥ")
        warning = preflight.json().get("exclusivity_conflicts", {})
        conflict_rows = warning.get("conflicts", [])
        check("creator sees a structured exact-category warning", preflight.status_code == 200 and
              preflight.json().get("requires_acknowledgement") is True and len(conflict_rows) == 1 and
              conflict_rows[0].get("brand") == "Rival Co" and conflict_rows[0].get("category") == "skincare")
        check("source-null legacy row is excluded", len(conflict_rows) == 1)
        check("warning performs zero deal writes", before == admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_b3_id).execute().data)
        check("warning performs zero notice writes", notice_count(admin, ids) == before_unstaffed)
        forged = connect(token_c, "brand", brand_b3_id, "ＳＫＩＮＣＡＲＥ", "0" * 64)
        check("forged digest cannot create", forged.json().get("requires_acknowledgement") is True)
        check("forged digest performs zero notice writes", notice_count(admin, ids) == before_unstaffed)
        brand_b4_id = admin.table("brands").insert({"company_name": "Another Rival", "industry": "Beauty"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            {"brand_id": brand_b4_id, "profile_id": ids["B2"], "brand_role": "admin", "status": "active"}
        ).execute()
        seed_canonical_clause(admin, ids["C"], brand_b4_id, "Ｓｋｉｎｃａｒｅ")
        stale = connect(token_c, "brand", brand_b3_id, "ＳＫＩＮＣＡＲＥ", warning["digest"])
        fresh_warning = stale.json().get("exclusivity_conflicts", {})
        check("new canonical clause invalidates old digest without creating", stale.json().get("requires_acknowledgement") is True and
              fresh_warning.get("digest") != warning["digest"] and len(fresh_warning.get("conflicts", [])) == 2 and
              not admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_b3_id).execute().data and
              notice_count(admin, ids) == before_unstaffed)
        check("multiple conflicts sorted by normalized brand identity",
              [item["brand"] for item in fresh_warning["conflicts"]] == ["Another Rival", "Rival Co"])
        confirmed = connect(token_c, "brand", brand_b3_id, "ＳＫＩＮＣＡＲＥ", fresh_warning["digest"])
        confirmed_id = confirmed.json().get("deal_id")
        check("confirmed creator Connect creates one Pending deal", confirmed.status_code == 200 and confirmed.json().get("created") is True)
        outbound_parts = admin.table("deal_participants").select("profile_id,participant_role").eq("deal_id", confirmed_id).execute().data
        outbound_notices = notices(admin, confirmed_id)
        check("creator Connect selects the active brand admin as sole recipient",
              {part["profile_id"] for part in outbound_parts} == {ids["C"], ids["B2"]} and
              len(outbound_notices) == 1 and outbound_notices[0]["profile_id"] == ids["B2"] and
              outbound_notices[0]["tier"] == "important" and
              outbound_notices[0]["title"] == "Connection request received" and
              outbound_notices[0]["body"] == "You have a new connection request to review." and
              outbound_notices[0]["read"] is False and bool(outbound_notices[0]["created_at"]))
        override = admin.table("audit_log").select("metadata").eq("entity_id", confirmed_id).eq("action", "exclusivity_conflict_override").execute().data
        check("override audit binds digest and canonical clauses", len(override) == 1 and override[0]["metadata"]["digest"] == fresh_warning["digest"] and override[0]["metadata"]["conflict_count"] == 2)
        retry = connect(token_c, "brand", brand_b3_id, "another category", fresh_warning["digest"])
        check("duplicate retry reuses deal without conflict leak", retry.json().get("deal_id") == confirmed_id and retry.json().get("created") is False and "exclusivity_conflicts" not in retry.json())
        check("duplicate retry leaves one override audit", len(admin.table("audit_log").select("id").eq("entity_id", confirmed_id).eq("action", "exclusivity_conflict_override").execute().data) == 1)
        check("creator duplicate leaves exactly one request notice", len(notices(admin, confirmed_id)) == 1)

        try:
            admin.table("deals").update({"category": "beauty"}).eq("id", confirmed_id).execute()
            immutable = False
        except Exception:
            immutable = True
        check("category cannot be edited after Connect, even with service role", immutable)

        snapshot = admin.rpc("exclusivity_conflict_snapshot", {"p_creator_id": ids["C"]}).execute().data
        try:
            admin.rpc("connect_with_category", {
                "p_actor_id": ids["C"], "p_target_type": "brand", "p_target_id": brand_b4_id,
                "p_category": "beauty", "p_expected_snapshot": snapshot["snapshot"],
                "p_override_metadata": {}, "p_ip_address": "127.0.0.1",
            }).execute()
            rolled_back = False
        except Exception:
            rolled_back = not admin.table("deals").select("id").eq("creator_id", ids["C"]).eq("brand_id", brand_b4_id).neq("stage", "closed").execute().data
        check("late audit failure rolls back the whole Connect graph", rolled_back)
        check("late audit failure rolls back request notice", notice_count(admin, ids) == before_unstaffed + 1)

        concurrent_projection = project_conflicts(admin, ids["C"], "skincare")
        def confirmed_rpc(_index: int):
            worker = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            return worker.rpc("connect_with_category", {
                "p_actor_id": ids["C"], "p_target_type": "brand", "p_target_id": brand_b4_id,
                "p_category": "skincare", "p_expected_snapshot": concurrent_projection["snapshot"],
                "p_override_metadata": concurrent_projection["audit"], "p_ip_address": "127.0.0.1",
            }).execute().data
        with ThreadPoolExecutor(max_workers=2) as pool:
            bodies = list(pool.map(confirmed_rpc, range(2)))
        check("concurrent confirmation creates once and reuses once",
              [body.get("created") for body in bodies].count(True) == 1 and
              [body.get("created") for body in bodies].count(False) == 1 and
              len({body.get("deal_id") for body in bodies}) == 1)
        concurrent_id = bodies[0].get("deal_id")
        check("concurrent confirmation writes one override audit", concurrent_id is not None and
              len(admin.table("audit_log").select("id").eq("entity_id", concurrent_id).eq("action", "exclusivity_conflict_override").execute().data) == 1)
        check("concurrent confirmation writes one recipient notice",
              len(notices(admin, concurrent_id)) == 1 and notices(admin, concurrent_id)[0]["profile_id"] == ids["B2"])

        for invalid in ("", "   ", " skincare ", "x" * 201, "skin\ncare", "skin\u202ecare"):
            before_invalid = notice_count(admin, ids)
            response = connect(token_c, "brand", brand_b3_id, invalid)
            check(f"invalid category rejected: {invalid[:12]!r}", response.status_code == 422)
            check(f"invalid category writes no notice: {invalid[:12]!r}", notice_count(admin, ids) == before_invalid)

        anon_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        anon_client.auth.sign_in_with_password({"email": USERS["U"]["email"], "password": TEST_PASSWORD})
        try:
            anon_client.rpc("exclusivity_conflict_snapshot", {"p_creator_id": ids["C"]}).execute()
            direct_denied = False
        except Exception:
            direct_denied = True
        check("authenticated caller cannot invoke private conflict RPC", direct_denied)
        try:
            anon_client.table("deals").insert({"creator_id": ids["U"], "brand_id": brand_b3_id,
                                               "deal_name": "forged", "direction": "outbound", "created_by": ids["U"]}).execute()
            table_denied = False
        except Exception:
            table_denied = True
        check("authenticated caller cannot insert a category-free deal", table_denied)

        # ── 3. RBAC: brand user with NO membership → 403 ─────────────────────────
        r3 = connect(token_nobrand, "creator", ids["C"])
        check("brand user with no active membership is blocked (403)", r3.status_code == 403)
        check("unauthorized brand caller writes no notice", notice_count(admin, ids) == before_unstaffed + 2)

        # ── 4. RLS sanity: participant reads, non-participant doesn't ────────────
        c_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        c_client.auth.sign_in_with_password({"email": USERS["C"]["email"], "password": TEST_PASSWORD})
        check("participant (creator) CAN read the deal", len(c_client.table("deals").select("id").eq("id", deal_id).execute().data) == 1)
        check("inbound recipient sees own notice but not outbound actor notice",
              {n["id"] for n in c_client.table("notifications").select("id").execute().data} ==
              {inbound_notices[0]["id"]})
        try:
            c_client.table("deals").update({"category": "changed"}).eq("id", deal_id).execute()
            participant_category_denied = False
        except Exception:
            participant_category_denied = True
        check("authenticated participant cannot edit category", participant_category_denied)

        try:
            c_client.rpc("connect_with_category", {
                "p_actor_id": ids["C"], "p_target_type": "brand", "p_target_id": brand_b4_id,
                "p_category": "skincare", "p_expected_snapshot": snapshot["snapshot"],
                "p_override_metadata": None, "p_ip_address": "127.0.0.1",
            }).execute()
            create_rpc_denied = False
        except Exception:
            create_rpc_denied = True
        check("authenticated caller cannot invoke private atomic Connect RPC", create_rpc_denied)

        u_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        u_client.auth.sign_in_with_password({"email": USERS["U"]["email"], "password": TEST_PASSWORD})
        check("non-participant CANNOT read the deal (0 rows)", len(u_client.table("deals").select("id").eq("id", deal_id).execute().data) == 0)
        check("outsider sees no request notices", not u_client.table("notifications").select("id").in_("id", [inbound_notices[0]["id"], outbound_notices[0]["id"]]).execute().data)
        b_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        b_client.auth.sign_in_with_password({"email": USERS["B"]["email"], "password": TEST_PASSWORD})
        check("brand initiator sees no inbound request notice",
              not b_client.table("notifications").select("id").eq("id", inbound_notices[0]["id"]).execute().data)
        b2_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        b2_client.auth.sign_in_with_password({"email": USERS["B2"]["email"], "password": TEST_PASSWORD})
        check("selected admin sees deal-linked centre row and deal",
              b2_client.table("notifications").select("id,profile_id,deal_id,tier,title,body,read,created_at").eq("id", outbound_notices[0]["id"]).execute().data == outbound_notices and
              len(b2_client.table("deals").select("id").eq("id", confirmed_id).execute().data) == 1)
        member_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        member_client.auth.sign_in_with_password({"email": USERS["BM"]["email"], "password": TEST_PASSWORD})
        check("other brand member cannot read selected-admin notice",
              not member_client.table("notifications").select("id").eq("id", outbound_notices[0]["id"]).execute().data)
        for label, operation in (
            ("direct insert", lambda: b2_client.table("notifications").insert({"profile_id": ids["B2"], "tier": "important", "title": "forged", "body": "forged"}).execute()),
            ("direct update", lambda: b2_client.table("notifications").update({"read": True}).eq("id", outbound_notices[0]["id"]).execute()),
        ):
            try:
                operation()
                denied = False
            except Exception:
                denied = True
            check(f"authenticated notification {label} denied", denied)
        marked = b2_client.rpc("mark_notification_read", {"p_notification_id": outbound_notices[0]["id"]}).execute().data
        check("recipient mark-read RPC owns new request row", marked is True and notices(admin, confirmed_id)[0]["read"] is True)

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
