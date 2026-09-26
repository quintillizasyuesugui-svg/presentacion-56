// ---- Música y videos de cada persona ----
// Cada persona sube sus canciones y videos (o guarda un enlace de YouTube) desde
// multimedia.html y los maneja desde el celular mientras presenta; suenan en SU pantalla.
//
// Dónde quedan los archivos:
//  - Con Cloudinary: el celular los sube directo a Cloudinary con una firma que da este
//    servidor (así un video de 100 MB no pasa por la memoria de Render). Al terminar,
//    el servidor comprueba en Cloudinary qué se subió de verdad y recién ahí lo anota.
//  - Sin Cloudinary y con DOCUMENTOS_SIN_NUBE_LOCAL=1 (para probar en la PC): en
//    publico/multimedia/.
// Los enlaces de YouTube sólo guardan el enlace: no ocupan espacio.
//
// Cada persona tiene su propio espacio, que se calcula solo repartiendo PRESUPUESTO_MB entre
// las personas registradas (ver configuracion.js); el admin puede fijarle otro a alguien.
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { CARPETA_MULTIMEDIA, PRESUPUESTO_MB, ESPACIO_MIN_MB, ESPACIO_MAX_MB, cloudinary, nubeLista } = require('./configuracion');
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { requierePersona, visiblePara, nombresDePersonas } = require('./personas');
const { enFila, anotar, explicarEspacio } = require('./guardian');

const MB = 1024 * 1024;
const LIMITE_BYTES = { musica: 15 * MB, video: 100 * MB };
const EXTENSIONES = {
  musica: ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.weba'],
  video: ['.mp4', '.m4v', '.webm', '.mov']
};
const CARPETA_NUBE = 'presentacion/multimedia';
const VIGENCIA_FIRMA_MS = 2 * 60 * 60 * 1000;
const FIRMAS_SIN_TERMINAR_POR_PERSONA = 6;
const LARGO_NOMBRE = 120;

class ErrorPedido extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

function responderError(res, err, mensajeGeneral) {
  if (err instanceof ErrorPedido || (err && err.guardian)) return res.status(err.estado).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: mensajeGeneral });
}

const almacenMultimedia = crearAlmacen({
  archivo: 'multimedia.json',
  idNube: 'presentacion/multimedia-lista',
  elQue: 'la música y los videos',
  tabla: {
    nombre: 'multimedia',
    clave: 'id',
    ordenada: true,
    columnas: { id: 'TEXT PRIMARY KEY', dueno: 'TEXT', datos: 'JSONB NOT NULL' },
    aFila: ({ id, owner, ...datos }) => ({ id, dueno: owner ?? null, datos }),
    deFila: f => ({ id: f.id, ...f.datos, ...(f.dueno != null ? { owner: f.dueno } : {}) })
  },
  valorInicial: () => []
});

// Espacio fijo, sólo para quien el admin se lo puso a mano: [{ name, mb }]. El resto usa el automático.
const almacenEspacio = crearAlmacen({
  archivo: 'espacio-multimedia.json',
  idNube: 'presentacion/espacio-multimedia',
  elQue: 'el espacio de cada persona',
  tabla: {
    nombre: 'espacio_multimedia',
    clave: 'nombre',
    columnas: { nombre: 'TEXT PRIMARY KEY', megas: 'INTEGER NOT NULL' },
    aFila: e => ({ nombre: e.name, megas: e.mb }),
    deFila: f => ({ name: f.nombre, mb: f.megas })
  },
  valorInicial: () => []
});

let ioActual = null;
function avisarCambio(nombres) {
  if (!ioActual) return;
  for (const n of new Set(nombres)) ioActual.to('owner:' + n).emit('multimediaActualizada');
}

function modoDeSubida() {
  if (nubeLista) return 'nube';
  if (process.env.DOCUMENTOS_SIN_NUBE_LOCAL === '1') return 'local';
  return 'no';
}

