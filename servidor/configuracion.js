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
// CARPETA_DATOS en el entorno la cambia (lo usan las pruebas, para no tocar los datos reales).
const CARPETA_DATOS = process.env.CARPETA_DATOS || path.join(RAIZ, 'datos');

const EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp'];
const ADMIN_PIN = process.env.ADMIN_PIN || null;

// Música y videos subidos: sin Cloudinary (sólo para probar en la PC) quedan en esta carpeta.
const CARPETA_MULTIMEDIA = path.join(CARPETA_PUBLICA, 'multimedia');
// Espacio para música y videos: se reparte solo entre las personas registradas.
// PRESUPUESTO_MB es lo que se guarda en total (12 GB de los 25 GB gratis de Cloudinary; el
// resto queda para reproducir). Cada persona recibe presupuesto ÷ personas, sin bajar de
// ESPACIO_MIN_MB ni pasar de ESPACIO_MAX_MB: con pocas personas, más para cada una; con
// muchas, menos. El admin puede fijarle a alguien un espacio propio.
const PRESUPUESTO_MB = Number(process.env.PRESUPUESTO_MB) || 12000;
const ESPACIO_MIN_MB = Number(process.env.ESPACIO_MIN_MB) || 100;
const ESPACIO_MAX_MB = Number(process.env.ESPACIO_MAX_MB) || 2000;

// Almacén grande: videos de más de 100 MB (hasta 500 MB) en un dataset privado de Hugging Face.
// HF_TOKEN es una clave de escritura (sólo en las variables de Render, nunca en el código).
// Se reparte igual que el espacio de Cloudinary: GRANDE_PRESUPUESTO_MB entre las personas, sin
// bajar de GRANDE_MIN_MB ni pasar de GRANDE_MAX_MB (100 GB en total, hasta 5 GB por persona).
const HF_TOKEN = process.env.HF_TOKEN || null;
const HF_DATASET = process.env.HF_DATASET || 'dwaddawdw/conexiones-videos';
const GRANDE_PRESUPUESTO_MB = Number(process.env.GRANDE_PRESUPUESTO_MB) || 100000;
const GRANDE_MIN_MB = Number(process.env.GRANDE_MIN_MB) || 1000;
const GRANDE_MAX_MB = Number(process.env.GRANDE_MAX_MB) || 5000;

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
  CARPETA_MULTIMEDIA,
  PRESUPUESTO_MB,
  ESPACIO_MIN_MB,
  ESPACIO_MAX_MB,
  HF_TOKEN,
  HF_DATASET,
  GRANDE_PRESUPUESTO_MB,
  GRANDE_MIN_MB,
  GRANDE_MAX_MB,
  cloudinary,
  nubeLista
};
