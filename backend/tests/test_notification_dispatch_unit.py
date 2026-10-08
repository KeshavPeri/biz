"""Focused fake-client checks for the post-commit FastAPI notice seam."""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from postgrest.exceptions import APIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import notification_dispatch as dispatch  # noqa: E402
from services import participant_service, stage_engine  # noqa: E402


class FakeQuery:
    def __init__(self, client: "FakeClient", table: str):
        self.client = client
        self.name = table
        self.rows = None
        self.filters = []

    def select(self, *_):
        return self

    def eq(self, field, value):
        self.filters.append((field, value, True))
        return self

    def neq(self, field, value):
        self.filters.append((field, value, False))
        return self

    def limit(self, *_):
        return self

    def insert(self, rows):
        self.rows = rows
        return self

    def execute(self):
        if self.rows is not None:
            if self.client.fail_insert:
                raise APIError({"message": "private candidate@example.test deal secret"})
            self.client.inserted.extend(self.rows)
            return SimpleNamespace(data=self.rows)
        data = self.client.select_rows.get(self.name, [])
        for field, value, equal in self.filters:
            data = [row for row in data if (row.get(field) == value) is equal]
        return SimpleNamespace(data=data)


class FakeClient:
    def __init__(self, **select_rows):
        self.select_rows = select_rows
        self.inserted: list[dict] = []
        self.fail_insert = False
        self.tables: list[str] = []
        self.unexpected_table: str | None = None
        self.rpc_data = {"idempotent": False}

    def table(self, name):
        self.tables.append(name)
        if name == self.unexpected_table:
            raise RuntimeError("private candidate@example.test deal secret")
        return FakeQuery(self, name)

    def rpc(self, name, args):
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.rpc_data))


