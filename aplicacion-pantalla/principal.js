// Abre la pantalla de Conexiones (la misma de Render) en una ventana propia de Windows.
// Los celulares siguen manejándola con el control, como en el navegador.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const DIRECCION = process.env.CONEXIONES_DIRECCION || 'https://presentacion-56.onrender.com';
const PANTALLA = DIRECCION.replace(/\/$/, '') + '/pantalla.html';

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

app.whenReady().then(crearVentana);
app.on('window-all-closed', () => app.quit());
