// Arranque del servidor: sirve las páginas de publico/ y conecta cada parte de la API.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PUERTO, CARPETA_PUBLICA, CARPETA_DIAPOSITIVAS } = require('./configuracion');
const { registrarRutasPersonas } = require('./personas');
const { registrarRutasFraseFinal } = require('./frase-final');
const { registrarRutasAvanceAutomatico } = require('./avance-automatico');
const { registrarRutasDiapositivas } = require('./diapositivas');
const { registrarRutasDocumentos } = require('./documentos');
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
registrarSockets(io);

servidor.listen(PUERTO, '0.0.0.0', () => console.log(`🚀 Cinema en http://0.0.0.0:${PUERTO}`));
