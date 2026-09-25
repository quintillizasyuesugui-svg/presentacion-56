// ---- Personas y PIN (para /gestionar.html y /avanzado.html) ----
// El sistema se encarga solo: cada persona se registra una vez con su nombre,
// el servidor le da un PIN de 4 dígitos único (nadie lo elige a mano), y desde
// ahí ese PIN identifica sus imágenes. Se guarda en datos/personas.json con
// respaldo en Cloudinary como JSON crudo para que sobreviva a los reinicios de
// Render aunque no haya una base de datos real.
// ADMIN_PIN (opcional, variable de entorno) ve y controla las imágenes de todos.
const { ADMIN_PIN } = require('./configuracion');
const { crearAlmacenJson } = require('./almacen');

const almacenPersonas = crearAlmacenJson({
  archivo: 'personas.json',
  archivoViejo: 'people.json',
  idNube: 'presentacion/people',
  que: 'personas',
  elQue: 'las personas'
});

async function leerPersonas() {
  return (await almacenPersonas.leer()) || [];
}

// PIN de 4 dígitos (1000-9999) que no choque con uno ya asignado.
function generarPin(personas) {
  const usados = new Set(personas.map(p => p.pin));
  let pin;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (usados.has(pin));
  return pin;
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

const NOMBRE_ADMIN = 'admin';

async function identificar(pin) {
  if (!pin) return null;
  if (ADMIN_PIN && pin === ADMIN_PIN) return { name: NOMBRE_ADMIN, isAdmin: true };
  const persona = (await leerPersonas()).find(p => p.pin === pin);
  return persona ? { name: persona.name, isAdmin: false } : null;
}

// Middleware: exige el PIN en la cabecera "x-pin" y deja a la persona en req.person.
async function requierePersona(req, res, next) {
  try {
    const persona = await identificar(req.get('x-pin'));
    if (!persona) return res.status(401).json({ error: 'PIN inválido o faltante.' });
    req.person = persona;
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
async function nombresDePersonas() {
  return (await leerPersonas()).map(p => p.name);
}

// Borra la cuenta: su PIN deja de servir. Devuelve false si no existía.
async function borrarPersona(nombre) {
  const personas = await leerPersonas();
  const quedan = personas.filter(p => p.name !== nombre);
  if (quedan.length === personas.length) return false;
  await almacenPersonas.escribir(quedan);
  return true;
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

      const personas = await leerPersonas();
      const name = nombreUnico(crudo, personas);
      const pin = generarPin(personas);
      personas.push({ pin, name });
      await almacenPersonas.escribir(personas);
      res.json({ name, pin, isAdmin: false });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo registrar.' });
    }
  });

  // POST /api/auth/login — volver a entrar con un PIN ya asignado (ej. otro celular).
  app.post('/api/auth/login', async (req, res) => {
    const persona = await identificar((req.body || {}).pin);
    if (!persona) return res.status(401).json({ error: 'PIN incorrecto.' });
    res.json(persona);
  });
}

module.exports = { identificar, requierePersona, requiereAdmin, visiblePara, registrarRutasPersonas, nombresDePersonas, borrarPersona, NOMBRE_ADMIN };
