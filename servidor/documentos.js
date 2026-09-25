// ---- «Subir documento»: trabajos en segundo plano con progreso en vivo ----
// El celular sube el archivo y listo: todo lo demás lo hace el servidor (pasar
// Word/Excel/PowerPoint a PDF, dibujar cada página, comprimirla, subirla y
// agregarla al show). Cada paso se avisa por Socket.IO a la sala del dueño
// ('owner:' + nombre) con el evento «documentoProgreso». Si el celular recarga
// la página o se va y vuelve, pide GET /api/documentos y sigue mostrando el avance.
//
// Cada trabajo queda guardado (su estado y el documento) para que un reinicio del servidor
// no lo pierda: al volver a arrancar, retomarTrabajos() los sigue desde donde iban (las
// páginas ya subidas no se vuelven a hacer). Con base de datos se guardan en Postgres; sin
// ella en datos/documentos/, que sirve en la PC pero en Render se borra en cada reinicio.
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { CARPETA_DATOS } = require('./configuracion');
const { baseDeDatos } = require('./almacen');
const { requierePersona } = require('./personas');
const { convertirAPdf, EXTENSIONES_OFFICE } = require('./conversion-office');
const { CALIDADES, abrirPdf, imagenDePagina, miniaturaDePagina, vistaDePagina } = require('./paginas-pdf');
const { subirImagen, borrarImagenSubida, agregarDiapositivas, nubeDisponible, ERROR_SIN_NUBE } = require('./diapositivas');

const MAXIMO_MB = 25;
const MAXIMO_PAGINAS = 60;
const MAXIMO_TRABAJOS_POR_PERSONA = 5;
const GUARDAR_TERMINADOS_MS = 60 * 60 * 1000;  // «Listo» sigue visible una hora
const GUARDAR_SIN_ELEGIR_MS = 3 * 60 * 60 * 1000; // si nadie elige las páginas, se descarta a las 3 horas
const FASES_TERMINADAS = ['listo', 'error', 'cancelado'];

const trabajos = new Map();
let io = null;

// ---- Guardado de los trabajos ----
const CARPETA_TRABAJOS = path.join(CARPETA_DATOS, 'documentos');
const ID_VALIDO = /^[A-Za-z0-9_-]+$/;

// Lo que se guarda de cada trabajo (sin los bytes, que van aparte).
const CAMPOS_GUARDADOS = ['id', 'owner', 'nombre', 'esOffice', 'archivoEsPdf', 'pesoOriginal', 'fase', 'paso', 'porcentaje',
  'hechas', 'total', 'paginasTotales', 'error', 'resultado', 'creado', 'actualizado', 'paginas', 'calidad', 'recortar',
  'subidas', 'peso', 'agregadas', 'cancelado'];

