<!-- Copied from the LegalSent API reference. The live version is at https://api.legalsent.com/llms-full.txt -->

# LegalSent API

LegalSent sends legally recognised electronic communications by email and SMS: the digital equivalent of a registered letter, under the eIDAS regulation, delivered through InfoCert GoNotice. This API does what the dashboard does: send a communication, follow it, and download the proof.

- Base URL: `https://api.legalsent.com`
- Version: 2.0 (2026-11-18)
- Working examples: https://github.com/LegalSent/legalsent-api-examples
- This document as plain Markdown, for tools and language models: `https://api.legalsent.com/llms-full.txt`
- Support: support@legalsent.com. When an error is involved, quote its `requestId`

## Before you start

Three things must be true for an account, or sending is refused:

1. **The account is enabled as a sender.** New accounts are approved by InfoCert before they can send. Until then every send answers `403 SENDER_NOT_ACTIVATED`.
2. **The wallet has credit.** Each communication is paid from a prepaid wallet, topped up from the dashboard. With too little credit a send answers `402 INSUFFICIENT_BALANCE` and nothing is sent.
3. **You have an API key.** In the dashboard, open **API Docs** and press **Rotate**. The key is shown once. Rotating replaces the previous key at once, with no grace period.

**There is no sandbox.** A successful `POST /api/dispatches` or `POST /api/campaigns/{id}/dispatch` sends a real communication with legal effect to a real person and charges the wallet. Everything else in this API is safe to call while you build: reading, contact lists, creating and editing campaign drafts, and every request that is refused.

## Authentication

Send the key in the `Authorization` header of every request.

