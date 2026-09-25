// ---- Diapositivas: orden, subir, borrar, ajustar, unir y reordenar imágenes ----
// Cada entrada del orden es { id, src } — "id" es lo que se usa para borrar/reordenar,
// "src" es lo que va directo al <img>. Para archivos locales (publico/diapositivas/)
// id === src === nombre de archivo. Para lo subido a Cloudinary, id es el public_id y
// src la URL segura.
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { CARPETA_DIAPOSITIVAS, EXTENSIONES_IMAGEN, cloudinary, nubeLista } = require('./configuracion');
const { crearAlmacenJson } = require('./almacen');
const { requierePersona, visiblePara } = require('./personas');

const almacenOrden = crearAlmacenJson({
  archivo: 'orden-imagenes.json',
  archivoViejo: 'images-order.json',
  idNube: 'presentacion/images-order',
  que: 'orden',
  elQue: 'el orden'
});

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

async function leerOrden() {
  let orden = await almacenOrden.leer();
  if (!orden) orden = await imagenesDeLaCarpeta();

  // Descartar entradas locales cuyo archivo ya no exista (las de Cloudinary no se verifican
  // acá — su existencia depende de Cloudinary, no de este disco).
  const existentes = [];
  for (const registro of orden) {
    if (registro.id.startsWith('presentacion/')) {
      existentes.push(registro); // viene de Cloudinary, se asume válido
      continue;
    }
    try {
      await fs.access(path.join(CARPETA_DIAPOSITIVAS, registro.id));
      existentes.push(registro);
    } catch { /* borrado del disco por fuera de la app */ }
  }

  await almacenOrden.escribir(existentes);
  return existentes;
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
    await fs.unlink(path.join(CARPETA_DIAPOSITIVAS, registro.id)).catch(() => {});
  }
}

// Agrega diapositivas al final del orden, en el orden recibido, y avisa a las pantallas.
async function agregarDiapositivas(registros) {
  const orden = await leerOrden();
  orden.push(...registros);
  await almacenOrden.escribir(orden);
  avisarCambioDeImagenes();
}