// ---- Espacio ----
function usadoPor(nombre) {
  return almacenMultimedia.actual().reduce((suma, r) => suma + (r.owner === nombre ? (r.bytes || 0) : 0), 0);
}

// Calculador: el presupuesto se reparte entre las personas, sin bajar del mínimo ni pasar del máximo.
function repartirEspacio(personas, presupuestoMb, minimoMb, maximoMb) {
  return Math.min(maximoMb, Math.max(minimoMb, Math.floor(presupuestoMb / Math.max(1, personas))));
}

function calculoAutomatico() {
  const personas = nombresDePersonas().length;
  return {
    personas,
    presupuestoMb: PRESUPUESTO_MB,
    minimoMb: ESPACIO_MIN_MB,
    maximoMb: ESPACIO_MAX_MB,
    mbPorPersona: repartirEspacio(personas, PRESUPUESTO_MB, ESPACIO_MIN_MB, ESPACIO_MAX_MB)
  };
}

function megasDe(nombre) {
  const propio = almacenEspacio.actual().find(e => e.name === nombre);
  return propio ? propio.mb : calculoAutomatico().mbPorPersona;
}

function espacioFijoDe(nombre) {
  const propio = almacenEspacio.actual().find(e => e.name === nombre);
  return propio ? propio.mb : null;
}

function espacioDe(nombre) {
  return { usado: usadoPor(nombre), total: megasDe(nombre) * MB };
}

function explicacionDe(nombre) {
  return explicarEspacio({ ...espacioDe(nombre), fijoMb: espacioFijoDe(nombre), calculo: calculoAutomatico() });
}

function comprobarEspacio(nombre, bytesNuevos) {
  const { usado, total } = espacioDe(nombre);
  if (usado + bytesNuevos > total) {
    const libre = Math.max(0, total - usado);
    anotar('almacenamiento', nombre, 'no le alcanzó el espacio', `quería subir ${enMb(bytesNuevos)} y le quedaban ${enMb(libre)}`);
    throw new ErrorPedido(413, `🛡️ No te alcanza el espacio: esto pesa ${enMb(bytesNuevos)} y te quedan ${enMb(libre)}. ${explicacionDe(nombre)} Borrá algo, usá un enlace de YouTube o pedile más espacio al admin.`);
  }
}

function enMb(bytes) {
  return (Math.round((bytes / MB) * 10) / 10).toLocaleString('es') + ' MB';
}

function comprobarTamano(tipo, bytes) {
  if (!(bytes > 0)) throw new ErrorPedido(400, 'El archivo está vacío.');
  if (bytes > LIMITE_BYTES[tipo]) {
    const que = tipo === 'musica' ? 'Cada canción' : 'Cada video';
    throw new ErrorPedido(413, `${que} puede pesar hasta ${enMb(LIMITE_BYTES[tipo])}; este pesa ${enMb(bytes)}.` +
      (tipo === 'video' ? ' Para videos largos usá un enlace de YouTube.' : ''));
  }
}

function comprobarTipo(tipo) {
  if (tipo !== 'musica' && tipo !== 'video') throw new ErrorPedido(400, 'Tipo inválido.');
}

function comprobarExtension(tipo, nombre) {
  const ext = path.extname(String(nombre || '')).toLowerCase();
  if (!EXTENSIONES[tipo].includes(ext)) {
    const lista = EXTENSIONES[tipo].map(e => e.slice(1).toUpperCase()).join(', ');
    throw new ErrorPedido(400, `Ese formato no sirve. ${tipo === 'musica' ? 'Música' : 'Video'}: ${lista}.`);
  }
}

function nombreVisible(nombre) {
  const base = path.basename(String(nombre || ''), path.extname(String(nombre || ''))).trim();
  return (base || 'Sin nombre').slice(0, LARGO_NOMBRE);
}

function duracionValida(d) {
  return Number.isFinite(d) && d > 0 && d < 24 * 3600 ? Math.round(d * 10) / 10 : 0;
}

