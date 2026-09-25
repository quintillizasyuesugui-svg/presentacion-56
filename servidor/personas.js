// ---- Personas y PIN (para /gestionar.html y /avanzado.html) ----
// El sistema se encarga solo: cada persona se registra una vez con su nombre,
// el servidor le da un PIN único de 4 dígitos (nadie lo elige a mano), y desde
// ahí ese PIN identifica sus imágenes.
// El PIN no se guarda escrito: sólo su huella (HMAC-SHA256 con PIN_SECRETO), así
// quien llegara a ver los datos guardados no ve el PIN de nadie.
// ADMIN_PIN (opcional, variable de entorno) ve y controla las imágenes de todos.
const crypto = require('crypto');
const { ADMIN_PIN } = require('./configuracion');
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { ipDe, esperaDe, anotarFallo, mensajeDeEspera } = require('./limite-intentos');

const NOMBRE_ADMIN = 'admin';
const DIGITOS_PIN = 4;
// Con PIN_SECRETO (en Render: Environment), ni teniendo los datos se puede averiguar un PIN.
// Nunca cambiarlo después: las huellas guardadas dejarían de coincidir y nadie podría entrar.
const SECRETO = process.env.PIN_SECRETO || null;
const CLAVE_SIN_SECRETO = 'conexiones-pin';
if (!SECRETO) console.warn('⚠️  PIN_SECRETO no está definido: los PIN se guardan con una clave fija. Ver README, «PIN por persona».');

function huella(pin, conSecreto) {
  return crypto.createHmac('sha256', conSecreto ? SECRETO : CLAVE_SIN_SECRETO).update(String(pin)).digest('hex');
}

// Las cuentas de antes tenían el PIN escrito ({ pin, name }): al cargar se pasa a su huella.
function cifrarPinesViejos(personas) {
  return personas.map(p => (p.pin === undefined ? p : { name: p.name, pinHash: huella(p.pin, Boolean(SECRETO)), conSecreto: Boolean(SECRETO) }));
}

const almacenPersonas = crearAlmacen({
  archivo: 'personas.json',
  archivoViejo: 'people.json',
  idNube: 'presentacion/people',
  elQue: 'las personas',
  tabla: {
    nombre: 'personas',
    clave: 'nombre',
    columnas: { nombre: 'TEXT PRIMARY KEY', pin_hash: 'TEXT NOT NULL UNIQUE', con_secreto: 'BOOLEAN NOT NULL DEFAULT false' },
    aFila: p => ({ nombre: p.name, pin_hash: p.pinHash, con_secreto: Boolean(p.conSecreto) }),
    deFila: f => ({ name: f.nombre, pinHash: f.pin_hash, conSecreto: f.con_secreto })
  },
  normalizar: cifrarPinesViejos
});

// Índice huella → persona, rehecho sólo cuando cambia la lista.
let indice = { personas: null, porHuella: new Map() };
function buscarPorHuella(h) {
  const personas = almacenPersonas.actual();
  if (indice.personas !== personas) indice = { personas, porHuella: new Map(personas.map(p => [p.pinHash, p])) };
  return indice.porHuella.get(h);
}

function pinEnUso(pin) {
  return (ADMIN_PIN && pin === ADMIN_PIN) || Boolean(SECRETO && buscarPorHuella(huella(pin, true))) || Boolean(buscarPorHuella(huella(pin, false)));
}

// PIN al azar (criptográfico) de 4 dígitos que no choque con otro ni con el ADMIN_PIN
// (antes podía tocar el mismo que el admin, y esa persona entraba como admin).
// Hay 9.000 PIN posibles: si casi todos están usados, se corta en vez de probar para siempre.
function generarPin() {
  for (let intento = 0; intento < 50000; intento++) {
    const pin = String(crypto.randomInt(10 ** (DIGITOS_PIN - 1), 10 ** DIGITOS_PIN));
    if (!pinEnUso(pin)) return pin;
  }
  throw new Error('No quedan PIN libres.');
}

