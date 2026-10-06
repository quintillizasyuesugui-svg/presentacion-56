// Abre la pantalla de Conexiones (la misma de Render) en una ventana propia de Windows.
// Los celulares siguen manejándola con el control, como en el navegador.
const { app, BrowserWindow, WebContentsView, ipcMain, shell, session } = require('electron');
const path = require('path');

const DIRECCION = process.env.CONEXIONES_DIRECCION || 'https://presentacion-56.onrender.com';
const PANTALLA = DIRECCION.replace(/\/$/, '') + '/pantalla.html';
const ORIGEN = new URL(DIRECCION).origin;

// La ventana sólo muestra páginas de Conexiones (y la propia de «sin conexión»).
function esDeConexiones(url) {
  try {
    const u = new URL(url);
    return u.origin === ORIGEN || u.protocol === 'file:';
  } catch {
    return false;
  }
}

// Que la música y los videos suenen sin tener que tocar «Permitir sonido».
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let ventana = null;

function cargarPantalla() {
  ventana.loadURL(PANTALLA);
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    title: 'Conexiones Pantalla',
    icon: path.join(__dirname, 'icono.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'precarga.js') }
  });
  ventana.on('resize', acomodarPagina);
  ventana.on('enter-full-screen', acomodarPagina);
  ventana.on('leave-full-screen', acomodarPagina);
  ventana.on('closed', () => { ventana = null; pagina = null; });
  // Si la pantalla se recarga o cierra sesión, la página web abierta no queda tapándola.
  ventana.webContents.on('did-start-navigation', (detalles) => {
    if (detalles.isMainFrame && !detalles.isSameDocument) cerrarPagina();
  });
  ventana.setMenu(null);
  ventana.once('ready-to-show', () => { ventana.maximize(); ventana.show(); });

  // Sin internet (o Render no responde): página propia con botón para reintentar.
  ventana.webContents.on('did-fail-load', (_e, codigo, _desc, url, principal) => {
    if (!principal || codigo === -3) return; // -3: carga cancelada, no es un error
    ventana.loadFile(path.join(__dirname, 'sin-conexion.html'), { query: { destino: url || PANTALLA } });
  });

  // Enlaces externos (YouTube, etc.) en el navegador, no dentro de la pantalla.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Lo mismo si la página intenta irse a otro sitio dentro de la misma ventana.
  ventana.webContents.on('will-navigate', (evento, url) => {
    if (esDeConexiones(url)) return;
    evento.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  // F11: pantalla completa. F5: recargar.
  ventana.webContents.on('before-input-event', teclasDeLaVentana);

  cargarPantalla();
}

function teclasDeLaVentana(evento, tecla) {
  if (tecla.type !== 'keyDown') return;
  if (tecla.key === 'F11') { ventana.setFullScreen(!ventana.isFullScreen()); evento.preventDefault(); }
  if (tecla.key === 'F5') { cargarPantalla(); evento.preventDefault(); }
}

// ---- Página web como diapositiva ----
// Una página que no está preparada para Conexiones (o que no se deja mostrar adentro de otra,
// como Google o YouTube) se abre acá, en un recuadro propio que tapa la ventana, igual que en un
// navegador. Lo que se toca en el celular se repite acá como toques de mouse y teclas, y se le
// saca una foto chica cada tanto para que el celular vea lo mismo.
// El recuadro no tiene acceso a nada de la PC: sin permisos (cámara, micrófono, avisos), sin
// descargas, sin ventanas nuevas y con su propia sesión, que se borra al cerrar la app.
const SESION_PAGINA = 'pagina-web';
const ANCHO_FOTO = 640;
const CAJAS_DEL_MENU = 12;
let pagina = null;
// Menú de la página abierta, para las cajas del celular. null: todavía no se leyó.
let menuPagina = null;
let relojMenu = null;

function esPaginaWeb(direccion) {
  return typeof direccion === 'string' && direccion.length <= 2000 && /^https?:\/\//i.test(direccion);
}

function acomodarPagina() {
  if (!pagina || !ventana) return;
  const [ancho, alto] = ventana.getContentSize();
  pagina.setBounds({ x: 0, y: 0, width: ancho, height: alto });
}

// Busca el menú de la página: los enlaces de <nav>, o si no los del encabezado o los de algo
// que se llame «menu» o «nav». Sólo enlaces del mismo sitio y sin repetir. Esta función corre
// adentro de la página, no acá.
function buscarMenu(tope) {
  const lugares = ['nav a[href]', '[role="navigation"] a[href]', 'header a[href]',
    '[class*="menu" i] a[href], [id*="menu" i] a[href], [class*="nav" i] a[href], [id*="nav" i] a[href]'];
  for (const lugar of lugares) {
    const cajas = [];
    const vistas = new Set();
    for (const enlace of document.querySelectorAll(lugar)) {
      if (enlace.origin !== location.origin || !/^https?:$/.test(enlace.protocol) || vistas.has(enlace.href)) continue;
      const dibujo = enlace.querySelector('img');
      const texto = ((enlace.textContent || '').replace(/\s+/g, ' ').trim() || enlace.getAttribute('aria-label') ||
        enlace.title || (dibujo && dibujo.alt) || '').trim();
      if (!texto) continue;
      vistas.add(enlace.href);
      cajas.push({
        texto: texto.slice(0, 30),
        url: enlace.href,
        icono: dibujo ? (dibujo.currentSrc || dibujo.src || '') : '',
        actual: enlace.hasAttribute('aria-current') || enlace.href === location.href
      });
      if (cajas.length === tope) break;
    }
    if (cajas.length >= 2) return cajas;
  }
  return [];
}

// Lo que contesta la página no es de confianza: se revisa antes de guardarlo.
async function leerMenu() {
  if (!pagina) return;
  const contenido = pagina.webContents;
  let cajas = [];
  try {
    cajas = await contenido.executeJavaScript(`(${buscarMenu.toString()})(${CAJAS_DEL_MENU})`);
  } catch { /* la página se cerró o no dejó */ }
  if (!pagina || pagina.webContents !== contenido) return;
  menuPagina = (Array.isArray(cajas) ? cajas : []).slice(0, CAJAS_DEL_MENU)
    .filter(caja => caja && typeof caja.texto === 'string' && caja.texto.trim() && esPaginaWeb(caja.url) && caja.url.length <= 500)
    .map(caja => ({
      texto: caja.texto.trim().slice(0, 30),
      url: caja.url,
      icono: esPaginaWeb(caja.icono) && caja.icono.length <= 500 ? caja.icono : '',
      actual: caja.actual === true
    }));
}

// Al terminar de cargar, y otra vez un rato después por si la página arma su menú más tarde.
function leerMenuPronto() {
  clearTimeout(relojMenu);
  leerMenu();
  relojMenu = setTimeout(leerMenu, 1500);
}

function cerrarPagina() {
  if (!pagina) return;
  const vieja = pagina;
  pagina = null;
  menuPagina = null;
  clearTimeout(relojMenu);
  if (ventana) ventana.contentView.removeChildView(vieja);
  vieja.webContents.close();
}

function abrirPagina(direccion) {
  if (!ventana || !esPaginaWeb(direccion)) return false;
  if (!pagina) {
    pagina = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: SESION_PAGINA }
    });
    const contenido = pagina.webContents;
    // Un enlace que abriría otra ventana se abre acá mismo.
    contenido.setWindowOpenHandler(({ url }) => {
      if (esPaginaWeb(url)) contenido.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    contenido.on('will-navigate', (evento, url) => { if (!esPaginaWeb(url)) evento.preventDefault(); });
    contenido.on('before-input-event', teclasDeLaVentana);
    contenido.on('did-start-navigation', (detalles) => {
      if (detalles.isMainFrame && !detalles.isSameDocument) { menuPagina = null; clearTimeout(relojMenu); }
    });
    contenido.on('did-finish-load', leerMenuPronto);
    contenido.on('did-navigate-in-page', (_evento, _url, principal) => { if (principal) leerMenu(); });
    ventana.contentView.addChildView(pagina);
    acomodarPagina();
  }
  pagina.setVisible(true);
  pagina.webContents.loadURL(direccion).catch(() => {});
  return true;
}

