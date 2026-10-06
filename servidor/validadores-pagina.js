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
  // «Foto en vivo» (la página la abre la app de PC): tocar un punto de la foto, girar la rueda,
  // volver a la página anterior, escribir un texto o apretar una tecla.
  if (datos.accion === 'toque') {
    if (!Number.isFinite(datos.x) || !Number.isFinite(datos.y)) return null;
    return { accion: 'toque', x: Math.min(1, Math.max(0, datos.x)), y: Math.min(1, Math.max(0, datos.y)) };
  }
  if (datos.accion === 'rueda') {
    if (!Number.isFinite(datos.dy)) return null;
    return { accion: 'rueda', dy: Math.min(3, Math.max(-3, datos.dy)) }; // en «pantallas»: 1 = una pantalla hacia abajo
  }
  if (datos.accion === 'volver') return { accion: 'volver' };
  if (datos.accion === 'texto') {
    if (typeof datos.texto !== 'string' || !datos.texto || datos.texto.length > 200 || /[\u0000-\u001f]/.test(datos.texto)) return null;
    return { accion: 'texto', texto: datos.texto };
  }
  if (datos.accion === 'tecla') {
    return TECLAS.includes(datos.tecla) ? { accion: 'tecla', tecla: datos.tecla } : null;
  }
  return null;
}

const TECLAS = ['Enter', 'Backspace', 'Tab', 'Escape'];
const FOTO_MAXIMA = 400000; // letras de la foto en base64: unos 300 KB

// Foto de la página que manda la app de PC para el celular: un JPEG chico, la dirección y el título.
function limpiarFotoWeb(datos) {
  if (!datos || typeof datos !== 'object') return null;
  const jpg = datos.jpg;
  if (typeof jpg !== 'string' || jpg.length < 100 || jpg.length > FOTO_MAXIMA || !jpg.startsWith('/9j/') || !/^[A-Za-z0-9+/]+=*$/.test(jpg)) return null;
  return {
    jpg,
    url: limpiarDireccion(datos.url) || '',
    titulo: typeof datos.titulo === 'string' ? datos.titulo.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : ''
  };
}

const CAJAS_DEL_MENU = 12;

// Menú de la página que abrió la app de PC, para mostrarlo como cajas en el celular.
// null: todavía no se sabe (o la app no lo lee). Lista vacía: se buscó y la página no tiene.
function limpiarMenuWeb(datos) {
  if (!Array.isArray(datos)) return null;
  const menu = [];
  for (const caja of datos.slice(0, CAJAS_DEL_MENU)) {
    if (!caja || typeof caja !== 'object' || typeof caja.texto !== 'string') continue;
    // Sólo direcciones completas: «logo.png» a secas no se completa con https://.
    const completa = (direccion) => (typeof direccion === 'string' && /^https?:\/\//i.test(direccion) ? limpiarDireccion(direccion) : null);
    const url = completa(caja.url);
    const texto = caja.texto.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 30);
    if (!url || !texto) continue;
    menu.push({ texto, url, icono: completa(caja.icono) || '', actual: caja.actual === true });
  }
  return menu;
}

module.exports = { limpiarDireccion, tituloDe, limpiarOrdenWeb, limpiarFotoWeb, limpiarMenuWeb, LARGO_MAXIMO };