const guardado = {
  async preparar() {
    const db = baseDeDatos();
    if (db) {
      await db.consulta('CREATE TABLE IF NOT EXISTS documentos (id TEXT PRIMARY KEY, dueno TEXT NOT NULL, estado JSONB NOT NULL)');
      await db.consulta('CREATE TABLE IF NOT EXISTS documentos_archivos (id TEXT PRIMARY KEY, contenido BYTEA NOT NULL)');
    } else {
      await fs.mkdir(CARPETA_TRABAJOS, { recursive: true });
    }
  },
  async estado(t) {
    const estado = Object.fromEntries(CAMPOS_GUARDADOS.map(c => [c, t[c] ?? null]));
    const db = baseDeDatos();
    if (db) {
      await db.consulta(`INSERT INTO documentos (id, dueno, estado) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado`, [t.id, t.owner, JSON.stringify(estado)]);
    } else {
      await fs.writeFile(path.join(CARPETA_TRABAJOS, t.id + '.json'), JSON.stringify(estado));
    }
  },
  async archivo(id, bytes) {
    const db = baseDeDatos();
    if (db) {
      await db.consulta(`INSERT INTO documentos_archivos (id, contenido) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET contenido = EXCLUDED.contenido`, [id, bytes]);
    } else {
      await fs.writeFile(path.join(CARPETA_TRABAJOS, id + '.bin'), bytes);
    }
  },
  async leerArchivo(id) {
    const db = baseDeDatos();
    if (db) {
      const [fila] = await db.consulta('SELECT contenido FROM documentos_archivos WHERE id = $1', [id]);
      return fila ? Buffer.from(fila.contenido) : null;
    }
    return fs.readFile(path.join(CARPETA_TRABAJOS, id + '.bin')).catch(() => null);
  },
  async borrarArchivo(id) {
    const db = baseDeDatos();
    if (db) await db.consulta('DELETE FROM documentos_archivos WHERE id = $1', [id]);
    else await fs.unlink(path.join(CARPETA_TRABAJOS, id + '.bin')).catch(() => {});
  },
  async borrar(id) {
    await guardado.borrarArchivo(id);
    const db = baseDeDatos();
    if (db) await db.consulta('DELETE FROM documentos WHERE id = $1', [id]);
    else await fs.unlink(path.join(CARPETA_TRABAJOS, id + '.json')).catch(() => {});
  },
  async todos() {
    const db = baseDeDatos();
    if (db) {
      return (await db.consulta('SELECT estado FROM documentos')).map(f => (typeof f.estado === 'string' ? JSON.parse(f.estado) : f.estado));
    }
    const estados = [];
    for (const archivo of await fs.readdir(CARPETA_TRABAJOS)) {
      if (!archivo.endsWith('.json')) continue;
      try { estados.push(JSON.parse(await fs.readFile(path.join(CARPETA_TRABAJOS, archivo), 'utf8'))); } catch { /* dañado */ }
    }
    return estados.filter(e => e && typeof e.id === 'string' && ID_VALIDO.test(e.id));
  }
};

// Guarda el estado sin frenar el trabajo; si hay varios cambios seguidos, se guarda el último.
function persistir(t) {
  if (t.borrado) return Promise.resolve();
  t.sucio = true;
  if (!t.guardando) {
    t.guardando = (async () => {
      while (t.sucio && !t.borrado) {
        t.sucio = false;
        await guardado.estado(t).catch(err => console.error('No se pudo guardar el estado del documento', t.nombre, err.message));
      }
      t.guardando = null;
    })();
  }
  return t.guardando;
}

// Si guardar el documento falla (por ejemplo, la base de datos está llena), el trabajo sigue
// igual; sólo que no se podría retomar tras un reinicio.
async function guardarArchivo(t, bytes, esPdf) {
  try {
    await guardado.archivo(t.id, bytes);
    t.archivoEsPdf = esPdf;
    await persistir(t);
  } catch (err) {
    console.error('No se pudo guardar el documento', t.nombre, err.message);
  }
}

function quitarTrabajo(t) {
  trabajos.delete(t.id);
  t.borrado = true;
  Promise.resolve(t.guardando).then(() => guardado.borrar(t.id))
    .catch(err => console.error('No se pudo borrar el documento guardado', t.nombre, err.message));
}

// De a un trabajo pesado a la vez (convertir, dibujar): en Render gratis la memoria es poca.
let fila = Promise.resolve();
let ocupados = 0; // trabajos en curso + en espera
function enFila(tarea) {
  ocupados++;
  const resultado = fila.then(() => tarea(), () => tarea()).finally(() => { ocupados--; });
  fila = resultado.catch(() => {});
  return resultado;
}

// Lo que ve el celular (sin los bytes del documento ni las miniaturas, que son pesados).
function resumen(t) {
  return {
    id: t.id,
    owner: t.owner,
    nombre: t.nombre,
    fase: t.fase,               // preparando | eligiendo | procesando | listo | error | cancelado
    paso: t.paso,               // texto para mostrar
    porcentaje: t.porcentaje,   // 0-100, o null mientras LibreOffice convierte (no se puede medir)
    hechas: t.hechas,
    total: t.total,
    paginasTotales: t.paginasTotales,
    error: t.error || null,
    resultado: t.resultado || null,
    creado: t.creado
  };
}

