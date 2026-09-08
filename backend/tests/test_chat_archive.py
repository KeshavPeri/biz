"""Development integration and deterministic PDF coverage for Closed chat archives."""

from __future__ import annotations

import io
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services.chat_archive_service import (  # noqa: E402
    MAX_MESSAGES, MAX_PDF_BYTES, SIGNED_URL_TTL_SECONDS, TEMPLATES, _render,
)


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Archive-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"archive.creator.{RUN_ID}@inflo.test", "Fictional Archive Creator", "creator"),
    "B": (f"archive.brand.{RUN_ID}@inflo.test", "Fictional Archive Brand Admin", "brand"),
    "I": (f"archive.invited.{RUN_ID}@inflo.test", "Fictional Archive Invited", "brand"),
    "O": (f"archive.outsider.{RUN_ID}@inflo.test", "Fictional Archive Outsider", "creator"),
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


def make_closed_deal(label: str, bodies: list[str]) -> tuple[str, list[str]]:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"], "brand_id": brand_id,
        "deal_name": f"Fictional archive {label} {RUN_ID}",
        "direction": "inbound", "created_by": ids["B"], "stage": "chatting",
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["I"], "participant_role": "brand_maker"},
    ]).execute()
    message_ids = []
    for index, body in enumerate(bodies):
        message_ids.append(admin.table("messages").insert({
            "deal_id": deal_id,
            "sender_id": ids["C"] if index % 2 == 0 else ids["B"],
            "body": body,
        }).execute().data[0]["id"])
    if message_ids:
        admin.table("message_attachments").insert({
            "message_id": message_ids[0],
            "storage_path": f"private/internal/{uuid4()}",
            "file_name": "fictional-proof.png", "file_type": "image/png", "file_size": 128,
        }).execute()
    admin.table("deals").update({"stage": "closed"}).eq("id", deal_id).execute()
    return deal_id, message_ids


def cleanup() -> None:
    print("\nCleaning up fictional archive data...")
    if deal_ids:
        paths = [f"deals/{deal_id}/chat-record.pdf" for deal_id in deal_ids]
        try:
            admin.storage.from_("deal-chat-archives").remove(paths)
        except Exception:
            pass
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
        quoted = ",".join(f"'{value}'" for value in ids.values())
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.audit_log WHERE actor_id IN ({quoted}); "
            "SET session_replication_role = origin;"
        )
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values():
        admin.auth.admin.delete_user(user_id)
    print("  cleanup complete")


