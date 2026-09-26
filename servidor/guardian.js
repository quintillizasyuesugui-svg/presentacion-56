// ---- 🛡️ Los 4 guardianes ----
// El servidor de Render gratis es chico y Cloudinary gratis deja hacer ~500 consultas por
// hora. Para que con muchos usuarios no se atore, cuatro guardianes vigilan cada uno lo suyo
// y anotan sus decisiones (con el motivo) para que el admin las vea en «Personas»:
//
//  👤 Usuarios: nadie acapara (tope por persona donde hace falta, turnos justos) y lleva la
//     cuenta de quién está conectado.
//  👷 Tareas: dirige a los «empleados» que suben imágenes (también las páginas de PDF y
//     documentos), música y videos. Trabajan en paralelo; cuando crece la fila contrata más,
//     hasta un máximo que el servidor aguanta, y cuando baja vuelven al mínimo. El próximo
//     turno es para quien menos tareas tiene en curso: nadie espera detrás de las 20
//     imágenes de otra persona.
//  📦 Almacenamiento: reparte el espacio según cuántas personas hay (multimedia.js), cuida
//     el cupo por hora de Cloudinary y explica por qué cuando a alguien no le alcanza.
//  📺 Pantallas: la música y los videos de cada persona van sólo a SU pantalla (salas por
//     dueño, en sockets.js), y frena a quien manda mensajes sin parar para que no tape a
//     los demás.

// minimo/maximo: empleados de ese tipo (tareas a la vez). Por cada «porCadaEnFila» tareas
// esperando se contrata uno más, hasta el máximo. porPersona: cuántas puede tener una persona
// entre en curso y en fila (null = sin tope: sólo espera su turno).
const LIMITES = {
  // Subir una imagen a Cloudinary: casi todo es esperar la red, aguanta muchos empleados.
  imagenes: { minimo: 4, maximo: 16, porCadaEnFila: 4, porPersona: null, enFila: 1000, esperaMaxMs: 5 * 60 * 1000 },
  // Comprobar en Cloudinary la música o el video que se subió (usa el cupo por hora de su API).
  nube: { minimo: 3, maximo: 8, porCadaEnFila: 3, porPersona: 3, enFila: 120, esperaMaxMs: 3 * 60 * 1000 },
  // Recibir un archivo en este servidor (sólo al probar en la PC, sin Cloudinary): usa disco y memoria.
  local: { minimo: 2, maximo: 3, porCadaEnFila: 4, porPersona: 2, enFila: 30, esperaMaxMs: 3 * 60 * 1000 },
  // Preguntarle a YouTube el título de un enlace.
  youtube: { minimo: 4, maximo: 10, porCadaEnFila: 3, porPersona: 3, enFila: 80, esperaMaxMs: 60 * 1000 }
};
const CUPO_NUBE_POR_HORA = Number(process.env.CUPO_NUBE_POR_HORA) || 400;
// Mensajes en tiempo real por conexión: de sobra para arrastrar una barra o escribir rápido.
const MENSAJES_POR_SEGUNDO = 30;
const HORA_MS = 60 * 60 * 1000;
const MAXIMO_DECISIONES = 80;

const GUARDIANES = {
  usuarios: { nombre: 'Usuarios', emoji: '👤' },
  tareas: { nombre: 'Tareas', emoji: '👷' },
  almacenamiento: { nombre: 'Almacenamiento', emoji: '📦' },
  pantallas: { nombre: 'Pantallas', emoji: '📺' }
};

class AvisoGuardian extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.guardian = true;
  }
}

const filas = {};
for (const tipo of Object.keys(LIMITES)) filas[tipo] = { activas: [], esperando: [] };
const usosNube = []; // momentos (ms) de cada consulta a la API de Cloudinary en la última hora
const decisiones = [];
const conectados = new Map(); // persona → cantidad de conexiones (celulares y pantallas)
const pantallasConSonido = new Map(); // persona → { pantalla, desde }

