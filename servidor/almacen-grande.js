// ---- Almacén grande (Hugging Face) ----
// Los videos de más de 100 MB no entran en Cloudinary gratis: van a un dataset PRIVADO de
// Hugging Face. El celular los manda a este servidor en trozos de 6 MB (la clave de Hugging
// Face no puede ir en el celular); al llegar el último trozo, el servidor sube el archivo
// completo y lo borra de su disco.
//
// Para verlos, la pantalla pide /api/multimedia/grande/ver/<id> y el servidor le contesta con
// un enlace firmado de Hugging Face que dura un rato: el video viaja directo de Hugging Face
// a la pantalla, sin pasar por Render.
//
// Al borrar, se borra el archivo Y su copia del historial: si no, seguiría ocupando espacio.
const crypto = require('crypto');
const fs = require('fs');
const { HF_TOKEN, HF_DATASET } = require('./configuracion');

const BASE = 'https://huggingface.co';
const listo = Boolean(HF_TOKEN && HF_DATASET);
const repo = { type: 'dataset', name: HF_DATASET };

let hub = null;
function libreria() {
  if (!hub) hub = require('@huggingface/hub');
  return hub;
}

// SHA-256 del archivo, leyéndolo de a pedazos (no lo carga entero en la memoria).
function huellaDe(ruta) {
  return new Promise((resolver, rechazar) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(ruta).on('data', d => h.update(d)).on('error', rechazar).on('end', () => resolver(h.digest('hex')));
  });
}

// Sube el archivo del disco a <carpeta>/<nombre> en el dataset. useXet: false porque el otro
// método guardaba el archivo entero en memoria (450 MB por un video de 300 MB) y Render
// gratis tiene 512 MB; así usa unos 110 MB.
async function subir(rutaLocal, rutaEnRepo) {
  const { pathToFileURL } = require('url');
  const sha = await huellaDe(rutaLocal);
  await libreria().uploadFile({
    repo,
    accessToken: HF_TOKEN,
    file: { path: rutaEnRepo, content: pathToFileURL(rutaLocal) },
    commitTitle: 'Video de Conexiones',
    useXet: false
  });
  return sha;
}

// Borra el archivo y, con su huella, también la copia que queda en el historial.
async function borrar(rutaEnRepo, sha) {
  try {
    await libreria().deleteFile({ repo, accessToken: HF_TOKEN, path: rutaEnRepo, commitTitle: 'Video borrado' });
  } catch (err) {
    if (!/404|not found|does not exist/i.test(String(err && err.message))) console.error('No se pudo borrar de Hugging Face:', err.message || err);
  }
  if (!sha) return;
  try {
    const res = await fetch(`${BASE}/api/datasets/${HF_DATASET}/lfs-files/batch`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + HF_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletions: { sha: [sha], rewriteHistory: true } })
    });
    if (!res.ok) console.error('Hugging Face no borró el historial del video:', res.status);
  } catch (err) {
    console.error('No se pudo borrar el historial en Hugging Face:', err.message || err);
  }
}

// Enlace firmado para ver el video. Se guarda unos minutos para no preguntar en cada salto.
const enlaces = new Map(); // ruta → { url, vence }
const DURA_MS = 20 * 60 * 1000;
async function enlaceParaVer(rutaEnRepo) {
  const guardado = enlaces.get(rutaEnRepo);
  if (guardado && guardado.vence > Date.now()) return guardado.url;
  const res = await fetch(`${BASE}/datasets/${HF_DATASET}/resolve/main/${rutaEnRepo.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: 'Bearer ' + HF_TOKEN },
    redirect: 'manual'
  });
  const url = res.headers.get('location');
  if (res.status < 300 || res.status >= 400 || !url) throw new Error('Hugging Face no dio el enlace del video (' + res.status + ').');
  enlaces.set(rutaEnRepo, { url, vence: Date.now() + DURA_MS });
  if (enlaces.size > 500) enlaces.delete(enlaces.keys().next().value);
  return url;
}

module.exports = { almacenGrandeListo: listo, subirAlAlmacenGrande: subir, borrarDelAlmacenGrande: borrar, enlaceParaVer };
