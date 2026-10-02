// Portero de registros: una clase entra entera; un programa que crea cuentas sin parar queda
// frenado, venga de una conexión o de muchas; la conexión del aula sigue registrando.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  revisarRegistro, anotarRegistro, anotarIngreso, definirConfianza,
  POR_MINUTO, POR_HORA, POR_DIA, TOTAL_POR_HORA, TOTAL_POR_DIA, VECES_VIP
} = require('../servidor/limite-registros');

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;

definirConfianza(nombre => nombre === 'Profe con fotos');

function registrar(ip, cantidad) {
  let aceptados = 0;
  for (let i = 0; i < cantidad; i++) {
    if (revisarRegistro(ip)) continue;
    anotarRegistro(ip);
    aceptados++;
  }
  return aceptados;
}

// Cada prueba arranca días más tarde, así no le quedan registros de la anterior.
let dia = 0;
function relojNuevo(t) {
  dia++;
  t.mock.timers.enable({ apis: ['Date'], now: dia * 10 * 24 * HORA });
}

test('una clase de 40 desde la misma conexión entra entera', (t) => {
  relojNuevo(t);
  assert.equal(registrar('aula', 40), 40);
  assert.equal(revisarRegistro('aula'), null);
});

test(`más de ${POR_MINUTO} en un minuto: espera hasta que pase el minuto`, (t) => {
  relojNuevo(t);
  assert.equal(registrar('bot-a', 500), POR_MINUTO);
  const freno = revisarRegistro('bot-a');
  assert.equal(freno.espera, MINUTO);
  assert.equal(freno.general, false);
  t.mock.timers.tick(MINUTO);
  assert.equal(revisarRegistro('bot-a'), null);
});

test(`una conexión: como mucho ${POR_HORA} por hora y ${POR_DIA} por día aunque vaya despacio`, (t) => {
  relojNuevo(t);
  let porHora = 0;
  for (let minuto = 0; minuto < 60; minuto++) { porHora += registrar('bot-b', 100); t.mock.timers.tick(MINUTO); }
  assert.equal(porHora, POR_HORA);
  let total = porHora;
  for (let hora = 1; hora < 12; hora++) {
    for (let minuto = 0; minuto < 60; minuto++) { total += registrar('bot-b', 100); t.mock.timers.tick(MINUTO); }
  }
  assert.equal(total, POR_DIA);
});

test(`muchas conexiones a la vez: en total como mucho ${TOTAL_POR_HORA} por hora`, (t) => {
  relojNuevo(t);
  let total = 0;
  for (let i = 0; i < 2000; i++) total += registrar('bot-red-' + i, 5);
  assert.equal(total, TOTAL_POR_HORA);
  const freno = revisarRegistro('alumno-con-datos-moviles');
  assert.equal(freno.general, true);
});

test('en pausa general, la conexión del aula (con la pantalla del profe) sigue registrando', (t) => {
  relojNuevo(t);
  for (let i = 0; i < 2000; i++) registrar('bot-red2-' + i, 5);
  assert.ok(revisarRegistro('wifi-aula'), 'sin la pantalla, también está en pausa');
  anotarIngreso('wifi-aula', { name: 'Bot sin fotos', isAdmin: false });
  assert.ok(revisarRegistro('wifi-aula'), 'entrar con una cuenta vacía no da confianza');
  anotarIngreso('wifi-aula', { name: 'Profe con fotos', isAdmin: false });
  assert.equal(registrar('wifi-aula', 40), 40);
});

test(`el tope total por día (${TOTAL_POR_DIA}) frena a un ataque que dura todo el día`, (t) => {
  relojNuevo(t);
  let total = 0;
  for (let hora = 0; hora < 24; hora++) {
    for (let i = 0; i < 400; i++) total += registrar(`bot-dia-${hora}-${i}`, 1);
    t.mock.timers.tick(HORA);
  }
  assert.equal(total, TOTAL_POR_DIA);
});

test(`la conexión VIP (escuela con la pantalla del profe) tiene topes ${VECES_VIP} veces más altos`, (t) => {
  relojNuevo(t);
  anotarIngreso('wifi-escuela', { name: 'Profe con fotos', isAdmin: false });
  assert.equal(registrar('wifi-escuela', 5000), POR_MINUTO * VECES_VIP);
});