class DispatchTests(unittest.TestCase):
    def test_three_tiers_and_defaults(self):
        for tier in ("critical", "important", "informational"):
            with self.subTest(tier=tier):
                client = FakeClient()
                result = dispatch.dispatch_in_app(
                    client, ["person-b", "", "person-a", "person-b", "  "],
                    tier=tier, title="Generic title", body="Generic body", deal_id="fictional-deal",
                )
                self.assertEqual(result, dispatch.DispatchResult(dispatch.DispatchStatus.INSERTED, 2))
                self.assertEqual(client.inserted, [
                    {"profile_id": recipient, "tier": tier, "title": "Generic title",
                     "body": "Generic body", "deal_id": "fictional-deal"}
                    for recipient in ("person-a", "person-b")
                ])
                self.assertFalse(any("read" in row or "created_at" in row for row in client.inserted))

    def test_empty_and_invalid(self):
        client = FakeClient()
        self.assertEqual(
            dispatch.dispatch_in_app(client, ["", "  "], tier="important", title="T", body="B"),
            dispatch.DispatchResult(dispatch.DispatchStatus.NO_RECIPIENTS),
        )
        with self.assertRaises(ValueError):
            dispatch.dispatch_in_app(client, ["person"], tier="urgent", title="T", body="B")
        self.assertEqual(client.tables, [])

    def test_failure_outcome_and_redacted_log(self):
        client = FakeClient()
        client.fail_insert = True
        with self.assertLogs("services.notification_dispatch", "WARNING") as logs:
            result = dispatch.dispatch_in_app(client, ["person"], tier="important",
                                              title="Private title", body="Private body", deal_id="private-deal")
        self.assertEqual(result, dispatch.DispatchResult(dispatch.DispatchStatus.FAILED, 1))
        self.assertEqual(logs.output, ["WARNING:services.notification_dispatch:in_app_notification_dispatch_failed"])
        self.assertEqual(client.inserted, [])

    def test_unexpected_table_failure_returns_redacted_outcome(self):
        client = FakeClient()
        client.unexpected_table = "notifications"
        with self.assertLogs("services.notification_dispatch", "WARNING") as logs:
            result = dispatch.dispatch_in_app(client, ["person"], tier="important",
                                              title="Private title", body="Private body", deal_id="private-deal")
        self.assertEqual(result, dispatch.DispatchResult(dispatch.DispatchStatus.FAILED, 1))
        self.assertEqual(logs.output, ["WARNING:services.notification_dispatch:in_app_notification_dispatch_failed"])

    def test_stage_selection_copy_and_failure_after_commit(self):
        client = FakeClient(deal_participants=[
            {"deal_id": "deal", "profile_id": "actor"}, {"deal_id": "deal", "profile_id": "other-b"},
            {"deal_id": "deal", "profile_id": "other-a"}, {"deal_id": "deal", "profile_id": "other-a"},
        ])
        transition = SimpleNamespace(to_stage="chatting")
        result = stage_engine._emit_transition_notification(client, {"id": "deal"}, transition, "actor")
        self.assertEqual(result.status, dispatch.DispatchStatus.INSERTED)
        self.assertEqual([row["profile_id"] for row in client.inserted], ["other-a", "other-b"])
        self.assertTrue(all(row["tier"] == "important" and row["title"] == "Deal updated"
                            and row["body"] == "This deal moved to Chatting." and row["deal_id"] == "deal"
                            for row in client.inserted))
        client.fail_insert = True
        with self.assertLogs("services.notification_dispatch", "WARNING"):
            failed = stage_engine._emit_transition_notification(client, {"id": "deal"}, transition, "actor")
        self.assertEqual(failed.status, dispatch.DispatchStatus.FAILED)

    def test_participant_notify_failure_and_generic_copy(self):
        client = FakeClient()
        result = participant_service._notify(client, ["approver-b", "approver-a", "approver-b"],
                                             "deal", "Participant request needs review",
                                             "A deal participant has requested a teammate addition.")
        self.assertEqual(result, dispatch.DispatchResult(dispatch.DispatchStatus.INSERTED, 2))
        self.assertEqual([row["profile_id"] for row in client.inserted], ["approver-a", "approver-b"])
        self.assertTrue(all(row["tier"] == "important" for row in client.inserted))
        client.fail_insert = True
        with self.assertLogs("services.notification_dispatch", "WARNING"):
            failed = participant_service._notify(client, ["requester"], "deal", "Teammate added",
                                                 "Your participant request has been completed.")
        self.assertEqual(failed.status, dispatch.DispatchStatus.FAILED)

    def test_stage_handled_and_retry_paths_emit_only_when_unhandled(self):
        transition = stage_engine.REGISTRY[("pending", "chatting")]
        deal = {"id": "deal", "stage": "pending", "created_by": "initiator"}
        client = FakeClient()
        outcomes = [
            stage_engine.handled({"transitioned": True, "notifications_handled": True}),
            stage_engine.handled({"transitioned": True, "idempotent": True}),
            stage_engine.deny(409, "Denied"),
            stage_engine.handled({"transitioned": True}),
        ]
        emitted = []
        fake_transition = replace(transition, guard=lambda _: outcomes.pop(0))
        with patch.dict(stage_engine.REGISTRY, {("pending", "chatting"): fake_transition}), \
             patch.object(stage_engine, "_load_deal_for_transition", return_value=deal), \
             patch.object(stage_engine, "_participant_role", return_value="creator"), \
             patch.object(stage_engine, "_emit_transition_notification", side_effect=lambda *args: emitted.append(args)):
            self.assertEqual(stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client), {"transitioned": True})
            self.assertEqual(stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client), {"transitioned": True, "idempotent": True})
            with self.assertRaises(stage_engine.DealError):
                stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client)
            self.assertEqual(stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client), {"transitioned": True})
        self.assertEqual(len(emitted), 1)

    def test_committed_stage_success_survives_dispatch_failure(self):
        transition = stage_engine.REGISTRY[("pending", "chatting")]
        deal = {"id": "deal", "stage": "pending", "created_by": "initiator"}
        client = FakeClient(deal_participants=[{"deal_id": "deal", "profile_id": "other"}])
        client.fail_insert = True
        fake_transition = replace(transition, guard=lambda _: stage_engine.allow())
        with patch.dict(stage_engine.REGISTRY, {("pending", "chatting"): fake_transition}), \
             patch.object(stage_engine, "_load_deal_for_transition", return_value=deal), \
             patch.object(stage_engine, "_participant_role", return_value="creator"), \
             patch.object(stage_engine, "_apply_transition") as apply, \
             self.assertLogs("services.notification_dispatch", "WARNING") as logs:
            result = stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client)
        self.assertEqual(result, {"transitioned": True, "stage": "chatting"})
        apply.assert_called_once()
        self.assertEqual(logs.output, ["WARNING:services.notification_dispatch:in_app_notification_dispatch_failed"])

    def test_committed_stage_survives_unexpected_lookup_and_insert_failure(self):
        transition = stage_engine.REGISTRY[("pending", "chatting")]
        fake_transition = replace(transition, guard=lambda _: stage_engine.allow())
        deal = {"id": "deal", "stage": "pending", "created_by": "initiator"}
        for failing_table, logger, signal in (
            ("deal_participants", "services.stage_engine", "in_app_notification_post_commit_failed"),
            ("notifications", "services.notification_dispatch", "in_app_notification_dispatch_failed"),
        ):
            with self.subTest(failing_table=failing_table):
                client = FakeClient(deal_participants=[{"deal_id": "deal", "profile_id": "other"}])
                client.unexpected_table = failing_table
                with patch.dict(stage_engine.REGISTRY, {("pending", "chatting"): fake_transition}), \
                     patch.object(stage_engine, "_load_deal_for_transition", return_value=deal), \
                     patch.object(stage_engine, "_participant_role", return_value="creator"), \
                     patch.object(stage_engine, "_apply_transition") as apply, \
                     self.assertLogs(logger, "WARNING") as logs:
                    result = stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client)
                self.assertEqual(result, {"transitioned": True, "stage": "chatting"})
                apply.assert_called_once()
                self.assertEqual(logs.output, [f"WARNING:{logger}:{signal}"])
                self.assertEqual(client.inserted, [])

    def test_failed_atomic_stage_apply_does_not_dispatch(self):
        transition = stage_engine.REGISTRY[("pending", "chatting")]
        fake_transition = replace(transition, guard=lambda _: stage_engine.allow())
        deal = {"id": "deal", "stage": "pending", "created_by": "initiator"}
        client = FakeClient(deal_participants=[{"deal_id": "deal", "profile_id": "other"}])
        with patch.dict(stage_engine.REGISTRY, {("pending", "chatting"): fake_transition}), \
             patch.object(stage_engine, "_load_deal_for_transition", return_value=deal), \
             patch.object(stage_engine, "_participant_role", return_value="creator"), \
             patch.object(stage_engine, "_apply_transition", side_effect=stage_engine.DealError(409, "Raced")), \
             patch.object(stage_engine, "_emit_transition_notification") as emit:
            with self.assertRaises(stage_engine.DealError):
                stage_engine.request_transition("deal", "actor", "chatting", "fictional-ip", _client=client)
        emit.assert_not_called()
        self.assertEqual(client.inserted, [])

    def test_committed_participant_request_survives_dispatch_failure(self):
        client = FakeClient(participant_add_decisions=[{"request_id": "request", "approver_profile_id": "approver"}])
        client.fail_insert = True
        expected = {"participants": ["fictional"]}
        with patch.object(participant_service, "get_supabase", return_value=client), \
             patch.object(participant_service, "_deal_and_role"), \
             patch.object(participant_service, "get_participant_management", return_value=expected), \
             self.assertLogs("services.notification_dispatch", "WARNING") as logs:
            result = participant_service.create_participant_request(
                "deal", "requester", "request", "candidate", "brand_maker", "Fictional reason", "fictional-ip"
            )
        self.assertEqual(result, expected)
        self.assertEqual(logs.output, ["WARNING:services.notification_dispatch:in_app_notification_dispatch_failed"])

    def test_committed_participant_actions_survive_unexpected_notice_failures(self):
        expected = {"participants": ["fictional"]}
        for failing_table, logger, signal in (
            ("participant_add_decisions", "services.participant_service", "in_app_notification_post_commit_failed"),
            ("notifications", "services.notification_dispatch", "in_app_notification_dispatch_failed"),
        ):
            with self.subTest(action="request", failing_table=failing_table):
                client = FakeClient(participant_add_decisions=[{"request_id": "request", "approver_profile_id": "approver"}])
                client.unexpected_table = failing_table
                with patch.object(participant_service, "get_supabase", return_value=client), \
                     patch.object(participant_service, "_deal_and_role"), \
                     patch.object(participant_service, "get_participant_management", return_value=expected), \
                     self.assertLogs(logger, "WARNING") as logs:
                    result = participant_service.create_participant_request(
                        "deal", "requester", "request", "candidate", "brand_maker", "Fictional reason", "fictional-ip"
                    )
                self.assertEqual(result, expected)
                self.assertEqual(logs.output, [f"WARNING:{logger}:{signal}"])
            if failing_table == "notifications":
                with self.subTest(action="decision"):
                    client = FakeClient(participant_add_requests=[
                        {"id": "request", "deal_id": "deal", "requested_by": "requester"}
                    ])
                    client.rpc_data = {"idempotent": False, "status": "approved"}
                    client.unexpected_table = "notifications"
                    with patch.object(participant_service, "get_supabase", return_value=client), \
                         patch.object(participant_service, "_deal_and_role"), \
                         patch.object(participant_service, "get_participant_management", return_value=expected), \
                         self.assertLogs("services.notification_dispatch", "WARNING") as logs:
                        result = participant_service.decide_participant_request(
                            "deal", "request", "approver", "approved", "fictional-ip"
                        )
                    self.assertEqual(result, expected)
                    self.assertEqual(logs.output, ["WARNING:services.notification_dispatch:in_app_notification_dispatch_failed"])


if __name__ == "__main__":
    unittest.main()
