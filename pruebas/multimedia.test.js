// Pruebas de la música y los videos: validaciones, enlaces de YouTube, espacio por persona,
// borrar varios, orden y el tiempo real entre el celular y la pantalla.
// Levantan el servidor de verdad en otro proceso, con datos temporales y SIN Cloudinary ni
// base de datos (las variables van vacías a propósito: así nunca toca las claves del .env).
// Antes de cargar cualquier módulo del servidor: sin nube ni base de datos, pase lo que pase en .env.
for (const v of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'DATABASE_URL']) process.env[v] = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io: conectarSocket } = require('socket.io-client');
const { limpiarOrdenMedios, limpiarEstadoMedios } = require('../servidor/validadores-medios');

const RAIZ = path.join(__dirname, '..');
const CARPETA_SUBIDAS = path.join(RAIZ, 'publico', 'multimedia');
const ADMIN = '9731';

// ---- Validaciones (sin servidor) ----
test('orden de medios: acepta las válidas y rechaza el resto', () => {
  assert.deepEqual(limpiarOrdenMedios({ para: 'musica', accion: 'alternar' }), { para: 'musica', accion: 'alternar' });
  assert.deepEqual(limpiarOrdenMedios({ para: 'musica', accion: 'volumen', valor: 55.6 }), { para: 'musica', accion: 'volumen', valor: 56 });
  assert.deepEqual(limpiarOrdenMedios({ para: 'video', accion: 'ir', valor: 12.5 }), { para: 'video', accion: 'ir', valor: 12.5 });
  assert.deepEqual(limpiarOrdenMedios({ para: 'video', accion: 'mandar', valor: 'youtube/abc' }), { para: 'video', accion: 'mandar', valor: 'youtube/abc' });
  assert.equal(limpiarOrdenMedios({ para: 'musica', accion: 'volumen', valor: 150 }), null);
  assert.equal(limpiarOrdenMedios({ para: 'musica', accion: 'ir', valor: -1 }), null);
  assert.equal(limpiarOrdenMedios({ para: 'musica', accion: 'mandar', valor: 'x' }), null);
  assert.equal(limpiarOrdenMedios({ para: 'video', accion: 'siguiente' }), null);
  assert.equal(limpiarOrdenMedios({ para: 'otro', accion: 'alternar' }), null);
  assert.equal(limpiarOrdenMedios({ para: 'video', accion: 'mandar', valor: 'x'.repeat(500) }), null);
  assert.equal(limpiarOrdenMedios(null), null);
});

test('estado de medios: limpia y acota lo que manda la pantalla', () => {
  const e = limpiarEstadoMedios({
    pantalla: 'p1', permitido: 1,
    musica: { id: 'm1', nombre: 'x'.repeat(400), t: 5, duracion: 60, sonando: true, volumen: 300, posicion: 0, total: 2 },
    video: null
  });
  assert.equal(e.permitido, true);
  assert.equal(e.musica.nombre.length, 200);
  assert.equal(e.musica.volumen, 100);
  assert.equal(e.video, null);
  assert.equal(limpiarEstadoMedios({ pantalla: 'p1', musica: { nombre: 'sin id' } }), null);
  assert.equal(limpiarEstadoMedios({ musica: null }), null);
});

test('enlaces de YouTube: reconoce los formatos comunes', () => {
  const { idDeYoutube } = require('../servidor/multimedia');
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=30s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://music.youtube.com/watch?v=${id}`
  ]) assert.equal(idDeYoutube(url), id, url);
  for (const url of ['https://vimeo.com/123', 'no es un enlace', 'https://youtube.com/watch?v=corto', 'https://evil.com/watch?v=' + id]) {
    assert.equal(idDeYoutube(url), null, url);
  }
});