function anotar(guardian, persona, que, porque) {
  decisiones.unshift({ cuando: new Date().toISOString(), guardian, persona, que, porque });
  if (decisiones.length > MAXIMO_DECISIONES) decisiones.length = MAXIMO_DECISIONES;
}

function limpiarCupo() {
  const limite = Date.now() - HORA_MS;
  while (usosNube.length && usosNube[0] < limite) usosNube.shift();
}

function minutos(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m === 1 ? '1 minuto' : `${m} minutos`;
}

// ================= 👷 Tareas (y 👤 Usuarios para el tope por persona) =================

// Cuántas tareas de esa persona hay en ese tipo (activas + esperando).
function deLaPersona(tipo, persona) {
  const f = filas[tipo];
  return f.activas.filter(t => t.persona === persona).length + f.esperando.filter(t => t.persona === persona).length;
}

// Cuántos empleados trabajan ahora en ese tipo, según cuánta gente espera.
function empleadosAhora(tipo) {
  const lim = LIMITES[tipo];
  const f = filas[tipo];
  const cantidad = Math.min(lim.maximo, lim.minimo + Math.ceil(f.esperando.length / lim.porCadaEnFila));
  if (cantidad > (f.maximoAnotado || lim.minimo)) {
    anotar('tareas', '—', `contrató empleados para ${tipo}: ahora son ${cantidad}`, `había ${f.esperando.length} tareas esperando`);
    f.maximoAnotado = cantidad;
  }
  if (!f.activas.length && !f.esperando.length) f.maximoAnotado = lim.minimo; // volvió a la calma
  return cantidad;
}

function puedeEmpezar(tipo) {
  const f = filas[tipo];
  if (f.activas.length >= empleadosAhora(tipo)) return false;
  if (tipo === 'nube') {
    limpiarCupo();
    if (usosNube.length >= CUPO_NUBE_POR_HORA) return false;
  }
  return true;
}

// Por turnos: de lo que espera, primero lo de quien menos tareas tiene en curso (y entre
// iguales, lo que llegó antes).
function tomarTurno(f) {
  const enCurso = (persona) => f.activas.filter(t => t.persona === persona).length;
  let mejor = 0;
  for (let i = 1; i < f.esperando.length; i++) {
    if (enCurso(f.esperando[i].persona) < enCurso(f.esperando[mejor].persona)) mejor = i;
  }
  return f.esperando.splice(mejor, 1)[0];
}

function siguiente(tipo) {
  const f = filas[tipo];
  while (f.esperando.length && puedeEmpezar(tipo)) {
    const t = tomarTurno(f);
    clearTimeout(t.vence);
    empezar(tipo, t);
  }
  // Si lo que frena es el cupo por hora, se reintenta cuando se libere el más viejo.
  if (tipo === 'nube' && f.esperando.length && f.activas.length < empleadosAhora('nube') && usosNube.length) {
    setTimeout(() => siguiente('nube'), Math.max(1000, usosNube[0] + HORA_MS - Date.now())).unref();
  }
}

function empezar(tipo, t) {
  const f = filas[tipo];
  f.activas.push(t);
  if (tipo === 'nube') usosNube.push(Date.now());
  if (t.esperoDesde) {
    const segundos = Math.round((Date.now() - t.esperoDesde) / 1000);
    if (segundos >= 10) anotar('tareas', t.persona, `esperó ${segundos} s en la fila (${tipo})`, 'había muchas personas pidiendo lo mismo a la vez');
  }
  Promise.resolve()
    .then(t.tarea)
    .then(t.resolver, t.rechazar)
    .finally(() => {
      f.activas.splice(f.activas.indexOf(t), 1);
      siguiente(tipo);
    });
}

