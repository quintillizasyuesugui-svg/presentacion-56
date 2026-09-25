// Validación de "Frase final" y "Escribir en vivo" — separado del resto del
// servidor para poder probarlo con pruebas unitarias sin levantarlo entero
// (Express, Socket.IO, Cloudinary, etc.). frase-final.js y sockets.js lo usan.
//
// Los 27 tipos de letra y los efectos son un menú cerrado (no texto libre) —
// así el cliente sólo manda una "key" y acá se valida contra esta lista,
// nunca CSS/HTML suelto. El nombre visible y la fuente real de cada uno
// viven en el HTML (avanzado.html/pantalla.html), acá sólo importa la key.
// Los primeros 10 entran una vez y quedan quietos; del 11° al 18° (a partir
// de "pulse") se mueven todo el tiempo que la frase está en pantalla; los
// últimos 2 ("stars"/"hearts") vuelven a ser de una sola vez, con una lluvia
// de partículas encima igual que "confetti".
const FRASE_FONTS = [
  'sans', 'serif', 'script', 'display', 'casual', 'geometric', 'bold-script', 'poster', 'calligraphy', 'huge',
  'handwritten', 'marker', 'comic', 'thin-hand', 'rounded', 'elegant-script', 'strong', 'notebook',
  'royal', 'shadow-3d', 'neon-tube', 'graffiti', 'curvy-bold', 'bubble', 'comic-3d', 'urban', 'outline'
];
const FRASE_EFFECTS = [
  'fade', 'slide-up', 'slide-down', 'zoom', 'bounce', 'typewriter', 'confetti', 'rotate', 'glow', 'wave',
  'pulse', 'float', 'sway', 'shimmer', 'rainbow', 'shake', 'flicker', 'spin',
  'bounce-loop', 'wiggle', 'jelly', 'heartbeat', 'rock', 'stretch', 'neon', 'stars', 'hearts'
];
const FRASE_POSITIONS = ['top', 'middle', 'bottom'];
const FRASE_DEFAULT = { text: '', font: 'sans', color: '#ffffff', color2: '', effect: 'fade', duration: 1, fontSize: 1, position: 'middle' };

// color2 es opcional: '' (o nada) significa "un solo color", cualquier otra
// cosa tiene que ser un hex válido — ahí se combinan los 2 en un degradado.
// Devuelve null si vino algo raro (para poder distinguirlo de "vacío a propósito").
function parseColor2(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  return typeof valor === 'string' && /^#[0-9a-fA-F]{6}$/.test(valor) ? valor : null;
}

// Nada de texto/HTML suelto sin revisar: el color tiene que ser un hex de 6
// dígitos y la letra/efecto tienen que estar en el menú cerrado de arriba.
function parseFraseBody(body) {
  const text = String((body || {}).text || '').trim().slice(0, 60);
  const font = FRASE_FONTS.includes((body || {}).font) ? body.font : null;
  const effect = FRASE_EFFECTS.includes((body || {}).effect) ? body.effect : null;
  const color = typeof (body || {}).color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  const color2 = parseColor2((body || {}).color2);
  const position = FRASE_POSITIONS.includes((body || {}).position) ? body.position : null;
  const rawDuration = Number((body || {}).duration);
  const duration = Number.isFinite(rawDuration) ? Math.min(3, Math.max(0.4, rawDuration)) : null;
  const rawFontSize = Number((body || {}).fontSize);
  const fontSize = Number.isFinite(rawFontSize) ? Math.min(1.8, Math.max(0.6, rawFontSize)) : null;
  if (!text || !font || !effect || !color || color2 === null || !position || duration === null || fontSize === null) return null;
  return { text, font, color, color2, effect, duration, fontSize, position };
}

// Nada de texto/HTML suelto sin revisar acá tampoco: mismas listas cerradas
// de letra/efecto que "Frase final", color en hex y el texto acotado en
// longitud. No se guarda en ningún lado — "Escribir en vivo" es 100% en el
// momento, sólo se retransmite a la sala del propio dueño.
function parseLiveWriteBody(body) {
  const font = FRASE_FONTS.includes((body || {}).font) ? body.font : null;
  const effect = FRASE_EFFECTS.includes((body || {}).effect) ? body.effect : null;
  const color = typeof (body || {}).color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  const color2 = parseColor2((body || {}).color2);
  const rawFontSize = Number((body || {}).fontSize);
  const fontSize = Number.isFinite(rawFontSize) ? Math.min(2.2, Math.max(0.5, rawFontSize)) : null;
  if (!font || !effect || !color || color2 === null || fontSize === null) return null;
  const text = String((body || {}).text || '').slice(0, 4000);
  return { active: !!(body || {}).active && text.trim().length > 0, text, font, effect, color, color2, fontSize };
}

module.exports = {
  FRASE_FONTS,
  FRASE_EFFECTS,
  FRASE_POSITIONS,
  FRASE_DEFAULT,
  parseColor2,
  parseFraseBody,
  parseLiveWriteBody
};
