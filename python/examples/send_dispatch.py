"""Send one document to one person.

Without --send it only shows what would be sent and what it would cost.
With --send it delivers a real communication with legal effect and charges the
wallet: there is no test mode.

    python python/examples/send_dispatch.py --file lettera.pdf --subject "Sollecito di pagamento" \\
        --first-name Mario --last-name Rossi --email mario.rossi@example.com
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from legalsent import LegalSent, LegalSentError  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--type", default="ERDS", choices=["ERDS", "QERDS"], help="QERDS needs --tax-code")
    p.add_argument("--channels", default="EMAIL", help="EMAIL, SMS or EMAIL,SMS. Each channel is a separate, paid delivery")
    p.add_argument("--file", help="PDF, TXT, JPEG or PNG")
    p.add_argument("--text", help="a message without a file")
    p.add_argument("--subject")
    p.add_argument("--first-name")
    p.add_argument("--last-name")
    p.add_argument("--email")
    p.add_argument("--phone", help="international format, needed for SMS")
    p.add_argument("--tax-code", help="codice fiscale of the recipient, needed for QERDS")
    p.add_argument("--send", action="store_true", help="actually send")
    a = p.parse_args()

    api = LegalSent(headers=json.loads(os.environ.get("LEGALSENT_EXTRA_HEADERS", "{}")))
    channels = [c.strip().upper() for c in a.channels.split(",")]
    recipient = {k: v for k, v in {
        "firstName": a.first_name, "lastName": a.last_name, "email": a.email,
        "telefono": a.phone, "codiceFiscale": a.tax_code,
    }.items() if v}
    files = [a.file] if a.file else []
    api.dispatch_form(a.type, channels, recipient, a.subject, a.text, files)  # raises now if something is missing

    cost = api.rate_for(a.type) * len(channels)
    balance = api.balance()["balance"]
    print(f"To:    {a.first_name or ''} {a.last_name or ''}  {a.email or ''} {a.phone or ''}")
    print(f"What:  {a.file or '(text only)'}   subject: {a.subject or '(none)'}")
    print(f"How:   {a.type} by {' and '.join(channels)}")
    print(f"Cost:  about {cost:.2f} EUR   credit: {balance:.2f} EUR")

    if not a.send:
        print("\nNothing was sent. Add --send to deliver it for real.")
        return
    if balance < cost:
        sys.exit("Not enough credit: top up the wallet from the dashboard.")

    result = api.send_dispatch(a.type, channels, recipient, a.subject, a.text, files, confirm=True)
    print(f"\nSent. Dispatch id: {result['requestId']}")
    print(f"Charged: {result['amount']:.2f} EUR   status: {result['status']}")


if __name__ == "__main__":
    try:
        main()
    except LegalSentError as e:
        print(f"\nThe API refused: {e}", file=sys.stderr)
        if e.fields:
            print(f"  parameters at fault: {', '.join(e.fields)}", file=sys.stderr)
        if e.request_id:
            print(f"  request id, for support: {e.request_id}", file=sys.stderr)
        sys.exit(1)
