// ---- Páginas web como diapositivas: revisa lo que llega del celular ----
// El servidor nunca abre la página: sólo guarda su dirección. La pantalla y el celular la
// muestran en un recuadro, y lo que se toca en el celular viaja por acá hasta la pantalla.

const LARGO_MAXIMO = 500;

// Devuelve la dirección ya ordenada (http o https) o null si no sirve. «midominio.com/pagina»
// sin «https://» adelante también vale: se completa.
function limpiarDireccion(texto) {
  if (typeof texto !== 'string') return null;
  let pedido = texto.trim();
  if (!pedido || pedido.length > LARGO_MAXIMO || /\s/.test(pedido)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(pedido)) pedido = 'https://' + pedido;
  let url;
  try { url = new URL(pedido); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href.length <= LARGO_MAXIMO ? url.href : null;
}

// Nombre corto para la fila de Gestionar: «nasa-cell.github.io/eco-cafe».
function tituloDe(direccion) {
  const url = new URL(direccion);
  const camino = url.pathname.replace(/\/+$/, '');
  return (url.hostname.replace(/^www\./, '') + camino).slice(0, 60);
}

// Órdenes del espejo del celular: tocar algo, ir a otra página del mismo sitio o bajar.
function limpiarOrdenWeb(datos) {
  if (!datos || typeof datos !== 'object') return null;
  if (datos.accion === 'clic') {
    const ruta = datos.ruta;
    if (typeof ruta !== 'string' || !ruta || ruta.length > 400 || /[\u0000-\u001f<]/.test(ruta)) return null;
    return { accion: 'clic', ruta, navega: datos.navega === true };
  }
  if (datos.accion === 'ir') {
    const url = limpiarDireccion(datos.url);
    return url ? { accion: 'ir', url } : null;
  }
  if (datos.accion === 'desplazar') {
    if (!Number.isFinite(datos.y)) return null;
    return { accion: 'desplazar', y: Math.min(1, Math.max(0, datos.y)) };
  }
  return null;
}

module.exports = { limpiarDireccion, tituloDe, limpiarOrdenWeb, LARGO_MAXIMO };
