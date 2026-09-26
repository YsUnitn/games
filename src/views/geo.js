import exifr from 'exifr';
import { h, mount, header, toast, pickFiles, uid, confirmDialog, modal, shuffle, downloadFile } from '../lib/ui.js';
import { db, getSettings } from '../lib/db.js';
import { fitImage } from '../lib/image.js';
import { createMap, pin, L, distanceKm, score, fmtKm, showResult, SCALES, searchPlace } from '../lib/map.js';
import { bindAssets } from '../lib/net.js';
import { invitePanel } from '../lib/lobby.js';
import { saveRoom, gameShell, ensureName } from './play.js';
import { confetti } from './guesswho.js';
import { importJSONFile } from './settings.js';

const ready = (p) => p.places.filter((x) => x.lat != null);

/* ---------- Elenco pacchetti ---------- */
export async function geoView(root) {
  const packs = await db.all('geopacks');
  mount(root, header('GeoGuesser'),
    h('div', { class: 'card' }, h('p', {}, 'Crea un pacchetto di foto con la loro posizione (se la foto ha il GPS la prendo da sola). Poi fai indovinare al tuo partner dove sono state scattate: online col link, oppure passandole il telefono.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onclick: async () => { const p = { id: uid(), name: 'Nuovo pacchetto', scale: 'world', places: [] }; await db.put('geopacks', p); location.hash = '#/geo/pack/' + p.id; } }, '➕ Nuovo pacchetto'),
      h('button', { class: 'btn', onclick: async () => { const d = await importJSONFile(); if (!d) return; for (const p of d.geopacks || (d.places ? [d] : [])) await db.put('geopacks', p); geoView(root); } }, '⬆️'),
    ),
    h('div', { class: 'list' }, packs.map((p) => {
      const n = ready(p).length;
      return h('div', { class: 'card pack' },
        h('div', { class: 'row' },
          h('div', { class: 'mini-grid' }, p.places.slice(0, 4).map((x) => h('img', { src: x.img, alt: '' }))),
          h('div', { class: 'grow' }, h('strong', {}, p.name), h('div', { class: 'muted small' }, `${n} foto pronte · ${SCALES[p.scale]?.label || ''}`)),
        ),
        h('div', { class: 'row' },
          h('a', { class: 'btn grow', href: '#/geo/pack/' + p.id }, '✏️ Modifica'),
          h('button', { class: 'btn grow', disabled: !n, onclick: () => chooseRounds(p, (r) => { sessionStorage.setItem('geo-rounds', r); location.hash = '#/geo/local/' + p.id; }) }, '📱 Qui'),
          h('button', { class: 'btn primary grow', disabled: !n, onclick: () => chooseRounds(p, (r) => hostGeo(p, r)) }, '🌐 Online'),
        ),
      );
    })),
  );
}

function chooseRounds(p, cb) {
  const n = ready(p).length;
  const opts = [...new Set([5, 10, n].filter((x) => x <= n))];
  const m = modal(h('div', { class: 'stack' }, h('h3', {}, 'Quante foto?'),
    opts.map((x) => h('button', { class: 'btn', onclick: () => { m.close(); cb(x); } }, x === n ? `Tutte (${n})` : `${x}`))));
}

async function hostGeo(p, rounds) {
  const name = await ensureName(); if (!name) return;
  const order = shuffle(ready(p)).slice(0, rounds);
  const state = {
    phase: 'lobby', packId: p.id, packName: p.name, scale: p.scale,
    rounds: order.map((x) => ({ pid: x.id, lat: x.lat, lng: x.lng, label: x.label || '' })),
    idx: 0, guesses: [], revealed: false, names: { host: name, guest: null },
  };
  const id = 'gdc-' + uid(8);
  saveRoom(id, 'geo', state);
  location.hash = `#/play/geo/${id}`;
}

/* ---------- Editor pacchetto ---------- */
export async function geoPackView(root, id) {
  const pack = await db.get('geopacks', id);
  if (!pack) { location.hash = '#/geo'; return; }
  const save = () => db.put('geopacks', pack);
  const nameIn = h('input', { class: 'input title-input', value: pack.name, oninput: () => { pack.name = nameIn.value; save(); } });
  const scaleSel = h('select', { class: 'input', onchange: () => { pack.scale = scaleSel.value; save(); } },
    Object.entries(SCALES).map(([k, v]) => h('option', { value: k, selected: pack.scale === k }, v.label)));
  const list = h('div', { class: 'list' });
  const progress = h('div', { class: 'muted small' });

  const draw = () => list.replaceChildren(...pack.places.map((pl) => h('div', { class: 'place' },
    h('img', { src: pl.img, alt: '', onclick: () => viewPhoto(pl.img) }),
    h('div', { class: 'grow stack tight' },
      h('input', { class: 'input small', value: pl.label || '', placeholder: 'Descrizione (mostrata dopo)', oninput: (e) => { pl.label = e.target.value; save(); } }),
      h('button', { class: 'btn small ' + (pl.lat == null ? 'warn' : ''), onclick: async () => {
        const pos = await pickLocation(pl);
        if (pos) { pl.lat = pos.lat; pl.lng = pos.lng; await save(); draw(); }
      } }, pl.lat == null ? '⚠️ Imposta posizione' : `📍 ${pl.lat.toFixed(3)}, ${pl.lng.toFixed(3)}`),
    ),
    h('button', { class: 'del static', onclick: async () => { if (await confirmDialog('Eliminare questa foto?', { danger: true, ok: 'Elimina' })) { pack.places = pack.places.filter((x) => x !== pl); save(); draw(); } } }, '✕'),
  )));

  const add = async () => {
    const files = await pickFiles();
    let i = 0, noGps = 0;
    for (const f of files) {
      progress.textContent = `Elaboro foto ${++i}/${files.length}…`;
      let gps = null;
      try { gps = await exifr.gps(f); } catch {}
      try {
        const img = await fitImage(f);
        const ok = gps && isFinite(gps.latitude) && isFinite(gps.longitude);
        if (!ok) noGps++;
        pack.places.push({ id: uid(6), img, lat: ok ? gps.latitude : null, lng: ok ? gps.longitude : null, label: '' });
      } catch { toast('Impossibile leggere ' + f.name); }
    }
    progress.textContent = '';
    await save(); draw();
    if (noGps) toast(`${noGps} foto senza GPS: imposta la posizione a mano 📍`, 4000);
  };

  mount(root, header('Pacchetto foto', { back: '#/geo', right: h('button', { class: 'icon-btn', onclick: () => {
    const m = modal(h('div', { class: 'stack' },
      h('button', { class: 'btn', onclick: () => { m.close(); downloadFile(`geo-${pack.name.replace(/\W+/g, '_')}.json`, JSON.stringify(pack)); } }, '⬇️ Esporta file'),
      h('button', { class: 'btn danger', onclick: async () => { m.close(); if (await confirmDialog(`Eliminare "${pack.name}"?`, { danger: true, ok: 'Elimina' })) { await db.del('geopacks', pack.id); location.hash = '#/geo'; } } }, '🗑️ Elimina pacchetto'),
    ));
  } }, '⋯') }),
    nameIn,
    h('label', { class: 'label' }, 'Area di gioco (quanto è severo il punteggio)'), scaleSel,
    h('p', { class: 'muted small' }, '💡 Per mantenere il GPS, scegli le foto dalla galleria/File (su iPhone: “Opzioni → Tutti i dati della foto” se disponibile). Se manca, imposti tu il punto sulla mappa.'),
    progress,
    list,
    h('div', { class: 'sticky-bottom row' }, h('button', { class: 'btn primary grow', onclick: add }, '📷 Aggiungi foto')),
  );
  draw();
}

function viewPhoto(src) {
  modal(h('div', { class: 'photo-full' }, h('img', { src, alt: '' })), { full: true });
}

function pickLocation(pl) {
  return new Promise((resolve) => {
    let marker, pos = pl.lat != null ? { lat: pl.lat, lng: pl.lng } : null, m;
    const mapEl = h('div', { class: 'map picker-map' });
    const q = h('input', { class: 'input', placeholder: 'Cerca un luogo (es. Colosseo)…', enterkeyhint: 'search' });
    const results = h('div', { class: 'search-results' });
    const set = (ll, map, zoom) => {
      pos = { lat: ll.lat, lng: ll.lng };
      if (marker) marker.setLatLng(ll); else marker = L.marker(ll, { icon: pin('🚩', 'truth') }).addTo(map);
      if (zoom) map.setView(ll, zoom);
    };
    const content = h('div', { class: 'picker' },
      h('form', { class: 'row', onsubmit: async (e) => {
        e.preventDefault();
        results.textContent = 'Cerco…';
        try {
          const r = await searchPlace(q.value);
          results.replaceChildren(...(r.length ? r : [{ name: 'Nessun risultato' }]).map((x) => h('button', { class: 'result', type: 'button', onclick: () => { if (x.lat != null) { set(x, map, 15); results.replaceChildren(); } } }, x.name)));
        } catch { results.textContent = 'Ricerca non disponibile, tocca la mappa'; }
      } }, q, h('button', { class: 'btn' }, '🔎')),
      results,
      mapEl,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); } }, 'Annulla'),
        h('button', { class: 'btn primary grow', onclick: () => { if (!pos) return toast('Tocca la mappa per mettere il punto'); const p = pos; resolve(p); pos = null; m.close(); } }, '✅ Conferma posizione'),
      ),
    );
    let map;
    m = modal(content, { full: true, onClose: () => { resolve(null); map?.remove(); } });
    map = createMap(mapEl, { center: pos ? [pos.lat, pos.lng] : [42.5, 12.5], zoom: pos ? 13 : 5, onClick: (ll) => set(ll, map) });
    if (pos) set(pos, map);
  });
}

