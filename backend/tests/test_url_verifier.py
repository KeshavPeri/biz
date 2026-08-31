"""Deterministic unit coverage for the live-post network boundary."""

from __future__ import annotations

import socket
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from services.url_verifier import (  # noqa: E402
    MAX_BODY_BYTES,
    RawResponse,
    UrlVerificationError,
    verify_live_post_url,
)
import services.url_verifier as url_verifier  # noqa: E402


PUBLIC_IP = "93.184.216.34"
HTML = b"""<html><head>
<title>Fallback title</title>
<meta property="og:title" content="Fictional launch">
<meta property="og:site_name" content="Example Social">
<meta name="description" content="A safe fictional public post">
<meta property="og:image" content="https://tracker.invalid/private.png">
</head><body><script>ignored()</script></body></html>"""


def resolver(_host: str) -> tuple[str, ...]:
    return (PUBLIC_IP,)


def ok_request(_url: str, _host: str, address: str, _timeout: float, _cancellation) -> RawResponse:
    return RawResponse(200, {"content-type": "text/html; charset=utf-8"}, HTML, address)


class UrlVerifierTests(unittest.TestCase):
    def assert_category(self, category: str, url: str, platform: str = "instagram", **kwargs) -> None:
        with self.assertRaises(UrlVerificationError) as caught:
            verify_live_post_url(url, platform, **kwargs)
        self.assertEqual(caught.exception.category, category)

    def test_every_named_platform_accepts_only_its_canonical_host_family(self) -> None:
        cases = {
            "instagram": "https://www.instagram.com/p/fictional/",
            "tiktok": "https://m.tiktok.com/v/fictional",
            "youtube": "https://youtu.be/fictional",
            "linkedin": "https://linkedin.com/posts/fictional",
            "x": "https://twitter.com/example/status/1",
            "pinterest": "https://pin.it/fictional",
            "threads": "https://threads.net/@example/post/fictional",
            "podcast": "https://episodes.example.org/fictional",
        }
        for platform, url in cases.items():
            with self.subTest(platform=platform):
                result = verify_live_post_url(url, platform, resolver=resolver, requester=ok_request)
                self.assertTrue(result.final_url.startswith("https://"))
                self.assertEqual(result.title, "Fictional launch")
                self.assertEqual(result.site_name, "Example Social")
                self.assertNotIn("image", result.__dict__)

    def test_platform_substrings_and_cross_platform_redirects_are_rejected(self) -> None:
        self.assert_category(
            "platform_mismatch",
            "https://instagram.com.evil.example/post",
            resolver=resolver,
            requester=ok_request,
        )

        def redirect(_url: str, _host: str, address: str, _timeout: float, _cancellation) -> RawResponse:
            return RawResponse(302, {"location": "https://evil.example/post"}, b"", address)

        self.assert_category(
            "platform_mismatch",
            "https://instagram.com/post",
            resolver=resolver,
            requester=redirect,
        )

    def test_redirect_chain_is_revalidated_and_normalized(self) -> None:
        responses = iter(
            [
                RawResponse(302, {"location": "/p/final#private-fragment"}, b"", PUBLIC_IP),
                RawResponse(200, {"content-type": "application/xhtml+xml"}, HTML, PUBLIC_IP),
            ]
        )

        def request(*_args) -> RawResponse:
            return next(responses)

        result = verify_live_post_url(
            "https://WWW.Instagram.com.:443/start#ignored",
            "instagram",
            resolver=resolver,
            requester=request,
        )
        self.assertEqual(result.final_url, "https://www.instagram.com/p/final")
        self.assertEqual(result.final_host, "www.instagram.com")

    def test_scheme_credentials_ports_literals_and_local_names_are_rejected(self) -> None:
        cases = [
            "http://instagram.com/post",
            "https://user:pass@instagram.com/post",
            "https://instagram.com:8443/post",
            "https://127.0.0.1/post",
            "https://localhost/post",
            "https://singlelabel/post",
        ]
        for url in cases:
            with self.subTest(url=url):
                with self.assertRaises(UrlVerificationError):
                    verify_live_post_url(url, "instagram", resolver=resolver, requester=ok_request)

    def test_all_non_public_ip_classes_are_rejected(self) -> None:
        addresses = [
            "127.0.0.1",       # loopback
            "10.0.0.8",        # private
            "169.254.169.254", # link-local / metadata
            "100.64.0.1",      # shared carrier-grade NAT range
            "224.0.0.1",       # multicast
            "192.0.2.10",      # reserved documentation range
            "0.0.0.0",         # unspecified
            "255.255.255.255", # reserved broadcast
            "::1",             # IPv6 loopback
            "fc00::1",         # IPv6 private
            "fe80::1",         # IPv6 link-local
            "ff02::1",         # IPv6 multicast
        ]
        for address in addresses:
            with self.subTest(address=address):
                self.assert_category(
                    "unsafe_destination",
                    "https://instagram.com/post",
                    resolver=lambda _host, value=address: (value,),
                    requester=ok_request,
                )

    def test_dns_rebinding_and_peer_mismatch_are_rejected(self) -> None:
        answers = iter([(PUBLIC_IP,), ("93.184.216.35",)])
        self.assert_category(
            "unsafe_destination",
            "https://instagram.com/post",
            resolver=lambda _host: next(answers),
            requester=ok_request,
        )

        def wrong_peer(_url: str, _host: str, _address: str, _timeout: float, _cancellation) -> RawResponse:
            return RawResponse(200, {"content-type": "text/html"}, HTML, "93.184.216.99")

        self.assert_category(
            "unsafe_destination",
            "https://instagram.com/post",
            resolver=resolver,
            requester=wrong_peer,
        )

    def test_timeout_and_dns_failure_are_stable_retryable_errors(self) -> None:
        def timeout(*_args) -> RawResponse:
            raise socket.timeout

        with self.assertRaises(UrlVerificationError) as caught:
            verify_live_post_url(
                "https://instagram.com/post", "instagram", resolver=resolver, requester=timeout
            )
        self.assertEqual(caught.exception.category, "timeout")
        self.assertTrue(caught.exception.retryable)

        def failed_dns(_host: str) -> tuple[str, ...]:
            raise socket.gaierror

        with self.assertRaises(UrlVerificationError) as caught:
            verify_live_post_url(
                "https://instagram.com/post", "instagram", resolver=failed_dns, requester=ok_request
            )
        self.assertEqual(caught.exception.category, "unreachable")
        self.assertTrue(caught.exception.retryable)

    def test_one_deadline_covers_dns_and_multi_address_fallback(self) -> None:
        class FakeClock:
            value = 0.0

            def __call__(self) -> float:
                return self.value

            def advance(self, seconds: float) -> None:
                self.value += seconds

        fake_clock = FakeClock()
        dns_calls = 0

        def delayed_resolver(_host: str) -> tuple[str, ...]:
            nonlocal dns_calls
            dns_calls += 1
            fake_clock.advance(1.0)
            return (PUBLIC_IP, "93.184.216.35")

        attempt_budgets: list[float] = []

        def delayed_request(_url: str, _host: str, address: str, timeout: float, _cancellation) -> RawResponse:
            attempt_budgets.append(timeout)
            if len(attempt_budgets) == 1:
                fake_clock.advance(5.0)
                raise OSError("fictional first address failed")
            # The second address receives only the three seconds left after two
            # DNS calls and the first attempt. A requester that overruns it is
            # rejected even if it returns a syntactically valid response.
            fake_clock.advance(3.1)
            return RawResponse(200, {"content-type": "text/html"}, HTML, address)

        self.assert_category(
            "timeout",
            "https://instagram.com/post",
            resolver=delayed_resolver,
            requester=delayed_request,
            clock=fake_clock,
        )
        self.assertEqual(dns_calls, 2)
        self.assertEqual(len(attempt_budgets), 2)
        self.assertAlmostEqual(attempt_budgets[0], 8.0)
        self.assertAlmostEqual(attempt_budgets[1], 3.0)

    def test_requester_that_ignores_timeout_cannot_extend_total_wall_time(self) -> None:
        received_budgets: list[float] = []

        def blocking_request(_url: str, _host: str, address: str, timeout: float, cancellation) -> RawResponse:
            received_budgets.append(timeout)
            cancellation.wait(0.5)
            cancellation.raise_if_cancelled()
            return RawResponse(200, {"content-type": "text/html"}, HTML, address)

        started = time.monotonic()
        with patch.object(url_verifier, "TOTAL_TIMEOUT_SECONDS", 0.1):
            self.assert_category(
                "timeout",
                "https://instagram.com/post",
                resolver=resolver,
                requester=blocking_request,
            )
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 0.3)
        self.assertEqual(len(received_budgets), 1)
        self.assertGreater(received_budgets[0], 0)
        self.assertLessEqual(received_budgets[0], 0.1)
        self.assertFalse(any(thread.name == "url-fetch-deadline" for thread in threading.enumerate()))

    def test_stalled_connection_is_shutdown_and_no_deadline_thread_survives(self) -> None:
        instances = []

        class StalledSocket:
            def __init__(self) -> None:
                self.shutdown_called = threading.Event()
                self.close_called = threading.Event()

            def shutdown(self, _how: int) -> None:
                self.shutdown_called.set()

            def close(self) -> None:
                self.close_called.set()

            def settimeout(self, _timeout: float) -> None:
                pass

        class StalledConnection:
            def __init__(self, *_args) -> None:
                self.sock = StalledSocket()
                instances.append(self)

            def request(self, *_args, **_kwargs) -> None:
                if not self.sock.shutdown_called.wait(1.0):
                    raise AssertionError("deadline did not shut down the stalled socket")
                raise OSError("fictional stalled response headers cancelled")

            def close(self) -> None:
                self.sock.close()

        started = time.monotonic()
        with (
            patch.object(url_verifier, "TOTAL_TIMEOUT_SECONDS", 0.1),
            patch.object(url_verifier, "_PinnedHTTPSConnection", StalledConnection),
        ):
            self.assert_category(
                "timeout",
                "https://instagram.com/post",
                resolver=resolver,
                requester=url_verifier._default_request,
            )
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 0.3)
        self.assertEqual(len(instances), 1)
        self.assertTrue(instances[0].sock.shutdown_called.is_set())
        self.assertTrue(instances[0].sock.close_called.is_set())
        self.assertFalse(any(thread.name == "url-fetch-deadline" for thread in threading.enumerate()))

    def test_redirect_body_and_content_type_budgets_fail_closed(self) -> None:
        self.assert_category(
            "response_too_large",
            "https://instagram.com/post",
            resolver=resolver,
            requester=lambda _u, _h, a, _t, _c: RawResponse(
                200, {"content-type": "text/html"}, b"x" * (MAX_BODY_BYTES + 1), a
            ),
        )
        self.assert_category(
            "unsupported_content_type",
            "https://instagram.com/post",
            resolver=resolver,
            requester=lambda _u, _h, a, _t, _c: RawResponse(
                200, {"content-type": "image/png"}, b"png", a
            ),
        )

        def loop(_u: str, _h: str, address: str, _t: float, _cancellation) -> RawResponse:
            return RawResponse(302, {"location": "/again"}, b"", address)

        self.assert_category(
            "too_many_redirects",
            "https://instagram.com/post",
            resolver=resolver,
            requester=loop,
        )

    def test_malformed_metadata_is_bounded_plain_text(self) -> None:
        markup = (
            b'<html><head><meta property="og:title" content="&lt;img src=x onerror=boom&gt;Safe">'
            b'<meta name="description" content="&lt;script&gt;owned&lt;/script&gt; Description">'
            b'</head><body>ignored'
        )
        result = verify_live_post_url(
            "https://instagram.com/post",
            "instagram",
            resolver=resolver,
            requester=lambda _u, _h, a, _t, _c: RawResponse(
                200, {"content-type": "text/html; charset=not-a-real-codec"}, markup, a
            ),
        )
        self.assertNotIn("<", result.title or "")
        self.assertNotIn("onerror", result.title or "")
        self.assertNotIn("<", result.description or "")
        self.assertLessEqual(len(result.title or ""), 200)
        self.assertLessEqual(len(result.description or ""), 500)


if __name__ == "__main__":
    unittest.main(verbosity=2)
