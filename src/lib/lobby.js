import QRCode from 'qrcode';
import { h, toast, modal } from './ui.js';

const LABELS = {
  connecting: ['⏳', 'Connessione…'],
  waiting: ['🟡', 'In attesa'],
  connected: ['🟢', 'Connessi'],
  disconnected: ['🔴', 'Disconnessi'],
  failed: ['🔴', 'Non raggiungibile'],
};

export function statusPill(room) {
  const el = h('button', { class: 'pill', type: 'button' });
  const upd = () => {
    const [i, t] = LABELS[room.status] || ['⏳', room.status];
    el.textContent = `${i} ${t}`;
    el.dataset.s = room.status;
  };
  el.onclick = () => {
    if (room.isHost) invite(room);
    else if (room.status !== 'connected') { room.retry?.(); toast('Riprovo a connettermi…'); }
  };
  upd();
  room.on('status', upd);
  return el;
}

export async function shareLink(link, text = 'Giochiamo? 💘') {
  if (navigator.share) {
    try { await navigator.share({ title: 'Giochi di coppia', text, url: link }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  copy(link);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copiato ✅'); }
  catch {
    const ta = h('textarea', { value: text });
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Link copiato ✅'); } catch { toast('Copia il link a mano'); }
    ta.remove();
  }
}

export function invitePanel(room, { compact = false } = {}) {
  const link = room.link;
  const img = h('img', { class: 'qr', alt: 'QR code' });
  QRCode.toDataURL(link, { margin: 1, width: 360 }).then((u) => { img.src = u; }).catch(() => img.remove());
  return h('div', { class: 'card invite' },
    h('h3', {}, '💌 Invita il tuo partner'),
    h('p', { class: 'muted small' }, 'Manda questo link: la partita si apre direttamente sul suo telefono.'),
    h('div', { class: 'linkbox' }, link),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onclick: () => shareLink(link) }, '📤 Condividi'),
      h('button', { class: 'btn grow', onclick: () => copy(link) }, '📋 Copia'),
    ),
    compact ? null : h('details', {}, h('summary', {}, 'Mostra QR code'), img),
  );
}

export function invite(room) {
  modal(invitePanel(room, { compact: false }));
}
