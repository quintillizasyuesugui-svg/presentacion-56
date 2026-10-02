// ---- Invitaciones de clase ----
// Un profesor con sesión en la pantalla (y con alguna foto subida, o el admin) puede activar una
// invitación: la pantalla muestra un QR y un código como «TIGRE-4821». Quien se registra con ese
// código no pasa por los topes de registros por conexión ni por el tope general: así entran
// miles de alumnos a la vez, desde cualquier escuela o con datos del celular. Los bots no ven la
// pantalla del aula, y probar códigos al azar cuenta para el portero igual que un registro.
// Cada invitación vence a las 3 horas y acepta como mucho POR_HORA registros por hora, por si
// alguien publica el código en internet: si el contador de la pantalla sube raro, el profesor
// apaga y prende el interruptor y sale un código nuevo. Viven en memoria: si el servidor se
// reinicia, la pantalla vuelve a pedir una sola (ver pantalla.js).
const crypto = require('crypto');

const DURACION_MS = 3 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const POR_HORA = Number(process.env.INVITACION_POR_HORA) || 2000;
const PALABRAS = [
  'TIGRE', 'LEON', 'PUMA', 'ZORRO', 'LOBO', 'OSO', 'COLIBRI', 'CONDOR', 'DELFIN', 'BALLENA',
  'PINGUINO', 'JAGUAR', 'TUCAN', 'LLAMA', 'CEBRA', 'JIRAFA', 'KOALA', 'PANDA', 'HALCON', 'BUHO',
  'CASTOR', 'NUTRIA', 'GACELA', 'FOCA', 'PULPO', 'TORTUGA', 'CANGURO', 'LINCE', 'BISONTE', 'CARPINCHO'
];

const porCodigo = new Map(); // código → { codigo, dueno, vence, registrados, usos: [Date.now()...] }
const porDueno = new Map();  // nombre → código

function vigente(inv, ahora = Date.now()) {
  return Boolean(inv && inv.vence > ahora);
}

function nuevoCodigo() {
  for (;;) {
    const codigo = PALABRAS[crypto.randomInt(PALABRAS.length)] + '-' + crypto.randomInt(1000, 10000);
    if (!porCodigo.has(codigo)) return codigo;
  }
}

// Escrito a mano puede venir en minúsculas, con espacios o sin el guion.
function normalizar(codigo) {
  const limpio = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = limpio.match(/^([A-Z]+)(\d{4})$/);
  return m ? m[1] + '-' + m[2] : '';
}

function deDueno(nombre) {
  const inv = porCodigo.get(porDueno.get(nombre));
  return vigente(inv) ? inv : null;
}

function activar(nombre) {
  const actual = deDueno(nombre);
  if (actual) return actual;
  apagar(nombre);
  const inv = { codigo: nuevoCodigo(), dueno: nombre, vence: Date.now() + DURACION_MS, registrados: 0, usos: [] };
  porCodigo.set(inv.codigo, inv);
  porDueno.set(nombre, inv.codigo);
  return inv;
}

function apagar(nombre) {
  const codigo = porDueno.get(nombre);
  if (codigo) porCodigo.delete(codigo);
  porDueno.delete(nombre);
}

// La invitación de ese código si sirve ahora, o un motivo para decirle a la persona.
function revisar(codigo) {
  const inv = porCodigo.get(normalizar(codigo));
  if (!vigente(inv)) return { error: 'Ese código de invitación no existe o ya venció. Fijate en la pantalla del aula.' };
  const ahora = Date.now();
  inv.usos = inv.usos.filter(t => ahora - t < HORA);
  if (inv.usos.length >= POR_HORA) {
    return { error: 'Esta invitación ya registró muchas cuentas en la última hora. Pedile al profesor un código nuevo.' };
  }
  return { inv };
}

function anotarUso(inv) {
  inv.usos.push(Date.now());
  inv.registrados++;
}

// Lo que ve la pantalla: código, cuándo vence y cuántos se registraron.
function resumen(inv) {
  return inv ? { activa: true, codigo: inv.codigo, vence: inv.vence, registrados: inv.registrados } : { activa: false };
}

setInterval(() => {
  const ahora = Date.now();
  for (const [codigo, inv] of porCodigo) {
    if (!vigente(inv, ahora)) {
      porCodigo.delete(codigo);
      if (porDueno.get(inv.dueno) === codigo) porDueno.delete(inv.dueno);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = { activar, apagar, deDueno, revisar, anotarUso, resumen, normalizar, POR_HORA };
