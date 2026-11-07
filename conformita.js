// Suite di conformità: una verifica per clausola del manuale e per le carte principali.
process.env.RANDOMIR_STRICT = '1';
const R = require('../public/motore.js');
const I = R._i;
let ok = 0, ko = 0;
// i banner si chiudono da soli nei test di regola; quelli dei banner usano le funzioni originali
const RAW = { rispondi: R.rispondi, nuovaPartita: R.nuovaPartita, avanza: R.avanza };
const chiudiBanner = G => { while (G.richiesta && G.richiesta.tipo === 'avviso') RAW.rispondi(G, G.richiesta.gioc, 0); return G; };
R.rispondi = (G, g, i) => chiudiBanner(RAW.rispondi(G, g, i));
R.nuovaPartita = o => chiudiBanner(RAW.nuovaPartita(o));
R.avanza = G => { RAW.avanza(G); return chiudiBanner(G); };
function test(nome, fn) { try { fn(); ok++; console.log('  ✔ ' + nome); } catch (e) { ko++; console.log('  ✘ ' + nome + '\n      ' + e.message); } }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` atteso ${JSON.stringify(b)}, ottenuto ${JSON.stringify(a)}`); };
const vero = (c, m) => { if (!c) throw new Error(m || 'falso'); };

// porta una partita alla prima Fase Azione con scelte neutre
function partita(n, seed, fazioni) {
  const G = R.nuovaPartita({ seed: seed || 7, nomi: ['A', 'B', 'C', 'D'].slice(0, n || 2) });
  let k = 0;
  while (G.richiesta && G.richiesta.tipo !== 'azione') {
    const Rq = G.richiesta; let i = 0;
    if (Rq.tipo === 'fazione' && fazioni) { const z = fazioni[Rq.gioc]; i = Rq.opzioni.findIndex(o => o.val === z); }
    if (Rq.tipo === 'catena') i = Rq.opzioni.findIndex(o => o.tipo === 'passa');
    R.rispondi(G, Rq.gioc, i); if (++k > 200) throw new Error('setup bloccato');
  }
  return G;
}
// mette la mappa tutta a una quota e i dadi dove serve; ricalcola la decisione corrente
function scena(G, { alt, tipo, dadi, mani, turno }) {
  G.mappa.forEach(t => { t.pila = []; if (alt != null) t.alt = alt; if (tipo) t.tipo = tipo; });
  for (const g of G.giocatori) for (const d of g.dadi) { d.stato = 'boost'; d.val = 1; d.pos = null; d.torre = false; }
  for (const [id, pos, val] of dadi || []) { const d = I.dado(G, id); d.val = val; I.mettiInMappa(G, d, pos); }
  if (mani) G.giocatori.forEach((g, k) => { if (mani[k]) { g.scarti.push(...g.mano); g.mano = mani[k].map(n => ({ uid: 9000 + k * 100 + Math.floor(Math.random() * 99), n })); g.mano.forEach((c, j) => c.uid = 9000 + k * 100 + j); } });
  if (turno != null) { const t = G.pila.find(f => f.k === 'turno'); t.gioc = turno; t.slot = 3; t.step = 'azione'; }
  G.coda = []; G.richiesta = null; R.avanza(G);
  return G;
}
const tocca = (G, filtro) => { if (process.env.DBG) console.log('   >', G.richiesta.tipo, G.richiesta.gioc, G.richiesta.opzioni.map(o => o.txt).join(' | ')); const i = G.richiesta.opzioni.findIndex(filtro); if (i < 0) throw new Error('opzione non trovata in ' + G.richiesta.tipo + ': ' + G.richiesta.opzioni.map(o => o.txt).join(' | ')); R.rispondi(G, G.richiesta.gioc, i); };
const passaTutti = G => { while (G.richiesta && G.richiesta.tipo === 'catena') tocca(G, o => o.tipo === 'passa'); };
const turnoDi = G => G.pila.find(f => f.k === 'turno');
const mappa = (r, c) => r * 5 + c;

