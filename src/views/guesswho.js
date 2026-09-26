import { h, mount, header, toast, uid, confirmDialog, vibrate, modal } from '../lib/ui.js';
import { db, getSettings } from '../lib/db.js';
import { bindAssets } from '../lib/net.js';
import { invitePanel } from '../lib/lobby.js';
import { boardPreview, createDemoBoard } from './boards.js';
import { saveRoom, gameShell, ensureName } from './play.js';

const other = (p) => (p === 'host' ? 'guest' : 'host');
const QUICK = ['È un uomo?', 'È una donna?', 'Ha gli occhiali?', 'Ha la barba?', 'Ha i capelli lunghi?', 'Ha i capelli scuri?', 'Sorride?', 'Ha un cappello?', 'È un parente?', 'È un animale?'];

/* ---------- Setup ---------- */
export async function guessWhoSetup(root) {
  const boards = (await db.all('boards')).filter((b) => b.chars.length >= 4);
  let chosen = boards[0]?.id;
  const list = h('div', { class: 'list' });
  const drawList = () => list.replaceChildren(...boards.map((b) => h('button', {
    class: 'list-card selectable' + (b.id === chosen ? ' selected' : ''),
    onclick: () => { chosen = b.id; drawList(); },
  }, boardPreview(b), h('div', { class: 'grow' }, h('strong', {}, b.name), h('div', { class: 'muted small' }, `${b.chars.length} personaggi`)), h('span', { class: 'radio' }))));
  drawList();

  let mode = localStorage.getItem('gw-mode') || 'voice';
  const modes = h('div', { class: 'mode-pick' });
  const MODES = {
    voice: ['🗣️', 'Insieme', 'Siete nella stessa stanza e le domande le fate a voce. L’app gestisce solo carte, turni e “Indovina”.'],
    chat: ['🌐', 'A distanza', 'Siete lontani: domande e risposte Sì/No si scrivono nell’app, con chat.'],
  };
  const drawModes = () => modes.replaceChildren(...Object.entries(MODES).map(([k, [e, t, d]]) => h('button', {
    class: 'mode-card' + (mode === k ? ' selected' : ''),
    onclick: () => { mode = k; try { localStorage.setItem('gw-mode', k); } catch {} drawModes(); },
  }, h('span', { class: 'mode-emoji' }, e), h('strong', {}, t), h('span', { class: 'muted small' }, d))));
  drawModes();

  mount(root, header('Indovina Chi'),
    h('div', { class: 'card' },
      h('p', {}, 'Ognuno usa il suo telefono: crea la partita e manda il link al tuo partner. Ognuno sceglie un personaggio segreto e a turno fate domande sì/no per scoprire quello dell’altro.'),
    ),
    modes,
    boards.length ? h('h3', {}, 'Tabella') : null,
    boards.length ? list : h('div', { class: 'card center' },
      h('p', {}, 'Ti serve una tabella con almeno 4 personaggi.'),
      h('a', { class: 'btn primary', href: '#/boards' }, '🗂️ Crea una tabella'),
      h('button', { class: 'btn', onclick: async () => { await createDemoBoard(); guessWhoSetup(root); } }, '✨ Usa tabella demo'),
    ),
    boards.length ? h('div', { class: 'sticky-bottom row' },
      h('a', { class: 'btn', href: '#/boards' }, '🗂️ Tabelle'),
      h('button', { class: 'btn primary grow', onclick: async () => {
        const name = await ensureName(); if (!name) return;
        const b = await db.get('boards', chosen);
        const id = 'gdc-' + uid(8);
        saveRoom(id, 'guesswho', initialState(b, name, mode));
        location.hash = `#/play/guesswho/${id}`;
      } }, '🎮 Crea partita'),
    ) : null,
  );
}

