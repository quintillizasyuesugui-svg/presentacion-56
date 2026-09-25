// Guardado de los datos de la app: personas, orden de las diapositivas, frases finales y
// avance automático.
//
// Se leen una sola vez al arrancar (iniciarAlmacenes) y quedan en memoria: leer no toca el
// disco ni la red. Cada cambio pasa por modificar(), de a uno por almacén, así dos pedidos
// al mismo tiempo no se pisan (antes los dos leían, cambiaban, y el último en escribir
// borraba lo del otro).
//
// Dónde queda guardado:
//  - Con DATABASE_URL (Postgres): una tabla por almacén, y en cada cambio se escriben sólo
//    las filas que cambiaron. La primera vez se copian ahí los datos de siempre (archivo o
//    respaldo de Cloudinary); esos no se borran.
//  - Sin DATABASE_URL: datos/<archivo>.json, como siempre.
// En los dos casos queda además un respaldo en Cloudinary, unos segundos después del último
// cambio. Ese respaldo es privado (tipo «authenticated»: sólo se baja con la firma del
// servidor). Antes era público y cualquiera que viera la dirección de una imagen podía bajar
// la lista de personas; al arrancar, la copia pública se pasa a privada y se borra.
const fs = require('fs').promises;
const path = require('path');
const { RAIZ, CARPETA_DATOS, cloudinary, nubeLista } = require('./configuracion');
const baseDatos = require('./base-datos');

const ESPERA_RESPALDO_MS = Number(process.env.ESPERA_RESPALDO_MS) || 5000;
const FILAS_POR_CONSULTA = 200;
const INTENTOS_AL_LEER = 3;
// Lo devuelve la función de modificar() cuando al final no hay nada que guardar.
const SIN_CAMBIOS = Symbol('sin cambios');

const almacenes = [];
let db = null;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function errorDeNube(err) {
  return (err && err.error && err.error.message) || (err && err.message) || String(err);
}

