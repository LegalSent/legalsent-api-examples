// Is the key valid, is there credit, what does a delivery cost?
// Reads only. Safe to run at any time.
//
//   node --env-file=.env node/examples/01-check-account.mjs
import { client, euro, run } from './_util.mjs';

run(async () => {
  const api = client();

  const key = await api.apiKeyInfo();
  console.log(`Key ${key.prefix}_${key.lookup}…  created ${key.createdAt}`);

  const { balance } = await api.balance();
  console.log(`Credit: ${euro(balance)}`);

  const erds = await api.rateFor('ERDS');
  const qerds = await api.rateFor('QERDS');
  console.log(`One ERDS delivery:  ${euro(erds)}   (enough credit for ${Math.floor(balance / erds)})`);
  console.log(`One QERDS delivery: ${euro(qerds)}   (enough credit for ${Math.floor(balance / qerds)})`);
  console.log('A delivery is one recipient on one channel: email and SMS together count twice.');

  const { data, pagination } = await api.listDispatches({ limit: 5 });
  console.log(`\nDispatches so far: ${pagination.total}`);
  for (const d of data) {
    const who = [d.recipient_first_name, d.recipient_last_name].filter(Boolean).join(' ') || '(no recipient)';
    console.log(`  ${d.created_at}  ${d.status.padEnd(10)} ${d.request_type} ${d.channels.join('+').padEnd(9)} ${who}`);
  }
});
