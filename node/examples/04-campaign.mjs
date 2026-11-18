// The same communication to several people: create a draft, look at what the
// API thinks of the recipients, and only with --send deliver it.
//
//   node --env-file=.env node/examples/04-campaign.mjs --recipients ./recipients.json \
//     --name "Solleciti novembre" --subject "Sollecito di pagamento" --message "Gentile cliente, ..."
//
// recipients.json is an array:
//   [{ "firstName": "Mario", "lastName": "Rossi", "email": "mario.rossi@example.com" }, ...]
//
// Options
//   --type ERDS|QERDS      default ERDS
//   --channels EMAIL,SMS   default EMAIL
//   --file PATH            an attachment for everybody
//   --send                 send the draft. Without it the draft stays in the account, unsent and free
import fs from 'node:fs';
import { client, args, euro, run } from './_util.mjs';

run(async () => {
  const a = args();
  if (!a.recipients || !a.name) throw new Error('usage: 04-campaign.mjs --recipients file.json --name "..." [--subject ...] [--message ...] [--send]');
  const api = client();
  const requestType = a.type || 'ERDS';
  const channels = String(a.channels || 'EMAIL').split(',').map((c) => c.trim().toUpperCase());
  const recipients = JSON.parse(fs.readFileSync(a.recipients, 'utf8'));

  const draft = await api.createCampaign({
    requestType, channels, name: a.name, subject: a.subject, message: a.message, recipients, files: a.file ? [a.file] : [],
  });
  console.log(`Draft ${draft.campaignId}: ${draft.recipientsStored} recipients stored.`);
  for (const issue of draft.recipientIssues || []) {
    const r = recipients[issue.index];
    console.log(`  problem with #${issue.index} (${r.firstName || r.nomeECognome || '?'}): ${issue.reason}`);
  }

  const rate = await api.rateFor(requestType);
  const cost = rate * channels.length * recipients.length;
  const { balance } = await api.balance();
  console.log(`Sending it would cost about ${euro(cost)}; credit is ${euro(balance)}.`);

  if (!a.send) {
    console.log('\nNothing was sent. The draft is in the account: add --send next time, or send it from the dashboard.');
    return;
  }
  if (draft.recipientsInvalid > 0) throw new Error('Correct the recipients above first: each one left wrong fails at send time.');

  const result = await api.dispatchCampaign(draft.campaignId, { confirm: true });
  const s = result.summary;
  console.log(`\nSent to ${s.successfulDispatches} of ${s.totalRecipients}; charged ${euro(s.totalCost)}.`);
  for (const d of result.dispatches.filter((x) => x.status !== 'SUCCESS')) console.log(`  failed: ${d.recipient}`);
  console.log(`Follow each one with 03-follow-dispatch.mjs, or read the campaign: GET /api/campaigns/${draft.campaignId}`);
});
