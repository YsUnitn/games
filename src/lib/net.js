// Connessione diretta tra i due telefoni (WebRTC via PeerJS).
// Il server di PeerJS serve solo a "presentare" i due dispositivi:
// foto e messaggi viaggiano direttamente (cifrati) da telefono a telefono.
import { Peer } from 'peerjs';
import { getSettings } from './db.js';
import { uid } from './ui.js';

const QS = new URLSearchParams(location.search);
const LOCAL = QS.has('local'); // test: due schede sullo stesso browser
const NO_P2P = QS.has('nop2p'); // test: forza il canale di riserva

function iceServers() {
  const list = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // TURN pubblico offerto da PeerJS (usato solo se la connessione diretta non riesce)
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const t = getSettings().turn?.trim();
  if (t) {
    // formato: turn:host:porta|utente|password
    const [urls, username, credential] = t.split('|').map((x) => x.trim());
    if (urls) list.push({ urls, username, credential });
  }
  return list;
}

class Emitter {
  constructor() { this.l = {}; }
  on(ev, cb) { (this.l[ev] ||= new Set()).add(cb); return () => this.l[ev].delete(cb); }
  emit(ev, ...a) { this.l[ev]?.forEach((cb) => { try { cb(...a); } catch (e) { console.error(e); } }); }
}

export class Room extends Emitter {
  constructor(isHost) {
    super();
    this.isHost = isHost;
    this.status = 'connecting';
    this.via = null; // 'p2p' | 'relay'
    this.closed = false;
    this.p2pOpen = false;
  }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status', s); } }
  // Stato complessivo: connessi se funziona almeno uno dei due canali.
  refresh() {
    const was = this.status === 'connected';
    const p2p = this.p2pOpen && this.conn?.open;
    const relay = !!this.relay?.up;
    this.via = p2p ? 'p2p' : relay ? 'relay' : null;
    if (p2p || relay) {
      this.setStatus('connected');
      this.emit('status', 'connected');
      if (!was) this.emit('peer');
    } else if (this.status === 'connected' || this.status === 'connecting') {
      this.setStatus(this.isHost ? 'waiting' : 'disconnected');
    }
  }
  get link() {
    const base = location.origin + location.pathname + location.search;
    return `${base}#/join/${this.id}${this.key ? '.' + this.key : ''}`;
  }
}

/* ---------- PeerJS ---------- */

function newPeer(id) {
  return new Peer(id, { config: { iceServers: iceServers() }, debug: 1 });
}

function startRelay(room, me) {
  if (!room.key || LOCAL) return;
  // segnaposto sincrono: il modulo MQTT (pesante) si carica in background
  const pending = [];
  room.relay = { up: false, send: (m) => pending.push(m), close() { this.closed = true; } };
  const stub = room.relay;
  import('./relay.js').then(({ Relay }) => {
    if (room.closed || stub.closed) return;
    const r = new Relay(room.id, room.key, me);
    room.relay = r;
    r.on('up', () => room.refresh());
    r.on('down', () => room.refresh());
    r.on('message', (m) => room.emit('message', m));
    return r.start().then(() => { pending.forEach((m) => r.send(m)); });
  }).catch((e) => console.warn('relay', e));
}