// Respuesta de GET /api/multimedia y de cada cambio: la lista de la persona y su espacio.
function resumenPara(persona) {
  return {
    elementos: visiblePara(persona, almacenMultimedia.actual()),
    espacio: espacioDe(persona.name),
    explicacion: explicacionDe(persona.name),
    subida: modoDeSubida(),
    limites: { musica: LIMITE_BYTES.musica, video: LIMITE_BYTES.video }
  };
}

async function agregar(registro) {
  await almacenMultimedia.modificar((lista) => { lista.push(registro); });
  avisarCambio([registro.owner]);
}

async function borrarArchivo(registro) {
  if (registro.origen !== 'subido') return;
  if (registro.nube) {
    if (nubeLista) await cloudinary.uploader.destroy(registro.id, { resource_type: 'video', invalidate: true }).catch(() => {});
  } else if (registro.archivo) {
    // «archivo» lo puso el servidor al guardarlo: siempre es un nombre dentro de publico/multimedia.
    await fs.unlink(path.join(CARPETA_MULTIMEDIA, path.basename(registro.archivo))).catch(() => {});
  }
}

// ---- Subidas firmadas a Cloudinary ----
// public_id → { owner, tipo, nombre, vence }. Sólo se puede anotar lo que este servidor firmó.
const firmasPendientes = new Map();
setInterval(() => {
  const ahora = Date.now();
  for (const [id, f] of firmasPendientes) if (f.vence < ahora) firmasPendientes.delete(id);
}, 10 * 60 * 1000).unref();

// ---- YouTube ----
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;
function idDeYoutube(texto) {
  let url;
  try {
    url = new URL(String(texto || '').trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const [, tipo, valor] = url.pathname.split('/');
      if (['shorts', 'embed', 'live', 'v'].includes(tipo)) id = valor;
    }
  }
  return id && ID_YOUTUBE.test(id) ? id : null;
}

