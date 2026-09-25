// Configuración general: carpetas del proyecto, puerto y Cloudinary.
const path = require('path');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env') });

const cloudinary = require('cloudinary').v2;

const PUERTO = process.env.PORT || 3000;

// publico/ es lo único que ve el navegador (páginas, estilos y scripts). Antes se
// publicaba la carpeta entera del proyecto, y con ella people.json (los PIN de todos).
const CARPETA_PUBLICA = path.join(RAIZ, 'publico');
// Imágenes que viajan con el código (opcionales); se sirven en la raíz de la web, como antes.
const CARPETA_DIAPOSITIVAS = path.join(CARPETA_PUBLICA, 'diapositivas');
// Datos que genera la app (orden de imágenes, personas, frases, avance automático).
const CARPETA_DATOS = path.join(RAIZ, 'datos');

const EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp'];
const ADMIN_PIN = process.env.ADMIN_PIN || null;

// ---- Cloudinary (almacenamiento permanente para lo que se sube desde /gestionar.html) ----
// Las imágenes que vienen con el repo se despliegan siempre junto al código (git las
// conserva). Lo que se sube en vivo desde el celular, en cambio, se pierde en cada
// reinicio/redeploy de Render si sólo vive en su disco — por eso eso va a Cloudinary.
const nubeLista = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);

if (nubeLista) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
} else {
  console.warn('⚠️  Cloudinary no configurado — las imágenes subidas desde /gestionar.html sólo quedarán en este disco (se pierden en Render al redeployar). Ver .env.example.');
}

module.exports = {
  RAIZ,
  PUERTO,
  CARPETA_PUBLICA,
  CARPETA_DIAPOSITIVAS,
  CARPETA_DATOS,
  EXTENSIONES_IMAGEN,
  ADMIN_PIN,
  cloudinary,
  nubeLista
};
