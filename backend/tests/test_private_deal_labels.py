"""Development-Supabase owner-RLS checks for freeform private deal labels.

Uses temporary fictional accounts and deletes all created fixtures on exit.
"""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from supabase import create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR.parent / ".env")

URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
RUN = uuid4().hex[:10]
PASSWORD = f"Fictional-Deal-Labels-{RUN}!"
admin = create_client(URL, SERVICE_KEY)
checks: list[tuple[str, bool]] = []
users: dict[str, str] = {}
deals: list[str] = []
annotation_ids: list[str] = []


def check(label: str, ok: bool) -> None:
    checks.append((label, ok))
    print(f"{'PASS' if ok else 'FAIL'} - {label}")


def client(key: str):
    row = create_client(URL, ANON_KEY)
    row.auth.sign_in_with_password({"email": f"{key}.{RUN}@inflo.test", "password": PASSWORD})
    return row


def make_user(key: str, account_type: str) -> None:
    email = f"{key}.{RUN}@inflo.test"
    user = admin.auth.admin.create_user({"email": email, "password": PASSWORD, "email_confirm": True}).user
    users[key] = user.id
    admin.table("profiles").insert({
        "id": user.id, "email": email, "display_name": f"Fictional {key}", "account_type": account_type,
    }).execute()


def make_deal(creator: str, brand_id: str, name: str) -> str:
    deal = admin.table("deals").insert({
        "creator_id": users[creator], "brand_id": brand_id, "deal_name": name,
        "direction": "inbound", "created_by": users["brand"], "stage": "pending",
    }).execute().data[0]["id"]
    admin.table("deal_participants").insert([
        {"deal_id": deal, "profile_id": users[creator], "participant_role": "creator"},
        {"deal_id": deal, "profile_id": users["brand"], "participant_role": "brand_admin"},
    ]).execute()
    deals.append(deal)
    return deal


def rows(who, deal_id: str) -> list[dict]:
    return who.table("private_annotations").select("id,entity_id,label").eq(
        "entity_type", "deal").eq("entity_id", deal_id).execute().data


def main() -> None:
    brand_id: str | None = None
    try:
        make_user("owner", "creator")
        make_user("brand", "brand")
        make_user("outsider", "creator")
        brand_id = admin.table("brands").insert({"company_name": f"Fictional label studio {RUN}", "industry": "Media"}).execute().data[0]["id"]
        admin.table("brand_members").insert({"brand_id": brand_id, "profile_id": users["brand"], "brand_role": "admin", "status": "active"}).execute()
        owner, participant, outsider = client("owner"), client("brand"), client("outsider")
        primary = make_deal("owner", brand_id, f"Fictional primary {RUN}")
        other = make_deal("owner", brand_id, f"Fictional other {RUN}")

        first = owner.table("private_annotations").insert({
            "profile_id": users["owner"], "entity_type": "deal", "entity_id": primary, "label": "Priority",
        }).execute().data[0]
        annotation_ids.append(first["id"])
        second = owner.table("private_annotations").insert({
            "profile_id": users["owner"], "entity_type": "deal", "entity_id": other, "label": "Priority",
        }).execute().data[0]
        annotation_ids.append(second["id"])
        participant_label = participant.table("private_annotations").insert({
            "profile_id": users["brand"], "entity_type": "deal", "entity_id": primary, "label": "Brand-only",
        }).execute().data[0]
        annotation_ids.append(participant_label["id"])
        check("owner reads separate same-text labels on each own deal", len(rows(owner, primary)) == 1 and len(rows(owner, other)) == 1)
        check("co-participant and owner each read only their own row; outsider reads none", {row["id"] for row in rows(participant, primary)} == {participant_label["id"]} and rows(outsider, primary) == [])

        participant_update = participant.table("private_annotations").update({"label": "Changed"}).eq("id", first["id"]).execute().data
        participant_delete = participant.table("private_annotations").delete().eq("id", first["id"]).execute().data
        outsider_update = outsider.table("private_annotations").update({"label": "Changed"}).eq("id", first["id"]).execute().data
        outsider_delete = outsider.table("private_annotations").delete().eq("id", first["id"]).execute().data
        check("non-owners cannot update or delete another participant label", participant_update == [] and participant_delete == [] and outsider_update == [] and outsider_delete == [])

        owner_reverse_update = owner.table("private_annotations").update({"label": "Changed"}).eq("id", participant_label["id"]).execute().data
        owner_reverse_delete = owner.table("private_annotations").delete().eq("id", participant_label["id"]).execute().data
        check("original owner cannot read, update, or delete a co-participant label", participant_label["id"] not in {row["id"] for row in rows(owner, primary)} and owner_reverse_update == [] and owner_reverse_delete == [])

        owner.table("private_annotations").delete().eq("id", first["id"]).execute()
        check("exact annotation-ID deletion preserves same label on another deal", rows(owner, primary) == [] and [row["id"] for row in rows(owner, other)] == [second["id"]])

        shared = admin.table("deals").select("id,deal_name,stage").eq("id", other).single().execute().data
        check("shared deal response has no private label field or value", "private" not in str(shared).lower() and "Priority" not in str(shared))
    finally:
        if annotation_ids:
            admin.table("private_annotations").delete().in_("id", annotation_ids).execute()
        for deal in deals:
            admin.table("deals").delete().eq("id", deal).execute()
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
        for user_id in users.values():
            admin.auth.admin.delete_user(user_id)

    failures = [label for label, ok in checks if not ok]
    print(f"\n{len(checks) - len(failures)}/{len(checks)} private-deal-label checks passed")
    if failures:
        raise SystemExit("Failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