// El aviso va sólo a los dispositivos del dueño y al admin (que ve los de todos).
function avanzar(t, cambios) {
  Object.assign(t, cambios, { actualizado: Date.now() });
  if (io) io.to('owner:' + t.owner).to('admins').emit('documentoProgreso', resumen(t));
  persistir(t);
}

// Ya no hace falta el documento (terminó, falló o se canceló): se suelta de la memoria y del guardado.
function liberar(t) {
  t.archivo = null;
  t.pdfBytes = null;
  t.miniaturas = null;
  guardado.borrarArchivo(t.id).catch(() => {});
}

function errorConEstado(mensaje) {
  const error = new Error(mensaje);
  error.estado = 500;
  return error;
}

function fallo(t, err, subidas = 0) {
  if (!err.estado) console.error('Documento', t.nombre, err);
  liberar(t);
  const mensaje = err.estado ? err.message : 'Algo falló al procesar el documento.';
  avanzar(t, {
    fase: 'error',
    porcentaje: null,
    error: subidas ? `Se agregaron ${subidas} páginas antes del problema. ${mensaje}` : mensaje,
    paso: 'No se pudo terminar.'
  });
}

function cancelado(t) {
  liberar(t);
  avanzar(t, { fase: 'cancelado', porcentaje: null, paso: 'Cancelado.' });
  // Cuenta borrada por el admin: el trabajo desaparece del todo, como si nunca hubiera existido.
  if (t.borrarAlTerminar) quitarTrabajo(t);
}

function textoPaginas(n) {
  return `${n} ${n === 1 ? 'página' : 'páginas'}`;
}

// Paso 1: pasar a PDF (si hace falta) y preparar las miniaturas para elegir páginas.
// Si se retoma tras un reinicio y el PDF ya estaba convertido, no se vuelve a convertir.
async function preparar(t) {
  try {
    if (ocupados > 0) avanzar(t, { paso: 'Esperando turno (hay otro documento en proceso)…', porcentaje: 0 });
    await enFila(async () => {
      if (t.cancelado) return;
      if (!t.pdfBytes) {
        if (t.esOffice) {
          avanzar(t, { paso: 'Convirtiendo a PDF… (puede tardar unos segundos)', porcentaje: null });
          t.pdfBytes = await convertirAPdf(t.archivo, t.nombre);
          await guardarArchivo(t, t.pdfBytes, true);
        } else {
          t.pdfBytes = t.archivo;
        }
        t.archivo = null;
      }
      const pdf = await abrirPdf(t.pdfBytes);
      try {
        const total = Math.min(pdf.numPages, MAXIMO_PAGINAS);
        t.miniaturas = [];
        avanzar(t, { paginasTotales: pdf.numPages, total, hechas: 0, porcentaje: 0, paso: `Detecté ${textoPaginas(pdf.numPages)}. Preparando la vista previa…` });
        for (let n = 1; n <= total && !t.cancelado; n++) {
          t.miniaturas.push(await miniaturaDePagina(pdf, n));
          avanzar(t, { hechas: n, porcentaje: Math.round((n / total) * 100), paso: `Preparando la vista previa: página ${n} de ${total}…` });
        }
      } finally {
        await pdf.destroy();
      }
    });
    if (t.cancelado) return cancelado(t);
    const tope = t.paginasTotales > MAXIMO_PAGINAS ? ` (se muestran las primeras ${MAXIMO_PAGINAS})` : '';
    avanzar(t, { fase: 'eligiendo', porcentaje: 100, paso: `Detecté ${textoPaginas(t.paginasTotales)}${tope}. Elegí cuáles subir.` });
  } catch (err) {
    fallo(t, err);
  }
}

function terminar(t) {
  liberar(t);
  const n = t.subidas.length;
  avanzar(t, {
    fase: 'listo', porcentaje: 100, paso: `Listo: ${n} ${n === 1 ? 'diapositiva agregada' : 'diapositivas agregadas'}.`,
    resultado: { subidas: n, pesoFinal: t.peso, pesoOriginal: t.pesoOriginal }
  });
}