function initialState(board, hostName, mode = 'chat') {
  return {
    mode,
    phase: 'lobby', boardId: board.id, boardName: board.name,
    chars: board.chars.map((c) => ({ id: c.id, name: c.name })),
    names: { host: hostName, guest: null },
    secret: { host: null, guest: null }, down: { host: [], guest: [] },
    turn: null, pending: null, asked: false, log: [], winner: null, guessed: null,
    score: { host: 0, guest: 0 }, round: 1, starter: null,
  };
}

/* ---------- Regole (girano sul telefono di chi ospita) ---------- */
function reducer(s, a) {
  const by = a.by, op = other(by);
  const log = (e) => [...s.log, { ...e, by, t: Date.now() }].slice(-100);
  switch (a.type) {
    case 'join':
      return { ...s, names: { ...s.names, guest: a.name }, phase: s.phase === 'lobby' ? 'pick' : s.phase };
    case 'secret': {
      if (s.phase !== 'pick' || !s.chars.some((c) => c.id === a.id)) return s;
      const secret = { ...s.secret, [by]: a.id };
      if (secret.host && secret.guest) {
        const turn = s.starter ? other(s.starter) : (Math.random() < 0.5 ? 'host' : 'guest');
        return { ...s, secret, phase: 'play', turn, starter: turn, asked: false, log: [{ type: 'sys', text: `Si comincia! Inizia ${s.names[turn]}.`, t: Date.now() }] };
      }
      return { ...s, secret };
    }
    case 'flip': {
      if (s.phase !== 'play') return s;
      const mine = s.down[by];
      const next = mine.includes(a.id) ? mine.filter((x) => x !== a.id) : [...mine, a.id];
      return { ...s, down: { ...s.down, [by]: next } };
    }
    case 'ask':
      if (s.phase !== 'play' || s.turn !== by || s.pending || !a.text?.trim()) return s;
      return { ...s, pending: { by, text: a.text.trim().slice(0, 200) }, log: log({ type: 'q', text: a.text.trim().slice(0, 200) }) };
    case 'answer':
      if (!s.pending || s.pending.by === by) return s;
      return { ...s, pending: null, asked: true, log: log({ type: 'a', text: a.value }) };
    case 'pass':
      if (s.phase !== 'play' || s.turn !== by || s.pending) return s;
      return { ...s, turn: op, asked: false, log: log({ type: 'sys', text: `Tocca a ${s.names[op]}.` }) };
    case 'guess': {
      if (s.phase !== 'play' || s.turn !== by || s.pending) return s;
      const ok = s.secret[op] === a.id;
      const winner = ok ? by : op;
      return { ...s, phase: 'over', winner, guessed: { by, id: a.id, ok }, score: { ...s.score, [winner]: s.score[winner] + 1 } };
    }
    case 'chat':
      if (!a.text?.trim()) return s;
      return { ...s, log: log({ type: 'chat', text: a.text.trim().slice(0, 300) }) };
    case 'rematch':
      if (s.phase !== 'over') return s;
      return { ...s, phase: 'pick', secret: { host: null, guest: null }, down: { host: [], guest: [] }, pending: null, asked: false, winner: null, guessed: null, log: [], round: s.round + 1 };
    default: return s;
  }
}

async function restoreAssets(state) {
  const b = await db.get('boards', state.boardId);
  const assets = {};
  for (const c of b?.chars || []) assets[c.id] = c.img;
  return assets;
}

