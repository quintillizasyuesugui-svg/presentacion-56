// ---- Borrar de Cloudinary sin dejar rastro ----
// Cuando alguien borra una foto, una canción, un video o su cuenta, el archivo tiene que
// desaparecer de verdad. Antes, si Cloudinary fallaba justo en ese momento (sin red, cupo
// por hora gastado), el error se ignoraba: el archivo salía de la app pero quedaba suelto en
// la nube. Ahora lo que no se pudo borrar se anota y se reintenta cada rato hasta que se va.
//
// «invalidate» le pide a Cloudinary que limpie también sus copias en caché: sin eso, quien
// tuviera guardado el enlace exacto podía seguir abriendo la foto unos días.
const { cloudinary, nubeLista } = require('./configuracion');
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');

const REINTENTO_MS = Number(process.env.REINTENTO_BORRADO_MS) || 10 * 60 * 1000;
const PRIMER_REINTENTO_MS = 60 * 1000;

const almacenPendientes = crearAlmacen({
  archivo: 'borrados-pendientes.json',
  idNube: 'presentacion/borrados-pendientes',
  elQue: 'los archivos que faltan borrar de la nube',
  tabla: {
    nombre: 'borrados_pendientes',
    clave: 'id',
    columnas: { id: 'TEXT PRIMARY KEY', datos: 'JSONB NOT NULL' },
    aFila: ({ id, ...datos }) => ({ id, datos }),
    deFila: f => ({ id: f.id, ...f.datos })
  }
});

// true si el archivo ya no está en Cloudinary («not found» también: no queda nada que borrar).
async function intentar(id, tipo) {
  try {
    const r = await cloudinary.uploader.destroy(id, { resource_type: tipo, invalidate: true });
    return !!r && (r.result === 'ok' || r.result === 'not found');
  } catch {
    return false;
  }
}

// tipo: 'image' (fotos y páginas de documentos) o 'video' (música y videos; Cloudinary guarda
// el audio como video).
async function borrarDeLaNube(id, tipo = 'image') {
  if (!nubeLista || !id) return;
  if (await intentar(id, tipo)) return;
  console.warn(`☁️ No se pudo borrar ${id} de Cloudinary: se reintenta más tarde.`);
  await almacenPendientes.modificar((lista) => (
    lista.some(p => p.id === id) ? SIN_CAMBIOS : [...lista, { id, tipo, intentos: 1, desde: Date.now() }]
  )).catch(err => console.error('No se pudo anotar el borrado pendiente:', err.message));
}

let reintentando = false;
async function reintentarPendientes() {
  if (!nubeLista || reintentando || !almacenPendientes.actual().length) return;
  reintentando = true;
  try {
    const resultados = new Map();
    for (const p of almacenPendientes.actual()) resultados.set(p.id, await intentar(p.id, p.tipo));
    await almacenPendientes.modificar((lista) => lista
      .filter(p => !resultados.get(p.id))
      .map(p => (resultados.has(p.id) ? { ...p, intentos: (p.intentos || 1) + 1 } : p)));
    const quedan = almacenPendientes.actual().length;
    if (quedan) console.warn(`☁️ Quedan ${quedan} archivos por borrar de Cloudinary.`);
  } catch (err) {
    console.error('Error al reintentar los borrados pendientes:', err.message);
  } finally {
    reintentando = false;
  }
}

// Llamarlo después de iniciarAlmacenes.
function iniciarReintentosDeBorrado() {
  setTimeout(reintentarPendientes, PRIMER_REINTENTO_MS).unref();
  setInterval(reintentarPendientes, REINTENTO_MS).unref();
}

module.exports = { borrarDeLaNube, reintentarPendientes, iniciarReintentosDeBorrado };
