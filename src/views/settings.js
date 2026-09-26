import { h, mount, header, toast, downloadFile, pickFiles, confirmDialog } from '../lib/ui.js';
import { db, getSettings, setSettings } from '../lib/db.js';

export function settingsView(root) {
  const s = getSettings();
  const name = h('input', { class: 'input', value: s.name, placeholder: 'Il tuo nome' });
  const turn = h('input', { class: 'input', value: s.turn, placeholder: 'turn:server:3478|utente|password' });
  const info = h('p', { class: 'muted small' });
  navigator.storage?.estimate?.().then((e) => { info.textContent = `Spazio usato: ${(e.usage / 1048576).toFixed(1)} MB`; });

  mount(root, header('Impostazioni'),
    h('div', { class: 'card' },
      h('label', { class: 'label' }, 'Il tuo nome'), name,
      h('button', { class: 'btn primary', onclick: () => { setSettings({ name: name.value.trim() }); toast('Salvato ✅'); } }, 'Salva'),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '💾 Backup'),
      h('p', { class: 'muted small' }, 'Tabelle e foto sono salvate solo in questo browser. Esporta un backup per non perderle o per spostarle su un altro telefono.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: exportAll }, '⬇️ Esporta tutto'),
        h('button', { class: 'btn grow', onclick: importAll }, '⬆️ Importa'),
      ),
      info,
    ),
    h('div', { class: 'card' },
      h('h3', {}, '🛰️ Connessione (avanzato)'),
      h('p', { class: 'muted small' }, 'Se su rete mobile non riuscite a collegarvi, puoi aggiungere un tuo server TURN. Di solito non serve.'),
      turn,
      h('button', { class: 'btn', onclick: () => { setSettings({ turn: turn.value.trim() }); toast('Salvato ✅'); } }, 'Salva'),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '🧹 Partite'),
      h('button', { class: 'btn danger', onclick: clearRooms }, 'Cancella partite salvate'),
    ),
  );
}

async function exportAll() {
  const data = { app: 'giochi-coppia', v: 1, boards: await db.all('boards'), geopacks: await db.all('geopacks') };
  downloadFile(`giochi-coppia-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
}

export async function importJSONFile() {
  const [file] = await pickFiles({ accept: 'application/json,.json', multiple: false });
  if (!file) return null;
  try { return JSON.parse(await file.text()); } catch { toast('File non valido'); return null; }
}

async function importAll() {
  const data = await importJSONFile();
  if (!data) return;
  let n = 0;
  for (const b of data.boards || (data.chars ? [data] : [])) { await db.put('boards', b); n++; }
  for (const p of data.geopacks || (data.places ? [data] : [])) { await db.put('geopacks', p); n++; }
  toast(`Importati ${n} elementi ✅`);
}

async function clearRooms() {
  if (!(await confirmDialog('Cancellare tutte le partite in corso salvate?', { danger: true, ok: 'Cancella' }))) return;
  Object.keys(localStorage).filter((k) => k.startsWith('gc-room')).forEach((k) => localStorage.removeItem(k));
  toast('Fatto');
}
