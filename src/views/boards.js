import { h, mount, header, toast, pickFiles, uid, confirmDialog, downloadFile, modal } from '../lib/ui.js';
import { db } from '../lib/db.js';
import { squareThumb, emojiAvatar, cleanName } from '../lib/image.js';
import { importJSONFile } from './settings.js';

export function boardPreview(b) {
  return h('div', { class: 'mini-grid' }, (b.chars || []).slice(0, 4).map((c) => h('img', { src: c.img, alt: '' })));
}

export async function boardsView(root) {
  const boards = await db.all('boards');
  mount(root, header('Le mie tabelle'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onclick: newBoard }, '➕ Nuova tabella'),
      h('button', { class: 'btn', onclick: importBoard }, '⬆️ Importa'),
    ),
    boards.length ? null : h('div', { class: 'card center' },
      h('p', {}, 'Non hai ancora tabelle. Creane una con le vostre foto (amici, parenti, animali, vip…) oppure prova quella demo.'),
      h('button', { class: 'btn', onclick: async () => { const b = await createDemoBoard(); location.hash = '#/boards/' + b.id; } }, '✨ Crea tabella demo'),
    ),
    h('div', { class: 'list' }, boards.map((b) => h('a', { class: 'list-card', href: '#/boards/' + b.id },
      boardPreview(b),
      h('div', { class: 'grow' }, h('strong', {}, b.name || 'Senza nome'), h('div', { class: 'muted small' }, `${b.chars.length} personaggi`)),
      h('span', { class: 'chev' }, '›'),
    ))),
  );
}

async function newBoard() {
  const b = { id: uid(), name: 'Nuova tabella', chars: [] };
  await db.put('boards', b);
  location.hash = '#/boards/' + b.id;
}

async function importBoard() {
  const data = await importJSONFile();
  if (!data) return;
  const list = data.boards || (data.chars ? [data] : []);
  for (const b of list) await db.put('boards', b);
  toast(`Importate ${list.length} tabelle ✅`);
  location.reload();
}

export async function createDemoBoard() {
  const people = [['🧑‍🦰', 'Giulia'], ['👨‍🦳', 'Nonno Pino'], ['👩‍🦱', 'Sara'], ['🧔', 'Marco'], ['👱‍♀️', 'Elena'], ['👨‍🦲', 'Franco'],
    ['👩‍🦳', 'Rosa'], ['🧑‍🎤', 'Leo'], ['👩‍🍳', 'Anna'], ['👮', 'Paolo'], ['🧙', 'Merlino'], ['🧛', 'Vlad'],
    ['👸', 'Sofia'], ['🤴', 'Luca'], ['🧑‍🚀', 'Chiara'], ['🕵️', 'Dario'], ['👩‍🔬', 'Marta'], ['🧑‍🌾', 'Beppe'],
    ['🐶', 'Fido'], ['🐱', 'Micia'], ['🦊', 'Volpe'], ['🐼', 'Panda'], ['🦁', 'Leone'], ['🐸', 'Rana']];
  const colors = ['#ffd6e0', '#d6e4ff', '#d8f5d0', '#fff1c1', '#e6d6ff', '#ffe0cc'];
  const b = { id: uid(), name: 'Demo', chars: people.map(([e, n], i) => ({ id: uid(6), name: n, img: emojiAvatar(e, colors[i % colors.length]) })) };
  await db.put('boards', b);
  return b;
}

export async function boardEditView(root, id) {
  let board = await db.get('boards', id);
  if (!board) { location.hash = '#/boards'; return; }
  const save = () => db.put('boards', board);
  const nameIn = h('input', { class: 'input title-input', value: board.name, placeholder: 'Nome tabella', oninput: () => { board.name = nameIn.value; save(); } });
  const grid = h('div', { class: 'edit-grid' });
  const count = h('span', { class: 'muted small' });
  const progress = h('div', { class: 'muted small' });

  const draw = () => {
    count.textContent = `${board.chars.length} personaggi` + (board.chars.length < 4 ? ' · ne servono almeno 4' : '');
    grid.replaceChildren(...board.chars.map((c) => {
      const img = h('img', { src: c.img, alt: c.name });
      const inp = h('input', { class: 'char-name', value: c.name, placeholder: 'Nome', oninput: () => { c.name = inp.value; save(); } });
      return h('div', { class: 'edit-card' },
        h('button', { class: 'img-btn', title: 'Cambia foto', onclick: async () => {
          const [f] = await pickFiles({ multiple: false });
          if (!f) return;
          c.img = await squareThumb(f); img.src = c.img; save();
        } }, img),
        inp,
        h('button', { class: 'del', title: 'Elimina', onclick: async () => {
          board.chars = board.chars.filter((x) => x !== c); save(); draw();
        } }, '✕'),
      );
    }));
  };

  const addPhotos = async () => {
    const files = await pickFiles();
    let i = 0;
    for (const f of files) {
      progress.textContent = `Elaboro foto ${++i}/${files.length}…`;
      try { board.chars.push({ id: uid(6), name: cleanName(f.name) || `#${board.chars.length + 1}`, img: await squareThumb(f) }); }
      catch { toast('Impossibile leggere ' + f.name); }
    }
    progress.textContent = '';
    await save(); draw();
    if (files.length) toast('Ricorda di dare un nome a ogni personaggio ✍️');
  };

  const more = () => {
    const m = modal(h('div', { class: 'stack' },
      h('button', { class: 'btn', onclick: async () => { m.close(); const copy = { ...structuredClone(board), id: uid(), name: board.name + ' (copia)' }; await db.put('boards', copy); location.hash = '#/boards/' + copy.id; } }, '📑 Duplica'),
      h('button', { class: 'btn', onclick: () => { m.close(); downloadFile(`tabella-${(board.name || 'x').replace(/\W+/g, '_')}.json`, JSON.stringify(board)); } }, '⬇️ Esporta file'),
      h('button', { class: 'btn', onclick: () => { m.close(); board.chars = [...board.chars].sort((a, b) => a.name.localeCompare(b.name)); save(); draw(); } }, '🔤 Ordina per nome'),
      h('button', { class: 'btn danger', onclick: async () => { m.close(); if (await confirmDialog(`Eliminare "${board.name}"?`, { danger: true, ok: 'Elimina' })) { await db.del('boards', board.id); location.hash = '#/boards'; } } }, '🗑️ Elimina tabella'),
    ));
  };

  mount(root, header('Modifica tabella', { back: '#/boards', right: h('button', { class: 'icon-btn', onclick: more }, '⋯') }),
    nameIn,
    h('div', { class: 'row between' }, count, progress),
    grid,
    h('div', { class: 'sticky-bottom row' },
      h('button', { class: 'btn primary grow', onclick: addPhotos }, '📷 Aggiungi foto'),
      h('a', { class: 'btn grow', href: '#/guesswho' }, '🕵️ Gioca'),
    ),
  );
  draw();
}
