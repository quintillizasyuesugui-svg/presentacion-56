// Guardado de datos sin base de datos: un archivo JSON en datos/ más un respaldo
// crudo en Cloudinary, para que sobreviva a los reinicios y redeploys de Render.
const fs = require('fs').promises;
const path = require('path');
const { RAIZ, CARPETA_DATOS, cloudinary, nubeLista } = require('./configuracion');

// archivo: nombre dentro de datos/.
// archivoViejo: nombre que tenía en la raíz del proyecto antes de ordenar las carpetas
//   (se sigue leyendo si todavía existe, así no se pierde nada al actualizar).
// idNube: public_id del respaldo en Cloudinary — no cambiar, ahí están los datos de siempre.
// que / elQue: para los mensajes de error ("de orden", "el orden").
function crearAlmacenJson({ archivo, archivoViejo, idNube, que, elQue }) {
  const ruta = path.join(CARPETA_DATOS, archivo);
  const rutaVieja = archivoViejo ? path.join(RAIZ, archivoViejo) : null;

  async function leerLocal() {
    for (const candidata of [ruta, rutaVieja]) {
      if (!candidata) continue;
      try {
        return JSON.parse(await fs.readFile(candidata, 'utf8'));
      } catch { /* no existe o está dañado: probar el siguiente */ }
    }
    return null;
  }

  async function leerRespaldoNube() {
    if (!nubeLista) return null;
    try {
      const url = cloudinary.url(idNube, { resource_type: 'raw', secure: true }) + `?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error(`No se pudo leer el respaldo de ${que} en Cloudinary:`, err.message);
      return null;
    }
  }

  async function respaldarEnNube(datos) {
    if (!nubeLista) return;
    try {
      const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(datos)).toString('base64');
      await cloudinary.uploader.upload(dataUri, {
        public_id: idNube,
        resource_type: 'raw',
        overwrite: true,
        invalidate: true
      });
    } catch (err) {
      console.error(`No se pudo respaldar ${elQue} en Cloudinary:`, err.message);
    }
  }

  async function escribir(datos) {
    await fs.mkdir(CARPETA_DATOS, { recursive: true });
    await fs.writeFile(ruta, JSON.stringify(datos, null, 2));
    await respaldarEnNube(datos);
  }

  // Primero el archivo local y, si no hay, el respaldo de Cloudinary.
  async function leer() {
    return (await leerLocal()) || (await leerRespaldoNube());
  }

  return { leer, escribir };
}

module.exports = { crearAlmacenJson };
