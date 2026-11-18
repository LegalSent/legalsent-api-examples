"""A small client for the LegalSent API. Standard library only: Python 3.9 or later.

    from legalsent import LegalSent
    api = LegalSent()                 # reads LEGALSENT_API_KEY
    print(api.balance())

Reference: https://api.legalsent.com/llms-full.txt

There is no sandbox. The three methods that deliver a communication and charge
the wallet (send_dispatch, dispatch_campaign, resend_recipient) refuse to run
unless called with confirm=True, so that nothing is ever sent by a script that
was only being tried out.
"""
from __future__ import annotations

import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
from urllib import error, parse, request

ALLOWED_TYPES = {"application/pdf", "text/plain", "image/jpeg", "image/png"}
FINAL_STATUSES = {"COMPLETED", "OPENED", "FAILED", "CANCELLED"}


class LegalSentError(Exception):
    """Every non-2xx answer. Branch on `code`; `reason` and `fields` say what to fix."""

    def __init__(self, status: int, body):
        b = body if isinstance(body, dict) else {}
        self.status = status
        self.code = b.get("code")
        self.reason = b.get("reason")
        self.fields = b.get("fields") or []
        self.request_id = b.get("requestId")  # quote this when asking for support
        self.body = body
        reason = f" ({self.reason})" if self.reason else ""
        super().__init__(f"{status} {self.code or 'ERROR'}{reason}: {b.get('error') or 'request failed'}")


def _need_confirm(confirm, what: str) -> None:
    if confirm is not True:
        raise ValueError(
            f"{what} delivers a real communication and charges the wallet: there is no test mode. "
            "Pass confirm=True when you mean it."
        )


def _file_part(f):
    """(name, bytes, content type) from a path or from {'name', 'data'[, 'type']}."""
    if isinstance(f, (str, Path)):
        f = {"path": f}
    name = f.get("name") or Path(f["path"]).name
    content_type = f.get("type") or mimetypes.guess_type(name)[0]
    if content_type not in ALLOWED_TYPES:
        raise ValueError(f"{name}: only PDF, plain text, JPEG and PNG files can be sent")
    data = f["data"] if "data" in f else Path(f["path"]).read_bytes()
    return name, data, content_type


def _multipart(fields: list, files: list):
    """Encode text fields and files as multipart/form-data. Returns (body, content type)."""
    boundary = "----legalsent" + uuid.uuid4().hex
    out = []
    for name, value in fields:
        out.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode())
        out.append(str(value).encode("utf-8") + b"\r\n")
    for field, (filename, data, content_type) in files:
        safe = filename.replace('"', "")
        out.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{safe}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n".encode()
        )
        out.append(data + b"\r\n")
    out.append(f"--{boundary}--\r\n".encode())
    return b"".join(out), f"multipart/form-data; boundary={boundary}"


