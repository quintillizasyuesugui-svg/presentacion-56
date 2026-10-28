// Ayudante de subidas (service worker). Las páginas le pasan los archivos y él los sube de a 3
// por vez, aunque la persona se vaya a otra pantalla de Conexiones (Control, Música, etc.).
// Cada página abierta recibe el avance y lo muestra en la barra de arriba (subidas-fondo.js).
// Si se cierra el navegador del todo, lo que faltaba se corta.
importScripts('/scripts/subir-nube.js');

const A_LA_VEZ = SubirNube.A_LA_VEZ;
const MAXIMO_GUARDADOS = 300;
let trabajos = [];   // { id, tipo, nombre, archivo, duracion, estado, avance, error, pin }
let siguiente = 1;
let tanda = null;    // promesa mientras hay algo subiendo
let ultimoAviso = 0;
let avisoPendiente = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function resumen() {
  return {
    tipo: 'estado',
    trabajos: trabajos.map(({ id, tipo, nombre, estado, avance, error }) => ({ id, tipo, nombre, estado, avance, error }))
  };
}

async function avisarATodos(mensaje) {
  const paginas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const p of paginas) p.postMessage(mensaje);
}

// El avance se avisa como mucho 4 veces por segundo; los cambios de estado, enseguida.
function avisarEstado(ya) {
  const ahora = Date.now();
  if (ya || ahora - ultimoAviso > 250) {
    ultimoAviso = ahora;
    clearTimeout(avisoPendiente);
    avisoPendiente = null;
    return avisarATodos(resumen());
  }
  if (!avisoPendiente) avisoPendiente = setTimeout(() => avisarEstado(true), 260);
}

async function trabajar() {
  for (;;) {
    const t = trabajos.find((x) => x.estado === 'espera');
    if (!t) return;
    t.estado = 'subiendo';
    t.avance = 0;
    avisarEstado(true);
    try {
      await SubirNube.subir(t, t.pin, (f) => { t.avance = f; avisarEstado(false); });
      t.estado = 'listo';
      t.avance = 1;
    } catch (err) {
      t.estado = 'error';
      t.error = (err && err.message) || 'No se pudo subir.';
    }
    t.archivo = null; // ya no hace falta: se libera la memoria
    t.pin = null;
    avisarEstado(true);
    avisarATodos({ tipo: 'termino', id: t.id, trabajo: t.tipo, estado: t.estado });
  }
}

const hastaMinutos = (promesa, minutos) => Promise.race([promesa, new Promise((listo) => setTimeout(listo, minutos * 60000))]);

function procesar() {
  if (!tanda) {
    tanda = Promise.all(Array.from({ length: A_LA_VEZ }, trabajar)).finally(() => {
      tanda = null;
      avisarEstado(true);
    });
  }
  return tanda;
}

self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.tipo === 'encolar') {
    // Al empezar una tanda nueva se olvidan las que ya terminaron bien.
    if (!trabajos.some((t) => t.estado === 'espera' || t.estado === 'subiendo')) trabajos = trabajos.filter((t) => t.estado === 'error');
    for (const t of m.trabajos || []) {
      trabajos.push({ id: siguiente++, tipo: t.tipo, nombre: t.nombre, archivo: t.archivo, duracion: t.duracion, estado: 'espera', avance: 0, error: '', pin: m.pin });
    }
    if (trabajos.length > MAXIMO_GUARDADOS) trabajos = trabajos.slice(-MAXIMO_GUARDADOS);
    avisarEstado(true);
    // Chrome apaga al ayudante si un aviso tarda más de 5 minutos: cada uno espera hasta 4
    // y las páginas abiertas lo despiertan de nuevo cada 20 s (ver «estado»).
    e.waitUntil(hastaMinutos(procesar(), 4));
  } else if (m.tipo === 'estado') {
    // Las páginas abiertas preguntan cada tanto: eso también mantiene despierto al ayudante.
    e.source && e.source.postMessage(resumen());
    if (tanda) e.waitUntil(hastaMinutos(tanda, 1));
  } else if (m.tipo === 'olvidar') {
    trabajos = trabajos.filter((t) => t.estado === 'espera' || t.estado === 'subiendo');
    avisarEstado(true);
  }
});
