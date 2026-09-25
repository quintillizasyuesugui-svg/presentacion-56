// ---- Diapositivas: orden, subir, borrar, ajustar, unir y reordenar imágenes ----
// Cada entrada del orden es { id, src } — "id" es lo que se usa para borrar/reordenar,
// "src" es lo que va directo al <img>. Para archivos locales (publico/diapositivas/)
// id === src === nombre de archivo. Para lo subido a Cloudinary, id es el public_id y
// src la URL segura.
// Todo cambio del orden pasa por almacenOrden.modificar(): de a uno, así dos personas
// subiendo o reordenando al mismo tiempo no se borran lo que hizo la otra.
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { CARPETA_DIAPOSITIVAS, EXTENSIONES_IMAGEN, cloudinary, nubeLista } = require('./configuracion');
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { requierePersona, visiblePara } = require('./personas');

const ERROR_SIN_NUBE = 'Cloudinary no está configurado en el servidor (faltan variables de entorno). Revisá .env.example.';

async function imagenesDeLaCarpeta() {
  let archivos;
  try {
    archivos = await fs.readdir(CARPETA_DIAPOSITIVAS);
  } catch {
    return [];
  }
  return archivos
    .filter(f => EXTENSIONES_IMAGEN.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(archivo => ({ id: archivo, src: archivo }));
}

// Al arrancar se descartan las entradas locales cuyo archivo ya no exista (las de Cloudinary
// no se verifican acá — su existencia depende de Cloudinary, no de este disco).
async function quitarLocalesQueFaltan(orden) {
  const existentes = [];
  for (const registro of orden) {
    if (registro.id.startsWith('presentacion/')) {
      existentes.push(registro);
      continue;
    }
    try {
      await fs.access(path.join(CARPETA_DIAPOSITIVAS, registro.id));
      existentes.push(registro);
    } catch { /* borrado del disco por fuera de la app */ }
  }
  return existentes;
}

const almacenOrden = crearAlmacen({
  archivo: 'orden-imagenes.json',
  archivoViejo: 'images-order.json',
  idNube: 'presentacion/images-order',
  elQue: 'el orden',
  tabla: {
    nombre: 'diapositivas',
    clave: 'id',
    ordenada: true,
    // «datos» guarda el resto de la diapositiva tal cual (src, ajuste, originales de una unión).
    columnas: { id: 'TEXT PRIMARY KEY', dueno: 'TEXT', datos: 'JSONB NOT NULL' },
    aFila: ({ id, owner, ...datos }) => ({ id, dueno: owner ?? null, datos }),
    deFila: f => ({ id: f.id, ...f.datos, ...(f.dueno != null ? { owner: f.dueno } : {}) })
  },
  valorInicial: imagenesDeLaCarpeta,
  normalizar: quitarLocalesQueFaltan
});

// Error con el código HTTP para responder (se tira adentro de modificar() y corta sin guardar).
class ErrorPedido extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

function responderError(res, err, mensajeGeneral) {
  if (err instanceof ErrorPedido) return res.status(err.estado).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: mensajeGeneral });
}

// El id de Cloudinary trae barras (ej. "presentacion/slides/abc123"): la ruta usa un comodín.
function idDeLaRuta(req) {
  return Array.isArray(req.params.id) ? req.params.id.join('/') : req.params.id;
}

let ioActual = null; // lo fija registrarRutasDiapositivas; lo usan también los trabajos de documentos

function avisarCambioDeImagenes() {
  if (ioActual) ioActual.emit('imagenesActualizadas');
}

