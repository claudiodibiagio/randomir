/* ==========================================================================
   RANDOMIR – ARENA · server (Cloudflare Worker + Durable Object)
   - serve i file statici della cartella public/ (gioco, immagini)
   - ogni codice stanza è un Durable Object che tiene lo stato completo
     e manda a ciascun giocatore solo la sua vista filtrata
   - lo stato è salvato a ogni mossa: la partita sopravvive a disconnessioni
   ========================================================================== */
import '../public/motore.js';
const R = globalThis.Randomir;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/stanza\/([A-Z0-9]{4,6})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('serve un websocket', { status: 426 });
      const id = env.PARTITA.idFromName(m[1]);
      return env.PARTITA.get(id).fetch(req);
    }
    if (url.pathname === '/api/ping') return new Response('ok');
    if (url.pathname === '/api/archivio' || url.pathname === '/api/nomi') {
      const arch = env.ARCHIVIO.get(env.ARCHIVIO.idFromName('archivio'));
      return arch.fetch(new Request('https://archivio' + (url.pathname === '/api/nomi' ? '/nomi' : '/tutte')));
    }
    return env.ASSETS.fetch(req);
  },
};

export class Partita {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.S = undefined; }

  async carica() {
    if (this.S === undefined) this.S = (await this.ctx.storage.get('s')) || null;
    return this.S;
  }
  async salva() { await this.ctx.storage.put('s', this.S); }

  async fetch(req) {
    const codice = new URL(req.url).pathname.split('/').pop();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ posto: null, codice });
    return new Response(null, { status: 101, webSocket: client });
  }

  archivio() { return this.env.ARCHIVIO.get(this.env.ARCHIVIO.idFromName('archivio')); }
  async registraNome(nome) {
    try { await this.archivio().fetch(new Request('https://archivio/nome', { method: 'POST', body: JSON.stringify({ nome }) })); } catch (e) { /* l'archivio non blocca il gioco */ }
  }
  // tempi: inizio di ogni turno, per le statistiche sulla durata
  segnaTempo() {
    const G = this.S.G, t = G.pila.find(f => f.k === 'turno'); if (!t) return;
    const T = this.S.tempi = this.S.tempi || { inizio: Date.now(), turni: [] };
    const ult = T.turni[T.turni.length - 1];
    if (!ult || ult.g !== t.gioc || ult.r !== G.round) T.turni.push({ g: t.gioc, r: G.round, t: Date.now() });
  }
  async archivia() {
    const S = this.S, G = S.G;
    if (!G || !G.finita || S.archiviata) return;
    S.archiviata = true;
    const fine = Date.now();
    const rec = { codice: S.codice, inizio: (S.tempi && S.tempi.inizio) || fine, fine, turni: (S.tempi && S.tempi.turni) || [], resoconto: G.resoconto };
    try { await this.archivio().fetch(new Request('https://archivio/partita', { method: 'POST', body: JSON.stringify(rec) })); }
    catch (e) { S.archiviata = false; }
  }

  manda(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) { /* socket chiuso */ } }

  lobby(posto) {
    const S = this.S, conn = new Set(this.ctx.getWebSockets().map(w => (w.deserializeAttachment() || {}).posto).filter(p => p != null));
    return { codice: S.codice, n: S.n, io: posto, host: 0, iniziata: !!S.G,
      posti: S.posti.map((p, i) => ({ nome: p.nome, connesso: conn.has(i) })) };
  }
  trasmetti() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.posto == null) continue;
      this.manda(ws, { t: 'stato', lobby: this.lobby(a.posto), v: this.S.G ? R.vista(this.S.G, a.posto) : null });
    }
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    await this.carica();
    const a = ws.deserializeAttachment() || {};
    const errore = msg => this.manda(ws, { t: 'errore', msg });
    const token = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    const nome = String(m.nome || '').trim().slice(0, 20);

    if (m.t === 'crea') {
      if (this.S && this.S.posti.length) return errore('Questo codice è già in uso: creane un altro.');
      const n = Math.max(2, Math.min(4, +m.n || 2));
      if (!nome) return errore('Scrivi il tuo nome.');
      this.S = { codice: a.codice, n, posti: [{ nome, token: token() }], G: null, creata: Date.now() };
      await this.salva(); await this.registraNome(nome);
      ws.serializeAttachment({ ...a, posto: 0 });
      this.manda(ws, { t: 'benvenuto', posto: 0, token: this.S.posti[0].token, codice: a.codice });
      return this.trasmetti();
    }
    if (m.t === 'entra') {
      if (!this.S) return errore('Nessuna partita con questo codice.');
      let posto = this.S.posti.findIndex(p => m.token && p.token === m.token);
      if (posto < 0) {
        if (this.S.G) return errore('La partita è già iniziata: puoi rientrare solo dal dispositivo con cui eri entrato.');
        if (this.S.posti.length >= this.S.n) return errore('La partita è al completo.');
        if (!nome) return errore('Scrivi il tuo nome.');
        if (this.S.posti.some(p => p.nome.toLowerCase() === nome.toLowerCase())) return errore('Questo nome è già preso in questa partita.');
        this.S.posti.push({ nome, token: token() }); posto = this.S.posti.length - 1;
        await this.salva(); await this.registraNome(nome);
      }
      ws.serializeAttachment({ ...a, posto });
      this.manda(ws, { t: 'benvenuto', posto, token: this.S.posti[posto].token, codice: this.S.codice });
      return this.trasmetti();
    }
    if (a.posto == null || !this.S) return errore('Prima entra in una partita.');
    if (m.t === 'avvia' || m.t === 'rivincita') {
      if (a.posto !== 0) return errore('Solo chi ha creato la partita può avviarla.');
      if (this.S.posti.length < 2) return errore('Servono almeno 2 giocatori.');
      if (m.t === 'avvia' && this.S.G) return errore('La partita è già iniziata.');
      if (m.t === 'rivincita' && !(this.S.G && this.S.G.finita)) return errore('La partita non è finita.');
      this.S.n = this.S.posti.length;
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      this.S.G = R.nuovaPartita({ seed, nomi: this.S.posti.map(p => p.nome) });
      this.S.archiviata = false; this.S.tempi = { inizio: Date.now(), turni: [] };
      await this.salva();
      return this.trasmetti();
    }
    if (m.t === 'mossa') {
      const G = this.S.G;
      if (!G || !G.richiesta) return errore('Non c\'è nessuna decisione in attesa.');
      if (G.richiesta.gioc !== a.posto) return errore('Non tocca a te.');
      if (m.n !== G.richiesta.n) return this.trasmetti();      // clic su uno stato vecchio: riallinea
      try { R.rispondi(G, a.posto, m.i); } catch (e) { return errore('Mossa non valida: ' + e.message); }
      if (G.log.length > 600) G.log = G.log.slice(-400);
      this.segnaTempo();
      await this.archivia();
      await this.salva();
      return this.trasmetti();
    }
    if (m.t === 'ping') return this.manda(ws, { t: 'pong' });
  }

  async webSocketClose(ws) { await this.carica(); if (this.S) this.trasmetti(); }
  async webSocketError(ws) { await this.carica(); if (this.S) this.trasmetti(); }
}