// tabla: { nombre, clave, columnas: { columna: 'TIPO SQL' }, ordenada, aFila(registro), deFila(fila) }
//   ordenada: agrega la columna «posicion» para conservar el orden (las diapositivas).
//   Las columnas JSONB se pasan a texto al escribir y se leen ya convertidas.
function crearAlmacen({ archivo, archivoViejo, idNube, elQue, tabla, valorInicial, normalizar }) {
  const ruta = path.join(CARPETA_DATOS, archivo);
  const rutaVieja = archivoViejo ? path.join(RAIZ, archivoViejo) : null;
  const columnas = [...Object.keys(tabla.columnas), ...(tabla.ordenada ? ['posicion'] : [])];
  const columnasJson = new Set(Object.keys(tabla.columnas).filter(c => /JSONB/i.test(tabla.columnas[c])));
  const marcaMigracion = 'almacen:' + tabla.nombre;

  let datos = null;               // lo guardado ahora; desde afuera sólo se lee
  let filasGuardadas = new Map(); // clave → fila en texto, para escribir sólo lo que cambió
  let fila = Promise.resolve();
  let temporizador = null;
  let respaldoEnCurso = Promise.resolve();

  // ---- Base de datos ----
  function filaDe(registro, posicion) {
    const f = tabla.aFila(registro);
    if (tabla.ordenada) f.posicion = posicion;
    for (const c of columnasJson) f[c] = f[c] == null ? null : JSON.stringify(f[c]);
    return f;
  }
  const enTexto = (f) => JSON.stringify(columnas.map(c => f[c] ?? null));

  function registroDe(f) {
    const copia = { ...f };
    for (const c of columnasJson) if (typeof copia[c] === 'string') copia[c] = JSON.parse(copia[c]);
    return tabla.deFila(copia);
  }

  async function guardarFilas(q, nuevos) {
    const nuevas = new Map();
    nuevos.forEach((r, i) => { const f = filaDe(r, i); nuevas.set(f[tabla.clave], f); });
    const borrar = [...filasGuardadas.keys()].filter(k => !nuevas.has(k));
    const cambiadas = [...nuevas.values()].filter(f => filasGuardadas.get(f[tabla.clave]) !== enTexto(f));
    for (let i = 0; i < borrar.length; i += FILAS_POR_CONSULTA) {
      const trozo = borrar.slice(i, i + FILAS_POR_CONSULTA);
      await q(`DELETE FROM ${tabla.nombre} WHERE ${tabla.clave} IN (${trozo.map((_, j) => '$' + (j + 1)).join(', ')})`, trozo);
    }
    const actualizar = columnas.filter(c => c !== tabla.clave).map(c => `${c} = EXCLUDED.${c}`).join(', ');
    for (let i = 0; i < cambiadas.length; i += FILAS_POR_CONSULTA) {
      const valores = [];
      const grupos = cambiadas.slice(i, i + FILAS_POR_CONSULTA).map(f => '(' + columnas.map(c => {
        valores.push(f[c] ?? null);
        return '$' + valores.length + (columnasJson.has(c) ? '::jsonb' : '');
      }).join(', ') + ')');
      await q(`INSERT INTO ${tabla.nombre} (${columnas.join(', ')}) VALUES ${grupos.join(', ')}
        ON CONFLICT (${tabla.clave}) DO ${actualizar ? 'UPDATE SET ' + actualizar : 'NOTHING'}`, valores);
    }
    return new Map([...nuevas].map(([k, f]) => [k, enTexto(f)]));
  }

  // ---- Archivo local ----
  async function leerArchivo(r) {
    try {
      return JSON.parse(await fs.readFile(r, 'utf8'));
    } catch {
      return null; // no existe o está dañado
    }
  }

  async function escribirArchivo(nuevos) {
    await fs.mkdir(CARPETA_DATOS, { recursive: true });
    const texto = JSON.stringify(nuevos, null, 2);
    const temporal = ruta + '.tmp';
    await fs.writeFile(temporal, texto);
    // Se escribe aparte y se reemplaza de una: si el servidor se corta a mitad, el archivo no queda roto.
    await fs.rename(temporal, ruta).catch(() => fs.writeFile(ruta, texto));
  }

  // ---- Respaldo en Cloudinary ----
  // Devuelve los datos, null si no existe, o tira error si Cloudinary no responde (así no se
  // arranca con la lista vacía y se pisa el respaldo bueno).
  async function bajarPrivado() {
    let recurso;
    try {
      recurso = await cloudinary.api.resource(idNube, { resource_type: 'raw', type: 'authenticated' });
    } catch (err) {
      if (err && err.error && err.error.http_code === 404) return null;
      throw new Error(errorDeNube(err));
    }
    const url = cloudinary.url(idNube, { resource_type: 'raw', type: 'authenticated', sign_url: true, secure: true, version: recurso.version });
    const res = await fetch(url);
    if (!res.ok) throw new Error('Cloudinary respondió ' + res.status);
    return res.json();
  }

  // La copia pública de antes (resource_type raw, type upload).
  async function bajarPublico() {
    const res = await fetch(cloudinary.url(idNube, { resource_type: 'raw', secure: true }) + `?t=${Date.now()}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Cloudinary respondió ' + res.status);
    return res.json();
  }

  async function subirRespaldo() {
    const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(datos)).toString('base64');
    await cloudinary.uploader.upload(dataUri, {
      public_id: idNube, resource_type: 'raw', type: 'authenticated', overwrite: true, invalidate: true
    });
  }

  function respaldarAhora() {
    respaldoEnCurso = respaldoEnCurso.then(subirRespaldo)
      .catch((err) => console.error(`No se pudo respaldar ${elQue} en Cloudinary:`, errorDeNube(err)));
    return respaldoEnCurso;
  }

  // Varios cambios seguidos se juntan en un solo respaldo.
  function programarRespaldo() {
    if (!nubeLista || temporizador) return;
    temporizador = setTimeout(() => { temporizador = null; respaldarAhora(); }, ESPERA_RESPALDO_MS);
  }

  // Al apagar el servidor: sube ya el respaldo pendiente.
  async function vaciarRespaldo() {
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
      respaldarAhora();
    }
    await respaldoEnCurso;
  }

  // Si todavía existe la copia pública de antes: deja una privada, comprueba que se lea bien
  // y recién ahí borra la pública.
  async function pasarRespaldoAPrivado() {
    if (!nubeLista) return;
    try {
      const publico = await bajarPublico();
      const privado = await bajarPrivado();
      if (publico === null && privado !== null) return;
      await subirRespaldo();
      const copia = await bajarPrivado();
      if (JSON.stringify(copia) !== JSON.stringify(datos)) throw new Error('la copia privada no coincide');
      if (publico !== null) {
        await cloudinary.uploader.destroy(idNube, { resource_type: 'raw', type: 'upload', invalidate: true });
        console.log(`🔒 Respaldo de ${elQue}: la copia pública se pasó a privada.`);
      }
    } catch (err) {
      console.error(`No se pudo pasar a privado el respaldo de ${elQue}:`, errorDeNube(err));
    }
  }

  // ---- Carga al arrancar ----
  // Sin base de datos (o la primera vez con ella): archivo local, archivo viejo de la raíz,
  // respaldo privado y, por último, la copia pública de antes.
  async function leerSinBase() {
    const local = (await leerArchivo(ruta)) || (rutaVieja && await leerArchivo(rutaVieja));
    if (local || !nubeLista) return local;
    for (let intento = 1; ; intento++) {
      try {
        return (await bajarPrivado()) ?? (await bajarPublico());
      } catch (err) {
        if (intento >= INTENTOS_AL_LEER) throw new Error(`No se pudo leer el respaldo de ${elQue} en Cloudinary: ${errorDeNube(err)}`);
        await esperar(2000 * intento);
      }
    }
  }

  async function cargar() {
    let cargados;
    let importar = false;
    if (db) {
      const definicion = Object.entries(tabla.columnas).map(([c, tipo]) => `${c} ${tipo}`).join(', ');
      await db.consulta(`CREATE TABLE IF NOT EXISTS ${tabla.nombre} (${definicion}${tabla.ordenada ? ', posicion INTEGER NOT NULL' : ''})`);
      const migrada = await db.consulta('SELECT 1 FROM migraciones WHERE nombre = $1', [marcaMigracion]);
      if (migrada.length) {
        const filas = await db.consulta(`SELECT * FROM ${tabla.nombre} ORDER BY ${tabla.ordenada ? 'posicion' : tabla.clave}`);
        cargados = filas.map(registroDe);
        filasGuardadas = new Map(cargados.map((r, i) => { const f = filaDe(r, i); return [f[tabla.clave], enTexto(f)]; }));
      } else {
        cargados = await leerSinBase();
        importar = true;
      }
    } else {
      cargados = await leerSinBase();
    }
    if (!Array.isArray(cargados)) cargados = valorInicial ? await valorInicial() : [];
    const antes = JSON.stringify(cargados);
    if (normalizar) cargados = await normalizar(cargados);
    const cambio = JSON.stringify(cargados) !== antes;

    if (importar) {
      filasGuardadas = new Map();
      filasGuardadas = await db.transaccion(async (q) => {
        await q(`DELETE FROM ${tabla.nombre}`);
        const guardadas = await guardarFilas(q, cargados);
        await q('INSERT INTO migraciones (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [marcaMigracion]);
        return guardadas;
      });
      console.log(`🗄️  Copiado a la base de datos: ${elQue} (${cargados.length}).`);
    } else if (cambio) {
      if (db) filasGuardadas = await db.transaccion(q => guardarFilas(q, cargados));
      else await escribirArchivo(cargados);
    }
    datos = cargados;
    if (cambio) programarRespaldo();
  }

  // ---- Uso desde el resto del servidor ----
  function comprobarCargado() {
    if (!datos) throw new Error(`Los datos de ${elQue} todavía no se cargaron (falta iniciarAlmacenes).`);
  }

  // Los datos actuales, sin copiar: sólo para leer, nunca modificarlos.
  function actual() {
    comprobarCargado();
    return datos;
  }

  // Una copia que se puede cambiar libremente.
  function leer() {
    return structuredClone(actual());
  }

  // cambiar(copia) cambia la copia (o devuelve una lista nueva, o SIN_CAMBIOS). Se guarda y
  // recién ahí pasa a ser lo actual; si guardar falla, no cambia nada. Devuelve los datos nuevos.
  function modificar(cambiar) {
    const tarea = async () => {
      comprobarCargado();
      const copia = structuredClone(datos);
      const resultado = await cambiar(copia);
      if (resultado === SIN_CAMBIOS) return datos;
      const nuevos = resultado === undefined ? copia : resultado;
      if (db) filasGuardadas = await db.transaccion(q => guardarFilas(q, nuevos));
      else await escribirArchivo(nuevos);
      datos = nuevos;
      programarRespaldo();
      return datos;
    };
    const resultado = fila.then(tarea, tarea);
    fila = resultado.catch(() => {});
    return resultado;
  }

  const almacen = { actual, leer, modificar, cargar, pasarRespaldoAPrivado, vaciarRespaldo };
  almacenes.push(almacen);
  return almacen;
}

// Conecta la base de datos (si hay) y carga todos los almacenes. Llamarlo antes de atender pedidos.
async function iniciarAlmacenes() {
  db = await baseDatos.conectar();
  for (const almacen of almacenes) await almacen.cargar();
  for (const almacen of almacenes) await almacen.pasarRespaldoAPrivado();
  console.log(db ? '🗄️  Datos guardados en la base de datos (Postgres).' : '📁 Datos guardados en archivos (datos/). Para usar Postgres, definí DATABASE_URL.');
}

async function vaciarRespaldos() {
  await Promise.all(almacenes.map(a => a.vaciarRespaldo()));
}

// La conexión a Postgres ya abierta (o null): la usan los documentos en proceso.
function baseDeDatos() {
  return db;
}

module.exports = { crearAlmacen, iniciarAlmacenes, vaciarRespaldos, baseDeDatos, SIN_CAMBIOS };