// Si el nombre ya está tomado, no le presta el PIN ajeno (sería dejar entrar a
// alguien a las fotos de otro con sólo adivinar su nombre) — le arma uno propio.
// «admin» está reservado: es el nombre del ADMIN_PIN, y quien se llamara así vería sus imágenes.
function nombreUnico(base, personas) {
  const usados = new Set([NOMBRE_ADMIN, ...personas.map(p => p.name.toLowerCase())]);
  if (!usados.has(base.toLowerCase())) return base;
  let n = 2;
  while (usados.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

function igualSeguro(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Una cuenta guardada con la clave fija (de antes de definir PIN_SECRETO) pasa a la secreta
// la primera vez que entra, porque recién ahí se conoce su PIN.
function pasarASecreto(nombre, pin) {
  almacenPersonas.modificar((personas) => {
    const p = personas.find(x => x.name === nombre && !x.conSecreto);
    if (!p) return SIN_CAMBIOS;
    p.pinHash = huella(pin, true);
    p.conSecreto = true;
  }).catch(err => console.error('No se pudo actualizar el PIN de', nombre, err.message));
}

async function identificar(pin) {
  if (!pin) return null;
  pin = String(pin);
  if (ADMIN_PIN && igualSeguro(pin, ADMIN_PIN)) return { name: NOMBRE_ADMIN, isAdmin: true };
  if (SECRETO) {
    const p = buscarPorHuella(huella(pin, true));
    if (p && p.conSecreto) return { name: p.name, isAdmin: false };
  }
  const p = buscarPorHuella(huella(pin, false));
  if (!p || p.conSecreto) return null;
  if (SECRETO) pasarASecreto(p.name, pin);
  return { name: p.name, isAdmin: false };
}

// Identifica respetando el límite de intentos. Devuelve { persona } o { estado, error }.
async function identificarDesde(ip, pin) {
  const espera = esperaDe(ip);
  if (espera) return { estado: 429, error: mensajeDeEspera(espera) };
  const persona = await identificar(pin);
  if (persona) return { persona };
  if (pin) anotarFallo(ip, pin);
  return { estado: 401 };
}

function ipDelPedido(req) {
  return ipDe(req.headers, req.socket.remoteAddress);
}

// Middleware: exige el PIN en la cabecera "x-pin" y deja a la persona en req.person.
async function requierePersona(req, res, next) {
  try {
    const r = await identificarDesde(ipDelPedido(req), req.get('x-pin'));
    if (!r.persona) return res.status(r.estado).json({ error: r.error || 'PIN inválido o faltante.' });
    req.person = r.persona;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en servidor' });
  }
}

// Middleware: además del PIN, exige que sea el admin (ADMIN_PIN).
function requiereAdmin(req, res, next) {
  requierePersona(req, res, () => {
    if (!req.person.isAdmin) return res.status(403).json({ error: 'Sólo el admin puede hacer esto.' });
    next();
  });
}

// Lista de personas registradas (sin sus PIN), para la sección de admin.
function nombresDePersonas() {
  return almacenPersonas.actual().map(p => p.name);
}

// Borra una o varias cuentas: su PIN deja de servir. Devuelve cuántas borró.
async function borrarPersonas(nombres) {
  const quitar = new Set(nombres);
  let borradas = 0;
  await almacenPersonas.modificar((personas) => {
    const quedan = personas.filter(p => !quitar.has(p.name));
    borradas = personas.length - quedan.length;
    return borradas ? quedan : SIN_CAMBIOS;
  });
  return borradas;
}

// Qué ve cada uno: admin ve todo, cualquier otra persona sólo lo que subió ella.
function visiblePara(persona, orden) {
  return persona.isAdmin ? orden : orden.filter(r => r.owner === persona.name);
}

function registrarRutasPersonas(app) {
  // POST /api/auth/register — alta nueva: el sistema genera el PIN, nadie lo elige.
  app.post('/api/auth/register', async (req, res) => {
    try {
      const crudo = String((req.body || {}).name || '').trim().slice(0, 40);
      if (!crudo) return res.status(400).json({ error: 'Escribí tu nombre.' });

      let alta;
      await almacenPersonas.modificar((personas) => {
        const name = nombreUnico(crudo, personas);
        const pin = generarPin();
        personas.push({ name, pinHash: huella(pin, Boolean(SECRETO)), conSecreto: Boolean(SECRETO) });
        alta = { name, pin, isAdmin: false };
      });
      res.json(alta);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo registrar.' });
    }
  });

  // POST /api/auth/login — volver a entrar con un PIN ya asignado (ej. otro celular).
  app.post('/api/auth/login', async (req, res) => {
    try {
      const r = await identificarDesde(ipDelPedido(req), (req.body || {}).pin);
      if (!r.persona) return res.status(r.estado).json({ error: r.error || 'PIN incorrecto.' });
      res.json(r.persona);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en servidor' });
    }
  });
}

module.exports = { identificar, identificarDesde, requierePersona, requiereAdmin, visiblePara, registrarRutasPersonas, nombresDePersonas, borrarPersonas, NOMBRE_ADMIN };
