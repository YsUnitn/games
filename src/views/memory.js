import { h, mount, header, shuffle, vibrate } from '../lib/ui.js';
import { db, getSettings } from '../lib/db.js';
import { boardPreview, createDemoBoard } from './boards.js';
import { confetti } from './guesswho.js';

export async function memoryView(root) {
  const boards = (await db.all('boards')).filter((b) => b.chars.length >= 4);
  if (!boards.length) {
    mount(root, header('Memory'), h('div', { class: 'card center' },
      h('p', {}, 'Serve una tabella con almeno 4 foto.'),
      h('a', { class: 'btn primary', href: '#/boards' }, '🗂️ Crea una tabella'),
      h('button', { class: 'btn', onclick: async () => { await createDemoBoard(); memoryView(root); } }, '✨ Usa tabella demo')));
    return;
  }
  let chosen = boards[0];
  const p1 = h('input', { class: 'input', value: getSettings().name || 'Giocatore 1' });
  const p2 = h('input', { class: 'input', value: '', placeholder: 'Partner (vuoto = gioco da solo/a)' });
  const pairsSel = h('select', { class: 'input' });
  const fillPairs = () => pairsSel.replaceChildren(...[4, 6, 8, 10, 12, 15].filter((n) => n <= chosen.chars.length).map((n) => h('option', { value: n, selected: n === Math.min(8, chosen.chars.length) }, `${n} coppie`)));
  const list = h('div', { class: 'list' });
  const drawList = () => list.replaceChildren(...boards.map((b) => h('button', { class: 'list-card selectable' + (b === chosen ? ' selected' : ''), onclick: () => { chosen = b; drawList(); fillPairs(); } },
    boardPreview(b), h('div', { class: 'grow' }, h('strong', {}, b.name), h('div', { class: 'muted small' }, `${b.chars.length} foto`)), h('span', { class: 'radio' }))));
  drawList(); fillPairs();
  mount(root, header('Memory'),
    h('p', { class: 'muted' }, 'Trova le coppie di foto. Si gioca sullo stesso telefono, passandovelo a turno.'),
    list,
    h('div', { class: 'card stack' }, h('label', { class: 'label' }, 'Giocatori'), p1, p2, h('label', { class: 'label' }, 'Difficoltà'), pairsSel),
    h('div', { class: 'sticky-bottom' }, h('button', { class: 'btn primary big', onclick: () => play(root, chosen, +pairsSel.value, [p1.value.trim() || 'Tu', p2.value.trim()].filter(Boolean)) }, '🃏 Gioca')),
  );
}

function play(root, board, pairs, players) {
  const chars = shuffle(board.chars).slice(0, pairs);
  const deck = shuffle([...chars, ...chars].map((c, i) => ({ key: i, id: c.id, img: c.img, name: c.name })));
  const score = players.map(() => 0);
  let turn = 0, open = [], moves = 0, found = 0, lock = false;
  const t0 = Date.now();
  const status = h('div', { class: 'scorebar' });
  const updStatus = () => status.replaceChildren(...(players.length > 1
    ? players.map((p, i) => h('span', { class: i === turn ? 'active' : '' }, `${i === turn ? '👉 ' : ''}${p}: ${score[i]}`))
    : [h('span', {}, `Mosse: ${moves}`), h('span', {}, `Coppie: ${found}/${pairs}`)]));
  const cols = pairs * 2 <= 12 ? 3 : pairs * 2 <= 20 ? 4 : 5;
  const grid = h('div', { class: 'mem-grid', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } });
  const cards = deck.map((c) => {
    const el = h('button', { class: 'mem-card' }, h('div', { class: 'mem-inner' }, h('div', { class: 'mem-back' }, '💘'), h('div', { class: 'mem-front' }, h('img', { src: c.img, alt: '' }))));
    el.onclick = () => flip(c, el);
    grid.append(el);
    return el;
  });

  function flip(c, el) {
    if (lock || el.classList.contains('open') || el.classList.contains('done')) return;
    el.classList.add('open'); vibrate(10);
    open.push([c, el]);
    if (open.length < 2) return;
    moves++;
    const [[a, ea], [b, eb]] = open;
    open = [];
    if (a.id === b.id) {
      ea.classList.add('done'); eb.classList.add('done');
      score[turn]++; found++;
      vibrate([20, 40, 20]);
      if (found === pairs) return setTimeout(end, 500);
    } else {
      lock = true;
      setTimeout(() => { ea.classList.remove('open'); eb.classList.remove('open'); lock = false; turn = (turn + 1) % players.length; updStatus(); }, 900);
    }
    updStatus();
  }

  function end() {
    confetti();
    const secs = Math.round((Date.now() - t0) / 1000);
    let msg;
    if (players.length > 1) {
      msg = score[0] === score[1] ? 'Pareggio! 🤝' : `Vince ${players[score[0] > score[1] ? 0 : 1]}! 🏆`;
    } else msg = `Completato in ${moves} mosse e ${secs}s 🎉`;
    mount(root, header('Memory', { back: '#/memory' }), h('div', { class: 'card center result win' },
      h('div', { class: 'big-emoji' }, '🃏'), h('h2', {}, msg),
      players.length > 1 ? h('p', {}, players.map((p, i) => `${p}: ${score[i]}`).join(' · ')) : null,
      h('button', { class: 'btn primary', onclick: () => play(root, board, pairs, players) }, '🔁 Rigioca'),
      h('a', { class: 'btn', href: '#/' }, 'Home')));
  }

  updStatus();
  mount(root, header('Memory', { back: '#/memory' }), status, grid);
  void cards;
}
