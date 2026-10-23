// ---- Cuenta de Google y «Me olvidé el PIN» ----
// Cada persona puede unir su cuenta de Google (se guarda su correo). Si olvida el PIN, escribe
// ese correo, le llega un código de 6 números y con él recibe un PIN nuevo.
// Google sólo se usa para comprobar que el correo es de la persona: no se pide ningún otro permiso.
// Los correos los manda un Google Apps Script en la cuenta de Gmail del dueño de Conexiones
// (Render gratis bloquea el correo común): variables CORREO_SCRIPT_URL y CORREO_SCRIPT_CLAVE.
const crypto = require('crypto');
const fs = require('fs');
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { requierePersona, darPinNuevo, ipDelPedido, nombresDePersonas } = require('./personas');

// El ID de cliente de Google no es secreto (cualquier página que use el botón lo muestra).
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '556432634806-ghhkmo0nrjohoqgt3nfj481cofiruca1.apps.googleusercontent.com';
const CODIGO_VIVE_MS = 15 * 60 * 1000;
const INTENTOS_POR_CODIGO = 5;

const almacenGoogle = crearAlmacen({
  archivo: 'cuentas-google.json',
  idNube: 'presentacion/cuentas-google',
  elQue: 'las cuentas de Google',
  tabla: {
    nombre: 'cuentas_google',
    clave: 'dueno',
    columnas: { dueno: 'TEXT PRIMARY KEY', sub: 'TEXT NOT NULL UNIQUE', correo: 'TEXT NOT NULL' },
    aFila: r => ({ dueno: r.owner, sub: r.sub, correo: r.correo }),
    deFila: f => ({ owner: f.dueno, sub: f.sub, correo: f.correo })
  }
});

function correoLimpio(texto) {
  return String(texto || '').trim().toLowerCase().slice(0, 200);
}

function unidaDe(nombre) {
  return almacenGoogle.actual().find(r => r.owner === nombre) || null;
}

// Para cuando el admin borra cuentas.
async function borrarGoogleDe(nombres) {
  const quitar = new Set(nombres);
  await almacenGoogle.modificar((lista) => {
    const quedan = lista.filter(r => !quitar.has(r.owner));
    return quedan.length === lista.length ? SIN_CAMBIOS : quedan;
  });
}

