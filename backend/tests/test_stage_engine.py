"""Phase 9 — task 9.8: Stage Transition Engine.

Proves the ONE server-side state machine (services/stage_engine.request_transition)
is the sole, correct path for every stage change. Realistic fictional data.

Most cases call request_transition directly (it runs on service_role, so no HTTP/JWT
needed) against admin-seeded deals placed in specific stages. Two cases go through
the real FastAPI endpoint with a real JWT to prove accept/decline still route
through the engine (regression). test_accept_decline.py covers accept/decline in
full and must stay green alongside this.

Covers:
  • structural: registry forward-edges == deal-engine.md guard table (forward-only)
  • legal transition advances + logs a transition row + writes an audit row
  • illegal, each independently: wrong current stage (409), wrong role (403),
    backward (409), stage-skip (409), not-in-registry (409/422)
  • not-a-participant (403), recipient rule (403), system-auto not user-callable (409)
  • atomicity: the conditional-update RPC applied twice → 2nd returns false, no double-apply
  • regression: accept/decline via the HTTP endpoint still work through the engine

Requires migration 018. Run: python backend/tests/test_stage_engine.py
"""

import os
import re
import sys
from datetime import datetime, timedelta, timezone
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
from services.stage_engine import DealError, MAIN_LINE, REGISTRY, request_transition  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

TEST_PASSWORD = "Navratri2026!Inflo"
USERS = {
    "B": {"email": "b.admin@engine-inflo.test", "display_name": "Bela Admin", "account_type": "brand"},
    "C": {"email": "c.creator@engine-inflo.test", "display_name": "Chandni Roy", "account_type": "creator"},
    "X": {"email": "x.outsider@engine-inflo.test", "display_name": "Xena Outsider", "account_type": "creator"},
}
IP = "127.0.0.1"

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
results: list[tuple[str, bool]] = []
ids: dict[str, str] = {}
brand_id: str | None = None


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def expect_status(label: str, fn, status: int) -> None:
    """Assert calling fn() raises DealError with the given HTTP status."""
    try:
        fn()
        check(f"{label} (expected {status}, but it SUCCEEDED)", False)
    except DealError as exc:
        check(f"{label} → {exc.status_code}", exc.status_code == status)


def mgmt_sql(sql: str) -> None:
    r = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        json={"query": sql},
        timeout=30,
    )
    r.raise_for_status()


def token_for(email: str) -> str:
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return c.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD}).session.access_token


def make_deal(stage: str, participants: list[tuple[str, str]], expires_hours: int | None = None, created_by: str | None = None) -> str:
    """Seed a deal directly in an arbitrary stage with chosen participant roles."""
    expires_at = (
        (datetime.now(timezone.utc) + timedelta(hours=expires_hours)).isoformat() if expires_hours is not None else None
    )
    deal_id = (
        admin.table("deals")
        .insert(
            {
                "creator_id": ids["C"],
                "brand_id": brand_id,
                "deal_name": "Engine test deal",
                "deal_type": "campaign",
                "stage": stage,
                "direction": "inbound",
                "currency": "INR",
                "created_by": created_by or ids["B"],
                "expires_at": expires_at,
            }
        )
        .execute()
        .data[0]["id"]
    )
    admin.table("deal_participants").insert(
        [{"deal_id": deal_id, "profile_id": pid, "participant_role": role} for pid, role in participants]
    ).execute()
    return deal_id


