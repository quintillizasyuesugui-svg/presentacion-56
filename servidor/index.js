// Arranque del servidor: sirve las páginas de publico/ y conecta cada parte de la API.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PUERTO, CARPETA_PUBLICA, CARPETA_DIAPOSITIVAS } = require('./configuracion');
const { registrarRutasPersonas } = require('./personas');
const { registrarRutasFraseFinal } = require('./frase-final');
const { registrarRutasAvanceAutomatico } = require('./avance-automatico');
const { registrarRutasDiapositivas } = require('./diapositivas');
const { registrarRutasDocumentos, retomarTrabajos, vaciarTrabajos } = require('./documentos');
const { iniciarAlmacenes, vaciarRespaldos } = require('./almacen');
const { registrarRutasAdministracion } = require('./administracion');
const { registrarSockets } = require('./sockets');

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

app.use(express.static(CARPETA_PUBLICA));
app.use(express.static(CARPETA_DIAPOSITIVAS));
// Límite alto porque /api/images/combine manda el collage ya armado como data URI en el body
app.use(express.json({ limit: '20mb' }));

app.get('/', (req, res) => {
  res.redirect('/pantalla.html');
});

// La página de gestionar imágenes se llamaba manage.html: los enlaces viejos siguen funcionando.
app.get('/manage.html', (req, res) => {
  res.redirect(301, '/gestionar.html');
});

registrarRutasPersonas(app);
registrarRutasFraseFinal(app, io);
registrarRutasAvanceAutomatico(app);
registrarRutasDiapositivas(app, io);
registrarRutasDocumentos(app, io);
registrarRutasAdministracion(app);
registrarSockets(io);

// Primero se cargan los datos (base de datos o archivos) y se retoman los documentos que
// quedaron a mitad; recién ahí se atienden pedidos. Si no se pueden cargar, el servidor no
// arranca (Render lo reintenta) en vez de arrancar vacío y pisar los datos buenos.
async function arrancar() {
  await iniciarAlmacenes();
  await retomarTrabajos();
  servidor.listen(PUERTO, '0.0.0.0', () => console.log(`🚀 Cinema en http://0.0.0.0:${PUERTO}`));
}

// Render avisa con SIGTERM antes de apagar (redeploy o reinicio): se sube el respaldo pendiente
// y se termina de guardar el estado de los documentos.
let apagando = false;
async function apagar() {
  if (apagando) return;
  apagando = true;
  try {
    await Promise.all([vaciarRespaldos(), vaciarTrabajos()]);
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);

arrancar().catch((err) => {
  console.error('❌ No se pudo arrancar:', err.message);
  process.exit(1);
});