// Pregunta a Google si la credencial del botón es de verdad y para Conexiones.
async function comprobarCredencial(credencial) {
  if (typeof credencial !== 'string' || credencial.length > 4096) return null;
  let datos;
  try {
    // GOOGLE_TOKENINFO_URL sólo existe en las pruebas de la PC (un Google falso local).
    const base = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
    const res = await fetch(base + '?id_token=' + encodeURIComponent(credencial), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    datos = await res.json();
  } catch {
    const error = new Error('No se pudo hablar con Google. Probá de nuevo en un momento.');
    error.estado = 503;
    throw error;
  }
  const emisorBien = datos.iss === 'accounts.google.com' || datos.iss === 'https://accounts.google.com';
  const vigente = Number(datos.exp) * 1000 > Date.now();
  const verificado = datos.email_verified === true || datos.email_verified === 'true';
  if (datos.aud !== GOOGLE_ID || !emisorBien || !vigente || !verificado || !datos.sub || !datos.email) return null;
  return { sub: String(datos.sub), correo: correoLimpio(datos.email) };
}

// ---- Envío del correo ----
function correoActivo() {
  return Boolean((process.env.CORREO_SCRIPT_URL && process.env.CORREO_SCRIPT_CLAVE) || process.env.CORREO_DE_PRUEBA);
}

function textoHtml(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function mandarCodigo(para, nombre, codigo) {
  // Sólo para pruebas en la PC: el código queda en un archivo en vez de mandarse.
  if (process.env.CORREO_DE_PRUEBA && !process.env.CORREO_SCRIPT_URL) {
    fs.writeFileSync(process.env.CORREO_DE_PRUEBA, JSON.stringify({ para, nombre, codigo }));
    return;
  }
  const asunto = `Tu código de Conexiones: ${codigo}`;
  const texto = `Hola, ${nombre}:\n\nPediste un PIN nuevo para entrar a Conexiones. Tu código es:\n\n    ${codigo}\n\n` +
    'Escribilo en la página. Vence en 15 minutos.\nSi no lo pediste vos, no hagas nada: tu PIN sigue igual.\n\nConexiones';
  const cifras = codigo.split('').map(c => `<td style="width:42px;height:52px;background:#0f1a24;border:2px solid #34cdfa;border-radius:10px;text-align:center;font-size:28px;font-weight:bold;color:#e6f9ff">${c}</td><td style="width:6px"></td>`).join('');
  const html = `<div style="background:#e9eef3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
 <div style="max-width:500px;margin:auto;background:#0b1016;color:#f2f5f8;border-radius:18px;overflow:hidden">
  <div style="padding:20px 26px;background:#10161d;border-bottom:3px solid #34cdfa"><b style="font-size:18px">📺 Conexiones</b></div>
  <div style="padding:24px 26px 28px">
   <p style="font-size:17px;margin:0 0 10px">Hola, ${textoHtml(nombre)}:</p>
   <p style="color:#b8c4cf;line-height:1.55;margin:0 0 18px">Pediste un PIN nuevo para entrar a Conexiones. Este es tu código:</p>
   <table role="presentation" style="border-collapse:separate;margin:0 auto 18px"><tr>${cifras}</tr></table>
   <p style="color:#b8c4cf;line-height:1.55;margin:0">Escribilo en la página. <b style="color:#34cdfa">Vence en 15 minutos.</b></p>
   <p style="color:#8d99a6;font-size:14px;line-height:1.5;margin:16px 0 0">Si no lo pediste vos, no hagas nada: tu PIN sigue igual.</p>
  </div>
 </div>
</div>`;
  const res = await fetch(process.env.CORREO_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave: process.env.CORREO_SCRIPT_CLAVE, para, asunto, texto, html }),
    signal: AbortSignal.timeout(30000)
  });
  const cuerpo = await res.text();
  let resultado = null;
  try { resultado = JSON.parse(cuerpo); } catch { /* contestó una página: mal publicado */ }
  if (!resultado || !resultado.ok) throw new Error('El script de correo no envió: ' + (resultado ? resultado.error : 'respuesta rara (¿«Cualquier usuario»?)'));
}

// ---- Códigos y topes ----
const codigos = new Map(); // correo → { huella, dueno, vence, intentos }
const pedidosPorIp = new Map(); // ip → [momentos]
const pedidosPorCorreo = new Map(); // correo → [momentos]
let enviadosHoy = { dia: '', cuantos: 0 };
const TOPE_IP = 5;          // pedidos de código por IP cada 15 minutos
const TOPE_CORREO = 3;      // códigos al mismo correo cada 15 minutos
const TOPE_DIA = 90;        // Gmail gratis manda unos 100 por día con el script

