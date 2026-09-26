// Chiave di cifratura della partita (sta solo nel link di invito).
export function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export function newKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}
