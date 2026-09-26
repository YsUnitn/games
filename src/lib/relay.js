// Canale di riserva quando la connessione diretta tra telefoni non riesce
// (succede spesso su 4G/5G). I messaggi passano da server MQTT pubblici ma sono
// cifrati end-to-end (AES-GCM) con una chiave che sta solo nel link di invito:
// i server vedono solo byte illeggibili, mai foto o testi.
import mqtt from 'mqtt';
import { b64url, unb64url } from './key.js';

const params = new URLSearchParams(location.search);
const BROKERS = params.get('broker')
  ? [params.get('broker')]
  : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const CHUNK = 30000;
const enc = new TextEncoder(), dec = new TextDecoder();

export class Relay {
  constructor(roomId, key, me) {
    this.roomId = roomId; this.me = me; this.other = me === 'host' ? 'guest' : 'host';
    this.keyStr = key;
    this.clients = [];
    this.listeners = {};
    this.parts = new Map();
    this.seen = new Set();
    this.lastSeen = 0;
    this.up = false;
    this.closed = false;
  }
  on(ev, cb) { (this.listeners[ev] ||= []).push(cb); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((cb) => { try { cb(...a); } catch (e) { console.error(e); } }); }

  async start() {
    this.key = await crypto.subtle.importKey('raw', unb64url(this.keyStr), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const topicIn = `gdc1/${this.roomId}/${this.me}`;
    for (const url of BROKERS) {
      let c;
      try {
        c = mqtt.connect(url, { clientId: 'gdc_' + Math.random().toString(36).slice(2, 12), clean: true, reconnectPeriod: 3000, connectTimeout: 10000, keepalive: 30 });
      } catch (e) { console.warn('relay', url, e); continue; }
      c.on('connect', () => {
        c.subscribe(topicIn, { qos: 1 }, () => this.control('knock'));
      });
      c.on('message', (_t, payload) => this.receive(payload));
      c.on('error', (e) => console.warn('relay', url, e?.message));
      this.clients.push(c);
    }
    // battito: tiene viva la presenza e rileva quando l'altro sparisce
    this.timer = setInterval(() => {
      if (this.clients.some((c) => c.connected)) this.control('ping');
      this.setUp(Date.now() - this.lastSeen < 25000);
    }, 8000);
  }

  setUp(v) { if (v !== this.up) { this.up = v; this.emit(v ? 'up' : 'down'); } }
  get brokerConnected() { return this.clients.some((c) => c.connected); }

  control(kind) { this.send({ _r: kind }); }

  async send(obj) {
    if (this.closed) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(JSON.stringify(obj))));
    const data = new Uint8Array(iv.length + ct.length);
    data.set(iv); data.set(ct, iv.length);
    const id = crypto.getRandomValues(new Uint8Array(8));
    const n = Math.max(1, Math.ceil(data.length / CHUNK));
    const topic = `gdc1/${this.roomId}/${this.other}`;
    for (let i = 0; i < n; i++) {
      const piece = data.subarray(i * CHUNK, (i + 1) * CHUNK);
      const frame = new Uint8Array(12 + piece.length);
      frame.set(id); frame[8] = i >> 8; frame[9] = i & 255; frame[10] = n >> 8; frame[11] = n & 255;
      frame.set(piece, 12);
      for (const c of this.clients) if (c.connected) c.publish(topic, frame, { qos: 1 });
    }
  }

  async receive(payload) {
    const f = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (f.length < 13) return;
    const id = b64url(f.subarray(0, 8));
    if (this.seen.has(id)) return; // già ricevuto (arriva da più server)
    const i = (f[8] << 8) | f[9], n = (f[10] << 8) | f[11];
    let p = this.parts.get(id);
    if (!p) { p = { n, got: new Map(), t: Date.now() }; this.parts.set(id, p); }
    p.got.set(i, f.slice(12));
    if (p.got.size < p.n) return;
    this.parts.delete(id);
    this.seen.add(id);
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    const len = [...p.got.values()].reduce((a, b) => a + b.length, 0);
    const data = new Uint8Array(len);
    let o = 0;
    for (let k = 0; k < p.n; k++) { const b = p.got.get(k); data.set(b, o); o += b.length; }
    let obj;
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, this.key, data.subarray(12));
      obj = JSON.parse(dec.decode(pt));
    } catch { return; } // non cifrato con la nostra chiave: ignora
    this.lastSeen = Date.now();
    if (obj && obj._r) {
      if (obj._r === 'knock') this.control('ping');
      this.setUp(true);
      return;
    }
    this.setUp(true);
    this.emit('message', obj);
    // pulizia pezzi incompleti vecchi
    for (const [k, v] of this.parts) if (Date.now() - v.t > 120000) this.parts.delete(k);
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const c of this.clients) { try { c.end(true); } catch {} }
  }
}
