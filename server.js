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
// Límite alto porque /api/images/combine manda el collage ya armado como data URI en el body
app.use(express.json({ limit: '20mb' }));

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

// GET /images — { src, transform } por diapositiva, para pantalla.html y control.html
// (transform es el ajuste de tamaño/posición del Modo avanzado; null si nunca se tocó)
app.get("/images", async (req, res) => {
  try {
    res.json((await readOrder()).map(r => ({ src: r.src, transform: r.transform || null })));
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

// ---- Tamaño y posición (Modo avanzado) ----
// Ajuste no destructivo: sólo guarda { scale, x, y } junto a la imagen en el
// orden — pantalla.html lo aplica con CSS al mostrarla, la imagen original no cambia.
app.post('/api/images/*id/transform', async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id.join('/') : req.params.id;
    const { scale, x, y } = req.body;

    const valid = Number.isFinite(scale) && scale >= 0.3 && scale <= 4 &&
      Number.isFinite(x) && x >= -100 && x <= 100 &&
      Number.isFinite(y) && y >= -100 && y <= 100;
    if (!valid) {
      return res.status(400).json({ error: 'Ajuste inválido.' });
    }

    const order = await readOrder();
    const record = order.find(r => r.id === id);
    if (!record) {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }

    record.transform = { scale, x, y };
    await writeOrder(order);
    notifyImagesChanged();
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el ajuste.' });
  }
});

// ---- Unir imágenes (Modo avanzado) ----
// El collage ya viene armado desde el celular (canvas) en dataUri — acá sólo se
// sube como una imagen más y se reemplazan las 2-4 originales por esa única
// diapositiva. "originals" guarda esas imágenes completas (con su propio ajuste
// de tamaño/posición si tenían) para poder deshacer la unión con /uncombine.
app.post('/api/images/combine', async (req, res) => {
  if (!cloudinaryReady) {
    return res.status(500).json({
      error: 'Cloudinary no está configurado en el servidor (faltan variables de entorno). Revisá .env.example.'
    });
  }
  try {
    const { ids, dataUri } = req.body;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Elegí entre 2 y 4 imágenes distintas para unir.' });
    }
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) {
      return res.status(400).json({ error: 'No se recibió la imagen combinada.' });
    }

    const order = await readOrder();
    const removedIndexes = ids.map(id => order.findIndex(r => r.id === id));
    if (removedIndexes.some(i => i === -1)) {
      return res.status(400).json({ error: 'Alguna de las imágenes ya no existe.' });
    }
    if (removedIndexes.some(i => order[i].originals)) {
      return res.status(400).json({ error: 'Una diapositiva combinada no se puede volver a unir.' });
    }

    const removedSet = new Set(removedIndexes);
    // El orden de "originals" sigue el orden actual del deck, no el orden en que
    // se tildaron en el celular — así el collage queda de izquierda a derecha
    // como están hoy las diapositivas.
    const originals = order.filter((r, i) => removedSet.has(i));

    const result = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
    const merged = { id: result.public_id, src: result.secure_url, originals };

    const next = [];
    let inserted = false;
    order.forEach((record, i) => {
      if (removedSet.has(i)) {
        if (!inserted) { next.push(merged); inserted = true; }
        return;
      }
      next.push(record);
    });

    await writeOrder(next);
    notifyImagesChanged();
    res.json(next);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al unir las imágenes.' });
  }
});

// ---- Deshacer una unión ----
app.post('/api/images/*id/uncombine', async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id.join('/') : req.params.id;
    const order = await readOrder();
    const idx = order.findIndex(r => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }
    const record = order[idx];
    if (!record.originals) {
      return res.status(400).json({ error: 'Esta diapositiva no es una unión.' });
    }

    if (record.id.startsWith('presentacion/') && cloudinaryReady) {
      await cloudinary.uploader.destroy(record.id).catch(() => {});
    }

    const next = [...order.slice(0, idx), ...record.originals, ...order.slice(idx + 1)];
    await writeOrder(next);
    notifyImagesChanged();
    res.json(next);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al separar la unión.' });
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