/* ==========================================================================
   ARCHIVIO: un solo oggetto per tutte le partite finite e per i nomi
   ========================================================================== */
export class Archivio {
  constructor(ctx, env) { this.ctx = ctx; }
  async fetch(req) {
    const url = new URL(req.url), st = this.ctx.storage;
    const json = (x, h) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(h || {}) } });
    if (url.pathname === '/nome' && req.method === 'POST') {
      const { nome } = await req.json(); const k = String(nome || '').trim().slice(0, 20); if (!k) return json({ ok: false });
      const nomi = (await st.get('nomi')) || {}; const chiave = k.toLowerCase();
      if (!nomi[chiave]) nomi[chiave] = { nome: k, dal: Date.now() };
      nomi[chiave].visto = Date.now();
      await st.put('nomi', nomi); return json({ ok: true });
    }
    if (url.pathname === '/nomi') {
      const nomi = (await st.get('nomi')) || {};
      return json(Object.values(nomi).sort((a, b) => (b.visto || 0) - (a.visto || 0)).map(x => x.nome));
    }
    if (url.pathname === '/partita' && req.method === 'POST') {
      const rec = await req.json();
      const n = ((await st.get('conta')) || 0) + 1;
      rec.n = n;
      await st.put('p:' + String(n).padStart(6, '0'), rec); await st.put('conta', n);
      return json({ ok: true, n });
    }
    if (url.pathname === '/tutte') {
      const m = await st.list({ prefix: 'p:' });
      return json({ partite: [...m.values()], nomi: Object.values((await st.get('nomi')) || {}).map(x => x.nome) });
    }
    return new Response('?', { status: 404 });
  }
}
