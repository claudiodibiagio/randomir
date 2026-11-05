# Randomir · Arena — applicativo per il playtest

Un solo repository, un solo servizio: Cloudflare serve il gioco (cartella `public/`) e fa da arbitro delle partite online (`src/worker.js`). Lo stato di ogni partita vive sul server: ogni browser riceve solo quello che il suo giocatore può sapere (le mani altrui sono solo un numero).

## Cosa c'è dentro

```
public/index.html     il gioco (interfaccia)
public/motore.js      le regole: lo stesso file gira nel browser e sul server
public/archivio.html  l'archivio delle partite finite, con tutte le statistiche
public/assets/        tasselli, carte, dorsi, eventi, plancia, contatori Fama, ritratti
src/worker.js         il server: stanze con codice, viste filtrate, salvataggio a ogni mossa, archivio e nomi
wrangler.toml         configurazione Cloudflare
test/conformita.js    38 verifiche regola per regola  (node test/conformita.js)
test/casuali.js       partite casuali complete         (node test/casuali.js 1000)
```

## Pubblicarlo (una volta sola)

1. Su GitHub crea un repository nuovo (es. `randomir`) e caricaci **tutto il contenuto di questa cartella** così com'è (le cartelle `public`, `src`, `test` e i file `wrangler.toml`, `package.json`, `LEGGIMI.md`).
2. Su Cloudflare: **Workers & Pages → Create → Import a repository**, scegli `randomir`.
   - Build command: lascia vuoto.
   - Deploy command: `npx wrangler deploy` (è quello proposto).
3. Premi Deploy. Alla fine Cloudflare ti dà un indirizzo tipo `https://randomir.<tuonome>.workers.dev`.

Da lì in poi ogni commit sul repository ripubblica da solo.

## Giocare

- Apri l'indirizzo, scrivi il nome, scegli 2–4 giocatori e **Crea partita**: ottieni un codice di 4 lettere e un link da mandare agli amici.
- Gli altri aprono il link (o scrivono il codice) ed entrano. Chi ha creato la partita preme **Che la battaglia inizi!** (si può anche iniziare prima che arrivino tutti).
- Se qualcuno chiude il browser o perde la connessione, riaprendo lo stesso link dallo stesso dispositivo rientra al suo posto.
- **Tavolo locale**: tutti sullo stesso schermo, a turno. Serve per provare le regole da soli.

Come si gioca sullo schermo: clicca un tuo dado (salta quando può agire), poi una casella tratteggiata per muovere o un dado rosso per attaccare. Le carte giocabili in mano sono illuminate. Passando sopra una carta la vedi in grande. Il registro a destra racconta ogni cosa pubblica.

## Caricare le modifiche

Sostituisci su GitHub i file cambiati: Cloudflare ripubblica da solo in circa un minuto (lo vedi in Deployments). Poi ricarica la pagina saltando la cache: su Safari Cmd + Alt + R, oppure una finestra privata.
Carica le modifiche tra una partita e l'altra, non a metà: le partite aperte restano salvate con lo stato vecchio.

## L'archivio

Dal menu, "L'archivio delle partite" (o l'indirizzo `/archivio.html`). Entrano solo le partite **online arrivate alla fine**; il tavolo locale non viene registrato. I dati grezzi sono su `/api/archivio`.
Nel menu compaiono come pulsanti i nomi di chi ha già giocato: sceglierli evita di finire nell'archivio con due nomi diversi (maiuscole e minuscole contano come lo stesso nome).

## Versione del regolamento

Oggi è la **1.0** (04/11/2026). Ogni partita archiviata porta la sua versione e l'archivio si filtra per versione.
Quando cambi le regole: in `public/motore.js` cambia `const VERSIONE = '1.0'` (es. `'1.1'`) e in `public/archivio.html` aggiungi la data in `DATE_VERSIONI`.

## Regole che ho dovuto interpretare

Il manuale non le decide; le ho implementate così e si cambiano in `public/motore.js`.

1. **Elmo e Martello** valgono sia sui danni delle carte e degli eventi sia sulla forza degli attacchi (Martello +X ai tuoi attacchi, Elmo −X agli attacchi contro i tuoi dadi).
2. **Fosso dei Calcoli** si gioca quando un tuo dado è il difensore: −X alla forza di quell'attacco. **Copia Incolla** si gioca quando sei tu ad attaccare: +X a quell'attacco.
3. **Alla Muraglia Quadra!** sceglie una fonte di danno nella catena aperta (Cannone, Fortezza di Gomma, Impatto di Randomir) e ne annulla *tutti* i danni, anche quelli ai dadi degli avversari. Agli **eventi** non si risponde con le carte: si applicano subito.
4. **Leva Piega-Natura**: le due tessere si scambiano, i dadi restano nelle loro caselle (cambia il terreno sotto di loro).
5. **Molla Caotica** e **Impatto di Randomir** spostano il dado senza guadagno o perdita per l'altezza; **Rotolatore Velato** invece è un movimento vero (paga e guadagna con l'altezza) e ruba 1 a ogni dado attraversato, amici compresi.
6. **Un Cubo per un Altro** funziona su qualsiasi Faccia: puoi scambiare anche un dado avversario in mappa con un suo dado Boost.
7. **Attacchi extra** (Specchi Profondi, Raddoppiatore, La Punta più Alta, Lanci di Randomir) non consumano slot azione; ognuno è un attacco vero, apre la sua catena e, se uccide, dà Fama e livello come un attacco.
8. **Da Ogni Lato** colpisce i 4 vicini ortogonali con la forza del dado (+ bonus altezza + X); uccidere un dado amico non dà nulla.
9. **Faccia del Destino**: si sceglie se aggiungere o sottrarre quando si gioca la carta, poi si lancia il Dado Destino.
10. **Scintille di Randomir**: il valore rubato va a un tuo dado in mappa scelto da te. **Eureka!** lo dona al dado Boost più basso del proprietario.
11. **Lago Moltiplicatore** lo può giocare solo chi attacca; Fama 1/2/4 secondo l'altezza dell'attaccante, solo se l'attacco uccide.
12. **Cubi di Vetro** può proteggere qualsiasi dado in mappa. Un attacco dichiarato contro un dado che diventa protetto va a vuoto (lo slot è speso).
13. **Medaglia Angolare**: in caso di pari valore massimo, tutti i dadi a pari merito restano attaccabili.
14. Dadi **coperti** (Molla, Torri): non sono in gioco, ma a fine partita il loro valore conta come dado in campo.
15. Le carte **Racconto** lasciano lo spazio appena si risolvono; le **Aggeggio** all'inizio del tuo turno successivo, prima del Gate (il dado che avevano sopra va al Gate e rientra subito a 6).
16. Contatore Fama: oltre 40 il segnalino resta sul 40 e mostra il numero.

## Limiti noti

- Niente squadre (come deciso). Niente bot (non richiesto).
- Le partite online restano salvate sul server; per ricominciare basta creare un codice nuovo.
