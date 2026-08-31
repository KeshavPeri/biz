"""Fail-closed live-post URL verification.

The verifier never uses a browser and never returns remote markup. Every hop is
normalized, platform-checked, resolved twice, restricted to public addresses,
and fetched through a TLS connection pinned to the validated address.
"""

from __future__ import annotations

import http.client
import ipaddress
import queue
import re
import socket
import ssl
import threading
import time
import unicodedata
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from typing import Callable, Mapping, Sequence, TypeVar
from urllib.parse import quote, urljoin, urlsplit, urlunsplit


MAX_URL_LENGTH = 2048
MAX_REDIRECTS = 4
MAX_BODY_BYTES = 512 * 1024
CONNECT_TIMEOUT_SECONDS = 3.0
READ_TIMEOUT_SECONDS = 4.0
TOTAL_TIMEOUT_SECONDS = 10.0
USER_AGENT = "Inflo-LivePost-Verifier/1.0 (+https://inflo.example/security)"
SUPPORTED_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml"})

PLATFORM_HOSTS: dict[str, frozenset[str]] = {
    "instagram": frozenset({"instagram.com"}),
    "tiktok": frozenset({"tiktok.com"}),
    "youtube": frozenset({"youtube.com", "youtu.be"}),
    "linkedin": frozenset({"linkedin.com"}),
    "x": frozenset({"x.com", "twitter.com"}),
    "pinterest": frozenset({"pinterest.com", "pin.it"}),
    "threads": frozenset({"threads.net"}),
    "podcast": frozenset(),
}


class UrlVerificationError(Exception):
    """Stable, user-safe verification failure (never contains network internals)."""

    def __init__(self, category: str, detail: str, *, retryable: bool = False) -> None:
        super().__init__(detail)
        self.category = category
        self.detail = detail
        self.retryable = retryable


@dataclass(frozen=True)
class PreviewEvidence:
    submitted_url: str
    final_url: str
    final_host: str
    title: str | None
    site_name: str | None
    description: str | None


@dataclass(frozen=True)
class RawResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    peer_ip: str


Resolver = Callable[[str], Sequence[str]]
T = TypeVar("T")


class _AttemptCancellation:
    """Cooperative deadline signal with active network-close callbacks."""

    def __init__(self) -> None:
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._callbacks: list[Callable[[], None]] = []

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def wait(self, timeout: float | None = None) -> bool:
        return self._event.wait(timeout)

    def register(self, callback: Callable[[], None]) -> None:
        call_now = False
        with self._lock:
            if self._event.is_set():
                call_now = True
            else:
                self._callbacks.append(callback)
        if call_now:
            callback()

    def cancel(self) -> None:
        callbacks: list[Callable[[], None]] = []
        with self._lock:
            if self._event.is_set():
                return
            self._event.set()
            callbacks = list(self._callbacks)
            self._callbacks.clear()
        for callback in callbacks:
            try:
                callback()
            except Exception:
                pass

    def raise_if_cancelled(self) -> None:
        if self._event.is_set():
            raise TimeoutError


Requester = Callable[[str, str, str, float, _AttemptCancellation], RawResponse]


def _invalid(detail: str = "Enter a valid public HTTPS post URL.") -> UrlVerificationError:
    return UrlVerificationError("invalid_url", detail)


def _normalize_url(raw_url: str) -> tuple[str, str]:
    value = raw_url.strip()
    if not value or len(value) > MAX_URL_LENGTH:
        raise _invalid()
    if any(unicodedata.category(char).startswith("C") for char in value):
        raise _invalid()
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise _invalid() from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise _invalid()
    if parsed.username is not None or parsed.password is not None:
        raise _invalid("URLs containing sign-in details are not allowed.")
    if port not in (None, 443):
        raise _invalid("Only the standard HTTPS port is allowed.")
    try:
        host = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise _invalid() from exc
    if not host or "." not in host or host == "localhost" or host.endswith(".localhost"):
        raise UrlVerificationError("unsafe_destination", "That URL does not point to a public website.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise UrlVerificationError("unsafe_destination", "Direct IP-address URLs are not allowed.")
    path = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
    query = quote(parsed.query, safe="%/?@:!$&'()*+,;=-._~")
    normalized = urlunsplit(("https", host, path, query, ""))
    if len(normalized) > MAX_URL_LENGTH:
        raise _invalid()
    return normalized, host


def _host_matches_platform(host: str, platform: str) -> bool:
    if platform not in PLATFORM_HOSTS:
        return False
    if platform == "podcast":
        return True
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in PLATFORM_HOSTS[platform])


