// Sube UN archivo (imagen, canción o video) a Cloudinary con el permiso firmado del servidor.
// Lo usan el ayudante de subidas (ayudante-subidas.js, que sigue aunque se cambie de pantalla)
// y, si el navegador no tiene ayudante, la misma página (subidas-fondo.js).
// No toca la pantalla: sólo avisa el avance con alAvanzar(0..1).
//
// Más rápido que antes:
//  - Las imágenes van directo del celular a Cloudinary (antes pasaban por el servidor, que las
//    volvía a subir) y de a una, así cada una aparece en la lista apenas llega.
//  - Lo pesado se manda en trozos de 6 MB: se ve el avance y, si se corta la conexión, se
//    vuelve a intentar sólo ese trozo.
(function (global) {
  const MB = 1024 * 1024;
  const TROZO = 6 * MB;
  const INTENTOS = 3;
  const LADO_MAXIMO = 1920;

  const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

  async function pedirJson(url, pin, cuerpo) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': pin },
      body: JSON.stringify(cuerpo || {})
    });
    let datos = {};
    try { datos = await res.json(); } catch { /* respuesta vacía */ }
    if (!res.ok) {
      const error = new Error(datos.error || 'El servidor no contestó. Probá de nuevo.');
      error.datos = datos;
      error.estado = res.status;
      throw error;
    }
    return datos;
  }

  // Manda un formulario; si se corta la conexión lo vuelve a intentar (no si el servidor dijo que no).
  async function enviar(url, formulario, cabeceras) {
    for (let intento = 1; ; intento++) {
      let res;
      try {
        res = await fetch(url, { method: 'POST', body: formulario, headers: cabeceras || {} });
      } catch (err) {
        if (intento >= INTENTOS) throw new Error('Se cortó la conexión mientras se subía.');
        await esperar(1500 * intento);
        continue;
      }
      let datos = {};
      try { datos = await res.json(); } catch { /* respuesta vacía */ }
      if (res.ok) return datos;
      if (res.status >= 500 && intento < INTENTOS) { await esperar(1500 * intento); continue; }
      throw new Error(datos.error ? (datos.error.message || datos.error) : 'No se pudo subir.');
    }
  }

  // Cloudinary en trozos: todos llevan la misma firma y el mismo X-Unique-Upload-Id;
  // el último contesta con los datos del archivo ya armado.
  async function subirACloudinary(url, campos, archivo, nombre, alAvanzar) {
    const formularioDe = (parte) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(campos)) f.append(k, v);
      f.append('file', parte, nombre);
      return f;
    };
    if (archivo.size <= TROZO) {
      alAvanzar(0.05);
      const r = await enviar(url, formularioDe(archivo));
      alAvanzar(1);
      return r;
    }
    const id = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
    let respuesta = null;
    for (let desde = 0; desde < archivo.size; desde += TROZO) {
      const hasta = Math.min(archivo.size, desde + TROZO);
      respuesta = await enviar(url, formularioDe(archivo.slice(desde, hasta)), {
        'X-Unique-Upload-Id': id,
        'Content-Range': `bytes ${desde}-${hasta - 1}/${archivo.size}`
      });
      alAvanzar(hasta / archivo.size);
    }
    return respuesta;
  }

  let filaAchicar = Promise.resolve();

  // Achica una foto a 1920 px del lado más largo. Funciona en la página y en el ayudante
  // (OffscreenCanvas). Si no se puede o no ahorra nada, devuelve la original.
  async function achicarFoto(archivo) {
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type) || typeof createImageBitmap !== 'function') return archivo;
    let imagen;
    try { imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' }); } catch { return archivo; }
    try {
      const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
      if (escala === 1 && archivo.size < 1.5 * MB) return archivo; // ya es liviana
      const ancho = Math.round(imagen.width * escala);
      const alto = Math.round(imagen.height * escala);
      // PNG puede tener partes transparentes: va a WebP, que las conserva. Las fotos, a JPEG.
      const tipo = archivo.type === 'image/png' ? 'image/webp' : 'image/jpeg';
      const calidad = tipo === 'image/jpeg' ? 0.85 : 0.9;
      let blob;
      if (typeof OffscreenCanvas === 'function') {
        const lienzo = new OffscreenCanvas(ancho, alto);
        const ctx = lienzo.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(imagen, 0, 0, ancho, alto);
        blob = await lienzo.convertToBlob({ type: tipo, quality: calidad });
      } else if (typeof document !== 'undefined') {
        const lienzo = document.createElement('canvas');
        lienzo.width = ancho;
        lienzo.height = alto;
        const ctx = lienzo.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(imagen, 0, 0, ancho, alto);
        blob = await new Promise((r) => lienzo.toBlob(r, tipo, calidad));
      } else {
        return archivo;
      }
      if (!blob || blob.size >= archivo.size) return archivo;
      return blob;
    } catch {
      return archivo;
    } finally {
      if (imagen.close) imagen.close();
    }
  }

  async function subirImagen(t, pin, alAvanzar) {
    // Se achica de a una (una foto abierta ocupa mucha memoria); se suben de a 3.
    const turno = filaAchicar.then(() => achicarFoto(t.archivo));
    filaAchicar = turno.catch(() => {});
    const archivo = await turno;
    const nombre = (t.nombre || 'foto').replace(/\.[^.]+$/, '') + (archivo.type === 'image/webp' ? '.webp' : archivo.type === 'image/png' ? '.png' : archivo.type === 'image/gif' ? '.gif' : '.jpg');
    const firma = await pedirJson('/api/images/firma', pin, {});
    const subido = await subirACloudinary(firma.url, firma.campos, archivo, nombre, (f) => alAvanzar(f * 0.95))
      .catch((err) => {
        if (/format/i.test(err.message)) throw new Error('Ese formato no se puede subir: usá JPG, PNG, WEBP o GIF.');
        throw err;
      });
    await pedirJson('/api/images/registrar', pin, {
      public_id: subido.public_id || firma.campos.public_id,
      version: subido.version,
      signature: subido.signature,
      format: subido.format
    });
    alAvanzar(1);
  }

  // Canción o video (el video ya viene achicado por la página, si se pudo).
  async function subirMedio(t, pin, alAvanzar) {
    const firma = await pedirJson('/api/multimedia/firma', pin, { tipo: t.tipo, nombre: t.nombre, bytes: t.archivo.size });
    if (firma.modo === 'nube') {
      const subido = await subirACloudinary(firma.url, firma.campos, t.archivo, t.nombre, (f) => alAvanzar(f * 0.95));
      await pedirJson('/api/multimedia/registrar', pin, { public_id: subido.public_id || firma.campos.public_id });
    } else {
      const formulario = new FormData();
      formulario.append('tipo', t.tipo);
      formulario.append('duracion', String(t.duracion || 0));
      formulario.append('archivo', t.archivo, t.nombre);
      alAvanzar(0.05);
      await enviar(firma.url, formulario, { 'x-pin': pin });
    }
    alAvanzar(1);
  }

  global.SubirNube = {
    A_LA_VEZ: 3,
    subir(t, pin, alAvanzar) {
      return t.tipo === 'imagen' ? subirImagen(t, pin, alAvanzar) : subirMedio(t, pin, alAvanzar);
    }
  };
})(self);
