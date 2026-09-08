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

// ---- Personas y PIN (para /manage.html y /avanzado.html) ----
// El sistema se encarga solo: cada persona se registra una vez con su nombre,
// el servidor le da un PIN de 4 dígitos único (nadie lo elige a mano), y desde
// ahí ese PIN identifica sus imágenes. Se guarda en people.json — mismo truco
// que el orden de imágenes: respaldo en Cloudinary como JSON crudo para que
// sobreviva a los reinicios de Render aunque no haya una base de datos real.
// ADMIN_PIN (opcional, variable de entorno) ve y controla las imágenes de todos.

const PEOPLE_FILE = path.join(__dirname, 'people.json');
const CLOUD_PEOPLE_PUBLIC_ID = 'presentacion/people';
const ADMIN_PIN = process.env.ADMIN_PIN || null;

async function readLocalPeople() {
  try {
    return JSON.parse(await fs.readFile(PEOPLE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function readCloudPeopleBackup() {
  if (!cloudinaryReady) return null;
  try {
    const url = cloudinary.url(CLOUD_PEOPLE_PUBLIC_ID, { resource_type: 'raw', secure: true }) + `?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('No se pudo leer el respaldo de personas en Cloudinary:', err.message);
    return null;
  }
}

async function readPeople() {
  let people = await readLocalPeople();
  if (!people) people = await readCloudPeopleBackup();
  return people || [];
}

async function writePeople(people) {
  await fs.writeFile(PEOPLE_FILE, JSON.stringify(people, null, 2));
  if (!cloudinaryReady) return;
  try {
    const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(people)).toString('base64');
    await cloudinary.uploader.upload(dataUri, {
      public_id: CLOUD_PEOPLE_PUBLIC_ID,
      resource_type: 'raw',
      overwrite: true,
      invalidate: true
    });
  } catch (err) {
    console.error('No se pudo respaldar las personas en Cloudinary:', err.message);
  }
}

// PIN de 4 dígitos (1000-9999) que no choque con uno ya asignado.
function generatePin(existingPeople) {
  const taken = new Set(existingPeople.map(p => p.pin));
  let pin;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (taken.has(pin));
  return pin;
}

// Si el nombre ya está tomado, no le presta el PIN ajeno (sería dejar entrar a
// alguien a las fotos de otro con sólo adivinar su nombre) — le arma uno propio.
function uniquePersonName(base, existingPeople) {
  const taken = new Set(existingPeople.map(p => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

async function identify(pin) {
  if (!pin) return null;
  if (ADMIN_PIN && pin === ADMIN_PIN) return { name: 'admin', isAdmin: true };
  const person = (await readPeople()).find(p => p.pin === pin);
  return person ? { name: person.name, isAdmin: false } : null;
}

async function requirePerson(req, res, next) {
  try {
    const person = await identify(req.get('x-pin'));
    if (!person) return res.status(401).json({ error: 'PIN inválido o faltante.' });
    req.person = person;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en servidor' });
  }
}

// Qué ve cada uno: admin ve todo, cualquier otra persona sólo lo que subió ella.
function visibleFor(person, order) {
  return person.isAdmin ? order : order.filter(r => r.owner === person.name);
}

// POST /api/auth/register — alta nueva: el sistema genera el PIN, nadie lo elige.
app.post('/api/auth/register', async (req, res) => {
  try {
    const raw = String((req.body || {}).name || '').trim().slice(0, 40);
    if (!raw) return res.status(400).json({ error: 'Escribí tu nombre.' });

    const people = await readPeople();
    const name = uniquePersonName(raw, people);
    const pin = generatePin(people);
    people.push({ pin, name });
    await writePeople(people);
    res.json({ name, pin, isAdmin: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar.' });
  }
});

// POST /api/auth/login — volver a entrar con un PIN ya asignado (ej. otro celular).
app.post('/api/auth/login', async (req, res) => {
  const person = await identify((req.body || {}).pin);
  if (!person) return res.status(401).json({ error: 'PIN incorrecto.' });
  res.json(person);
});

// ---- Frase final (por persona) ----
// Cada persona configura su propio mensaje de cierre — aparece en pantalla.html
// cuando SU show (sus propias diapositivas) llega al final. Mismo patrón de
// persistencia que people.json/images-order.json: archivo local + respaldo
// crudo en Cloudinary para sobrevivir a los redeploys de Render.

const FRASES_FILE = path.join(__dirname, 'frases-finales.json');
const CLOUD_FRASES_PUBLIC_ID = 'presentacion/frases-finales';

// Los 10 tipos de letra y 10 efectos son un menú cerrado (no texto libre) —
// así el cliente sólo manda una "key" y acá se valida contra esta lista,
// nunca CSS/HTML suelto. El nombre visible y la fuente real de cada uno
// viven en el HTML (avanzado.html/pantalla.html), acá sólo importa la key.
const FRASE_FONTS = ['sans', 'serif', 'script', 'display', 'casual', 'geometric', 'bold-script', 'poster', 'calligraphy', 'huge'];
const FRASE_EFFECTS = ['fade', 'slide-up', 'slide-down', 'zoom', 'bounce', 'typewriter', 'confetti', 'rotate', 'glow', 'wave'];
const FRASE_POSITIONS = ['top', 'middle', 'bottom'];
const FRASE_DEFAULT = { text: '', font: 'sans', color: '#ffffff', effect: 'fade', duration: 1, fontSize: 1, position: 'middle' };

async function readLocalFrases() {
  try {
    return JSON.parse(await fs.readFile(FRASES_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function readCloudFrasesBackup() {
  if (!cloudinaryReady) return null;
  try {
    const url = cloudinary.url(CLOUD_FRASES_PUBLIC_ID, { resource_type: 'raw', secure: true }) + `?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('No se pudo leer el respaldo de frases finales en Cloudinary:', err.message);
    return null;
  }
}

async function readFrases() {
  let frases = await readLocalFrases();
  if (!frases) frases = await readCloudFrasesBackup();
  return frases || [];
}

async function writeFrases(frases) {
  await fs.writeFile(FRASES_FILE, JSON.stringify(frases, null, 2));
  if (!cloudinaryReady) return;
  try {
    const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(frases)).toString('base64');
    await cloudinary.uploader.upload(dataUri, {
      public_id: CLOUD_FRASES_PUBLIC_ID,
      resource_type: 'raw',
      overwrite: true,
      invalidate: true
    });
  } catch (err) {
    console.error('No se pudo respaldar las frases finales en Cloudinary:', err.message);
  }
}

// Nada de texto/HTML suelto sin revisar: el color tiene que ser un hex de 6
// dígitos y la letra/efecto tienen que estar en el menú cerrado de arriba.
function parseFraseBody(body) {
  const text = String((body || {}).text || '').trim().slice(0, 60);
  const font = FRASE_FONTS.includes((body || {}).font) ? body.font : null;
  const effect = FRASE_EFFECTS.includes((body || {}).effect) ? body.effect : null;
  const color = typeof (body || {}).color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  const position = FRASE_POSITIONS.includes((body || {}).position) ? body.position : null;
  const rawDuration = Number((body || {}).duration);
  const duration = Number.isFinite(rawDuration) ? Math.min(3, Math.max(0.4, rawDuration)) : null;
  const rawFontSize = Number((body || {}).fontSize);
  const fontSize = Number.isFinite(rawFontSize) ? Math.min(1.8, Math.max(0.6, rawFontSize)) : null;
  if (!text || !font || !effect || !color || !position || duration === null || fontSize === null) return null;
  return { text, font, color, effect, duration, fontSize, position };
}

// GET /api/frase-final — la frase de cierre propia (valores por default si nunca la configuró)
app.get('/api/frase-final', requirePerson, async (req, res) => {
  try {
    const frases = await readFrases();
    const mine = frases.find(f => f.owner === req.person.name);
    res.json(mine ? {
      text: mine.text,
      font: mine.font,
      color: mine.color,
      effect: mine.effect,
      duration: mine.duration || 1,
      fontSize: mine.fontSize || 1,
      position: mine.position || 'middle'
    } : FRASE_DEFAULT);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// POST /api/frase-final — guarda la frase de cierre propia
app.post('/api/frase-final', requirePerson, async (req, res) => {
  try {
    const parsed = parseFraseBody(req.body);
    if (!parsed) return res.status(400).json({ error: 'Revisá el texto, la letra, el color o el efecto.' });

    const frases = await readFrases();
    const idx = frases.findIndex(f => f.owner === req.person.name);
    const record = { owner: req.person.name, ...parsed };
    if (idx === -1) frases.push(record); else frases[idx] = record;
    await writeFrases(frases);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la frase.' });
  }
});

// POST /api/frase-final/send — la muestra ya mismo en la pantalla propia (para
// probarla en el proyector real sin esperar a que termine el show). No hace
// falta haberla guardado antes — manda el borrador tal cual está en el editor.
app.post('/api/frase-final/send', requirePerson, (req, res) => {
  const parsed = parseFraseBody(req.body);
  if (!parsed) return res.status(400).json({ error: 'Revisá el texto, la letra, el color o el efecto.' });
  io.to('owner:' + req.person.name).emit('fraseFinalAhora', parsed);
  res.json({ ok: true });
});

// GET /images — { src, transform } por diapositiva, para pantalla.html y control.html
// (transform es el ajuste de tamaño/posición del Modo avanzado; null si nunca se tocó)
// Sin PIN — es la pantalla pública/el control, muestra el show combinado de todos.
app.get("/images", async (req, res) => {
  try {
    res.json((await readOrder()).map(r => ({ src: r.src, transform: r.transform || null })));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error en servidor");
  }
});

// GET /api/images — registros completos {id, src}, para manage.html.
// Filtrado por dueño: cada persona sólo ve lo que subió ella; admin ve todo.
app.get("/api/images", requirePerson, async (req, res) => {
  try {
    res.json(visibleFor(req.person, await readOrder()));
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

app.post('/api/images/upload', requirePerson, upload.array('images', 20), async (req, res) => {
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
      return { id: result.public_id, src: result.secure_url, owner: req.person.name };
    }));

    const order = await readOrder();
    order.push(...uploadedRecords);
    await writeOrder(order);
    notifyImagesChanged();
    res.json(visibleFor(req.person, order));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir la imagen.' });
  }
});

// ---- Borrar imagen ----
// Wildcard porque el id de Cloudinary trae barras (ej. "presentacion/slides/abc123")
app.delete('/api/images/*id', requirePerson, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id.join('/') : req.params.id;
    const order = await readOrder();
    const record = order.find(r => r.id === id);
    if (!record) {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }
    if (!req.person.isAdmin && record.owner !== req.person.name) {
      return res.status(403).json({ error: 'Sólo podés borrar tus propias imágenes.' });
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
    res.json(visibleFor(req.person, next));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar la imagen.' });
  }
});

// ---- Tamaño y posición (Modo avanzado) ----
// Ajuste no destructivo: sólo guarda { scale, x, y } junto a la imagen en el
// orden — pantalla.html lo aplica con CSS al mostrarla, la imagen original no cambia.
app.post('/api/images/*id/transform', requirePerson, async (req, res) => {
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
    if (!req.person.isAdmin && record.owner !== req.person.name) {
      return res.status(403).json({ error: 'Sólo podés ajustar tus propias imágenes.' });
    }

    record.transform = { scale, x, y };
    await writeOrder(order);
    notifyImagesChanged();
    res.json(visibleFor(req.person, order));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el ajuste.' });
  }
});

// ---- Unir imágenes (Modo avanzado) ----
// El collage ya viene armado desde el celular (canvas) en dataUri — acá sólo se
// sube como una imagen más y se reemplazan las 2-30 originales por esa única
// diapositiva. "originals" guarda esas imágenes completas (con su propio ajuste
// de tamaño/posición si tenían) para poder deshacer la unión con /uncombine.
app.post('/api/images/combine', requirePerson, async (req, res) => {
  if (!cloudinaryReady) {
    return res.status(500).json({
      error: 'Cloudinary no está configurado en el servidor (faltan variables de entorno). Revisá .env.example.'
    });
  }
  try {
    const { ids, dataUri } = req.body;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 30 || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Elegí entre 2 y 30 imágenes distintas para unir.' });
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
    if (!req.person.isAdmin && removedIndexes.some(i => order[i].owner !== req.person.name)) {
      return res.status(403).json({ error: 'Sólo podés unir tus propias imágenes.' });
    }

    const removedSet = new Set(removedIndexes);
    // El orden de "originals" sigue el orden actual del deck, no el orden en que
    // se tildaron en el celular — así el collage queda de izquierda a derecha
    // como están hoy las diapositivas.
    const originals = order.filter((r, i) => removedSet.has(i));

    const result = await cloudinary.uploader.upload(dataUri, { folder: 'presentacion/slides' });
    const merged = { id: result.public_id, src: result.secure_url, originals, owner: req.person.name };

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
    res.json(visibleFor(req.person, next));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al unir las imágenes.' });
  }
});

// ---- Deshacer una unión ----
app.post('/api/images/*id/uncombine', requirePerson, async (req, res) => {
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
    if (!req.person.isAdmin && record.owner !== req.person.name) {
      return res.status(403).json({ error: 'Sólo podés separar tus propias uniones.' });
    }

    if (record.id.startsWith('presentacion/') && cloudinaryReady) {
      await cloudinary.uploader.destroy(record.id).catch(() => {});
    }

    const next = [...order.slice(0, idx), ...record.originals, ...order.slice(idx + 1)];
    await writeOrder(next);
    notifyImagesChanged();
    res.json(visibleFor(req.person, next));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al separar la unión.' });
  }
});

// ---- Reordenar imágenes ----
app.post('/api/images/reorder', requirePerson, async (req, res) => {
  try {
    const { order: newIds } = req.body;
    const current = await readOrder();
    const byId = new Map(current.map(r => [r.id, r]));

    if (req.person.isAdmin) {
      const valid = Array.isArray(newIds) &&
        newIds.length === current.length &&
        newIds.every(id => byId.has(id)) &&
        new Set(newIds).size === current.length;
      if (!valid) return res.status(400).json({ error: 'Orden inválido.' });

      const reordered = newIds.map(id => byId.get(id));
      await writeOrder(reordered);
      notifyImagesChanged();
      return res.json(reordered);
    }

    // No admin: sólo puede reordenar el subconjunto de imágenes que le
    // pertenecen — las de los demás quedan intactas en su lugar de siempre.
    const ownIndexes = [];
    current.forEach((r, i) => { if (r.owner === req.person.name) ownIndexes.push(i); });
    const ownIds = ownIndexes.map(i => current[i].id);

    const valid = Array.isArray(newIds) &&
      newIds.length === ownIds.length &&
      new Set(newIds).size === ownIds.length &&
      newIds.every(id => ownIds.includes(id));
    if (!valid) return res.status(400).json({ error: 'Orden inválido.' });

    const next = [...current];
    ownIndexes.forEach((slotIndex, i) => { next[slotIndex] = byId.get(newIds[i]); });

    await writeOrder(next);
    notifyImagesChanged();
    res.json(visibleFor(req.person, next));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reordenar.' });
  }
});

io.on("connection", (socket) => {
  console.log("✨ Dispositivo vinculado");
  socket.on("cambiar", (accion) => io.emit("cambiar", accion));
  socket.on("cine", () => io.emit("cine"));

  // Vincula este socket a la "sala" de su dueño (según el PIN) — así se le
  // puede mandar algo sólo a él/ella, como probar la frase final en su propia
  // pantalla sin que le aparezca a nadie más. Se repite en cada reconexión
  // porque las salas son por socket (conexión), no por dispositivo.
  socket.on("identificar", async (pin) => {
    try {
      const person = await identify(pin);
      if (person) socket.join('owner:' + person.name);
    } catch (err) {
      console.error('No se pudo identificar el socket:', err.message);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Cinema en http://0.0.0.0:${PORT}`));