export function hostRoom(id = 'gdc-' + uid(8), key = null) {
  if (LOCAL) return localRoom(id, true);
  const room = new Room(true);
  room.id = id;
  room.key = key;
  let attempts = 0;
  startRelay(room, 'host');

  const attach = (conn) => {
    conn.on('open', () => {
      if (room.conn && room.conn !== conn) { try { room.conn.close(); } catch {} }
      room.conn = conn;
      room.p2pOpen = true;
      room.refresh();
    });
    conn.on('data', (d) => { if (conn === room.conn) room.emit('message', d); });
    conn.on('close', () => { if (conn === room.conn) { room.conn = null; room.p2pOpen = false; room.refresh(); } });
    conn.on('error', (e) => console.warn('conn', e));
  };

  const start = () => new Promise((resolve, reject) => {
    if (room.relay) {
      // non aspettare all'infinito il server PeerJS: il canale di riserva basta per iniziare
      setTimeout(() => { if (room.status === 'connecting') { room.setStatus('waiting'); resolve(room); } }, NO_P2P ? 0 : 6000);
    }
    if (NO_P2P) return;
    const peer = newPeer(id);
    room.peer = peer;
    peer.on('open', () => { if (room.status === 'connecting') room.setStatus('waiting'); room.refresh(); resolve(room); });
    peer.on('connection', attach);
    peer.on('disconnected', () => { if (!room.closed && !peer.destroyed) setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500); });
    peer.on('error', (e) => {
      console.warn('peer', e.type, e);
      if (e.type === 'unavailable-id' && attempts++ < 8) {
        // l'ID è ancora "occupato" (es. pagina ricaricata): riprova tra poco
        peer.destroy();
        setTimeout(() => start().then(resolve, reject), 2500);
      } else if (room.status === 'connecting') {
        // il server PeerJS non risponde: se c'è il canale di riserva si gioca lo stesso
        if (room.relay) { room.setStatus('waiting'); resolve(room); } else reject(e);
      }
    });
  });

  return start();
}

export function joinRoom(target) {
  const [hostId, key] = target.split('.');
  if (LOCAL) return localRoom(hostId, false);
  const room = new Room(false);
  room.id = hostId;
  room.key = key || null;
  let peer, retryTimer;
  startRelay(room, 'guest');

  const scheduleRetry = (ms) => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!room.closed && !room.p2pOpen) connect(); }, ms);
  };

  const connect = () => {
    if (room.closed || NO_P2P) return;
    if (!peer || peer.destroyed) return init();
    if (peer.disconnected) { try { peer.reconnect(); } catch {} return; }
    try { room.conn?.close(); } catch {}
    const conn = peer.connect(hostId, { reliable: true });
    room.conn = conn;
    // se entro 15s non si apre, riprova (nel frattempo può funzionare il canale di riserva)
    scheduleRetry(15000);
    conn.on('open', () => { if (conn !== room.conn) return; clearTimeout(retryTimer); room.p2pOpen = true; room.refresh(); });
    conn.on('data', (d) => { if (conn === room.conn) room.emit('message', d); });
    conn.on('close', () => {
      if (conn !== room.conn || room.closed) return;
      room.p2pOpen = false; room.refresh();
      scheduleRetry(3000);
    });
    conn.on('error', (e) => console.warn('conn', e));
  };

  room.retry = () => {
    if (room.closed) return;
    if (room.status !== 'connected') room.setStatus('connecting');
    connect();
  };

  const init = () => {
    if (NO_P2P) return;
    peer = newPeer();
    room.peer = peer;
    peer.on('open', connect);
    peer.on('disconnected', () => { if (!room.closed && !peer.destroyed) setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500); });
    peer.on('error', (e) => {
      console.warn('peer', e.type, e);
      if (e.type === 'peer-unavailable') scheduleRetry(4000);
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        // server PeerJS irraggiungibile: ricrea il peer più tardi
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { try { peer.destroy(); } catch {} init(); }, 8000);
      }
      if (room.status === 'connecting' && !room.relay) room.setStatus('failed');
    });
  };
  init();
  // se dopo 25s non si è connesso nessun canale, mostra l'errore (continua comunque a riprovare)
  setTimeout(() => { if (room.status !== 'connected' && !room.closed) room.setStatus('failed'); }, 25000);
  room._retryTimer = () => clearTimeout(retryTimer);
  return Promise.resolve(room);
}

