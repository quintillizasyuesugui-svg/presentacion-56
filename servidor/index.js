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
const { registrarRutasCodigoQr } = require('./codigo-qr');
const { registrarRutasMultimedia } = require('./multimedia');
const { registrarSockets } = require('./sockets');
const { porteroDePedidos, porteroDeConexiones } = require('./portero-pedidos');

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

app.disable('x-powered-by');
// El navegador no adivina el tipo de un archivo (un texto subido no se ejecuta como script) y
// a otros sitios sólo les cuenta de qué web viene, no la página exacta. Además ningún otro sitio
// puede meter estas páginas dentro de un marco (para engañar con botones tapados), ni usar
// complementos viejos. No se limita de dónde vienen scripts, fotos o videos: eso rompería
// YouTube y Cloudinary y hay que probarlo con las apps reales antes de activarlo.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  next();
});

app.use(porteroDePedidos);
app.use(express.static(CARPETA_PUBLICA));
app.use(express.static(CARPETA_DIAPOSITIVAS));
// Sólo /api/images/combine necesita un cuerpo grande (manda el collage ya armado como data
// URI). El resto acepta hasta 1 MB: antes cualquiera, sin PIN, podía mandar 20 MB a cualquier
// ruta y dejar sin memoria al servidor.
const jsonGrande = express.json({ limit: '20mb' });
const jsonChico = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/images/combine' ? jsonGrande : jsonChico)(req, res, next));

app.get('/', (req, res) => {
  res.redirect('/pantalla.html');
});

// La página de gestionar imágenes se llamaba manage.html: los enlaces viejos siguen funcionando.
app.get('/manage.html', (req, res) => {
  res.redirect(301, '/gestionar.html');
});

registrarRutasPersonas(app);
registrarRutasFraseFinal(app, io);
registrarRutasAvanceAutomatico(app, io);
registrarRutasDiapositivas(app, io);
registrarRutasDocumentos(app, io);
registrarRutasAdministracion(app);
registrarRutasCodigoQr(app);
registrarRutasMultimedia(app, io);
porteroDeConexiones(io);
registrarSockets(io);

// Una dirección de la API que no existe contesta claro, en vez de la página de error de Express.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Esa dirección no existe.' });
});

// Errores que no atrapó ninguna ruta (pedido demasiado grande, cuerpo mal armado o una falla
// nuestra): siempre un mensaje que la persona entienda, nunca el texto técnico en inglés.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Eso pesa demasiado para enviarlo.' });
  if (err.type === 'entity.parse.failed' || err.status === 400) return res.status(400).json({ error: 'No se entendió el pedido. Probá de nuevo.' });
  console.error(err);
  res.status(500).json({ error: 'Algo salió mal en el servidor. Probá de nuevo en un momento.' });
});

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
