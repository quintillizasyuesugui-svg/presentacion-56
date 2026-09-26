// ---- Administración (sólo el admin, ADMIN_PIN) ----
// Ver las personas registradas y borrar cuentas basura, de a una o varias juntas. Borrar una
// cuenta quita también todo lo suyo: diapositivas (e imágenes en Cloudinary), frase final,
// avance automático, música y videos, y documentos en proceso, como si nunca hubiera existido. No se puede
// deshacer; el celular pide confirmar antes.
const { requiereAdmin, nombresDePersonas, borrarPersonas } = require('./personas');
const { contarPorDueno, quitarDiapositivasDe } = require('./diapositivas');
const { borrarFraseDe } = require('./frase-final');
const { borrarAvanceDe } = require('./avance-automatico');
const { cancelarTrabajosDe } = require('./documentos');
const { estadoGuardian } = require('./guardian');
const { espacioPorPersona, espacioDe, espacioFijoDe, calculoAutomatico, usadoTotal, fijarEspacio, quitarMultimediaDe, usoDeLaNube, MB } = require('./multimedia');

const ESPACIO_MAXIMO_MB = 5000;

// Alcanza para borrar de una vez todas las cuentas de una prueba de carga (400) o de un curso entero.
const MAXIMO_POR_VEZ = 2000;

// Los borrados van de a uno: dos pedidos al mismo tiempo no se pisan al escribir los datos.
let fila = Promise.resolve();
function enFila(tarea) {
  const resultado = fila.then(tarea, tarea);
  fila = resultado.catch(() => {});
  return resultado;
}

// Borra las cuentas que existan de la lista; devuelve { borradas: [{ name, diapositivas }], noEncontradas }.
function borrarCuentas(nombres) {
  return enFila(async () => {
    const existentes = new Set(await nombresDePersonas());
    const aBorrar = [...new Set(nombres)].filter(n => existentes.has(n));
    const noEncontradas = [...new Set(nombres)].filter(n => !existentes.has(n));
    if (!aBorrar.length) return { borradas: [], noEncontradas };
    // Primero lo suyo y al final las cuentas: si algo falla a mitad, se puede reintentar.
    cancelarTrabajosDe(aBorrar);
    const diapositivas = await quitarDiapositivasDe(aBorrar);
    await quitarMultimediaDe(aBorrar);
    await borrarFraseDe(aBorrar);
    await borrarAvanceDe(aBorrar);
    await borrarPersonas(aBorrar);
    return { borradas: aBorrar.map(name => ({ name, diapositivas: diapositivas[name] || 0 })), noEncontradas };
  });
}

function registrarRutasAdministracion(app) {
  // GET /api/admin/personas — [{ name, diapositivas, espacio: { usado, total, canciones, videos } }], sin los PIN.
  app.get('/api/admin/personas', requiereAdmin, async (req, res) => {
    try {
      const conteo = await contarPorDueno();
      const multimedia = espacioPorPersona();
      const personas = (await nombresDePersonas())
        .map(name => ({
          name,
          diapositivas: conteo[name] || 0,
          espacio: { ...espacioDe(name), fijoMb: espacioFijoDe(name), canciones: (multimedia[name] || {}).canciones || 0, videos: (multimedia[name] || {}).videos || 0 }
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      res.json(personas);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en servidor' });
    }
  });

  // POST /api/admin/personas/borrar — { nombres: [...] }: borra varias cuentas juntas.
  app.post('/api/admin/personas/borrar', requiereAdmin, async (req, res) => {
    const nombres = (req.body || {}).nombres;
    if (!Array.isArray(nombres) || !nombres.length || nombres.length > MAXIMO_POR_VEZ || !nombres.every(n => typeof n === 'string' && n)) {
      return res.status(400).json({ error: `Elegí entre 1 y ${MAXIMO_POR_VEZ} personas.` });
    }
    try {
      res.json(await borrarCuentas(nombres));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron borrar las cuentas. Probá de nuevo.' });
    }
  });

  // DELETE /api/admin/personas/:nombre — borra una cuenta y todo lo suyo.
  app.delete('/api/admin/personas/:nombre', requiereAdmin, async (req, res) => {
    try {
      const { borradas } = await borrarCuentas([req.params.nombre]);
      if (!borradas.length) return res.status(404).json({ error: 'Esa persona ya no existe.' });
      res.json({ ok: true, ...borradas[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo borrar la cuenta. Probá de nuevo.' });
    }
  });

  // POST /api/admin/espacio — { nombre, mb }: le fija a una persona su espacio para música y
  // videos. mb = null la vuelve al espacio automático (el del calculador).
  app.post('/api/admin/espacio', requiereAdmin, async (req, res) => {
    const { nombre, mb } = req.body || {};
    const existe = typeof nombre === 'string' && (await nombresDePersonas()).includes(nombre);
    if (!existe) return res.status(404).json({ error: 'Esa persona ya no existe.' });
    if (mb !== null && (!Number.isInteger(mb) || mb < 0 || mb > ESPACIO_MAXIMO_MB)) {
      return res.status(400).json({ error: `Escribí un número de MB entre 0 y ${ESPACIO_MAXIMO_MB}.` });
    }
    try {
      await fijarEspacio(nombre, mb);
      res.json({ ok: true, espacio: { ...espacioDe(nombre), fijoMb: espacioFijoDe(nombre) } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo cambiar el espacio. Probá de nuevo.' });
    }
  });

  // GET /api/admin/guardian — qué está haciendo el Guardián: filas, cupo de Cloudinary y sus
  // últimas decisiones con el motivo.
  app.get('/api/admin/guardian', requiereAdmin, (req, res) => {
    res.json(estadoGuardian());
  });

  // GET /api/admin/nube — el calculador de espacio, cuánto se guardó en total y cuánto se usó
  // este mes de la cuenta gratis de Cloudinary (null sin Cloudinary).
  app.get('/api/admin/nube', requiereAdmin, async (req, res) => {
    res.json({ calculo: calculoAutomatico(), usadoTotal: usadoTotal(), nube: await usoDeLaNube(), mb: MB });
  });
}

module.exports = { registrarRutasAdministracion };