/* ---------- Interfaccia ---------- */
function render(session, root) {
  const me = session.me, op = other(me);
  const body = gameShell(root, session, 'Indovina Chi');
  const unbind = bindAssets(session, root);
  let mode = 'flip'; // oppure 'guess'
  let lastPhase = null, celebrated = null, lastTurn = null;
  let actEl = null, actKey = '';
  const cards = {};

  const img = (id) => h('img', { 'data-asset': id, src: session.assets[id] || '', alt: '', draggable: false });
  const charName = (id) => session.state.chars.find((c) => c.id === id)?.name || '?';

  const card = (c) => {
    if (cards[c.id]) return cards[c.id];
    const el = h('button', { class: 'gw-card', type: 'button' },
      h('div', { class: 'gw-inner' }, h('div', { class: 'gw-front' }, img(c.id), h('span', { class: 'gw-name' }, c.name)), h('div', { class: 'gw-back' }, '❔')));
    el.addEventListener('click', () => onCard(c));
    cards[c.id] = el;
    return el;
  };

  async function onCard(c) {
    const s = session.state;
    if (s.phase === 'pick') {
      if (s.secret[me]) return;
      if (await confirmDialog(h('span', {}, 'Vuoi essere ', h('strong', {}, c.name), '?'), { ok: 'Sì, scelgo lui/lei' })) session.dispatch({ type: 'secret', id: c.id });
    } else if (s.phase === 'play') {
      if (mode === 'guess') {
        if (await confirmDialog(h('span', {}, 'Sei sicuro/a che sia ', h('strong', {}, c.name), '? Se sbagli perdi la partita!'), { ok: '🎯 Indovina', danger: true })) {
          session.dispatch({ type: 'guess', id: c.id });
        }
        mode = 'flip'; draw();
      } else {
        vibrate(15);
        session.dispatch({ type: 'flip', id: c.id });
        // risposta immediata anche prima del giro di rete
        if (!session.isHost) cards[c.id].classList.toggle('down');
      }
    }
  }

  function grid(s) {
    const down = new Set(s.down[me]);
    return h('div', { class: 'gw-grid' + (mode === 'guess' ? ' guessing' : '') }, s.chars.map((c) => {
      const el = card(c);
      el.classList.toggle('down', s.phase === 'play' && down.has(c.id));
      el.classList.toggle('secret', s.secret[me] === c.id);
      el.disabled = s.phase === 'pick' && !!s.secret[me];
      return el;
    }));
  }

  function logView(s, n = 6) {
    const items = s.log.slice(-n).map((e) => {
      const who = e.by ? s.names[e.by] : '';
      if (e.type === 'q') return h('div', { class: 'log q ' + (e.by === me ? 'me' : 'them') }, h('b', {}, who + ': '), '❓ ' + e.text);
      if (e.type === 'a') return h('div', { class: 'log a ' + (e.by === me ? 'me' : 'them') }, h('b', {}, who + ': '), answerEmoji(e.text) + ' ' + e.text);
      if (e.type === 'chat') return h('div', { class: 'log chat ' + (e.by === me ? 'me' : 'them') }, h('b', {}, who + ': '), e.text);
      return h('div', { class: 'log sys' }, e.text);
    });
    return h('div', { class: 'log-box' }, items);
  }

  function actions(s) {
    const myTurn = s.turn === me;
    if (s.mode === 'voice') {
      if (!myTurn) return h('div', { class: 'action-bar' }, h('p', { class: 'center' }, `🗣️ Tocca a ${s.names[op]}: rispondi a voce alla sua domanda.`));
      if (mode === 'guess') {
        return h('div', { class: 'action-bar highlight' },
          h('p', { class: 'center' }, '🎯 Tocca il personaggio che pensi sia il suo'),
          h('button', { class: 'btn', onclick: () => { mode = 'flip'; draw(); } }, 'Annulla'));
      }
      return h('div', { class: 'action-bar' },
        h('p', { class: 'center' }, '🗣️ Fai la tua domanda a voce, abbassa le carte scartate e passa il turno.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => { mode = 'guess'; draw(); } }, '🎯 Indovina'),
          h('button', { class: 'btn primary grow', onclick: () => session.dispatch({ type: 'pass' }) }, 'Passa il turno ➡️'),
        ));
    }
    if (s.pending && s.pending.by !== me) {
      vibrate([40, 60, 40]);
      return h('div', { class: 'action-bar highlight' },
        h('div', { class: 'question' }, `${s.names[op]} chiede:`, h('strong', {}, ' ' + s.pending.text)),
        h('div', { class: 'row' }, ['Sì', 'No', 'Non so'].map((v) => h('button', { class: 'btn grow ' + (v === 'Sì' ? 'yes' : v === 'No' ? 'no' : ''), onclick: () => session.dispatch({ type: 'answer', value: v }) }, answerEmoji(v) + ' ' + v))),
      );
    }
    if (s.pending) return h('div', { class: 'action-bar' }, h('p', { class: 'muted center' }, `⏳ Aspetto la risposta di ${s.names[op]}…`));
    if (!myTurn) {
      const chat = h('input', { class: 'input', placeholder: 'Scrivi un messaggio…', enterkeyhint: 'send' });
      return h('div', { class: 'action-bar' },
        h('p', { class: 'center' }, `🕰️ Tocca a ${s.names[op]}. Intanto abbassa le carte!`),
        h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); session.dispatch({ type: 'chat', text: chat.value }); chat.value = ''; } }, chat, h('button', { class: 'btn' }, '💬')),
      );
    }
    if (mode === 'guess') {
      return h('div', { class: 'action-bar highlight' },
        h('p', { class: 'center' }, '🎯 Tocca il personaggio che pensi sia il suo'),
        h('button', { class: 'btn', onclick: () => { mode = 'flip'; draw(); } }, 'Annulla'),
      );
    }
    const q = h('input', { class: 'input', placeholder: 'Fai una domanda sì/no…', enterkeyhint: 'send', maxlength: 200 });
    return h('div', { class: 'action-bar' },
      s.asked
        ? h('p', { class: 'center' }, '✅ Abbassa le carte scartate, poi passa il turno.')
        : h('div', {},
          h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); session.dispatch({ type: 'ask', text: q.value }); } }, q, h('button', { class: 'btn primary' }, 'Chiedi')),
          h('div', { class: 'chips' }, QUICK.map((t) => h('button', { class: 'chip', onclick: () => { q.value = t; q.focus(); } }, t))),
        ),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: () => { mode = 'guess'; draw(); } }, '🎯 Indovina'),
        s.asked ? h('button', { class: 'btn primary grow', onclick: () => session.dispatch({ type: 'pass' }) }, 'Passa il turno ➡️') : null,
      ),
    );
  }

  // Non ricreare la barra azioni se non cambia: così non si perde il testo che stai scrivendo.
  function cachedActions(s) {
    const key = JSON.stringify([s.pending, s.turn, s.asked, mode, s.phase, s.names]);
    if (key !== actKey || !actEl) { actKey = key; actEl = actions(s); }
    return actEl;
  }

  function draw() {
    const s = session.state;
    if (!s) { mount(body, h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Ricevo la partita…'))); return; }
    if (s.phase !== lastPhase) { mode = 'flip'; lastPhase = s.phase; }
    const missing = s.chars.filter((c) => !session.assets[c.id]).length;
    const score = h('div', { class: 'scorebar' },
      h('span', {}, `${s.names.host || '…'} ${s.score.host}`), h('span', { class: 'muted' }, `round ${s.round}`), h('span', {}, `${s.score.guest} ${s.names.guest || '…'}`));

    if (s.phase === 'lobby') {
      mount(body, h('div', { class: 'card center' }, h('h2', {}, s.boardName), h('p', { class: 'muted' }, `${s.chars.length} personaggi`)),
        invitePanel(session.room), h('p', { class: 'muted center small' }, 'Tieni questa pagina aperta finché il tuo partner non entra.'));
      return;
    }

    if (s.phase === 'pick') {
      const mine = s.secret[me];
      mount(body, score,
        missing ? h('p', { class: 'muted small center' }, `📥 Ricevo le foto… (${s.chars.length - missing}/${s.chars.length})`) : null,
        mine
          ? h('div', { class: 'card secret-card' }, img(mine), h('div', {}, h('div', { class: 'muted small' }, 'Il tuo personaggio segreto'), h('strong', {}, charName(mine)), h('p', { class: 'muted small' }, s.secret[op] ? '' : `⏳ Aspetto che ${s.names[op]} scelga…`)))
          : h('div', { class: 'card center' }, h('h3', {}, 'Scegli il tuo personaggio segreto 🤫'),
            h('button', { class: 'btn', onclick: () => { const c = s.chars[Math.floor(Math.random() * s.chars.length)]; session.dispatch({ type: 'secret', id: c.id }); } }, '🎲 Scegli a caso')),
        grid(s),
      );
      return;
    }

    if (s.phase === 'play') {
      if (s.turn !== lastTurn) { if (lastTurn && s.turn === me) vibrate([30, 50, 30]); lastTurn = s.turn; }
      const left = s.chars.length - s.down[op].length;
      mount(body, score,
        h('div', { class: 'row between info-row' },
          h('div', { class: 'mini-secret' }, img(s.secret[me]), h('span', {}, 'Tu sei ', h('strong', {}, charName(s.secret[me])))),
          h('div', { class: 'muted small' }, `${s.names[op]}: ${left} in piedi`)),
        h('div', { class: 'turn-banner ' + (s.turn === me ? 'mine' : '') }, s.turn === me ? '👉 È il tuo turno' : `⏳ Turno di ${s.names[op]}`),
        grid(s),
        s.mode === 'voice' ? null : logView(s),
        cachedActions(s),
      );
      return;
    }

    if (s.phase === 'over') {
      const won = s.winner === me;
      const g = s.guessed;
      if (won && celebrated !== s.round) { celebrated = s.round; confetti(); }
      mount(body, score,
        h('div', { class: 'card center result ' + (won ? 'win' : 'lose') },
          h('div', { class: 'big-emoji' }, won ? '🏆' : '💔'),
          h('h2', {}, won ? 'Hai vinto!' : `Ha vinto ${s.names[op]}!`),
          h('p', {}, `${s.names[g.by]} ha detto ${charName(g.id)}: ${g.ok ? 'giusto! 🎯' : 'sbagliato ❌'}`),
          h('div', { class: 'reveal' },
            h('div', {}, img(s.secret.host), h('div', { class: 'small' }, `${s.names.host}: ${charName(s.secret.host)}`)),
            h('div', {}, img(s.secret.guest), h('div', { class: 'small' }, `${s.names.guest}: ${charName(s.secret.guest)}`)),
          ),
          h('button', { class: 'btn primary', onclick: () => session.dispatch({ type: 'rematch' }) }, '🔁 Rivincita'),
          session.isHost ? null : h('button', { class: 'btn', onclick: () => saveBoardLocally(session) }, '💾 Salva questa tabella'),
        ),
        s.mode === 'voice' ? null : logView(s, 30),
      );
    }
  }

  const offS = session.on('state', draw);
  const offA = session.on('asset', () => { if (session.state?.phase === 'pick' && Object.keys(session.assets).length >= session.state.chars.length) draw(); });
  draw();
  return () => { offS(); offA(); unbind(); };
}

function answerEmoji(v) { return v === 'Sì' ? '👍' : v === 'No' ? '👎' : '🤷'; }

async function saveBoardLocally(session) {
  const s = session.state;
  const chars = s.chars.map((c) => ({ ...c, img: session.assets[c.id] })).filter((c) => c.img);
  if (chars.length < s.chars.length) { toast('Foto non ancora ricevute tutte'); return; }
  await db.put('boards', { id: s.boardId, name: s.boardName, chars });
  toast('Tabella salvata tra le tue ✅');
}

export function confetti() {
  const box = h('div', { class: 'confetti' });
  const em = ['💖', '🎉', '✨', '💘', '🥳'];
  for (let i = 0; i < 40; i++) {
    box.append(h('span', { style: { left: Math.random() * 100 + '%', animationDelay: Math.random() * 0.8 + 's', animationDuration: 1.8 + Math.random() * 1.5 + 's' } }, em[i % em.length]));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}

export const guessWho = { id: 'guesswho', title: 'Indovina Chi', reducer, restoreAssets, render };