function nubeDisponible() {
  return nubeLista || process.env.DOCUMENTOS_SIN_NUBE_LOCAL === '1';
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
  app.get('/images', async (req, res) => {
    try {
      res.json((await leerOrden()).map(r => ({ src: r.src, transform: r.transform || null })));
    } catch (err) {
      console.error(err);
      res.status(500).send('Error en servidor');
    }
  });

  // GET /api/images — registros completos {id, src}, para gestionar.html.
  // Filtrado por dueño: cada persona sólo ve lo que subió ella; admin ve todo.
  app.get('/api/images', requierePersona, async (req, res) => {
    try {
      res.json(visiblePara(req.person, await leerOrden()));
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

      const nuevos = await Promise.all(archivos.map(async (archivo) => {
        const dataUri = `data:${archivo.mimetype};base64,${archivo.buffer.toString('base64')}`;
        const resultado = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
        return { id: resultado.public_id, src: resultado.secure_url, owner: req.person.name };
      }));

      const orden = await leerOrden();
      orden.push(...nuevos);
      await almacenOrden.escribir(orden);
      avisarCambio();
      res.json(visiblePara(req.person, orden));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al subir la imagen.' });
    }
  });

  // ---- Borrar imagen ----
  app.delete('/api/images/*id', requierePersona, async (req, res) => {
    try {
      const id = idDeLaRuta(req);
      const orden = await leerOrden();
      const registro = orden.find(r => r.id === id);
      if (!registro) {
        return res.status(404).json({ error: 'Imagen no encontrada.' });
      }
      if (!req.person.isAdmin && registro.owner !== req.person.name) {
        return res.status(403).json({ error: 'Sólo podés borrar tus propias imágenes.' });
      }

      if (registro.id.startsWith('presentacion/')) {
        if (nubeLista) await cloudinary.uploader.destroy(registro.id).catch(() => {});
      } else {
        // El id ya está validado contra el orden guardado, así que no puede salirse
        // de publico/diapositivas (no viene de un parámetro libre sin chequear).
        await fs.unlink(path.join(CARPETA_DIAPOSITIVAS, registro.id)).catch(() => {});
      }

      const siguiente = orden.filter(r => r.id !== id);
      await almacenOrden.escribir(siguiente);
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al borrar la imagen.' });
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

      const orden = await leerOrden();
      const registro = orden.find(r => r.id === id);
      if (!registro) {
        return res.status(404).json({ error: 'Imagen no encontrada.' });
      }
      if (!req.person.isAdmin && registro.owner !== req.person.name) {
        return res.status(403).json({ error: 'Sólo podés ajustar tus propias imágenes.' });
      }

      registro.transform = { scale, x, y };
      await almacenOrden.escribir(orden);
      avisarCambio();
      res.json(visiblePara(req.person, orden));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el ajuste.' });
    }
  });

  // ---- Unir imágenes (Modo avanzado) ----
  // El collage ya viene armado desde el celular (canvas) en dataUri — acá sólo se
  // sube como una imagen más y se reemplazan las 2-30 originales por esa única
  // diapositiva. "originals" guarda esas imágenes completas (con su propio ajuste
  // de tamaño/posición si tenían) para poder deshacer la unión con /uncombine.
  app.post('/api/images/combine', requierePersona, async (req, res) => {
    if (!nubeLista) return res.status(500).json({ error: ERROR_SIN_NUBE });
    try {
      const { ids, dataUri } = req.body;
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > 30 || new Set(ids).size !== ids.length) {
        return res.status(400).json({ error: 'Elegí entre 2 y 30 imágenes distintas para unir.' });
      }
      if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) {
        return res.status(400).json({ error: 'No se recibió la imagen combinada.' });
      }

      const orden = await leerOrden();
      const posiciones = ids.map(id => orden.findIndex(r => r.id === id));
      if (posiciones.some(i => i === -1)) {
        return res.status(400).json({ error: 'Alguna de las imágenes ya no existe.' });
      }
      if (posiciones.some(i => orden[i].originals)) {
        return res.status(400).json({ error: 'Una diapositiva combinada no se puede volver a unir.' });
      }
      if (!req.person.isAdmin && posiciones.some(i => orden[i].owner !== req.person.name)) {
        return res.status(403).json({ error: 'Sólo podés unir tus propias imágenes.' });
      }

      const quitadas = new Set(posiciones);
      // El orden de "originals" sigue el orden actual del deck, no el orden en que
      // se tildaron en el celular — así el collage queda de izquierda a derecha
      // como están hoy las diapositivas.
      const originals = orden.filter((r, i) => quitadas.has(i));

      const resultado = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
      const unida = { id: resultado.public_id, src: resultado.secure_url, originals, owner: req.person.name };

      const siguiente = [];
      let insertada = false;
      orden.forEach((registro, i) => {
        if (quitadas.has(i)) {
          if (!insertada) { siguiente.push(unida); insertada = true; }
          return;
        }
        siguiente.push(registro);
      });

      await almacenOrden.escribir(siguiente);
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al unir las imágenes.' });
    }
  });

  // ---- Deshacer una unión ----
  app.post('/api/images/*id/uncombine', requierePersona, async (req, res) => {
    try {
      const id = idDeLaRuta(req);
      const orden = await leerOrden();
      const posicion = orden.findIndex(r => r.id === id);
      if (posicion === -1) {
        return res.status(404).json({ error: 'Imagen no encontrada.' });
      }
      const registro = orden[posicion];
      if (!registro.originals) {
        return res.status(400).json({ error: 'Esta diapositiva no es una unión.' });
      }
      if (!req.person.isAdmin && registro.owner !== req.person.name) {
        return res.status(403).json({ error: 'Sólo podés separar tus propias uniones.' });
      }

      if (registro.id.startsWith('presentacion/') && nubeLista) {
        await cloudinary.uploader.destroy(registro.id).catch(() => {});
      }

      const siguiente = [...orden.slice(0, posicion), ...registro.originals, ...orden.slice(posicion + 1)];
      await almacenOrden.escribir(siguiente);
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al separar la unión.' });
    }
  });

  // ---- Reordenar imágenes ----
  app.post('/api/images/reorder', requierePersona, async (req, res) => {
    try {
      const { order: idsNuevos } = req.body;
      const actual = await leerOrden();
      const porId = new Map(actual.map(r => [r.id, r]));

      if (req.person.isAdmin) {
        const valido = Array.isArray(idsNuevos) &&
          idsNuevos.length === actual.length &&
          idsNuevos.every(id => porId.has(id)) &&
          new Set(idsNuevos).size === actual.length;
        if (!valido) return res.status(400).json({ error: 'Orden inválido.' });

        const reordenado = idsNuevos.map(id => porId.get(id));
        await almacenOrden.escribir(reordenado);
        avisarCambio();
        return res.json(reordenado);
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
      if (!valido) return res.status(400).json({ error: 'Orden inválido.' });

      const siguiente = [...actual];
      posicionesPropias.forEach((lugar, i) => { siguiente[lugar] = porId.get(idsNuevos[i]); });

      await almacenOrden.escribir(siguiente);
      avisarCambio();
      res.json(visiblePara(req.person, siguiente));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al reordenar.' });
    }
  });
}

module.exports = { registrarRutasDiapositivas, subirImagen, borrarImagenSubida, agregarDiapositivas, nubeDisponible, ERROR_SIN_NUBE };
