import 'leaflet/dist/leaflet.css';
import './styles.css';
import { h, mount } from './lib/ui.js';
import { persist } from './lib/db.js';
import { homeView } from './views/home.js';
import { boardsView, boardEditView } from './views/boards.js';
import { guessWhoSetup } from './views/guesswho.js';
import { geoView, geoPackView, geoLocalView } from './views/geo.js';
import { quizSetup } from './views/quiz.js';
import { memoryView } from './views/memory.js';
import { joinView, playView } from './views/play.js';
import { settingsView } from './views/settings.js';

const routes = [
  [/^$/, homeView],
  [/^boards$/, boardsView],
  [/^boards\/([\w-]+)$/, boardEditView],
  [/^guesswho$/, guessWhoSetup],
  [/^geo$/, geoView],
  [/^geo\/pack\/([\w-]+)$/, geoPackView],
  [/^geo\/local\/([\w-]+)$/, geoLocalView],
  [/^quiz$/, quizSetup],
  [/^memory$/, memoryView],
  [/^play\/(\w+)\/([\w-]+)$/, playView],
  [/^join\/([\w.-]+)$/, joinView],
  [/^settings$/, settingsView],
];

const app = document.getElementById('app');
let cleanup = null;

async function render() {
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  const path = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  const root = h('main', { class: 'view' });
  mount(app, root);
  window.scrollTo(0, 0);
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      try { cleanup = (await view(root, ...m.slice(1))) || null; }
      catch (e) { console.error(e); mount(root, h('div', { class: 'card' }, h('h2', {}, 'Ops 😅'), h('p', {}, String(e?.message || e)), h('a', { class: 'btn', href: '#/' }, 'Home'))); }
      return;
    }
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', render);
render();
persist();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
