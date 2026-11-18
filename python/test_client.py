"""Tests of the client against a local stand-in server: no network, no key.

    python -m unittest discover -s python -p "test_*.py"
"""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from legalsent import LegalSent, LegalSentError  # noqa: E402


class StandIn:
    """A server that records what it receives and answers what the test tells it to."""

    def __init__(self, answer):
        seen = self.seen = []

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length).decode("latin-1")
                seen.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": body})
                status, payload, content_type = answer(self)
                raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.api = LegalSent(api_key="ls_live_TESTTEST_0123456789abcdefghijklmnopqrstuv", base_url=f"http://127.0.0.1:{self.server.server_port}/")

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def ok(payload):
    return lambda _req: (200, payload, "application/json")


class ClientTest(unittest.TestCase):
    def serve(self, answer):
        s = StandIn(answer)
        self.addCleanup(s.close)
        return s

    def test_key_is_sent_as_bearer(self):
        s = self.serve(ok({"success": True, "balance": 12.5, "currency": "eur"}))
        self.assertEqual(s.api.balance()["balance"], 12.5)
        self.assertEqual(s.seen[0]["headers"]["Authorization"], "Bearer ls_live_TESTTEST_0123456789abcdefghijklmnopqrstuv")
        self.assertEqual(s.seen[0]["path"], "/api/payment/balance")

    def test_send_is_multipart(self):
        s = self.serve(ok({"success": True, "requestId": "d1", "status": "PROCESSING", "amount": 3.05}))
        r = s.api.send_dispatch(
            "ERDS", ["EMAIL"], {"firstName": "Mario", "email": "mario@example.com"}, subject="Oggetto",
            files=[{"name": "lettera.pdf", "data": b"%PDF-1.4 test"}], confirm=True,
        )
        self.assertEqual(r["requestId"], "d1")
        req = s.seen[0]
        self.assertEqual((req["method"], req["path"]), ("POST", "/api/dispatches"))
        self.assertTrue(req["headers"]["Content-Type"].startswith("multipart/form-data; boundary="))
        self.assertIn('name="requestType"\r\n\r\nERDS', req["body"])
        self.assertIn('name="channels"\r\n\r\nEMAIL', req["body"])
        self.assertIn('name="recipientData"\r\n\r\n{"firstName": "Mario", "email": "mario@example.com"}', req["body"])
        self.assertIn('name="file"; filename="lettera.pdf"\r\nContent-Type: application/pdf', req["body"])

    def test_nothing_is_sent_without_confirm(self):
        s = self.serve(ok({}))
        with self.assertRaisesRegex(ValueError, "confirm=True"):
            s.api.send_dispatch("ERDS", ["EMAIL"], {"firstName": "M", "email": "m@example.com"}, content="x")
        with self.assertRaisesRegex(ValueError, "confirm=True"):
            s.api.send_dispatch("ERDS", ["EMAIL"], {"firstName": "M", "email": "m@example.com"}, content="x", confirm="yes")
        with self.assertRaisesRegex(ValueError, "confirm=True"):
            s.api.dispatch_campaign("c1")
        with self.assertRaisesRegex(ValueError, "confirm=True"):
            s.api.resend_recipient("c1", "r1")
        self.assertEqual(s.seen, [])

    def test_send_is_checked_before_it_leaves(self):
        s = self.serve(ok({}))
        r = {"firstName": "M", "email": "m@example.com"}
        for args, message in [
            (("erds", ["EMAIL"], r, None, "x"), "request_type"),
            (("ERDS", [], r, None, "x"), "channels"),
            (("ERDS", ["EMAIL"], None, None, "x"), "recipient"),
            (("ERDS", ["EMAIL"], r, None, None), "content, files"),
            (("ERDS", ["EMAIL"], r, None, None, [{"name": "a.zip", "data": b"x"}]), "only PDF"),
        ]:
            with self.assertRaisesRegex(ValueError, message):
                s.api.dispatch_form(*args)
        self.assertEqual(s.seen, [])

    def test_error_carries_code_reason_fields(self):
        body = {"error": "Some fields are missing or invalid.", "code": "VALIDATION_FAILED", "requestId": "req-1", "reason": "missing_recipient_fields", "fields": ["email"]}
        s = self.serve(lambda _req: (400, body, "application/json"))
        with self.assertRaises(LegalSentError) as ctx:
            s.api.list_dispatches()
        e = ctx.exception
        self.assertEqual((e.status, e.code, e.reason, e.fields, e.request_id), (400, "VALIDATION_FAILED", "missing_recipient_fields", ["email"], "req-1"))

    def test_error_without_json_body(self):
        s = self.serve(lambda _req: (413, b"Request Entity Too Large", "text/plain"))
        with self.assertRaises(LegalSentError) as ctx:
            s.api.balance()
        self.assertEqual((ctx.exception.status, ctx.exception.code), (413, None))

    def test_rate_precedence(self):
        profile = {"hasCustomPricing": True, "erdsRate": "2.50", "qerdsRate": "3.50", "partner": {"erdsRate": "2.00", "qerdsRate": "2.50"}}
        s = self.serve(lambda req: (200, profile if "pricing-profile" in req.path else {"ERDS": "3.05", "QERDS": "4.27"}, "application/json"))
        self.assertEqual(s.api.rate_for("ERDS"), 2.5)
        profile.update(hasCustomPricing=False, erdsRate=None, qerdsRate=None)
        self.assertEqual(s.api.rate_for("QERDS"), 2.5)
        profile.update(partner=None)
        self.assertEqual(s.api.rate_for("QERDS"), 4.27)

    def test_audit_is_bytes(self):
        s = self.serve(lambda _req: (200, b"%PDF-1.4 proof", "application/pdf"))
        self.assertEqual(s.api.download_audit("d1", channel="EMAIL"), b"%PDF-1.4 proof")
        self.assertEqual(s.seen[0]["path"], "/api/dispatches/d1/audit?channel=EMAIL")


if __name__ == "__main__":
    unittest.main()
