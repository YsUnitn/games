// Ridimensiona e comprime le foto nel browser (niente server).
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function fileToImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// Ritaglio quadrato centrato (per i personaggi).
export async function squareThumb(file, size = 320, quality = 0.82) {
  const img = await fileToImage(file);
  const w = img.width, hgt = img.height, s = Math.min(w, hgt);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, (w - s) / 2, (hgt - s) / 4, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', quality);
}

// Ridimensiona mantenendo le proporzioni (per il GeoGuesser).
export async function fitImage(file, max = 1400, quality = 0.8) {
  const img = await fileToImage(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Avatar con emoji per la tabella demo.
export function emojiAvatar(emoji, bg, size = 320) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  g.font = `${size * 0.62}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, size / 2, size / 2 + size * 0.04);
  return c.toDataURL('image/jpeg', 0.85);
}

export function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
}
