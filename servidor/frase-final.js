// ---- Frase final (por persona) ----
// Cada persona configura su propio mensaje de cierre — aparece en pantalla.html
// cuando SU show (sus propias diapositivas) llega al final. Se guarda igual que el
// resto: datos/frases-finales.json con respaldo crudo en Cloudinary.
const { crearAlmacenJson } = require('./almacen');
const { requierePersona } = require('./personas');
// Listas de letras/efectos y validación viven en validadores-frase.js — separado
// para poder probarlas sin levantar el servidor (ver pruebas/validadores-frase.test.js).
const { FRASE_DEFAULT, parseFraseBody } = require('./validadores-frase');

const almacenFrases = crearAlmacenJson({
  archivo: 'frases-finales.json',
  archivoViejo: 'frases-finales.json',
  idNube: 'presentacion/frases-finales',
  que: 'frases finales',
  elQue: 'las frases finales'
});

async function leerFrases() {
  return (await almacenFrases.leer()) || [];
}

// Para cuando el admin borra una cuenta.
async function borrarFraseDe(nombre) {
  const frases = await leerFrases();
  const quedan = frases.filter(f => f.owner !== nombre);
  if (quedan.length !== frases.length) await almacenFrases.escribir(quedan);
}

function registrarRutasFraseFinal(app, io) {
  // GET /api/frase-final — la frase de cierre propia (valores por default si nunca la configuró)
  app.get('/api/frase-final', requierePersona, async (req, res) => {
    try {
      const frases = await leerFrases();
      const propia = frases.find(f => f.owner === req.person.name);
      res.json(propia ? {
        text: propia.text,
        font: propia.font,
        color: propia.color,
        color2: propia.color2 || '',
        effect: propia.effect,
        duration: propia.duration || 1,
        fontSize: propia.fontSize || 1,
        position: propia.position || 'middle'
      } : FRASE_DEFAULT);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en servidor' });
    }
  });

  // POST /api/frase-final — guarda la frase de cierre propia
  app.post('/api/frase-final', requierePersona, async (req, res) => {
    try {
      const datos = parseFraseBody(req.body);
      if (!datos) return res.status(400).json({ error: 'Revisá el texto, la letra, el color o el efecto.' });

      const frases = await leerFrases();
      const posicion = frases.findIndex(f => f.owner === req.person.name);
      const registro = { owner: req.person.name, ...datos };
      if (posicion === -1) frases.push(registro); else frases[posicion] = registro;
      await almacenFrases.escribir(frases);
      res.json(datos);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar la frase.' });
    }
  });

  // POST /api/frase-final/send — la muestra ya mismo en la pantalla propia (para
  // probarla en el proyector real sin esperar a que termine el show). No hace
  // falta haberla guardado antes — manda el borrador tal cual está en el editor.
  app.post('/api/frase-final/send', requierePersona, (req, res) => {
    const datos = parseFraseBody(req.body);
    if (!datos) return res.status(400).json({ error: 'Revisá el texto, la letra, el color o el efecto.' });
    io.to('owner:' + req.person.name).emit('fraseFinalAhora', datos);
    res.json({ ok: true });
  });
}

module.exports = { registrarRutasFraseFinal, borrarFraseDe };