```
Authorization: Bearer ls_live_XXXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

The key is not accepted in the query string or in the body. Keep it on a server: anyone who has it can send communications at the account's expense.

| Situation | Answer |
| --- | --- |
| No `Authorization` header | `401 UNAUTHORIZED` |
| A key that is malformed | `401 UNAUTHORIZED` |
| A well-formed key that is wrong or was rotated away | `401 INVALID_API_KEY` |

## Conventions

- Responses are JSON, except the audit report (a PDF) and this documentation (Markdown).
- Identifiers are UUIDs. An identifier that does not exist, is malformed, or belongs to another account is always `404 NOT_FOUND`.
- Money is in euro. Rates and totals in lists come back as decimal strings (`"3.05"`); the result of a send and the balance are numbers.
- Timestamps are ISO 8601 in UTC (`2026-11-18T09:30:00.000Z`).
- Field names are not uniform: the result of a send is camelCase, lists are snake_case, and recipient fields keep their Italian names (`telefono`, `codiceFiscale`, `nomeECognome`). Use the names exactly as written here.
- Responses can contain fields that are not documented. Ignore them: only the documented ones are stable.
- Phone numbers are in international format: `+` and 10 to 15 digits, for example `+393331234567`.

## Errors

Every error has the same three keys. Two more appear when they help.

```json
{
  "error": "Some fields are missing or invalid.",
  "code": "VALIDATION_FAILED",
  "requestId": "0b94e0c5-1efc-4f17-8c13-52fbbda89e54",
  "reason": "missing_recipient_fields",
  "fields": ["email", "codiceFiscale"]
}
```

- `code` is what to branch on. `error` is a sentence for a person and can change.
- `requestId` identifies the request in our logs. Quote it when you ask for support.
- `reason` says which rule was broken and `fields` which parameters. Both are present on most `400` answers.

| HTTP | `code` | Meaning | What to do |
| --- | --- | --- | --- |
| 400 | `VALIDATION_FAILED` | The request is wrong | Read `reason` and `fields`, fix, send again |
| 400 | `RATE_NOT_CONFIGURED` | No price is set for this account | Contact support |
| 401 | `UNAUTHORIZED` | No key, or a malformed one | Send the `Authorization` header |
| 401 | `INVALID_API_KEY` | The key is wrong or was rotated | Use the current key |
| 402 | `INSUFFICIENT_BALANCE` | Not enough credit. Nothing was sent | Top up the wallet, then send again |
| 402 | `PAYMENT_FAILED` | The communication went out but the charge failed | Do not send again. Contact support with the `requestId` |
| 403 | `SENDER_NOT_ACTIVATED` | The account is not enabled as a sender | Complete the activation in the dashboard |
| 403 | `FORBIDDEN` | The account cannot use the API | Contact support |
| 404 | `NOT_FOUND` | No such resource for this account | Check the identifier |
| 405 | none | The method does not exist on this path | Check the method |
| 409 | `CONFLICT` | The same thing already exists | Do not repeat the request |
| 413 | none | The request is larger than 4.5 MB | Send smaller files |
| 502 | `DISPATCH_FAILED`, `GONOTICE_AUTH_FAILED`, `GONOTICE_UPLOAD_FAILED` | The delivery provider refused or was unreachable. Nothing was charged | Wait a minute and send again |
| 500 | `INTERNAL` | A fault on our side | Read "Retrying" below before you send again |

Values of `reason`:

| `reason` | Where | Meaning |
| --- | --- | --- |
| `body_not_form_data` | sends, campaign creation | The body must be `multipart/form-data`, not JSON |
| `body_not_json`, `body_not_json_object` | JSON endpoints | The body must be a JSON object |
| `invalid_request_type` | sends, campaigns | `requestType` must be exactly `ERDS` or `QERDS` |
| `invalid_channels` | sends, campaigns | `channels` has neither `EMAIL` nor `SMS` |
| `missing_content_or_file`, `missing_content` | sends | Neither `content` nor a file was sent |
| `file_too_large` | sends, campaigns | A file is over the size limit |
| `file_type_not_allowed` | sends, campaigns | A file is not PDF, plain text, JPEG or PNG |
| `pdf_no_text` | sends | The PDF chosen to read the recipient from has no text (a scan) |
| `missing_recipient_fields` | sends, re-send | The recipient lacks what the channel or the type requires; see `fields` |
| `invalid_id` | any | An identifier in the body or query is not a UUID; see `fields` |
| `bulk_dispatch_not_found`, `contact_list_not_found` | sends, campaigns | The group or list does not exist for this account |
| `invalid_status` | campaign list | Unknown `status` filter |
| `campaign_not_editable` | campaign edit | Only the name can change once a campaign has been sent |
| `campaign_not_dispatchable` | campaign send | The campaign is not a draft |
| `no_pending_recipients` | campaign send | The campaign has nobody left to send to |
| `recipient_not_resendable` | re-send | Only a failed or partly failed recipient can be re-sent |
| `nothing_to_update` | edits | The body contained nothing that can be changed |
| `missing_list_name`, `items_required`, `invalid_item_id` | contact lists | See `fields` |
| `invalid_email`, `invalid_phone`, `invalid_campaign_name` | campaigns | See `fields` |

### Retrying

Sending is not idempotent: there is no idempotency key, and the same request sent twice is two communications and two charges.

- After a `4xx` nothing was sent. Fix the request and send again.
- After `402 PAYMENT_FAILED` the communication **was** sent. Do not send again.
- After a `5xx`, a timeout or a dropped connection on a send, do not repeat it blindly. First call `GET /api/dispatches?limit=5`: if a new dispatch with status `PROCESSING` is there, it went out.
- Reads can always be repeated.

## Limits

| What | Limit |
| --- | --- |
| Size of one request, files included | 4.5 MB. Larger requests are refused with `413` before they reach the API |
| File types | `application/pdf`, `text/plain`, `image/jpeg`, `image/png` |
| `limit` in lists | 100 (200 for the contacts of a list). Larger values are lowered to the maximum |
| Duration of a send | Usually a few seconds, up to a minute. Use a client timeout of at least 120 seconds |
| Request rate | No published quota. Keep to a few requests per second and slow down on `429` or `5xx` |

## Quick start

```bash
export LEGALSENT_API_KEY="ls_live_..."
BASE=https://api.legalsent.com

# 1. The key works and there is credit
curl -s "$BASE/api/payment/balance" -H "Authorization: Bearer $LEGALSENT_API_KEY"

