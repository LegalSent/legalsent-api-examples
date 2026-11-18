// A check of your own integration against the real API. It reads, creates and
// deletes one contact list, and makes requests that must be refused. It never
// sends a communication and never spends credit.
//
//   node --env-file=.env node/test/smoke.mjs
import { LegalSent, LegalSentError } from '../legalsent.mjs';

const extra = process.env.LEGALSENT_EXTRA_HEADERS ? JSON.parse(process.env.LEGALSENT_EXTRA_HEADERS) : {};
const api = new LegalSent({ headers: extra });
let failed = 0;

async function check(name, fn) {
  try {
    const note = await fn();
    console.log(`PASS  ${name}${note ? `  (${note})` : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}  — ${error.message}`);
  }
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };
async function refused(promise, status, code) {
  try { await promise; } catch (error) {
    expect(error instanceof LegalSentError, `expected an API error, got: ${error.message}`);
    expect(error.status === status && (!code || error.code === code), `expected ${status} ${code || ''}, got ${error.status} ${error.code}`);
    return error;
  }
  throw new Error(`expected ${status} ${code || ''}, but the request was accepted`);
}

await check('the key is accepted', async () => {
  const k = await api.apiKeyInfo();
  return `${k.prefix}_${k.lookup}…`;
});
await check('a wrong key is refused with 401 INVALID_API_KEY', async () => {
  const wrong = new LegalSent({ apiKey: 'ls_live_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', baseUrl: api.baseUrl, headers: extra });
  await refused(wrong.balance(), 401, 'INVALID_API_KEY');
});
await check('the wallet answers', async () => {
  const b = await api.balance();
  expect(typeof b.balance === 'number' && b.currency === 'eur', JSON.stringify(b));
  return `${b.balance.toFixed(2)} EUR`;
});
await check('rates can be read', async () => {
  const erds = await api.rateFor('ERDS');
  const qerds = await api.rateFor('QERDS');
  expect(erds > 0 && qerds > 0, `ERDS ${erds}, QERDS ${qerds}`);
  return `ERDS ${erds.toFixed(2)}, QERDS ${qerds.toFixed(2)}`;
});
await check('dispatches can be listed', async () => {
  const r = await api.listDispatches({ limit: 3 });
  expect(Array.isArray(r.data) && typeof r.pagination.total === 'number', 'unexpected shape');
  return `${r.pagination.total} in all`;
});
await check('campaigns can be listed', async () => {
  const r = await api.listCampaigns({ limit: 3 });
  expect(Array.isArray(r.data), 'unexpected shape');
  return `${r.pagination.total} in all`;
});
await check('an unknown dispatch is 404 NOT_FOUND', async () => {
  await refused(api.getDispatch('00000000-0000-4000-8000-000000000000'), 404, 'NOT_FOUND');
});
await check('a send with a JSON body is refused with a reason, before anything is recorded', async () => {
  // Deliberately the wrong content type: this is refused at the door, so it
  // cannot send, cannot charge, and leaves no failed dispatch in the account.
  const error = await refused(api.request('POST', '/api/dispatches', { json: { requestType: 'ERDS' } }), 400, 'VALIDATION_FAILED');
  expect(error.reason === 'body_not_form_data', `reason was ${error.reason}`);
});
await check('the client itself will not send without confirm: true', async () => {
  let threw = false;
  try {
    await api.sendDispatch({ requestType: 'ERDS', channels: ['EMAIL'], recipient: { firstName: 'X', email: 'x@example.com' }, content: 'x' });
  } catch (error) {
    threw = /confirm: true/.test(error.message);
  }
  expect(threw, 'sendDispatch ran without confirmation');
});
await check('a contact list can be created, filled, read and deleted', async () => {
  const list = await api.createContactList({ name: `Smoke test ${Date.now()}` });
  try {
    await api.addContacts(list.id, [{ firstName: 'Prova', lastName: 'Smoke', email: 'prova.smoke@example.com' }]);
    const { items } = await api.listContacts(list.id);
    expect(items.length === 1 && items[0].nome_e_cognome === 'Prova Smoke', JSON.stringify(items));
  } finally {
    await api.deleteContactList(list.id);
  }
  await refused(api.getContactList(list.id), 404, 'NOT_FOUND');
});

console.log(failed ? `\n${failed} check(s) failed` : '\nAll good: nothing was sent and no credit was used.');
process.exit(failed ? 1 : 0);
