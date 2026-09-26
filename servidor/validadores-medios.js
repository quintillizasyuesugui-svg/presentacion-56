// ---- Validación de lo que viaja por socket para la música y los videos ----
// El celular manda órdenes a su propia pantalla («medios») y la pantalla le contesta cómo
// va la reproducción («mediosEstado»). Todo pasa por acá antes de reenviarse, así nadie
// puede mandar cualquier cosa a la pantalla de otro ni textos gigantes.

const ACCIONES_MUSICA = ['reproducir', 'pausar', 'alternar', 'siguiente', 'anterior', 'ir', 'saltar', 'volumen', 'elegir'];
const ACCIONES_VIDEO = ['mandar', 'reproducir', 'pausar', 'alternar', 'ir', 'saltar', 'volumen', 'terminar'];
const LARGO_ID = 200;
const LARGO_NOMBRE = 200;
const SEGUNDOS_MAXIMOS = 24 * 60 * 60;

const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);
const esTexto = (t, largo) => typeof t === 'string' && t.length > 0 && t.length <= largo;

// Devuelve la orden limpia { para, accion, valor? } o null si no es válida.
function limpiarOrdenMedios(datos) {
  if (!datos || typeof datos !== 'object') return null;
  const { para, accion, valor } = datos;
  const permitidas = para === 'musica' ? ACCIONES_MUSICA : para === 'video' ? ACCIONES_VIDEO : null;
  if (!permitidas || !permitidas.includes(accion)) return null;

  if (accion === 'ir') {
    if (!esNumero(valor) || valor < 0 || valor > SEGUNDOS_MAXIMOS) return null;
    return { para, accion, valor };
  }
  if (accion === 'saltar') {
    if (!esNumero(valor) || Math.abs(valor) > 600) return null;
    return { para, accion, valor };
  }
  if (accion === 'volumen') {
    if (!esNumero(valor) || valor < 0 || valor > 100) return null;
    return { para, accion, valor: Math.round(valor) };
  }
  if (accion === 'elegir' || accion === 'mandar') {
    if (!esTexto(valor, LARGO_ID)) return null;
    return { para, accion, valor };
  }
  return { para, accion };
}

function limpiarPista(p) {
  if (p == null) return null;
  if (typeof p !== 'object' || !esTexto(p.id, LARGO_ID)) return undefined;
  return {
    id: p.id,
    nombre: typeof p.nombre === 'string' ? p.nombre.slice(0, LARGO_NOMBRE) : '',
    origen: p.origen === 'youtube' ? 'youtube' : 'subido',
    t: esNumero(p.t) ? Math.max(0, Math.min(p.t, SEGUNDOS_MAXIMOS)) : 0,
    duracion: esNumero(p.duracion) ? Math.max(0, Math.min(p.duracion, SEGUNDOS_MAXIMOS)) : 0,
    sonando: Boolean(p.sonando),
    volumen: esNumero(p.volumen) ? Math.max(0, Math.min(100, Math.round(p.volumen))) : 70,
    posicion: Number.isInteger(p.posicion) ? p.posicion : 0,
    total: Number.isInteger(p.total) ? p.total : 0
  };
}

// Estado que manda la pantalla: { pantalla, permitido, musica, video, aviso? } o null.
function limpiarEstadoMedios(datos) {
  if (!datos || typeof datos !== 'object' || !esTexto(datos.pantalla, 64)) return null;
  const musica = limpiarPista(datos.musica);
  const video = limpiarPista(datos.video);
  if (musica === undefined || video === undefined) return null;
  const estado = { pantalla: datos.pantalla, permitido: Boolean(datos.permitido), musica, video };
  if (typeof datos.aviso === 'string' && datos.aviso) estado.aviso = datos.aviso.slice(0, 300);
  return estado;
}

module.exports = { limpiarOrdenMedios, limpiarEstadoMedios, ACCIONES_MUSICA, ACCIONES_VIDEO };
