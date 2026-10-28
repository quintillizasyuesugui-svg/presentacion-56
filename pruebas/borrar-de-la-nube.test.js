// Pruebas del borrado en Cloudinary: limpia la caché y, si Cloudinary falla, lo anota y lo
// reintenta hasta que el archivo se va. Cloudinary se simula: no se toca la nube real.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.CARPETA_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'borrar-nube-'));
process.env.CLOUDINARY_CLOUD_NAME = 'prueba';
process.env.CLOUDINARY_API_KEY = 'prueba';
process.env.CLOUDINARY_API_SECRET = 'prueba';
delete process.env.DATABASE_URL;

const { cloudinary } = require('../servidor/configuracion');
const enLaNube = new Set();
let nubeCaida = false;
const pedidos = [];
cloudinary.uploader.destroy = async (id, opciones) => {
  pedidos.push({ id, ...opciones });
  if (nubeCaida) throw new Error('sin conexión');
  return { result: enLaNube.delete(id) ? 'ok' : 'not found' };
};
cloudinary.uploader.upload = async () => ({});
cloudinary.api.resource = async () => { throw { error: { http_code: 404 } }; };
global.fetch = async () => ({ ok: false, status: 404 });

const { iniciarAlmacenes } = require('../servidor/almacen');
const { borrarDeLaNube, reintentarPendientes } = require('../servidor/borrar-de-la-nube');
const pendientes = () => JSON.parse(fs.readFileSync(path.join(process.env.CARPETA_DATOS, 'borrados-pendientes.json'), 'utf8'));

test.before(() => iniciarAlmacenes());

test('borra la foto y limpia la caché', async () => {
  enLaNube.add('presentacion/slides/a');
  await borrarDeLaNube('presentacion/slides/a', 'image');
  assert.ok(!enLaNube.has('presentacion/slides/a'));
  assert.equal(pedidos.at(-1).invalidate, true);
  assert.equal(pedidos.at(-1).resource_type, 'image');
});

test('si Cloudinary falla, lo anota y lo reintenta hasta borrarlo', async () => {
  enLaNube.add('presentacion/slides/b');
  enLaNube.add('presentacion/multimedia/c');
  nubeCaida = true;
  await borrarDeLaNube('presentacion/slides/b', 'image');
  await borrarDeLaNube('presentacion/multimedia/c', 'video');
  await borrarDeLaNube('presentacion/slides/b', 'image'); // repetido: no se anota dos veces
  assert.deepEqual(pendientes().map(p => p.id).sort(), ['presentacion/multimedia/c', 'presentacion/slides/b']);

  await reintentarPendientes(); // sigue caída: quedan, con un intento más
  assert.equal(pendientes().length, 2);
  assert.ok(pendientes().every(p => p.intentos === 2));

  nubeCaida = false;
  await reintentarPendientes();
  assert.equal(pendientes().length, 0);
  assert.equal(enLaNube.size, 0);
  assert.equal(pedidos.at(-1).invalidate, true);
});