async function tituloDeYoutube(id) {
  const direccion = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`;
  try {
    const res = await fetch(direccion, { signal: AbortSignal.timeout(6000) });
    if (res.status === 401 || res.status === 403) throw new ErrorPedido(400, 'Ese video es privado: ponelo como «Público» o «No listado» en YouTube.');
    if (res.status === 404 || res.status === 400) throw new ErrorPedido(400, 'No se encontró ese video en YouTube. Revisá el enlace.');
    if (!res.ok) return null;
    const datos = await res.json();
    return typeof datos.title === 'string' ? datos.title.slice(0, LARGO_NOMBRE) : null;
  } catch (err) {
    if (err instanceof ErrorPedido) throw err;
    return null; // sin internet o YouTube no contestó: se guarda igual con un nombre genérico
  }
}

function segundosValidos(n) {
  return Number.isFinite(n) && n >= 0 && n < 24 * 3600 ? Math.floor(n) : null;
}

// ---- Para administración ----
function usadoTotal() {
  return almacenMultimedia.actual().reduce((suma, r) => suma + (r.bytes || 0), 0);
}

function espacioPorPersona() {
  const porDueno = {};
  for (const r of almacenMultimedia.actual()) {
    if (!r.owner) continue;
    const p = porDueno[r.owner] || (porDueno[r.owner] = { usado: 0, canciones: 0, videos: 0 });
    p.usado += r.bytes || 0;
    if (r.tipo === 'musica') p.canciones++; else p.videos++;
  }
  return porDueno;
}

// mb = null vuelve al espacio automático.
async function fijarEspacio(nombre, mb) {
  await almacenEspacio.modificar((lista) => {
    const quedan = lista.filter(e => e.name !== nombre);
    if (mb !== null) quedan.push({ name: nombre, mb });
    return quedan;
  });
  avisarCambio([nombre]);
}

// Borra la música y los videos de una o varias personas (al borrar sus cuentas).
async function quitarMultimediaDe(nombres) {
  const quitar = new Set(nombres);
  let suyos = [];
  await almacenMultimedia.modificar((lista) => {
    suyos = lista.filter(r => quitar.has(r.owner));
    if (!suyos.length) return SIN_CAMBIOS;
    return lista.filter(r => !quitar.has(r.owner));
  });
  await almacenEspacio.modificar((lista) => {
    const quedan = lista.filter(e => !quitar.has(e.name));
    return quedan.length === lista.length ? SIN_CAMBIOS : quedan;
  });
  await Promise.all(suyos.map(borrarArchivo));
  return suyos.length;
}

// Cuánto se gastó este mes de la cuenta gratis de Cloudinary (créditos), o null.
async function usoDeLaNube() {
  if (!nubeLista) return null;
  try {
    const uso = await cloudinary.api.usage();
    const creditos = uso.credits || {};
    return { usados: creditos.usage ?? null, limite: creditos.limit ?? null, porcentaje: creditos.used_percent ?? null };
  } catch (err) {
    console.error('No se pudo leer el uso de Cloudinary:', err.message || err);
    return null;
  }
}

const subidaLocal = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => fs.mkdir(CARPETA_MULTIMEDIA, { recursive: true }).then(() => cb(null, CARPETA_MULTIMEDIA), cb),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: LIMITE_BYTES.video, files: 1 },
  // Nombres con tildes o ñ («Canción.mp3»): el navegador los manda en UTF-8.
  defParamCharset: 'utf8'
});

function registrarRutasMultimedia(app, io) {
  ioActual = io;

  app.get('/api/multimedia', requierePersona, (req, res) => {
    try {
      res.json(resumenPara(req.person));
    } catch (err) {
      responderError(res, err, 'Error en servidor');
    }
  });

  // Paso 1 de una subida: comprueba tamaño, formato y espacio, y dice cómo subir.
  app.post('/api/multimedia/firma', requierePersona, (req, res) => {
    try {
      const { tipo, nombre, bytes } = req.body || {};
      comprobarTipo(tipo);
      comprobarExtension(tipo, nombre);
      comprobarTamano(tipo, Number(bytes));
      comprobarEspacio(req.person.name, Number(bytes));
      const modo = modoDeSubida();
      const sinTerminar = [...firmasPendientes.values()].filter(f => f.owner === req.person.name).length;
      if (modo === 'nube' && sinTerminar >= FIRMAS_SIN_TERMINAR_POR_PERSONA) {
        anotar('usuarios', req.person.name, 'no le dio más permisos de subida', `tenía ${sinTerminar} subidas sin terminar`);
        throw new ErrorPedido(429, `🛡️ Tenés ${sinTerminar} subidas empezadas sin terminar. Esperá a que terminen (o recargá la página) antes de subir más.`);
      }
      if (modo === 'no') throw new ErrorPedido(500, 'Cloudinary no está configurado en el servidor: no se pueden subir archivos. Los enlaces de YouTube sí funcionan.');
      if (modo === 'local') return res.json({ modo, url: '/api/multimedia/subir-local' });

      const publicId = `${CARPETA_NUBE}/${crypto.randomUUID()}`;
      const timestamp = Math.floor(Date.now() / 1000);
      const firmados = { public_id: publicId, timestamp };
      const signature = cloudinary.utils.api_sign_request(firmados, cloudinary.config().api_secret);
      firmasPendientes.set(publicId, { owner: req.person.name, tipo, nombre: nombreVisible(nombre), vence: Date.now() + VIGENCIA_FIRMA_MS });
      res.json({
        modo,
        url: `https://api.cloudinary.com/v1_1/${cloudinary.config().cloud_name}/video/upload`,
        campos: { api_key: cloudinary.config().api_key, timestamp, public_id: publicId, signature }
      });
    } catch (err) {
      responderError(res, err, 'No se pudo preparar la subida.');
    }
  });

  // Paso 2 (Cloudinary): el celular ya subió el archivo; se comprueba allá y se anota.
  app.post('/api/multimedia/registrar', requierePersona, async (req, res) => {
    const publicId = String((req.body || {}).public_id || '');
    const firma = firmasPendientes.get(publicId);
    try {
      if (!firma || firma.owner !== req.person.name) throw new ErrorPedido(400, 'Esa subida no está autorizada. Probá de nuevo.');
      firmasPendientes.delete(publicId);
      const recurso = await enFila('nube', req.person.name, () => cloudinary.api.resource(publicId, { resource_type: 'video' }))
        .catch(async (err) => {
          // Si no se pudo comprobar, no queda nada suelto en Cloudinary ocupando lugar.
          await cloudinary.uploader.destroy(publicId, { resource_type: 'video', invalidate: true }).catch(() => {});
          throw err;
        });
      try {
        comprobarTamano(firma.tipo, recurso.bytes);
        comprobarEspacio(req.person.name, recurso.bytes);
      } catch (err) {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'video', invalidate: true }).catch(() => {});
        throw err;
      }
      await agregar({
        id: publicId,
        tipo: firma.tipo,
        origen: 'subido',
        nube: true,
        nombre: firma.nombre,
        duracion: duracionValida(recurso.duration),
        bytes: recurso.bytes,
        src: recurso.secure_url,
        owner: req.person.name,
        creado: new Date().toISOString()
      });
      res.json(resumenPara(req.person));
    } catch (err) {
      responderError(res, err, 'No se pudo guardar lo que subiste.');
    }
  });

  // Paso 2 (sin Cloudinary, sólo para probar en la PC): el archivo llega a este servidor.
  app.post('/api/multimedia/subir-local', requierePersona, (req, res, next) => {
    if (modoDeSubida() !== 'local') return res.status(400).json({ error: 'La subida local está apagada.' });
    next();
  }, (req, res, next) => {
    // El Guardián deja recibir pocos archivos a la vez: son pesados para el disco y la memoria.
    enFila('local', req.person.name, () => new Promise((listo, fallo) => {
      subidaLocal.single('archivo')(req, res, (err) => (err ? fallo(err) : listo()));
    })).then(() => next(), (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `El archivo pesa más de ${enMb(LIMITE_BYTES.video)}.` });
      responderError(res, err, 'No se pudo recibir el archivo.');
    });
  }, async (req, res) => {
    const archivo = req.file;
    try {
      if (!archivo) throw new ErrorPedido(400, 'No llegó ningún archivo.');
      const tipo = (req.body || {}).tipo;
      comprobarTipo(tipo);
      comprobarExtension(tipo, archivo.originalname);
      comprobarTamano(tipo, archivo.size);
      comprobarEspacio(req.person.name, archivo.size);
      await agregar({
        id: 'local/' + archivo.filename,
        tipo,
        origen: 'subido',
        nube: false,
        archivo: archivo.filename,
        nombre: nombreVisible(archivo.originalname),
        duracion: duracionValida(Number((req.body || {}).duracion)),
        bytes: archivo.size,
        src: '/multimedia/' + archivo.filename,
        owner: req.person.name,
        creado: new Date().toISOString()
      });
      res.json(resumenPara(req.person));
    } catch (err) {
      if (archivo) await fs.unlink(archivo.path).catch(() => {});
      responderError(res, err, 'No se pudo guardar lo que subiste.');
    }
  });

  // Guardar un enlace de YouTube (no ocupa espacio). Opcional: desde qué segundo y hasta cuál.
  app.post('/api/multimedia/youtube', requierePersona, async (req, res) => {
    try {
      const { url, inicio, fin } = req.body || {};
      const youtubeId = idDeYoutube(url);
      if (!youtubeId) throw new ErrorPedido(400, 'Ese enlace no es de un video de YouTube. Copiá el enlace desde «Compartir».');
      const desde = inicio == null || inicio === '' ? null : segundosValidos(Number(inicio));
      const hasta = fin == null || fin === '' ? null : segundosValidos(Number(fin));
      if ((inicio != null && inicio !== '' && desde === null) || (fin != null && fin !== '' && hasta === null)) {
        throw new ErrorPedido(400, 'El minuto de inicio o de fin no es válido.');
      }
      if (desde !== null && hasta !== null && hasta <= desde) throw new ErrorPedido(400, 'El final tiene que ser después del inicio.');
      const titulo = await enFila('youtube', req.person.name, () => tituloDeYoutube(youtubeId));
      await agregar({
        id: 'youtube/' + crypto.randomUUID(),
        tipo: 'video',
        origen: 'youtube',
        youtubeId,
        inicio: desde,
        fin: hasta,
        nombre: titulo || 'Video de YouTube',
        duracion: desde !== null && hasta !== null ? hasta - desde : 0,
        bytes: 0,
        owner: req.person.name,
        creado: new Date().toISOString()
      });
      res.json(resumenPara(req.person));
    } catch (err) {
      responderError(res, err, 'No se pudo guardar el enlace.');
    }
  });

  // Borrar una o varias cosas juntas: { ids: [...] }. Cada uno sólo lo suyo (el admin, todo).
  app.post('/api/multimedia/borrar', requierePersona, async (req, res) => {
    try {
      const ids = (req.body || {}).ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(i => typeof i === 'string')) {
        throw new ErrorPedido(400, 'Elegí qué borrar.');
      }
      const quitar = new Set(ids);
      let borrados = [];
      await almacenMultimedia.modificar((lista) => {
        borrados = lista.filter(r => quitar.has(r.id));
        if (borrados.length !== quitar.size) throw new ErrorPedido(404, 'Algo de lo elegido ya no existe. Recargá la página.');
        if (!req.person.isAdmin && borrados.some(r => r.owner !== req.person.name)) {
          throw new ErrorPedido(403, 'Sólo podés borrar lo tuyo.');
        }
        return lista.filter(r => !quitar.has(r.id));
      });
      await Promise.all(borrados.map(borrarArchivo));
      avisarCambio(borrados.map(r => r.owner));
      res.json(resumenPara(req.person));
    } catch (err) {
      responderError(res, err, 'No se pudo borrar.');
    }
  });

  // Cambiar el orden de un tipo: { tipo, ids } con TODOS los ids de ese tipo de la persona.
  // Cada uno ordena lo suyo; el admin puede ordenar lo de cualquiera con { dueno }.
  app.post('/api/multimedia/orden', requierePersona, async (req, res) => {
    try {
      const { tipo, ids, dueno } = req.body || {};
      comprobarTipo(tipo);
      const de = req.person.isAdmin && typeof dueno === 'string' && dueno ? dueno : req.person.name;
      await almacenMultimedia.modificar((lista) => {
        const lugares = [];
        lista.forEach((r, i) => { if (r.owner === de && r.tipo === tipo) lugares.push(i); });
        const propios = new Set(lugares.map(i => lista[i].id));
        const valido = Array.isArray(ids) && ids.length === propios.size && new Set(ids).size === ids.length && ids.every(id => propios.has(id));
        if (!valido) throw new ErrorPedido(400, 'Orden inválido. Recargá la página.');
        const porId = new Map(lista.map(r => [r.id, r]));
        lugares.forEach((lugar, i) => { lista[lugar] = porId.get(ids[i]); });
      });
      avisarCambio([de, req.person.name]);
      res.json(resumenPara(req.person));
    } catch (err) {
      responderError(res, err, 'No se pudo cambiar el orden.');
    }
  });
}

module.exports = {
  registrarRutasMultimedia,
  espacioPorPersona,
  usadoTotal,
  espacioDe,
  espacioFijoDe,
  calculoAutomatico,
  repartirEspacio,
  fijarEspacio,
  quitarMultimediaDe,
  usoDeLaNube,
  idDeYoutube,
  MB
};
