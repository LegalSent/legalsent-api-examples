// Address books: create one, fill it, search it, delete it.
// Sends nothing and costs nothing.
//
//   node --env-file=.env node/examples/05-contact-lists.mjs
import { client, run } from './_util.mjs';

run(async () => {
  const api = client();

  const list = await api.createContactList({ name: 'Esempio API', description: 'Created by 05-contact-lists.mjs' });
  console.log(`Created list ${list.id}`);
  try {
    await api.addContacts(list.id, [
      { firstName: 'Anna', lastName: 'Bianchi', email: 'anna.bianchi@example.com', telefono: '+393330000001' },
      { firstName: 'Luca', lastName: 'Verdi', email: 'luca.verdi@example.com', codiceFiscale: 'VRDLCU80A01H501X' },
    ]);

    // The same email again updates the contact instead of adding a second one.
    await api.addContacts(list.id, [{ firstName: 'Anna', lastName: 'Bianchi', email: 'anna.bianchi@example.com', telefono: '+393330000002' }]);

    const { items, pagination } = await api.listContacts(list.id);
    console.log(`${pagination.total} contacts:`);
    for (const c of items) console.log(`  ${c.nome_e_cognome.padEnd(16)} ${c.email || ''} ${c.telefono || ''}`);

    const found = await api.listContacts(list.id, { search: 'verdi' });
    console.log(`Search "verdi": ${found.items.map((c) => c.nome_e_cognome).join(', ')}`);
  } finally {
    await api.deleteContactList(list.id);
    console.log('List deleted.');
  }
});