/* ---------- Schermata di gioco condivisa ---------- */
// Foto + mappa per indovinare. onGuess({lat,lng})
function guessPane({ img, scale, onGuess, waitingText }) {
  let guess = null, marker;
  const photo = h('div', { class: 'geo-photo', onclick: () => img() && viewPhoto(img()) }, h('img', { src: img() || '', alt: '' }), h('span', { class: 'zoom-hint' }, '🔍'));
  const mapEl = h('div', { class: 'map geo-map' });
  const btn = h('button', { class: 'btn primary big', disabled: true, onclick: () => { if (guess) { btn.disabled = true; onGuess(guess); } } }, '📍 Tocca la mappa');
  const el = h('div', { class: 'geo-play' }, photo, mapEl, h('div', { class: 'geo-bar' }, btn));
  requestAnimationFrame(() => {
    if (!mapEl.isConnected) return;
    const map = createMap(mapEl, { zoom: SCALES[scale]?.zoom > 4 ? 4 : 2, center: [42.5, 12.5], onClick: (ll) => {
      guess = { lat: ll.lat, lng: ((ll.lng + 540) % 360) - 180 };
      if (marker) marker.setLatLng(ll); else marker = L.marker(ll, { icon: pin('📍') }).addTo(map);
      btn.disabled = false; btn.textContent = '✅ Conferma';
    } });
    el._map = map;
  });
  el.cleanup = () => el._map?.remove();
  return el;
}