// Anillo celeste donde se tocó, para que el público lo vea. Si la página no lo permite, no pasa nada.
function marcarToque(x, y) {
  const lado = 44;
  pagina.webContents.executeJavaScript(`(() => {
    const a = document.createElement('div');
    a.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border-radius:50%;box-sizing:border-box;border:5px solid #34cdfa;width:${lado}px;height:${lado}px;left:${x - lado / 2}px;top:${y - lado / 2}px';
    document.documentElement.appendChild(a);
    a.animate([{ transform: 'scale(0.6)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }).onfinish = () => a.remove();
  })()`).catch(() => {});
}

function ordenParaLaPagina(orden) {
  if (!pagina || !orden || typeof orden !== 'object') return false;
  const contenido = pagina.webContents;
  const { width: ancho, height: alto } = pagina.getBounds();
  if (orden.accion === 'toque' && Number.isFinite(orden.x) && Number.isFinite(orden.y)) {
    const x = Math.round(Math.min(1, Math.max(0, orden.x)) * ancho);
    const y = Math.round(Math.min(1, Math.max(0, orden.y)) * alto);
    marcarToque(x, y);
    contenido.sendInputEvent({ type: 'mouseMove', x, y });
    contenido.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    contenido.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  } else if (orden.accion === 'rueda' && Number.isFinite(orden.dy)) {
    // dy en «pantallas»: 1 baja una pantalla entera.
    const pasos = Math.min(3, Math.max(-3, orden.dy)) * alto;
    contenido.sendInputEvent({ type: 'mouseWheel', x: Math.round(ancho / 2), y: Math.round(alto / 2), deltaX: 0, deltaY: -Math.round(pasos) });
  } else if (orden.accion === 'ir') {
    // Una caja del menú tocada en el celular: sólo se va a direcciones que están en el menú leído.
    if (!menuPagina || !menuPagina.some(caja => caja.url === orden.url)) return false;
    contenido.loadURL(orden.url).catch(() => {});
  } else if (orden.accion === 'volver') {
    if (contenido.navigationHistory.canGoBack()) contenido.navigationHistory.goBack();
  } else if (orden.accion === 'texto' && typeof orden.texto === 'string' && orden.texto.length <= 200) {
    contenido.focus();
    contenido.insertText(orden.texto);
  } else if (orden.accion === 'tecla' && ['Enter', 'Backspace', 'Tab', 'Escape'].includes(orden.tecla)) {
    contenido.focus();
    contenido.sendInputEvent({ type: 'keyDown', keyCode: orden.tecla });
    if (orden.tecla === 'Enter') contenido.sendInputEvent({ type: 'char', keyCode: '\r' });
    contenido.sendInputEvent({ type: 'keyUp', keyCode: orden.tecla });
  } else {
    return false;
  }
  return true;
}