console.log('\n§ Mappa e set-up');
test('25 tasselli: terra 2/8/2, fuoco 2/2/2, acqua 4/2/1', () => {
  const G = R.nuovaPartita({ seed: 3, nomi: ['A', 'B'] });
  const c = {}; G.mappa.forEach(t => { const k = t.tipo + t.alt; c[k] = (c[k] || 0) + 1; });
  eq(Object.fromEntries(Object.entries(c).sort()), { acqua0: 4, acqua1: 2, acqua2: 1, fuoco0: 2, fuoco1: 2, fuoco2: 2, terra0: 2, terra1: 8, terra2: 2 });
});
test('mappe diverse a ogni partita', () => { const a = R.nuovaPartita({ seed: 1, nomi: ['A', 'B'] }), b = R.nuovaPartita({ seed: 2, nomi: ['A', 'B'] }); vero(JSON.stringify(a.mappa) !== JSON.stringify(b.mappa)); });
test('Dado Destino: il più alto inizia, i pari rilanciano', () => {
  for (let s = 1; s < 60; s++) { const G = R.nuovaPartita({ seed: s, nomi: ['A', 'B', 'C', 'D'] }); const ult = G.lanciIniziali[G.lanciIniziali.length - 1]; const mx = Math.max(...ult.map(x => x.t)); eq(ult.filter(x => x.t === mx).map(x => x.id), [G.primo]); }
});
test('le Facce si scelgono dall\'ultimo al primo, senza doppioni', () => {
  const G = R.nuovaPartita({ seed: 5, nomi: ['A', 'B', 'C'] });
  const ordine = G.ordine.slice().reverse(); const scelte = [];
  for (const gid of ordine) { eq(G.richiesta.gioc, gid); scelte.push(G.richiesta.opzioni.length); R.rispondi(G, gid, 0); }
  eq(scelte, [4, 3, 2]); eq(new Set(G.giocatori.map(g => g.fazione)).size, 3);
});
test('mazzo da 30 carte: 15 comuni + 15 della Faccia', () => {
  const G = partita(2, 9);
  for (const g of G.giocatori) { const tutte = [...g.mazzo, ...g.mano]; eq(tutte.length, 30); eq(tutte.filter(c => R.CARTE[c.n].fz === null).length, 15); vero(tutte.every(c => R.CARTE[c.n].fz === null || R.CARTE[c.n].fz === g.fazione)); }
});
test('ingresso: almeno un dado, gli altri nel Boost col valore lanciato', () => {
  const G = R.nuovaPartita({ seed: 11, nomi: ['A', 'B'] });
  R.rispondi(G, G.richiesta.gioc, 0); R.rispondi(G, G.richiesta.gioc, 0);
  eq(G.richiesta.tipo, 'ingresso'); eq(G.richiesta.opzioni.length, 7); vero(G.richiesta.opzioni.every(o => o.dadi.length >= 1));
  const g = G.richiesta.gioc; const ult = G.richiesta.opzioni.length - 1; const scelta = G.richiesta.opzioni[ult].dadi;
  R.rispondi(G, g, ult);
  for (const d of G.giocatori[g].dadi) { if (scelta.includes(d.id)) eq(d.stato, 'attesa'); else { eq(d.stato, 'boost'); vero(d.val >= 1); } }
});
test('piazzamento un dado alla volta dall\'ultimo al primo, ovunque; poi 4 carte e primo evento', () => {
  const G = R.nuovaPartita({ seed: 12, nomi: ['A', 'B'] });
  while (G.richiesta.tipo !== 'piazza') R.rispondi(G, G.richiesta.gioc, 0);
  const seq = []; while (G.richiesta.tipo === 'piazza') { seq.push(G.richiesta.gioc); R.rispondi(G, G.richiesta.gioc, G.richiesta.opzioni.length - 1); }
  eq(seq.slice(0, 2), [G.ordine[1], G.ordine[0]]);
  eq(G.round, 1); vero(G.eventi.corrente);
  while (G.richiesta.tipo === 'catena') R.rispondi(G, G.richiesta.gioc, G.richiesta.opzioni.length - 1);
  const g0 = G.giocatori[G.ordine[0]], g1 = G.giocatori[G.ordine[1]];
  eq(g1.mano.length, 4); eq(g0.mano.length, 6, 'il primo ha già pescato le 2 del turno');
});

console.log('\n§ Turno');
test('fasi: Gate → Pesca 2 → Azione (3 slot) → Scarto a 4', () => {
  const G = partita(2, 21); const t = turnoDi(G); eq(t.step, 'azione'); eq(t.slot, 3);
  const g = G.giocatori[t.gioc]; g.mano.push(...g.mazzo.splice(0, 3));
  G.richiesta = null; R.avanza(G);
  tocca(G, o => o.tipo === 'fine'); eq(G.richiesta.tipo, 'scarto');
  while (G.richiesta.tipo === 'scarto') tocca(G, () => true);
  eq(g.mano.length, 4);
});
test('mazzo finito: non si pesca più', () => {
  const G = partita(2, 22); const g = G.giocatori[G.ordine[1]]; g.mazzo = [];
  tocca(G, o => o.tipo === 'fine'); while (G.richiesta.tipo === 'scarto') tocca(G, () => true);
  passaTutti(G); eq(g.mano.length, 4);
});
test('Gate: rientro a 6 su un tassello libero del proprio lato', () => {
  const G = partita(2, 23); const t = turnoDi(G); const g = G.giocatori[t.gioc];
  scena(G, { alt: 1, dadi: [], turno: null });
  g.dadi[0].stato = 'gate'; g.dadi[0].val = 0;
  t.step = 'gate'; G.richiesta = null; R.avanza(G);
  eq(G.richiesta.tipo, 'gate'); vero(G.richiesta.opzioni.every(o => R.LATI[g.lato].includes(o.tassello)));
  tocca(G, () => true); eq(g.dadi[0].val, 6); eq(g.dadi[0].stato, 'mappa');
});