test('calculador de espacio: con pocas personas da más, con muchas da menos', () => {
  const { repartirEspacio } = require('../servidor/multimedia');
  // 12 GB de presupuesto, entre 100 MB y 2 GB por persona.
  const cuanto = (n) => repartirEspacio(n, 12000, 100, 2000);
  assert.equal(cuanto(0), 2000);
  assert.equal(cuanto(3), 2000);   // pocas personas: el máximo
  assert.equal(cuanto(10), 1200);
  assert.equal(cuanto(30), 400);
  assert.equal(cuanto(60), 200);
  assert.equal(cuanto(500), 100);  // muchas: nunca menos del mínimo
  for (let n = 1; n < 300; n++) assert.ok(cuanto(n + 1) <= cuanto(n), 'nunca sube al haber más personas');
});

// ---- Servidor de verdad ----
let servidor;
let base;
let datosTemporales;

async function esperarServidor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url + '/api/multimedia');
      if (r.status === 401) return;
    } catch { /* todavía arrancando */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('El servidor de prueba no arrancó');
}

test.before(async () => {
  datosTemporales = fs.mkdtempSync(path.join(os.tmpdir(), 'conexiones-multimedia-'));
  const puerto = 38000 + Math.floor(Math.random() * 2000);
  servidor = spawn(process.execPath, ['servidor/index.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(puerto),
      CARPETA_DATOS: datosTemporales,
      CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
      DATABASE_URL: '',
      PIN_SECRETO: 'secreto-de-prueba',
      ADMIN_PIN: ADMIN,
      DOCUMENTOS_SIN_NUBE_LOCAL: '1',
      PRESUPUESTO_MB: '1', ESPACIO_MIN_MB: '1', ESPACIO_MAX_MB: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  servidor.stderr.on('data', () => {});
  base = `http://127.0.0.1:${puerto}`;
  await esperarServidor(base);
});

test.after(() => {
  if (servidor) servidor.kill();
  fs.rmSync(datosTemporales, { recursive: true, force: true });
});

async function pedir(pin, ruta, cuerpo, metodo) {
  const r = await fetch(base + ruta, {
    method: metodo || (cuerpo ? 'POST' : 'GET'),
    headers: { 'x-pin': pin, ...(cuerpo && !(cuerpo instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo instanceof FormData ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  return { estado: r.status, datos: await r.json().catch(() => null) };
}

async function registrar(nombre) {
  const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nombre }) });
  return r.json();
}

function subirLocal(pin, nombre, bytes, tipo = 'musica') {
  const form = new FormData();
  form.append('tipo', tipo);
  form.append('duracion', '42');
  form.append('archivo', new Blob([Buffer.alloc(bytes, 7)]), nombre);
  return pedir(pin, '/api/multimedia/subir-local', form);
}

test('subir, espacio por persona, borrar varios y orden', async () => {
  const ana = await registrar('Ana prueba');
  const beto = await registrar('Beto prueba');

  let r = await pedir(ana.pin, '/api/multimedia');
  assert.equal(r.estado, 200);
  assert.deepEqual(r.datos.elementos, []);
  assert.equal(r.datos.espacio.total, 1024 * 1024);
  assert.equal(r.datos.subida, 'local');
  assert.match(r.datos.explicacion, /Tu espacio es de 1 MB/);

  // La firma avisa antes de subir si no entra en el espacio o el formato no sirve.
  r = await pedir(ana.pin, '/api/multimedia/firma', { tipo: 'musica', nombre: 'grande.mp3', bytes: 2 * 1024 * 1024 });
  assert.equal(r.estado, 413);
  assert.match(r.datos.error, /espacio/);
  r = await pedir(ana.pin, '/api/multimedia/firma', { tipo: 'musica', nombre: 'virus.exe', bytes: 100 });
  assert.equal(r.estado, 400);
  r = await pedir(ana.pin, '/api/multimedia/firma', { tipo: 'musica', nombre: 'tema.mp3', bytes: 1000 });
  assert.deepEqual(r.datos, { modo: 'local', url: '/api/multimedia/subir-local' });

  r = await subirLocal(ana.pin, 'Tema uno.mp3', 300 * 1024);
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  r = await subirLocal(ana.pin, 'Tema dos.mp3', 300 * 1024);
  assert.equal(r.estado, 200);
  const [uno, dos] = r.datos.elementos;
  assert.equal(uno.nombre, 'Tema uno');
  assert.equal(uno.duracion, 42);
  assert.equal(r.datos.espacio.usado, 600 * 1024);
  assert.ok(fs.existsSync(path.join(CARPETA_SUBIDAS, uno.archivo)));

  // El archivo se puede escuchar desde la pantalla.
  const escuchar = await fetch(base + uno.src);
  assert.equal(escuchar.status, 200);

  // Ya no entra otro de 500 KB: se rechaza y no queda el archivo en el disco.
  const antes = fs.readdirSync(CARPETA_SUBIDAS).length;
  r = await subirLocal(ana.pin, 'Tema tres.mp3', 500 * 1024);
  assert.equal(r.estado, 413);
  assert.match(r.datos.error, /Tu espacio es de 1 MB porque/); // el Guardián explica por qué
  assert.equal(fs.readdirSync(CARPETA_SUBIDAS).length, antes);

  // Cada persona ve sólo lo suyo y no puede borrar lo de otra.
  r = await pedir(beto.pin, '/api/multimedia');
  assert.deepEqual(r.datos.elementos, []);
  r = await pedir(beto.pin, '/api/multimedia/borrar', { ids: [uno.id] });
  assert.equal(r.estado, 403);

  // Orden: sólo con todos los propios de ese tipo.
  r = await pedir(ana.pin, '/api/multimedia/orden', { tipo: 'musica', ids: [dos.id, uno.id] });
  assert.equal(r.estado, 200);
  assert.deepEqual(r.datos.elementos.map(e => e.id), [dos.id, uno.id]);
  r = await pedir(ana.pin, '/api/multimedia/orden', { tipo: 'musica', ids: [dos.id] });
  assert.equal(r.estado, 400);

  // El admin sí puede borrar lo de cualquiera.
  r = await subirLocal(ana.pin, 'Tema del admin.mp3', 100 * 1024);
  const paraAdmin = r.datos.elementos.find(e => e.nombre === 'Tema del admin');
  r = await pedir(ADMIN, '/api/multimedia/borrar', { ids: [paraAdmin.id] });
  assert.equal(r.estado, 200);
  assert.ok(!fs.existsSync(path.join(CARPETA_SUBIDAS, paraAdmin.archivo)));

  // Borrar varios juntos libera el espacio y los archivos.
  r = await pedir(ana.pin, '/api/multimedia/borrar', { ids: [uno.id, dos.id] });
  assert.equal(r.estado, 200);
  assert.deepEqual(r.datos.elementos, []);
  assert.equal(r.datos.espacio.usado, 0);
  assert.ok(!fs.existsSync(path.join(CARPETA_SUBIDAS, uno.archivo)));
  assert.ok(!fs.existsSync(path.join(CARPETA_SUBIDAS, dos.archivo)));
});

test('enlaces de YouTube: no ocupan espacio y validan el tramo', async () => {
  const caro = await registrar('Caro prueba');
  let r = await pedir(caro.pin, '/api/multimedia/youtube', { url: 'https://vimeo.com/1' });
  assert.equal(r.estado, 400);
  r = await pedir(caro.pin, '/api/multimedia/youtube', { url: 'https://youtu.be/dQw4w9WgXcQ', inicio: 90, fin: 30 });
  assert.equal(r.estado, 400);
  r = await pedir(caro.pin, '/api/multimedia/youtube', { url: 'https://youtu.be/dQw4w9WgXcQ', inicio: 30, fin: 90 });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  const [video] = r.datos.elementos;
  assert.equal(video.origen, 'youtube');
  assert.equal(video.youtubeId, 'dQw4w9WgXcQ');
  assert.equal(video.duracion, 60);
  assert.equal(r.datos.espacio.usado, 0);
  assert.ok(video.nombre.length > 0);
  await pedir(caro.pin, '/api/multimedia/borrar', { ids: [video.id] });
});

test('admin: ve el espacio de cada uno, lo cambia, y al borrar la cuenta se van sus videos', async () => {
  const dani = await registrar('Dani prueba');
  let r = await pedir(dani.pin, '/api/admin/espacio', { nombre: 'Dani prueba', mb: 50 });
  assert.equal(r.estado, 403);
  r = await pedir(ADMIN, '/api/admin/espacio', { nombre: 'Dani prueba', mb: 3 });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.espacio.total, 3 * 1024 * 1024);
  r = await pedir(ADMIN, '/api/admin/espacio', { nombre: 'Dani prueba', mb: -2 });
  assert.equal(r.estado, 400);

  // Con 3 MB ya le entra algo de 2 MB.
  r = await subirLocal(dani.pin, 'Clip.mp4', 2 * 1024 * 1024, 'video');
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  const archivo = r.datos.elementos[0].archivo;

  r = await pedir(ADMIN, '/api/admin/personas');
  const fila = r.datos.find(p => p.name === 'Dani prueba');
  assert.equal(fila.espacio.videos, 1);
  assert.equal(fila.espacio.usado, 2 * 1024 * 1024);

  r = await pedir(ADMIN, '/api/admin/nube');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.calculo.personas >= 1);
  assert.equal(r.datos.calculo.mbPorPersona, 1);
  assert.equal(r.datos.usadoTotal >= 2 * 1024 * 1024, true);
  assert.equal(r.datos.nube, null);

  r = await pedir(ADMIN, '/api/admin/espacio', { nombre: 'Dani prueba', mb: null });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.espacio.fijoMb, null);
  assert.equal(r.datos.espacio.total, 1024 * 1024); // volvió al automático

  // El admin puede borrar la música o los videos de cualquiera.
  r = await pedir(ADMIN, '/api/multimedia');
  assert.ok(r.datos.elementos.some(e => e.owner === 'Dani prueba'));

  r = await pedir(ADMIN, '/api/admin/personas/borrar', { nombres: ['Dani prueba'] });
  assert.equal(r.estado, 200);
  assert.ok(!fs.existsSync(path.join(CARPETA_SUBIDAS, archivo)));
});