def cleanup() -> None:
    emails = {u["email"] for u in USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    uids = [u.id for u in leftover]
    if not uids:
        return
    quoted = ",".join(f"'{u}'" for u in uids)
    bare = ",".join(uids)
    mgmt_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    deals = admin.table("deals").select("id, brand_id").or_(f"created_by.in.({bare}),creator_id.in.({bare})").execute()
    brand_ids = set()
    for d in deals.data:
        admin.table("deals").delete().eq("id", d["id"]).execute()
        if d.get("brand_id"):
            brand_ids.add(d["brand_id"])
    members = admin.table("brand_members").select("brand_id").in_("profile_id", uids).execute()
    brand_ids.update(m["brand_id"] for m in members.data)
    for b in brand_ids:
        admin.table("brands").delete().eq("id", b).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def structural_tests() -> None:
    """The registry IS the forward-only spec — assert it matches deal-engine.md."""
    expected_edges = {
        ("pending", "chatting"),
        ("pending", "declined"),
        ("chatting", "approval"),
        ("chatting", "cancelled"),
        ("approval", "creating"),
        ("approval", "cancelled"),
        ("creating", "posted"),
        ("posted", "payment"),
        ("payment", "closed"),
    }
    check("registry edges exactly match deal-engine.md guard table + off-ramps", set(REGISTRY.keys()) == expected_edges)

    # Every main-line→main-line edge advances exactly one step (no backward, no skip).
    main_line_edges = [(f, t) for (f, t) in REGISTRY if f in MAIN_LINE and t in MAIN_LINE]
    all_forward_one = all(MAIN_LINE.index(t) == MAIN_LINE.index(f) + 1 for f, t in main_line_edges)
    check("every main-line edge is a single forward step (no backward, no skip)", all_forward_one)

    # No edge targets an earlier main-line stage anywhere in the registry.
    no_backward = not any(
        f in MAIN_LINE and t in MAIN_LINE and MAIN_LINE.index(t) <= MAIN_LINE.index(f) for f, t in REGISTRY
    )
    check("no registry edge moves backward", no_backward)


def main() -> None:
    global brand_id
    cleanup()

    try:
        for key, info in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            ).user.id
        admin.table("profiles").insert(
            [{"id": ids[k], "account_type": v["account_type"], "display_name": v["display_name"], "email": v["email"]} for k, v in USERS.items()]
        ).execute()
        brand_id = admin.table("brands").insert({"company_name": "Aster Labs", "industry": "Beauty"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"}
        ).execute()

        both = [(ids["C"], "creator"), (ids["B"], "brand_admin")]

        # ── Structural (forward-only proof) ──────────────────────────────────────
        structural_tests()

        # ── Legal transition: pending → chatting, logged + audited ───────────────
        d_ok = make_deal("pending", both, expires_hours=72)
        res = request_transition(d_ok, ids["C"], "chatting", IP)
        check("legal: transitioned=true, stage=chatting", res.get("transitioned") is True and res.get("stage") == "chatting")
        deal = admin.table("deals").select("stage, expires_at").eq("id", d_ok).execute().data[0]
        check("legal: deals.stage='chatting', expires_at cleared", deal["stage"] == "chatting" and deal["expires_at"] is None)
        trans = admin.table("deal_stage_transitions").select("from_stage,to_stage,transition_type,triggered_by").eq("deal_id", d_ok).eq("to_stage", "chatting").execute().data
        check("legal: pending→chatting 'gated' transition logged by caller", len(trans) == 1 and trans[0]["from_stage"] == "pending" and trans[0]["transition_type"] == "gated" and trans[0]["triggered_by"] == ids["C"])
        audit = admin.table("audit_log").select("action").eq("entity_id", d_ok).eq("action", "deal_accept").execute().data
        check("legal: audit_log 'deal_accept' row written", len(audit) == 1)

        # ── Illegal, each independently ──────────────────────────────────────────
        # wrong current stage: accept (from pending) on a deal that's already chatting
        d_chatting = make_deal("chatting", both)
        expect_status("wrong current stage: accept a non-pending deal", lambda: request_transition(d_chatting, ids["C"], "chatting", IP), 409)

        # backward move: creating → chatting
        d_creating = make_deal("creating", both)
        expect_status("backward move: creating → chatting", lambda: request_transition(d_creating, ids["C"], "chatting", IP), 409)

        # stage-skip: pending → creating (skips chatting/approval)
        d_skip = make_deal("pending", both, expires_hours=72)
        expect_status("stage-skip: pending → creating", lambda: request_transition(d_skip, ids["C"], "creating", IP), 409)

        # not in registry: pending → cancelled (no such edge) ; and an unknown stage
        d_nreg = make_deal("pending", both, expires_hours=72)
        expect_status("not in registry: pending → cancelled", lambda: request_transition(d_nreg, ids["C"], "cancelled", IP), 409)
        expect_status("unknown target stage → 422", lambda: request_transition(d_nreg, ids["C"], "banana", IP), 422)

        # wrong role: a creator can't confirm posts (posted → payment is brand-only)
        d_posted = make_deal("posted", both)
        expect_status("wrong role: creator triggers confirm-posts", lambda: request_transition(d_posted, ids["C"], "payment", IP), 403)

        # not a participant: an outsider can't act on the deal
        d_out = make_deal("pending", both, expires_hours=72)
        expect_status("not a participant: outsider triggers accept", lambda: request_transition(d_out, ids["X"], "chatting", IP), 403)

        # recipient rule: the initiator (created_by) can't accept their own request
        expect_status("recipient rule: initiator triggers accept", lambda: request_transition(d_out, ids["B"], "chatting", IP), 403)

        # system-auto is not directly user-callable
        d_approval = make_deal("approval", both)
        expect_status("system-auto: approval → creating rejected for a user caller", lambda: request_transition(d_approval, ids["C"], "creating", IP), 409)

        # ── Atomicity: the conditional-update RPC can't double-apply ─────────────
        d_atom = make_deal("pending", both, expires_hours=72)
        rpc_args = {
            "p_deal_id": d_atom, "p_from_stage": "pending", "p_to_stage": "chatting",
            "p_transition_type": "gated", "p_triggered_by": ids["C"], "p_clear_expiry": True,
            "p_audit_action": "deal_accept", "p_audit_actor": ids["C"], "p_audit_metadata": {}, "p_audit_ip": IP,
        }
        first = admin.rpc("apply_stage_transition", rpc_args).execute().data
        second = admin.rpc("apply_stage_transition", rpc_args).execute().data
        check("atomicity: 1st conditional apply returns true", first is True)
        check("atomicity: 2nd apply (already moved) returns false — no double-apply", second is False)
        atom_trans = admin.table("deal_stage_transitions").select("id").eq("deal_id", d_atom).eq("to_stage", "chatting").execute().data
        check("atomicity: exactly ONE transition row exists", len(atom_trans) == 1)
        # and the engine maps that false → 409 for a raced caller
        d_atom2 = make_deal("pending", both, expires_hours=72)
        admin.rpc("apply_stage_transition", {**rpc_args, "p_deal_id": d_atom2}).execute()  # move it out from under us
        expect_status("atomicity: engine maps a raced/already-moved apply to 409", lambda: request_transition(d_atom2, ids["C"], "chatting", IP), 409)

        # ── Regression: accept/decline still route through the engine (HTTP) ──────
        token_c = token_for(USERS["C"]["email"])
        d_http_accept = make_deal("pending", both, expires_hours=72)
        r_acc = api.post(f"/deals/{d_http_accept}/accept", json={"acknowledge_exclusivity": False}, headers={"Authorization": f"Bearer {token_c}"})
        check("regression: POST /accept → 200 chatting via engine", r_acc.status_code == 200 and r_acc.json().get("stage") == "chatting")
        d_http_decline = make_deal("pending", both, expires_hours=72)
        r_dec = api.post(f"/deals/{d_http_decline}/decline", headers={"Authorization": f"Bearer {token_c}"})
        check("regression: POST /decline → 200 declined via engine", r_dec.status_code == 200 and admin.table("deals").select("stage").eq("id", d_http_decline).execute().data[0]["stage"] == "declined")

        # ── Close endpoint reaches the live guard through the engine ─────────────
        d_close = make_deal("payment", both)
        r_close = api.post(
            f"/deals/{d_close}/close",
            json={"request_id": str(uuid4())},
            headers={"Authorization": f"Bearer {token_c}"},
        )
        check("POST /close reaches the live payment-completeness guard", r_close.status_code == 409)

    finally:
        print()
        print("Cleaning up test data...")
        cleanup()
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
