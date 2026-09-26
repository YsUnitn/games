import { h, mount, header, toast, promptDialog } from '../lib/ui.js';
import { hostRoom, joinRoom, createHostSession, createGuestSession } from '../lib/net.js';
import { newKey } from '../lib/key.js';
import { getSettings, setSettings } from '../lib/db.js';
import { statusPill, invite } from '../lib/lobby.js';
import { guessWho } from './guesswho.js';
import { geoGame } from './geo.js';
import { quizGame } from './quiz.js';

export const GAMES = { guesswho: guessWho, geo: geoGame, quiz: quizGame };

/* Partite ospitate: salvate in locale così sopravvivono a un ricaricamento. */
const key = (id) => 'gc-room-' + id;
export function saveRoom(id, game, state) {
  try {
    const prev = loadRoom(id);
    localStorage.setItem(key(id), JSON.stringify({ game, state, key: prev?.key || newKey(), t: Date.now() }));
    const idx = listRooms().filter((r) => r.id !== id);
    idx.unshift({ id, game, t: Date.now() });
    localStorage.setItem('gc-rooms', JSON.stringify(idx.slice(0, 10)));
  } catch (e) { console.warn(e); }
}
export function loadRoom(id) {
  try { return JSON.parse(localStorage.getItem(key(id))); } catch { return null; }
}
export function listRooms() {
  try {
    const week = Date.now() - 7 * 864e5;
    return (JSON.parse(localStorage.getItem('gc-rooms') || '[]')).filter((r) => r.t > week && localStorage.getItem(key(r.id)));
  } catch { return []; }
}
export function forgetRoom(id) {
  try {
    localStorage.removeItem(key(id));
    localStorage.setItem('gc-rooms', JSON.stringify(listRooms().filter((r) => r.id !== id)));
  } catch {}
}

export async function ensureName() {
  let { name } = getSettings();
  while (!name) {
    name = await promptDialog('Come ti chiami? (lo vedrà il tuo partner)', '', { placeholder: 'Il tuo nome' });
    if (name === null) return null;
    if (name) setSettings({ name });
  }
  return name;
}

// Guscio comune a tutte le partite online: barra in alto + corpo.
export function gameShell(root, session, title) {
  const right = h('div', { class: 'row tight' },
    statusPill(session.room),
    session.isHost ? h('button', { class: 'icon-btn', title: 'Invita', onclick: () => invite(session.room) }, '💌') : null,
  );
  const body = h('div', { class: 'game-body' });
  mount(root, header(title, { back: '#/', right }), body);
  return body;
}

export async function playView(root, gameId, roomId) {
  const game = GAMES[gameId];
  let saved = loadRoom(roomId);
  if (saved && !saved.key) { saveRoom(roomId, saved.game, saved.state); saved = loadRoom(roomId); }
  if (!game || !saved) {
    mount(root, header('Partita'), h('div', { class: 'card' }, h('p', {}, 'Partita non trovata su questo telefono.'), h('a', { class: 'btn', href: '#/' }, 'Torna alla home')));
    return;
  }
  mount(root, header(game.title), h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Preparo la stanza…')));
  let room;
  try { room = await hostRoom(roomId, saved.key); }
  catch (e) {
    mount(root, header(game.title), h('div', { class: 'card' },
      h('h3', {}, 'Impossibile creare la stanza'),
      h('p', { class: 'muted' }, 'Controlla la connessione a internet e riprova. (' + (e?.type || e?.message || e) + ')'),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Riprova')));
    return;
  }
  const assets = await game.restoreAssets(saved.state);
  const session = createHostSession(room, {
    game: gameId, state: saved.state, reducer: game.reducer, assets,
    save: (st) => saveRoom(roomId, gameId, st),
  });
  session.roomId = roomId;
  const stop = game.render(session, root);
  return () => { stop?.(); room.close(); };
}

export async function joinView(root, hostId) {
  const name = await ensureName();
  if (!name) { location.hash = '#/'; return; }
  const status = h('p', { class: 'muted' }, 'Mi collego al telefono del tuo partner…');
  const retry = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => { room.retry(); } }, '🔄 Riprova');
  mount(root, header('Unisciti'), h('div', { class: 'center-msg' },
    h('div', { class: 'spinner' }), status, retry,
    h('p', { class: 'muted small' }, 'Il tuo partner deve tenere la partita aperta sul suo telefono.')));
  const room = await joinRoom(hostId);
  room.on('status', (s) => {
    if (s === 'failed') { status.textContent = 'Non trovo la partita. Chi l’ha creata deve tenere l’app aperta in primo piano (non chiuderla per mandarti il link). Continuo a riprovare…'; retry.style.display = ''; }
    if (s === 'connecting') status.textContent = 'Mi collego…';
  });
  const session = createGuestSession(room, { name });
  let stop;
  session.on('welcome', (g) => {
    if (stop) return; // già in gioco (riconnessione)
    const game = GAMES[g];
    if (!game) { toast('Gioco sconosciuto: ' + g); return; }
    stop = game.render(session, root) || (() => {});
  });
  return () => { stop?.(); room.close(); };
}