console.log('\n§ Movimento');
const giocA = G => turnoDi(G).gioc, idA = G => giocA(G) * 3, idB = G => (1 - giocA(G)) * 3;
test('scendere dà +dislivello (max 6), salire toglie il dislivello', () => {
  const G = partita(2, 31); const a = idA(G);
  scena(G, { alt: 1, dadi: [[a, mappa(2, 2), 3], [idB(G), mappa(0, 0), 3]], turno: giocA(G) });
  G.mappa[mappa(2, 3)].alt = 0; G.mappa[mappa(2, 1)].alt = 2; G.richiesta = null; R.avanza(G);
  tocca(G, o => o.tipo === 'muovi' && o.tassello === mappa(2, 3)); passaTutti(G); eq(I.dado(G, a).val, 4, 'medio→basso +1');
  tocca(G, o => o.tipo === 'muovi' && o.tassello === mappa(2, 2)); passaTutti(G); eq(I.dado(G, a).val, 3, 'basso→medio −1');
  tocca(G, o => o.tipo === 'muovi' && o.tassello === mappa(2, 1)); passaTutti(G); eq(I.dado(G, a).val, 2, 'medio→alto −1');
  eq(turnoDi(G).slot, 0);
});
test('tetto a 6 scendendo', () => {
  const G = partita(2, 32); const a = idA(G);
  scena(G, { alt: 2, dadi: [[a, mappa(2, 2), 5], [idB(G), mappa(0, 0), 3]], turno: giocA(G) }); G.mappa[mappa(2, 3)].alt = 0;
  tocca(G, o => o.tipo === 'muovi' && o.tassello === mappa(2, 3)); passaTutti(G); eq(I.dado(G, a).val, 6);
});
test('salendo a 0 il dado muore e va nel Boost come 1, nessuna Fama', () => {
  const G = partita(2, 33); const a = idA(G); const fa = G.giocatori.map(g => g.fama);
  scena(G, { alt: 0, dadi: [[a, mappa(2, 2), 2], [idB(G), mappa(0, 0), 3]], turno: giocA(G) }); G.mappa[mappa(2, 3)].alt = 2;
  tocca(G, o => o.tipo === 'muovi' && o.tassello === mappa(2, 3)); passaTutti(G);
  eq(I.dado(G, a).stato, 'boost'); eq(I.dado(G, a).val, 1); eq(G.giocatori.map(g => g.fama), fa);
});
test('non ci si ferma su un tassello occupato, solo ortogonale', () => {
  const G = partita(2, 34); const a = idA(G);
  scena(G, { alt: 1, dadi: [[a, mappa(2, 2), 3], [a + 1, mappa(2, 3), 3], [idB(G), mappa(0, 0), 3]], turno: giocA(G) });
  const mosse = G.richiesta.opzioni.filter(o => o.tipo === 'muovi' && o.dado === a).map(o => o.tassello).sort((x, y) => x - y);
  eq(mosse, [mappa(1, 2), mappa(2, 1), mappa(3, 2)]);
});

console.log('\n§ Attacco');
test('pareggio all\'attaccante, Fama = valore del difensore, difensore nel Boost col suo valore', () => {
  const G = partita(2, 41); const a = idA(G), b = idB(G), g = G.giocatori[giocA(G)];
  scena(G, { alt: 1, dadi: [[a, mappa(2, 2), 4], [b, mappa(2, 3), 4]], turno: giocA(G) });
  const fama = g.fama;
  tocca(G, o => o.tipo === 'attacca'); passaTutti(G);
  eq(I.dado(G, b).stato, 'boost'); eq(I.dado(G, b).val, 4); eq(g.fama, fama + 4); eq(I.dado(G, a).val, 4, 'l\'attaccante non cambia valore');
});
test('bonus +1/+2 solo dall\'alto; dal basso 0', () => {
  const G = partita(2, 42); const a = idA(G), b = idB(G);
  scena(G, { alt: 0, dadi: [[a, mappa(2, 2), 3], [b, mappa(2, 3), 5]], turno: giocA(G) });
  G.mappa[mappa(2, 2)].alt = 2;
  eq(I.forzaAttacco(G, I.dado(G, a), I.dado(G, b), 0), 5);
  G.mappa[mappa(2, 2)].alt = 0; G.mappa[mappa(2, 3)].alt = 2;
  eq(I.forzaAttacco(G, I.dado(G, a), I.dado(G, b), 0), 3);
});
test('attacco fallito: niente cambia, lo slot è speso', () => {
  const G = partita(2, 43); const a = idA(G), b = idB(G);
  scena(G, { alt: 1, dadi: [[a, mappa(2, 2), 2], [b, mappa(2, 3), 5]], turno: giocA(G) });
  tocca(G, o => o.tipo === 'attacca'); passaTutti(G);
  eq(I.dado(G, b).val, 5); eq(I.dado(G, a).val, 2); eq(turnoDi(G).slot, 2);
});
test('3 slot condivisi: un dado può attaccare 3 volte', () => {
  const G = partita(2, 44); const a = idA(G), b = idB(G);
  scena(G, { alt: 1, dadi: [[a, mappa(2, 2), 6], [b, mappa(2, 3), 1], [b + 1, mappa(2, 1), 1], [b + 2, mappa(1, 2), 1]], turno: giocA(G) });
  for (let k = 0; k < 3; k++) { tocca(G, o => o.tipo === 'attacca'); passaTutti(G); }
  eq(G.giocatori[1 - giocA(G)].dadi.filter(d => d.stato === 'boost').length, 3);
  vero(!G.richiesta.opzioni.some(o => o.tipo === 'attacca' || o.tipo === 'muovi'));
});
test('livelli: lv2 pesca 2, lv3 +1 spazio e +1 ai dadi, lv4 pesca 3, lv5 +1 spazio e +3 Fama, poi basta', () => {
  const G = partita(2, 45); const g = G.giocatori[0];
  g.dadi[0].stato = 'mappa'; g.dadi[0].val = 3; g.dadi[0].pos = 0; G.mappa[0].pila = [0];
  const m0 = g.mano.length; I.saleLivello(G, g); eq(g.livello, 2); eq(g.mano.length, m0 + 2);
  I.saleLivello(G, g); eq(g.spazi, 2); eq(g.dadi[0].val, 4);
  const m1 = g.mano.length; I.saleLivello(G, g); eq(g.mano.length, m1 + 3);
  const f = g.fama; I.saleLivello(G, g); eq(g.spazi, 3); eq(g.fama, f + 3);
  I.saleLivello(G, g); eq(g.livello, 5);
});