// Paso 2: dibujar, comprimir y subir cada página elegida; al final se agregan al show, en orden.
// Las ya subidas quedan en t.subidas (guardado): al retomar se sigue desde la siguiente.
async function procesar(t) {
  const { paginas, calidad, recortar } = t;
  const subidas = t.subidas;
  try {
    const retomado = subidas.length > 0;
    avanzar(t, { fase: 'procesando', hechas: subidas.length, total: paginas.length, porcentaje: Math.round((subidas.length / paginas.length) * 100),
      paso: ocupados > 0 ? 'Esperando turno (hay otro documento en proceso)…' : (retomado ? 'Retomando…' : 'Empezando…') });
    await enFila(async () => {
      const pdf = await abrirPdf(t.pdfBytes);
      try {
        for (let i = subidas.length; i < paginas.length; i++) {
          if (t.cancelado) break;
          const numero = paginas[i];
          const de = `página ${numero} (${i + 1} de ${paginas.length})`;
          avanzar(t, { paso: `Comprimiendo ${de}…`, porcentaje: Math.round(((i + 0.2) / paginas.length) * 100) });
          const imagen = await imagenDePagina(pdf, numero, calidad, recortar);
          if (t.cancelado) break;
          avanzar(t, { paso: `Subiendo ${de}…`, porcentaje: Math.round(((i + 0.6) / paginas.length) * 100) });
          subidas.push(await subirImagen(imagen, 'image/webp', t.owner, `doc-${t.id}-p${numero}.webp`));
          t.peso += imagen.length;
          avanzar(t, { hechas: i + 1, porcentaje: Math.round(((i + 1) / paginas.length) * 100) });
        }
      } finally {
        await pdf.destroy();
      }
    });
    if (t.cancelado) {
      await Promise.all(subidas.map(borrarImagenSubida));
      return cancelado(t);
    }
    await agregarDiapositivas(subidas);
    t.agregadas = true;
    terminar(t);
  } catch (err) {
    // Lo que ya se subió no se pierde: se agrega al show igual.
    if (subidas.length && !t.agregadas) {
      await agregarDiapositivas(subidas).then(() => { t.agregadas = true; }).catch(() => {});
    }
    fallo(t, err, subidas.length);
  }
}

// Al arrancar: vuelve a poner en marcha los trabajos que quedaron a mitad por un reinicio.
async function retomarTrabajos() {
  await guardado.preparar();
  const estados = (await guardado.todos()).sort((a, b) => a.creado - b.creado);
  let retomados = 0;
  for (const estado of estados) {
    const t = { ...estado, archivo: null, pdfBytes: null, miniaturas: null, guardando: null, sucio: false };
    trabajos.set(t.id, t);
    if (FASES_TERMINADAS.includes(t.fase)) continue;
    retomados++;
    if (t.agregadas) { terminar(t); continue; }
    if (t.cancelado) {
      await Promise.all((t.subidas || []).map(borrarImagenSubida));
      cancelado(t);
      continue;
    }
    const bytes = await guardado.leerArchivo(t.id).catch(() => null);
    if (!bytes || (t.fase === 'procesando' && !t.archivoEsPdf)) {
      fallo(t, errorConEstado('El servidor se reinició y no se pudo recuperar el documento. Subilo de nuevo.'));
      continue;
    }
    if (t.archivoEsPdf) t.pdfBytes = bytes; else t.archivo = bytes;
    if (t.fase === 'procesando') {
      procesar(t);
    } else {
      avanzar(t, { fase: 'preparando', porcentaje: 0, paso: 'Retomando después de un reinicio del servidor…' });
      preparar(t);
    }
  }
  if (retomados) console.log(`📄 ${retomados} documentos retomados después del reinicio.`);
}

// Al apagar: espera que termine de guardarse el estado de cada trabajo.
async function vaciarTrabajos() {
  await Promise.all([...trabajos.values()].map(t => t.guardando));
}