def _default_resolver(host: str) -> Sequence[str]:
    return tuple({row[4][0] for row in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})


def _timeout_error() -> UrlVerificationError:
    return UrlVerificationError(
        "timeout", "The post took too long to verify. Please try again.", retryable=True
    )


def _remaining_budget(deadline: float, clock: Callable[[], float]) -> float:
    remaining = deadline - clock()
    if remaining <= 0:
        raise _timeout_error()
    return remaining


def _run_with_timeout(call: Callable[[], T], timeout: float) -> T:
    results: queue.Queue[tuple[bool, object]] = queue.Queue(maxsize=1)

    def target() -> None:
        try:
            results.put((True, call()))
        except Exception as exc:  # converted to the stable category by the caller
            results.put((False, exc))

    threading.Thread(target=target, daemon=True).start()
    try:
        ok, value = results.get(timeout=max(timeout, 0.001))
    except queue.Empty as exc:
        raise TimeoutError from exc
    if not ok:
        raise value  # type: ignore[misc]
    return value  # type: ignore[return-value]


def _resolve_public(
    host: str,
    resolver: Resolver,
    deadline: float,
    clock: Callable[[], float],
) -> tuple[str, ...]:
    try:
        first_budget = min(_remaining_budget(deadline, clock), CONNECT_TIMEOUT_SECONDS)
        first = set(_run_with_timeout(lambda: resolver(host), first_budget))
        _remaining_budget(deadline, clock)
        second_budget = min(_remaining_budget(deadline, clock), CONNECT_TIMEOUT_SECONDS)
        second = set(_run_with_timeout(lambda: resolver(host), second_budget))
        _remaining_budget(deadline, clock)
    except UrlVerificationError:
        raise
    except TimeoutError as exc:
        raise _timeout_error() from exc
    except Exception as exc:
        raise UrlVerificationError(
            "unreachable", "The post host could not be reached. Please try again.", retryable=True
        ) from exc
    if not first or first != second:
        raise UrlVerificationError(
            "unsafe_destination", "The post host did not resolve consistently, so it was not fetched."
        )
    public: list[str] = []
    for raw_address in first:
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as exc:
            raise UrlVerificationError("unsafe_destination", "The post host returned an invalid address.") from exc
        if (
            not address.is_global
            or address.is_loopback
            or address.is_private
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            raise UrlVerificationError(
                "unsafe_destination", "That URL resolves to a network address that cannot be fetched."
            )
        public.append(address.compressed)
    return tuple(sorted(public))


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(
        self,
        host: str,
        address: str,
        timeout: float,
        cancellation: _AttemptCancellation,
    ) -> None:
        super().__init__(host, 443, timeout=timeout, context=ssl.create_default_context())
        self._address = address
        self._cancellation = cancellation

    def connect(self) -> None:
        self._cancellation.raise_if_cancelled()
        raw_socket = socket.create_connection((self._address, 443), self.timeout)
        # Publish the raw socket before TLS so cancellation from the deadline
        # timer can close a handshake that is currently blocked.
        self.sock = raw_socket
        self._cancellation.raise_if_cancelled()
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
        self._cancellation.raise_if_cancelled()


def _default_request(
    url: str,
    host: str,
    address: str,
    timeout: float,
    cancellation: _AttemptCancellation,
) -> RawResponse:
    # The attempt deadline starts before connect/TLS/request headers. The outer
    # verifier also watches the whole call against the deal-wide deadline, so a
    # slow response-header trickle cannot extend the overall budget.
    deadline = time.monotonic() + timeout
    parsed = urlsplit(url)
    target = parsed.path or "/"
    if parsed.query:
        target = f"{target}?{parsed.query}"
    connection = _PinnedHTTPSConnection(
        host,
        address,
        min(_remaining_budget(deadline, time.monotonic), CONNECT_TIMEOUT_SECONDS),
        cancellation,
    )

    def close_active_connection() -> None:
        active_socket = connection.sock
        if active_socket is not None:
            try:
                active_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        connection.close()

    cancellation.register(close_active_connection)
    try:
        cancellation.raise_if_cancelled()
        connection.request(
            "GET",
            target,
            headers={
                "Host": host,
                "User-Agent": USER_AGENT,
                "Accept": "text/html, application/xhtml+xml",
                "Accept-Encoding": "identity",
                "Connection": "close",
            },
        )
        cancellation.raise_if_cancelled()
        if connection.sock is not None:
            connection.sock.settimeout(
                min(READ_TIMEOUT_SECONDS, _remaining_budget(deadline, time.monotonic))
            )
        response = connection.getresponse()
        cancellation.raise_if_cancelled()
        _remaining_budget(deadline, time.monotonic)
        if connection.sock is None:
            raise OSError("missing peer")
        peer_ip = ipaddress.ip_address(connection.sock.getpeername()[0]).compressed
        content_length = response.getheader("Content-Length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_BODY_BYTES:
                    raise UrlVerificationError(
                        "response_too_large", "The post preview is too large to verify safely."
                    )
            except ValueError:
                pass
        body = bytearray()
        while True:
            cancellation.raise_if_cancelled()
            remaining = _remaining_budget(deadline, time.monotonic)
            connection.sock.settimeout(min(READ_TIMEOUT_SECONDS, remaining))
            chunk = response.read1(min(64 * 1024, MAX_BODY_BYTES + 1 - len(body)))
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > MAX_BODY_BYTES:
                raise UrlVerificationError(
                    "response_too_large", "The post preview is too large to verify safely."
                )
        return RawResponse(response.status, {key.lower(): value for key, value in response.getheaders()}, bytes(body), peer_ip)
    finally:
        connection.close()


class _TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _safe_text(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    parser = _TextParser()
    try:
        parser.feed(unescape(value))
        parser.close()
    except Exception:
        return None
    text = " ".join("".join(parser.parts).split())
    text = "".join(char for char in text if not unicodedata.category(char).startswith("C"))
    return text[:limit] or None


class _MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_title = False
        self.title_parts: list[str] = []
        self.metadata: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True
            return
        if tag.lower() != "meta":
            return
        values = {key.lower(): value for key, value in attrs if value is not None}
        key = (values.get("property") or values.get("name") or "").lower()
        content = values.get("content")
        if key and content is not None and key not in self.metadata:
            self.metadata[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


def _extract_preview(body: bytes, content_type: str) -> tuple[str | None, str | None, str | None]:
    charset_match = re.search(r"charset\s*=\s*[\"']?([A-Za-z0-9._-]+)", content_type, re.IGNORECASE)
    charset = charset_match.group(1) if charset_match else "utf-8"
    try:
        markup = body.decode(charset, errors="replace")
    except LookupError:
        markup = body.decode("utf-8", errors="replace")
    parser = _MetadataParser()
    try:
        parser.feed(markup)
        parser.close()
    except Exception:
        # HTMLParser is deliberately tolerant, but malformed provider output must
        # still never become an internal error or raw response leak.
        pass
    title = parser.metadata.get("og:title") or parser.metadata.get("twitter:title") or "".join(parser.title_parts)
    site_name = parser.metadata.get("og:site_name")
    description = (
        parser.metadata.get("og:description")
        or parser.metadata.get("twitter:description")
        or parser.metadata.get("description")
    )
    return _safe_text(title, 200), _safe_text(site_name, 120), _safe_text(description, 500)


def verify_live_post_url(
    submitted_url: str,
    platform: str,
    *,
    resolver: Resolver = _default_resolver,
    requester: Requester = _default_request,
    clock: Callable[[], float] = time.monotonic,
) -> PreviewEvidence:
    """Verify one public post URL and return bounded text-only evidence."""
    original = submitted_url.strip()
    current_url, current_host = _normalize_url(original)
    if not _host_matches_platform(current_host, platform):
        raise UrlVerificationError(
            "platform_mismatch", "That link does not match this deliverable's agreed platform."
        )
    deadline = clock() + TOTAL_TIMEOUT_SECONDS
    for redirect_count in range(MAX_REDIRECTS + 1):
        _remaining_budget(deadline, clock)
        addresses = _resolve_public(current_host, resolver, deadline, clock)
        response: RawResponse | None = None
        last_error: Exception | None = None
        for address in addresses:
            attempt_budget = _remaining_budget(deadline, clock)
            cancellation = _AttemptCancellation()
            deadline_timer = threading.Timer(attempt_budget, cancellation.cancel)
            deadline_timer.name = "url-fetch-deadline"
            deadline_timer.daemon = False
            deadline_timer.start()
            try:
                response = requester(
                    current_url,
                    current_host,
                    address,
                    attempt_budget,
                    cancellation,
                )
                cancellation.raise_if_cancelled()
                _remaining_budget(deadline, clock)
                if ipaddress.ip_address(response.peer_ip).compressed != ipaddress.ip_address(address).compressed:
                    raise UrlVerificationError(
                        "unsafe_destination", "The post host changed address during verification."
                    )
            except UrlVerificationError:
                if cancellation.cancelled:
                    raise _timeout_error()
                raise
            except (TimeoutError, socket.timeout) as exc:
                last_error = exc
            except Exception as exc:
                last_error = exc
            finally:
                deadline_timer.cancel()
                deadline_timer.join()
            if cancellation.cancelled:
                raise _timeout_error() from last_error
            if response is not None:
                break
        if response is None:
            try:
                _remaining_budget(deadline, clock)
            except UrlVerificationError as exc:
                raise exc from last_error
            category = "timeout" if isinstance(last_error, (TimeoutError, socket.timeout)) else "unreachable"
            raise UrlVerificationError(
                category, "The post could not be reached right now. Please try again.", retryable=True
            ) from last_error

        if response.status in {301, 302, 303, 307, 308}:
            location = response.headers.get("location")
            if redirect_count >= MAX_REDIRECTS:
                raise UrlVerificationError("too_many_redirects", "The post URL redirects too many times.")
            if not location:
                raise UrlVerificationError("bad_response", "The post URL returned an invalid redirect.")
            current_url, current_host = _normalize_url(urljoin(current_url, location))
            if not _host_matches_platform(current_host, platform):
                raise UrlVerificationError(
                    "platform_mismatch", "The post redirected away from its agreed platform."
                )
            continue

        if response.status == 429 or 500 <= response.status <= 599:
            raise UrlVerificationError(
                "unreachable", "The platform could not verify this post right now. Please try again.", retryable=True
            )
        if not 200 <= response.status <= 299:
            raise UrlVerificationError("unreachable", "The platform did not return a reachable public post.")
        content_type = response.headers.get("content-type", "").lower()
        media_type = content_type.split(";", 1)[0].strip()
        if media_type not in SUPPORTED_CONTENT_TYPES:
            raise UrlVerificationError(
                "unsupported_content_type", "That URL did not return a supported public post page."
            )
        if len(response.body) > MAX_BODY_BYTES:
            raise UrlVerificationError("response_too_large", "The post preview is too large to verify safely.")
        _remaining_budget(deadline, clock)
        title, site_name, description = _extract_preview(response.body, content_type)
        _remaining_budget(deadline, clock)
        return PreviewEvidence(original, current_url, current_host, title, site_name, description)

    raise UrlVerificationError("too_many_redirects", "The post URL redirects too many times.")