async function fotoDeLaPagina() {
  if (!pagina) return null;
  const contenido = pagina.webContents;
  const entera = await contenido.capturePage();
  if (!pagina || entera.isEmpty()) return null;
  const chica = entera.getSize().width > ANCHO_FOTO ? entera.resize({ width: ANCHO_FOTO, quality: 'good' }) : entera;
  return { jpg: chica.toJPEG(55).toString('base64'), url: contenido.getURL(), titulo: contenido.getTitle(), menu: menuPagina };
}

// Sólo la pantalla de Conexiones (el marco principal de la ventana) puede dar estas órdenes.
function pedidoDeConexiones(evento) {
  if (!ventana || evento.sender !== ventana.webContents) return false;
  const marco = evento.senderFrame;
  if (!marco || marco !== ventana.webContents.mainFrame) return false;
  try { return new URL(marco.url).origin === ORIGEN; } catch { return false; }
}

function registrarPedidosDePagina() {
  const atender = (canal, hacer) => ipcMain.handle(canal, (evento, dato) => (pedidoDeConexiones(evento) ? hacer(dato) : null));
  atender('pagina:abrir', abrirPagina);
  atender('pagina:cerrar', () => { cerrarPagina(); return true; });
  atender('pagina:visible', (siNo) => { if (pagina) pagina.setVisible(siNo !== false); return true; });
  atender('pagina:orden', ordenParaLaPagina);
  atender('pagina:foto', () => fotoDeLaPagina().catch(() => null));
}

app.on('second-instance', () => {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.focus();
});

app.whenReady().then(() => {
  // Electron concede solo cualquier permiso que pida una página (cámara, micrófono, ubicación,
  // avisos). La pantalla sólo necesita ponerse en pantalla completa: lo demás se niega, también
  // a los videos de YouTube que se muestran dentro.
  session.defaultSession.setPermissionRequestHandler((_contenido, permiso, responder) => {
    responder(permiso === 'fullscreen');
  });
  // Las páginas web que se abren como diapositiva: sin permisos y sin descargas.
  const sesionPagina = session.fromPartition(SESION_PAGINA);
  sesionPagina.setPermissionRequestHandler((_contenido, _permiso, responder) => responder(false));
  sesionPagina.on('will-download', (evento) => evento.preventDefault());
  registrarPedidosDePagina();
  crearVentana();
});
app.on('window-all-closed', () => app.quit());
