// ===================== Páginas traídas por Conexiones =====================
// Muchas páginas no se dejan mostrar adentro de otra (X-Frame-Options / frame-ancestors). Para
// esas, el servidor trae la página y se la da a la pantalla y al celular con el puente puesto
// (publico/puente.js): así las dos muestran la página de verdad, fluida, y se mueven juntas,
// sin la app de PC. Pensado para páginas informativas; las que piden cuenta o son aplicaciones
// grandes (YouTube, Google) quedan afuera (ver SIN_TRAER en pantalla.js).
//
// Cuidados:
//  - Sin firma no se trae nada: /api/traer/firma (con PIN) da la firma de un sitio que la persona
//    tiene en su lista, y sólo con ella se pueden pedir sus páginas. Además sólo se entrega
//    adentro de un recuadro de Conexiones, nunca abierta sola en una pestaña.
//  - La página traída va con «Content-Security-Policy: sandbox»: queda con un origen propio y no
//    puede leer nada de Conexiones (el PIN guardado, la sesión), ni siquiera abierta sola.
//  - No se traen direcciones de la red interna (localhost, 10.x, 192.168.x…), tampoco después de
//    una redirección. Sólo HTML, hasta 3 MB y 10 segundos.
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { requierePersona } = require('./personas');
const { limpiarDireccion } = require('./validadores-pagina');
const { paginasDe } = require('./diapositivas');

const SECRETO = process.env.PIN_SECRETO || crypto.randomBytes(32).toString('hex');
const TOPE_BYTES = 3 * 1024 * 1024;
const TOPE_MS = 10000;
const SALTOS = 5;
const PEDIDOS_POR_MINUTO = 120;
// Sólo para las pruebas en la PC (sitios de prueba en localhost). Nunca en Render.
const PERMITIR_LOCAL = process.env.TRAER_LOCAL === '1';

function firmaDe(origen) {
  return crypto.createHmac('sha256', SECRETO).update('traer:' + origen).digest('base64url').slice(0, 22);
}

function firmaValida(origen, firma) {
  const buena = Buffer.from(firmaDe(origen));
  const dada = Buffer.from(String(firma || ''));
  return buena.length === dada.length && crypto.timingSafeEqual(buena, dada);
}

function ipInterna(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return ipInterna(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80');
}

async function sePuedeTraer(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (PERMITIR_LOCAL) return true;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !ipInterna(host);
  try {
    const ips = await dns.lookup(host, { all: true });
    return ips.length > 0 && ips.every(r => !ipInterna(r.address));
  } catch { return false; }
}

class NoSeTrajo extends Error {}

async function leerConTope(respuesta) {
  const partes = [];
  let total = 0;
  for await (const parte of respuesta.body) {
    total += parte.length;
    if (total > TOPE_BYTES) throw new NoSeTrajo('La página es demasiado grande.');
    partes.push(Buffer.from(parte));
  }
  return Buffer.concat(partes);
}

async function traer(direccion) {
  let url = new URL(direccion);
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TOPE_MS);
  try {
    for (let salto = 0; salto <= SALTOS; salto++) {
      if (!(await sePuedeTraer(url))) throw new NoSeTrajo('Esa dirección no se puede traer.');
      const respuesta = await fetch(url, {
        redirect: 'manual',
        signal: control.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es,en;q=0.8'
        }
      });
      const destino = respuesta.headers.get('location');
      if (respuesta.status >= 300 && respuesta.status < 400 && destino) {
        url = new URL(destino, url);
        continue;
      }
      const tipo = respuesta.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml/i.test(tipo)) throw new NoSeTrajo('Eso no es una página web.');
      const cuerpo = await leerConTope(respuesta);
      const juego = (/charset=([\w-]+)/i.exec(tipo) || [])[1] || 'utf-8';
      let html;
      try { html = new TextDecoder(juego).decode(cuerpo); } catch { html = cuerpo.toString('utf8'); }
      return { direccion: url.href, html };
    }
    throw new NoSeTrajo('La página redirige demasiadas veces.');
  } catch (error) {
    if (error instanceof NoSeTrajo) throw error;
    throw new NoSeTrajo(error.name === 'AbortError' ? 'La página tardó demasiado.' : 'No se pudo traer la página.');
  } finally {
    clearTimeout(reloj);
  }
}

