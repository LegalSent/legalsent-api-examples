# Esempi per l'API LegalSent

Codice funzionante per l'API di [LegalSent](https://legalsent.com): inviare una comunicazione elettronica a valore legale per email o SMS, seguirne lo stato e scaricare la prova di consegna.

*English: [README.md](README.md)*

> **Non esiste un ambiente di prova.** Un invio recapita una comunicazione vera, con effetti legali, a una persona vera, e scala il credito dal portafoglio prepagato. Gli script che possono inviare non lo fanno finché non aggiungi `--send`, e i client rifiutano di inviare senza un `confirm` esplicito. Tutto il resto legge, oppure lavora su bozze e rubriche, e si può eseguire senza rischi mentre sviluppi.

## Cosa c'è

| | |
| --- | --- |
| [`node/legalsent.mjs`](node/legalsent.mjs) | Un client in un solo file. Nessuna dipendenza, Node.js 20 o successivo |
| [`python/legalsent.py`](python/legalsent.py) | Lo stesso in Python. Solo libreria standard, Python 3.9 o successivo |
| [`node/examples/`](node/examples) e [`python/examples/`](python/examples) | Uno script eseguibile per ogni operazione |
| [`curl/examples.sh`](curl/examples.sh) | Le stesse chiamate con il solo `curl` |
| [`node/test/smoke.mjs`](node/test/smoke.mjs) | Una verifica della tua chiave e del tuo account. Non invia e non spende nulla |
| [`docs/api-reference.md`](docs/api-reference.md) | Il riferimento completo, in inglese: ogni endpoint, campo, errore e limite |
| [`AGENTS.md`](AGENTS.md), [`llms.txt`](llms.txt) | Per agenti di programmazione e modelli linguistici che lavorano con questa API |

Copia il file del client nel tuo progetto e parti dall'esempio più vicino a quello che ti serve. Non c'è niente da installare.

## Prima di cominciare

1. **Un account LegalSent abilitato come mittente.** I nuovi account vengono approvati prima di poter inviare. Fino ad allora un invio risponde `403 SENDER_NOT_ACTIVATED`.
2. **Credito nel portafoglio.** Si ricarica dalla dashboard.
3. **Una chiave API.** Nella dashboard apri **API Docs** e premi **Rotate**. La chiave viene mostrata una volta sola.

```bash
cp .env.example .env      # poi inserisci la tua chiave
```

## Provalo

Verifica che la chiave funzioni, quanto credito c'è e quanto costa una consegna. Solo lettura.

```bash
node --env-file=.env node/examples/01-check-account.mjs
```

Esegui la verifica: dieci controlli sulla chiave e sull'account, senza inviare nulla.

```bash
node --env-file=.env node/test/smoke.mjs
```

Guarda cosa farebbe un invio, senza inviare.

```bash
node --env-file=.env node/examples/02-send-dispatch.mjs \
  --file ./lettera.pdf --subject "Sollecito di pagamento" \
  --first-name Mario --last-name Rossi --email mario.rossi@example.com
```

Aggiungi `--send` a quel comando per recapitarla davvero. Poi seguila e scarica la prova:

```bash
node --env-file=.env node/examples/03-follow-dispatch.mjs <id dell'invio> --wait
```

## Gli esempi

| Script | Cosa fa | Invia? |
| --- | --- | --- |
| `01-check-account.mjs` | Chiave, credito, costo di una consegna, ultimi invii | no |
| `02-send-dispatch.mjs` | Un documento a una persona | solo con `--send` |
| `03-follow-dispatch.mjs` | Stato di un invio; salva la prova di consegna | no |
| `04-campaign.mjs` | La stessa comunicazione a un elenco di persone: bozza, controllo, invio | solo con `--send` |
| `05-contact-lists.mjs` | Crea, riempie, cerca e cancella una rubrica | no |
| `python/examples/check_account.py` | Come `01` | no |
| `python/examples/send_dispatch.py` | Come `02` | solo con `--send` |

## Cinque cose da sapere

1. **L'invio è `multipart/form-data`**, non JSON. Ci pensano i client.
2. **Indica sempre il destinatario** (`recipient` / `recipientData`). Senza, l'API prova a leggerlo dal documento, e può sbagliare.
3. **Indica sempre i canali.** Il valore predefinito è email e SMS insieme: due consegne, due addebiti.
4. **Non ripetere un invio alla cieca.** Non c'è una chiave di idempotenza: la stessa richiesta due volte sono due comunicazioni. Dopo un timeout o un errore `5xx`, elenca gli ultimi invii prima di riprovare.
5. **Non ci sono webhook.** Gli stati si aggiornano ogni cinque minuti: interroga l'API, al massimo una volta ogni paio di minuti.

Il resto è in [`docs/api-reference.md`](docs/api-reference.md), disponibile anche come Markdown su <https://api.legalsent.com/llms-full.txt>.

## Test

I client sono provati contro un server locale di comodo, senza rete e senza chiave:

```bash
node --test node/test/client.test.mjs
python -m unittest discover -s python -p "test_*.py"
```

## Assistenza

Domande sull'API: <support@legalsent.com>. Se c'è di mezzo un errore, indica il suo `requestId`.

## Licenza

[MIT](LICENSE). Usa questo codice come punto di partenza per il tuo.
