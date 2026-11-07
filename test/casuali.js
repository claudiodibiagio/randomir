// Partite casuali complete: ogni decisione è un'opzione a caso tra quelle legali.
// Ad ogni passo lo stato fa un giro in JSON (come il salvataggio del server) e si controllano gli invarianti.
process.env.RANDOMIR_STRICT = '1';
const R = require('../public/motore.js');
const NP = +process.argv[2] || 600;
let rs = 12345; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const stat = { partite: 0, decisioni: 0, round: 0, carte: {}, uccisioni: 0, maxDec: 0, finite: 0, vincitori: {} };
function inv(G) {
  const dadi = G.giocatori.flatMap(g => g.dadi);
  for (const d of dadi) {
    if (!['mappa', 'sotto', 'boost', 'gate', 'carta', 'attesa', 'riserva'].includes(d.stato)) throw new Error('stato dado ' + d.stato);
    if (d.stato === 'mappa' || d.stato === 'sotto') {
      const p = G.mappa[d.pos].pila; if (!p.includes(d.id)) throw new Error('dado non nella pila');
      const top = p[p.length - 1] === d.id; if (top !== (d.stato === 'mappa')) throw new Error('pila incoerente ' + JSON.stringify(p) + ' ' + d.stato);
      if (d.val < 1 || d.val > 6) throw new Error('valore in mappa ' + d.val);
    } else if (d.pos !== null) throw new Error('pos non nulla fuori mappa');
    if (d.stato === 'boost' && (d.val < 1 || d.val > 6)) throw new Error('boost ' + d.val);
    if (d.stato === 'gate' && d.val !== 6) throw new Error('gate ' + d.val);
  }
  for (const t of G.mappa) for (const id of t.pila) { const d = dadi[id]; if (d.pos !== t.i) throw new Error('pila→dado'); }
  for (const g of G.giocatori) {
    if (g.mazzo.length + g.mano.length) { const tot = g.mazzo.length + g.mano.length + g.scarti.length + g.box.length + g.campo.length; if (tot !== 30) throw new Error('carte ' + tot); }
    if (g.campo.length > g.spazi) throw new Error('spazi ' + g.campo.length + '>' + g.spazi);
    if (g.livello < 1 || g.livello > 5) throw new Error('livello');
    for (const c of g.campo) if (c.dado != null && G.giocatori.flatMap(x => x.dadi)[c.dado].stato !== 'carta') throw new Error('dado su carta');
  }
  const uids = G.giocatori.flatMap(g => [...g.mazzo, ...g.mano, ...g.scarti, ...g.box, ...g.campo].map(c => c.uid));
  if (new Set(uids).size !== uids.length) throw new Error('carta duplicata');
}
const t0 = Date.now();
for (let s = 0; s < NP; s++) {
  const n = 2 + (s % 3);
  let G = R.nuovaPartita({ seed: 1000 + s, nomi: ['Anna', 'Bruno', 'Carla', 'Dario'].slice(0, n) });
  let dec = 0;
  try {
    while (!G.finita) {
      const Rq = G.richiesta; if (!Rq) throw new Error('nessuna richiesta e partita non finita');
      // preferisci azioni sensate a volte, per arrivare a uccisioni e carte
      let ops = Rq.opzioni.map((o, i) => i);
      
      if (Rq.tipo === 'catena' && rnd() < 0.5) ops = ops.filter(i => Rq.opzioni[i].tipo !== 'passa');
      if (Rq.tipo === 'azione' && rnd() < 0.85) ops = ops.filter(i => Rq.opzioni[i].tipo !== 'fine');
      if (Rq.tipo === 'azione') { const att = ops.filter(i => Rq.opzioni[i].tipo === 'attacca'); if (att.length && rnd() < 0.5) ops = att; }
      if (!ops.length) ops = Rq.opzioni.map((o, i) => i);
      const i = ops[Math.floor(rnd() * ops.length)];
      const o = Rq.opzioni[i];
      if (o.tipo === 'carta' && Rq.tipo !== 'scarto') { const g = G.giocatori[Rq.gioc]; const c = g.mano.find(x => x.uid === o.carta); stat.carte[c.n] = (stat.carte[c.n] || 0) + 1; }
      // la vista non deve mai esplodere e non deve rivelare mani altrui
      for (const g of G.giocatori) { const V = R.vista(G, g.id); for (const h of V.giocatori) if (h.id !== g.id && typeof h.mano !== 'number') throw new Error('mano visibile'); if (V.richiesta && V.richiesta.gioc !== g.id && V.richiesta.opzioni) throw new Error('opzioni altrui visibili'); }
      R.rispondi(G, Rq.gioc, i);
      G = JSON.parse(JSON.stringify(G));
      inv(G); dec++;
      if (dec > 20000) throw new Error('partita troppo lunga');
    }
  } catch (e) {
    console.log(`✘ seme ${1000 + s} (${n} gioc.) dopo ${dec} decisioni: ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
    console.log(G.log.slice(-12).map(l => '   ' + l.txt).join('\n'));
    process.exit(1);
  }
  // i conti del resoconto devono tornare
  try {
    const Rr = G.resoconto, S = Rr.st; if (!Rr) throw new Error('manca il resoconto');
    G.giocatori.forEach((g, i) => {
      const f = S.fama[i], somma = f.attacco + f.carta + f.lago + f.livello + f.gate;
      if (somma !== g.fama) throw new Error(`Fama scomposta ${somma} ≠ ${g.fama} (${JSON.stringify(f)})`);
    });
    const uccAtt = S.uccisioni.reduce((s, u) => s + u.attacco, 0), vinti = S.attacchi.filter(a => a.esito === 'vinto' && a.p !== a.dif).length;
    if (uccAtt !== vinti) throw new Error(`uccisioni in attacco ${uccAtt} ≠ attacchi vinti ${vinti}`);
    const morti = S.morti.reduce((s, m) => s + m.attacco + m.carta + m.evento + m.movimento, 0), entrati = S.boost.reduce((s, b) => s + b.entrati, 0);
    if (morti !== entrati) throw new Error('morti ≠ dadi entrati nel Boost');
    if (S.decisioni !== dec) throw new Error(`decisioni ${S.decisioni} ≠ ${dec}`);
    const pos = Rr.giocatori.map(g => g.posizione); if (!pos.includes(1)) throw new Error('nessun primo posto');
    if (JSON.stringify(Rr).length > 120000) throw new Error('resoconto troppo grande ' + JSON.stringify(Rr).length);
  } catch (e) { console.log(`✘ resoconto seme ${1000 + s}: ${e.message}`); process.exit(1); }
  stat.partite++; stat.decisioni += dec; stat.round += G.round; stat.maxDec = Math.max(stat.maxDec, dec);
  stat.uccisioni += G.log.filter(l => /elimina/.test(l.txt)).length;
}
console.log(`${stat.partite} partite ok in ${((Date.now() - t0) / 1000).toFixed(1)}s · decisioni medie ${(stat.decisioni / stat.partite).toFixed(0)} (max ${stat.maxDec}) · round medi ${(stat.round / stat.partite).toFixed(2)} · uccisioni medie ${(stat.uccisioni / stat.partite).toFixed(1)}`);
const mancanti = Object.keys(R.CARTE).filter(n => !stat.carte[n]);
console.log('carte giocate almeno una volta:', 30 - mancanti.length, '/ 30', mancanti.length ? 'mai: ' + mancanti.map(n => R.CARTE[n].nome).join(', ') : '');
console.log(Object.entries(stat.carte).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([n, k]) => `${R.CARTE[n].nome} ${k}`).join(' · '));
