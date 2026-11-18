"""Is the key valid, is there credit, what does a delivery cost? Reads only.

    LEGALSENT_API_KEY=ls_live_... python python/examples/check_account.py
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from legalsent import LegalSent, LegalSentError  # noqa: E402


def main():
    api = LegalSent(headers=json.loads(os.environ.get("LEGALSENT_EXTRA_HEADERS", "{}")))

    key = api.api_key_info()
    print(f"Key {key['prefix']}_{key['lookup']}…  created {key['createdAt']}")

    balance = api.balance()["balance"]
    print(f"Credit: {balance:.2f} EUR")

    for kind in ("ERDS", "QERDS"):
        rate = api.rate_for(kind)
        print(f"One {kind} delivery: {rate:.2f} EUR   (enough credit for {int(balance // rate)})")
    print("A delivery is one recipient on one channel: email and SMS together count twice.")

    page = api.list_dispatches(limit=5)
    print(f"\nDispatches so far: {page['pagination']['total']}")
    for d in page["data"]:
        who = " ".join(filter(None, [d.get("recipient_first_name"), d.get("recipient_last_name")])) or "(no recipient)"
        print(f"  {d['created_at']}  {d['status']:<10} {d['request_type']} {'+'.join(d['channels']):<9} {who}")


if __name__ == "__main__":
    try:
        main()
    except LegalSentError as e:
        print(f"\nThe API refused: {e}", file=sys.stderr)
        if e.request_id:
            print(f"  request id, for support: {e.request_id}", file=sys.stderr)
        sys.exit(1)
