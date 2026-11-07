# Randomir · Arena — applicativo per il playtest

Un solo repository, un solo servizio: Cloudflare serve il gioco (cartella `public/`) e fa da arbitro delle partite online (`src/worker.js`). Lo stato di ogni partita vive sul server: ogni browser riceve solo quello che il suo giocatore può sapere (le mani altrui sono solo un numero).

## Cosa c'è dentro

```
public/index.html     il gioco (interfaccia)
public/motore.js      le regole: lo stesso file gira nel browser e sul server
public/archivio.html  l'archivio delle partite finite, con tutte le statistiche
public/assets/        tasselli, carte, dorsi, eventi, plancia, contatori Fama, ritratti, icone dei simboli
src/worker.js         il server: stanze con codice, viste filtrate, salvataggio a ogni mossa, archivio e nomi
wrangler.toml         configurazione Cloudflare
test/conformita.js    52 verifiche regola per regola  (node test/conformita.js)
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

Come si gioca sullo schermo: clicca un tuo dado (salta quando può agire), poi una casella tratteggiata per muovere o un dado rosso per attaccare. Le carte giocabili in mano sono illuminate. Passando sopra una carta la vedi in grande. Il registro a destra racconta ogni cosa pubblica; sotto ci sono le **Regole rapide** (Turno, Simboli, Altezze, Fama, Catena): si clicca una scheda per leggerla.

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

1. **Costo e Boost**: il costo delle carte si paga con il valore dei propri dadi Boost, spezzandolo come si vuole su più dadi; anche la X delle carte si può prendere da più dadi. Quando la scelta del dado da cui pagare è una sola, il gioco la fa da solo. Un dado che arriva a 0 va al Gate (già a 6).
2. **Elmo, Martello, Scarponi**: il dado messo sopra la carta non serve a pagare il costo, che si paga con gli altri dadi Boost. Restano bloccati sulla carta fino all'inizio del tuo turno successivo, poi vanno al Gate e rientrano subito.
3. **Fase Gate**: prima rientrano i dadi dal Gate, poi si prende 1 Fama per ogni proprio dado in arena, in ogni turno (anche senza rientri). I dadi coperti non contano.
4. **Fase Finale**: dopo lo scarto a 4 carte si sceglie quali dadi del Boost passano al Gate, a 6, qualunque sia il loro valore.
5. **Elmo e Martello** valgono sia sui danni sia sulla forza degli attacchi.
6. **Fosso dei Calcoli** si gioca quando un tuo dado difende, **Copia Incolla** quando attacchi; la X si prende dal Boost avversario (anche da più dadi).
7. **Alla Muraglia Quadra!** annulla tutti i danni di una fonte nella catena (Cannone, Fortezza di Gomma, Impatto di Randomir). Agli **eventi** non si risponde con le carte.
8. **Leva Piega-Natura**: le tessere si scambiano, i dadi restano nelle loro caselle.
9. **Molla Caotica** spinge di X caselle in linea retta; Molla e **Impatto di Randomir** non cambiano il valore per l'altezza. **Rotolatore Velato** sì, e ruba 1 a ogni dado attraversato, amici compresi.
10. **Un Cubo per un Altro** funziona anche su un dado avversario e il suo Boost.
11. **Attacchi extra** (Rompere Specchi Prismatici, La Punta più Alta, Lanci di Randomir, Propulsore Potenziale) non costano slot e valgono come attacchi veri (Fama e livello). Specchi: 1-2 attacchi in tutto, dall'uno o dall'altro dei due dadi scambiati. Propulsore: dopo il movimento, contro un dado adiacente.
12. **Da Ogni Lato** colpisce i 4 vicini ortogonali; uccidere un dado amico non dà nulla.
13. **Faccia del Destino**: aggiungi o sottrai si sceglie giocando la carta, poi si lancia il Dado Destino.
14. **Scintille di Randomir**: il valore rubato va a un tuo dado in mappa scelto da te. **Eureka!** lo dona al dado Boost più basso del proprietario.
15. **Lago Moltiplicatore** lo gioca solo chi attacca: 1/2/4 Fama secondo l'altezza dell'attaccante, solo se l'attacco uccide.
16. **Cubi di Vetro** può proteggere qualsiasi dado; un attacco già dichiarato contro un dado che diventa protetto va a vuoto.
17. **Medaglia Angolare**: con più dadi a pari valore massimo, restano attaccabili tutti quelli.
18. Dadi **coperti**: non sono in gioco, ma a fine partita il loro valore conta come dado in campo.
19. Il **Raddoppiatore** è uscito dal mazzo: al suo posto c'è Propulsore Potenziale (carta n. 22).

## Limiti noti

- Niente squadre (come deciso). Niente bot (non richiesto).
- Le partite online restano salvate sul server; per ricominciare basta creare un codice nuovo.
