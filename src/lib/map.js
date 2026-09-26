import L from 'leaflet';
import { h } from './ui.js';

// Mappe di OpenStreetMap: vengono scaricate solo le "piastrelle" della mappa,
// nessuna foto viene inviata.
const LAYERS = {
  map: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
  sat: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
};

export function pin(emoji, cls = '') {
  return L.divIcon({ className: 'emoji-pin ' + cls, html: `<span>${emoji}</span>`, iconSize: [36, 36], iconAnchor: [18, 34] });
}

export function createMap(el, { center = [42.5, 12.5], zoom = 3, onClick } = {}) {
  const map = L.map(el, { zoomControl: true, worldCopyJump: true, attributionControl: true }).setView(center, zoom);
  let layer = LAYERS.map().addTo(map);
  let kind = 'map';
  const Toggle = L.Control.extend({
    onAdd() {
      const b = h('button', { class: 'map-toggle', type: 'button' }, '🛰️');
      L.DomEvent.disableClickPropagation(b);
      b.onclick = () => {
        map.removeLayer(layer);
        kind = kind === 'map' ? 'sat' : 'map';
        layer = LAYERS[kind]().addTo(map);
        b.textContent = kind === 'map' ? '🛰️' : '🗺️';
      };
      return b;
    },
  });
  new Toggle({ position: 'topright' }).addTo(map);
  if (onClick) map.on('click', (e) => onClick(e.latlng));
  // Leaflet ha bisogno di conoscere la dimensione reale del contenitore
  let alive = true;
  const fix = () => { if (alive && el.isConnected) map.invalidateSize({ animate: false }); };
  const ro = new ResizeObserver(fix);
  ro.observe(el);
  map.on('unload', () => { alive = false; ro.disconnect(); });
  setTimeout(fix, 60);
  return map;
}

export function distanceKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const SCALES = {
  world: { label: '🌍 Mondo', d0: 2000, zoom: 2 },
  europe: { label: '🇪🇺 Europa', d0: 500, zoom: 4 },
  country: { label: '🇮🇹 Italia / un paese', d0: 120, zoom: 5 },
  city: { label: '🏙️ Città', d0: 6, zoom: 12 },
};

export function score(dKm, scale = 'world') {
  const d0 = SCALES[scale]?.d0 || 2000;
  return Math.round(5000 * Math.exp(-dKm / d0));
}

export function fmtKm(d) {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  if (d < 20) return `${d.toFixed(1)} km`;
  return `${Math.round(d).toLocaleString('it-IT')} km`;
}

// Mostra soluzione e tentativo sulla mappa.
export function showResult(map, truth, guess) {
  const t = L.marker([truth.lat, truth.lng], { icon: pin('🚩', 'truth') }).addTo(map);
  if (!guess) { map.setView([truth.lat, truth.lng], 8, { animate: false }); return [t]; }
  const g = L.marker([guess.lat, guess.lng], { icon: pin('📍') }).addTo(map);
  const line = L.polyline([[truth.lat, truth.lng], [guess.lat, guess.lng]], { color: '#ff4f8b', dashArray: '6 8', weight: 3 }).addTo(map);
  map.fitBounds(L.latLngBounds([[truth.lat, truth.lng], [guess.lat, guess.lng]]).pad(0.3), { maxZoom: 14, animate: false });
  return [t, g, line];
}

// Ricerca luoghi per nome (Nominatim/OSM). Invia solo il testo cercato.
export async function searchPlace(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=it&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('ricerca non disponibile');
  return (await r.json()).map((x) => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
}

export { L };
