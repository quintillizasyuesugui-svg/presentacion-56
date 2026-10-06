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

test('foto en vivo: órdenes para la página que abre la app de PC', () => {
  const { limpiarOrdenWeb } = require('../servidor/validadores-pagina');
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'toque', x: 0.25, y: 2 }), { accion: 'toque', x: 0.25, y: 1 });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'rueda', dy: -9 }), { accion: 'rueda', dy: -3 });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'volver', de: 'más' }), { accion: 'volver' });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'texto', texto: 'hola café' }), { accion: 'texto', texto: 'hola café' });
  assert.deepStrictEqual(limpiarOrdenWeb({ accion: 'tecla', tecla: 'Enter' }), { accion: 'tecla', tecla: 'Enter' });
  for (const mala of [{ accion: 'toque', x: 'a', y: 0 }, { accion: 'rueda' }, { accion: 'texto', texto: '' }, { accion: 'texto', texto: 'a'.repeat(201) },
    { accion: 'texto', texto: 'a\nb' }, { accion: 'tecla', tecla: 'F4' }, { accion: 'tecla', tecla: 'Delete' }]) {
    assert.strictEqual(limpiarOrdenWeb(mala), null, JSON.stringify(mala));
  }
});

test('foto en vivo: sólo pasa un JPEG chico', () => {
  const { limpiarFotoWeb } = require('../servidor/validadores-pagina');
  const jpg = '/9j/' + 'A'.repeat(400);
  assert.deepStrictEqual(limpiarFotoWeb({ jpg, url: 'https://es.wikipedia.org/wiki/Caf%C3%A9', titulo: ' Café \n Wikipedia ', otro: 1 }),
    { jpg, url: 'https://es.wikipedia.org/wiki/Caf%C3%A9', titulo: 'Café   Wikipedia' });
  assert.deepStrictEqual(limpiarFotoWeb({ jpg, url: 'javascript:alert(1)' }), { jpg, url: '', titulo: '' });
  for (const mala of [null, {}, { jpg: 'hola' }, { jpg: 'iVBOR' + 'A'.repeat(400) }, { jpg: '/9j/' + 'A'.repeat(400001) }, { jpg: '/9j/' + '<'.repeat(400) }, { jpg: 42 }]) {
    assert.strictEqual(limpiarFotoWeb(mala), null);
  }
});
