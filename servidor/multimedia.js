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
//  - Videos de más de 100 MB (hasta 500 MB): al almacén grande de Hugging Face (ver
//    almacen-grande.js). Tienen su propio espacio aparte del de Cloudinary.
// Los enlaces de YouTube sólo guardan el enlace: no ocupan espacio.
//
// Cada persona tiene su propio espacio, que se calcula solo repartiendo PRESUPUESTO_MB entre
// las personas registradas (ver configuracion.js); el admin puede fijarle otro a alguien.
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const express = require('express');
const multer = require('multer');
const { CARPETA_MULTIMEDIA, PRESUPUESTO_MB, ESPACIO_MIN_MB, ESPACIO_MAX_MB, GRANDE_PRESUPUESTO_MB, GRANDE_MIN_MB, GRANDE_MAX_MB, cloudinary, nubeLista } = require('./configuracion');
const { almacenGrandeListo, subirAlAlmacenGrande, borrarDelAlmacenGrande, enlaceParaVer } = require('./almacen-grande');
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { requierePersona, visiblePara, nombresDePersonas } = require('./personas');
const { enFila, anotar, explicarEspacio } = require('./guardian');
const { borrarDeLaNube } = require('./borrar-de-la-nube');

const MB = 1024 * 1024;
const LIMITE_BYTES = { musica: 15 * MB, video: 100 * MB, videoGrande: 500 * MB };
const TROZO_GRANDE = 6 * MB;
const CARPETA_TROZOS = path.join(os.tmpdir(), 'conexiones-grandes');
const EXTENSIONES = {
  musica: ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.weba'],
  video: ['.mp4', '.m4v', '.webm', '.mov']
};
const CARPETA_NUBE = 'presentacion/multimedia';
const VIGENCIA_FIRMA_MS = 2 * 60 * 60 * 1000;
const FIRMAS_SIN_TERMINAR_POR_PERSONA = 6;
const RECIENTE_MS = 15 * 60 * 1000;
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
// Lo del espacio rápido (Cloudinary) y lo del almacén grande se cuentan por separado.
function usadoPor(nombre) {
  return almacenMultimedia.actual().reduce((suma, r) => suma + (r.owner === nombre && !r.grande ? (r.bytes || 0) : 0), 0);
}

function usadoGrandePor(nombre) {
  return almacenMultimedia.actual().reduce((suma, r) => suma + (r.owner === nombre && r.grande ? (r.bytes || 0) : 0), 0);
}

function espacioGrandeDe(nombre) {
  const mb = repartirEspacio(nombresDePersonas().length, GRANDE_PRESUPUESTO_MB, GRANDE_MIN_MB, GRANDE_MAX_MB);
  return { usado: usadoGrandePor(nombre), total: mb * MB };
}

function comprobarEspacioGrande(nombre, bytesNuevos) {
  const { usado, total } = espacioGrandeDe(nombre);
  if (usado + bytesNuevos > total) {
    const libre = Math.max(0, total - usado);
    anotar('almacenamiento', nombre, 'no le alcanzó el almacén grande', `quería subir ${enMb(bytesNuevos)} y le quedaban ${enMb(libre)}`);
    throw new ErrorPedido(413, `🛡️ No te alcanza el almacén grande: este video pesa ${enMb(bytesNuevos)} y te quedan ${enMb(libre)} de ${enMb(total)}. Borrá algún video grande o usá un enlace de YouTube.`);
  }
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

function comprobarTamano(tipo, bytes, grande = false) {
  if (!(bytes > 0)) throw new ErrorPedido(400, 'El archivo está vacío.');
  if (grande) {
    if (bytes > LIMITE_BYTES.videoGrande) throw new ErrorPedido(413, `Cada video puede pesar hasta ${enMb(LIMITE_BYTES.videoGrande)}; este pesa ${enMb(bytes)}. Para videos más largos usá un enlace de YouTube.`);
    return;
  }
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
    espacioGrande: almacenGrandeListo ? espacioGrandeDe(persona.name) : null,
    limites: { musica: LIMITE_BYTES.musica, video: LIMITE_BYTES.video, videoGrande: almacenGrandeListo ? LIMITE_BYTES.videoGrande : 0 }
  };
}

async function agregar(registro) {
  await almacenMultimedia.modificar((lista) => { lista.push(registro); });
  avisarCambio([registro.owner]);
}

