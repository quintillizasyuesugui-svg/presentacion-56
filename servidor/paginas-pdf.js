// ---- Páginas de un PDF → imágenes (en el servidor) ----
// PDF.js dibuja cada página sobre un lienzo de @napi-rs/canvas (funciona igual en
// Windows y en Linux, sin instalar nada más). Se dibuja de a una página, así la
// memoria no crece con documentos largos.
const { pathToFileURL } = require('url');
const { createCanvas } = require('@napi-rs/canvas');

// Lado mayor de cada imagen y calidad de compresión WebP (0-100).
const CALIDADES = {
  liviana: { lado: 1280, calidad: 70 },
  normal: { lado: 1600, calidad: 80 },
  alta: { lado: 1920, calidad: 90 }
};

let pdfjs = null;
async function cargarPdfjs() {
  if (!pdfjs) pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfjs;
}

async function abrirPdf(bytes) {
  const lib = await cargarPdfjs();
  try {
    return await lib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false }).promise;
  } catch (err) {
    const conClave = err && err.name === 'PasswordException';
    const error = new Error(conClave ? 'El PDF tiene contraseña. Quitásela y volvé a subirlo.' : 'El archivo no es un PDF válido o está dañado.');
    error.estado = 422;
    throw error;
  }
}

// Dibuja una página con su lado mayor en `lado` píxeles, sobre fondo blanco.
async function dibujarPagina(pdf, numero, lado) {
  const pagina = await pdf.getPage(numero);
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
async function imagenDePagina(pdf, numero, calidad, recortar) {
  const { lado, calidad: q } = CALIDADES[calidad] || CALIDADES.normal;
  let lienzo = await dibujarPagina(pdf, numero, lado);
  if (recortar) lienzo = recortarMargenes(lienzo);
  return lienzo.encode('webp', q);
}

// Miniatura chica (JPG en data URI) para elegir páginas en el celular.
async function miniaturaDePagina(pdf, numero) {
  const lienzo = await dibujarPagina(pdf, numero, 240);
  return 'data:image/jpeg;base64,' + (await lienzo.encode('jpeg', 70)).toString('base64');
}

// Página en grande para verla en el celular antes de elegir (WebP nítido, no tan pesado).
async function vistaDePagina(pdf, numero) {
  const lienzo = await dibujarPagina(pdf, numero, 1400);
  return lienzo.encode('webp', 80);
}

module.exports = { CALIDADES, abrirPdf, imagenDePagina, miniaturaDePagina, vistaDePagina, recortarMargenes };
