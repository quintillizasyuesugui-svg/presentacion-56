// Límite de intentos con PIN equivocado, por conexión (IP). Bloqueo que va creciendo:
// después de LIMITE_PIN_FALLOS PIN equivocados distintos, esa IP espera 1 minuto; si sigue
// fallando, 2, después 4, 8 y como mucho 15 minutos. Quien se equivocó un par de veces
// espera poco; quien prueba PIN al azar queda cada vez más frenado. Tras una hora sin
// errores se vuelve a empezar desde 1 minuto.
// Mientras dura el bloqueo no se acepta ningún PIN, ni el correcto (si no, se podría seguir
// probando hasta dar con uno).
// El límite del celular (3 intentos → 10 s) se salteaba borrando los datos del navegador;
// éste lo lleva el servidor.
// Cuentan los PIN distintos: el mismo PIN viejo guardado en un celular, que se manda en cada
// pedido, cuenta una sola vez (quien prueba PIN al azar usa uno distinto cada vez). En un
// aula todos salen a internet con la misma IP, y eso no tiene que dejar a todos afuera.
const crypto = require('crypto');
const MAXIMO_FALLOS = Number(process.env.LIMITE_PIN_FALLOS) || 5;
const PRIMER_BLOQUEO_MS = 60 * 1000;
const BLOQUEO_MAXIMO_MS = 15 * 60 * 1000;
const OLVIDO_MS = 60 * 60 * 1000; // sin errores durante una hora, se olvida todo

const porIp = new Map(); // ip → { fallos: Set(huellas de PIN), bloqueos, bloqueadoHasta, ultimoFallo }

// Render pone la IP real del que se conecta al final de X-Forwarded-For; lo de antes lo puede
// escribir cualquiera, así que no se usa.
function ipDe(cabeceras, direccion) {
  const reenviado = String(cabeceras['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return reenviado.length ? reenviado[reenviado.length - 1] : (direccion || 'desconocida');
}

// Milisegundos que le faltan a esa IP para poder volver a probar (0 = puede).
function esperaDe(ip) {
  const r = porIp.get(ip);
  return r && r.bloqueadoHasta > Date.now() ? r.bloqueadoHasta - Date.now() : 0;
}

function anotarFallo(ip, pin) {
  const ahora = Date.now();
  let r = porIp.get(ip);
  if (!r || ahora - r.ultimoFallo > OLVIDO_MS) r = { fallos: new Set(), bloqueos: 0, bloqueadoHasta: 0, ultimoFallo: 0 };
  r.ultimoFallo = ahora;
  r.fallos.add(crypto.createHash('sha256').update(String(pin)).digest('hex'));
  if (r.fallos.size >= MAXIMO_FALLOS) {
    r.bloqueadoHasta = ahora + Math.min(PRIMER_BLOQUEO_MS * 2 ** r.bloqueos, BLOQUEO_MAXIMO_MS);
    r.bloqueos++;
    r.fallos.clear();
  }
  porIp.set(ip, r);
}

function mensajeDeEspera(ms) {
  const minutos = Math.ceil(ms / 60000);
  return `Demasiados intentos con PIN equivocado. Esperá ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y probá de nuevo.`;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [ip, r] of porIp) {
    if (r.bloqueadoHasta <= ahora && ahora - r.ultimoFallo > OLVIDO_MS) porIp.delete(ip);
  }
}, 5 * 60 * 1000).unref();

module.exports = { ipDe, esperaDe, anotarFallo, mensajeDeEspera };
