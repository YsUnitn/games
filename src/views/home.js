import { h, mount } from '../lib/ui.js';
import { getSettings } from '../lib/db.js';
import { listRooms, forgetRoom, GAMES, ensureName } from './play.js';

const TILES = [
  { href: '#/guesswho', emoji: '🕵️', title: 'Indovina Chi', sub: 'Con i tuoi personaggi · online' },
  { href: '#/geo', emoji: '🌍', title: 'GeoGuesser', sub: 'Le vostre foto sulla mappa' },
  { href: '#/quiz', emoji: '💞', title: 'Quanto mi conosci?', sub: 'Domande di coppia · online' },
  { href: '#/memory', emoji: '🃏', title: 'Memory', sub: 'Con le vostre foto · sullo stesso telefono' },
];

export function homeView(root) {
  const { name } = getSettings();
  const rooms = listRooms();
  mount(root,
    h('header', { class: 'hero' },
      h('div', { class: 'hero-emoji' }, '💘'),
      h('h1', {}, 'Giochi di coppia'),
      h('p', { class: 'muted' }, name ? `Ciao ${name}! A cosa giochiamo?` : 'Solo per voi due. Le foto restano sui vostri telefoni.'),
    ),
    rooms.length ? h('section', { class: 'card' },
      h('h3', {}, '⏯️ Partite in corso'),
      rooms.map((r) => h('div', { class: 'list-item' },
        h('a', { class: 'grow', href: `#/play/${r.game}/${r.id}` }, `${GAMES[r.game]?.title || r.game}`, h('span', { class: 'muted small' }, ' · ' + new Date(r.t).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }))),
        h('button', { class: 'icon-btn', title: 'Elimina', onclick: (e) => { forgetRoom(r.id); e.target.closest('.list-item').remove(); } }, '✕'),
      )),
    ) : null,
    h('nav', { class: 'tiles' }, TILES.map((t) => h('a', { class: 'tile', href: t.href },
      h('span', { class: 'tile-emoji' }, t.emoji),
      h('span', { class: 'tile-title' }, t.title),
      h('span', { class: 'tile-sub' }, t.sub),
    ))),
    h('div', { class: 'row' },
      h('a', { class: 'btn grow', href: '#/boards' }, '🗂️ Le mie tabelle'),
      h('a', { class: 'btn grow', href: '#/settings' }, '⚙️ Impostazioni'),
    ),
    h('p', { class: 'muted small center' }, '🔒 Nessun account, nessun server con le tue foto: tutto resta sul telefono e passa direttamente all’altro giocatore.'),
  );
  if (!name) setTimeout(ensureName, 300);
}