console.log('\n§ Eventi');
function conEvento(e, valori) {
  const G = partita(2, 51); const a = idA(G);
  scena(G, { tipo: e.tipo, dadi: [[a, mappa(0, 0), valori[0]], [a + 1, mappa(0, 1), valori[1]], [a + 2, mappa(0, 2), valori[2]], [idB(G), mappa(4, 4), 3]] });
  G.mappa[mappa(0, 0)].alt = 2; G.mappa[mappa(0, 1)].alt = 1; G.mappa[mappa(0, 2)].alt = 0; G.mappa[mappa(4, 4)].tipo = e.tipo === 'terra' ? 'acqua' : 'terra';
  G.pila.push({ k: 'evento', e: { ...e }, step: 0 }); G.richiesta = null; R.avanza(G); passaTutti(G);
  return [a, a + 1, a + 2].map(id => I.dado(G, id));
}
test('evento positivo: +0/+1/+2 dall\'alto in basso, solo su quel terreno', () => { eq(conEvento({ tipo: 'terra', eff: 'positivo' }, [3, 3, 3]).map(d => d.val), [3, 4, 5]); });
test('evento negativo: −2/−1/0 come danno; a 0 si muore senza Fama', () => {
  const ds = conEvento({ tipo: 'fuoco', eff: 'negativo' }, [2, 3, 3]);
  eq(ds[0].stato, 'boost'); eq(ds[0].val, 1); eq(ds[1].val, 2); eq(ds[2].val, 3);
});
test('evento destino: tutti i dadi di quel terreno al valore del Dado Destino', () => { const ds = conEvento({ tipo: 'acqua', eff: 'destino' }, [1, 4, 6]); vero(ds[0].val === ds[1].val && ds[1].val === ds[2].val); });
test('fine: alla terza carta dello stesso simbolo si gioca l\'ultimo round', () => {
  for (let s = 0; s < 40; s++) {
    const G = R.nuovaPartita({ seed: 300 + s, nomi: ['A', 'B'] });
    while (!G.finita) { const i = G.richiesta.opzioni.findIndex(o => o.tipo === 'fine' || o.tipo === 'passa'); R.rispondi(G, G.richiesta.gioc, i >= 0 ? i : 0); }
    const c = { terra: 0, fuoco: 0, acqua: 0 }; let fine = null;
    G.eventi.usciti.forEach((e, k) => { c[e.tipo]++; if (fine === null && c[e.tipo] === 3) fine = k + 1; });
    eq(G.round, fine);
  }
});
test('punteggio: Fama + valore dei dadi in campo + 1 per dado in Boost/Gate', () => {
  const G = R.nuovaPartita({ seed: 77, nomi: ['A', 'B'] });
  while (!G.finita) { const i = G.richiesta.opzioni.findIndex(o => o.tipo === 'fine' || o.tipo === 'passa'); R.rispondi(G, G.richiesta.gioc, i >= 0 ? i : 0); }
  for (const p of G.punteggi) { const g = G.giocatori[p.id]; eq(p.totale, g.fama + g.dadi.filter(d => d.stato === 'mappa' || d.stato === 'sotto').reduce((s, d) => s + d.val, 0) + g.dadi.filter(d => ['boost', 'gate', 'carta'].includes(d.stato)).length); }
});

