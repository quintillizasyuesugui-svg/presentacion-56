// ---- Páginas de un PDF → imágenes (en el servidor) ----
// Para dibujar cada página se usa Poppler (pdftoppm) si está instalado, como en el Docker de
// Render: maneja bien las fuentes que incrusta LibreOffice (con PDF.js a algunas páginas de Word o
// PowerPoint les faltaban letras). Si Poppler no está (por ejemplo en Windows) o falla con una
// página, se dibuja con PDF.js. Se dibuja de a una página, así la memoria no crece con documentos
// largos. Funciona igual con páginas de texto, de imágenes o mezcladas.
const { execFile } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Lado mayor de cada imagen y calidad de compresión WebP (0-100).
const CALIDADES = {
  liviana: { lado: 1280, calidad: 70 },
  normal: { lado: 1600, calidad: 80 },
  alta: { lado: 1920, calidad: 90 }
};

const PDFTOPPM = process.env.PDFTOPPM_RUTA || 'pdftoppm';
const TIEMPO_POR_PAGINA_MS = 60 * 1000;

let pdfjs = null;
async function cargarPdfjs() {
  if (!pdfjs) pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfjs;
}

let hayPoppler = null;
function popplerDisponible() {
  if (hayPoppler === null) {
    hayPoppler = new Promise((resolver) => {
      execFile(PDFTOPPM, ['-v'], { timeout: 15000, windowsHide: true }, (error) => resolver(!error || error.code !== 'ENOENT'));
    });
  }
  return hayPoppler;
}

// Abre el PDF: cuenta las páginas (y detecta contraseña o archivo dañado) con PDF.js y,
// si hay Poppler, deja una copia en una carpeta temporal para que pdftoppm la lea.
// Devuelve { numPages, destroy() }; destroy() borra lo temporal. Siempre llamarlo al terminar.
async function abrirPdf(bytes) {
  const lib = await cargarPdfjs();
  let pdf;
  try {
    pdf = await lib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false }).promise;
  } catch (err) {
    const conClave = err && err.name === 'PasswordException';
    const error = new Error(conClave ? 'El PDF tiene contraseña. Quitásela y volvé a subirlo.' : 'El archivo no es un PDF válido o está dañado.');
    error.estado = 422;
    throw error;
  }
  const documento = { numPages: pdf.numPages, pdf, carpeta: null, ruta: null };
  if (await popplerDisponible()) {
    documento.carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'conexiones-pdf-'));
    documento.ruta = path.join(documento.carpeta, 'documento.pdf');
    await fs.writeFile(documento.ruta, bytes);
  }
  documento.destroy = async () => {
    await pdf.destroy().catch(() => {});
    if (documento.carpeta) await fs.rm(documento.carpeta, { recursive: true, force: true }).catch(() => {});
  };
  return documento;
}

function ejecutar(comando, args) {
  return new Promise((resolver, rechazar) => {
    execFile(comando, args, { timeout: TIEMPO_POR_PAGINA_MS, killSignal: 'SIGKILL', windowsHide: true },
      (error, salida, errores) => (error ? rechazar(Object.assign(error, { detalle: String(errores || '') })) : resolver(salida)));
  });
}

// Con Poppler: una página → PNG con su lado mayor en `lado` píxeles → lienzo.
async function dibujarConPoppler(documento, numero, lado) {
  const base = path.join(documento.carpeta, `pagina-${numero}-${lado}`);
  await ejecutar(PDFTOPPM, ['-f', String(numero), '-l', String(numero), '-scale-to', String(lado), '-png', '-singlefile', documento.ruta, base]);
  const archivo = base + '.png';
  try {
    const imagen = await loadImage(await fs.readFile(archivo));
    const lienzo = createCanvas(imagen.width, imagen.height);
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(imagen, 0, 0);
    return lienzo;
  } finally {
    await fs.rm(archivo, { force: true }).catch(() => {});
  }
}

