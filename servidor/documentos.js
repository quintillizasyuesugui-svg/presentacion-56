// ---- «Subir documento»: trabajos en segundo plano con progreso en vivo ----
// El celular sube el archivo y listo: todo lo demás lo hace el servidor (pasar
// Word/Excel/PowerPoint a PDF, dibujar cada página, comprimirla, subirla y
// agregarla al show). Cada paso se avisa por Socket.IO a la sala del dueño
// ('owner:' + nombre) con el evento «documentoProgreso». Si el celular recarga
// la página o se va y vuelve, pide GET /api/documentos y sigue mostrando el avance.
// Los trabajos viven en memoria: si el servidor se reinicia, se pierden.
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
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
}

function liberar(t) {
  t.archivo = null;
  t.pdfBytes = null;
  t.miniaturas = null;
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
}

function textoPaginas(n) {
  return `${n} ${n === 1 ? 'página' : 'páginas'}`;
}

// Paso 1: pasar a PDF (si hace falta) y preparar las miniaturas para elegir páginas.
async function preparar(t) {
  try {
    if (ocupados > 0) avanzar(t, { paso: 'Esperando turno (hay otro documento en proceso)…', porcentaje: 0 });
    await enFila(async () => {
      if (t.cancelado) return;
      if (t.esOffice) {
        avanzar(t, { paso: 'Convirtiendo a PDF… (puede tardar unos segundos)', porcentaje: null });
        t.pdfBytes = await convertirAPdf(t.archivo, t.nombre);
      } else {
        t.pdfBytes = t.archivo;
      }
      t.archivo = null;
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

// Paso 2: dibujar, comprimir y subir cada página elegida; al final se agregan al show, en orden.
async function procesar(t, paginas, calidad, recortar) {
  const subidas = [];
  let peso = 0;
  try {
    avanzar(t, { fase: 'procesando', hechas: 0, total: paginas.length, porcentaje: 0,
      paso: ocupados > 0 ? 'Esperando turno (hay otro documento en proceso)…' : 'Empezando…' });
    await enFila(async () => {
      const pdf = await abrirPdf(t.pdfBytes);
      try {
        for (const [i, numero] of paginas.entries()) {
          if (t.cancelado) break;
          const de = `página ${numero} (${i + 1} de ${paginas.length})`;
          avanzar(t, { paso: `Comprimiendo ${de}…`, porcentaje: Math.round(((i + 0.2) / paginas.length) * 100) });
          const imagen = await imagenDePagina(pdf, numero, calidad, recortar);
          peso += imagen.length;
          if (t.cancelado) break;
          avanzar(t, { paso: `Subiendo ${de}…`, porcentaje: Math.round(((i + 0.6) / paginas.length) * 100) });
          subidas.push(await subirImagen(imagen, 'image/webp', t.owner, `doc-${t.id}-p${numero}.webp`));
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
    liberar(t);
    avanzar(t, {
      fase: 'listo', porcentaje: 100, paso: `Listo: ${subidas.length} ${subidas.length === 1 ? 'diapositiva agregada' : 'diapositivas agregadas'}.`,
      resultado: { subidas: subidas.length, pesoFinal: peso, pesoOriginal: t.pesoOriginal }
    });
  } catch (err) {
    // Lo que ya se subió no se pierde: se agrega al show igual.
    if (subidas.length) await agregarDiapositivas(subidas).catch(() => {});
    fallo(t, err, subidas.length);
  }
}

function limpiarViejos() {
  const ahora = Date.now();
  for (const [id, t] of trabajos) {
    const terminado = FASES_TERMINADAS.includes(t.fase);
    if ((terminado && ahora - t.actualizado > GUARDAR_TERMINADOS_MS) || (t.fase === 'eligiendo' && ahora - t.actualizado > GUARDAR_SIN_ELEGIR_MS)) {
      trabajos.delete(id);
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
    res.status(404).json({ error: 'Ese documento ya no está (pasó mucho tiempo o el servidor se reinició).' });
    return null;
  }
  return t;
}

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAXIMO_MB * 1024 * 1024, files: 1 } });

function registrarRutasDocumentos(app, ioServidor) {
  io = ioServidor;

  // POST /api/documentos — recibe un PDF/Word/Excel/PowerPoint y arranca el trabajo.
  app.post('/api/documentos', requierePersona, (req, res) => {
    subida.single('documento')(req, res, (errorSubida) => {
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
        archivo: req.file.buffer,
        pesoOriginal: req.file.size,
        fase: 'preparando',
        paso: 'Recibido.',
        porcentaje: 0,
        hechas: 0,
        total: 0,
        paginasTotales: 0,
        creado: Date.now(),
        actualizado: Date.now(),
        cancelado: false
      };
      trabajos.set(t.id, t);
      res.status(202).json(resumen(t));
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
    procesar(t, [...paginas].sort((a, b) => a - b), calidad, recortar !== false);
    res.json(resumen(t));
  });

  // POST /api/documentos/:id/cancelar — corta después de la página que está haciendo y borra lo ya subido.
  app.post('/api/documentos/:id/cancelar', requierePersona, (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    if (FASES_TERMINADAS.includes(t.fase)) return res.json(resumen(t));
    t.cancelado = true;
    if (t.fase === 'eligiendo') cancelado(t);
    res.json(resumen(t));
  });

  // DELETE /api/documentos/:id — «Cerrar» un trabajo terminado para que no se muestre más.
  app.delete('/api/documentos/:id', requierePersona, (req, res) => {
    const t = propio(req, res);
    if (!t) return;
    if (!FASES_TERMINADAS.includes(t.fase)) return res.status(409).json({ error: 'Todavía se está procesando.' });
    trabajos.delete(t.id);
    res.json({ ok: true });
  });
}

module.exports = { registrarRutasDocumentos, MAXIMO_MB, MAXIMO_PAGINAS };