function resultPane({ img, truth, guess, pts, d, label, footer }) {
  const mapEl = h('div', { class: 'map geo-map' });
  const el = h('div', { class: 'geo-play' },
    h('div', { class: 'geo-photo small', onclick: () => viewPhoto(img) }, h('img', { src: img || '', alt: '' })),
    mapEl,
    h('div', { class: 'geo-bar stack' },
      guess ? h('div', { class: 'result-line' }, h('strong', {}, `${pts.toLocaleString('it-IT')} punti`), h('span', {}, ` · a ${fmtKm(d)}`)) : h('div', { class: 'result-line' }, 'Nessun tentativo'),
      label ? h('div', { class: 'muted' }, '📝 ' + label) : null,
      h('div', { class: 'score-meter' }, h('span', { style: { width: (pts / 50) + '%' } })),
      footer,
    ),
  );
  requestAnimationFrame(() => { if (!mapEl.isConnected) return; const map = createMap(mapEl); showResult(map, truth, guess); el._map = map; });
  el.cleanup = () => el._map?.remove();
  return el;
}

function summary(rounds, guesses, imgOf, scale) {
  const total = guesses.reduce((a, g) => a + (g?.pts || 0), 0);
  const max = rounds.length * 5000;
  return h('div', { class: 'stack' },
    h('div', { class: 'card center result win' },
      h('div', { class: 'big-emoji' }, total > max * 0.7 ? '🏆' : total > max * 0.4 ? '🥈' : '🧭'),
      h('h2', {}, `${total.toLocaleString('it-IT')} / ${max.toLocaleString('it-IT')}`),
      h('p', { class: 'muted' }, total > max * 0.7 ? 'Una vera esploratrice/esploratore!' : total > max * 0.4 ? 'Niente male!' : 'Serve un altro viaggio insieme 😄'),
    ),
    h('div', { class: 'list' }, rounds.map((r, i) => h('div', { class: 'place' },
      h('img', { src: imgOf(r.pid) || '', alt: '', 'data-asset': r.pid }),
      h('div', { class: 'grow' }, h('strong', {}, `${(guesses[i]?.pts || 0).toLocaleString('it-IT')} pt`), h('div', { class: 'muted small' }, guesses[i] ? `a ${fmtKm(guesses[i].d)}` : '—'), r.label ? h('div', { class: 'small' }, r.label) : null),
    ))),
  );
}