test('tiempo real: las órdenes van sólo a la pantalla del mismo dueño', async () => {
  const eva = await registrar('Eva prueba');
  const fede = await registrar('Fede prueba');
  const abrir = (pin) => new Promise((resolver) => {
    const s = conectarSocket(base, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => { s.emit('identificar', pin); setTimeout(() => resolver(s), 250); });
  });
  const [pantallaEva, controlEva, pantallaFede] = await Promise.all([abrir(eva.pin), abrir(eva.pin), abrir(fede.pin)]);
  const recibidas = { eva: [], fede: [], estado: [] };
  pantallaEva.on('medios', o => recibidas.eva.push(o));
  pantallaFede.on('medios', o => recibidas.fede.push(o));
  controlEva.on('mediosEstado', e => recibidas.estado.push(e));
  pantallaEva.on('mediosEstado', () => recibidas.estado.push('eco'));

  controlEva.emit('medios', { para: 'musica', accion: 'volumen', valor: 30 });
  controlEva.emit('medios', { para: 'musica', accion: 'volumen', valor: 999 }); // inválida: no llega
  pantallaEva.emit('mediosEstado', { pantalla: 'p-eva', permitido: true, musica: null, video: null });
  await new Promise(r => setTimeout(r, 400));

  assert.deepEqual(recibidas.eva, [{ para: 'musica', accion: 'volumen', valor: 30 }]);
  assert.deepEqual(recibidas.fede, []);
  assert.deepEqual(recibidas.estado, [{ pantalla: 'p-eva', permitido: true, musica: null, video: null }]);
  for (const s of [pantallaEva, controlEva, pantallaFede]) s.close();
});
