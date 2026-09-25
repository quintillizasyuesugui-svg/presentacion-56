// Límite de intentos de PIN: bloqueo corto al principio, que crece si se sigue fallando.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipDe, esperaDe, anotarFallo, mensajeDeEspera } = require('../servidor/limite-intentos');

const MINUTO = 60 * 1000;

function fallarDistintos(ip, cantidad, desde = 0) {
  for (let i = 0; i < cantidad; i++) anotarFallo(ip, String(1000 + desde + i));
}

test('5 PIN equivocados distintos bloquean 1 minuto; después se puede de nuevo', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  fallarDistintos('ip-a', 4);
  assert.equal(esperaDe('ip-a'), 0);
  fallarDistintos('ip-a', 1, 4);
  assert.equal(esperaDe('ip-a'), MINUTO);
  t.mock.timers.tick(MINUTO);
  assert.equal(esperaDe('ip-a'), 0);
});

test('si sigue fallando, la espera crece: 1, 2, 4, 8 y como mucho 15 minutos', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const esperas = [];
  for (let vez = 0; vez < 6; vez++) {
    fallarDistintos('ip-b', 5, vez * 5);
    const espera = esperaDe('ip-b');
    esperas.push(espera / MINUTO);
    t.mock.timers.tick(espera);
  }
  assert.deepEqual(esperas, [1, 2, 4, 8, 15, 15]);
});

test('tras una hora sin errores vuelve a empezar desde 1 minuto', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 9_000_000 });
  fallarDistintos('ip-c', 10);
  t.mock.timers.tick(2 * 60 * MINUTO);
  fallarDistintos('ip-c', 5, 50);
  assert.equal(esperaDe('ip-c'), MINUTO);
});

test('el mismo PIN viejo repetido cuenta una sola vez', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 20_000_000 });
  for (let i = 0; i < 50; i++) anotarFallo('ip-d', '4321');
  assert.equal(esperaDe('ip-d'), 0);
});

test('una IP bloqueada no afecta a otra', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 30_000_000 });
  fallarDistintos('ip-e', 5);
  assert.ok(esperaDe('ip-e') > 0);
  assert.equal(esperaDe('ip-f'), 0);
});

test('la IP es la última de X-Forwarded-For (la que agrega Render), no la que escribe el celular', () => {
  assert.equal(ipDe({ 'x-forwarded-for': '1.2.3.4, 200.10.10.10' }, '10.0.0.1'), '200.10.10.10');
  assert.equal(ipDe({}, '10.0.0.1'), '10.0.0.1');
});

test('el mensaje dice cuántos minutos esperar', () => {
  assert.match(mensajeDeEspera(MINUTO), /1 minuto\b/);
  assert.match(mensajeDeEspera(4 * MINUTO), /4 minutos/);
});