console.log('\n§ Carte: catena, spazi, costi, Boost');
test('catena: parte chi innesca, poi in ordine; chi passa è fuori; si rigira solo tra chi non ha passato; risoluzione dall\'ultima alla prima', () => {
  const G = partita(3, 61, ['scintilla', 'costrutto', 'impatto']); const A = giocA(G), o = G.ordine, B = o[1], C = o[2];
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(2, 3), 3], [C * 3, mappa(4, 4), 3]], mani: { [A]: [3, 3, 3], [B]: [3, 3], [C]: [3, 3] }, turno: A });
  G.giocatori.forEach(g => g.spazi = 3);
  if (process.env.DBG) console.log(A, B, C, G.giocatori.map(g => g.mano.map(c => c.n)), G.richiesta.opzioni.map(o => o.txt));
  tocca(G, x => x.tipo === 'attacca');
  if (process.env.DBG) console.log(G.richiesta.opzioni.map(o => o.txt), G.log.slice(-5).map(l=>l.txt));
  const seq = [];
  const gioca = () => { seq.push('G' + G.richiesta.gioc); tocca(G, x => x.tipo === 'carta' && /Destino/.test(x.txt)); tocca(G, x => x.val === 1); };
  const passa = () => { seq.push('P' + G.richiesta.gioc); tocca(G, x => x.tipo === 'passa'); };
  eq(G.richiesta.gioc, A); gioca(); eq(G.richiesta.gioc, B); passa(); eq(G.richiesta.gioc, C); gioca();
  eq(G.richiesta.gioc, A, 'secondo giro: A'); gioca(); eq(G.richiesta.gioc, C, 'B è fuori'); passa();
  eq(G.richiesta.gioc, A); passa();
  const cat = G.pila.find(f => f.k === 'catena' || f.k === 'risolvi'); vero(!cat, 'catena chiusa');
  const ris = G.log.filter(l => /^Si risolve/.test(l.txt)).map(l => l.txt);
  eq(ris.length, 3); vero(/di [A-D]$/.test(ris[0]));
  eq(seq, ['G' + A, 'P' + B, 'G' + C, 'G' + A, 'P' + C, 'P' + A]);
});
test('a livello 1 c\'è un solo spazio carta: con un Aggeggio in campo non si gioca altro', () => {
  const G = partita(2, 63, ['scintilla', 'lancio']); const A = giocA(G);
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 3], [(1 - A) * 3, mappa(0, 0), 3]], mani: { [A]: [7, 7] }, turno: A });
  G.giocatori[A].fazione = 'scintilla';
  tocca(G, x => x.tipo === 'carta'); passaTutti(G);
  eq(G.giocatori[A].campo.length, 1);
  vero(!G.richiesta.opzioni.some(x => x.tipo === 'carta'), 'nessuno spazio libero');
});
test('il costo si paga con il Boost, spezzandolo su più dadi; senza Boost la carta non si gioca', () => {
  const G = partita(2, 64); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 2, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(0, 0), 3]], mani: { [A]: [1] }, turno: A });
  I.dado(G, A * 3 + 1).val = 1; I.dado(G, A * 3 + 2).val = 1;
  G.richiesta = null; R.avanza(G);
  vero(!G.richiesta.opzioni.some(x => x.tipo === 'carta'), 'Cannone: costo 2 + almeno 1 di X, ho solo 2 di Boost');
  I.dado(G, A * 3 + 2).val = 2; G.richiesta = null; R.avanza(G);
  tocca(G, x => x.tipo === 'carta' && /Cannone/.test(x.txt));
  eq(G.richiesta.opzioni.map(o => o.val), [1], 'X da 1 a 2, ma resta solo 1 dopo il costo');
  tocca(G, x => x.val === 1);
  tocca(G, x => x.dado === A * 3 + 2);        // il 2 paga 2, poi l'1 paga l'ultimo punto da solo
  eq(I.dado(G, A * 3 + 1).stato, 'gate'); eq(I.dado(G, A * 3 + 2).stato, 'gate'); eq(I.dado(G, A * 3 + 2).val, 6, 'al Gate i dadi sono già a 6');
  eq(G.giocatori[A].mano.length, 0, 'nessuna carta scartata per il costo');
  passaTutti(G); eq(I.dado(G, B * 3).val, 2, 'Cannone con X = 1: 1 danno al nemico in alto');
});
test('Cannone con X = 2 fa 2 danni', () => {
  const G = partita(2, 641); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 2, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(0, 0), 3], [B * 3 + 1, mappa(0, 1), 5]], mani: { [A]: [1] }, turno: A });
  I.dado(G, A * 3 + 1).val = 6; G.richiesta = null; R.avanza(G);
  tocca(G, x => /Cannone/.test(x.txt || '')); tocca(G, x => x.val === 2); tocca(G, x => x.dado === A * 3 + 1); passaTutti(G);
  eq([I.dado(G, B * 3).val, I.dado(G, B * 3 + 1).val], [1, 3]); eq(I.dado(G, A * 3 + 1).val, 2, 'pagati 4 dal dado da 6');
});
test('X spezzabile su più dadi; un dado Boost a 0 va al Gate a 6 e rientra nel proprio turno', () => {
  const G = partita(2, 65); const A = giocA(G);
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 1], [(1 - A) * 3, mappa(0, 0), 3]], mani: { [A]: [6] }, turno: A });
  I.dado(G, A * 3 + 1).val = 3; I.dado(G, A * 3 + 2).val = 2;
  G.richiesta = null; R.avanza(G);
  tocca(G, x => x.tipo === 'carta' && /Guanto/.test(x.txt));
  eq(G.richiesta.opzioni.length, 4, 'Boost totale 5, costo 1: X da 1 a 4');
  tocca(G, x => x.val === 4); tocca(G, x => x.dado === A * 3);
  tocca(G, x => x.dado === A * 3 + 1);
  passaTutti(G);
  eq(I.dado(G, A * 3).val, 5); eq(I.dado(G, A * 3 + 1).stato, 'gate'); eq(I.dado(G, A * 3 + 2).stato, 'gate');
});
test('Alla Muraglia Quadra! annulla i danni del Cannone', () => {
  const G = partita(2, 66); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 2, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(0, 0), 3]], mani: { [A]: [1], [B]: [2] }, turno: A });
  I.dado(G, A * 3 + 1).val = 6; G.richiesta = null; R.avanza(G);
  tocca(G, x => /Cannone/.test(x.txt || '')); tocca(G, x => x.val === 1); tocca(G, x => x.dado === A * 3 + 1);
  eq(G.richiesta.gioc, B); tocca(G, x => x.tipo === 'carta'); tocca(G, x => /Cannone/.test(x.txt));
  passaTutti(G); eq(I.dado(G, B * 3).val, 3);
});
test('agli eventi non si risponde con le carte: nessuna catena', () => {
  const G = partita(2, 67); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 2, tipo: 'fuoco', dadi: [[B * 3, mappa(0, 0), 3], [A * 3, mappa(4, 4), 3]], mani: { [A]: [2, 4], [B]: [2, 4] } });
  G.pila.push({ k: 'evento', e: { tipo: 'fuoco', eff: 'negativo' }, step: 0 }); G.richiesta = null; RAW.avanza(G);
  eq(G.richiesta.tipo, 'avviso'); eq(I.dado(G, B * 3).val, 1); eq(I.dado(G, A * 3).val, 1);
});
test('ogni lancio del Dado Destino ha il suo banner', () => {
  const G = partita(2, 68); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 6], [B * 3, mappa(2, 3), 2]], mani: { [B]: [19] }, turno: A });
  G.giocatori[B].fazione = 'impatto';
  RAW.rispondi(G, A, G.richiesta.opzioni.findIndex(o => o.tipo === 'attacca'));
  RAW.rispondi(G, A, G.richiesta.opzioni.findIndex(o => o.tipo === 'passa'));
  RAW.rispondi(G, B, G.richiesta.opzioni.findIndex(o => o.tipo === 'carta'));
  while (G.richiesta.tipo === 'catena') RAW.rispondi(G, G.richiesta.gioc, G.richiesta.opzioni.length - 1);
  eq(G.richiesta.tipo, 'avviso'); const t = G.richiesta.avviso.find(x => x.tipo === 'tiro');
  vero(t && t.tiro >= 1 && t.tiro <= 6 && t.carta === 19 && t.chi === B && t.esito, JSON.stringify(G.richiesta.avviso));
});
test('uccisione con carta: 3 Fama e nessun livello', () => {
  const G = partita(2, 68); const A = giocA(G), B = 1 - A, g = G.giocatori[A];
  scena(G, { alt: 2, dadi: [[B * 3, mappa(0, 0), 1]] });
  const f = g.fama, lv = g.livello; I.danno(G, I.dado(G, B * 3), 1, { gioc: A });
  eq(g.fama, f + 3); eq(g.livello, lv); eq(I.dado(G, B * 3).val, 1);
});
test('Medaglia Angolare: si può attaccare solo il dado di valore maggiore', () => {
  const G = partita(2, 69); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 6], [B * 3, mappa(2, 3), 2], [B * 3 + 1, mappa(2, 1), 5]], turno: A });
  G.giocatori[B].campo.push({ uid: 7777, n: 7, attiva: true, dado: null });
  G.richiesta = null; R.avanza(G);
  eq(G.richiesta.opzioni.filter(o => o.tipo === 'attacca').map(o => o.bersaglio), [B * 3 + 1]);
});
test('Cubi di Vetro: i dadi protetti non sono bersagli', () => {
  const G = partita(2, 70); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 6], [B * 3, mappa(2, 3), 2]], turno: A });
  G.giocatori[B].campo.push({ uid: 7778, n: 28, attiva: true, dado: null, protetti: [B * 3] });
  G.richiesta = null; R.avanza(G);
  eq(G.richiesta.opzioni.filter(o => o.tipo === 'attacca').length, 0);
});
test('Fortezza di Gomma: annulla l\'attacco di un dado adiacente', () => {
  const G = partita(2, 71); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 6], [B * 3, mappa(2, 3), 2]], mani: { [B]: [19] }, turno: A });
  G.giocatori[B].fazione = 'impatto';
  tocca(G, x => x.tipo === 'attacca'); tocca(G, x => x.tipo === 'passa'); tocca(G, x => x.tipo === 'carta');
  passaTutti(G); eq(I.dado(G, B * 3).stato, 'mappa'); eq(turnoDi(G).slot, 2, 'slot speso comunque');
});
test('Aggeggio: lascia il campo all\'inizio del proprio turno; il dado sopra va al Gate e rientra subito a 6', () => {
  const G = partita(2, 72); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(0, 0), 3]], mani: { [A]: [21, 3] }, turno: A });
  G.giocatori[A].fazione = 'impatto'; const bd = I.dado(G, A * 3 + 1); bd.val = 2;
  G.richiesta = null; R.avanza(G);
  tocca(G, x => /Martello/.test(x.txt || '')); tocca(G, x => x.dado === bd.id); tocca(G, x => x.carta != null); passaTutti(G);
  eq(bd.stato, 'carta'); eq(I.martello(G, A), 2);
  tocca(G, x => x.tipo === 'fine'); while (G.richiesta.tipo === 'scarto') tocca(G, () => true);
  while (G.richiesta.gioc === B) { const i = G.richiesta.opzioni.findIndex(o => o.tipo === 'fine' || o.tipo === 'passa'); R.rispondi(G, B, i >= 0 ? i : 0); if (G.richiesta.tipo === 'scarto') tocca(G, () => true); }
  passaTutti(G);
  if (G.richiesta.tipo === 'gate') tocca(G, () => true);
  eq(G.giocatori[A].campo.length, 0); eq(bd.stato, 'mappa'); eq(bd.val, 6);
});
test('Torri di Randomir: il dado sotto non è in gioco, quello sopra vale come in alto', () => {
  const G = partita(2, 73); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 0, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(0, 0), 3], [B * 3 + 1, mappa(0, 1), 2]] });
  const a = I.dado(G, A * 3); I.sposta(G, a, mappa(0, 0)); a.torre = true;
  eq(I.dado(G, B * 3).stato, 'sotto'); eq(I.altEff(G, a), 2);
  eq(I.forzaAttacco(G, a, I.dado(G, B * 3 + 1), 0), 5);
  I.uccidi(G, a, 'evento'); eq(I.dado(G, B * 3).stato, 'mappa', 'quando se ne va, il dado sotto torna in gioco');
});
test('carte con trigger: solo quando scatta il loro trigger', () => {
  const G = partita(2, 74); const A = giocA(G);
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 3], [(1 - A) * 3, mappa(2, 3), 3]], mani: { [A]: [3, 5, 2] }, turno: A });
  vero(!G.richiesta.opzioni.some(o => o.tipo === 'carta'), 'fuori da un attacco Faccia del Destino e Lago non si giocano');
  tocca(G, x => x.tipo === 'attacca');
  vero(G.richiesta.opzioni.some(o => /Destino/.test(o.txt)) && G.richiesta.opzioni.some(o => /Lago/.test(o.txt)));
});
test('vista: la mano e il mazzo altrui sono solo numeri', () => {
  const G = partita(3, 75); const V = R.vista(G, 0);
  for (const g of V.giocatori) { if (g.id === 0) vero(Array.isArray(g.mano)); else eq(typeof g.mano, 'number'); eq(typeof g.mazzo, 'number'); }
  vero(V.rs === undefined && V.pila === undefined && !V.eventi.mazzo);
});

