require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const fs = require("fs").promises;
const path = require("path");

const PORT = process.env.PORT || 3000;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const ORDER_FILE = path.join(__dirname, 'images-order.json');
const CLOUD_ORDER_PUBLIC_ID = 'presentacion/images-order';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => {
  res.redirect('/pantalla.html');
});

// ---- Cloudinary (almacenamiento permanente para lo que se sube desde /manage.html) ----
// Las imágenes 1.png..7.png que vienen con el repo se despliegan siempre junto al código
// (git las conserva). Lo que se sube en vivo desde el celular, en cambio, se pierde en cada
// reinicio/redeploy de Render si sólo vive en su disco — por eso eso va a Cloudinary.

const cloudinaryReady = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryReady) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
} else {
  console.warn('⚠️  Cloudinary no configurado — las imágenes subidas desde /manage.html sólo quedarán en este disco (se pierden en Render al redeployar). Ver .env.example.');
}

// ---- Orden de diapositivas ----
// Cada entrada es { id, src } — "id" es lo que se usa para borrar/reordenar, "src" es lo que
// va directo al <img>. Para archivos locales (el set original del repo) id === src === nombre
// de archivo. Para lo subido a Cloudinary, id es el public_id y src la URL segura.

async function readLocalOrder() {
  try {
    return JSON.parse(await fs.readFile(ORDER_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function readCloudOrderBackup() {
  if (!cloudinaryReady) return null;
  try {
    const url = cloudinary.url(CLOUD_ORDER_PUBLIC_ID, { resource_type: 'raw', secure: true }) + `?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('No se pudo leer el respaldo de orden en Cloudinary:', err.message);
    return null;
  }
}

async function bootstrapFromDirectory() {
  const files = await fs.readdir(__dirname);
  return files
    .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(filename => ({ id: filename, src: filename }));
}

async function readOrder() {
  let order = await readLocalOrder();

  if (!order) {
    order = await readCloudOrderBackup();
  }

  if (!order) {
    order = await bootstrapFromDirectory();
  }

  // Descartar entradas locales cuyo archivo ya no exista (las de Cloudinary no se verifican
  // acá — su existencia depende de Cloudinary, no de este disco).
  const existing = [];
  for (const record of order) {
    if (record.id.startsWith('presentacion/')) {
      existing.push(record); // viene de Cloudinary, se asume válido
      continue;
    }
    try {
      await fs.access(path.join(__dirname, record.id));
      existing.push(record);
    } catch { /* borrado del disco por fuera de la app */ }
  }

  await writeOrder(existing);
  return existing;
}

async function writeOrder(order) {
  await fs.writeFile(ORDER_FILE, JSON.stringify(order, null, 2));
  await backupOrderToCloud(order);
}

async function backupOrderToCloud(order) {
  if (!cloudinaryReady) return;
  try {
    const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(order)).toString('base64');
    await cloudinary.uploader.upload(dataUri, {
      public_id: CLOUD_ORDER_PUBLIC_ID,
      resource_type: 'raw',
      overwrite: true,
      invalidate: true
    });
  } catch (err) {
    console.error('No se pudo respaldar el orden en Cloudinary:', err.message);
  }
}

function notifyImagesChanged() {
  io.emit('imagenesActualizadas');
}

// GET /images — array simple de src, para pantalla.html y control.html
app.get("/images", async (req, res) => {
  try {
    res.json((await readOrder()).map(r => r.src));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error en servidor");
  }
});

// GET /api/images — registros completos {id, src}, para manage.html
app.get("/api/images", async (req, res) => {
  try {
    res.json(await readOrder());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// ---- Subir imágenes ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/'))
});

app.post('/api/images/upload', upload.array('images', 20), async (req, res) => {
  if (!cloudinaryReady) {
    return res.status(500).json({
      error: 'Cloudinary no está configurado en el servidor (faltan variables de entorno). Revisá .env.example.'
    });
  }
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen válida.' });
    }

    const uploadedRecords = await Promise.all(files.map(async (file) => {
      const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      const result = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
      return { id: result.public_id, src: result.secure_url };
    }));

    const order = await readOrder();
    order.push(...uploadedRecords);
    await writeOrder(order);
    notifyImagesChanged();
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir la imagen.' });
  }
});

// ---- Borrar imagen ----
// Wildcard porque el id de Cloudinary trae barras (ej. "presentacion/slides/abc123")
app.delete('/api/images/*id', async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id.join('/') : req.params.id;
    const order = await readOrder();
    const record = order.find(r => r.id === id);
    if (!record) {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }

    if (record.id.startsWith('presentacion/')) {
      if (cloudinaryReady) await cloudinary.uploader.destroy(record.id).catch(() => {});
    } else {
      // El id ya está validado contra el manifiesto de orden, así que no puede
      // salirse de __dirname (no viene de un parámetro libre sin chequear).
      await fs.unlink(path.join(__dirname, record.id)).catch(() => {});
    }

    const next = order.filter(r => r.id !== id);
    await writeOrder(next);
    notifyImagesChanged();
    res.json(next);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar la imagen.' });
  }
});

// ---- Reordenar imágenes ----
app.post('/api/images/reorder', async (req, res) => {
  try {
    const { order: newIds } = req.body;
    const current = await readOrder();
    const byId = new Map(current.map(r => [r.id, r]));

    const valid = Array.isArray(newIds) &&
      newIds.length === current.length &&
      newIds.every(id => byId.has(id)) &&
      new Set(newIds).size === current.length;

    if (!valid) {
      return res.status(400).json({ error: 'Orden inválido.' });
    }

    const reordered = newIds.map(id => byId.get(id));
    await writeOrder(reordered);
    notifyImagesChanged();
    res.json(reordered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reordenar.' });
  }
});

io.on("connection", (socket) => {
  console.log("✨ Dispositivo vinculado");
  socket.on("cambiar", (accion) => io.emit("cambiar", accion));
  socket.on("cine", () => io.emit("cine"));
});

server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Cinema en http://0.0.0.0:${PORT}`));
