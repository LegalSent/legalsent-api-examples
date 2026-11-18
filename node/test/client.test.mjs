// Tests of the client against a local stand-in server: no network, no key.
//
//   node --test node/test/client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LegalSent, LegalSentError } from '../legalsent.mjs';

// A server that records what it receives and answers what the test tells it to.
async function standIn(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') });
      const { status = 200, json, raw, type } = answer(req) || {};
      res.writeHead(status, { 'Content-Type': type || 'application/json' });
      res.end(raw !== undefined ? raw : JSON.stringify(json ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = new LegalSent({ apiKey: 'ls_live_TESTTEST_0123456789abcdefghijklmnopqrstuv', baseUrl: `http://127.0.0.1:${server.address().port}/` });
  return { api, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('every request carries the key as a Bearer token', async () => {
  const s = await standIn(() => ({ json: { success: true, balance: 12.5, currency: 'eur' } }));
  const b = await s.api.balance();
  assert.equal(b.balance, 12.5);
  assert.equal(s.seen[0].headers.authorization, 'Bearer ls_live_TESTTEST_0123456789abcdefghijklmnopqrstuv');
  assert.equal(s.seen[0].url, '/api/payment/balance');
  await s.close();
});

test('a send is multipart, with the recipient as JSON text and the channels spelled out', async () => {
  const s = await standIn(() => ({ json: { success: true, requestId: 'd1', status: 'PROCESSING', amount: 3.05 } }));
  const r = await s.api.sendDispatch({
    requestType: 'ERDS', channels: ['EMAIL'], subject: 'Oggetto',
    recipient: { firstName: 'Mario', lastName: 'Rossi', email: 'mario@example.com' },
    files: [{ name: 'lettera.pdf', data: Buffer.from('%PDF-1.4 test') }],
  }, { confirm: true });
  assert.equal(r.requestId, 'd1');
  const { method, url, headers, body } = s.seen[0];
  assert.equal(`${method} ${url}`, 'POST /api/dispatches');
  assert.match(headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(body, /name="requestType"\r\n\r\nERDS/);
  assert.match(body, /name="channels"\r\n\r\nEMAIL/);
  assert.match(body, /name="emailSubject"\r\n\r\nOggetto/);
  assert.match(body, /name="recipientData"\r\n\r\n\{"firstName":"Mario","lastName":"Rossi","email":"mario@example.com"\}/);
  assert.match(body, /name="file"; filename="lettera.pdf"\r\nContent-Type: application\/pdf/);
  await s.close();
});

test('nothing is sent without confirm: true', async () => {
  const s = await standIn(() => ({ json: {} }));
  const d = { requestType: 'ERDS', channels: ['EMAIL'], recipient: { firstName: 'M', email: 'm@example.com' }, content: 'x' };
  assert.throws(() => s.api.sendDispatch(d), /confirm: true/);
  assert.throws(() => s.api.sendDispatch(d, { confirm: 'yes' }), /confirm: true/);
  assert.throws(() => s.api.dispatchCampaign('c1'), /confirm: true/);
  assert.throws(() => s.api.resendRecipient('c1', 'r1'), /confirm: true/);
  assert.equal(s.seen.length, 0);
  await s.close();
});

test('a send is checked before it leaves', async () => {
  const s = await standIn(() => ({ json: {} }));
  const ok = { requestType: 'ERDS', channels: ['EMAIL'], recipient: { firstName: 'M', email: 'm@example.com' }, content: 'x' };
  assert.throws(() => s.api.dispatchForm({ ...ok, requestType: 'erds' }), /requestType/);
  assert.throws(() => s.api.dispatchForm({ ...ok, channels: [] }), /channels/);
  assert.throws(() => s.api.dispatchForm({ ...ok, recipient: undefined }), /recipient/);
  assert.throws(() => s.api.dispatchForm({ ...ok, content: undefined }), /content, files/);
  assert.throws(() => s.api.dispatchForm({ ...ok, files: [{ name: 'a.zip', data: Buffer.from('x') }] }), /only PDF/);
  assert.equal(s.seen.length, 0);
  await s.close();
});

test('an error becomes a LegalSentError with code, reason, fields and requestId', async () => {
  const s = await standIn(() => ({ status: 400, json: { error: 'Some fields are missing or invalid.', code: 'VALIDATION_FAILED', requestId: 'req-1', reason: 'missing_recipient_fields', fields: ['email'] } }));
  await assert.rejects(s.api.listDispatches(), (error) => {
    assert.ok(error instanceof LegalSentError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.equal(error.reason, 'missing_recipient_fields');
    assert.deepEqual(error.fields, ['email']);
    assert.equal(error.requestId, 'req-1');
    return true;
  });
  await s.close();
});

test('an error without a JSON body (413 from the platform) is still a LegalSentError', async () => {
  const s = await standIn(() => ({ status: 413, raw: 'Request Entity Too Large', type: 'text/plain' }));
  await assert.rejects(s.api.balance(), (error) => error instanceof LegalSentError && error.status === 413 && error.code === null);
  await s.close();
});

test('the rate comes from the account, then its partner, then the standard rates', async () => {
  let profile = { hasCustomPricing: true, erdsRate: '2.50', qerdsRate: '3.50', partner: { erdsRate: '2.00', qerdsRate: '2.50' } };
  const s = await standIn((req) => ({ json: req.url.includes('pricing-profile') ? profile : { ERDS: '3.05', QERDS: '4.27' } }));
  assert.equal(await s.api.rateFor('ERDS'), 2.5);
  profile = { hasCustomPricing: false, erdsRate: null, qerdsRate: null, partner: { erdsRate: '2.00', qerdsRate: '2.50' } };
  assert.equal(await s.api.rateFor('QERDS'), 2.5);
  profile = { hasCustomPricing: false, erdsRate: null, qerdsRate: null, partner: null };
  assert.equal(await s.api.rateFor('QERDS'), 4.27);
  await s.close();
});

test('the audit report comes back as bytes, and query parameters are passed', async () => {
  const s = await standIn(() => ({ raw: '%PDF-1.4 proof', type: 'application/pdf' }));
  const pdf = await s.api.downloadAudit('d1', { channel: 'EMAIL' });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.toString(), '%PDF-1.4 proof');
  assert.equal(s.seen[0].url, '/api/dispatches/d1/audit?channel=EMAIL');
  await s.close();
});

test('waitForDispatch stops at a final status', async () => {
  const statuses = ['PROCESSING', 'PROCESSING', 'COMPLETED'];
  const s = await standIn(() => ({ json: { id: 'd1', status: statuses.shift() } }));
  const d = await s.api.waitForDispatch('d1', { intervalMs: 5 });
  assert.equal(d.status, 'COMPLETED');
  assert.equal(s.seen.length, 3);
  await s.close();
});

test('campaigns: a draft is multipart with the recipients as JSON text; an edit is JSON', async () => {
  const s = await standIn(() => ({ json: { success: true, campaignId: 'c1', status: 'DRAFT' } }));
  await s.api.createCampaign({ requestType: 'ERDS', channels: ['EMAIL'], name: 'Prova', recipients: [{ firstName: 'A', email: 'a@example.com' }] });
  assert.match(s.seen[0].headers['content-type'], /^multipart\/form-data/);
  assert.match(s.seen[0].body, /name="campaignName"\r\n\r\nProva/);
  assert.match(s.seen[0].body, /name="recipients"\r\n\r\n\[\{"firstName":"A","email":"a@example.com"\}\]/);
  await s.api.updateCampaign('c1', { channels: ['EMAIL', 'SMS'] });
  assert.equal(s.seen[1].headers['content-type'], 'application/json');
  assert.equal(s.seen[1].body, '{"channels":["EMAIL","SMS"]}');
  await s.close();
});