async function borrarArchivo(registro) {
  if (registro.origen !== 'subido') return;
  if (registro.grande) {
    await borrarDelAlmacenGrande(registro.rutaHf, registro.sha);
  } else if (registro.nube) {
    await borrarDeLaNube(registro.id, 'video');
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
// Lo guardado en Cloudinary (el almacén grande tiene su propia cuenta).
function usadoTotal() {
  return almacenMultimedia.actual().reduce((suma, r) => suma + (r.grande ? 0 : (r.bytes || 0)), 0);
}

function espacioPorPersona() {
  const porDueno = {};
  for (const r of almacenMultimedia.actual()) {
    if (!r.owner) continue;
    const p = porDueno[r.owner] || (porDueno[r.owner] = { usado: 0, usadoGrande: 0, canciones: 0, videos: 0 });
    if (r.grande) p.usadoGrande += r.bytes || 0; else p.usado += r.bytes || 0;
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

// ---- Subidas al almacén grande ----
// id → { id, owner, nombre, ext, bytes, duracion, recibidos, ruta, ultimo, terminando }
const subidasGrandes = new Map();
const VENCE_SUBIDA_GRANDE_MS = 30 * 60 * 1000; // sin trozos nuevos en 30 min, se descarta
setInterval(() => {
  const limite = Date.now() - VENCE_SUBIDA_GRANDE_MS;
  for (const [id, s] of subidasGrandes) {
    if (s.ultimo < limite && !s.terminando) {
      subidasGrandes.delete(id);
      fs.unlink(s.ruta).catch(() => {});
    }
  }
}, 5 * 60 * 1000).unref();

function empezarSubidaGrande(owner, nombre, bytes, duracion) {
  const suyas = [...subidasGrandes.values()].filter(s => s.owner === owner);
  if (suyas.length >= 3) throw new ErrorPedido(429, '🛡️ Ya tenés 3 videos grandes subiéndose. Esperá a que terminen.');
  // Lo que ya se está subiendo también cuenta, para no pasarse del espacio subiendo varios a la vez.
  comprobarEspacioGrande(owner, bytes + suyas.reduce((t, s) => t + s.bytes, 0));
  const id = crypto.randomUUID();
  const ext = path.extname(String(nombre || '')).toLowerCase() || '.mp4';
  const ruta = path.join(CARPETA_TROZOS, id + ext);
  require('fs').mkdirSync(CARPETA_TROZOS, { recursive: true });
  require('fs').writeFileSync(ruta, '');
  subidasGrandes.set(id, { id, owner, nombre: nombreVisible(nombre), ext, bytes, duracion: duracionValida(duracion), recibidos: 0, ruta, ultimo: Date.now() });
  return { modo: 'grande', url: '/api/multimedia/grande/trozo', id, trozo: TROZO_GRANDE };
}

async function terminarSubidaGrande(s, persona) {
  s.terminando = true;
  const rutaHf = `videos/${s.id}${s.ext}`;
  try {
    comprobarEspacioGrande(persona.name, s.bytes);
    const sha = await enFila('grande', persona.name, () => subirAlAlmacenGrande(s.ruta, rutaHf));
    await agregar({
      id: 'grande/' + s.id,
      tipo: 'video',
      origen: 'subido',
      nube: false,
      grande: true,
      rutaHf,
      sha,
      nombre: s.nombre,
      duracion: s.duracion,
      bytes: s.bytes,
      src: '/api/multimedia/grande/ver/' + s.id,
      owner: persona.name,
      creado: new Date().toISOString()
    });
    return resumenPara(persona);
  } catch (err) {
    if (err instanceof ErrorPedido || (err && err.guardian)) throw err;
    console.error('Falló la subida al almacén grande:', err.message || err);
    throw new ErrorPedido(502, 'El almacén grande no recibió el video. Probá de nuevo en un rato.');
  } finally {
    subidasGrandes.delete(s.id);
    fs.unlink(s.ruta).catch(() => {});
  }
}

function registrarRutasMultimedia(app, io) {
  ioActual = io;

  app.get('/api/multimedia', requierePersona, (req, res) => {
    try {
      res.json(resumenPara(req.person));
      // Deja listos los enlaces de sus videos grandes: al tocar «Mostrar» arrancan sin esperar.
      for (const r of almacenMultimedia.actual()) {
        if (r.grande && r.owner === req.person.name) enlaceParaVer(r.rutaHf).catch(() => {});
      }
    } catch (err) {
      responderError(res, err, 'Algo salió mal en el servidor. Probá de nuevo en un momento.');
    }
  });

  // Paso 1 de una subida: comprueba tamaño, formato y espacio, y dice cómo subir.
  app.post('/api/multimedia/firma', requierePersona, (req, res) => {
    try {
      const { tipo, nombre, bytes, duracion } = req.body || {};
      comprobarTipo(tipo);
      comprobarExtension(tipo, nombre);
      const grande = tipo === 'video' && Number(bytes) > LIMITE_BYTES.video && almacenGrandeListo;
      comprobarTamano(tipo, Number(bytes), grande);
      if (grande) return res.json(empezarSubidaGrande(req.person.name, nombre, Number(bytes), Number(duracion)));
      comprobarEspacio(req.person.name, Number(bytes));
      const modo = modoDeSubida();
      // Sólo cuentan las de los últimos minutos: una subida que se cortó ya no frena las nuevas.
      const sinTerminar = [...firmasPendientes.values()].filter(f => f.owner === req.person.name && f.creada > Date.now() - RECIENTE_MS).length;
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
      firmasPendientes.set(publicId, { owner: req.person.name, tipo, nombre: nombreVisible(nombre), creada: Date.now(), vence: Date.now() + VIGENCIA_FIRMA_MS });
      res.json({
        modo,
        url: `${cloudinary.config().upload_prefix || 'https://api.cloudinary.com'}/v1_1/${cloudinary.config().cloud_name}/video/upload`,
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
          await borrarDeLaNube(publicId, 'video');
          throw err;
        });
      try {
        comprobarTamano(firma.tipo, recurso.bytes);
        comprobarEspacio(req.person.name, recurso.bytes);
      } catch (err) {
        await borrarDeLaNube(publicId, 'video');
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

  // Almacén grande, paso 2: llegan los trozos en orden. Con el último se sube a Hugging Face.
  app.post('/api/multimedia/grande/trozo', requierePersona, express.raw({ type: 'application/octet-stream', limit: TROZO_GRANDE + MB }), async (req, res) => {
    try {
      const s = subidasGrandes.get(String(req.get('x-subida') || ''));
      if (!s || s.owner !== req.person.name) throw new ErrorPedido(400, 'Esa subida no está autorizada o ya venció. Probá de nuevo.');
      const rango = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(req.get('content-range') || ''));
      const trozo = Buffer.isBuffer(req.body) ? req.body : null;
      if (!rango || !trozo) throw new ErrorPedido(400, 'Trozo inválido.');
      const desde = Number(rango[1]), hasta = Number(rango[2]), total = Number(rango[3]);
      if (total !== s.bytes || hasta - desde + 1 !== trozo.length || trozo.length > TROZO_GRANDE) throw new ErrorPedido(400, 'Trozo inválido.');
      // El celular reintenta un trozo si se cortó la conexión: si ya había llegado, no se repite.
      if (hasta + 1 <= s.recibidos) return res.json({ recibidos: s.recibidos });
      if (desde !== s.recibidos || s.terminando) throw new ErrorPedido(409, 'Se perdió un trozo del video. Probá subirlo de nuevo.');
      await fs.appendFile(s.ruta, trozo);
      s.recibidos += trozo.length;
      s.ultimo = Date.now();
      if (s.recibidos < s.bytes) return res.json({ recibidos: s.recibidos });
      res.json(await terminarSubidaGrande(s, req.person));
    } catch (err) {
      responderError(res, err, 'No se pudo subir el video al almacén grande.');
    }
  });

  // Ver un video del almacén grande: lleva al enlace firmado de Hugging Face (dura un rato).
  app.get('/api/multimedia/grande/ver/:id', async (req, res) => {
    const r = almacenMultimedia.actual().find(x => x.id === 'grande/' + req.params.id && x.grande);
    if (!r) return res.status(404).json({ error: 'Ese video ya no existe.' });
    try {
      res.set('Cache-Control', 'no-store');
      res.redirect(302, await enlaceParaVer(r.rutaHf));
    } catch (err) {
      console.error(err.message || err);
      res.status(502).json({ error: 'El almacén grande no contestó. Probá de nuevo en un momento.' });
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