function huellaCodigo(codigo) {
  return crypto.createHash('sha256').update('conexiones-codigo:' + codigo).digest('hex');
}
// Devuelve 0 si se puede (y lo anota) o cuántos segundos hay que esperar.
function pasaTope(mapa, clave, tope) {
  const ahora = Date.now();
  const lista = (mapa.get(clave) || []).filter(t => ahora - t < CODIGO_VIVE_MS);
  if (lista.length >= tope) { mapa.set(clave, lista); return Math.ceil((lista[0] + CODIGO_VIVE_MS - ahora) / 1000); }
  lista.push(ahora);
  mapa.set(clave, lista);
  return 0;
}
// Después de equivocarse el código varias veces, ese correo queda bloqueado un rato (con reloj).
const BLOQUEO_MS = 5 * 60 * 1000;
const bloqueos = new Map(); // correo → hasta cuándo
function esperaBloqueo(correo) {
  const hasta = bloqueos.get(correo) || 0;
  return hasta > Date.now() ? Math.ceil((hasta - Date.now()) / 1000) : 0;
}
function contestarEspera(res, segundos, mensaje) {
  res.set('Retry-After', String(segundos));
  return res.status(429).json({ error: mensaje, esperaSegundos: segundos });
}
setInterval(() => {
  const ahora = Date.now();
  for (const [c, hasta] of bloqueos) if (hasta < ahora) bloqueos.delete(c);
  for (const [c, v] of codigos) if (v.vence < ahora) codigos.delete(c);
  for (const mapa of [pedidosPorIp, pedidosPorCorreo]) {
    for (const [k, lista] of mapa) if (!lista.some(t => ahora - t < CODIGO_VIVE_MS)) mapa.delete(k);
  }
}, 5 * 60 * 1000).unref();

