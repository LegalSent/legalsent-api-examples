// Send one document to one person.
//
// Without --send it only shows what would be sent and what it would cost.
// With --send it delivers a real communication with legal effect and charges
// the wallet: there is no test mode.
//
//   node --env-file=.env node/examples/02-send-dispatch.mjs \
//     --file ./lettera.pdf --subject "Sollecito di pagamento" \
//     --first-name Mario --last-name Rossi --email mario.rossi@example.com
//
// Options
//   --type ERDS|QERDS        default ERDS. QERDS needs --tax-code
//   --channels EMAIL,SMS     default EMAIL. Each channel is a separate, paid delivery
//   --file PATH              PDF, TXT, JPEG or PNG. Or --text "..." for a message without a file
//   --phone +39...           needed for SMS
//   --tax-code ...           codice fiscale of the recipient, needed for QERDS
//   --send                   actually send
import { client, args, euro, run } from './_util.mjs';

run(async () => {
  const a = args();
  const api = client();
  const requestType = a.type || 'ERDS';
  const channels = String(a.channels || 'EMAIL').split(',').map((c) => c.trim().toUpperCase());

  const dispatch = {
    requestType,
    channels,
    subject: a.subject,
    content: a.text,
    files: a.file ? [a.file] : [],
    recipient: {
      firstName: a['first-name'],
      lastName: a['last-name'],
      email: a.email,
      telefono: a.phone,
      codiceFiscale: a['tax-code'],
    },
  };
  api.dispatchForm(dispatch); // throws now if something required is missing

  const rate = await api.rateFor(requestType);
  const cost = rate * channels.length;
  const { balance } = await api.balance();
  console.log(`To:       ${[a['first-name'], a['last-name']].filter(Boolean).join(' ')}  ${a.email || ''} ${a.phone || ''}`);
  console.log(`What:     ${a.file || '(text only)'}   subject: ${a.subject || '(none)'}`);
  console.log(`How:      ${requestType} by ${channels.join(' and ')}`);
  console.log(`Cost:     about ${euro(cost)}   credit: ${euro(balance)}`);

  if (!a.send) {
    console.log('\nNothing was sent. Add --send to deliver it for real.');
    return;
  }
  if (balance < cost) throw new Error('Not enough credit: top up the wallet from the dashboard.');

  const result = await api.sendDispatch(dispatch, { confirm: true });
  console.log(`\nSent. Dispatch id: ${result.requestId}`);
  console.log(`Charged: ${euro(result.amount)}   status: ${result.status}`);
  if (result.failedChannels?.length) console.log(`Not delivered on: ${result.failedChannels.map((f) => f.channel).join(', ')}`);
  console.log(`Follow it:  node --env-file=.env node/examples/03-follow-dispatch.mjs ${result.requestId}`);
});