# 2. Send a PDF by email (this sends for real and charges the wallet)
curl -s -X POST "$BASE/api/dispatches" \
  -H "Authorization: Bearer $LEGALSENT_API_KEY" \
  -F "requestType=ERDS" \
  -F "channels=EMAIL" \
  -F "emailSubject=Sollecito di pagamento" \
  -F 'recipientData={"firstName":"Mario","lastName":"Rossi","email":"mario.rossi@example.com"}' \
  -F "file=@sollecito.pdf;type=application/pdf"
# → {"success":true,"requestId":"<dispatch id>","status":"PROCESSING","amount":3.05, ...}

# 3. Follow it
curl -s "$BASE/api/dispatches/<dispatch id>" -H "Authorization: Bearer $LEGALSENT_API_KEY"

# 4. Download the proof once "audit_available" is true
curl -s "$BASE/api/dispatches/<dispatch id>/audit" \
  -H "Authorization: Bearer $LEGALSENT_API_KEY" -o proof.pdf
```

## The two kinds of delivery

| | `ERDS` | `QERDS` |
| --- | --- | --- |
| What it is | Electronic registered delivery | Qualified electronic registered delivery |
| The recipient opens it | From a link | After identifying with SPID or CIE |
| Proves | Sending and delivery | Sending, delivery and reading by the identified person |
| Recipient's `codiceFiscale` | Not needed | Required |
| Can reach status `OPENED` | No | Yes |

Channels are `EMAIL`, `SMS` or both. Each channel is a separate delivery with its own cost: one recipient on both channels costs twice the rate, unless the account's pricing says otherwise. Never hardcode a price: read `amount` from the answer.

## Dispatches

A dispatch is one communication to one recipient.

### Send: `POST /api/dispatches`

`Content-Type: multipart/form-data`. A JSON body is refused.

| Field | Required | Description |
| --- | --- | --- |
| `requestType` | yes | `ERDS` or `QERDS`, in capitals |
| `channels` | no | `EMAIL`, `SMS` or `EMAIL,SMS`. Default: both. Send it always: the default costs two deliveries |
| `recipientData` | recommended | A JSON object, as text: who receives it. See below |
| `emailSubject` | recommended | Subject of the email. Without it the subject is a generic placeholder |
| `content` | yes, unless a file is sent | Text of the communication. Plain text, or simple HTML (`h1`-`h6`, `p`, `strong`, `br`) |
| `file` | yes, unless `content` is sent | A file to deliver. Repeat the field for several files |
| `extractionFileIndex` | no | With several files and no `recipientData`: which file to read the recipient from, counting from 0. Default 0 |
| `bulk_dispatch_id` | no | A group created with `POST /api/bulk-dispatches`, to find these dispatches together later |
| `contact_list_id` | no | One of your contact lists: the recipient is saved into it |

`recipientData`:

| Key | Required | |
| --- | --- | --- |
| `firstName`, `lastName` | at least one | Or `nomeECognome` with the full name |
| `email` | when `channels` has `EMAIL` | |
| `telefono` | when `channels` has `SMS` | International format |
| `codiceFiscale` | when `requestType` is `QERDS` | Italian tax code of the recipient |
| `oggetto` | no | Subject; takes precedence over `emailSubject` |

Without `recipientData`, the recipient is read from the text (`content`, or the text of the PDF or text file) by an automatic extractor. It expects labelled lines such as `Nome e Cognome: Mario Rossi`, `Email: ...`, `Telefono: ...`, `Codice Fiscale: ...`. Extraction can misread a document. An integration should always send `recipientData`; fields given there win over extracted ones.

What the recipient gets:

- With files: the files, as the attachments of the communication. `content` is not shown.
- Without files: `content`, as the text of the communication.

Success, `200`:

```json
{
  "success": true,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PROCESSING",
  "amount": 3.05,
  "ratePerChannel": 3.05,
  "successfulChannels": 1,
  "requestedChannels": 1,
  "chargeId": "cbtxn_1Qx...",
  "details": "ERDS request processed successfully for 1 of 1 channel(s)"
}
```

- `requestId` here is the **dispatch id**: use it with the endpoints below. (In an error, `requestId` is the log reference.)
- `amount` is what was charged. With two channels where one failed, only the one that went out is charged and `failedChannels` lists the other: `[{"channel":"SMS","errorCode":"..."}]`.

Errors: `400 VALIDATION_FAILED` (see `reason`), `402 INSUFFICIENT_BALANCE`, `403 SENDER_NOT_ACTIVATED`, `502 DISPATCH_FAILED`, `402 PAYMENT_FAILED`.

A request refused after authentication is still recorded as a dispatch with status `FAILED` and the reason in `error_message`, so it shows in the list. It costs nothing.

### List: `GET /api/dispatches`

| Query | Default | |
| --- | --- | --- |
| `page` | 1 | |
| `limit` | 20 | Maximum 100 |
| `name` | | Part of the recipient's name, any case |
| `bulkDispatchId` | | Only the dispatches of one group |

Newest first.

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "request_type": "ERDS",
      "channels": ["EMAIL"],
      "rate_applied": "3.05",
      "total_cost": "3.05",
      "status": "COMPLETED",
      "created_at": "2026-11-18T09:30:00.000Z",
      "bulk_dispatch_id": null,
      "recipient_first_name": "Mario",
      "recipient_last_name": "Rossi",
      "recipient_email": "mario.rossi@example.com",
      "recipient_phone": null,
      "document_name": "sollecito.pdf",
      "document_size": 48211,
      "document_mime_type": "application/pdf",
      "error_message": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### One dispatch: `GET /api/dispatches/{id}`

Asks the delivery provider for the latest events, so it can take a few seconds. Do not poll it more than once a minute per dispatch.

Stable fields:

| Field | |
| --- | --- |
| `id`, `request_type`, `channels`, `status`, `created_at`, `updated_at` | As in the list |
| `rate_applied`, `total_cost` | Decimal strings |
| `document_name`, `document_size`, `document_mime_type` | The document, if one was sent |
| `bulk_dispatch_id` | The group it belongs to, or `null` |
| `error_message` | Why it failed, when `status` is `FAILED`; otherwise `null` |
| `recipient_info` | `first_name`, `last_name`, `full_name`, `email`, `phone`, `tax_id`: who the communication went to |
| `audit_available` | `true` when a proof can be downloaded |
| `audit_url` | Path of the proof, to call with the same `Authorization` header; `null` if nothing was sent |
| `email_audit_url`, `sms_audit_url` | The same per channel, present when that channel was sent |
| `email_history`, `sms_history` | Raw events from the delivery provider. Their shape is the provider's and can change |
| `file_url`, `attachment_urls` | Temporary links to the documents |

### Proof of delivery: `GET /api/dispatches/{id}/audit`

Returns the audit report as `application/pdf`: the document to keep as evidence. Optional query `channel=EMAIL` or `channel=SMS`; without it, the first available.

It answers `404 NOT_FOUND` until the report exists, which is some minutes after delivery. Check `audit_available` on the dispatch first.

### Status of a dispatch

| Status | Meaning | Final |
| --- | --- | --- |
| `PENDING` | Just received, being checked | no |
| `PROCESSING` | Handed to the delivery provider, waiting for the outcome | no |
| `COMPLETED` | Delivered on at least one of the channels requested | yes for ERDS |
| `OPENED` | Read by the identified recipient. QERDS only | yes |
| `FAILED` | Refused, or not delivered on any channel. `error_message` says why | yes |

Statuses are refreshed every five minutes. There are no webhooks: poll `GET /api/dispatches` (one call covers many dispatches) every few minutes while something is `PROCESSING`. A QERDS dispatch moves from `COMPLETED` to `OPENED` when the recipient reads it, which can be days later or never.

## Campaigns

A campaign sends the same communication to many recipients in two steps: create a draft, then send it. Nothing is sent or charged until the second step.

### Create a draft: `POST /api/campaigns`

`Content-Type: multipart/form-data`.

| Field | Required | Description |
| --- | --- | --- |
| `requestType` | yes | `ERDS` or `QERDS` |
| `campaignName` | yes | Letters, digits, spaces, `-` and `_`. Other characters are removed |
| `channels` | no | `EMAIL`, `SMS` or `EMAIL,SMS`. Default: both |
| `emailSubject` | no | Subject of the email |
| `messageBody` | no | Text of the email and of the SMS |
| `recipients` | no | A JSON array, as text. See below |
| `files` | no | Attachment. Repeat for several. Same types and size limit as a dispatch |
| `contact_list_id` | no | One of your contact lists this campaign was built from |

Each recipient: `{"firstName":"Mario","lastName":"Rossi","email":"...","telefono":"+39...","codiceFiscale":"..."}`. `nomeECognome` can replace the two name fields. The same requirements as for a dispatch apply: email for `EMAIL`, phone for `SMS`, tax code for `QERDS`.

```json
{
  "success": true,
  "campaignId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "campaignName": "Solleciti novembre",
  "status": "DRAFT",
  "recipientsStored": 2,
  "recipientsInvalid": 1,
  "recipientIssues": [{ "index": 1, "reason": "missing_email" }]
}
```

Recipients with a problem are stored all the same, so they can be corrected; `recipientIssues` says which, by position in the array you sent. Reasons: `missing_name`, `missing_email`, `missing_phone`, `invalid_phone`, `missing_codice_fiscale`. A recipient left wrong fails when the campaign is sent, and is not charged.

### List: `GET /api/campaigns`

Query: `page`, `limit` (default 20, maximum 100), `status`.

Each item: `id`, `campaign_name`, `request_type`, `channels`, `email_subject`, `email_body`, `sms_body`, `status`, `created_at`, `total_cost`, `error_message`, `recipients_count`, and `status_breakdown` with the number of recipients in each state (`PENDING`, `PROCESSING`, `COMPLETED`, `OPENED`, `PARTIAL`, `FAILED`). Plus `pagination`.

### One campaign: `GET /api/campaigns/{id}`

The fields of the list, plus `updated_at`, `existing_files` and `recipients`:

```json
{
  "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "nome_e_cognome": "Mario Rossi",
  "first_name": "Mario",
  "last_name": "Rossi",
  "email": "mario.rossi@example.com",
  "telefono": null,
  "codice_fiscale": null,
  "dispatch_status": "PROCESSING",
  "created_at": "2026-11-18T09:30:00.000Z",
  "dispatch": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "PROCESSING",
    "audit_url": "/api/dispatches/550e8400-e29b-41d4-a716-446655440000/audit",
    "error_message": null,
    "failed_channels": null
  }
}
```

`dispatch` is `null` until the campaign is sent. Each recipient then has its own dispatch, readable with the dispatch endpoints.

### Edit a draft: `PUT /api/campaigns/{id}`

`Content-Type: application/json`. Any of `campaignName`, `emailSubject`, `messageBody`, `channels` (an array: `["EMAIL"]`), `requestType`, `recipients`. `recipients` replaces every recipient not yet sent. After a campaign has been sent only `campaignName` can change.

Answer: `{"success":true,"updated":["campaignName","recipients"]}`.

### Correct one recipient: `PATCH /api/campaigns/{id}/recipients/{recipientId}`

JSON with `email`, `telefono` or both. Answers the recipient.

### Send: `POST /api/campaigns/{id}/dispatch`

No body. Sends to every recipient still `PENDING` and charges the wallet once, for the deliveries that went out.

The whole cost is checked first. If the wallet cannot cover every recipient the answer is `402` and nothing is sent:

```json
{
  "error": "Insufficient balance",
  "code": "INSUFFICIENT_BALANCE",
  "requestId": "...",
  "currentBalance": 3.05,
  "requiredAmount": 6.1
}
```

Success:

```json
{
  "success": true,
  "campaignId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "summary": {
    "totalRecipients": 2,
    "successfulDispatches": 2,
    "failedDispatches": 0,
    "totalCost": 6.1,
    "ratePerChannel": 3.05
  },
  "dispatches": [
    { "recipient": "Mario Rossi", "dispatchId": "550e8400-...", "status": "SUCCESS", "cost": 3.05 }
  ]
}
```

A campaign is sent once. With many recipients the request can take minutes: use a long timeout, and if the connection drops read the campaign instead of sending again.

### Re-send to one recipient: `POST /api/campaigns/{id}/recipients/{recipientId}/resend`

Only for a recipient whose `dispatch_status` is `FAILED` or `PARTIAL`, typically after correcting the address. It is charged like a new delivery. Answer: `{"success":true,"dispatchId":"...","status":"PROCESSING","channels":["EMAIL"],"failedChannels":[],"cost":3.05}`.

### Copy: `POST /api/campaigns/{id}/duplicate`

Creates a new draft with the same content and recipients. Answer: `{"success":true,"campaignId":"..."}`.

### Status of a campaign

| Status | Meaning |
| --- | --- |
| `DRAFT` | Created, not sent. Can be edited and sent |
| `ACTIVE` | Sent; at least one recipient failed and can be re-sent |
| `COMPLETED` | Sent, and every recipient was accepted by the delivery provider |
| `ERROR` | Could not be set up for sending. Copy it and send the copy |

Status of a recipient (`dispatch_status`): `PENDING` (not sent), `PROCESSING`, `COMPLETED`, `OPENED`, `PARTIAL` (one channel of two failed), `FAILED`.

## Contact lists

Address books to build campaigns from. Nothing here sends anything.

| Call | Body | Answer |
| --- | --- | --- |
| `GET /api/contact-lists` | | `data` (lists with `id`, `list_name`, `description`, `item_count`, `created_at`, `updated_at`) and `pagination` |
| `POST /api/contact-lists` | `{"listName":"Condomini","description":"...","items":[...]}` | `201`, the list |
| `GET /api/contact-lists/{id}` | | The list with all its `items` |
| `PUT /api/contact-lists/{id}` | `{"listName":"...","description":"..."}` | The list |
| `DELETE /api/contact-lists/{id}` | | `{"success":true}`. Deletes its contacts too |
| `GET /api/contact-lists/{id}/items` | | `items` and `pagination`. Query: `page`, `limit` (default 50, maximum 200), `search` |
| `POST /api/contact-lists/{id}/items` | `{"items":[...]}` | `201`. Adds contacts. A contact whose email is already in the list is updated, not duplicated |
| `PATCH /api/contact-lists/{id}/items` | `{"items":[...]}` | Replaces every contact of the list with these |
| `PUT /api/contact-lists/{id}/items` | `{"itemId":"...","telefono":"+39..."}` | Edits one contact |
| `DELETE /api/contact-lists/{id}/items?itemId=...` | | `{"success":true}` |

A contact, when sent: `{"firstName":"Anna","lastName":"Bianchi","email":"...","telefono":"+39...","codiceFiscale":"..."}`, or `nomeECognome` for the full name. A contact with no name is skipped.

A contact, when returned: `id`, `nome_e_cognome`, `first_name`, `last_name`, `email`, `telefono`, `codice_fiscale`, `created_at`.

## Groups of dispatches

To send many single dispatches and find them together afterwards.

- `POST /api/bulk-dispatches` with an optional JSON `{"metadata":{...}}` answers `{"success":true,"bulkDispatchId":"...","createdAt":"..."}`.
- Pass that id as `bulk_dispatch_id` on each `POST /api/dispatches`.
- `GET /api/dispatches?bulkDispatchId=...` lists them.
- `GET /api/bulk-dispatches` lists the groups, each with `dispatch_count`, `completed_count`, `failed_count`, `pending_count` and `total_cost`.

## Wallet and account

| Call | Answer |
| --- | --- |
| `GET /api/payment/balance` | `{"success":true,"balance":42.7,"currency":"eur"}` |
| `GET /api/payment/transactions` | `{"success":true,"transactions":[{"id","amount","created","description","type"}]}`: the last 100 movements of the wallet. `amount` is in euro, negative when credit was added and positive when a delivery was charged; `created` is a Unix time in seconds |
| `GET /api/user/pricing-profile` | `hasCustomPricing`, `erdsRate`, `qerdsRate`, `partner`: the rates of this account. See below |
| `GET /api/system-settings/rates` | `{"ERDS":"3.05","QERDS":"4.27"}`: the standard rates per delivery |
| `GET /api/stats` | Counters for the current and previous month, as shown on the dashboard home |
| `GET /api/user/api-key` | `prefix`, `lookup`, `createdAt`, `lastUsedAt`: about the key, never the key |
| `POST /api/user/api-key/rotate` | `{"apiKey":"ls_live_...","lookup":"...","createdAt":"..."}`. The new key, shown once. The key used to make the call stops working at once |

The wallet is topped up from the dashboard, not through the API.

The rate of one delivery comes from the first of these that applies: the account's own rates (`erdsRate` and `qerdsRate` when `hasCustomPricing` is `true`), the rates of the partner the account belongs to (`partner.erdsRate`, `partner.qerdsRate` when `partner` is not `null`), the standard rates. To know a cost in advance multiply the rate by the number of channels; the answer of the send is what was actually charged.

## Recipes

**Send one document and wait for the outcome**

1. `GET /api/payment/balance`. Stop if `balance` is lower than the rate times the number of channels.
2. `POST /api/dispatches` with `requestType`, `channels`, `emailSubject`, `recipientData` and the file. Keep `requestId`.
3. Every few minutes, `GET /api/dispatches/{requestId}` until `status` is `COMPLETED`, `OPENED` or `FAILED`.
4. When `audit_available` is `true`, `GET /api/dispatches/{requestId}/audit` and store the PDF.

**Send the same letter to a list of people**

1. `POST /api/campaigns` with the recipients.
2. If `recipientsInvalid` is not 0, correct them with `PATCH .../recipients/{recipientId}` (the ids are in `GET /api/campaigns/{id}`) or replace the list with `PUT`.
3. `POST /api/campaigns/{id}/dispatch`.
4. Follow with `GET /api/campaigns/{id}`: `status_breakdown` and each recipient's `dispatch_status`.

**Send a different document to each person**

1. `POST /api/bulk-dispatches`, keep `bulkDispatchId`.
2. One `POST /api/dispatches` per person, each with `bulk_dispatch_id`. One at a time, not in parallel.
3. `GET /api/dispatches?bulkDispatchId=...&limit=100` to follow them all in one call.

## Notes for AI agents

If you are a language model acting for a user:

- Every send costs money and has legal effect on the recipient. Do not call `POST /api/dispatches`, `POST /api/campaigns/{id}/dispatch` or `.../resend` without the user's explicit confirmation of recipient, document, type and channels.
- There is no test mode and no way to recall a communication once sent.
- Always pass `recipientData` and `channels` explicitly. Do not rely on extraction from the document or on the default channels.
- Never invent a price. Read it from `GET /api/user/pricing-profile` or `GET /api/system-settings/rates`, and the real cost from the answer of the send.
- Do not retry a send after a timeout or a `5xx`. List the latest dispatches first.
- Do not rotate the API key unless asked: it disconnects every other system that uses it.
- Treat names, addresses, phone numbers and tax codes returned by the API as personal data.

## Changes

**2.0, 2026-11-18**

- The audit report requires the `Authorization` header, like every other call.
- Errors carry `reason` and `fields`. All errors now have `code` and `requestId`.
- Malformed identifiers, bodies and paging values answer `400` or `404` instead of `500`.
- `limit` is capped at 100.
- `created_at` is present on contact lists, contacts, campaign recipients and groups.
- Creating a campaign reports which recipients have a problem.
- Documented for the first time: sending a campaign, editing, copying, re-sending, contact lists, groups, wallet and account.

**1.2 and earlier**

- Campaigns, multiple files per dispatch, the `OPENED` status, audit reports per channel.
