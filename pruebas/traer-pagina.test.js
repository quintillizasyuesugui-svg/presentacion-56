const { test } = require('node:test');
const assert = require('node:assert');
const { ipInterna, prepararPagina, firmaDe } = require('../servidor/traer-pagina');

test('no deja traer direcciones de la red interna', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.4', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.strictEqual(ipInterna(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '185.199.108.153', '2606:4700::1111']) {
    assert.strictEqual(ipInterna(ip), false, ip);
  }
});

test('la firma es por sitio: la misma para todas sus páginas y distinta para otro', () => {
  assert.strictEqual(firmaDe('https://sitio.com'), firmaDe('https://sitio.com'));
  assert.notStrictEqual(firmaDe('https://sitio.com'), firmaDe('https://otro.com'));
});

test('la página traída lleva <base>, el puente y lo que el puente necesita, y pierde sus reglas de marco', () => {
  const html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'none\'"><base href="/viejo/"><title>Hola</title></head><body><a href="/otra">Otra</a></body></html>';
  const lista = prepararPagina(html, 'https://sitio.com/inicio', 'https://conexiones.test', 'FIRMA');
  assert.match(lista, /<head><base href="https:\/\/sitio\.com\/inicio">/);
  assert.match(lista, /<script src="https:\/\/conexiones\.test\/puente\.js"><\/script>/);
  assert.match(lista, /"abrir":"https:\/\/conexiones\.test\/traer\?f=FIRMA&u="/);
  assert.doesNotMatch(lista, /Content-Security-Policy/i);
  assert.doesNotMatch(lista, /\/viejo\//);
  assert.match(lista, /<title>Hola<\/title>/);
});

test('una dirección con comillas o < no rompe la cabecera', () => {
  const lista = prepararPagina('<head></head>', 'https://sitio.com/a"b<c', 'https://c.test', 'F');
  assert.doesNotMatch(lista, /href="https:\/\/sitio\.com\/a"b/);
  assert.doesNotMatch(lista, /"direccion":"[^"]*<c/);
});
