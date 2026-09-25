// ---- Avance automático (por persona) ----
// Opcional: si está prendido, pantalla.html pasa sola a la siguiente diapositiva
// cada tantos segundos, sin que nadie tenga que tocar "Siguiente" — sólo afecta
// a la pantalla de esa persona (es 100% local ahí, no manda nada por socket).
const { crearAlmacenJson } = require('./almacen');
const { requierePersona } = require('./personas');

const AVANCE_POR_DEFECTO = { enabled: false, seconds: 120 };

const almacenAvance = crearAlmacenJson({
  archivo: 'avance-automatico.json',
  archivoViejo: 'avance-automatico.json',
  idNube: 'presentacion/avance-automatico',
  que: 'avance automático',
  elQue: 'el avance automático'
});

async function leerAvances() {
  return (await almacenAvance.leer()) || [];
}

// Entre 3 segundos y 1 hora — evita un valor absurdo (0s en loop infinito, o
// tan largo que en la práctica nunca avanza).
function interpretarAvance(cuerpo) {
  const enabled = !!(cuerpo || {}).enabled;
  const segundosCrudos = Number((cuerpo || {}).seconds);
  const seconds = Number.isFinite(segundosCrudos) ? Math.min(3600, Math.max(3, Math.round(segundosCrudos))) : null;
  if (seconds === null) return null;
  return { enabled, seconds };
}

// Para cuando el admin borra una cuenta.
async function borrarAvanceDe(nombre) {
  const lista = await leerAvances();
  const quedan = lista.filter(r => r.owner !== nombre);
  if (quedan.length !== lista.length) await almacenAvance.escribir(quedan);
}

function registrarRutasAvanceAutomatico(app) {
  app.get('/api/avance-automatico', requierePersona, async (req, res) => {
    try {
      const lista = await leerAvances();
      const propio = lista.find(r => r.owner === req.person.name);
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

      const lista = await leerAvances();
      const posicion = lista.findIndex(r => r.owner === req.person.name);
      const registro = { owner: req.person.name, ...datos };
      if (posicion === -1) lista.push(registro); else lista[posicion] = registro;
      await almacenAvance.escribir(lista);
      res.json(datos);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar el avance automático.' });
    }
  });
}

module.exports = { registrarRutasAvanceAutomatico, interpretarAvance, borrarAvanceDe };