// Sube una imagen ya comprimida (Buffer) y devuelve su registro para el orden.
// Sin Cloudinary sólo se permite guardarla en publico/diapositivas si DOCUMENTOS_SIN_NUBE_LOCAL=1
// (para probar en la PC); en Render eso se perdería en cada redeploy.
async function subirImagen(contenido, tipo, owner, nombreLocal) {
  if (nubeLista) {
    const dataUri = `data:${tipo};base64,${contenido.toString('base64')}`;
    const resultado = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
    return { id: resultado.public_id, src: resultado.secure_url, owner };
  }
  if (process.env.DOCUMENTOS_SIN_NUBE_LOCAL === '1') {
    await fs.mkdir(CARPETA_DIAPOSITIVAS, { recursive: true });
    await fs.writeFile(path.join(CARPETA_DIAPOSITIVAS, nombreLocal), contenido);
    return { id: nombreLocal, src: nombreLocal, owner };
  }
  throw new Error(ERROR_SIN_NUBE);
}

async function borrarImagenSubida(registro) {
  if (registro.id.startsWith('presentacion/')) {
    if (nubeLista) await cloudinary.uploader.destroy(registro.id).catch(() => {});
  } else {
    // El id viene del orden guardado, así que no puede salirse de publico/diapositivas.
    await fs.unlink(path.join(CARPETA_DIAPOSITIVAS, registro.id)).catch(() => {});
  }
}

// Agrega diapositivas al final del orden, en el orden recibido, y avisa a las pantallas.
async function agregarDiapositivas(registros) {
  await almacenOrden.modificar((orden) => { orden.push(...registros); });
  avisarCambioDeImagenes();
}

// Cuántas diapositivas tiene cada persona: { nombre: cantidad }.
function contarPorDueno() {
  const conteo = {};
  for (const r of almacenOrden.actual()) if (r.owner) conteo[r.owner] = (conteo[r.owner] || 0) + 1;
  return conteo;
}

// Quita del show todas las diapositivas de una o varias personas y borra sus imágenes
// (también las originales guardadas dentro de una unión). Devuelve { nombre: cantidad }.
async function quitarDiapositivasDe(nombres) {
  const quitar = new Set(nombres);
  const cantidades = {};
  let suyas = [];
  await almacenOrden.modificar((orden) => {
    suyas = orden.filter(r => quitar.has(r.owner));
    if (!suyas.length) return SIN_CAMBIOS;
    return orden.filter(r => !quitar.has(r.owner));
  });
  if (!suyas.length) return cantidades;
  for (const r of suyas) cantidades[r.owner] = (cantidades[r.owner] || 0) + 1;
  await Promise.all(suyas.flatMap(r => [r, ...(r.originals || [])]).map(borrarImagenSubida));
  avisarCambioDeImagenes();
  return cantidades;
}

function nubeDisponible() {
  return nubeLista || process.env.DOCUMENTOS_SIN_NUBE_LOCAL === '1';
}

// Busca la diapositiva y comprueba que sea de la persona (o que sea el admin).
function propiaDe(orden, id, persona, queHacer) {
  const posicion = orden.findIndex(r => r.id === id);
  if (posicion === -1) throw new ErrorPedido(404, 'Imagen no encontrada.');
  if (!persona.isAdmin && orden[posicion].owner !== persona.name) {
    throw new ErrorPedido(403, `Sólo podés ${queHacer} tus propias imágenes.`);
  }
  return posicion;
}

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/'))
});

