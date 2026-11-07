/* ==========================================================================
   RANDOMIR – ARENA · motore di gioco completo (manuale definitivo + carte)
   Deterministico, stato tutto serializzabile in JSON.
   Uso:  const G = R.nuovaPartita({seed, nomi:['Anna','Bruno']});
         // G.richiesta = {gioc, tipo, testo, opzioni:[...]}
         R.rispondi(G, gioc, indiceOpzione);
         R.vista(G, gioc)  -> stato filtrato per quel giocatore
   Funziona nel browser (globalThis.Randomir) e in Node/Worker (require/import).
   ========================================================================== */
(function () {
'use strict';

/* ---------------- RNG a seme (mulberry32, stato nel G) ---------------- */
function rnd(G) {
  G.rs = (G.rs + 0x6D2B79F5) | 0;
  let t = G.rs;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const d6 = G => 1 + Math.floor(rnd(G) * 6);
function mescola(G, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(G) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------------- costanti ---------------- */
const N = 5;
const NOME_ALT = ['basso', 'medio', 'alto'];
const TASSELLI = [];
[['terra', 0, 2], ['terra', 1, 8], ['terra', 2, 2], ['fuoco', 0, 2], ['fuoco', 1, 2], ['fuoco', 2, 2], ['acqua', 0, 4], ['acqua', 1, 2], ['acqua', 2, 1]]
  .forEach(([tipo, alt, k]) => { for (let i = 0; i < k; i++) TASSELLI.push({ tipo, alt }); });
const EVENTI = [];
[['terra', 'positivo', 3], ['terra', 'negativo', 2], ['terra', 'destino', 1], ['fuoco', 'positivo', 1], ['fuoco', 'negativo', 1], ['fuoco', 'destino', 1],
 ['acqua', 'positivo', 1], ['acqua', 'negativo', 1], ['acqua', 'destino', 1]]
  .forEach(([tipo, eff, k]) => { for (let i = 0; i < k; i++) EVENTI.push({ id: tipo + '_' + eff, tipo, eff }); });
const FAZIONI = ['scintilla', 'costrutto', 'impatto', 'lancio'];
const NOME_FAZ = { scintilla: 'Scintilla', costrutto: 'Costrutto', impatto: 'Impatto', lancio: 'Lancio' };
const LIVELLI = { 2: { pesca: 2 }, 3: { spazio: 1, dadi: 1 }, 4: { pesca: 3 }, 5: { spazio: 1, fama: 3 } };
const VERSIONE = '1.0';
const SLOT = 3, MANO_MAX = 4, PESCA_INIZ = 4, PESCA_TURNO = 2, VMAX = 6, LV_MAX = 5, FAMA_CARTA = 3;
// lati: 0 sud, 1 ovest, 2 nord, 3 est (senso orario)
const LATI = [[20, 21, 22, 23, 24], [0, 5, 10, 15, 20], [0, 1, 2, 3, 4], [4, 9, 14, 19, 24]];
const LATI_PER_N = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const NOME_LATO = ['sud', 'ovest', 'nord', 'est'];

const rc = i => [Math.floor(i / N), i % N];
const idx = (r, c) => r * N + c;
function adiacenti(i) {
  const [r, c] = rc(i), o = [];
  if (r > 0) o.push(idx(r - 1, c)); if (r < N - 1) o.push(idx(r + 1, c));
  if (c > 0) o.push(idx(r, c - 1)); if (c < N - 1) o.push(idx(r, c + 1));
  return o;
}
const nomeT = i => { const [r, c] = rc(i); return 'ABCDE'[c] + (r + 1); };

/* ==========================================================================
   STATO DI BASE
   ========================================================================== */
const gioc = (G, id) => G.giocatori[id];
const dado = (G, id) => G.giocatori[Math.floor(id / 3)].dadi[id % 3];
const tuttiDadi = G => G.giocatori.flatMap(g => g.dadi);
const inMappa = G => tuttiDadi(G).filter(d => d.stato === 'mappa');
const dadiDi = (G, gid, stato) => gioc(G, gid).dadi.filter(d => d.stato === stato);
const nemici = (a, b) => a !== b;   // nessuna squadra per ora
const altEff = (G, d) => d.torre ? 2 : G.mappa[d.pos].alt;
const nomeD = (G, d) => `${gioc(G, d.prop).nome}·${d.id % 3 + 1}`;
const spaziLiberi = (G, gid) => gioc(G, gid).spazi - gioc(G, gid).campo.length;

/* ---------------- lanci del Dado Destino durante la partita: ognuno ha il suo banner ---------------- */
function tiroDestino(G, chi, n) { const t = d6(G); const a = { tipo: 'tiro', chi, carta: n, tiro: t, esito: '' }; G.avvisi.push(a); return { t, a }; }

/* ---------------- statistiche per l'archivio ---------------- */
function nuovaStat(n) {
  const per = f => Array.from({ length: n }, f);
  return {
    attacchi: [], carte: [], eventi: [], occupazione: {}, uccisioniAlt: [0, 0, 0], serie: {},
    mov: per(() => ({ piano: 0, salita: 0, discesa: 0, falliti: 0 })),
    fama: per(() => ({ attacco: 0, carta: 0, lago: 0, livello: 0, gate: 0 })),
    uccisioni: per(() => ({ attacco: 0, carta: 0 })),
    morti: per(() => ({ attacco: 0, carta: 0, evento: 0, movimento: 0 })),
    boost: per(() => ({ puntiSpesi: 0, carteBoost: 0, suCarta: 0, avversari: 0, entrati: 0, rientri: 0, campioni: 0, turni: 0, strisce: [] })),
    alGate: per(() => 0), turni: per(() => 0), azioniUsate: per(() => 0), azioniSprecate: per(() => 0), pescate: per(() => 0), scartate: per(() => 0), costoPagato: per(() => 0),
    decisioni: 0,
  };
}
const ST = G => G.st;
function log(G, txt, solo) { G.log.push(solo === undefined ? { n: G.log.length, txt } : { n: G.log.length, txt, solo }); }

function nuovaPartita(opz) {
  const nomi = opz.nomi;
  if (!nomi || nomi.length < 2 || nomi.length > 4) throw new Error('da 2 a 4 giocatori');
  const G = {
    v: 1, seed: (opz.seed >>> 0), rs: (opz.seed >>> 0) || 1,
    n: nomi.length, log: [], uid: 1, rich: 0,
    giocatori: nomi.map((nome, i) => ({
      id: i, nome: String(nome).slice(0, 20) || ('Giocatore ' + (i + 1)), fazione: null, lato: null,
      dadi: [0, 1, 2].map(k => ({ id: i * 3 + k, prop: i, val: 0, stato: 'riserva', pos: null, torre: false })),
      mazzo: [], mano: [], scarti: [], box: [], campo: [],
      fama: 0, livello: 1, spazi: 1,
    })),
    mappa: null, eventi: { mazzo: [], usciti: [], conteggio: { terra: 0, fuoco: 0, acqua: 0 }, corrente: null },
    ordine: [], primo: null, round: 0, ultimoRound: false, turnoIdx: 0,
    pila: [{ k: 'partita', step: 'fazioni' }], coda: [], annullati: [], avvisi: [], cartaInRisoluzione: null, cartaRisIdx: null, eventoInCorso: null,
    st: nuovaStat(nomi.length), resoconto: null, cronaca: [],
    richiesta: null, finita: false, punteggi: null, vincitori: null,
  };
  // ordine di turno con il Dado Destino (rilancio tra i pari)
  let cand = G.giocatori.map(g => g.id); const lanci = [];
  for (;;) {
    const t = cand.map(id => ({ id, t: d6(G) })); lanci.push(t);
    const mx = Math.max(...t.map(x => x.t)), top = t.filter(x => x.t === mx).map(x => x.id);
    if (top.length === 1) { G.primo = top[0]; break; }
    cand = top;
  }
  G.lanciIniziali = lanci;
  lanci.forEach((giro, k) => log(G, (k ? 'Spareggio' : 'Dado Destino per il primo giocatore') + ': ' + giro.map(x => `${gioc(G, x.id).nome} ${x.t}`).join(', ')));
  for (let k = 0; k < G.n; k++) G.ordine.push((G.primo + k) % G.n);
  G.ordine.forEach((gid, k) => { gioc(G, gid).lato = LATI_PER_N[G.n][k]; });
  log(G, `Inizia ${gioc(G, G.primo).nome}. Ordine: ${G.ordine.map(i => gioc(G, i).nome).join(' → ')}`);
  G.avvisi.push({ tipo: 'destino', lanci, primo: G.primo, ordine: G.ordine.slice() });
  G.mappa = mescola(G, TASSELLI.map(t => ({ ...t }))).map((t, i) => ({ ...t, i, pila: [] }));
  G.eventi.mazzo = mescola(G, EVENTI.map((e, i) => ({ ...e, n: i })));
  avanza(G);
  return G;
}

/* ---------------- mappa: pile di dadi (Molla Caotica, Torri) ---------------- */
const sopra = (G, i) => { const p = G.mappa[i].pila; return p.length ? p[p.length - 1] : null; };
const libero = (G, i) => G.mappa[i].pila.length === 0;
function togliDaMappa(G, d) {
  const p = G.mappa[d.pos].pila, k = p.indexOf(d.id);
  if (k >= 0) p.splice(k, 1);
  if (p.length) { const s = dado(G, p[p.length - 1]); if (s.stato === 'sotto') { s.stato = 'mappa'; log(G, `${nomeD(G, s)} torna in gioco su ${nomeT(d.pos)}`); } }
  d.pos = null; d.torre = false;
}
function mettiInMappa(G, d, i) {
  const p = G.mappa[i].pila;
  if (p.length) dado(G, p[p.length - 1]).stato = 'sotto';
  p.push(d.id); d.pos = i; d.stato = 'mappa';
}
function sposta(G, d, i) { togliDaMappa(G, d); mettiInMappa(G, d, i); }

/* ---------------- valori, danni, morte ---------------- */
// effetti attivi legati alle carte in campo
const cartaAttiva = (G, gid, n) => gioc(G, gid).campo.find(c => c.n === n && c.attiva);
function elmo(G, gid) { return gioc(G, gid).campo.filter(c => c.n === 20 && c.attiva && c.dado != null).reduce((s, c) => s + dado(G, c.dado).val, 0); }
function martello(G, gid) { return gioc(G, gid).campo.filter(c => c.n === 21 && c.attiva && c.dado != null).reduce((s, c) => s + dado(G, c.dado).val, 0); }
function medagliaBlocca(G, d) {
  if (!cartaAttiva(G, d.prop, 7)) return false;
  const miei = dadiDi(G, d.prop, 'mappa'); if (!miei.length) return false;
  const mx = Math.max(...miei.map(x => x.val));
  return d.val < mx;
}
function vetro(G, d) { return tuttiDadi(G).length && G.giocatori.some(g => g.campo.some(c => c.n === 28 && c.attiva && (c.protetti || []).includes(d.id))); }
function bersagliabile(G, d) { return d.stato === 'mappa' && !medagliaBlocca(G, d) && !vetro(G, d); }

function cambia(G, d, delta) { d.val = Math.min(VMAX, d.val + delta); }
// uccisione. causa: 'attacco' | 'carta' | 'evento' | 'movimento'; da = giocatore che uccide (per carta/attacco)
function uccidi(G, d, causa, da, info) {
  const valore = Math.max(d.val, 0), pos = d.pos;
  togliDaMappa(G, d);
  d.stato = 'boost'; d.val = causa === 'attacco' ? valore : 1;
  const voce = { tipo: 'uccisione', causa, da: da == null ? null : da, vittima: d.id, prop: d.prop, valore, pos, fama: 0, livello: null,
    carta: G.cartaInRisoluzione || null, ...(info || {}) };
  if (causa === 'attacco' && da != null && nemici(da, d.prop)) {
    const g = gioc(G, da); g.fama += valore; voce.fama = valore;
    log(G, `${g.nome} elimina ${nomeD(G, d)} in attacco: +${valore} Fama`);
    const lv = g.livello; saleLivello(G, g); if (g.livello > lv) voce.livello = g.livello;
  } else if (causa === 'carta' && da != null && nemici(da, d.prop)) {
    gioc(G, da).fama += FAMA_CARTA; voce.fama = FAMA_CARTA;
    log(G, `${gioc(G, da).nome} elimina ${nomeD(G, d)} con una carta: +${FAMA_CARTA} Fama`);
  } else log(G, `${nomeD(G, d)} è eliminato (${causa}) e va nel Boost come 1`);
  ST(G).morti[d.prop][causa]++; ST(G).boost[d.prop].entrati++;
  if (voce.fama && da != null) { ST(G).uccisioni[da][causa]++; ST(G).fama[da][causa] += voce.fama; }
  if (G.cartaRisIdx != null && ST(G).carte[G.cartaRisIdx]) ST(G).carte[G.cartaRisIdx].uccisioni++;
  if (causa === 'evento') { if (G.eventoInCorso) G.eventoInCorso.morti.push(d.id); }
  else if (causa === 'attacco' || causa === 'carta') G.avvisi.push(voce);
}
// perdita di valore che non è danno (rubare, togliere): uccide come carta
function togli(G, d, n, da) {
  if (d.stato !== 'mappa' || n <= 0) return 0;
  const tolto = Math.min(n, d.val);
  d.val -= n;
  if (d.val <= 0) { d.val = 0; uccidi(G, d, 'carta', da); }
  return tolto;
}
// danno: Muraglia (fonte annullata), Medaglia, Elmo, Martello
function danno(G, d, n, fonte) {
  if (d.stato !== 'mappa') return;
  if (fonte && (fonte.annullaDanni || (fonte.uid != null && G.annullati.includes(fonte.uid)))) { log(G, `danno a ${nomeD(G, d)} annullato (Muraglia)`); return; }
  if (medagliaBlocca(G, d)) { log(G, `${nomeD(G, d)} è protetto dalla Medaglia Angolare`); return; }
  let x = n;
  if (fonte && fonte.gioc != null) x += martello(G, fonte.gioc);
  x -= elmo(G, d.prop);
  if (x <= 0) { log(G, `${nomeD(G, d)} non subisce danni`); return; }
  log(G, `${nomeD(G, d)} subisce ${x} dann${x === 1 ? 'o' : 'i'}`);
  d.val -= x;
  if (d.val <= 0) { d.val = 0; uccidi(G, d, fonte && fonte.gioc != null ? 'carta' : 'evento', fonte ? fonte.gioc : null); }
}

function saleLivello(G, g) {
  if (g.livello >= LV_MAX) return;
  g.livello++;
  const L = LIVELLI[g.livello], fx = [];
  if (L.pesca) { pesca(G, g, L.pesca); fx.push(`pesca ${L.pesca}`); }
  if (L.spazio) { g.spazi += L.spazio; fx.push('+1 spazio carta'); }
  if (L.dadi) { for (const d of g.dadi) if (d.stato === 'mappa') cambia(G, d, L.dadi); fx.push('+1 ai dadi in campo'); }
  if (L.fama) { g.fama += L.fama; ST(G).fama[g.id].livello += L.fama; fx.push(`+${L.fama} Fama`); }
  log(G, `${g.nome} sale al livello ${g.livello} (${fx.join(', ')})`);
}
function pesca(G, g, n) {
  let k = 0;
  for (; k < n && g.mazzo.length; k++) g.mano.push(g.mazzo.shift());
  ST(G).pescate[g.id] += k;
  if (k) log(G, `${g.nome} pesca ${k} cart${k === 1 ? 'a' : 'e'}`);
  if (k < n) log(G, `${g.nome}: il mazzo è finito`);
}
function spendiBoost(G, d, x) {
  d.val -= x;
  if (d.val <= 0) { d.val = VMAX; d.stato = 'gate'; log(G, `${nomeD(G, d)} si scarica e va al Gate`); }
}
const sommaBoost = ds => ds.reduce((s, d) => s + d.val, 0);
function dadoSullaCarta(G, c) { const d = dado(G, c.dado); d.stato = 'carta'; }
function lasciaCarta(G, g, c) {
  const k = g.campo.indexOf(c); if (k >= 0) g.campo.splice(k, 1);
  (CARTE[c.n].out === 'box' ? g.box : g.scarti).push({ uid: c.uid, n: c.n });
  if (c.dado != null) { const d = dado(G, c.dado); d.val = VMAX; d.stato = 'gate'; log(G, `${nomeD(G, d)} passa dalla carta al Gate`); }
}

/* ==========================================================================
   LE CARTE
   Ogni carta: dati del manuale + passi (scelte al momento di giocarla) + effetto.
   ctx = contesto della catena: { trig, az } dove az è il frame dell'azione.
   ========================================================================== */
const azioneAttacco = ctx => ctx && ctx.az && ctx.az.k === 'azione' && ctx.az.tipo === 'attacca' ? ctx.az : null;
function boostMiei(G, p, min) { return dadiDi(G, p, 'boost').filter(d => d.val >= (min || 1)); }
function boostAvv(G, p, min) { return tuttiDadi(G).filter(d => d.stato === 'boost' && nemici(d.prop, p) && d.val >= (min || 1)); }
const P = {
  // il dado che va sopra la carta: deve lasciare negli altri dadi abbastanza Boost per il costo
  boost: () => ({ key: 'bd', testo: 'Quale dado Boost metti sopra la carta?', op: (G, f) => { const miei = boostMiei(G, f.p), tot = sommaBoost(miei), costo = CARTE[f.cn].costo;
    return miei.filter(d => tot - d.val >= costo).map(d => ({ dado: d.id, txt: `Boost ${d.val}` })); } }),
  boostAvv: () => ({ key: 'bd', testo: 'Scegli il dado Boost avversario da spendere', op: (G, f) => boostAvv(G, f.p).map(d => ({ dado: d.id, txt: `${gioc(G, d.prop).nome}: Boost ${d.val}` })) }),
  // X si può prendere da più dadi Boost: il massimo è quello che resta dopo il costo
  x: (cap, testo) => ({ key: 'x', testo: testo || 'Quanto spendi (X)?', op: (G, f) => { const c = typeof cap === 'function' ? cap(G, f) : cap; const m = Math.min(disponibileX(G, f), c);
    return Array.from({ length: Math.max(0, m) }, (_, i) => ({ val: i + 1, txt: 'X = ' + (i + 1) })); } }),
  dado: (key, testo, filtro) => ({ key, testo, op: (G, f) => inMappa(G).filter(d => filtro(G, f, d)).map(d => ({ dado: d.id, txt: nomeD(G, d) })) }),
  tassello: (key, testo, filtro) => ({ key, testo, op: (G, f) => G.mappa.filter(t => filtro(G, f, t)).map(t => ({ tassello: t.i, txt: nomeT(t.i) })) }),
};
const mioInMappa = (G, f, d) => d.prop === f.p;
// quanto Boost resta per la X, una volta tenuto da parte il costo della carta
function disponibileX(G, f) {
  const C = CARTE[f.cn];
  if (C.B === 'avv') return sommaBoost(boostAvv(G, f.p));
  return sommaBoost(dadiDi(G, f.p, 'boost').filter(d => d.id !== f.par.bd)) - C.costo;
}
function inLinea(pos, x) {
  const [r, c] = rc(pos), out = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const rr = r + dr * x, cc = c + dc * x; if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(idx(rr, cc)); }
  return out;
}
function modAttacco(az, fonte, v, p) { if (!az) return; az.extra = (az.extra || 0) + v; (az.mods = az.mods || []).push({ t: fonte, v, p }); }
const tuttiInMappa = () => true;

const CARTE = {
  1: { nome: 'Cannone Isometrico', fz: null, tipo: 'aggeggio', costo: 2, out: 'scarti', B: true, trig: null, copie: 3,
    testo: 'Fai 1-2[B] danni a tutti i dadi nemici in alto.',
    req: (G, p) => inMappa(G).some(d => nemici(d.prop, p) && altEff(G, d) === 2),
    passi: [P.x(2, 'Quanti danni fai (1-2 di Boost)?')],
    eff: (G, v) => { const bers = inMappa(G).filter(d => nemici(d.prop, v.p) && altEff(G, d) === 2); if (!bers.length) log(G, 'nessun dado nemico in alto'); bers.forEach(d => danno(G, d, v.par.x, v)); } },
  2: { nome: 'Alla Muraglia Quadra!', fz: null, tipo: 'racconto', costo: 0, out: 'scarti', B: false, trig: null, copie: 3,
    testo: 'Annulla tutti i danni da una qualsiasi fonte.',
    passi: [{ key: 'fonte', testo: 'Di quale fonte annulli i danni?', op: (G, f) => fontiDanno(G, f) }],
    eff: (G, v, ctx) => { if (v.par.fonte === 'evento') { if (ctx.az) ctx.az.annullaDanni = true; } else G.annullati.push(+String(v.par.fonte).slice(1));
      log(G, `${gioc(G, v.p).nome}: la Muraglia annulla i danni di ${v.par.fonteNome}`); } },
  3: { nome: 'Faccia del Destino', fz: null, tipo: 'aggeggio', costo: 0, out: 'scarti', B: false, trig: 'combattimento', copie: 3,
    testo: 'Aggiungi o sottrai il Dado Destino ad un attacco.',
    req: (G, p, ctx) => !!azioneAttacco(ctx),
    passi: [{ key: 'segno', testo: 'Aggiungi o sottrai il Dado Destino all\'attacco?', op: () => [{ val: 1, txt: 'Aggiungi' }, { val: -1, txt: 'Sottrai' }] }],
    eff: (G, v, ctx) => { const az = azioneAttacco(ctx); const { t, a } = tiroDestino(G, v.p, 3); modAttacco(az, 'Faccia del Destino', v.par.segno * t, v.p);
      a.esito = `${v.par.segno > 0 ? '+' : '−'}${t} all'attacco di ${nomeD(G, dado(G, az.att))} contro ${nomeD(G, dado(G, az.dif))}`;
      log(G, `${gioc(G, v.p).nome}: Dado Destino ${t}, ${v.par.segno > 0 ? '+' : '−'}${t} all'attacco`); } },
  4: { nome: 'Fonte Cubica', fz: null, tipo: 'racconto', costo: 0, out: 'scarti', B: true, trig: null, copie: 2,
    testo: 'Spendi X[B] per aggiungere 1 a X dadi in mappa.',
    req: (G) => inMappa(G).length,
    passi: [P.x(G => inMappa(G).length, 'A quanti dadi aggiungi 1 (X di Boost)?'),
      { key: 'dadi', multi: 'x', testo: 'Scegli i dadi a cui aggiungere 1', op: (G, f) => inMappa(G).filter(d => !(f.par.dadi || []).includes(d.id)).map(d => ({ dado: d.id, txt: nomeD(G, d) })) }],
    eff: (G, v) => { for (const id of v.par.dadi) { const d = dado(G, id); if (d.stato === 'mappa') { cambia(G, d, 1); log(G, `${nomeD(G, d)} +1 → ${d.val}`); } } } },
  5: { nome: 'Lago Moltiplicatore', fz: null, tipo: 'racconto', costo: 1, out: 'box', B: false, trig: 'combattimento', copie: 2,
    testo: 'Aggiungi 1/2/4 Fama se risolvi un attacco, a seconda dell\'altezza (dall\'alto in basso).',
    req: (G, p, ctx) => { const az = azioneAttacco(ctx); return az && dado(G, az.att).prop === p; },
    eff: (G, v, ctx) => { const az = azioneAttacco(ctx); az.lago.push(v.p); } },
  6: { nome: 'Guanto Prospettico', fz: null, tipo: 'aggeggio', costo: 1, out: 'box', B: true, trig: null, copie: 2,
    testo: 'Spendi X[B] per aumentare di X un dado in mappa.',
    req: (G) => inMappa(G).length,
    passi: [P.x(99, 'Di quanto aumenti il dado (X di Boost)?'), P.dado('d', 'Quale dado aumenti?', tuttiInMappa)],
    eff: (G, v) => { const d = dado(G, v.par.d); if (d.stato === 'mappa') { cambia(G, d, v.par.x); log(G, `${nomeD(G, d)} +${v.par.x} → ${d.val}`); } } },
  /* ---- SCINTILLA ---- */
  7: { nome: 'Medaglia Angolare', fz: 'scintilla', tipo: 'aggeggio', costo: 0, out: 'scarti', B: false, trig: null, copie: 3,
    testo: 'Solo il tuo dado con il valore maggiore subisce danno o attacco fino all\'inizio del tuo prossimo turno.',
    eff: (G, v) => { v.carta.attiva = true; log(G, `${gioc(G, v.p).nome}: Medaglia Angolare attiva`); } },
  8: { nome: 'Voltafaccia', fz: 'scintilla', tipo: 'aggeggio', costo: 0, out: 'scarti', B: true, trig: null, copie: 3,
    testo: 'Spendi 2[B] per scambiare il valore di 2 dadi in mappa.',
    req: (G) => inMappa(G).length >= 2, fissoX: 2,
    passi: [P.dado('a', 'Primo dado da scambiare', tuttiInMappa), P.dado('b', 'Secondo dado da scambiare', (G, f, d) => d.id !== f.par.a)],
    eff: (G, v) => { const a = dado(G, v.par.a), b = dado(G, v.par.b); if (a.stato === 'mappa' && b.stato === 'mappa') { [a.val, b.val] = [b.val, a.val]; log(G, `Voltafaccia: ${nomeD(G, a)} ↔ ${nomeD(G, b)} (${a.val} e ${b.val})`); } } },
  9: { nome: 'Fosso dei Calcoli', fz: 'scintilla', tipo: 'racconto', costo: 1, out: 'scarti', B: 'avv', trig: 'combattimento', copie: 2,
    testo: 'Spendi X[B] a un dado Boost avversario per prevenire X danni a un tuo dado in mappa.',
    req: (G, p, ctx) => { const az = azioneAttacco(ctx); return az && dado(G, az.dif).prop === p; },
    passi: [P.x(99, 'Quanti danni previeni (X dal Boost avversario)?')],
    eff: (G, v, ctx) => { const az = azioneAttacco(ctx); modAttacco(az, 'Fosso dei Calcoli', -v.par.x, v.p); log(G, `Fosso dei Calcoli: −${v.par.x} all'attacco contro ${nomeD(G, dado(G, az.dif))}`); } },
  10: { nome: 'Copia Incolla', fz: 'scintilla', tipo: 'aggeggio', costo: 1, out: 'box', B: 'avv', trig: null, copie: 3,
    testo: 'Spendi X[B] a un dado Boost avversario per aumentare di X danni un tuo attacco.',
    req: (G, p, ctx) => { const az = azioneAttacco(ctx); return az && dado(G, az.att).prop === p; },
    passi: [P.x(99, 'Di quanto aumenti l\'attacco (X dal Boost avversario)?')],
    eff: (G, v, ctx) => { const az = azioneAttacco(ctx); if (az) { modAttacco(az, 'Copia Incolla', v.par.x, v.p); log(G, `Copia Incolla: +${v.par.x} all'attacco`); } } },
  11: { nome: 'Scintille di Randomir', fz: 'scintilla', tipo: 'racconto', costo: 2, out: 'box', B: false, trig: 'combattimento', copie: 2,
    testo: 'Lancia il Dado Destino e ruba X ad un dado qualsiasi in campo.',
    req: (G, p) => dadiDi(G, p, 'mappa').length && inMappa(G).length >= 2,
    passi: [P.dado('vittima', 'A quale dado rubi?', tuttiInMappa), P.dado('a', 'Quale tuo dado riceve il valore rubato?', (G, f, d) => d.prop === f.p && d.id !== f.par.vittima)],
    eff: (G, v) => { const { t, a: av } = tiroDestino(G, v.p, 11), vit = dado(G, v.par.vittima), a = dado(G, v.par.a);
      log(G, `Scintille di Randomir: Dado Destino ${t}`);
      const nv = nomeD(G, vit), na = nomeD(G, a);
      const r = togli(G, vit, t, v.p); if (a.stato === 'mappa' && r) { cambia(G, a, r); log(G, `${nomeD(G, a)} ruba ${r} → ${a.val}`); }
      av.esito = `${na} ruba ${r} a ${nv}${vit.stato !== 'mappa' ? ', che viene eliminato' : ''}${a.stato === 'mappa' ? ` (ora vale ${a.val})` : ''}`; } },
  12: { nome: 'Eureka!', fz: 'scintilla', tipo: 'racconto', costo: 2, out: 'box', B: false, trig: null, copie: 2,
    testo: 'Togli 3/2/1 a seconda dell\'altezza (dall\'alto in basso) ad un dado avversario e donalo ad un suo dado in Boost, se c\'è.',
    req: (G, p) => inMappa(G).some(d => nemici(d.prop, p)),
    passi: [P.dado('vittima', 'A quale dado avversario togli valore?', (G, f, d) => nemici(d.prop, f.p))],
    eff: (G, v) => { const vit = dado(G, v.par.vittima); if (vit.stato !== 'mappa') return; const q = [1, 2, 3][altEff(G, vit)]; const prop = vit.prop;
      const r = togli(G, vit, q, v.p); log(G, `Eureka!: −${q} a ${nomeD(G, vit)}`);
      const bb = dadiDi(G, prop, 'boost').filter(d => d.id !== vit.id).sort((a, b) => a.val - b.val)[0];
      if (bb && r) { cambia(G, bb, r); log(G, `il valore va al Boost di ${gioc(G, prop).nome} (${bb.val})`); } } },
  /* ---- COSTRUTTO ---- */
  13: { nome: 'Leva Piega-Natura', fz: 'costrutto', tipo: 'aggeggio', costo: 0, out: 'scarti', B: false, trig: 'movimento', copie: 3,
    testo: 'Scambia di posto 2 tessere mappa.',
    passi: [P.tassello('t1', 'Prima tessera da scambiare', () => true), P.tassello('t2', 'Seconda tessera da scambiare', (G, f, t) => t.i !== f.par.t1)],
    eff: (G, v) => { const a = G.mappa[v.par.t1], b = G.mappa[v.par.t2]; for (const k of ['tipo', 'alt']) [a[k], b[k]] = [b[k], a[k]];
      log(G, `Leva Piega-Natura: scambiate le tessere ${nomeT(a.i)} e ${nomeT(b.i)} (i dadi restano dove sono)`); } },
  14: { nome: 'Crescita Quadratica', fz: 'costrutto', tipo: 'aggeggio', costo: 0, out: 'scarti', B: true, trig: null, copie: 3,
    testo: 'Spendi X[B] per aumentare di X il valore del tuo dado che si trova più in basso.',
    req: (G, p) => dadiDi(G, p, 'mappa').length,
    passi: [P.x(99, 'Di quanto aumenti (X di Boost)?'), P.dado('d', 'Il tuo dado più in basso', (G, f, d) => { if (d.prop !== f.p) return false; const mn = Math.min(...dadiDi(G, f.p, 'mappa').map(x => altEff(G, x))); return altEff(G, d) === mn; })],
    eff: (G, v) => { const d = dado(G, v.par.d); if (d.stato === 'mappa') { cambia(G, d, v.par.x); log(G, `${nomeD(G, d)} +${v.par.x} → ${d.val}`); } } },
  15: { nome: 'Un Cubo per un Altro', fz: 'costrutto', tipo: 'racconto', costo: 1, out: 'scarti', B: false, trig: null, copie: 2,
    testo: 'Scambia di posto 1 dado in mappa con 1 dado Boost della stessa Fazione.',
    req: (G) => inMappa(G).some(d => dadiDi(G, d.prop, 'boost').length),
    passi: [P.dado('d', 'Quale dado in mappa scambi?', (G, f, d) => dadiDi(G, d.prop, 'boost').length > 0),
      { key: 'b', testo: 'Con quale dado Boost della stessa Faccia?', op: (G, f) => dadiDi(G, dado(G, f.par.d).prop, 'boost').map(d => ({ dado: d.id, txt: `Boost ${d.val}` })) }],
    eff: (G, v) => { const d = dado(G, v.par.d), b = dado(G, v.par.b); if (d.stato !== 'mappa' || b.stato !== 'boost') return;
      const pos = d.pos; togliDaMappa(G, d); d.stato = 'boost'; mettiInMappa(G, b, pos);
      log(G, `Un Cubo per un Altro: ${nomeD(G, b)} (${b.val}) entra in ${nomeT(pos)}, ${nomeD(G, d)} (${d.val}) va nel Boost`); } },
  16: { nome: 'Molla Caotica', fz: 'costrutto', tipo: 'aggeggio', costo: 1, out: 'box', B: true, trig: null, copie: 3,
    testo: 'Spingi un dado in mappa di X[B] tasselli in linea retta: se il tassello è occupato, il dado sotto non è in gioco finché è coperto.',
    req: (G) => inMappa(G).length,
    passi: [P.dado('d', 'Quale dado spingi?', tuttiInMappa),
      { key: 'x', testo: 'Di quanti tasselli lo spingi (X di Boost)?', op: (G, f) => { const m = disponibileX(G, f); const pos = dado(G, f.par.d).pos; const o = [];
        for (let x = 1; x <= Math.min(m, 4); x++) if (inLinea(pos, x).length) o.push({ val: x, txt: 'X = ' + x }); return o; } },
      P.tassello('a', 'In quale direzione?', (G, f, t) => inLinea(dado(G, f.par.d).pos, f.par.x).includes(t.i))],
    eff: (G, v) => { const d = dado(G, v.par.d); if (d.stato !== 'mappa' || !inLinea(d.pos, v.par.x).includes(v.par.a)) { log(G, 'Molla Caotica: la spinta non è più possibile'); return; }
      const occ = !libero(G, v.par.a); sposta(G, d, v.par.a); log(G, `Molla Caotica: ${nomeD(G, d)} spinto di ${v.par.x} su ${nomeT(v.par.a)}${occ ? ', sopra un altro dado' : ''}`); } },
  17: { nome: 'Torri di Randomir', fz: 'costrutto', tipo: 'racconto', costo: 2, out: 'box', B: false, trig: 'movimento', copie: 2,
    testo: 'Sposta 1 tuo dado in mappa sopra 1 dado in mappa. Il dado sotto non è in gioco finché è coperto. Il tuo dado vale come se fosse in alto.',
    req: (G, p) => dadiDi(G, p, 'mappa').length && inMappa(G).length >= 2,
    passi: [P.dado('d', 'Quale tuo dado sale sulla torre?', mioInMappa), P.dado('su', 'Sopra quale dado?', (G, f, d) => d.id !== f.par.d)],
    eff: (G, v) => { const d = dado(G, v.par.d), s = dado(G, v.par.su); if (d.stato !== 'mappa' || s.stato !== 'mappa') return;
      sposta(G, d, s.pos); d.torre = true; log(G, `Torri di Randomir: ${nomeD(G, d)} sale sopra ${nomeD(G, s)} e vale come se fosse in alto`); } },
  18: { nome: 'Rompere Specchi Prismatici', fz: 'costrutto', tipo: 'racconto', costo: 2, out: 'box', B: true, trig: 'combattimento', copie: 2,
    testo: 'Scambia di posto 2 tuoi dadi. Puoi eseguire 1-2[B] attacchi in tutto con questi dadi.',
    req: (G, p) => dadiDi(G, p, 'mappa').length >= 2,
    passi: [P.dado('a', 'Primo tuo dado', mioInMappa), P.dado('b', 'Secondo tuo dado', (G, f, d) => d.prop === f.p && d.id !== f.par.a), P.x(2, 'Quanti attacchi in tutto (1-2 di Boost)?')],
    eff: (G, v) => { const a = dado(G, v.par.a), b = dado(G, v.par.b); if (a.stato !== 'mappa' || b.stato !== 'mappa') return;
      const pa = a.pos, pb = b.pos, ta = a.torre, tb = b.torre;
      const la = G.mappa[pa].pila, lb = G.mappa[pb].pila; la[la.indexOf(a.id)] = b.id; lb[lb.indexOf(b.id)] = a.id; a.pos = pb; b.pos = pa; a.torre = tb; b.torre = ta;
      log(G, `Rompere Specchi Prismatici: ${nomeD(G, a)} e ${nomeD(G, b)} si scambiano di posto`);
      G.coda.push({ gioc: v.p, dado: a.id, dadi: [a.id, b.id], modo: 'adiacente', bonus: 0, restanti: v.par.x, origine: 'Rompere Specchi Prismatici' }); } },
  /* ---- IMPATTO ---- */
  19: { nome: 'Fortezza di Gomma', fz: 'impatto', tipo: 'racconto', costo: 0, out: 'scarti', B: false, trig: 'combattimento', copie: 2,
    testo: 'Annulla un attacco da un dado adiacente, poi lancia il Dado Destino: da 3 a 6 infliggi 2 danni al dado che ti attacca.',
    req: (G, p, ctx) => { const az = azioneAttacco(ctx); if (!az) return false; const a = dado(G, az.att), d = dado(G, az.dif); return d.prop === p && a.stato === 'mappa' && d.stato === 'mappa' && adiacenti(a.pos).includes(d.pos); },
    eff: (G, v, ctx) => { const az = azioneAttacco(ctx); az.annullato = true; const { t, a } = tiroDestino(G, v.p, 19); log(G, `Fortezza di Gomma annulla l'attacco. Dado Destino: ${t}`);
      a.esito = t >= 3 ? `l'attacco è annullato e ${nomeD(G, dado(G, az.att))} subisce 2 danni` : `l'attacco è annullato, ma il dado che attacca non subisce danni (serviva da 3 a 6)`;
      if (t >= 3) danno(G, dado(G, az.att), 2, v); } },
  20: { nome: 'Elmo Tutto a Punta', fz: 'impatto', tipo: 'aggeggio', costo: 1, out: 'scarti', B: 'carta', trig: null, copie: 3,
    testo: 'Muovi uno dei dadi Boost sopra questa carta: riduci del suo ammontare tutti i danni che riceveresti fino all\'inizio del tuo prossimo turno. Poi il dado va al Gate.',
    req: (G, p) => boostMiei(G, p).length, passi: [P.boost()],
    eff: (G, v) => { v.carta.attiva = true; log(G, `${gioc(G, v.p).nome}: Elmo Tutto a Punta attivo (−${dado(G, v.carta.dado).val})`); } },
  21: { nome: 'Martello Spigoloso', fz: 'impatto', tipo: 'aggeggio', costo: 1, out: 'scarti', B: 'carta', trig: null, copie: 3,
    testo: 'Muovi uno dei dadi Boost sopra questa carta: aumenta del suo ammontare tutti i danni che faresti fino all\'inizio del tuo prossimo turno. Poi il dado va al Gate.',
    req: (G, p) => boostMiei(G, p).length, passi: [P.boost()],
    eff: (G, v) => { v.carta.attiva = true; log(G, `${gioc(G, v.p).nome}: Martello Spigoloso attivo (+${dado(G, v.carta.dado).val})`); } },
  22: { nome: 'Propulsore Potenziale', fz: 'impatto', tipo: 'aggeggio', costo: 0, out: 'box', B: false, trig: 'movimento', copie: 3,
    testo: 'Alla fine del movimento il dado può attaccare senza spendere uno slot azione.',
    req: (G, p, ctx) => ctx && ctx.az && ctx.az.k === 'azione' && ctx.az.tipo === 'muovi' && dado(G, ctx.az.dado).prop === p,
    eff: (G, v, ctx) => { const az = ctx.az; if (az && az.tipo === 'muovi') { az.propulsore = v.p; log(G, `Propulsore Potenziale: dopo il movimento ${nomeD(G, dado(G, az.dado))} potrà attaccare gratis`); } } },
  23: { nome: 'Impatto di Randomir', fz: 'impatto', tipo: 'racconto', costo: 2, out: 'box', B: false, trig: null, copie: 2,
    testo: 'Salta su una casella, fai 0/1/2 danni a seconda dell\'altezza (dall\'alto in basso) a tutti i dadi adiacenti ortogonali.',
    req: (G, p) => dadiDi(G, p, 'mappa').length,
    passi: [P.dado('d', 'Quale tuo dado salta?', mioInMappa), P.tassello('a', 'Su quale casella libera atterra?', (G, f, t) => libero(G, t.i))],
    eff: (G, v) => { const d = dado(G, v.par.d); if (d.stato !== 'mappa' || !libero(G, v.par.a)) { log(G, 'Impatto di Randomir: il salto non è più possibile'); return; }
      sposta(G, d, v.par.a); const q = [2, 1, 0][G.mappa[v.par.a].alt]; log(G, `Impatto di Randomir: ${nomeD(G, d)} salta su ${nomeT(v.par.a)} (${NOME_ALT[G.mappa[v.par.a].alt]}), ${q} danni attorno`);
      if (q > 0) adiacenti(v.par.a).map(i => sopra(G, i)).filter(x => x != null).map(id => dado(G, id)).forEach(x => danno(G, x, q, v)); } },
  24: { nome: 'Da Ogni Lato', fz: 'impatto', tipo: 'racconto', costo: 2, out: 'box', B: 'opz', trig: 'combattimento', copie: 2,
    testo: 'Attacca in contemporanea le tessere attorno ad un tuo dado. Puoi spendere X[B] per aumentare di X questo attacco. Colpisce anche i dadi amici.',
    req: (G, p) => dadiDi(G, p, 'mappa').length,
    passi: [P.dado('d', 'Con quale tuo dado attacchi tutto attorno?', mioInMappa),
      { key: 'x', testo: 'Vuoi aumentare l\'attacco con il Boost (X)?', op: (G, f) => { const m = disponibileX(G, f); return Array.from({ length: m + 1 }, (_, i) => ({ val: i, txt: i ? '+' + i : 'No, nessun Boost' })); } }],
    eff: (G, v) => { const a = dado(G, v.par.d); if (a.stato !== 'mappa') return;
      const bers = adiacenti(a.pos).map(i => sopra(G, i)).filter(x => x != null).map(id => dado(G, id)).filter(d => bersagliabile(G, d));
      log(G, `Da Ogni Lato: ${nomeD(G, a)} attacca ${bers.length} dadi attorno`);
      for (const d of bers) { const az = { att: a.id, dif: d.id, extra: 0, mods: [], annullato: false, lago: [], gratis: true, origine: 'Da Ogni Lato' }; if (v.par.x) modAttacco(az, 'Da Ogni Lato', v.par.x, v.p); risolviAttacco(G, az); } } },
  /* ---- LANCIO ---- */
  25: { nome: 'La Punta più Alta', fz: 'lancio', tipo: 'racconto', costo: 1, out: 'scarti', B: false, trig: 'combattimento', copie: 2,
    testo: 'Scegli un tuo dado in mappa: puoi attaccare un qualsiasi dado più alto di te, ovunque nella mappa.',
    req: (G, p) => dadiDi(G, p, 'mappa').length,
    passi: [P.dado('d', 'Quale tuo dado attacca dal basso?', mioInMappa)],
    eff: (G, v) => { G.coda.push({ gioc: v.p, dado: v.par.d, modo: 'piuAlto', bonus: 0, restanti: 1, origine: 'La Punta più Alta' }); } },
  26: { nome: 'Rotolatore Velato', fz: 'lancio', tipo: 'aggeggio', costo: 0, out: 'scarti', B: true, trig: 'movimento', copie: 3,
    testo: 'Spendi X[B] per muoverti di X tessere. Ruba 1 da ogni dado che attraversi. Non puoi fermarti su una tessera occupata.',
    req: (G, p) => dadiDi(G, p, 'mappa').length,
    passi: [P.dado('d', 'Quale tuo dado rotola?', mioInMappa), P.x(99, 'Di quante tessere ti muovi (X di Boost)?'),
      { key: 'percorso', percorso: true, testo: 'Traccia il percorso, una tessera alla volta', op: (G, f) => opzioniPercorso(G, f) }],
    eff: (G, v) => { const d = dado(G, v.par.d); if (d.stato !== 'mappa') return; const path = v.par.percorso;
      const fine = path[path.length - 1]; if (!libero(G, fine) && sopra(G, fine) !== d.id) { log(G, 'Rotolatore Velato: la tessera d\'arrivo è occupata, il dado non si muove'); return; }
      let rubato = 0;
      for (let k = 0; k < path.length - 1; k++) { const s = sopra(G, path[k]); if (s != null && s !== d.id) { const x = dado(G, s); const r = togli(G, x, 1, v.p); if (r) { rubato += r; } } }
      const daAlt = altEff(G, d); sposta(G, d, fine); const delta = daAlt - G.mappa[fine].alt;
      log(G, `Rotolatore Velato: ${nomeD(G, d)} rotola fino a ${nomeT(fine)} rubando ${rubato}`);
      cambia(G, d, rubato); if (delta) variaPerAltezza(G, d, delta); } },
  27: { nome: 'Scarponi Geometrici', fz: 'lancio', tipo: 'aggeggio', costo: 0, out: 'scarti', B: 'carta', trig: 'movimento', copie: 3,
    testo: 'Muovi uno dei dadi Boost sopra questa carta: se ti muovi verso l\'alto, scarica il dado invece di ridurre il valore del dado in mappa. Poi il dado va al Gate.',
    req: (G, p) => boostMiei(G, p).length, passi: [P.boost()],
    eff: (G, v) => { v.carta.attiva = true; log(G, `${gioc(G, v.p).nome}: Scarponi Geometrici attivi (${dado(G, v.carta.dado).val})`); } },
  28: { nome: 'Cubi di Vetro', fz: 'lancio', tipo: 'aggeggio', costo: 1, out: 'box', B: true, trig: null, copie: 3,
    testo: 'Fino al tuo prossimo turno, 1-3[B] dadi in mappa non possono essere bersagli di attacchi.',
    req: (G) => inMappa(G).length,
    passi: [P.x(G => Math.min(3, inMappa(G).length), 'Quanti dadi proteggi (1-3 di Boost)?'),
      { key: 'dadi', multi: 'x', testo: 'Scegli i dadi da proteggere', op: (G, f) => inMappa(G).filter(d => !(f.par.dadi || []).includes(d.id)).map(d => ({ dado: d.id, txt: nomeD(G, d) })) }],
    eff: (G, v) => { v.carta.protetti = v.par.dadi.slice(); v.carta.attiva = true; log(G, `Cubi di Vetro: ${v.par.dadi.map(id => nomeD(G, dado(G, id))).join(', ')} non possono essere attaccati`); } },
  29: { nome: 'Lanci di Randomir', fz: 'lancio', tipo: 'racconto', costo: 2, out: 'box', B: true, trig: 'combattimento', copie: 2,
    testo: 'Scegli un tuo dado in mappa, spendi X[B] per attaccare X dadi ovunque nella mappa.',
    req: (G, p) => dadiDi(G, p, 'mappa').length,
    passi: [P.dado('d', 'Quale tuo dado lancia?', mioInMappa), P.x(99, 'Quanti attacchi (X di Boost)?')],
    eff: (G, v) => { G.coda.push({ gioc: v.p, dado: v.par.d, modo: 'ovunque', bonus: 0, restanti: v.par.x, origine: 'Lanci di Randomir' }); } },
  30: { nome: 'Notte nella Contea', fz: 'lancio', tipo: 'racconto', costo: 2, out: 'box', B: false, trig: null, copie: 2,
    testo: 'Ruba 1 a ogni dado nemico intorno a te in mappa e aggiungilo ad un tuo dado nel Boost.',
    req: (G, p) => dadiDi(G, p, 'mappa').length && dadiDi(G, p, 'boost').length,
    passi: [P.dado('d', 'Attorno a quale tuo dado rubi?', mioInMappa), { key: 'b', testo: 'Quale tuo dado Boost riceve?', op: (G, f) => dadiDi(G, f.p, 'boost').map(d => ({ dado: d.id, txt: `Boost ${d.val}` })) }],
    eff: (G, v) => { const d = dado(G, v.par.d), b = dado(G, v.par.b); if (d.stato !== 'mappa') return; let r = 0;
      for (const i of adiacenti(d.pos)) { const s = sopra(G, i); if (s != null && nemici(dado(G, s).prop, v.p)) r += togli(G, dado(G, s), 1, v.p); }
      if (b.stato === 'boost') cambia(G, b, r); log(G, `Notte nella Contea: rubati ${r}, il Boost sale a ${b.val}`); } },
};
for (const n in CARTE) CARTE[n].n = +n;

function opzioniPercorso(G, f) {
  const path = f.par.percorso || [dado(G, f.par.d).pos];
  const passi = path.length - 1, X = f.par.x, cur = path[path.length - 1];
  const io = f.par.d;
  // si può arrivare in una tessera libera con esattamente i passi restanti?
  const raggiungibile = (from, rest) => {
    let fr = new Set([from]);
    for (let k = 0; k < rest; k++) { const nx = new Set(); fr.forEach(i => adiacenti(i).forEach(j => nx.add(j))); fr = nx; }
    return [...fr].some(i => libero(G, i) || sopra(G, i) === io);
  };
  if (passi >= X) return [];
  return adiacenti(cur).filter(i => raggiungibile(i, X - passi - 1)).map(i => ({ tassello: i, txt: nomeT(i) }));
}

/* ---- fonti di danno per la Muraglia ---- */
function fontiDanno(G, f) {
  const out = [], cat = catenaAperta(G);
  if (cat) {
    const az = cat.ctxIdx != null ? G.pila[cat.ctxIdx] : null;
    (cat.voci || []).forEach(v => { if (DANNO.includes(v.n)) out.push({ val: 'u' + v.uid, txt: `${CARTE[v.n].nome} di ${gioc(G, v.p).nome}` }); });
  }
  return out;
}
const DANNO = [1, 19, 23];
function catenaAperta(G) { for (let i = G.pila.length - 1; i >= 0; i--) if (G.pila[i].k === 'catena') return G.pila[i]; return null; }
function nomeEvento(e) { return `${e.tipo[0].toUpperCase() + e.tipo.slice(1)} ${e.eff}`; }

/* ==========================================================================
   MOVIMENTO E ATTACCO
   ========================================================================== */
function variaPerAltezza(G, d, delta) {
  if (delta > 0) { cambia(G, d, delta); return; }
  let costo = -delta;
  const sc = gioc(G, d.prop).campo.find(c => c.n === 27 && c.attiva && c.dado != null && dado(G, c.dado).val > 0);
  if (sc) { const bd = dado(G, sc.dado); const k = Math.min(costo, bd.val); bd.val -= k; costo -= k; log(G, `Scarponi Geometrici: la salita costa ${k} al dado sulla carta (resta ${bd.val})`); }
  if (costo > 0) { d.val -= costo; if (d.val <= 0) { d.val = 0; uccidi(G, d, 'movimento', null); } }
}
function eseguiMovimento(G, az) {
  const d = dado(G, az.dado);
  if (d.stato !== 'mappa' || d.pos !== az.da || !libero(G, az.a)) { ST(G).mov[az.gioc].falliti++; log(G, `il movimento di ${nomeD(G, d)} non è più possibile (azione spesa)`); return; }
  const daAlt = altEff(G, d);
  sposta(G, d, az.a);
  const delta = daAlt - G.mappa[az.a].alt;
  ST(G).mov[az.gioc][delta > 0 ? 'discesa' : delta < 0 ? 'salita' : 'piano']++;
  log(G, `${nomeD(G, d)} si muove su ${nomeT(az.a)}${delta > 0 ? ` (scende, +${delta})` : delta < 0 ? ` (sale, −${-delta})` : ''}`);
  if (delta) variaPerAltezza(G, d, delta);
  G.cronaca.push({ n: G.cronaca.length, tipo: 'mossa', p: az.gioc, d: d.id, a: az.a, delta });
  if (az.propulsore != null && d.stato === 'mappa') G.coda.push({ gioc: az.propulsore, dado: d.id, modo: 'adiacente', bonus: 0, restanti: 1, origine: 'Propulsore Potenziale' });
}
function forzaAttacco(G, a, d, extra) {
  const bonus = Math.max(0, altEff(G, a) - altEff(G, d));
  return a.val + bonus + (extra || 0) + martello(G, a.prop) - elmo(G, d.prop);
}
function contoAttacco(G, az) {
  const a = dado(G, az.att), d = dado(G, az.dif);
  const voci = [];
  if (a.stato === 'mappa' && d.stato === 'mappa') { const b = Math.max(0, altEff(G, a) - altEff(G, d)); if (b) voci.push({ t: `dall'alto (+${b})`, v: b }); }
  for (const m of az.mods || []) voci.push({ t: m.t, v: m.v });
  const mt = martello(G, a.prop); if (mt) voci.push({ t: 'Martello Spigoloso', v: mt });
  const el = elmo(G, d.prop); if (el) voci.push({ t: 'Elmo Tutto a Punta', v: -el });
  const forza = a.val + voci.reduce((s, x) => s + x.v, 0);
  return { att: a.id, dif: d.id, pA: a.prop, pD: d.prop, vA: a.val, vD: d.val, voci, forza, vince: forza >= d.val, gratis: !!az.gratis, origine: az.origine || null, annullato: !!az.annullato };
}
function risolviAttacco(G, az) {
  const a = dado(G, az.att), d = dado(G, az.dif);
  const rec = { p: a.prop, dif: d.prop, aA: a.stato === 'mappa' ? altEff(G, a) : null, aD: d.stato === 'mappa' ? altEff(G, d) : null,
    vA: a.val, vD: d.val, forza: null, esito: null, gratis: !!az.gratis, origine: az.origine || null, r: G.round };
  const conto = contoAttacco(G, az);
  const chiudi = esito => { rec.esito = esito; ST(G).attacchi.push(rec); G.cronaca.push({ n: G.cronaca.length, tipo: 'attacco', ...conto, esito });
    for (const k of az.carteIdx || []) { const c = ST(G).carte[k]; if (c) c.esitoAtt = esito; } };
  if (az.annullato) { log(G, `l'attacco di ${nomeD(G, a)} è annullato`); return chiudi('annullato'); }
  if (a.stato !== 'mappa' || d.stato !== 'mappa') { log(G, `l'attacco di ${nomeD(G, a)} non ha più bersaglio (azione spesa)`); return chiudi('nullo'); }
  if (!bersagliabile(G, d)) { log(G, `${nomeD(G, d)} non può essere attaccato: attacco perso`); return chiudi('nullo'); }
  const f = forzaAttacco(G, a, d, az.extra); rec.forza = f;
  if (f >= d.val) {
    log(G, `${nomeD(G, a)} attacca ${nomeD(G, d)}: ${f} contro ${d.val}, vince`);
    for (const p of az.lago || []) if (p === a.prop) { const q = [4, 2, 1][altEff(G, a)]; gioc(G, p).fama += q; ST(G).fama[p].lago += q; log(G, `Lago Moltiplicatore: +${q} Fama a ${gioc(G, p).nome}`); }
    if (nemici(a.prop, d.prop)) ST(G).uccisioniAlt[altEff(G, a)]++;
    chiudi('vinto');
    uccidi(G, d, 'attacco', a.prop, { att: a.id, attVal: a.val, forza: f });
  } else { log(G, `${nomeD(G, a)} attacca ${nomeD(G, d)}: ${f} contro ${d.val}, non basta`); chiudi('perso'); }
}

/* ==========================================================================
   MACCHINA A FRAME: ogni passo che chiede una decisione imposta G.richiesta
   ========================================================================== */
function chiedi(G, gid, tipo, testo, opzioni, extra) {
  G.rich++;
  G.richiesta = Object.assign({ n: G.rich, gioc: gid, tipo, testo, opzioni: opzioni.map((o, i) => ({ ...o, i })) }, extra || {});
}
function rispondi(G, gid, i) {
  const R = G.richiesta;
  if (!R || G.finita) throw new Error('nessuna decisione in attesa');
  if (R.gioc !== gid) throw new Error('non tocca a te');
  const o = R.opzioni[i]; if (!o) throw new Error('opzione inesistente');
  G.richiesta = null;
  if (G.st) G.st.decisioni++;
  G.pila[G.pila.length - 1].risposta = o;
  avanza(G);
  return G;
}
function avanza(G) {
  let guardia = 0;
  while (!G.richiesta && !G.finita) {
    if (++guardia > 5000) throw new Error('ciclo infinito nel motore');
    let f = G.pila[G.pila.length - 1];
    if (G.avvisi.length && f.k !== 'avviso' && !G.finita) f = push(G, { k: 'avviso', a: G.avvisi.splice(0) });
    H[f.k](G, f);
  }
}
const pop = G => G.pila.pop();
const push = (G, f) => { G.pila.push(f); return f; };
function prendiRisposta(f) { const r = f.risposta; f.risposta = null; return r; }

const H = {};

/* ---------- partita: set-up, round, fine ---------- */
H.partita = (G, f) => {
  const r = prendiRisposta(f);
  if (f.step === 'fazioni') {
    // scelta delle Facce dall'ultimo al primo
    f.coda = f.coda || G.ordine.slice().reverse(); f.i = f.i || 0;
    if (r) { const g = gioc(G, f.coda[f.i]); g.fazione = r.val; log(G, `${g.nome} sceglie la Faccia ${NOME_FAZ[r.val]}`); f.i++; }
    if (f.i < f.coda.length) {
      const prese = G.giocatori.map(g => g.fazione);
      chiedi(G, f.coda[f.i], 'fazione', 'Scegli la tua Faccia della Contea', FAZIONI.filter(z => !prese.includes(z)).map(z => ({ val: z, txt: NOME_FAZ[z], fazione: z })));
      return;
    }
    // mazzi, lancio dei dadi
    for (const g of G.giocatori) {
      g.mazzo = [];
      for (const n in CARTE) { const c = CARTE[n]; if (c.fz === null || c.fz === g.fazione) for (let k = 0; k < c.copie; k++) g.mazzo.push({ uid: G.uid++, n: +n }); }
      mescola(G, g.mazzo);
      for (const d of g.dadi) d.val = d6(G);
      log(G, `${g.nome} lancia i Dadi Eroe: ${g.dadi.map(d => d.val).join(', ')}`);
    }
    f.step = 'ingresso'; f.i = 0; f.coda = G.ordine.slice().reverse(); return;
  }
  if (f.step === 'ingresso') {
    if (r) { const g = gioc(G, f.coda[f.i]); g.dadi.forEach(d => { d.stato = r.dadi.includes(d.id) ? 'attesa' : 'boost'; });
      log(G, `${g.nome} manda in arena ${r.dadi.length} dad${r.dadi.length === 1 ? 'o' : 'i'}${r.dadi.length < 3 ? ', gli altri nel Boost' : ''}`); f.i++; }
    if (f.i < f.coda.length) {
      const g = gioc(G, f.coda[f.i]), ops = [];
      for (let m = 7; m >= 1; m--) { const ds = g.dadi.filter((d, k) => m & (1 << k)); ops.push({ dadi: ds.map(d => d.id), txt: 'In arena: ' + ds.map(d => d.val).join(' + ') }); }
      chiedi(G, g.id, 'ingresso', 'Quali dadi mandi in arena? (almeno uno; gli altri vanno nel Boost)', ops);
      return;
    }
    f.step = 'piazza'; f.i = 0; return;
  }
  if (f.step === 'piazza') {
    const coda = G.ordine.slice().reverse();
    if (r) { const d = dado(G, r.dado); mettiInMappa(G, d, r.tassello); log(G, `${gioc(G, d.prop).nome} piazza un ${d.val} su ${nomeT(r.tassello)}`); f.i = (f.i + 1) % coda.length; }
    for (let k = 0; k < coda.length; k++) {
      const gid = coda[(f.i + k) % coda.length], ds = dadiDi(G, gid, 'attesa');
      if (ds.length) {
        f.i = (f.i + k) % coda.length;
        const d = ds[0];
        chiedi(G, gid, 'piazza', `Piazza il tuo dado da ${d.val} dove vuoi`, G.mappa.filter(t => libero(G, t.i)).map(t => ({ dado: d.id, tassello: t.i, txt: nomeT(t.i) })), { dadoDaPiazzare: d.id });
        return;
      }
    }
    for (const gid of G.ordine) pesca(G, gioc(G, gid), PESCA_INIZ);
    f.step = 'round'; return;
  }
  if (f.step === 'round') {
    if (G.ultimoRound && G.round > 0) { f.step = 'fine'; return; }
    G.round++; G.turnoIdx = 0;
    const e = G.eventi.mazzo.shift();
    G.eventi.usciti.push(e); G.eventi.corrente = e; G.eventi.conteggio[e.tipo]++;
    log(G, `— Round ${G.round} — Evento: ${nomeEvento(e)}`);
    if (G.eventi.conteggio[e.tipo] >= 3) { G.ultimoRound = true; log(G, `Terza carta ${e.tipo}: questo è l'ultimo round!`); }
    f.step = 'turni';
    push(G, { k: 'evento', e, step: 0 });
    return;
  }
  if (f.step === 'turni') {
    if (G.turnoIdx >= G.n) { f.step = 'round'; return; }
    push(G, { k: 'turno', gioc: G.ordine[G.turnoIdx], step: 'inizio', slot: SLOT });
    G.turnoIdx++;
    return;
  }
  if (f.step === 'fine') { chiudiPartita(G); return; }
};

function bannerEvento(G, e, ds, prima, extra) {
  ST(G).eventi.push({ r: G.round, tipo: e.tipo, eff: e.eff, tiro: e.tiro || null, dadi: ds.length, morti: ds.filter(d => d.stato !== 'mappa').length,
    delta: ds.reduce((s, d) => s + ((d.stato === 'mappa' ? d.val : 0) - prima[d.id].val), 0), annullato: !!(extra && extra.annullato) });
  G.avvisi.push({ tipo: 'evento', round: G.round, ultimo: G.ultimoRound, e: { tipo: e.tipo, eff: e.eff, tiro: e.tiro || null },
    dadi: ds.map(d => ({ id: d.id, prop: d.prop, pos: prima[d.id].pos, alt: prima[d.id].alt, prima: prima[d.id].val, dopo: d.stato === 'mappa' ? d.val : null, morto: d.stato !== 'mappa' })),
    ...(extra || {}) });
}
H.evento = (G, f) => {
  const e = f.e;
  const coinvolti = () => inMappa(G).filter(d => G.mappa[d.pos].tipo === e.tipo);
  const foto = ds => { const o = {}; ds.forEach(d => { o[d.id] = { val: d.val, pos: d.pos, alt: altEff(G, d) }; }); return o; };
  if (e.eff === 'positivo') {
    const ds = coinvolti(), prima = foto(ds);
    ds.forEach(d => { const q = [2, 1, 0][altEff(G, d)]; if (q) cambia(G, d, q); });
    log(G, `Evento: +2/+1/+0 ai dadi su ${e.tipo} (${ds.length} dadi)`);
    bannerEvento(G, e, ds, prima); pop(G); return;
  }
  if (e.eff === 'destino') {
    const t = d6(G); e.tiro = t;
    const ds = coinvolti(), prima = foto(ds);
    ds.forEach(d => { d.val = t; });
    log(G, `Evento: Dado Destino ${t}, tutti i dadi su ${e.tipo} valgono ${t} (${ds.length} dadi)`);
    bannerEvento(G, e, ds, prima); pop(G); return;
  }
  // negativo: è danno, ma agli eventi non si risponde con le carte
  const ds = coinvolti(), prima = foto(ds);
  log(G, `Evento: −2/−1/−0 ai dadi su ${e.tipo}`);
  G.eventoInCorso = { morti: [] };
  ds.forEach(d => { const q = [0, 1, 2][altEff(G, d)]; if (q) danno(G, d, q, f); });
  G.eventoInCorso = null;
  bannerEvento(G, e, ds, prima, { annullato: !!f.annullaDanni });
  pop(G);
};

/* ---------- banner: il primo giocatore dà l'ok per tutti ---------- */
H.avviso = (G, f) => {
  if (prendiRisposta(f)) { pop(G); return; }
  const a = f.a[0];
  const testo = a.tipo === 'destino' ? 'Dado Destino: chi inizia la partita' : a.tipo === 'evento' ? `Round ${a.round}: evento ${a.e.tipo} ${a.e.eff}` : 'Un dado è stato eliminato';
  chiedi(G, G.primo, 'avviso', testo, [{ tipo: 'ok', txt: 'Ok, avanti' }], { avviso: f.a });
};

/* ---------- il turno ---------- */
H.turno = (G, f) => {
  const g = gioc(G, f.gioc), r = prendiRisposta(f);
  if (f.step === 'inizio') {
    log(G, `Turno di ${g.nome}`);
    const S = ST(G); S.turni[g.id]++;
    for (const d of inMappa(G)) { const k = G.mappa[d.pos].tipo + '_' + altEff(G, d); S.occupazione[k] = (S.occupazione[k] || 0) + 1; }
    const B = S.boost[g.id]; B.turni++;
    for (const d of g.dadi) {
      if (d.stato === 'boost') { B.campioni++; S.serie[d.id] = (S.serie[d.id] || 0) + 1; }
      else if (S.serie[d.id]) { B.strisce.push(S.serie[d.id]); delete S.serie[d.id]; }
    }
    // gli Aggeggi scadono all'inizio del proprio turno, prima del Gate
    for (const c of g.campo.slice()) if (CARTE[c.n].tipo === 'aggeggio') { lasciaCarta(G, g, c); log(G, `${CARTE[c.n].nome} di ${g.nome} lascia il campo`); }
    f.step = 'gate'; return;
  }
  if (f.step === 'gate') {
    if (r) { const d = dado(G, r.dado); d.val = VMAX; mettiInMappa(G, d, r.tassello); ST(G).boost[g.id].rientri++; f.rientrati = (f.rientrati || 0) + 1; log(G, `${nomeD(G, d)} rientra dal Gate a 6 su ${nomeT(r.tassello)}`); }
    const gate = dadiDi(G, g.id, 'gate');
    if (gate.length) {
      let cand = LATI[g.lato].filter(i => libero(G, i));
      if (!cand.length) cand = [...LATI[(g.lato + 1) % 4], ...LATI[(g.lato + 3) % 4]].filter(i => libero(G, i));
      if (!cand.length) cand = G.mappa.filter(t => libero(G, t.i)).map(t => t.i);
      cand = [...new Set(cand)];
      if (cand.length) { chiedi(G, g.id, 'gate', 'Fase Gate: scegli dove rientra il dado (a 6)', cand.map(i => ({ dado: gate[0].id, tassello: i, txt: nomeT(i) }))); return; }
    }
    // Fama del Gate: 1 per ogni dado in arena dopo i rientri, in ogni turno
    const inArena = dadiDi(G, g.id, 'mappa').length;
    const rientrati = f.rientrati || 0;
    if (inArena) { g.fama += inArena; ST(G).fama[g.id].gate += inArena; log(G, `${g.nome} ha ${inArena} dad${inArena === 1 ? 'o' : 'i'} in arena: +${inArena} Fama`); }
    G.cronaca.push({ n: G.cronaca.length, tipo: 'gate', p: g.id, rientrati, fama: inArena });
    f.step = 'pesca'; return;
  }
  if (f.step === 'pesca') { pesca(G, g, PESCA_TURNO); f.step = 'azione'; return; }
  if (f.step === 'azione') {
    if (G.coda.length) { push(G, { k: 'extra' }); return; }
    if (r) {
      if (r.tipo === 'fine') { ST(G).azioniSprecate[g.id] += f.slot; f.step = 'scarto'; return; }
      if (r.tipo === 'muovi' || r.tipo === 'attacca') ST(G).azioniUsate[g.id]++;
      if (r.tipo === 'muovi') { f.slot--; const d = dado(G, r.dado); push(G, { k: 'azione', tipo: 'muovi', gioc: g.id, dado: d.id, da: d.pos, a: r.tassello, step: 0 }); log(G, `${g.nome} dichiara: ${nomeD(G, d)} si muove su ${nomeT(r.tassello)}`); return; }
      if (r.tipo === 'attacca') { f.slot--; push(G, nuovoAttacco(G, g.id, r.dado, r.bersaglio, 0)); return; }
      if (r.tipo === 'carta') { push(G, { k: 'costruzione', p: g.id, uid: r.carta, cn: g.mano.find(c => c.uid === r.carta).n, par: {}, passo: 0, ritorno: 'libera', ctx: { trig: 'libera' } }); return; }
    }
    const ops = [];
    if (f.slot > 0) for (const d of dadiDi(G, g.id, 'mappa')) {
      for (const a of adiacenti(d.pos)) {
        if (libero(G, a)) ops.push({ tipo: 'muovi', dado: d.id, tassello: a, txt: `Muovi ${nomeD(G, d)} su ${nomeT(a)}` });
        else { const b = dado(G, sopra(G, a)); if (nemici(b.prop, g.id) && bersagliabile(G, b)) ops.push({ tipo: 'attacca', dado: d.id, bersaglio: b.id, txt: `${nomeD(G, d)} attacca ${nomeD(G, b)}` }); }
      }
    }
    for (const c of carteGiocabili(G, g.id, { trig: 'libera' })) ops.push({ tipo: 'carta', carta: c.uid, txt: `Gioca ${CARTE[c.n].nome}` });
    ops.push({ tipo: 'fine', txt: f.slot > 0 ? `Termina le azioni (${f.slot} non usate)` : 'Termina le azioni' });
    chiedi(G, g.id, 'azione', `Fase Azione: ${f.slot} azion${f.slot === 1 ? 'e' : 'i'} rimast${f.slot === 1 ? 'a' : 'e'}`, ops, { slot: f.slot });
    return;
  }
  if (f.step === 'scarto') {
    if (r) { const k = g.mano.findIndex(c => c.uid === r.carta); g.scarti.push(g.mano.splice(k, 1)[0]); ST(G).scartate[g.id]++; log(G, `${g.nome} scarta una carta`); }
    if (g.mano.length > MANO_MAX) { chiedi(G, g.id, 'scarto', `Fase Finale: scarta fino a 4 carte (ne hai ${g.mano.length})`, g.mano.map(c => ({ carta: c.uid, txt: CARTE[c.n].nome }))); return; }
    f.step = 'finale'; return;
  }
  if (f.step === 'finale') {
    // si decide quali dadi del Boost passano al Gate (a 6); gli altri restano nel Boost
    if (r) {
      for (const id of r.dadi) { const d = dado(G, id); d.stato = 'gate'; d.val = VMAX; }
      if (r.dadi.length) log(G, `${g.nome} passa al Gate ${r.dadi.length} dad${r.dadi.length === 1 ? 'o' : 'i'} dal Boost`);
      ST(G).alGate[g.id] += r.dadi.length;
      G.cronaca.push({ n: G.cronaca.length, tipo: 'finale', p: g.id, dadi: r.dadi.length });
      log(G, `${g.nome} chiude il turno`); pop(G); return;
    }
    const bs = dadiDi(G, g.id, 'boost');
    if (!bs.length) { log(G, `${g.nome} chiude il turno`); pop(G); return; }
    const ops = [];
    for (let m = 0; m < (1 << bs.length); m++) { const ds = bs.filter((d, k) => m & (1 << k)); ops.push({ dadi: ds.map(d => d.id), txt: ds.length ? 'Al Gate: ' + ds.map(d => d.val).join(' + ') : 'Nessuno al Gate' }); }
    chiedi(G, g.id, 'finale', 'Fase Finale: quali dadi del Boost passi al Gate? Tornano a 6 e rientrano nel tuo prossimo turno.', ops);
    return;
  }
};

function nuovoAttacco(G, gid, att, dif, extra, gratis) {
  log(G, `${gioc(G, gid).nome} dichiara: ${nomeD(G, dado(G, att))} attacca ${nomeD(G, dado(G, dif))}${gratis ? ` (${gratis})` : ''}`);
  return { k: 'azione', tipo: 'attacca', gioc: gid, att, dif, extra: extra || 0, mods: [], annullato: false, lago: [], step: 0 };
}

/* ---------- azione dichiarata: catena, poi risoluzione ---------- */
H.azione = (G, f) => {
  if (f.step === 0) { f.step = 1; apriCatena(G, f.tipo === 'muovi' ? 'movimento' : 'combattimento', f.gioc, G.pila.length - 1); return; }
  if (f.tipo === 'muovi') eseguiMovimento(G, f); else risolviAttacco(G, f);
  pop(G);
};

/* ---------- attacchi extra concessi dalle carte ---------- */
H.extra = (G, f) => {
  const r = prendiRisposta(f);
  const e = G.coda[0];
  if (!e) { pop(G); return; }
  if (r) {
    if (r.tipo === 'rinuncia') { G.coda.shift(); pop(G); return; }
    e.restanti--; if (e.restanti <= 0) G.coda.shift();
    const nuovo = nuovoAttacco(G, e.gioc, r.dado != null ? r.dado : e.dado, r.bersaglio, 0, e.origine); nuovo.gratis = true; nuovo.origine = e.origine;
    if (e.bonus) modAttacco(nuovo, e.origine, e.bonus, e.gioc);
    G.pila[G.pila.length - 1] = nuovo;
    return;
  }
  const ops = [];
  for (const id of e.dadi || [e.dado]) {
    const a = dado(G, id); if (a.stato !== 'mappa') continue;
    let bers = inMappa(G).filter(d => nemici(d.prop, e.gioc) && bersagliabile(G, d));
    if (e.modo === 'adiacente') bers = bers.filter(d => adiacenti(a.pos).includes(d.pos));
    if (e.modo === 'piuAlto') bers = bers.filter(d => altEff(G, d) > altEff(G, a));
    bers.forEach(d => ops.push({ tipo: 'attacca', dado: a.id, bersaglio: d.id, txt: `${nomeD(G, a)} attacca ${nomeD(G, d)}` }));
  }
  if (!ops.length) { log(G, `${e.origine}: nessun bersaglio`); G.coda.shift(); return; }
  const chi = (e.dadi || [e.dado]).map(id => nomeD(G, dado(G, id))).join(' o ');
  chiedi(G, e.gioc, 'extra', `${e.origine}: ${chi} può attaccare gratis${e.restanti > 1 ? ` (ancora ${e.restanti})` : ''}${e.bonus ? `, +${e.bonus}` : ''}`,
    [...ops, { tipo: 'rinuncia', txt: 'Rinuncia' }]);
};

/* ---------- la catena delle carte ---------- */
function apriCatena(G, trig, iniz, ctxIdx, primaVoce) {
  const ordine = []; const k0 = G.ordine.indexOf(iniz);
  for (let k = 0; k < G.n; k++) ordine.push(G.ordine[(k0 + k) % G.n]);
  const c = push(G, { k: 'catena', trig, iniz, ctxIdx, ordine, attivi: ordine.slice(), pos: 0, giocatoNelGiro: false, voci: [] });
  if (primaVoce) { c.voci.push(primaVoce); c.pos = 1; c.giocatoNelGiro = true; }
  return c;
}
function ctxDiCatena(G, c) { return { trig: c.trig, az: c.ctxIdx != null ? G.pila[c.ctxIdx] : null, voci: c.voci }; }

H.catena = (G, c) => {
  const r = prendiRisposta(c);
  if (r) {
    const p = c.ordine[c.pos];
    if (r.tipo === 'passa') { c.attivi = c.attivi.filter(x => x !== p); c.pos++; }
    else { push(G, { k: 'costruzione', p, uid: r.carta, cn: gioc(G, p).mano.find(x => x.uid === r.carta).n, par: {}, passo: 0, ritorno: 'catena', ctx: ctxDiCatena(G, c), catIdx: G.pila.length - 1 }); return; }
  }
  for (;;) {
    if (c.pos >= c.ordine.length) {
      if (!c.giocatoNelGiro || !c.attivi.length) { // chiusa: si risolve dall'ultima alla prima
        const voci = c.voci; G.pila[G.pila.length - 1] = { k: 'risolvi', voci, ctxIdx: c.ctxIdx, trig: c.trig };
        if (voci.length) log(G, `La catena si chiude: si risolve dall'ultima carta alla prima`);
        return;
      }
      c.pos = 0; c.giocatoNelGiro = false;
    }
    const p = c.ordine[c.pos];
    if (!c.attivi.includes(p)) { c.pos++; continue; }
    const ctx = ctxDiCatena(G, c);
    const gioc_ = carteGiocabili(G, p, ctx);
    if (!gioc_.length) { c.attivi = c.attivi.filter(x => x !== p); c.pos++; continue; }
    chiedi(G, p, 'catena', testoCatena(G, c), [...gioc_.map(x => ({ tipo: 'carta', carta: x.uid, txt: `Gioca ${CARTE[x.n].nome}` })), { tipo: 'passa', txt: 'Passo' }]);
    return;
  }
};
function testoCatena(G, c) {
  const az = c.ctxIdx != null ? G.pila[c.ctxIdx] : null;
  let s;
  if (c.trig === 'combattimento') s = `Attacco: ${nomeD(G, dado(G, az.att))} contro ${nomeD(G, dado(G, az.dif))}`;
  else if (c.trig === 'movimento') s = `Movimento: ${nomeD(G, dado(G, az.dado))} verso ${nomeT(az.a)}`;
  else if (c.trig === 'evento') s = `Evento: ${nomeEvento(az.e)}`;
  else s = `${CARTE[c.voci[0].n].nome} di ${gioc(G, c.voci[0].p).nome}`;
  return `${s}. Vuoi rispondere con una carta?`;
}

// serve abbastanza Boost per il costo, più la X minima, più (se la carta lo vuole) un dado da mettere sopra
function puoPagare(G, p, C) {
  const miei = dadiDi(G, p, 'boost'), tot = sommaBoost(miei);
  if (C.B === 'carta') { if (!miei.length) return false; const mn = Math.min(...miei.map(d => d.val)); return tot - mn >= C.costo; }
  if (C.B === 'avv') return tot >= C.costo && sommaBoost(boostAvv(G, p)) >= 1;
  const minX = C.fissoX || (C.B === true ? 1 : 0);
  return tot >= C.costo + minX;
}
function carteGiocabili(G, p, ctx) {
  const g = gioc(G, p);
  if (spaziLiberi(G, p) <= 0) return [];
  const visti = new Set(), out = [];
  for (const c of g.mano) {
    if (visti.has(c.n)) continue;
    const C = CARTE[c.n];
    if (!puoPagare(G, p, C)) continue;
    if (ctx.trig === 'libera' || ctx.trig === 'carta' || ctx.trig === 'evento') { if (C.trig) continue; }
    else if (C.trig && C.trig !== ctx.trig) continue;
    if (C.req && !C.req(G, p, ctx)) continue;
    if (C.passi && C.passi[0] && !C.passi[0].salta && !C.passi[0].op(G, { p, par: {}, ctx, cn: c.n }).length) continue;
    visti.add(c.n); out.push(c);
  }
  return out;
}

/* ---------- costruzione di una carta: scelte, costo, poi in campo ---------- */
H.costruzione = (G, f) => {
  const g = gioc(G, f.p), C = CARTE[f.cn];
  const r = prendiRisposta(f);
  const passi = (C.passi || []).slice();
  // pagamento: dai tuoi dadi Boost il costo più la X (spezzabile), poi la X dal Boost avversario se serve
  const daPagareMio = () => C.costo + (C.B === true || C.B === 'opz' ? (C.fissoX || f.par.x || 0) : 0);
  const pagato = arr => (arr || []).reduce((s, x) => s + x.q, 0);
  const residuo = (d, arr) => d.val - (arr || []).filter(x => x.d === d.id).reduce((s, x) => s + x.q, 0);
  passi.push({ key: 'pag', paga: 'mio', testo: () => `Paga ${daPagareMio() - pagato(f.par.pag)} dal tuo Boost: da quale dado?`,
    salta: () => daPagareMio() - pagato(f.par.pag) <= 0,
    op: () => dadiDi(G, f.p, 'boost').filter(d => d.id !== f.par.bd && residuo(d, f.par.pag) > 0).map(d => ({ dado: d.id, txt: `Boost ${residuo(d, f.par.pag)}` })) });
  if (C.B === 'avv') passi.push({ key: 'pagAvv', paga: 'avv', testo: () => `Prendi ${f.par.x - pagato(f.par.pagAvv)} dal Boost avversario: da quale dado?`,
    salta: () => f.par.x - pagato(f.par.pagAvv) <= 0,
    op: () => boostAvv(G, f.p).filter(d => residuo(d, f.par.pagAvv) > 0).map(d => ({ dado: d.id, txt: `${gioc(G, d.prop).nome}: Boost ${residuo(d, f.par.pagAvv)}` })) });
  const prendi = (P_, idDado) => {
    const arr = f.par[P_.key] = f.par[P_.key] || [];
    const quanto = P_.paga === 'mio' ? daPagareMio() : f.par.x;
    const d = dado(G, idDado), q = Math.min(quanto - pagato(arr), residuo(d, arr));
    arr.push({ d: idDado, q });
    if (pagato(arr) >= quanto) f.passo++;
  };
  if (r) {
    const P_ = passi[f.passo];
    if (P_.paga) prendi(P_, r.dado);
    else if (P_.multi) {
      const arr = f.par[P_.key] = f.par[P_.key] || [];
      arr.push(r.dado != null ? r.dado : r.carta != null ? r.carta : r.val);
      const quanti = typeof P_.multi === 'number' ? P_.multi : f.par[P_.multi];
      if (arr.length >= quanti) f.passo++;
    } else if (P_.percorso) {
      const arr = f.par.percorso = f.par.percorso || [dado(G, f.par.d).pos];
      arr.push(r.tassello);
      if (arr.length - 1 >= f.par.x) f.passo++;
    } else {
      f.par[P_.key] = r.dado != null ? r.dado : r.tassello != null ? r.tassello : r.val;
      if (P_.key === 'fonte') f.par.fonteNome = r.txt;
      f.passo++;
    }
  }
  for (;;) {
    while (f.passo < passi.length && passi[f.passo].salta && passi[f.passo].salta(f)) f.passo++;
    if (f.passo >= passi.length) break;
    const P_ = passi[f.passo];
    const ops = P_.op(G, f);
    if (!ops.length) { log(G, `${C.nome}: nessuna scelta possibile, carta non giocata`, f.p); pop(G); return; }
    // se il pagamento ha un solo dado possibile, lo prende da solo
    if (P_.paga && ops.length === 1) { prendi(P_, ops[0].dado); continue; }
    let testo = `${C.nome} — ${typeof P_.testo === 'function' ? P_.testo() : P_.testo}`;
    if (P_.multi) { const quanti = typeof P_.multi === 'number' ? P_.multi : f.par[P_.multi]; testo += ` (${(f.par[P_.key] || []).length + 1} di ${quanti})`; }
    chiedi(G, f.p, 'costruzione', testo, ops, { carta: f.uid, cartaN: C.n, scelte: f.par });
    return;
  }
  // tutto scelto: paga e metti la carta in campo
  const k = g.mano.findIndex(c => c.uid === f.uid);
  const istanza = g.mano.splice(k, 1)[0];
  const inCampo = { uid: istanza.uid, n: istanza.n, attiva: false, dado: null };
  g.campo.push(inCampo);
  if (C.B === 'carta' && f.par.bd != null) { inCampo.dado = f.par.bd; dadoSullaCarta(G, inCampo); }
  const pagMio = pagato(f.par.pag), pagAvv = pagato(f.par.pagAvv);
  for (const x of [...(f.par.pag || []), ...(f.par.pagAvv || [])]) spendiBoost(G, dado(G, x.d), x.q);
  log(G, `${g.nome} gioca ${C.nome}${pagMio ? ` (paga ${pagMio} di Boost)` : ''}${descriviScelte(G, C, f.par)}`);
  const S = ST(G), turnoDi = (G.pila.find(x => x.k === 'turno') || {}).gioc;
  const xx = C.B === 'carta' ? (inCampo.dado != null ? dado(G, inCampo.dado).val : 0) : (C.fissoX || f.par.x || 0);
  const rec = { n: C.n, p: f.p, r: G.round, trig: f.ctx ? f.ctx.trig : null, costo: C.costo, x: xx,
    modo: f.ritorno === 'libera' ? 'libera' : turnoDi === f.p ? 'propria' : 'reazione', lato: null, esitoAtt: null, uccisioni: 0 };
  S.costoPagato[f.p] += C.costo;
  const B = S.boost[f.p]; B.puntiSpesi += pagMio;
  if (C.B) { B.carteBoost++; if (C.B === 'carta') B.suCarta++; if (C.B === 'avv') B.avversari++; }
  G.cronaca.push({ n: G.cronaca.length, tipo: 'carta', p: f.p, c: C.n, r: G.round, paga: pagMio, x: xx, avv: pagAvv });
  const voce = { p: f.p, n: C.n, uid: istanza.uid, par: f.par, playIdx: S.carte.length };
  S.carte.push(rec);
  pop(G);
  if (f.ritorno === 'libera') { apriCatena(G, 'carta', f.p, null, voce); return; }
  const cat = G.pila[G.pila.length - 1];
  const azReale = cat.ctxIdx != null ? G.pila[cat.ctxIdx] : null;
  if (azReale && azReale.k === 'azione' && azReale.tipo === 'attacca') {
    (azReale.carteIdx = azReale.carteIdx || []).push(voce.playIdx);
    rec.lato = dado(G, azReale.att).prop === f.p ? 'att' : dado(G, azReale.dif).prop === f.p ? 'dif' : 'terzo';
  }
  cat.voci.push(voce); cat.giocatoNelGiro = true; cat.pos++;
};
function descriviScelte(G, C, par) {
  const s = [];
  if (C.B === 'avv' && par.x) s.push(`prende ${par.x} dal Boost avversario`);
  else if (C.B && C.B !== 'carta' && (C.fissoX || par.x)) s.push(`X = ${C.fissoX || par.x}`);
  if (C.B === 'carta' && par.bd != null) s.push(`con un dado Boost da ${dado(G, par.bd).val} sopra`);
  if (par.d != null) s.push(nomeD(G, dado(G, par.d)));
  if (par.vittima != null) s.push('su ' + nomeD(G, dado(G, par.vittima)));
  if (par.fonteNome) s.push('su ' + par.fonteNome);
  return s.length ? ': ' + s.join(', ') : '';
}

/* ---------- risoluzione della catena ---------- */
H.risolvi = (G, f) => {
  if (f.voci.length) {
    const v = f.voci.pop();
    const g = gioc(G, v.p), carta = g.campo.find(c => c.uid === v.uid);
    v.carta = carta || { attiva: false };
    v.gioc = v.p;
    const ctx = { trig: f.trig, az: f.ctxIdx != null ? G.pila[f.ctxIdx] : null };
    log(G, `Si risolve ${CARTE[v.n].nome} di ${g.nome}`);
    G.cartaInRisoluzione = v.n; G.cartaRisIdx = v.playIdx != null ? v.playIdx : null;
    try { CARTE[v.n].eff(G, v, ctx); } catch (e) { log(G, `(errore nella carta ${CARTE[v.n].nome}: ${e.message})`); if (typeof process !== 'undefined' && process.env && process.env.RANDOMIR_STRICT) throw e; }
    G.cartaInRisoluzione = null; G.cartaRisIdx = null;
    if (carta && CARTE[v.n].tipo === 'racconto') lasciaCarta(G, g, carta);
    return;
  }
  pop(G);
};

/* ---------- fine partita ---------- */
function chiudiPartita(G) {
  G.finita = true; G.richiesta = null;
  G.punteggi = G.giocatori.map(g => {
    const campo = g.dadi.filter(d => d.stato === 'mappa' || d.stato === 'sotto').reduce((s, d) => s + d.val, 0);
    const fuori = g.dadi.filter(d => d.stato === 'boost' || d.stato === 'gate' || d.stato === 'carta').length;
    return { id: g.id, nome: g.nome, fazione: g.fazione, fama: g.fama, dadiInCampo: campo, dadiFuori: fuori, totale: g.fama + campo + fuori };
  });
  const mx = Math.max(...G.punteggi.map(p => p.totale));
  G.vincitori = G.punteggi.filter(p => p.totale === mx).map(p => p.id);
  const S = G.st;
  for (const id in S.serie) S.boost[Math.floor(id / 3)].strisce.push(S.serie[id]);
  S.serie = {};
  G.resoconto = {
    v: VERSIONE, n: G.n, round: G.round, decisioni: S.decisioni, primo: G.primo, ordine: G.ordine.slice(),
    eventiUsciti: G.eventi.usciti.map(e => e.id),
    giocatori: G.punteggi.map(p => ({ ...p, posizione: 1 + G.punteggi.filter(q => q.totale > p.totale).length, vince: G.vincitori.includes(p.id),
      livello: gioc(G, p.id).livello, lato: gioc(G, p.id).lato, scarti: gioc(G, p.id).scarti.length, mazzo: gioc(G, p.id).mazzo.length })),
    st: S,
  };
  log(G, 'Fine partita! ' + G.punteggi.map(p => `${p.nome} ${p.totale} (Fama ${p.fama} + campo ${p.dadiInCampo} + fuori ${p.dadiFuori})`).join(' · '));
  log(G, (G.vincitori.length > 1 ? 'Parità tra ' : 'Vince ') + G.vincitori.map(i => gioc(G, i).nome).join(' e '));
}

/* ==========================================================================
   VISTA FILTRATA (quello che un giocatore può sapere)
   ========================================================================== */
function vista(G, io) {
  const V = {
    io, n: G.n, round: G.round, ultimoRound: G.ultimoRound, finita: G.finita, primo: G.primo, ordine: G.ordine,
    mappa: G.mappa.map(t => ({ i: t.i, tipo: t.tipo, alt: t.alt, pila: t.pila.slice() })),
    eventi: { corrente: G.eventi.corrente, usciti: G.eventi.usciti, conteggio: G.eventi.conteggio, restanti: G.eventi.mazzo.length },
    giocatori: G.giocatori.map(g => ({
      id: g.id, nome: g.nome, fazione: g.fazione, lato: g.lato, fama: g.fama, livello: g.livello, spazi: g.spazi,
      dadi: g.dadi.map(d => ({ ...d })), campo: g.campo.map(c => ({ ...c })),
      mano: g.id === io ? g.mano.map(c => ({ ...c })) : g.mano.length,
      mazzo: g.mazzo.length, scarti: g.scarti.map(c => c.n), box: g.box.map(c => c.n),
    })),
    log: G.log.filter(l => l.solo === undefined || l.solo === io).slice(-250),
    punteggi: G.punteggi, vincitori: G.vincitori,
    turno: null, catena: null, coda: G.coda.map(e => ({ ...e })),
    cronaca: G.cronaca.slice(-12),
  };
  const t = G.pila.find(f => f.k === 'turno');
  if (t) V.turno = { gioc: t.gioc, slot: t.slot, step: t.step, fase: { inizio: 'gate', gate: 'gate', pesca: 'pesca', azione: 'azione', scarto: 'finale', finale: 'finale' }[t.step] };
  // catene aperte e in risoluzione (pubbliche)
  V.catene = G.pila.filter(f => f.k === 'catena' || f.k === 'risolvi').map(f => {
    const az = f.ctxIdx != null ? G.pila[f.ctxIdx] : null;
    let azione = null;
    if (az && az.k === 'azione') azione = az.tipo === 'attacca' ? { tipo: 'attacco', att: az.att, dif: az.dif, extra: az.extra, conto: contoAttacco(G, az) } : { tipo: 'movimento', dado: az.dado, a: az.a };
    if (az && az.k === 'evento') azione = { tipo: 'evento', e: az.e };
    return { stato: f.k, trig: f.trig, azione, voci: (f.voci || []).map(v => ({ p: v.p, n: v.n })), attivi: f.attivi || [] };
  });
  const R = G.richiesta;
  if (R && R.tipo === 'avviso') V.avviso = { a: R.avviso, gioc: R.gioc };
  if (R) {
    if (R.gioc === io) V.richiesta = JSON.parse(JSON.stringify(R));
    else V.richiesta = { gioc: R.gioc, tipo: R.tipo, n: R.n, testo: R.tipo === 'costruzione' ? 'sta giocando una carta…' : R.testo, altrui: true };
  }
  return V;
}

/* ==========================================================================
   UTILITÀ
   ========================================================================== */
function decisore(G) { return G.richiesta ? G.richiesta.gioc : null; }

const API = {
  nuovaPartita, rispondi, vista, decisore, avanza, VERSIONE,
  CARTE, EVENTI, TASSELLI, FAZIONI, NOME_FAZ, LIVELLI, LATI, NOME_LATO, NOME_ALT, nomeT, adiacenti, rc, idx,
  SLOT, MANO_MAX, VMAX, LV_MAX, FAMA_CARTA,
  _i: { dado, gioc, uccidi, danno, togli, risolviAttacco, forzaAttacco, eseguiMovimento, mettiInMappa, togliDaMappa, sposta, carteGiocabili, bersagliabile, altEff, spendiBoost, saleLivello, d6, inMappa, sopra, libero, elmo, martello },
};
if (typeof module === 'object' && module.exports) module.exports = API;
globalThis.Randomir = API;
})();
