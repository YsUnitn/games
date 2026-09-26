// Piccoli helper DOM senza framework.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
}

export function toast(msg, ms = 2600) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// Modale generica. content: Node. Ritorna {close, el}.
export function modal(content, { onClose, full = false } = {}) {
  const back = h('div', { class: 'modal-back' + (full ? ' full' : '') });
  const box = h('div', { class: 'modal' }, content);
  back.append(box);
  const close = () => { back.remove(); onClose?.(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close, el: box };
}

export function confirmDialog(text, { ok = 'OK', cancel = 'Annulla', danger = false } = {}) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { resolve(v); m.close(); };
    m = modal(h('div', {},
      h('p', { class: 'modal-text' }, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, ok),
      ),
    ), { onClose: () => resolve(false) });
  });
}

export function promptDialog(text, value = '', { ok = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let m;
    const input = h('input', { class: 'input', value, placeholder });
    const done = (v) => { resolve(v); m.close(); };
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); done(input.value.trim()); } },
      h('p', { class: 'modal-text' }, text),
      input,
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => done(null) }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn primary' }, ok),
      ),
    );
    m = modal(form, { onClose: () => resolve(null) });
    setTimeout(() => input.focus(), 50);
  });
}

export function header(title, { back = '#/', right = null } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('a', { class: 'icon-btn', href: back, 'aria-label': 'Indietro' }, '‹') : h('span', { class: 'icon-btn' }),
    h('h1', {}, title),
    right || h('span', { class: 'icon-btn' }),
  );
}

export function pickFiles({ accept = 'image/*', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function uid(n = 10) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const x of r) s += a[x % a.length];
  return s;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function vibrate(p = 30) { try { navigator.vibrate?.(p); } catch {} }
