// ===================== Buscar videos de YouTube desde el celular =====================
// YouTube no se deja mostrar ni traer adentro de otra página. En su lugar el celular busca acá,
// elige un video y la pantalla lo pone con el reproductor de YouTube (el que sí se deja mostrar
// adentro). Entre el celular y la pantalla sólo viajan órdenes, no fotos: va fluido y sin la app.
//
// La búsqueda se hace como la haría un navegador: se pide la página de resultados de YouTube y
// se leen los datos que trae adentro (ytInitialData). No necesita clave ni cuesta nada. Si
// YouTube cambia esa página, la búsqueda avisa que no anduvo; lo demás sigue funcionando.
const { requierePersona } = require('./personas');

const TOPE_MS = 8000;
const RESULTADOS = 15;
const GUARDADA_MS = 15 * 60 * 1000;   // la misma búsqueda no se vuelve a pedir en 15 minutos
const GUARDADAS_MAXIMO = 300;
const BUSQUEDAS_POR_MINUTO = 20;      // por persona
const LARGO_BUSQUEDA = 100;
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

class NoSeBusco extends Error {}

const texto = (t) => (t && (t.simpleText || (Array.isArray(t.runs) ? t.runs.map(r => r.text).join('') : ''))) || '';

function segundosDe(duracion) {
  if (!/^\d+(:\d+){0,2}$/.test(duracion)) return 0;
  return duracion.split(':').reduce((total, parte) => total * 60 + Number(parte), 0);
}

// Recorre los datos de la página de resultados y junta los videos (sin listas, canales ni
// anuncios). Los videos en directo no tienen duración: se marcan como «En vivo».
function leerResultados(datos) {
  const videos = [];
  const vistos = new Set();
  const pendientes = [datos];
  while (pendientes.length && videos.length < RESULTADOS) {
    const actual = pendientes.pop();
    if (!actual || typeof actual !== 'object') continue;
    const v = actual.videoRenderer;
    if (v && ID_YOUTUBE.test(v.videoId || '') && !vistos.has(v.videoId)) {
      vistos.add(v.videoId);
      const duracion = texto(v.lengthText);
      videos.push({
        id: v.videoId,
        titulo: texto(v.title).slice(0, 200) || 'Video de YouTube',
        canal: texto(v.ownerText || v.longBylineText).slice(0, 100),
        duracion: duracion || 'En vivo',
        segundos: segundosDe(duracion)
      });
      continue;
    }
    // Al revés, para que salgan en el mismo orden que en YouTube.
    const hijos = Array.isArray(actual) ? actual : Object.values(actual);
    for (let i = hijos.length - 1; i >= 0; i--) if (hijos[i] && typeof hijos[i] === 'object') pendientes.push(hijos[i]);
  }
  return videos;
}

async function buscarEnYoutube(busqueda) {
  // sp=EgIQAQ== es el filtro «Tipo: Video» de YouTube.
  const direccion = 'https://www.youtube.com/results?hl=es&sp=EgIQAQ%253D%253D&search_query=' + encodeURIComponent(busqueda);
  let respuesta;
  try {
    respuesta = await fetch(direccion, {
      signal: AbortSignal.timeout(TOPE_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        'Accept-Language': 'es-419,es;q=0.9',
        // Sin esto, en Europa YouTube contesta con la página de «Antes de continuar».
        Cookie: 'CONSENT=YES+1; SOCS=CAI'
      }
    });
  } catch (error) {
    throw new NoSeBusco(error.name === 'TimeoutError' ? 'YouTube tardó demasiado. Probá de nuevo.' : 'No se pudo conectar con YouTube.');
  }
  if (!respuesta.ok) throw new NoSeBusco('YouTube no contestó la búsqueda. Probá de nuevo en un rato.');
  const html = await respuesta.text();
  const inicio = html.indexOf('ytInitialData = ');
  const fin = inicio === -1 ? -1 : html.indexOf(';</script>', inicio);
  if (fin === -1) throw new NoSeBusco('YouTube cambió su página y la búsqueda no anduvo.');
  let datos;
  try { datos = JSON.parse(html.slice(inicio + 'ytInitialData = '.length, fin)); } catch {
    throw new NoSeBusco('YouTube cambió su página y la búsqueda no anduvo.');
  }
  return leerResultados(datos);
}

// Búsquedas guardadas un rato: una clase entera buscando lo mismo no le pide a YouTube 40 veces.
const guardadas = new Map();
function guardar(clave, videos) {
  if (guardadas.size >= GUARDADAS_MAXIMO) guardadas.delete(guardadas.keys().next().value);
  guardadas.set(clave, { en: Date.now(), videos });
}

const busquedasPorPersona = new Map();
function demasiadas(nombre) {
  const ahora = Date.now();
  const cuenta = busquedasPorPersona.get(nombre);
  if (!cuenta || ahora - cuenta.desde > 60000) { busquedasPorPersona.set(nombre, { desde: ahora, n: 1 }); return false; }
  cuenta.n++;
  return cuenta.n > BUSQUEDAS_POR_MINUTO;
}
setInterval(() => {
  const ahora = Date.now();
  for (const [nombre, cuenta] of busquedasPorPersona) if (ahora - cuenta.desde > 60000) busquedasPorPersona.delete(nombre);
  for (const [clave, guardada] of guardadas) if (ahora - guardada.en > GUARDADA_MS) guardadas.delete(clave);
}, 60000).unref();

function registrarRutasBuscarYoutube(app) {
  // GET /api/youtube/buscar?q=… — con PIN. Devuelve { videos: [{ id, titulo, canal, duracion, segundos }] }.
  app.get('/api/youtube/buscar', requierePersona, async (req, res) => {
    const busqueda = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, LARGO_BUSQUEDA);
    if (!busqueda) return res.status(400).json({ error: 'Escribí qué video querés buscar.' });
    const clave = busqueda.toLowerCase();
    const guardada = guardadas.get(clave);
    if (guardada && Date.now() - guardada.en < GUARDADA_MS) return res.json({ videos: guardada.videos });
    if (demasiadas(req.person)) return res.status(429).json({ error: 'Muchas búsquedas seguidas: esperá un minuto.' });
    try {
      const videos = await buscarEnYoutube(busqueda);
      guardar(clave, videos);
      res.json({ videos });
    } catch (error) {
      res.status(502).json({ error: error instanceof NoSeBusco ? error.message : 'No se pudo buscar en YouTube.' });
    }
  });
}

module.exports = { registrarRutasBuscarYoutube, leerResultados, segundosDe };