class LegalSent:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float = 120, headers: dict | None = None):
        """
        api_key   default: LEGALSENT_API_KEY
        base_url  default: LEGALSENT_BASE_URL or https://api.legalsent.com
        timeout   seconds; a send can take up to a minute
        headers   extra headers on every request (a proxy, for instance)
        """
        self.api_key = api_key or os.environ.get("LEGALSENT_API_KEY")
        if not self.api_key:
            raise ValueError("No API key: set LEGALSENT_API_KEY or pass api_key.")
        self.base_url = (base_url or os.environ.get("LEGALSENT_BASE_URL") or "https://api.legalsent.com").rstrip("/")
        self.timeout = timeout
        self.headers = headers or {}

    def request(self, method: str, path: str, query: dict | None = None, json_body=None, form=None, binary: bool = False):
        """One request. Returns parsed JSON, or bytes when `binary` is set."""
        url = self.base_url + path
        params = {k: v for k, v in (query or {}).items() if v not in (None, "")}
        if params:
            url += "?" + parse.urlencode(params)
        headers = {**self.headers, "Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if form is not None:
            data, headers["Content-Type"] = form
        req = request.Request(url, data=data, method=method, headers=headers)
        try:
            with request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
        except error.HTTPError as e:
            raw = e.read()
            try:
                body = json.loads(raw)
            except ValueError:  # 405 and 413 have no JSON body
                body = None
            raise LegalSentError(e.code, body) from None
        return raw if binary else json.loads(raw)

    # ------------------------------------------------------------ wallet and account
    def balance(self):
        """{'success', 'balance', 'currency'}: credit left, in euro."""
        return self.request("GET", "/api/payment/balance")

    def transactions(self):
        return self.request("GET", "/api/payment/transactions")

    def pricing_profile(self):
        return self.request("GET", "/api/user/pricing-profile")

    def system_rates(self):
        return self.request("GET", "/api/system-settings/rates")

    def api_key_info(self):
        return self.request("GET", "/api/user/api-key")

    def rate_for(self, request_type: str) -> float:
        """Euro for one delivery (one recipient on one channel). Own rates, then the partner's, then standard."""
        key = "qerdsRate" if request_type == "QERDS" else "erdsRate"
        profile = self.pricing_profile()
        if profile.get("hasCustomPricing") and profile.get(key) is not None:
            return float(profile[key])
        partner = profile.get("partner")
        if partner and partner.get(key) is not None:
            return float(partner[key])
        return float(self.system_rates()[request_type])

    # ------------------------------------------------------------ dispatches
    def dispatch_form(self, request_type, channels, recipient, subject=None, content=None, files=(), bulk_dispatch_id=None, contact_list_id=None):
        """The multipart body of a send, without sending it."""
        if request_type not in ("ERDS", "QERDS"):
            raise ValueError('request_type must be "ERDS" or "QERDS"')
        if not channels:
            raise ValueError('channels must be ["EMAIL"], ["SMS"] or both: each one is a separate, paid delivery')
        if not isinstance(recipient, dict):
            raise ValueError("recipient is required: do not rely on extraction from the document")
        if not content and not files:
            raise ValueError("send content, files, or both")
        fields = [("requestType", request_type), ("channels", ",".join(channels)), ("recipientData", json.dumps(recipient, ensure_ascii=False))]
        if subject:
            fields.append(("emailSubject", subject))
        if content:
            fields.append(("content", content))
        if bulk_dispatch_id:
            fields.append(("bulk_dispatch_id", bulk_dispatch_id))
        if contact_list_id:
            fields.append(("contact_list_id", contact_list_id))
        return _multipart(fields, [("file", _file_part(f)) for f in files])

    def send_dispatch(self, request_type, channels, recipient, subject=None, content=None, files=(), bulk_dispatch_id=None, contact_list_id=None, confirm=False):
        """Send one communication to one recipient. REAL: it is delivered and charged.

        recipient: {'firstName', 'lastName', 'email', 'telefono', 'codiceFiscale'}
        Returns {'success', 'requestId' (the dispatch id), 'status', 'amount', ...}
        """
        _need_confirm(confirm, "send_dispatch")
        form = self.dispatch_form(request_type, channels, recipient, subject, content, files, bulk_dispatch_id, contact_list_id)
        return self.request("POST", "/api/dispatches", form=form)

    def list_dispatches(self, page=None, limit=None, name=None, bulk_dispatch_id=None):
        return self.request("GET", "/api/dispatches", query={"page": page, "limit": limit, "name": name, "bulkDispatchId": bulk_dispatch_id})

    def get_dispatch(self, dispatch_id: str):
        """One dispatch, with the latest events. Not more than once a minute per dispatch."""
        return self.request("GET", f"/api/dispatches/{dispatch_id}")

    def download_audit(self, dispatch_id: str, channel=None) -> bytes:
        """The proof of delivery, as a PDF. 404 NOT_FOUND until it exists: check `audit_available` first."""
        return self.request("GET", f"/api/dispatches/{dispatch_id}/audit", query={"channel": channel}, binary=True)

    def wait_for_dispatch(self, dispatch_id: str, interval: float = 120, timeout: float = 3600, on_poll=None):
        """Poll until COMPLETED, OPENED or FAILED. Statuses are refreshed every five minutes."""
        deadline = time.monotonic() + timeout
        while True:
            d = self.get_dispatch(dispatch_id)
            if on_poll:
                on_poll(d)
            if d["status"] in FINAL_STATUSES:
                return d
            if time.monotonic() + interval > deadline:
                raise TimeoutError(f"dispatch {dispatch_id} is still {d['status']}")
            time.sleep(interval)

    # ------------------------------------------------------------ groups of dispatches
    def create_group(self, metadata: dict | None = None):
        return self.request("POST", "/api/bulk-dispatches", json_body={"metadata": metadata or {}})

    def list_groups(self, page=None, limit=None):
        return self.request("GET", "/api/bulk-dispatches", query={"page": page, "limit": limit})

    # ------------------------------------------------------------ campaigns
    def create_campaign(self, request_type, name, channels=None, subject=None, message=None, recipients=(), files=(), contact_list_id=None):
        """Create a DRAFT. Nothing is sent or charged. Check 'recipientIssues' in the answer."""
        fields = [("requestType", request_type), ("campaignName", name), ("recipients", json.dumps(list(recipients), ensure_ascii=False))]
        if channels:
            fields.append(("channels", ",".join(channels)))
        if subject:
            fields.append(("emailSubject", subject))
        if message:
            fields.append(("messageBody", message))
        if contact_list_id:
            fields.append(("contact_list_id", contact_list_id))
        return self.request("POST", "/api/campaigns", form=_multipart(fields, [("files", _file_part(f)) for f in files]))

    def list_campaigns(self, page=None, limit=None, status=None):
        return self.request("GET", "/api/campaigns", query={"page": page, "limit": limit, "status": status})

    def get_campaign(self, campaign_id: str):
        return self.request("GET", f"/api/campaigns/{campaign_id}")

    def update_campaign(self, campaign_id: str, changes: dict):
        """changes: any of campaignName, emailSubject, messageBody, channels (list), requestType, recipients."""
        return self.request("PUT", f"/api/campaigns/{campaign_id}", json_body=changes)

    def update_recipient(self, campaign_id: str, recipient_id: str, changes: dict):
        """changes: {'email', 'telefono'}"""
        return self.request("PATCH", f"/api/campaigns/{campaign_id}/recipients/{recipient_id}", json_body=changes)

    def duplicate_campaign(self, campaign_id: str):
        return self.request("POST", f"/api/campaigns/{campaign_id}/duplicate")

    def dispatch_campaign(self, campaign_id: str, confirm=False):
        """Send the campaign to every pending recipient. REAL: delivered and charged."""
        _need_confirm(confirm, "dispatch_campaign")
        return self.request("POST", f"/api/campaigns/{campaign_id}/dispatch")

    def resend_recipient(self, campaign_id: str, recipient_id: str, confirm=False):
        """Send again to a FAILED or PARTIAL recipient. REAL: delivered and charged."""
        _need_confirm(confirm, "resend_recipient")
        return self.request("POST", f"/api/campaigns/{campaign_id}/recipients/{recipient_id}/resend")

    # ------------------------------------------------------------ contact lists
    def list_contact_lists(self, page=None, limit=None):
        return self.request("GET", "/api/contact-lists", query={"page": page, "limit": limit})

    def create_contact_list(self, name: str, description=None, contacts=None):
        body = {"listName": name}
        if description is not None:
            body["description"] = description
        if contacts:
            body["items"] = contacts
        return self.request("POST", "/api/contact-lists", json_body=body)

    def get_contact_list(self, list_id: str):
        return self.request("GET", f"/api/contact-lists/{list_id}")

    def delete_contact_list(self, list_id: str):
        return self.request("DELETE", f"/api/contact-lists/{list_id}")

    def list_contacts(self, list_id: str, page=None, limit=None, search=None):
        return self.request("GET", f"/api/contact-lists/{list_id}/items", query={"page": page, "limit": limit, "search": search})

    def add_contacts(self, list_id: str, contacts: list):
        """Adds contacts. One whose email is already in the list is updated instead."""
        return self.request("POST", f"/api/contact-lists/{list_id}/items", json_body={"items": contacts})

    def update_contact(self, list_id: str, contact_id: str, changes: dict):
        return self.request("PUT", f"/api/contact-lists/{list_id}/items", json_body={"itemId": contact_id, **changes})

    def delete_contact(self, list_id: str, contact_id: str):
        return self.request("DELETE", f"/api/contact-lists/{list_id}/items", query={"itemId": contact_id})