Room.prototype.send = function (msg) {
  if (this.local) return this.local.post(msg);
  if (this.p2pOpen && this.conn?.open) return this.conn.send(msg);
  if (this.relay) this.relay.send(msg);
};
Room.prototype.close = function () {
  this.closed = true;
  this._retryTimer?.();
  try { this.conn?.close(); } catch {}
  try { this.peer?.destroy(); } catch {}
  try { this.relay?.close(); } catch {}
  try { this.bc?.close(); } catch {}
};

/* ---------- Trasporto locale (solo per test tra schede) ---------- */
function localRoom(id, isHost) {
  const room = new Room(isHost);
  room.id = id;
  const bc = new BroadcastChannel('gdc-' + id);
  room.bc = bc;
  const me = isHost ? 'host' : 'guest';
  room.local = { post: (m) => bc.postMessage({ from: me, m }) };
  bc.onmessage = (e) => {
    const { from, m, ctl } = e.data;
    if (from === me) return;
    if (ctl === 'knock') { bc.postMessage({ from: me, ctl: 'ack' }); }
    if (ctl === 'knock' || ctl === 'ack') { if (room.status !== 'connected') { room.setStatus('connected'); room.emit('peer'); } return; }
    if (m !== undefined) room.emit('message', m);
  };
  room.retry = () => bc.postMessage({ from: me, ctl: 'knock' });
  room.setStatus(isHost ? 'waiting' : 'connecting');
  setTimeout(() => room.retry(), 50);
  return Promise.resolve(room);
}

/* ---------- Sessione di gioco ----------
 * L'host tiene lo stato "vero": applica le azioni di entrambi con un reducer
 * e invia lo stato aggiornato all'ospite. Le immagini (asset) vengono inviate
 * una sola volta e rimangono in memoria sull'altro telefono.
 */
export function createHostSession(room, { game, state, reducer, assets = {}, save }) {
  const s = new Emitter();
  s.room = room; s.isHost = true; s.me = 'host'; s.game = game;
  s.state = state; s.assets = { ...assets };

  let seq = 0;
  // numero crescente anche dopo un ricaricamento: l'ospite scarta stati vecchi
  const broadcast = () => { seq = Math.max(Date.now(), seq + 1); room.send({ t: 'state', s: s.state, q: seq }); };
  s.dispatch = (a, by = 'host') => {
    const next = reducer(s.state, { ...a, by });
    if (next === s.state) return;
    s.state = next;
    save?.(s.state);
    broadcast();
    s.emit('state', s.state);
  };
  s.setAsset = (id, data) => { s.assets[id] = data; room.send({ t: 'asset', id, data }); };

  room.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      room.send({ t: 'welcome', game });
      for (const [id, data] of Object.entries(s.assets)) room.send({ t: 'asset', id, data });
      s.dispatch({ type: 'join', name: m.name || 'Ospite' }, 'guest');
      broadcast();
    } else if (m.t === 'act' && m.a) {
      s.dispatch(m.a, 'guest');
    }
  });
  return s;
}

export function createGuestSession(room, { name }) {
  const s = new Emitter();
  s.room = room; s.isHost = false; s.me = 'guest';
  s.state = null; s.assets = {};
  let lastQ = 0;
  s.dispatch = (a) => room.send({ t: 'act', a });
  const hello = () => room.send({ t: 'hello', name });
  room.on('peer', hello);
  if (room.status === 'connected') hello();
  room.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') { s.game = m.game; s.emit('welcome', m.game); }
    else if (m.t === 'asset') { s.assets[m.id] = m.data; s.emit('asset', m.id, m.data); }
    else if (m.t === 'state') {
      if (m.q && m.q < lastQ) return;
      lastQ = m.q || lastQ;
      s.state = m.s; s.emit('state', s.state);
    }
  });
  return s;
}

// <img> che si aggiorna da solo quando arriva l'asset.
export function bindAssets(session, root) {
  const fill = (id, data) => {
    root.querySelectorAll(`img[data-asset="${CSS.escape(id)}"]`).forEach((img) => { if (img.src !== data) img.src = data; });
  };
  return session.on('asset', fill);
}
