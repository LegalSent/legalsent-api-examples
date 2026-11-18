# LegalSent API examples

Working code for the [LegalSent](https://legalsent.com) API: send a legally recognised electronic communication by email or SMS, follow it, and download the proof of delivery.

*Italiano: [README.it.md](README.it.md)*

> **There is no sandbox.** A send delivers a real communication with legal effect to a real person and charges your prepaid wallet. Every script here that can send does nothing of the kind unless you add `--send`, and the clients refuse to send without an explicit `confirm`. Everything else reads, or works on drafts and contact lists, and is safe to run while you build.

## What is here

| | |
| --- | --- |
| [`node/legalsent.mjs`](node/legalsent.mjs) | A client in one file. No dependencies, Node.js 20 or later |
| [`python/legalsent.py`](python/legalsent.py) | The same in Python. Standard library only, Python 3.9 or later |
| [`node/examples/`](node/examples) and [`python/examples/`](python/examples) | One runnable script per task |
| [`curl/examples.sh`](curl/examples.sh) | The same calls with nothing but `curl` |
| [`node/test/smoke.mjs`](node/test/smoke.mjs) | A check of your own key and account. Sends nothing, spends nothing |
| [`docs/api-reference.md`](docs/api-reference.md) | The full reference: every endpoint, field, error and limit |
| [`AGENTS.md`](AGENTS.md), [`llms.txt`](llms.txt) | For coding agents and language models working with this API |

Copy the one client file into your project and start from the example closest to what you need. There is nothing to install.

## Before you start

1. **A LegalSent account enabled as a sender.** New accounts are approved before they can send. Until then a send answers `403 SENDER_NOT_ACTIVATED`.
2. **Credit in the wallet.** Top up from the dashboard.
3. **An API key.** In the dashboard open **API Docs** and press **Rotate**. The key is shown once.

```bash
cp .env.example .env      # then put your key in it
```

## Try it

Check that the key works, how much credit there is and what a delivery costs. Reads only.

```bash
node --env-file=.env node/examples/01-check-account.mjs
```

Run the smoke test: ten checks of your key and account, nothing sent.

```bash
node --env-file=.env node/test/smoke.mjs
```

See what a send would do, without sending.

```bash
node --env-file=.env node/examples/02-send-dispatch.mjs \
  --file ./lettera.pdf --subject "Sollecito di pagamento" \
  --first-name Mario --last-name Rossi --email mario.rossi@example.com
```

Add `--send` to that command to deliver it for real. Then follow it and get the proof:

```bash
node --env-file=.env node/examples/03-follow-dispatch.mjs <dispatch id> --wait
```

In Python, the key comes from the environment:

```bash
export LEGALSENT_API_KEY=ls_live_...
python python/examples/check_account.py
python python/examples/send_dispatch.py --file lettera.pdf --subject "Sollecito" \
  --first-name Mario --last-name Rossi --email mario.rossi@example.com
```

## The examples

| Script | What it does | Sends? |
| --- | --- | --- |
| `01-check-account.mjs` | Key, credit, cost of a delivery, latest dispatches | no |
| `02-send-dispatch.mjs` | One document to one person | only with `--send` |
| `03-follow-dispatch.mjs` | Status of a dispatch; saves the proof of delivery | no |
| `04-campaign.mjs` | The same communication to a list of people: draft, check, send | only with `--send` |
| `05-contact-lists.mjs` | Create, fill, search and delete an address book | no |
| `python/examples/check_account.py` | As `01` | no |
| `python/examples/send_dispatch.py` | As `02` | only with `--send` |

## Using the client

```js
import { LegalSent, LegalSentError } from './legalsent.mjs';

const api = new LegalSent(); // reads LEGALSENT_API_KEY

try {
  const sent = await api.sendDispatch({
    requestType: 'ERDS',               // or 'QERDS': needs the recipient's codiceFiscale
    channels: ['EMAIL'],               // each channel is a separate, paid delivery
    subject: 'Sollecito di pagamento',
    recipient: { firstName: 'Mario', lastName: 'Rossi', email: 'mario.rossi@example.com' },
    files: ['./lettera.pdf'],
  }, { confirm: true });               // without this nothing is sent

  const done = await api.waitForDispatch(sent.requestId);
  if (done.audit_available) {
    fs.writeFileSync('proof.pdf', await api.downloadAudit(sent.requestId));
  }
} catch (error) {
  if (error instanceof LegalSentError) {
    // error.code      what to branch on: 'INSUFFICIENT_BALANCE', 'VALIDATION_FAILED', ...
    // error.reason    which rule: 'missing_recipient_fields', 'file_type_not_allowed', ...
    // error.fields    which parameters: ['email']
    // error.requestId what to quote to support
  }
}
```

```python
from legalsent import LegalSent, LegalSentError

api = LegalSent()
sent = api.send_dispatch(
    "ERDS", ["EMAIL"],
    {"firstName": "Mario", "lastName": "Rossi", "email": "mario.rossi@example.com"},
    subject="Sollecito di pagamento", files=["lettera.pdf"],
    confirm=True,
)
done = api.wait_for_dispatch(sent["requestId"])
```

## Five things to know

1. **Sending is `multipart/form-data`**, not JSON. The clients take care of it.
2. **Always say who the recipient is** (`recipient` / `recipientData`). Without it the API tries to read the recipient from the document, which can go wrong.
3. **Always say the channels.** The default is email and SMS together: two deliveries, two charges.
4. **Do not retry a send blindly.** There is no idempotency key: the same request twice is two communications. After a timeout or a `5xx`, list the latest dispatches before sending again.
5. **There are no webhooks.** Statuses are refreshed every five minutes: poll, at most once every couple of minutes.

The rest is in [`docs/api-reference.md`](docs/api-reference.md), also served as plain Markdown at <https://api.legalsent.com/llms-full.txt>.

## Tests

The clients are tested against a local stand-in server, with no network and no key:

```bash
node --test node/test/client.test.mjs
python -m unittest discover -s python -p "test_*.py"
```

## Support

Questions about the API: <support@legalsent.com>. When an error is involved, include its `requestId`.

## License

[MIT](LICENSE). Use this code as the starting point for your own.
