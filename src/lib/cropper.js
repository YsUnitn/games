// Editor di ritaglio: pizzica per zoomare, trascina per spostare.
import { h, modal } from './ui.js';

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

/**
 * Apre il ritaglio quadrato di `src`.
 * Ritorna { action: 'ok', img, name } | { action: 'replace', name } | null (annullato/saltato).
 */
export async function cropImage(src, { name = '', title = 'Ritaglia la foto', out = 320, allowReplace = false, skipLabel = 'Annulla' } = {}) {
  const image = await loadImg(src);
  const iw = image.naturalWidth, ih = image.naturalHeight;

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; ro?.disconnect(); resolve(v); m.close(); };

    const imgEl = h('img', { src, alt: '', draggable: false, class: 'crop-img' });
    const frame = h('div', { class: 'crop-frame' }, imgEl, h('div', { class: 'crop-guide' }));
    const zoom = h('input', { type: 'range', min: 1, max: 6, step: 0.01, value: 1, class: 'crop-zoom', 'aria-label': 'Zoom' });
    const nameIn = h('input', { class: 'input', value: name, placeholder: 'Nome del personaggio', maxlength: 24, enterkeyhint: 'done' });

    let size = 300, base = 1, k = 1, x = 0, y = 0; // k = zoom relativo (1 = foto intera che copre il quadrato)
    const scale = () => base * k;
    const clamp = () => {
      const s = scale();
      x = Math.min(0, Math.max(size - iw * s, x));
      y = Math.min(0, Math.max(size - ih * s, y));
    };
    const apply = () => {
      clamp();
      imgEl.style.width = iw * scale() + 'px';
      imgEl.style.height = ih * scale() + 'px';
      imgEl.style.transform = `translate(${x}px, ${y}px)`;
      zoom.value = k;
    };
    // zoom mantenendo fermo il punto (cx, cy) del riquadro
    const zoomAt = (nk, cx = size / 2, cy = size / 2) => {
      nk = Math.max(1, Math.min(6, nk));
      const s0 = scale();
      const px = (cx - x) / s0, py = (cy - y) / s0;
      k = nk;
      const s1 = scale();
      x = cx - px * s1; y = cy - py * s1;
      apply();
    };
    const init = () => {
      size = frame.clientWidth || 300;
      base = Math.max(size / iw, size / ih);
      k = 1;
      // centrato, un po' spostato verso l'alto (di solito lì c'è la faccia)
      x = (size - iw * base) / 2;
      y = (size - ih * base) / 3;
      apply();
    };

    // Gesti (mouse, dito, due dita)
    const pts = new Map();
    let last = null;
    const snapshot = () => {
      const p = [...pts.values()];
      if (p.length >= 2) {
        const [a, b] = p;
        return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
      return p[0] ? { cx: p[0].x, cy: p[0].y, d: 0 } : null;
    };
    const local = (e) => { const r = frame.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    frame.addEventListener('pointerdown', (e) => {
      frame.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      last = snapshot();
    });
    frame.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const now = snapshot();
      if (!now || !last) { last = now; return; }
      if (now.d && last.d) zoomAt(k * (now.d / last.d), now.cx, now.cy);
      x += now.cx - last.cx; y += now.cy - last.cy;
      apply();
      last = now;
    });
    const up = (e) => { pts.delete(e.pointerId); last = snapshot(); };
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    frame.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y); }, { passive: false });
    frame.addEventListener('dblclick', (e) => { const p = local(e); zoomAt(k < 2 ? k * 2 : 1, p.x, p.y); });
    zoom.addEventListener('input', () => zoomAt(+zoom.value));

    const crop = () => {
      const s = scale();
      const c = document.createElement('canvas');
      c.width = c.height = out;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(image, -x / s, -y / s, size / s, size / s, 0, 0, out, out);
      finish({ action: 'ok', img: c.toDataURL('image/jpeg', 0.85), name: nameIn.value.trim() });
    };

    const content = h('div', { class: 'cropper' },
      h('h3', {}, title),
      frame,
      h('div', { class: 'row tight crop-zoom-row' },
        h('button', { type: 'button', class: 'icon-btn', onclick: () => zoomAt(k / 1.25) }, '−'),
        zoom,
        h('button', { type: 'button', class: 'icon-btn', onclick: () => zoomAt(k * 1.25) }, '+'),
      ),
      h('p', { class: 'muted small center' }, 'Pizzica con due dita per zoomare, trascina per spostare.'),
      nameIn,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => finish(null) }, skipLabel),
        allowReplace ? h('button', { type: 'button', class: 'btn', onclick: () => finish({ action: 'replace', name: nameIn.value.trim() }) }, '🖼️ Cambia') : null,
        h('button', { type: 'button', class: 'btn primary grow', onclick: crop }, '✂️ Fatto'),
      ),
    );
    const m = modal(content, { onClose: () => finish(null) });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } });
    let ready = false;
    requestAnimationFrame(() => { init(); ready = true; });
    // se il riquadro cambia dimensione (es. si apre la tastiera) mantieni il ritaglio scelto
    const ro = new ResizeObserver(() => {
      const w = frame.clientWidth;
      if (!ready || !w || w === size) return;
      const r = w / size;
      x *= r; y *= r; size = w;
      base = Math.max(size / iw, size / ih);
      apply();
    });
    ro.observe(frame);
  });
}
