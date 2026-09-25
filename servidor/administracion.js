// ---- Administración (sólo el admin, ADMIN_PIN) ----
// Ver las personas registradas y borrar cuentas basura, de a una o varias juntas. Borrar una
// cuenta quita también todo lo suyo: diapositivas (e imágenes en Cloudinary), frase final,
// avance automático y documentos en proceso, como si nunca hubiera existido. No se puede
// deshacer; el celular pide confirmar antes.
const { requiereAdmin, nombresDePersonas, borrarPersonas } = require('./personas');
const { contarPorDueno, quitarDiapositivasDe } = require('./diapositivas');
const { borrarFraseDe } = require('./frase-final');
const { borrarAvanceDe } = require('./avance-automatico');
const { cancelarTrabajosDe } = require('./documentos');

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
    await borrarFraseDe(aBorrar);
    await borrarAvanceDe(aBorrar);
    await borrarPersonas(aBorrar);
    return { borradas: aBorrar.map(name => ({ name, diapositivas: diapositivas[name] || 0 })), noEncontradas };
  });
}

function registrarRutasAdministracion(app) {
  // GET /api/admin/personas — [{ name, diapositivas }], sin los PIN.
  app.get('/api/admin/personas', requiereAdmin, async (req, res) => {
    try {
      const conteo = await contarPorDueno();
      const personas = (await nombresDePersonas())
        .map(name => ({ name, diapositivas: conteo[name] || 0 }))
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
}

module.exports = { registrarRutasAdministracion };