function registrarRutasDiapositivas(app, io) {
  ioActual = io;
  const avisarCambio = avisarCambioDeImagenes;

  // GET /images — { src, transform } por diapositiva, para pantalla.html y control.html
  // (transform es el ajuste de tamaño/posición del Modo avanzado; null si nunca se tocó).
  // Sin PIN — es la pantalla pública/el control, muestra el show combinado de todos.
  // Antes cada pedido leía el disco y volvía a subir el respaldo a Cloudinary; ahora sale de memoria.
  app.get('/images', (req, res) => {
    try {
      res.json(almacenOrden.actual().map(r => ({ src: r.src, transform: r.transform || null })));
    } catch (err) {
      console.error(err);
      res.status(500).send('Error en servidor');
    }
  });

  // GET /api/images — registros completos {id, src}, para gestionar.html.
  // Filtrado por dueño: cada persona sólo ve lo que subió ella; admin ve todo.
  app.get('/api/images', requierePersona, (req, res) => {
    try {
      res.json(visiblePara(req.person, almacenOrden.actual()));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en servidor' });
    }
  });

  // ---- Subir imágenes ----
  app.post('/api/images/upload', requierePersona, subida.array('images', 20), async (req, res) => {
    if (!nubeLista) return res.status(500).json({ error: ERROR_SIN_NUBE });
    try {
      const archivos = req.files || [];
      if (archivos.length === 0) {
        return res.status(400).json({ error: 'No se recibió ninguna imagen válida.' });
      }

      // Primero se suben (lo lento) y recién después se agregan al orden.
      const nuevos = await Promise.all(archivos.map(async (archivo) => {
        const dataUri = `data:${archivo.mimetype};base64,${archivo.buffer.toString('base64')}`;
        const resultado = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
        return { id: resultado.public_id, src: resultado.secure_url, owner: req.person.name };
      }));

      const orden = await almacenOrden.modificar((o) => { o.push(...nuevos); });
      avisarCambio();
      res.json(visiblePara(req.person, orden));
    } catch (err) {
      responderError(res, err, 'Error al subir la imagen.');
    }
  });

  // ---- Borrar imagen ----
  app.delete('/api/images/*id', requierePersona, async (req, res) => {
    try {
      const id = idDeLaRuta(req);
      let registro;
      const orden = await almacenOrden.modificar((o) => {
        const posicion = propiaDe(o, id, req.person, 'borrar');
        [registro] = o.splice(posicion, 1);
      });
      await borrarImagenSubida(registro);
      avisarCambio();
      res.json(visiblePara(req.person, orden));
    } catch (err) {
      responderError(res, err, 'Error al borrar la imagen.');
    }
  });

  // ---- Tamaño y posición (Modo avanzado) ----
  // Ajuste no destructivo: sólo guarda { scale, x, y } junto a la imagen en el
  // orden — pantalla.html lo aplica con CSS al mostrarla, la imagen original no cambia.
  app.post('/api/images/*id/transform', requierePersona, async (req, res) => {
    try {
      const id = idDeLaRuta(req);
      const { scale, x, y } = req.body;

      const valido = Number.isFinite(scale) && scale >= 0.3 && scale <= 4 &&
        Number.isFinite(x) && x >= -100 && x <= 100 &&
        Number.isFinite(y) && y >= -100 && y <= 100;
      if (!valido) {
        return res.status(400).json({ error: 'Ajuste inválido.' });
      }

      const orden = await almacenOrden.modificar((o) => {
        o[propiaDe(o, id, req.person, 'ajustar')].transform = { scale, x, y };
      });
      avisarCambio();
      res.json(visiblePara(req.person, orden));
    } catch (err) {
      responderError(res, err, 'Error al guardar el ajuste.');
    }
  });

  // ---- Unir imágenes (Modo avanzado) ----
  // El collage ya viene armado desde el celular (canvas) en dataUri — acá sólo se
  // sube como una imagen más y se reemplazan las 2-30 originales por esa única
  // diapositiva. "originals" guarda esas imágenes completas (con su propio ajuste
  // de tamaño/posición si tenían) para poder deshacer la unión con /uncombine.
  app.post('/api/images/combine', requierePersona, async (req, res) => {
    if (!nubeLista) return res.status(500).json({ error: ERROR_SIN_NUBE });
    const { ids, dataUri } = req.body;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 30 || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Elegí entre 2 y 30 imágenes distintas para unir.' });
    }
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) {
      return res.status(400).json({ error: 'No se recibió la imagen combinada.' });
    }

    // Se comprueba antes de subir el collage y otra vez al guardar (mientras sube, otro
    // pedido pudo haber cambiado el orden).
    function comprobar(orden) {
      const posiciones = ids.map(id => orden.findIndex(r => r.id === id));
      if (posiciones.some(i => i === -1)) throw new ErrorPedido(400, 'Alguna de las imágenes ya no existe.');
      if (posiciones.some(i => orden[i].originals)) throw new ErrorPedido(400, 'Una diapositiva combinada no se puede volver a unir.');
      if (!req.person.isAdmin && posiciones.some(i => orden[i].owner !== req.person.name)) {
        throw new ErrorPedido(403, 'Sólo podés unir tus propias imágenes.');
      }
      return new Set(posiciones);
    }

    let unida = null;
    try {
      comprobar(almacenOrden.actual());
      const resultado = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
      unida = { id: resultado.public_id, src: resultado.secure_url, owner: req.person.name };

      const siguiente = await almacenOrden.modificar((orden) => {
        const quitadas = comprobar(orden);
        // El orden de "originals" sigue el orden actual del deck, no el orden en que
        // se tildaron en el celular — así el collage queda de izquierda a derecha
        // como están hoy las diapositivas.
        unida.originals = orden.filter((r, i) => quitadas.has(i));
        const nuevo = [];
        let insertada = false;
        orden.forEach((registro, i) => {
          if (quitadas.has(i)) {
            if (!insertada) { nuevo.push(unida); insertada = true; }
            return;
          }
          nuevo.push(registro);
        });
        return nuevo;
      });
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      if (unida) await borrarImagenSubida(unida); // el collage subido no quedó en el show
      responderError(res, err, 'Error al unir las imágenes.');
    }
  });

  // ---- Deshacer una unión ----
  app.post('/api/images/*id/uncombine', requierePersona, async (req, res) => {
    try {
      const id = idDeLaRuta(req);
      let registro;
      const siguiente = await almacenOrden.modificar((orden) => {
        const posicion = propiaDe(orden, id, req.person, 'separar');
        registro = orden[posicion];
        if (!registro.originals) throw new ErrorPedido(400, 'Esta diapositiva no es una unión.');
        return [...orden.slice(0, posicion), ...registro.originals, ...orden.slice(posicion + 1)];
      });
      if (registro.id.startsWith('presentacion/') && nubeLista) {
        await cloudinary.uploader.destroy(registro.id).catch(() => {});
      }
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      responderError(res, err, 'Error al separar la unión.');
    }
  });

  // ---- Reordenar imágenes ----
  app.post('/api/images/reorder', requierePersona, async (req, res) => {
    try {
      const { order: idsNuevos } = req.body;
      const siguiente = await almacenOrden.modificar((actual) => {
        const porId = new Map(actual.map(r => [r.id, r]));

        if (req.person.isAdmin) {
          const valido = Array.isArray(idsNuevos) &&
            idsNuevos.length === actual.length &&
            idsNuevos.every(id => porId.has(id)) &&
            new Set(idsNuevos).size === actual.length;
          if (!valido) throw new ErrorPedido(400, 'Orden inválido.');
          return idsNuevos.map(id => porId.get(id));
        }

        // No admin: sólo puede reordenar el subconjunto de imágenes que le
        // pertenecen — las de los demás quedan intactas en su lugar de siempre.
        const posicionesPropias = [];
        actual.forEach((r, i) => { if (r.owner === req.person.name) posicionesPropias.push(i); });
        const idsPropios = posicionesPropias.map(i => actual[i].id);

        const valido = Array.isArray(idsNuevos) &&
          idsNuevos.length === idsPropios.length &&
          new Set(idsNuevos).size === idsPropios.length &&
          idsNuevos.every(id => idsPropios.includes(id));
        if (!valido) throw new ErrorPedido(400, 'Orden inválido.');

        posicionesPropias.forEach((lugar, i) => { actual[lugar] = porId.get(idsNuevos[i]); });
      });
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      responderError(res, err, 'Error al reordenar.');
    }
  });
}

module.exports = { registrarRutasDiapositivas, subirImagen, borrarImagenSubida, agregarDiapositivas, nubeDisponible, contarPorDueno, quitarDiapositivasDe, ERROR_SIN_NUBE };
