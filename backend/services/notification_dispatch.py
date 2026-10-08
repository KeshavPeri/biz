"""Internal in-app notice writer for already-authorized backend services.

Callers choose recipients at their domain boundary and supply a service-role
client. This module does not expose an endpoint or decide email delivery.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterable, Literal

import httpx
from postgrest.exceptions import APIError


Tier = Literal["critical", "important", "informational"]
TIERS = frozenset({"critical", "important", "informational"})


class DispatchStatus(str, Enum):
    NO_RECIPIENTS = "no_recipients"
    INSERTED = "inserted"
    FAILED = "failed"


@dataclass(frozen=True)
class DispatchResult:
    status: DispatchStatus
    recipient_count: int = 0


_logger = logging.getLogger(__name__)


def dispatch_in_app(
    client: Any,
    recipient_ids: Iterable[str],
    *,
    tier: Tier,
    title: str,
    body: str,
    deal_id: str | None = None,
) -> DispatchResult:
    """Write one row per distinct recipient; report insert failures after commit.

    The client must be the authorized caller's service-role client. Database
    defaults supply unread state and creation time.
    """
    if tier not in TIERS:
        raise ValueError("Unsupported notification tier")

    recipients: list[str] = []
    try:
        recipients = sorted({value for value in recipient_ids if isinstance(value, str) and value.strip()})
        if not recipients:
            return DispatchResult(DispatchStatus.NO_RECIPIENTS)
        rows = [
            {"profile_id": recipient, "tier": tier, "title": title, "body": body, "deal_id": deal_id}
            for recipient in recipients
        ]
        client.table("notifications").insert(rows).execute()
    except (APIError, httpx.HTTPError):
        # Never include exception text: database/transport errors can carry row data.
        _logger.warning("in_app_notification_dispatch_failed")
        return DispatchResult(DispatchStatus.FAILED, len(recipients))
    except Exception:
        # SDK and fake clients may surface other ordinary failures after commit.
        _logger.warning("in_app_notification_dispatch_failed")
        return DispatchResult(DispatchStatus.FAILED, len(recipients))
    return DispatchResult(DispatchStatus.INSERTED, len(recipients))
