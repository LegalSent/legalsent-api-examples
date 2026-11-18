// Where is a dispatch, and download its proof of delivery when there is one.
// Reads only.
//
//   node --env-file=.env node/examples/03-follow-dispatch.mjs <dispatch id> [--wait] [--out proof.pdf]
//
// --wait keeps checking every two minutes until the dispatch reaches a final
// status. Statuses are refreshed every five minutes, so checking more often
// tells nothing new.
import fs from 'node:fs';
import { client, args, run } from './_util.mjs';

const MEANING = {
  PENDING: 'received, being checked',
  PROCESSING: 'handed to the delivery provider, waiting for the outcome',
  COMPLETED: 'delivered',
  OPENED: 'read by the identified recipient',
  FAILED: 'not delivered',
};

run(async () => {
  const a = args();
  const id = a._[0];
  if (!id) throw new Error('usage: 03-follow-dispatch.mjs <dispatch id> [--wait] [--out proof.pdf]');
  const api = client();

  const show = (d) => console.log(`${new Date().toISOString()}  ${d.status}: ${MEANING[d.status] || ''}${d.error_message ? ` (${d.error_message})` : ''}`);
  const d = a.wait ? await api.waitForDispatch(id, { onPoll: show }) : await api.getDispatch(id);
  if (!a.wait) show(d);

  if (!d.audit_available) {
    console.log('No proof of delivery yet. It is produced some minutes after delivery.');
    return;
  }
  const out = a.out || `proof-${id}.pdf`;
  fs.writeFileSync(out, await api.downloadAudit(id));
  console.log(`Proof of delivery saved to ${out}`);
});
