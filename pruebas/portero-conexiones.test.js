// Portero de conexiones en tiempo real: tope de conexiones abiertas a la vez por IP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { entrarConexion, salirConexion, CONEXIONES_POR_IP } = require('../servidor/portero-pedidos');

test('una IP puede abrir hasta el tope de conexiones; la siguiente espera', () => {
  for (let i = 0; i < CONEXIONES_POR_IP; i++) assert.equal(entrarConexion('ip-conexiones-a'), true);
  assert.equal(entrarConexion('ip-conexiones-a'), false);
});

test('el tope de una IP no frena a otra', () => {
  assert.equal(entrarConexion('ip-conexiones-b'), true);
});

test('al cerrarse una conexión queda lugar para otra', () => {
  salirConexion('ip-conexiones-a');
  assert.equal(entrarConexion('ip-conexiones-a'), true);
  assert.equal(entrarConexion('ip-conexiones-a'), false);
});
