# For coding agents

You are working with the LegalSent API: it sends legally recognised electronic communications (the digital equivalent of a registered letter) by email and SMS. Read [`docs/api-reference.md`](docs/api-reference.md) before writing code that calls it. It is one file and it is complete.

## Rules that are not negotiable

1. **Never send without the user's explicit confirmation.** There is no sandbox. `POST /api/dispatches`, `POST /api/campaigns/{id}/dispatch` and `POST /api/campaigns/{id}/recipients/{recipientId}/resend` deliver a real communication with legal effect to a real person and charge money. Before calling any of them, show the user the recipient, the document, the type (`ERDS` or `QERDS`), the channels and the cost, and wait for a yes. A communication cannot be recalled.
2. **Do not run a send to "see if it works".** To check an integration use `node/test/smoke.mjs`, the read endpoints, campaign drafts and contact lists. A request you know will be refused (a JSON body on a send answers `400` with `reason: "body_not_form_data"`) proves the key and the route without sending.
3. **Never retry a send automatically.** It is not idempotent. After a timeout or a `5xx`, call `GET /api/dispatches?limit=5` and look for the dispatch before doing anything else.
4. **Never invent a price.** Read the rate from the API (`rateFor` / `rate_for` in the clients) and the real cost from the answer of the send.
5. **Do not rotate the API key** unless the user asks: it stops every other system that uses it, at once.
6. **Keep the key out of code, logs and commits.** It goes in the environment (`LEGALSENT_API_KEY`). `.env` is ignored by git here; keep it that way.
7. **Recipients are personal data.** Names, addresses, phone numbers and tax codes returned by the API are not to be logged or pasted anywhere they do not need to be.

## What to reach for

- A client in one file, no dependencies: [`node/legalsent.mjs`](node/legalsent.mjs) or [`python/legalsent.py`](python/legalsent.py). Copy it into the user's project rather than rewriting the HTTP calls.
- Both clients refuse to send unless called with `confirm: true` / `confirm=True`. Keep that guard. Do not hardcode the flag in a wrapper to make it go away.
- The examples in [`node/examples/`](node/examples) are the shape to follow: a dry run by default, `--send` to act.

## Facts that are easy to get wrong

- Sending and creating a campaign are `multipart/form-data`. Everything else that takes a body is JSON.
- `recipientData` is a JSON object sent as a text field. Always send it; do not rely on extraction from the document.
- `channels` defaults to email **and** SMS: two deliveries, two charges. Always set it.
- `QERDS` needs the recipient's `codiceFiscale`. `SMS` needs `telefono` in international format (`+39...`). `EMAIL` needs `email`.
- In the answer of a send, `requestId` is the dispatch id. In an error, `requestId` is a log reference.
- Creating a campaign does not send it: `POST /api/campaigns` makes a draft, `POST /api/campaigns/{id}/dispatch` sends it.
- A request over 4.5 MB is refused with `413` before it reaches the API.
- There are no webhooks. Statuses are refreshed every five minutes; poll at most every couple of minutes.
- Errors are `{ error, code, requestId }` plus `reason` and `fields` on validation errors. Branch on `code`, never on the text of `error`.

## Checking your work

```bash
node --test node/test/client.test.mjs                     # offline, no key
python -m unittest discover -s python -p "test_*.py"      # offline, no key
node --env-file=.env node/test/smoke.mjs                  # real API, sends nothing
```