console.log('\n§ Gate, Fase Finale, carte nuove');
test('Fase Gate: rientrano tutti, poi 1 Fama per ogni dado in arena (anche senza rientri)', () => {
  const G = partita(2, 91); const t = turnoDi(G); const g = G.giocatori[t.gioc];
  scena(G, { alt: 1, dadi: [[g.id * 3, mappa(2, 2), 4]] });
  g.dadi[1].stato = 'gate'; g.dadi[1].val = 6; const f0 = g.fama;
  t.step = 'gate'; t.rientrati = 0; G.richiesta = null; R.avanza(G);
  tocca(G, () => true); eq(g.fama, f0 + 2, '2 dadi in arena dopo il rientro');
  const G2 = partita(2, 92); const t2 = turnoDi(G2), g2 = G2.giocatori[t2.gioc];
  scena(G2, { alt: 1, dadi: [[g2.id * 3, mappa(2, 2), 4]] }); const f1 = g2.fama;
  t2.step = 'gate'; G2.richiesta = null; R.avanza(G2); eq(g2.fama, f1 + 1, 'Gate vuoto: +1 per l\'unico dado in arena');
});
test('Fase Finale: si scelgono i dadi del Boost da passare al Gate, a 6, anche quelli alti', () => {
  const G = partita(2, 93); const A = giocA(G);
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 4]], turno: A });
  I.dado(G, A * 3 + 1).val = 5; I.dado(G, A * 3 + 2).val = 1;
  tocca(G, o => o.tipo === 'fine'); while (G.richiesta.tipo === 'scarto') tocca(G, () => true);
  eq(G.richiesta.tipo, 'finale'); eq(G.richiesta.opzioni.length, 4);
  tocca(G, o => o.dadi.length === 1 && o.dadi[0] === A * 3 + 1);
  eq(I.dado(G, A * 3 + 1).stato, 'gate'); eq(I.dado(G, A * 3 + 1).val, 6); eq(I.dado(G, A * 3 + 2).stato, 'boost');
});
test('i dadi sopra le carte restano bloccati nella Fase Finale', () => {
  const G = partita(2, 94); const A = giocA(G);
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 4], [(1 - A) * 3, mappa(0, 0), 3]], mani: { [A]: [21] }, turno: A });
  G.giocatori[A].fazione = 'impatto'; I.dado(G, A * 3 + 1).val = 3; I.dado(G, A * 3 + 2).val = 2; G.richiesta = null; R.avanza(G);
  tocca(G, x => /Martello/.test(x.txt || '')); tocca(G, x => x.dado === A * 3 + 1); passaTutti(G);
  eq(I.dado(G, A * 3 + 1).stato, 'carta'); eq(I.dado(G, A * 3 + 2).val, 1, 'costo 1 pagato dall\'altro dado');
  tocca(G, o => o.tipo === 'fine'); while (G.richiesta.tipo === 'scarto') tocca(G, () => true);
  vero(G.richiesta.opzioni.every(o => !o.dadi.includes(A * 3 + 1)), 'il dado sul Martello non si può passare al Gate');
});
test('Molla Caotica: spinta di X tasselli in linea retta', () => {
  const G = partita(2, 95); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 4], [B * 3, mappa(0, 0), 3]], mani: { [A]: [16] }, turno: A });
  G.giocatori[A].fazione = 'costrutto'; I.dado(G, A * 3 + 1).val = 4; G.richiesta = null; R.avanza(G);
  tocca(G, x => /Molla/.test(x.txt || '')); tocca(G, x => x.dado === B * 3);
  eq(G.richiesta.opzioni.map(o => o.val), [1, 2, 3, 4], 'Boost 4+1 meno costo 1, al massimo 4 tasselli');
  tocca(G, x => x.val === 2); eq(G.richiesta.opzioni.map(o => o.tassello).sort((a, b) => a - b), [mappa(0, 2), mappa(2, 0)]);
  tocca(G, x => x.tassello === mappa(2, 0)); tocca(G, x => x.dado === A * 3 + 1); passaTutti(G); eq(I.dado(G, B * 3).pos, mappa(2, 0));
});
test('Specchi Profondi: X attacchi gratis in tutto, dall\'uno o dall\'altro dado', () => {
  const G = partita(2, 96); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 6], [A * 3 + 1, mappa(4, 4), 6], [B * 3, mappa(2, 3), 2], [B * 3 + 1, mappa(4, 3), 2], [B * 3 + 2, mappa(3, 4), 2]], mani: { [A]: [18] }, turno: A });
  G.giocatori[A].fazione = 'costrutto'; G.giocatori.forEach(g => g.spazi = 3); I.dado(G, A * 3 + 2).val = 5; G.richiesta = null; R.avanza(G);
  tocca(G, x => x.tipo === 'attacca' && x.bersaglio === B * 3);
  tocca(G, x => /Specchi Prismatici/.test(x.txt || '')); tocca(G, x => x.dado === A * 3); tocca(G, x => x.dado === A * 3 + 1); tocca(G, x => x.val === 2);
  passaTutti(G);
  eq(G.richiesta.tipo, 'extra'); tocca(G, x => x.tipo === 'attacca'); passaTutti(G);
  eq(G.richiesta.tipo, 'extra', 'secondo attacco gratis'); tocca(G, x => x.tipo === 'attacca'); passaTutti(G);
  eq(G.richiesta.tipo, 'azione'); eq(turnoDi(G).slot, 2, 'gli attacchi degli Specchi non costano slot');
});
test('Propulsore Potenziale: dopo il movimento il dado attacca senza slot', () => {
  const G = partita(2, 97); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 1, dadi: [[A * 3, mappa(2, 2), 6], [B * 3, mappa(2, 4), 2]], mani: { [A]: [22] }, turno: A });
  G.giocatori[A].fazione = 'impatto'; I.dado(G, A * 3 + 1).val = 2; G.richiesta = null; R.avanza(G);
  tocca(G, x => x.tipo === 'muovi' && x.tassello === mappa(2, 3));
  tocca(G, x => /Propulsore/.test(x.txt || '')); passaTutti(G);
  eq(G.richiesta.tipo, 'extra'); tocca(G, x => x.tipo === 'attacca'); passaTutti(G);
  eq(I.dado(G, B * 3).stato, 'boost'); eq(turnoDi(G).slot, 2, 'solo il movimento ha speso uno slot');
});
test('il Raddoppiatore non c\'è più: mazzo da 30 con Propulsore Potenziale', () => {
  eq(R.CARTE[22].nome, 'Propulsore Potenziale');
  const G = partita(2, 98, ['impatto', 'lancio']); const g = G.giocatori.find(x => x.fazione === 'impatto');
  const tutte = [...g.mazzo, ...g.mano]; eq(tutte.length, 30); eq(tutte.filter(c => c.n === 22).length, 3);
});