// Para cuando el admin borra una cuenta: corta sus documentos en proceso (lo que ya se había
// subido de ellos se borra solo al cancelar) y los quita de la lista, también los terminados.
function cancelarTrabajosDe(nombres) {
  const quitar = new Set(nombres);
  for (const t of [...trabajos.values()]) {
    if (!quitar.has(t.owner)) continue;
    if (FASES_TERMINADAS.includes(t.fase)) { quitarTrabajo(t); continue; }
    t.cancelado = true;
    t.borrarAlTerminar = true;
    if (t.fase === 'eligiendo') cancelado(t); else persistir(t);
  }
}

function limpiarViejos() {
  const ahora = Date.now();
  for (const t of [...trabajos.values()]) {
    const terminado = FASES_TERMINADAS.includes(t.fase);
    if ((terminado && ahora - t.actualizado > GUARDAR_TERMINADOS_MS) || (t.fase === 'eligiendo' && ahora - t.actualizado > GUARDAR_SIN_ELEGIR_MS)) {
      quitarTrabajo(t);
    }
  }
}
setInterval(limpiarViejos, 5 * 60 * 1000).unref();

// Cada persona sólo ve y toca sus propios documentos; el admin (ADMIN_PIN) ve y maneja los de
// todos, igual que con las imágenes. Un documento ajeno responde igual que uno inexistente.
function puedeVer(persona, t) {
  return persona.isAdmin || t.owner === persona.name;
}

function propio(req, res) {
  const t = trabajos.get(req.params.id);
  if (!t || !puedeVer(req.person, t)) {
    res.status(404).json({ error: 'Ese documento ya no está (pasó mucho tiempo desde que se subió).' });
    return null;
  }
  return t;
}

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAXIMO_MB * 1024 * 1024, files: 1 } });

