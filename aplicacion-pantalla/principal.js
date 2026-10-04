// Abre la pantalla de Conexiones (la misma de Render) en una ventana propia de Windows.
// Los celulares siguen manejándola con el control, como en el navegador.
const { app, BrowserWindow, shell, session } = require('electron');
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
    webPreferences: { contextIsolation: true, sandbox: true }
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
  ventana.webContents.on('before-input-event', (evento, tecla) => {
    if (tecla.type !== 'keyDown') return;
    if (tecla.key === 'F11') { ventana.setFullScreen(!ventana.isFullScreen()); evento.preventDefault(); }
    if (tecla.key === 'F5') { cargarPantalla(); evento.preventDefault(); }
  });

  cargarPantalla();
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
  crearVentana();
});
app.on('window-all-closed', () => app.quit());
