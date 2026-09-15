"""Development-Supabase integrity and privacy checks for chat attachments.

All accounts, deals, messages, reservations, and objects are fictional and are
removed at the end. Requires migration 047 on the development project.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import base64
import httpx
import os
from pathlib import Path
import sys
from uuid import uuid4

from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
RUN = uuid4().hex[:10]
PASSWORD = f"Fictional-Chat-Attachment-{RUN}!"
BUCKET = "deal-files"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC")

admin: Client = create_client(URL, SERVICE_KEY)
api = TestClient(app)
checks: list[tuple[str, bool]] = []
users: dict[str, str] = {}
emails: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
object_paths: set[str] = set()
message_ids: set[str] = set()
brand_id: str | None = None


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def rejected(callable_) -> bool:
    try:
        callable_()
        return False
    except Exception:  # noqa: BLE001 - denial is the assertion
        return True


def make_user(key: str, account_type: str) -> None:
    email = f"{key}.{RUN}@chat-files.inflo.test"
    response = admin.auth.admin.create_user({"email": email, "password": PASSWORD, "email_confirm": True})
    users[key], emails[key] = response.user.id, email
    admin.table("profiles").insert({
        "id": response.user.id,
        "email": email,
        "display_name": f"Fictional {key.title()}",
        "account_type": account_type,
    }).execute()


def auth_client(key: str) -> Client:
    client = create_client(URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": emails[key], "password": PASSWORD})
    tokens[key] = client.auth.get_session().access_token
    return client


def attachment_download(actor: str, deal_id: str, message_id: str, attachment_id: str):
    return api.get(
        f"/deals/{deal_id}/messages/{message_id}/attachments/{attachment_id}/download",
        headers={"Authorization": f"Bearer {tokens[actor]}"},
    )


def prepare(client: Client, deal_id: str, name: str = "campaign-still.png", mime: str = "image/png", size: int = len(PNG)) -> dict:
    return client.rpc("prepare_chat_attachment_upload", {
        "p_deal_id": deal_id,
        "p_file_name": name,
        "p_file_type": mime,
        "p_size_bytes": size,
    }).execute().data


def finalize(client: Client, deal_id: str, reservation_id: str, caption: str | None = None) -> dict:
    return client.rpc("finalize_chat_attachment_upload", {
        "p_deal_id": deal_id,
        "p_reservation_id": reservation_id,
        "p_caption": caption,
    }).execute().data


def upload(client: Client, path: str, body: bytes = PNG, mime: str = "image/png") -> None:
    client.storage.from_(BUCKET).upload(path, body, {"content-type": mime, "upsert": "false"})
    object_paths.add(path)


def setup() -> tuple[Client, Client, Client, str]:
    global brand_id
    make_user("creator", "creator")
    make_user("brand", "brand")
    make_user("outsider", "creator")
    brand_id = admin.table("brands").insert({
        "company_name": f"Fictional Chat Studio {RUN}", "industry": "Media",
    }).execute().data[0]["id"]
    admin.table("brand_members").insert({
        "brand_id": brand_id, "profile_id": users["brand"], "brand_role": "admin", "status": "active",
    }).execute()
    deal_id = admin.table("deals").insert({
        "creator_id": users["creator"], "brand_id": brand_id,
        "deal_name": f"Fictional attachment deal {RUN}", "direction": "inbound",
        "created_by": users["brand"], "stage": "pending",
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": users["creator"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": users["brand"], "participant_role": "brand_admin"},
    ]).execute()
    return auth_client("creator"), auth_client("brand"), auth_client("outsider"), deal_id


def run_checks() -> None:
    creator, brand, outsider, deal_id = setup()

    bucket = admin.storage.get_bucket(BUCKET)
    check("bucket is private, 50 MiB-capped, and MIME allowlisted", (
        bucket.public is False and bucket.file_size_limit == 52_428_800
        and set(bucket.allowed_mime_types or []) == {
            "application/pdf", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime",
        }
    ))

    invalid = [
        ("", "application/pdf", 1), ("../secret.pdf", "application/pdf", 1),
        ("folder/file.pdf", "application/pdf", 1), ("unsafe\x00.pdf", "application/pdf", 1),
        ("unsafe\u202efdp.exe", "application/pdf", 1), ("a" * 161 + ".pdf", "application/pdf", 1),
        ("folder\uff0ffile.pdf", "application/pdf", 1), ("folder\uff3cfile.pdf", "application/pdf", 1),
        ("wrong.png", "application/pdf", 1), ("archive.zip", "application/zip", 1),
        ("empty.pdf", "application/pdf", 0), ("large.pdf", "application/pdf", 10_485_761),
        ("large.mp4", "video/mp4", 52_428_801),
    ]
    check("prepare rejects blank, malformed, path, control/bidi, MIME, type, zero, and size violations", all(
        rejected(lambda row=row: prepare(creator, deal_id, row[0], row[1], row[2])) for row in invalid
    ))
    check("outsider cannot reserve against an inaccessible deal", rejected(lambda: prepare(outsider, deal_id)))

    reservation = prepare(brand, deal_id, "  Campaign   still.png  ")
    path = reservation["upload_path"]
    check("participant reservation is normalized and uses an opaque actor/deal-bound path", (
        reservation["file_name"] == "Campaign still.png"
        and path.startswith(f"{deal_id}/{users['brand']}/{reservation['reservation_id']}/")
        and "Campaign" not in path
    ))
    check("reservation coordination rows cannot be enumerated directly", rejected(
        lambda: brand.table("chat_attachment_uploads").select("*").execute()
    ))
    check("another user cannot upload to the reserved exact path", rejected(
        lambda: upload(creator, path)
    ))
    upload(brand, path)
    check("unbound objects remain unavailable to authenticated and anonymous reads", (
        rejected(lambda: brand.storage.from_(BUCKET).download(path))
        and rejected(lambda: create_client(URL, ANON_KEY).storage.from_(BUCKET).download(path))
        and rejected(lambda: outsider.storage.from_(BUCKET).create_signed_url(path, 300))
    ))
    check("another participant cannot finalize or hijack the reservation", rejected(
        lambda: finalize(creator, deal_id, reservation["reservation_id"], "Here is the still")
    ))
    message = finalize(brand, deal_id, reservation["reservation_id"], "  Here is the still  ")
    message_ids.add(message["id"])
    check("finalize atomically binds one sender message and one exact attachment", (
        message["body"] == "Here is the still"
        and message["attachment"]["storage_path"] == path
        and len(admin.table("messages").select("id").eq("id", message["id"]).execute().data) == 1
        and len(admin.table("message_attachments").select("id").eq("message_id", message["id"]).execute().data) == 1
    ))
    repeated = finalize(brand, deal_id, reservation["reservation_id"], "Here is the still")
    check("lost-response retry is idempotent and conflicting caption cannot duplicate", (
        repeated["id"] == message["id"] and repeated["idempotent"] is True
        and rejected(lambda: finalize(brand, deal_id, reservation["reservation_id"], "different"))
    ))
    brand_link = attachment_download("brand", deal_id, message["id"], message["attachment"]["id"])
    creator_link = attachment_download("creator", deal_id, message["id"], message["attachment"]["id"])
    check("backend signer returns exact five-minute participant links while outsiders and anonymous callers are denied", (
        brand_link.status_code == 200 and brand_link.json()["expires_in"] == 300
        and creator_link.status_code == 200 and creator_link.json()["expires_in"] == 300
        and httpx.get(brand_link.json()["url"], timeout=30).content == PNG
        and rejected(lambda: brand.storage.from_(BUCKET).create_signed_url(path, 86_400))
        and rejected(lambda: creator.storage.from_(BUCKET).download(path))
        and attachment_download("outsider", deal_id, message["id"], message["attachment"]["id"]).status_code == 403
        and api.get(
            f"/deals/{deal_id}/messages/{message['id']}/attachments/{message['attachment']['id']}/download"
        ).status_code in {401, 403}
    ))
    bound_delete_denied = rejected(lambda: brand.storage.from_(BUCKET).remove([path]))
    if not bound_delete_denied:
        bound_delete_denied = admin.storage.from_(BUCKET).download(path) == PNG
    check("direct attachment-row bypass and bound object deletion/replacement are denied", (
        rejected(lambda: brand.table("message_attachments").insert({
            "message_id": message["id"], "storage_path": "invented", "file_name": "fake.pdf",
            "file_type": "application/pdf", "file_size": 1,
        }).execute())
        and rejected(lambda: brand.table("messages").insert({
            "deal_id": deal_id, "sender_id": users["brand"], "body": None,
        }).execute())
        and rejected(lambda: brand.table("messages").insert({
            "deal_id": deal_id, "sender_id": users["brand"], "body": "\n\t",
        }).execute())
        and rejected(lambda: brand.table("messages").update({"body": None}).eq("id", message["id"]).execute())
        and bound_delete_denied
        and rejected(lambda: brand.storage.from_(BUCKET).upload(path, PNG, {"content-type": "image/png", "upsert": "true"}))
    ))

    text_message = brand.table("messages").insert({
        "deal_id": deal_id, "sender_id": users["brand"], "body": "Temporary fictional text",
    }).execute().data[0]
    message_ids.add(text_message["id"])
    text_null_denied = rejected(
        lambda: brand.table("messages").update({"body": None}).eq("id", text_message["id"]).execute()
    )
    brand.table("messages").update({"deleted_at": "2026-09-11T00:00:00Z"}).eq(
        "id", text_message["id"]
    ).execute()
    check("plain-text direct insert/soft-delete stays available without a null-body bypass", text_null_denied)

    racing = prepare(brand, deal_id, "race.png")
    upload(brand, racing["upload_path"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(
            lambda _: finalize(auth_client("brand"), deal_id, racing["reservation_id"], "race"),
            range(2),
        ))
    message_ids.add(outcomes[0]["id"])
    check("concurrent finalize creates exactly one message/attachment and returns one identity", (
        len({row["id"] for row in outcomes}) == 1
        and len(admin.table("message_attachments").select("id").eq("message_id", outcomes[0]["id"]).execute().data) == 1
    ))

    mismatch = prepare(brand, deal_id, "mismatch.png", "image/png", len(PNG) + 1)
    upload(brand, mismatch["upload_path"])
    check("finalize fails closed on actual Storage MIME/size mismatch with no partial message", (
        rejected(lambda: finalize(brand, deal_id, mismatch["reservation_id"], None))
        and admin.table("chat_attachment_uploads").select("bound_message_id").eq(
            "id", mismatch["reservation_id"]
        ).single().execute().data["bound_message_id"] is None
    ))
    brand.storage.from_(BUCKET).remove([mismatch["upload_path"]])

    close_race = prepare(brand, deal_id, "close-race.png")
    upload(brand, close_race["upload_path"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        finalize_future = pool.submit(lambda: (
            True, finalize(auth_client("brand"), deal_id, close_race["reservation_id"], "close race")
        ))
        close_future = pool.submit(lambda: admin.table("deals").update({"stage": "cancelled"}).eq("id", deal_id).execute())
        try:
            finalize_ok, close_message = finalize_future.result()
            message_ids.add(close_message["id"])
        except Exception:
            finalize_ok = False
        close_future.result()
    bound = admin.table("chat_attachment_uploads").select("bound_message_id").eq(
        "id", close_race["reservation_id"]
    ).single().execute().data["bound_message_id"]
    check("close/finalize race serializes to complete-before-terminal or no bind", (
        admin.table("deals").select("stage").eq("id", deal_id).single().execute().data["stage"] == "cancelled"
        and ((finalize_ok and bound is not None) or (not finalize_ok and bound is None))
    ))
    historical_link = attachment_download("creator", deal_id, message["id"], message["attachment"]["id"])
    historical_read = (
        historical_link.status_code == 200
        and historical_link.json()["expires_in"] == 300
        and httpx.get(historical_link.json()["url"], timeout=30).content == PNG
    )
    terminal_prepare_denied = rejected(lambda: prepare(brand, deal_id, "late.png"))
    terminal_cleanup_denied = bound is not None
    if bound is None:
        try:
            brand.storage.from_(BUCKET).remove([close_race["upload_path"]])
        except Exception:
            pass
        terminal_cleanup_denied = not rejected(
            lambda: admin.storage.from_(BUCKET).download(close_race["upload_path"])
        )
    check("terminal thread preserves historical participant read", historical_read)
    check("terminal thread rejects prepare and unbound cleanup", terminal_prepare_denied and terminal_cleanup_denied)
    check("already-bound finalize retry remains readable and idempotent after terminal transition", (
        finalize(brand, deal_id, reservation["reservation_id"], "Here is the still")["id"] == message["id"]
    ))

    admin.table("deal_participants").delete().eq("deal_id", deal_id).eq(
        "profile_id", users["creator"]
    ).execute()
    participant_gone = admin.table("deal_participants").select("id").eq(
        "deal_id", deal_id
    ).eq("profile_id", users["creator"]).execute().data == []
    check("removed participant immediately loses historical object access", (
        participant_gone
        and attachment_download("creator", deal_id, message["id"], message["attachment"]["id"]).status_code == 403
        and rejected(lambda: creator.storage.from_(BUCKET).create_signed_url(path, 300))
        and creator.storage.from_(BUCKET).list(f"{deal_id}/{users['brand']}") == []
    ))


def cleanup() -> None:
    for path in object_paths:
        try:
            admin.storage.from_(BUCKET).remove([path])
        except Exception:
            pass
    for deal_id in deal_ids:
        try:
            admin.table("deals").update({"stage": "pending"}).eq("id", deal_id).execute()
            admin.table("deals").delete().eq("id", deal_id).execute()
        except Exception:
            pass
    if brand_id:
        try:
            admin.table("brands").delete().eq("id", brand_id).execute()
        except Exception:
            pass
    for user_id in users.values():
        try:
            admin.auth.admin.delete_user(user_id)
        except Exception:
            pass


def main() -> None:
    try:
        run_checks()
    finally:
        cleanup()
    residue = sum(len(admin.table(table).select("id").in_("deal_id", deal_ids).execute().data) for table in (
        "messages", "chat_attachment_uploads",
    )) if deal_ids else 0
    if message_ids:
        residue += len(admin.table("message_attachments").select("id").in_("message_id", list(message_ids)).execute().data)
    residue += len(admin.table("profiles").select("id").in_("id", list(users.values())).execute().data) if users else 0
    residue += len(admin.table("deals").select("id").in_("id", deal_ids).execute().data) if deal_ids else 0
    check("fictional database and Storage fixtures leave zero residue", residue == 0 and all(
        rejected(lambda path=path: admin.storage.from_(BUCKET).download(path)) for path in object_paths
    ))
    failures = [label for label, ok in checks if not ok]
    print(f"RESULT: {len(checks) - len(failures)}/{len(checks)} chat-attachment checks passed")
    if failures:
        raise SystemExit("Failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