const comillas = (texto) => texto.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Lo que se agrega al principio de la página traída: dónde está de verdad (para los enlaces y las
// imágenes), lo que el puente necesita saber, lo guardado en memoria (con el sandbox la página no
// tiene lugar propio donde guardar) y los enlaces del mismo sitio, que se abren también traídos.
function prepararPagina(html, direccion, conexiones, firma) {
  const traida = {
    origen: new URL(direccion).origin,
    direccion,
    abrir: conexiones + '/traer?f=' + encodeURIComponent(firma) + '&u='
  };
  const datos = JSON.stringify(traida).replace(/</g, '\\u003c');
  const cabeza = `<base href="${comillas(direccion)}"><script>
window.CONEXIONES_TRAIDA = ${datos};
(function () {
  var T = window.CONEXIONES_TRAIDA;
  function memoria() {
    var d = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
      setItem: function (k, v) { d[k] = String(v); },
      removeItem: function (k) { delete d[k]; },
      clear: function () { d = {}; },
      key: function (i) { return Object.keys(d)[i] || null; },
      get length() { return Object.keys(d).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (nombre) {
    try { window[nombre].length; } catch (e) { try { Object.defineProperty(window, nombre, { value: memoria(), configurable: true }); } catch (e2) {} }
  });
  try { document.cookie; } catch (e) { try { var galleta = ''; Object.defineProperty(document, 'cookie', { get: function () { return galleta; }, set: function () {}, configurable: true }); } catch (e2) {} }
  document.addEventListener('click', function (evento) {
    var enlace = evento.target && evento.target.closest && evento.target.closest('a[href]');
    if (!enlace || evento.defaultPrevented || (enlace.target && enlace.target !== '_self')) return;
    var destino;
    try { destino = new URL(enlace.href); } catch (e) { return; }
    if (destino.origin !== T.origen) return;
    var aqui = new URL(T.direccion);
    if (destino.pathname === aqui.pathname && destino.search === aqui.search && destino.hash) return;
    evento.preventDefault();
    location.href = T.abrir + encodeURIComponent(destino.href);
  });
})();
</script><script src="${comillas(conexiones)}/puente.js"></script>`;
  html = html
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(content-security-policy|x-frame-options)[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '');
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (etiqueta) => etiqueta + cabeza) : cabeza + html;
}

// Tope de pedidos por IP, para que nadie use al servidor para bajar páginas sin parar.
const pedidosPorIp = new Map();
function demasiados(ip) {
  const ahora = Date.now();
  const cuenta = pedidosPorIp.get(ip);
  if (!cuenta || ahora - cuenta.desde > 60000) { pedidosPorIp.set(ip, { desde: ahora, n: 1 }); return false; }
  cuenta.n++;
  return cuenta.n > PEDIDOS_POR_MINUTO;
}
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, cuenta] of pedidosPorIp) if (ahora - cuenta.desde > 60000) pedidosPorIp.delete(ip);
}, 60000).unref();

// Si no se pudo traer, la página avisa enseguida a la pantalla o al celular, que vuelven a
// mostrarla como antes (tal cual, o con la app de PC).
function paginaDeError(mensaje) {
  return `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:24px;color:#333">${comillas(mensaje)}` +
    `<script>parent.postMessage({ conexiones: true, tipo: 'noTraida' }, '*');</script></body>`;
}

function registrarRutasTraerPagina(app) {
  // GET /api/traer/firma?u=… — con PIN. Devuelve la firma del sitio de esa dirección, sólo si es
  // de una página que la persona tiene en su lista.
  app.get('/api/traer/firma', requierePersona, (req, res) => {
    const direccion = limpiarDireccion(String(req.query.u || ''));
    if (!direccion) return res.status(400).json({ error: 'Esa dirección no sirve.' });
    const origen = new URL(direccion).origin;
    if (!paginasDe(req.person).some(pagina => new URL(pagina).origin === origen)) {
      return res.status(403).json({ error: 'Esa página no está en tu lista.' });
    }
    res.json({ firma: firmaDe(origen) });
  });

  // GET /traer?f=…&u=… — la página traída, con el puente puesto y encerrada en su caja.
  app.get('/traer', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'self'; object-src 'none'");
    const direccion = limpiarDireccion(String(req.query.u || ''));
    if (!direccion || !firmaValida(new URL(direccion).origin, req.query.f)) {
      return res.status(403).send(paginaDeError('Esta página no se puede mostrar desde acá.'));
    }
    // Sólo adentro del recuadro de Conexiones: abierta sola en una pestaña no se entrega, así nadie
    // puede hacer pasar una página ajena por una de Conexiones.
    const destino = req.get('sec-fetch-dest');
    if (destino && destino !== 'iframe') return res.status(403).send(paginaDeError('Esta página sólo se ve adentro de Conexiones.'));
    if (demasiados(req.ip)) return res.status(429).send(paginaDeError('Demasiados pedidos: esperá un minuto.'));
    try {
      const { direccion: final, html } = await traer(direccion);
      const conexiones = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim() + '://' + req.get('host');
      // Si la página redirigió a otro sitio, sus enlaces se firman con ese sitio.
      res.send(prepararPagina(html, final, conexiones, firmaDe(new URL(final).origin)));
    } catch (error) {
      res.status(502).send(paginaDeError(error instanceof NoSeTrajo ? error.message : 'No se pudo traer la página.'));
    }
  });
}

module.exports = { registrarRutasTraerPagina, firmaDe, prepararPagina, ipInterna };