def main() -> None:
    global brand_id
    escaped = TEMPLATES.get_template("chat-archive.html").render(
        deal_name="Fictional <script>alert(1)</script>", closed_at="08 Sep 2026",
        participant_labels="Creator & Brand",
        messages=[{"created_at": "08 Sep", "sender_label": "A < B", "body": "<img src=x onerror=1>", "attachments": []}],
    )
    pdf, pages = _render({
        "deal_name": "Fictional archive", "closed_at": "08 Sep 2026",
        "participant_labels": "Creator and Brand",
        "messages": [{"created_at": "08 Sep", "sender_label": "Creator", "body": "Safe fictional line", "attachments": []}],
    })
    check("template escapes untrusted plain text and renders a bounded valid PDF", (
        "<script>" not in escaped and "&lt;script&gt;" in escaped and "<img" not in escaped
        and pdf.startswith(b"%PDF") and 1 <= pages and len(pdf) <= MAX_PDF_BYTES
        and MAX_MESSAGES == 5000 and SIGNED_URL_TTL_SECONDS == 300
    ))

    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user({
                "email": email, "password": PASSWORD, "email_confirm": True,
            }).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": name, "account_type": account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token
        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Archive Studio {RUN_ID}", "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["I"], "brand_role": "member", "status": "invited"},
        ]).execute()

        first_body = "First fictional message with <script>not executable</script>."
        second_body = "Second fictional message after the first."
        expected_deal_name = f"Fictional archive complete {RUN_ID}"
        deal, message_ids = make_closed_deal("complete", [first_body, second_body])
        rows = admin.table("deal_chat_archives").select(
            "state,source_message_count,source_last_message_id"
        ).eq("deal_id", deal).execute().data
        check("first transition to Closed enqueues exactly one source-bound pending archive", (
            len(rows) == 1 and rows[0]["state"] == "pending"
            and rows[0]["source_message_count"] == 2 and rows[0]["source_last_message_id"] == message_ids[-1]
        ))
        check("only current participants receive archive status", (
            call("GET", f"/deals/{deal}/chat-archive", "C").status_code == 200
            and call("GET", f"/deals/{deal}/chat-archive", "B").status_code == 200
            and call("GET", f"/deals/{deal}/chat-archive", "I").status_code == 404
            and call("GET", f"/deals/{deal}/chat-archive", "O").status_code == 404
        ))

        private_note = "This private note must never enter the immutable chat record."
        note = call("POST", f"/deals/{deal}/post-close/entries", "C", {
            "visibility": "private", "body": private_note, "request_id": str(uuid4()),
        })
        prepared = call("POST", f"/deals/{deal}/chat-archive/prepare", "C")
        check("explicit preparation reaches a validated ready state", (
            note.status_code == 200 and prepared.status_code == 200
            and prepared.json()["state"] == "ready"
            and prepared.json()["message_count"] == 2
            and prepared.json()["page_count"] >= 1
            and prepared.json()["allowed_actions"] == {"can_retry": False, "can_download": True}
        ))
        download = call("GET", f"/deals/{deal}/chat-archive/download", "B")
        outsider_download = call("GET", f"/deals/{deal}/chat-archive/download", "O")
        content = httpx.get(download.json()["url"], timeout=30).content
        extracted = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)
        check("five-minute participant download contains the exact deal name, ordered escaped chat, and generic attachment labels only", (
            download.status_code == 200 and download.json()["expires_in"] == 300
            and outsider_download.status_code == 404 and content.startswith(b"%PDF")
            and expected_deal_name in extracted
            and extracted.find("First fictional") < extracted.find("Second fictional")
            and "fictional-proof.png" in extracted and "image/png" in extracted
            and private_note not in extracted and "private/internal" not in extracted
            and all(message_id not in extracted for message_id in message_ids)
        ))

        direct_client = auth_client("C")
        direct_table = direct_upload = direct_download = False
        try:
            direct_client.table("deal_chat_archives").select("*").eq("deal_id", deal).execute()
        except Exception:
            direct_table = True
        try:
            direct_client.storage.from_("deal-chat-archives").upload(
                f"deals/{deal}/forbidden.pdf", pdf, file_options={"content-type": "application/pdf"}
            )
        except Exception:
            direct_upload = True
        try:
            direct_client.storage.from_("deal-chat-archives").download(f"deals/{deal}/chat-record.pdf")
        except Exception:
            direct_download = True
        check("authenticated clients cannot inspect archive internals or access private objects directly", (
            direct_table and direct_upload and direct_download
        ))

        concurrent_deal, _ = make_closed_deal("reservation", ["One fictional message."])
        lease_a, lease_b = str(uuid4()), str(uuid4())
        with ThreadPoolExecutor(max_workers=2) as pool:
            reservations = list(pool.map(lambda lease: admin.rpc("reserve_deal_chat_archive", {
                "p_deal_id": concurrent_deal, "p_lease_token": lease,
            }).execute().data, [lease_a, lease_b]))
        check("concurrent reservations converge on one active generator", (
            sorted(row["reserved"] for row in reservations) == [False, True]
            and {row["state"] for row in reservations} == {"generating"}
        ))

        recovery_deal, recovery_messages = make_closed_deal("recovery", ["Recoverable fictional source."])
        admin.table("deal_chat_archives").update({"source_message_count": 2}).eq("deal_id", recovery_deal).execute()
        failed = call("POST", f"/deals/{recovery_deal}/chat-archive/prepare", "C")
        failed_status = call("GET", f"/deals/{recovery_deal}/chat-archive", "C")
        admin.table("deal_chat_archives").update({"source_message_count": 1}).eq("deal_id", recovery_deal).execute()
        recovered = call("POST", f"/deals/{recovery_deal}/chat-archive/prepare", "C")
        check("source mismatch fails safely and explicit idempotent retry recovers without changing Closed", (
            failed.status_code == 409 and failed_status.json()["state"] == "failed"
            and failed_status.json()["allowed_actions"] == {"can_retry": True, "can_download": False}
            and recovered.status_code == 200 and recovered.json()["state"] == "ready"
            and admin.table("deals").select("stage").eq("id", recovery_deal).single().execute().data["stage"] == "closed"
            and len(recovery_messages) == 1
        ))

        expired_deal, _ = make_closed_deal("expired-lease", ["Interrupted fictional source."])
        old_lease = str(uuid4())
        admin.rpc("reserve_deal_chat_archive", {"p_deal_id": expired_deal, "p_lease_token": old_lease}).execute()
        admin.table("deal_chat_archives").update({
            "lease_expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
        }).eq("deal_id", expired_deal).execute()
        recovered_lease = admin.rpc("reserve_deal_chat_archive", {
            "p_deal_id": expired_deal, "p_lease_token": str(uuid4()),
        }).execute().data
        check("an interrupted expired generation lease can be reserved safely for retry", recovered_lease["reserved"] is True)
    finally:
        cleanup()

    passed = sum(1 for _, ok in checks if ok)
    print(f"\nRESULT: {passed}/{len(checks)} checks passed")
    if passed != len(checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