// Con PDF.js (respaldo): una página sobre fondo blanco con su lado mayor en `lado` píxeles.
async function dibujarConPdfjs(documento, numero, lado) {
  const pagina = await documento.pdf.getPage(numero);
  const base = pagina.getViewport({ scale: 1 });
  const vista = pagina.getViewport({ scale: lado / Math.max(base.width, base.height) });
  const lienzo = createCanvas(Math.max(1, Math.round(vista.width)), Math.max(1, Math.round(vista.height)));
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  await pagina.render({ canvas: lienzo, canvasContext: ctx, viewport: vista }).promise;
  pagina.cleanup();
  return lienzo;
}

async function dibujarPagina(documento, numero, lado) {
  if (documento.ruta) {
    try {
      return await dibujarConPoppler(documento, numero, lado);
    } catch (err) {
      console.error(`Poppler no pudo dibujar la página ${numero}; se usa PDF.js:`, err.message, err.detalle || '');
    }
  }
  return dibujarConPdfjs(documento, numero, lado);
}

// Recorta los márgenes blancos (deja un pequeño borde), así el contenido llena la pantalla.
function recortarMargenes(lienzo) {
  const escala = Math.min(1, 400 / Math.max(lienzo.width, lienzo.height));
  const chico = createCanvas(Math.max(1, Math.round(lienzo.width * escala)), Math.max(1, Math.round(lienzo.height * escala)));
  const ctx = chico.getContext('2d');
  ctx.drawImage(lienzo, 0, 0, chico.width, chico.height);
  const { data } = ctx.getImageData(0, 0, chico.width, chico.height);
  let izq = chico.width, arr = chico.height, der = -1, aba = -1;
  for (let y = 0; y < chico.height; y++) {
    for (let x = 0; x < chico.width; x++) {
      const i = (y * chico.width + x) * 4;
      if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) {
        if (x < izq) izq = x;
        if (x > der) der = x;
        if (y < arr) arr = y;
        if (y > aba) aba = y;
      }
    }
  }
  if (der < 0) return lienzo; // página en blanco: se deja igual
  const margen = Math.round(Math.max(chico.width, chico.height) * 0.025);
  izq = Math.max(0, izq - margen); arr = Math.max(0, arr - margen);
  der = Math.min(chico.width - 1, der + margen); aba = Math.min(chico.height - 1, aba + margen);
  const x = Math.floor(izq / escala), y = Math.floor(arr / escala);
  const ancho = Math.min(lienzo.width - x, Math.ceil((der - izq + 1) / escala));
  const alto = Math.min(lienzo.height - y, Math.ceil((aba - arr + 1) / escala));
  if (ancho >= lienzo.width * 0.97 && alto >= lienzo.height * 0.97) return lienzo;
  const recorte = createCanvas(ancho, alto);
  recorte.getContext('2d').drawImage(lienzo, x, y, ancho, alto, 0, 0, ancho, alto);
  return recorte;
}

// Imagen final de una página: tamaño según la calidad, sin márgenes si se pide, en WebP.
async function imagenDePagina(documento, numero, calidad, recortar) {
  const { lado, calidad: q } = CALIDADES[calidad] || CALIDADES.normal;
  let lienzo = await dibujarPagina(documento, numero, lado);
  if (recortar) lienzo = recortarMargenes(lienzo);
  return lienzo.encode('webp', q);
}

// Miniatura chica (JPG en data URI) para elegir páginas en el celular.
async function miniaturaDePagina(documento, numero) {
  const lienzo = await dibujarPagina(documento, numero, 240);
  return 'data:image/jpeg;base64,' + (await lienzo.encode('jpeg', 70)).toString('base64');
}

// Página en grande para verla en el celular antes de elegir (WebP nítido, no tan pesado).
async function vistaDePagina(documento, numero) {
  const lienzo = await dibujarPagina(documento, numero, 1400);
  return lienzo.encode('webp', 80);
}

module.exports = { CALIDADES, abrirPdf, imagenDePagina, miniaturaDePagina, vistaDePagina, recortarMargenes, popplerDisponible };