/* ---------- Partita sullo stesso telefono ---------- */
export async function geoLocalView(root, id) {
  const pack = await db.get('geopacks', id);
  if (!pack) { location.hash = '#/geo'; return; }
  const n = +sessionStorage.getItem('geo-rounds') || 5;
  const rounds = shuffle(ready(pack)).slice(0, n).map((x) => ({ pid: x.id, lat: x.lat, lng: x.lng, label: x.label, img: x.img }));
  const guesses = [];
  let idx = 0, pane;
  const body = h('div', { class: 'game-body' });
  const title = h('span', {});
  mount(root, header('GeoGuesser', { back: '#/geo', right: title }), body);

  const next = () => {
    pane?.cleanup?.();
    if (idx >= rounds.length) {
      title.textContent = '';
      confetti();
      mount(body, summary(rounds, guesses, (pid) => rounds.find((r) => r.pid === pid)?.img, pack.scale),
        h('div', { class: 'row' }, h('a', { class: 'btn grow', href: '#/geo' }, 'Fine'), h('button', { class: 'btn primary grow', onclick: () => geoLocalView(root, id) }, '🔁 Rigioca')));
      return;
    }
    const r = rounds[idx];
    title.textContent = `${idx + 1}/${rounds.length}`;
    pane = guessPane({ img: () => r.img, scale: pack.scale, onGuess: (g) => {
      const d = distanceKm(r, g), pts = score(d, pack.scale);
      guesses[idx] = { ...g, d, pts };
      pane.cleanup();
      pane = resultPane({ img: r.img, truth: r, guess: g, d, pts, label: r.label,
        footer: h('button', { class: 'btn primary big', onclick: () => { idx++; next(); } }, idx + 1 < rounds.length ? 'Prossima foto ➡️' : 'Vedi risultato 🏁') });
      mount(body, pane);
    } });
    mount(body, pane);
  };
  next();
  return () => pane?.cleanup?.();
}

/* ---------- Partita online ---------- */
function reducer(s, a) {
  switch (a.type) {
    case 'join': return { ...s, names: { ...s.names, guest: a.name }, phase: s.phase === 'lobby' ? 'play' : s.phase };
    case 'guess': {
      if (a.by !== 'guest' || s.phase !== 'play' || s.revealed || a.idx !== s.idx) return s;
      const r = s.rounds[s.idx];
      const g = { lat: +a.lat, lng: +a.lng };
      const d = distanceKm(r, g);
      const guesses = [...s.guesses]; guesses[s.idx] = { ...g, d, pts: score(d, s.scale) };
      return { ...s, guesses, revealed: true };
    }
    case 'next':
      if (a.by !== 'host' || s.phase !== 'play') return s;
      if (!s.revealed && a.skip !== true) return s;
      if (s.idx + 1 >= s.rounds.length) return { ...s, phase: 'over', revealed: true };
      return { ...s, idx: s.idx + 1, revealed: false };
    case 'restart':
      if (a.by !== 'host') return s;
      return { ...s, phase: 'play', rounds: shuffle(s.rounds), idx: 0, guesses: [], revealed: false };
    default: return s;
  }
}

