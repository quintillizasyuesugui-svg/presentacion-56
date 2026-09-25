// ---- Administración (sólo el admin, ADMIN_PIN) ----
// Ver las personas registradas y borrar cuentas basura. Borrar una cuenta quita también
// todo lo suyo: diapositivas (e imágenes en Cloudinary), frase final, avance automático y
// documentos en proceso. No se puede deshacer; el celular pide confirmar antes.
const { requiereAdmin, nombresDePersonas, borrarPersona } = require('./personas');
const { contarPorDueno, quitarDiapositivasDe } = require('./diapositivas');
const { borrarFraseDe } = require('./frase-final');
const { borrarAvanceDe } = require('./avance-automatico');
const { cancelarTrabajosDe } = require('./documentos');

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

  // DELETE /api/admin/personas/:nombre — borra la cuenta y todo lo suyo.
  app.delete('/api/admin/personas/:nombre', requiereAdmin, async (req, res) => {
    try {
      const nombre = req.params.nombre;
      if (!(await nombresDePersonas()).includes(nombre)) {
        return res.status(404).json({ error: 'Esa persona ya no existe.' });
      }
      // Primero lo suyo y al final la cuenta: si algo falla a mitad, se puede reintentar.
      cancelarTrabajosDe(nombre);
      const diapositivas = await quitarDiapositivasDe(nombre);
      await borrarFraseDe(nombre);
      await borrarAvanceDe(nombre);
      await borrarPersona(nombre);
      res.json({ ok: true, name: nombre, diapositivas });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo borrar la cuenta. Probá de nuevo.' });
    }
  });
}

module.exports = { registrarRutasAdministracion };
