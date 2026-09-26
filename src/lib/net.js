// Connessione diretta tra i due telefoni (WebRTC via PeerJS).
// Il server di PeerJS serve solo a "presentare" i due dispositivi:
// foto e messaggi viaggiano direttamente (cifrati) da telefono a telefono.
import { Peer } from 'peerjs';
import { getSettings } from './db.js';
import { uid } from './ui.js';

const LOCAL = new URLSearchParams(location.search).has('local'); // test: due schede sullo stesso browser

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
    this.closed = false;
  }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status', s); } }
  get link() {
    const base = location.origin + location.pathname + (LOCAL ? '?local' : '');
    return `${base}#/join/${this.id}`;
  }
}

/* ---------- PeerJS ---------- */

function newPeer(id) {
  return new Peer(id, { config: { iceServers: iceServers() }, debug: 1 });
}

export function hostRoom(id = 'gdc-' + uid(8)) {
  if (LOCAL) return localRoom(id, true);
  const room = new Room(true);
  room.id = id;
  let attempts = 0;

  const start = () => new Promise((resolve, reject) => {
    const peer = newPeer(id);
    room.peer = peer;
    peer.on('open', () => { room.setStatus('waiting'); resolve(room); });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (room.conn && room.conn !== conn) { try { room.conn.close(); } catch {} }
        room.conn = conn;
        room.setStatus('connected');
        room.emit('peer');
      });
      conn.on('data', (d) => { if (conn === room.conn) room.emit('message', d); });
      conn.on('close', () => { if (conn === room.conn) { room.conn = null; room.setStatus('waiting'); } });
      conn.on('error', (e) => console.warn('conn', e));
    });
    peer.on('disconnected', () => { if (!room.closed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
    peer.on('error', (e) => {
      console.warn('peer', e.type, e);
      if (e.type === 'unavailable-id' && attempts++ < 8) {
        // l'ID è ancora "occupato" (es. pagina ricaricata): riprova tra poco
        peer.destroy();
        setTimeout(() => start().then(resolve, reject), 2500);
      } else if (room.status === 'connecting') {
        reject(e);
      }
    });
  });

  return start();
}

export function joinRoom(hostId) {
  if (LOCAL) return localRoom(hostId, false);
  const room = new Room(false);
  room.id = hostId;
  let peer;

  const connect = () => {
    if (room.closed) return;
    const conn = peer.connect(hostId, { reliable: true });
    room.conn = conn;
    const timer = setTimeout(() => { if (room.status !== 'connected') { room.setStatus('failed'); } }, 20000);
    conn.on('open', () => { clearTimeout(timer); room.setStatus('connected'); room.emit('peer'); });
    conn.on('data', (d) => { if (conn === room.conn) room.emit('message', d); });
    conn.on('close', () => {
      if (conn !== room.conn || room.closed) return;
      room.setStatus('disconnected');
      setTimeout(() => { if (room.status === 'disconnected') room.retry(); }, 3000);
    });
  };

  room.retry = () => {
    if (room.closed) return;
    room.setStatus('connecting');
    if (!peer || peer.destroyed) return init();
    if (peer.disconnected) peer.reconnect();
    connect();
  };

  const init = () => {
    peer = newPeer();
    room.peer = peer;
    peer.on('open', connect);
    peer.on('disconnected', () => { if (!room.closed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
    peer.on('error', (e) => {
      console.warn('peer', e.type, e);
      if (e.type === 'peer-unavailable') {
        room.setStatus('failed');
        setTimeout(() => { if (room.status === 'failed') room.retry(); }, 4000);
      }
    });
  };
  init();
  return Promise.resolve(room);
}

Room.prototype.send = function (msg) {
  if (this.local) return this.local.post(msg);
  if (this.conn?.open) this.conn.send(msg);
};
Room.prototype.close = function () {
  this.closed = true;
  try { this.conn?.close(); } catch {}
  try { this.peer?.destroy(); } catch {}
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

  const broadcast = () => room.send({ t: 'state', s: s.state });
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
  s.dispatch = (a) => room.send({ t: 'act', a });
  const hello = () => room.send({ t: 'hello', name });
  room.on('peer', hello);
  if (room.status === 'connected') hello();
  room.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') { s.game = m.game; s.emit('welcome', m.game); }
    else if (m.t === 'asset') { s.assets[m.id] = m.data; s.emit('asset', m.id, m.data); }
    else if (m.t === 'state') { s.state = m.s; s.emit('state', s.state); }
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