// Hace la tarea cuando le toque. Rechaza con AvisoGuardian (y su explicación) si la
// persona ya tiene demasiadas en curso, si la fila está llena o si esperó demasiado.
function enFila(tipo, persona, tarea) {
  const lim = LIMITES[tipo];
  const f = filas[tipo];
  if (lim.porPersona != null && deLaPersona(tipo, persona) >= lim.porPersona) {
    anotar('usuarios', persona, `no la dejó empezar otra (${tipo})`, `ya tenía ${lim.porPersona} en curso`);
    return Promise.reject(new AvisoGuardian(429, `🛡️ Ya tenés ${lim.porPersona} subidas en curso. Esperá a que terminen y seguí: así la fila avanza para todas las personas.`));
  }
  if (f.esperando.length >= lim.enFila) {
    anotar('tareas', persona, `fila llena (${tipo})`, `había ${f.esperando.length} esperando`);
    return Promise.reject(new AvisoGuardian(503, `🛡️ Ahora hay ${f.esperando.length} tareas en la fila. Probá de nuevo en un par de minutos.`));
  }
  return new Promise((resolver, rechazar) => {
    const t = { persona, tarea, resolver, rechazar };
    if (puedeEmpezar(tipo) && !f.esperando.length) return empezar(tipo, t);
    t.esperoDesde = Date.now();
    t.vence = setTimeout(() => {
      const i = f.esperando.indexOf(t);
      if (i === -1) return;
      f.esperando.splice(i, 1);
      const porCupo = tipo === 'nube' && usosNube.length >= CUPO_NUBE_POR_HORA;
      anotar(porCupo ? 'almacenamiento' : 'tareas', persona, `se cansó de esperar (${tipo})`, porCupo ? 'se acabó el cupo por hora de Cloudinary' : 'la fila no avanzaba');
      rechazar(new AvisoGuardian(503, porCupo
        ? `🛡️ Cloudinary gratis deja ${CUPO_NUBE_POR_HORA} subidas por hora y ya se usaron. Probá de nuevo en ${minutos(usosNube[0] + HORA_MS - Date.now())}; lo que subiste se borra solo si no llega a guardarse.`
        : '🛡️ Hay muchas personas subiendo a la vez y tu turno tardó demasiado. Probá de nuevo en un momento.'));
    }, lim.esperaMaxMs);
    t.vence.unref();
    f.esperando.push(t);
    siguiente(tipo); // si la fila creció, puede que ya haya un empleado más para atenderla
  });
}

// ================= 📦 Almacenamiento =================

// Explicación del espacio de una persona, para cuando no le alcanza o quiere saber.
function explicarEspacio({ usado, total, fijoMb, calculo }) {
  const mb = (b) => (Math.round((b / (1024 * 1024)) * 10) / 10).toLocaleString('es') + ' MB';
  if (fijoMb != null) {
    return `Tu espacio es de ${mb(total)} porque el admin te lo dejó fijo. Usaste ${mb(usado)}.`;
  }
  const { personas, presupuestoMb, minimoMb, maximoMb, mbPorPersona } = calculo;
  const gb = (presupuestoMb / 1000).toLocaleString('es');
  let porque;
  if (mbPorPersona >= maximoMb) porque = `hay pocas personas (${personas}), así que te toca el máximo`;
  else if (mbPorPersona <= minimoMb) porque = `hay muchas personas (${personas}), así que te toca el mínimo`;
  else porque = `hay ${personas} personas y los ${gb} GB para guardar se reparten entre todas`;
  let texto = `Tu espacio es de ${mb(total)} porque ${porque}. Usaste ${mb(usado)}.`;
  if (usado > total) texto += ' Como ahora hay más personas, te quedó menos espacio del que ya usás: no se borra nada, pero para subir algo nuevo tenés que liberar lugar.';
  return texto;
}

// ================= 👤 Usuarios: quién está conectado =================

function conectar(persona) {
  conectados.set(persona, (conectados.get(persona) || 0) + 1);
}

function desconectar(persona) {
  const n = (conectados.get(persona) || 0) - 1;
  if (n > 0) conectados.set(persona, n); else conectados.delete(persona);
}

// ================= 📺 Pantallas =================

