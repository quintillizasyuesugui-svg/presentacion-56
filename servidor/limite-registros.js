// Portero de registros: cuántas cuentas nuevas se aceptan.
//
// Por conexión (IP): como mucho REGISTRO_POR_MINUTO por minuto, REGISTRO_POR_HORA por hora y
// REGISTRO_POR_DIA por día. Una clase entera registrándose a la vez (todos salen con la misma
// IP) entra sin esperar; un programa que manda miles de registros queda frenado.
//
// En total, sumando las conexiones desconocidas: como mucho REGISTRO_TOTAL_POR_HORA por hora y
// REGISTRO_TOTAL_POR_DIA por día. Frena a quien ataca desde muchas conexiones a la vez, para
// que no llene la base ni agote los PIN. Las conexiones de confianza (desde donde entró el
// admin o alguien que ya subió algo, como la pantalla del aula) no cuentan para este tope y
// siguen registrando aunque esté en pausa: un bot no tiene fotos subidas. Además tienen topes
// por conexión VECES_VIP veces más altos, para que una escuela entera (todos con la misma IP)
// pueda registrarse junta. Con código de invitación no se pasa por este portero (personas.js).
//
// Para la prueba de carga contra Render se pueden subir estos números en Environment.
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const POR_MINUTO = Number(process.env.REGISTRO_POR_MINUTO) || 60;
const POR_HORA = Number(process.env.REGISTRO_POR_HORA) || 300;
const POR_DIA = Number(process.env.REGISTRO_POR_DIA) || 500;
const TOTAL_POR_HORA = Number(process.env.REGISTRO_TOTAL_POR_HORA) || 300;
const TOTAL_POR_DIA = Number(process.env.REGISTRO_TOTAL_POR_DIA) || 1000;
const VECES_VIP = Number(process.env.REGISTRO_VECES_VIP) || 10;
const CONFIANZA_MS = 12 * HORA;

const porIp = new Map();      // ip → horarios (Date.now()) de sus registros del último día
let desconocidos = [];        // horarios de los registros del último día desde conexiones desconocidas
const confiables = new Map(); // ip → última vez que entró desde ahí alguien de confianza
let esDeConfianza = (persona) => Boolean(persona && persona.isAdmin);

// diapositivas.js avisa cómo saber si alguien ya subió algo (así no se importan entre sí).
function definirConfianza(fn) {
  esDeConfianza = (persona) => Boolean(persona && (persona.isAdmin || fn(persona.name)));
}

// Se llama cada vez que alguien entra con su PIN desde esa conexión.
// Pasa en cada pedido con PIN: si ya se confirmó hace menos de 10 minutos, no se vuelve a revisar.
function anotarIngreso(ip, persona) {
  const vez = confiables.get(ip);
  if (vez && Date.now() - vez < 10 * MINUTO) return;
  if (esDeConfianza(persona)) confiables.set(ip, Date.now());
}

function conexionConfiable(ip) {
  const vez = confiables.get(ip);
  return Boolean(vez && Date.now() - vez < CONFIANZA_MS);
}

function delUltimoDia(lista, ahora) {
  return lista.filter(t => ahora - t < DIA);
}

// Lo que falta esperar para cumplir «como mucho `tope` en `ventana`» (0 = puede ya).
function esperaPorTope(lista, tope, ventana, ahora) {
  const dentro = lista.filter(t => ahora - t < ventana);
  return dentro.length >= tope ? dentro[dentro.length - tope] + ventana - ahora : 0;
}

// null si puede registrar ya; si no, { espera (ms), general (true = pausa por el tope total) }.
function revisarRegistro(ip) {
  const ahora = Date.now();
  const propios = delUltimoDia(porIp.get(ip) || [], ahora);
  const vip = conexionConfiable(ip);
  const veces = vip ? VECES_VIP : 1;
  const espera = Math.max(
    esperaPorTope(propios, POR_MINUTO * veces, MINUTO, ahora),
    esperaPorTope(propios, POR_HORA * veces, HORA, ahora),
    esperaPorTope(propios, POR_DIA * veces, DIA, ahora)
  );
  if (espera > 0) return { espera, general: false };
  if (vip) return null;
  desconocidos = delUltimoDia(desconocidos, ahora);
  const esperaGeneral = Math.max(
    esperaPorTope(desconocidos, TOTAL_POR_HORA, HORA, ahora),
    esperaPorTope(desconocidos, TOTAL_POR_DIA, DIA, ahora)
  );
  return esperaGeneral > 0 ? { espera: esperaGeneral, general: true } : null;
}

function anotarRegistro(ip) {
  const ahora = Date.now();
  const propios = delUltimoDia(porIp.get(ip) || [], ahora);
  propios.push(ahora);
  porIp.set(ip, propios);
  if (!conexionConfiable(ip)) desconocidos.push(ahora);
}

function tiempo(ms) {
  if (ms >= HORA) {
    const horas = Math.ceil(ms / HORA);
    return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  }
  const minutos = Math.ceil(ms / MINUTO);
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
}

function mensajeRegistro({ espera, general }) {
  if (general) {
    return `Ahora hay demasiados registros y está en pausa (unos ${tiempo(espera)}). ` +
      'Si estás en el aula, conectate al mismo WiFi que la pantalla de la presentación y probá de nuevo.';
  }
  return `Se crearon muchas cuentas desde esta conexión. Esperá ${tiempo(espera)} y probá de nuevo.`;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [ip, lista] of porIp) {
    const quedan = delUltimoDia(lista, ahora);
    if (quedan.length) porIp.set(ip, quedan); else porIp.delete(ip);
  }
  desconocidos = delUltimoDia(desconocidos, ahora);
  for (const [ip, vez] of confiables) if (ahora - vez >= CONFIANZA_MS) confiables.delete(ip);
}, 10 * MINUTO).unref();

// Si esa persona puede activar invitaciones (admin o alguien con fotos subidas).
function puedeInvitar(persona) {
  return esDeConfianza(persona);
}

module.exports = {
  puedeInvitar, conexionConfiable, VECES_VIP,
  revisarRegistro, anotarRegistro, mensajeRegistro, anotarIngreso, definirConfianza,
  POR_MINUTO, POR_HORA, POR_DIA, TOTAL_POR_HORA, TOTAL_POR_DIA
};
