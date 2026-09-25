// ---- Frase final (por persona) ----
// Cada persona configura su propio mensaje de cierre — aparece en pantalla.html
// cuando SU show (sus propias diapositivas) llega al final. Se guarda igual que el
// resto (ver almacen.js): tabla frases_finales o datos/frases-finales.json.
const { crearAlmacen, SIN_CAMBIOS } = require('./almacen');
const { requierePersona } = require('./personas');
// Listas de letras/efectos y validación viven en validadores-frase.js — separado
// para poder probarlas sin levantar el servidor (ver pruebas/validadores-frase.test.js).
const { FRASE_DEFAULT, parseFraseBody } = require('./validadores-frase');

const almacenFrases = crearAlmacen({
  archivo: 'frases-finales.json',
  archivoViejo: 'frases-finales.json',
  idNube: 'presentacion/frases-finales',
  elQue: 'las frases finales',
  tabla: {
    nombre: 'frases_finales',
    clave: 'dueno',
    columnas: { dueno: 'TEXT PRIMARY KEY', datos: 'JSONB NOT NULL' },
    aFila: ({ owner, ...datos }) => ({ dueno: owner, datos }),
    deFila: f => ({ owner: f.dueno, ...f.datos })
  }
});

// Para cuando el admin borra una o varias cuentas.
async function borrarFraseDe(nombres) {
  const quitar = new Set(nombres);
  await almacenFrases.modificar((frases) => {
    const quedan = frases.filter(f => !quitar.has(f.owner));
    return quedan.length === frases.length ? SIN_CAMBIOS : quedan;
  });
}

function registrarRutasFraseFinal(app, io) {
  // GET /api/frase-final — la frase de cierre propia (valores por default si nunca la configuró)
  app.get('/api/frase-final', requierePersona, (req, res) => {
    try {
      const propia = almacenFrases.actual().find(f => f.owner === req.person.name);
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

      await almacenFrases.modificar((frases) => {
        const posicion = frases.findIndex(f => f.owner === req.person.name);
        const registro = { owner: req.person.name, ...datos };
        if (posicion === -1) frases.push(registro); else frases[posicion] = registro;
      });
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