console.log('\n§ Banner');
test('a inizio partita il banner del Dado Destino, da confermare dal primo giocatore', () => {
  const G = RAW.nuovaPartita({ seed: 81, nomi: ['A', 'B', 'C'] });
  eq(G.richiesta.tipo, 'avviso'); eq(G.richiesta.gioc, G.primo); eq(G.richiesta.avviso[0].tipo, 'destino');
  eq(G.richiesta.avviso[0].primo, G.primo); eq(G.richiesta.opzioni.length, 1);
  for (const g of [0, 1, 2]) { const V = R.vista(G, g); eq(V.avviso.a[0].tipo, 'destino'); }
  RAW.rispondi(G, G.primo, 0); eq(G.richiesta.tipo, 'fazione');
});
test('solo il primo giocatore può chiudere il banner', () => {
  const G = RAW.nuovaPartita({ seed: 82, nomi: ['A', 'B'] }); let errore = false;
  try { RAW.rispondi(G, 1 - G.primo, 0); } catch (e) { errore = true; } vero(errore);
});
test('banner dell\'evento con i dadi prima → dopo', () => {
  const G = partita(2, 83); const a = idA(G);
  scena(G, { tipo: 'terra', alt: 0, dadi: [[a, mappa(0, 0), 3], [idB(G), mappa(4, 4), 1]] });
  G.pila.push({ k: 'evento', e: { tipo: 'terra', eff: 'negativo' }, step: 0 }); G.mappa[mappa(0, 0)].alt = 2; G.mappa[mappa(4, 4)].alt = 2;
  G.richiesta = null; RAW.avanza(G);
  eq(G.richiesta.tipo, 'avviso'); const b = G.richiesta.avviso.find(x => x.tipo === 'evento');
  vero(b, 'c\'è il banner evento'); eq(b.dadi.map(d => [d.prima, d.dopo, d.morto]).sort(), [[1, null, true], [3, 1, false]]);
  eq(G.richiesta.avviso.filter(x => x.tipo === 'uccisione').length, 0, 'le morti per evento stanno nel banner evento');
});
test('banner dell\'uccisione: chi, forza, Fama e livello', () => {
  const G = partita(2, 84); const a = idA(G), b = idB(G);
  scena(G, { alt: 1, dadi: [[a, mappa(2, 2), 5], [b, mappa(2, 3), 4]], turno: giocA(G) });
  RAW.rispondi(G, G.richiesta.gioc, G.richiesta.opzioni.findIndex(o => o.tipo === 'attacca'));
  while (G.richiesta.tipo === 'catena') RAW.rispondi(G, G.richiesta.gioc, G.richiesta.opzioni.length - 1);
  eq(G.richiesta.tipo, 'avviso'); eq(G.richiesta.gioc, G.primo);
  const k = G.richiesta.avviso[0]; eq([k.tipo, k.causa, k.da, k.vittima, k.valore, k.forza, k.fama, k.livello], ['uccisione', 'attacco', giocA(G), b, 4, 5, 4, 2]);
  RAW.rispondi(G, G.primo, 0); eq(G.richiesta.tipo, 'azione');
});
test('uccisione con una carta: il banner dice quale', () => {
  const G = partita(2, 85); const A = giocA(G), B = 1 - A;
  scena(G, { alt: 2, dadi: [[A * 3, mappa(2, 2), 3], [B * 3, mappa(0, 0), 1]], mani: { [A]: [1, 3, 3] }, turno: A });
  I.dado(G, A * 3 + 1).val = 6; G.richiesta = null; RAW.avanza(G); chiudiBanner(G);
  RAW.rispondi(G, A, G.richiesta.opzioni.findIndex(o => /Cannone/.test(o.txt || '')));
  while (G.richiesta.tipo === 'costruzione') RAW.rispondi(G, A, 0);
  while (G.richiesta.tipo === 'catena') RAW.rispondi(G, G.richiesta.gioc, G.richiesta.opzioni.length - 1);
  eq(G.richiesta.tipo, 'avviso'); const k = G.richiesta.avviso[0]; eq([k.causa, k.carta, k.fama], ['carta', 1, 3]);
});

console.log(`\n${ok} superati, ${ko} falliti\n`);
process.exit(ko ? 1 : 0);