function registrarRutasDocumentos(app, ioServidor) {
  io = ioServidor;

  // POST /api/documentos — recibe un PDF/Word/Excel/PowerPoint y arranca el trabajo.
  app.post('/api/documentos', requierePersona, (req, res) => {
    subida.single('documento')(req, res, async (errorSubida) => {
      if (errorSubida) {
        const grande = errorSubida.code === 'LIMIT_FILE_SIZE';
        return res.status(grande ? 413 : 400).json({
          error: grande ? `El documento pesa más de ${MAXIMO_MB} MB. Guardalo como PDF o dividilo.` : 'No se pudo recibir el documento.'
        });
      }
      if (!req.file) return res.status(400).json({ error: 'No se recibió ningún documento.' });
      // multer entrega el nombre en latin1: se pasa a UTF-8 para no romper tildes y eñes.
      const nombre = Buffer.from(req.file.originalname || 'documento', 'latin1').toString('utf8').slice(0, 120);
      const extension = path.extname(nombre).toLowerCase();
      const esPdf = extension === '.pdf';
      if (!esPdf && !EXTENSIONES_OFFICE.includes(extension)) {
        return res.status(400).json({ error: `«${nombre}» no es PDF, Word, Excel ni PowerPoint.` });
      }
      const activos = [...trabajos.values()].filter(t => t.owner === req.person.name && !FASES_TERMINADAS.includes(t.fase));
      if (activos.length >= MAXIMO_TRABAJOS_POR_PERSONA) {
        return res.status(429).json({ error: `Ya tenés ${activos.length} documentos en proceso. Esperá que terminen.` });
      }
      const t = {
        id: crypto.randomBytes(9).toString('base64url'),
        owner: req.person.name,
        nombre,
        esOffice: !esPdf,
        archivoEsPdf: false,
        archivo: req.file.buffer,
        pesoOriginal: req.file.size,
        fase: 'preparando',
        paso: 'Recibido.',
        porcentaje: 0,
        hechas: 0,
        total: 0,
        paginasTotales: 0,
        paginas: null,
        calidad: null,
        recortar: true,
        subidas: [],
        peso: 0,
        agregadas: false,
        creado: Date.now(),
        actualizado: Date.now(),
        cancelado: false
      };
      trabajos.set(t.id, t);
      res.status(202).json(resumen(t));
      await guardarArchivo(t, t.archivo, esPdf);
      preparar(t);
    });
  });

  // GET /api/documentos — los trabajos propios (para retomar el progreso al recargar o volver).
  app.get('/api/documentos', requierePersona, (req, res) => {
    res.json([...trabajos.values()]
      .filter(t => puedeVer(req.person, t))
      .sort((a, b) => a.creado - b.creado)
      .map(resumen));
  });

  // GET /api/documentos/:id/miniaturas — vista previa para elegir páginas.
  app.get('/api/documentos/:id/miniaturas', requierePersona, (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    if (t.fase !== 'eligiendo' || !t.miniaturas) return res.status(409).json({ error: 'La vista previa todavía no está lista.' });
    res.json({ miniaturas: t.miniaturas });
  });

  // GET /api/documentos/:id/pagina/:numero — una página en grande, para verla antes de elegir.
  app.get('/api/documentos/:id/pagina/:numero', requierePersona, async (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    const numero = Number(req.params.numero);
    if (t.fase !== 'eligiendo' || !t.pdfBytes) return res.status(409).json({ error: 'La vista previa ya no está disponible.' });
    if (!Number.isInteger(numero) || numero < 1 || numero > t.total) return res.status(400).json({ error: 'Esa página no existe.' });
    try {
      const pdf = await abrirPdf(t.pdfBytes);
      try {
        const imagen = await vistaDePagina(pdf, numero);
        res.set('Cache-Control', 'private, max-age=600').type('image/webp').send(imagen);
      } finally {
        await pdf.destroy();
      }
    } catch (err) {
      console.error('Vista de página', t.nombre, numero, err);
      res.status(500).json({ error: 'No se pudo mostrar la página.' });
    }
  });

  // POST /api/documentos/:id/procesar — { paginas: [1, 3, …], calidad, recortar }
  app.post('/api/documentos/:id/procesar', requierePersona, (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    if (t.fase !== 'eligiendo') return res.status(409).json({ error: 'Este documento ya se está procesando o terminó.' });
    const { paginas, calidad, recortar } = req.body || {};
    const validas = Array.isArray(paginas) && paginas.length > 0 && new Set(paginas).size === paginas.length &&
      paginas.every(n => Number.isInteger(n) && n >= 1 && n <= t.total);
    if (!validas) return res.status(400).json({ error: 'Elegí al menos una página.' });
    if (!Object.prototype.hasOwnProperty.call(CALIDADES, calidad)) return res.status(400).json({ error: 'Calidad inválida.' });
    if (!nubeDisponible()) return res.status(500).json({ error: ERROR_SIN_NUBE });
    t.miniaturas = null;
    Object.assign(t, { paginas: [...paginas].sort((a, b) => a - b), calidad, recortar: recortar !== false, subidas: [], peso: 0 });
    procesar(t);
    res.json(resumen(t));
  });

  // POST /api/documentos/:id/cancelar — corta después de la página que está haciendo y borra lo ya subido.
  app.post('/api/documentos/:id/cancelar', requierePersona, (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    if (FASES_TERMINADAS.includes(t.fase)) return res.json(resumen(t));
    t.cancelado = true;
    if (t.fase === 'eligiendo') cancelado(t); else persistir(t);
    res.json(resumen(t));
  });

  // DELETE /api/documentos/:id — «Cerrar» un trabajo terminado para que no se muestre más.
  app.delete('/api/documentos/:id', requierePersona, (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    if (!FASES_TERMINADAS.includes(t.fase)) return res.status(409).json({ error: 'Todavía se está procesando.' });
    quitarTrabajo(t);
    res.json({ ok: true });
  });
}

module.exports = { registrarRutasDocumentos, retomarTrabajos, vaciarTrabajos, cancelarTrabajosDe, MAXIMO_MB, MAXIMO_PAGINAS };