// Un vigilante por conexión: deja pasar hasta MENSAJES_POR_SEGUNDO mensajes por segundo y
// frena el resto (una sola vez anota a quién y por qué).
function vigilanteDeMensajes() {
  let ventana = Date.now();
  let cuenta = 0;
  let avisado = false;
  return function permitir(persona) {
    const ahora = Date.now();
    if (ahora - ventana >= 1000) { ventana = ahora; cuenta = 0; avisado = false; }
    cuenta++;
    if (cuenta <= MENSAJES_POR_SEGUNDO) return true;
    if (!avisado) {
      avisado = true;
      anotar('pantallas', persona || 'sin identificar', 'frenó mensajes de más', `mandaba más de ${MENSAJES_POR_SEGUNDO} por segundo`);
    }
    return false;
  };
}

// La pantalla donde se tocó «Permitir sonido» se queda con el sonido de esa persona.
function pantallaConSonido(persona, pantalla) {
  const antes = pantallasConSonido.get(persona);
  if (antes && antes.pantalla !== pantalla) {
    anotar('pantallas', persona, 'pasó el sonido a otra pantalla', 'se permitió el sonido en otra pantalla de la misma persona; la anterior se calla para que no haya eco');
  }
  pantallasConSonido.set(persona, { pantalla, desde: new Date().toISOString() });
}

// ================= Simulacro (sólo el admin, para verlos trabajar) =================
// 20 personas de mentira piden 60 tareas de imagen a la vez (cada una espera 1 a 3 s, no sube
// nada) y una más intenta acaparar enlaces de YouTube. Se ve cómo se contratan empleados,
// cómo reparten por turnos, a quién frenan y cómo vuelven al mínimo. No toca datos reales.
let simulacroEnCurso = false;
function simulacro() {
  if (simulacroEnCurso) return false;
  simulacroEnCurso = true;
  anotar('tareas', '—', 'empezó un simulacro', 'el admin quiso ver a los guardianes trabajar');
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const tareas = [];
  for (let i = 0; i < 60; i++) {
    const persona = `Simulacro ${(i % 20) + 1}`;
    tareas.push(enFila('imagenes', persona, () => esperar(1000 + Math.random() * 2000)).catch(() => {}));
  }
  for (let i = 0; i < 5; i++) {
    tareas.push(enFila('youtube', 'Simulacro acaparador', () => esperar(2500)).catch(() => {}));
  }
  Promise.all(tareas).then(() => {
    simulacroEnCurso = false;
    anotar('tareas', '—', 'terminó el simulacro', 'se atendieron todas las tareas y los empleados volvieron al mínimo');
  });
  return true;
}

// ================= Resumen para el admin =================

function estadoGuardian() {
  limpiarCupo();
  const porTipo = {};
  for (const [tipo, f] of Object.entries(filas)) {
    porTipo[tipo] = {
      trabajando: f.activas.map(t => t.persona),
      esperando: f.esperando.map(t => t.persona),
      empleados: empleadosAhora(tipo),
      minimo: LIMITES[tipo].minimo,
      maximo: LIMITES[tipo].maximo
    };
  }
  return {
    guardianes: GUARDIANES,
    usuarios: { conectados: [...conectados.keys()].sort((a, b) => a.localeCompare(b, 'es')) },
    tareas: porTipo,
    almacenamiento: { cupoNube: { usado: usosNube.length, limite: CUPO_NUBE_POR_HORA } },
    pantallas: { conSonido: pantallasConSonido.size, mensajesPorSegundo: MENSAJES_POR_SEGUNDO },
    simulacro: simulacroEnCurso,
    decisiones
  };
}

module.exports = {
  enFila,
  anotar,
  explicarEspacio,
  estadoGuardian,
  empleadosAhora,
  simulacro,
  conectar,
  desconectar,
  vigilanteDeMensajes,
  pantallaConSonido,
  AvisoGuardian,
  LIMITES,
  GUARDIANES
};
