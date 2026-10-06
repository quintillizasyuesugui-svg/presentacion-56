const { test } = require('node:test');
const assert = require('node:assert');
const { limpiarDireccion, tituloDe, limpiarOrdenWeb } = require('../servidor/validadores-pagina');

test('acepta direcciones http y https y completa la que viene sin https://', () => {
  assert.strictEqual(limpiarDireccion('https://nasa-cell.github.io/eco-cafe/'), 'https://nasa-cell.github.io/eco-cafe/');
  assert.strictEqual(limpiarDireccion('  nasa-cell.github.io/eco-cafe  '), 'https://nasa-cell.github.io/eco-cafe');
  assert.strictEqual(limpiarDireccion('http://localhost:3470/index.html'), 'http://localhost:3470/index.html');
});

test('rechaza lo que no es una página web', () => {
  for (const mala of ['', '   ', 'hola', 'javascript:alert(1)', 'data:text/html,<p>x</p>', 'file:///C:/x.html',
    'ftp://sitio.com/a', 'https://usuario:clave@sitio.com/', 'https://sitio .com', 'https://' + 'a'.repeat(600) + '.com', null, 42, {}]) {
    assert.strictEqual(limpiarDireccion(mala), null, String(mala));
  }
});

test('arma un nombre corto para la lista', () => {
  assert.strictEqual(tituloDe('https://www.nasa-cell.github.io/eco-cafe/'), 'nasa-cell.github.io/eco-cafe');
  assert.strictEqual(tituloDe('https://mi-pagina.com/'), 'mi-pagina.com');
  assert.ok(tituloDe('https://sitio.com/' + 'a'.repeat(200)).length <= 60);
});

test('órdenes del espejo: deja pasar sólo lo esperado', () => {
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'clic', ruta: 'body > nav:nth-of-type(1) > a:nth-of-type(3)', navega: true, otro: 1 }),
    { accion: 'clic', ruta: 'body > nav:nth-of-type(1) > a:nth-of-type(3)', navega: true });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'clic', ruta: '#boton' }), { accion: 'clic', ruta: '#boton', navega: false });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'ir', url: 'https://sitio.com/paginas/impacto.html' }), { accion: 'ir', url: 'https://sitio.com/paginas/impacto.html' });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'desplazar', y: 3 }), { accion: 'desplazar', y: 1 });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'desplazar', y: -2 }), { accion: 'desplazar', y: 0 });
});

test('órdenes del espejo: descarta lo raro', () => {
  for (const mala of [null, 'clic', {}, { accion: 'borrar' }, { accion: 'clic' }, { accion: 'clic', ruta: '' },
    { accion: 'clic', ruta: 'a'.repeat(401) }, { accion: 'clic', ruta: '<script>' }, { accion: 'clic', ruta: 7 },
    { accion: 'ir', url: 'javascript:alert(1)' }, { accion: 'ir' }, { accion: 'desplazar', y: 'mucho' }, { accion: 'desplazar', y: NaN }]) {
    assert.strictEqual(limpiarOrdenWeb(mala), null, JSON.stringify(mala));
  }
});
