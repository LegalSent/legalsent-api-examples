// Shared by the examples: build the client from the environment, read the
// command line, print an error the way a person can act on it.
import { LegalSent, LegalSentError } from '../legalsent.mjs';

export function client() {
  const extra = process.env.LEGALSENT_EXTRA_HEADERS ? JSON.parse(process.env.LEGALSENT_EXTRA_HEADERS) : {};
  return new LegalSent({ headers: extra });
}

/** `--name value` and `--flag` from the command line. */
export function args() {
  const out = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i].startsWith('--')) { out._.push(a[i]); continue; }
    const key = a[i].slice(2);
    if (a[i + 1] === undefined || a[i + 1].startsWith('--')) out[key] = true;
    else { out[key] = a[i + 1]; i += 1; }
  }
  return out;
}

export const euro = (n) => `${Number(n).toFixed(2)} EUR`;

/** Run an example; on an API error say what it was and what to do. */
export async function run(main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof LegalSentError) {
      console.error(`\nThe API refused: ${error.message}`);
      if (error.fields.length) console.error(`  parameters at fault: ${error.fields.join(', ')}`);
      if (error.code === 'INSUFFICIENT_BALANCE') console.error('  top up the wallet from the dashboard, then try again');
      if (error.code === 'SENDER_NOT_ACTIVATED') console.error('  the account is not enabled as a sender yet: complete the activation in the dashboard');
      if (error.code === 'INVALID_API_KEY' || error.code === 'UNAUTHORIZED') console.error('  check LEGALSENT_API_KEY: the key is shown once, when it is created');
      if (error.requestId) console.error(`  request id, for support: ${error.requestId}`);
    } else {
      console.error(`\n${error.message}`);
    }
    process.exitCode = 1;
  }
}