function registrarRutasCuentaGoogle(app) {
  // GET /api/cuenta — si la cuenta está unida a Google y con qué correo (para «Mi cuenta»).
  app.get('/api/cuenta', requierePersona, (req, res) => {
    const unida = req.person.isAdmin ? null : unidaDe(req.person.name);
    res.json({ googleId: GOOGLE_ID, correo: unida ? unida.correo : null, puedeUnir: !req.person.isAdmin });
  });

  // POST /api/cuenta/google { credencial } — une (o cambia) la cuenta de Google.
  app.post('/api/cuenta/google', requierePersona, async (req, res) => {
    try {
      if (req.person.isAdmin) return res.status(400).json({ error: 'La cuenta del admin no se une a Google.' });
      const g = await comprobarCredencial((req.body || {}).credencial);
      if (!g) return res.status(400).json({ error: 'Google no confirmó la cuenta. Probá de nuevo.' });
      const otra = almacenGoogle.actual().find(r => (r.sub === g.sub || r.correo === g.correo) && r.owner !== req.person.name);
      if (otra) return res.status(409).json({ error: 'Esa cuenta de Google ya está unida a otra cuenta de Conexiones.' });
      await almacenGoogle.modificar((lista) => {
        const quedan = lista.filter(r => r.owner !== req.person.name);
        quedan.push({ owner: req.person.name, sub: g.sub, correo: g.correo });
        return quedan;
      });
      res.json({ correo: g.correo });
    } catch (err) {
      if (err.estado) return res.status(err.estado).json({ error: err.message });
      console.error('Unir con Google:', err);
      res.status(500).json({ error: 'No se pudo unir la cuenta. Probá de nuevo.' });
    }
  });

  // DELETE /api/cuenta/google — deja de estar unida.
  app.delete('/api/cuenta/google', requierePersona, async (req, res) => {
    try {
      await almacenGoogle.modificar((lista) => {
        const quedan = lista.filter(r => r.owner !== req.person.name);
        return quedan.length === lista.length ? SIN_CAMBIOS : quedan;
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo quitar. Probá de nuevo.' });
    }
  });

  // POST /api/recuperar/pedir { correo } — manda el código si el correo está unido a una cuenta.
  // Si no lo está, lo dice claro (el usuario lo pidió así: si no, se quedaba esperando un correo
  // que nunca llegaba).
  const AVISO = 'Listo: te mandamos un código a tu correo. Llega en un minuto; mirá también en «Spam».';
  app.post('/api/recuperar/pedir', async (req, res) => {
    try {
      const correo = correoLimpio((req.body || {}).correo);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return res.status(400).json({ error: 'Escribí tu correo completo (ejemplo: nombre@gmail.com).' });
      if (!correoActivo()) return res.status(503).json({ error: 'Todavía no está activado el envío de correos. Pedile al admin que te dé un PIN nuevo.' });
      const bloqueo = esperaBloqueo(correo);
      if (bloqueo) return contestarEspera(res, bloqueo, 'Muchos intentos con ese correo.');
      const esperaIp = pasaTope(pedidosPorIp, ipDelPedido(req), TOPE_IP);
      if (esperaIp) return contestarEspera(res, esperaIp, 'Pediste muchos códigos.');
      const unida = almacenGoogle.actual().find(r => r.correo === correo);
      if (!unida || !nombresDePersonas().includes(unida.owner)) {
        return res.status(404).json({ error: 'Ese correo no está unido a ninguna cuenta de Conexiones. Revisá que esté bien escrito. Si nunca uniste tu Google, pedile al admin un PIN nuevo.' });
      }
      const esperaCorreo = pasaTope(pedidosPorCorreo, correo, TOPE_CORREO);
      if (esperaCorreo) return contestarEspera(res, esperaCorreo, 'Ya te mandamos varios códigos. Usá el último que llegó.');
      const hoy = new Date().toISOString().slice(0, 10);
      if (enviadosHoy.dia !== hoy) enviadosHoy = { dia: hoy, cuantos: 0 };
      if (enviadosHoy.cuantos >= TOPE_DIA) return res.status(429).json({ error: 'Hoy ya se mandaron muchos correos. Probá mañana o pedile al admin un PIN nuevo.' });
      const codigo = String(crypto.randomInt(100000, 1000000));
      await mandarCodigo(correo, unida.owner, codigo);
      enviadosHoy.cuantos++;
      codigos.set(correo, { huella: huellaCodigo(codigo), dueno: unida.owner, vence: Date.now() + CODIGO_VIVE_MS, intentos: 0 });
      res.json({ aviso: AVISO });
    } catch (err) {
      console.error('Mandar código:', err.message);
      res.status(502).json({ error: 'No se pudo mandar el correo. Probá de nuevo en un momento.' });
    }
  });

  // POST /api/recuperar/confirmar { correo, codigo } — con el código bien, da un PIN nuevo.
  app.post('/api/recuperar/confirmar', async (req, res) => {
    try {
      const correo = correoLimpio((req.body || {}).correo);
      const codigo = String((req.body || {}).codigo || '').replace(/\D/g, '');
      const bloqueo = esperaBloqueo(correo);
      if (bloqueo) return contestarEspera(res, bloqueo, 'Muchos intentos con ese correo.');
      const guardado = codigos.get(correo);
      if (!guardado || guardado.vence < Date.now()) {
        codigos.delete(correo);
        return res.status(400).json({ error: 'Ese código venció o no existe. Pedí uno nuevo.' });
      }
      const x = Buffer.from(huellaCodigo(codigo));
      const y = Buffer.from(guardado.huella);
      if (codigo.length !== 6 || !crypto.timingSafeEqual(x, y)) {
        guardado.intentos++;
        if (guardado.intentos >= INTENTOS_POR_CODIGO) {
          codigos.delete(correo);
          bloqueos.set(correo, Date.now() + BLOQUEO_MS);
          return contestarEspera(res, Math.ceil(BLOQUEO_MS / 1000), 'Muchos intentos con ese correo.');
        }
        const quedan = INTENTOS_POR_CODIGO - guardado.intentos;
        return res.status(400).json({ error: `Ese código no es. Fijate en el correo (te quedan ${quedan} intento${quedan === 1 ? '' : 's'}).` });
      }
      codigos.delete(correo);
      const pin = await darPinNuevo(guardado.dueno);
      if (!pin) return res.status(404).json({ error: 'Esa cuenta ya no existe.' });
      res.json({ name: guardado.dueno, pin, isAdmin: false });
    } catch (err) {
      console.error('Confirmar código:', err);
      res.status(500).json({ error: 'No se pudo dar el PIN nuevo. Probá de nuevo.' });
    }
  });
}

module.exports = { registrarRutasCuentaGoogle, borrarGoogleDe };