async function restoreAssets(state) {
  const p = await db.get('geopacks', state.packId);
  const out = {};
  for (const r of state.rounds) { const x = p?.places.find((pl) => pl.id === r.pid); if (x) out[r.pid] = x.img; }
  return out;
}

function render(session, root) {
  const me = session.me;
  const body = gameShell(root, session, 'GeoGuesser');
  const unbind = bindAssets(session, root);
  let key = '', pane;

  const draw = () => {
    const s = session.state;
    if (!s) { mount(body, h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Ricevo la partita…'))); return; }
    const k = JSON.stringify([s.phase, s.idx, s.revealed, !!session.assets[s.rounds[s.idx]?.pid], s.names.guest]);
    if (k === key) return;
    key = k;
    pane?.cleanup?.(); pane = null;
    const r = s.rounds[s.idx];
    const counter = h('div', { class: 'scorebar' }, h('span', {}, `📷 ${Math.min(s.idx + 1, s.rounds.length)}/${s.rounds.length}`), h('span', {}, s.packName), h('span', {}, `⭐ ${s.guesses.reduce((a, g) => a + (g?.pts || 0), 0).toLocaleString('it-IT')}`));

    if (s.phase === 'lobby') {
      mount(body, h('div', { class: 'card center' }, h('h2', {}, s.packName), h('p', { class: 'muted' }, `${s.rounds.length} foto da indovinare`)), invitePanel(session.room));
      return;
    }
    if (s.phase === 'over') {
      if (me === 'guest') confetti();
      mount(body, summary(s.rounds, s.guesses, (pid) => session.assets[pid], s.scale),
        session.isHost ? h('button', { class: 'btn primary big', onclick: () => session.dispatch({ type: 'restart' }) }, '🔁 Rigioca') : h('p', { class: 'muted center' }, 'Grazie per aver giocato 💘'));
      return;
    }
    const img = session.assets[r.pid];
    const g = s.guesses[s.idx];

    if (s.revealed) {
      pane = resultPane({ img, truth: r, guess: g, d: g?.d, pts: g?.pts || 0, label: r.label,
        footer: session.isHost
          ? h('button', { class: 'btn primary big', onclick: () => session.dispatch({ type: 'next' }) }, s.idx + 1 < s.rounds.length ? 'Prossima foto ➡️' : 'Vedi risultato 🏁')
          : h('p', { class: 'muted center' }, `⏳ ${s.names.host} sta per mostrarti la prossima foto…`) });
      mount(body, counter, pane);
      return;
    }

    if (session.isHost) {
      // chi ospita vede la soluzione e aspetta il tentativo
      const mapEl = h('div', { class: 'map geo-map' });
      pane = h('div', { class: 'geo-play' },
        h('div', { class: 'geo-photo small', onclick: () => viewPhoto(img) }, h('img', { src: img, alt: '' })),
        mapEl,
        h('div', { class: 'geo-bar stack' },
          h('p', { class: 'center' }, `⏳ ${s.names.guest} sta cercando sulla mappa…`),
          h('button', { class: 'btn ghost small', onclick: () => session.dispatch({ type: 'next', skip: true }) }, 'Salta questa foto'),
        ));
      const p = pane;
      requestAnimationFrame(() => { if (!mapEl.isConnected) return; const map = createMap(mapEl); showResult(map, r, null); p._map = map; });
      pane.cleanup = () => p._map?.remove();
      mount(body, counter, pane);
      return;
    }

    if (!img) { mount(body, counter, h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Ricevo la foto…'))); return; }
    const idx = s.idx;
    pane = guessPane({ img: () => session.assets[r.pid], scale: s.scale, onGuess: (gg) => session.dispatch({ type: 'guess', idx, lat: gg.lat, lng: gg.lng }) });
    mount(body, counter, pane);
  };

  const off1 = session.on('state', draw);
  const off2 = session.on('asset', draw);
  draw();
  return () => { off1(); off2(); unbind(); pane?.cleanup?.(); };
}

export const geoGame = { id: 'geo', title: 'GeoGuesser', reducer, restoreAssets, render };
