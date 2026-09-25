// ---- Avance automático (por persona) ----
// Opcional: si está prendido, pantalla.html pasa sola a la siguiente diapositiva
// cada tantos segundos, sin que nadie tenga que tocar "Siguiente" — sólo afecta
// a la pantalla de esa persona (es 100% local ahí, no manda nada por socket).
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { requierePersona } = require('./personas');

const AVANCE_POR_DEFECTO = { enabled: false, seconds: 120 };

const almacenAvance = crearAlmacen({
  archivo: 'avance-automatico.json',
  archivoViejo: 'avance-automatico.json',
  idNube: 'presentacion/avance-automatico',
  elQue: 'el avance automático',
  tabla: {
    nombre: 'avance_automatico',
    clave: 'dueno',
    columnas: { dueno: 'TEXT PRIMARY KEY', activo: 'BOOLEAN NOT NULL', segundos: 'INTEGER NOT NULL' },
    aFila: r => ({ dueno: r.owner, activo: Boolean(r.enabled), segundos: r.seconds }),
    deFila: f => ({ owner: f.dueno, enabled: f.activo, seconds: f.segundos })
  }
});

// Entre 3 segundos y 1 hora — evita un valor absurdo (0s en loop infinito, o
// tan largo que en la práctica nunca avanza).
function interpretarAvance(cuerpo) {
  const enabled = !!(cuerpo || {}).enabled;
  const segundosCrudos = Number((cuerpo || {}).seconds);
  const seconds = Number.isFinite(segundosCrudos) ? Math.min(3600, Math.max(3, Math.round(segundosCrudos))) : null;
  if (seconds === null) return null;
  return { enabled, seconds };
}

// Para cuando el admin borra una o varias cuentas.
async function borrarAvanceDe(nombres) {
  const quitar = new Set(nombres);
  await almacenAvance.modificar((lista) => {
    const quedan = lista.filter(r => !quitar.has(r.owner));
    return quedan.length === lista.length ? SIN_CAMBIOS : quedan;
  });
}

function registrarRutasAvanceAutomatico(app) {
  app.get('/api/avance-automatico', requierePersona, (req, res) => {
    try {
      const propio = almacenAvance.actual().find(r => r.owner === req.person.name);
      res.json(propio ? { enabled: propio.enabled, seconds: propio.seconds } : AVANCE_POR_DEFECTO);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en servidor' });
    }
  });

  app.post('/api/avance-automatico', requierePersona, async (req, res) => {
    try {
      const datos = interpretarAvance(req.body);
      if (!datos) return res.status(400).json({ error: 'Duración inválida.' });

      await almacenAvance.modificar((lista) => {
        const posicion = lista.findIndex(r => r.owner === req.person.name);
        const registro = { owner: req.person.name, ...datos };
        if (posicion === -1) lista.push(registro); else lista[posicion] = registro;
      });
      res.json(datos);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el avance automático.' });
    }
  });
}

module.exports = { registrarRutasAvanceAutomatico, interpretarAvance, borrarAvanceDe };
