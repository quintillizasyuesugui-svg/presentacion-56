const { test } = require('node:test');
const assert = require('node:assert');
const { leerResultados, segundosDe } = require('../servidor/buscar-youtube');
const { limpiarOrdenMedios } = require('../servidor/validadores-medios');

const video = (id, titulo, duracion) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: titulo }] },
    ownerText: { runs: [{ text: 'Canal ' + titulo }] },
    ...(duracion ? { lengthText: { simpleText: duracion } } : {})
  }
});

test('lee los videos de la página de resultados, en orden y sin repetir', () => {
  const datos = {
    contents: {
      secciones: [
        { items: [video('aaaaaaaaaaa', 'Uno', '4:12'), { playlistRenderer: { playlistId: 'x' } }, video('bbbbbbbbbbb', 'Dos', '1:02:03')] },
        { items: [video('aaaaaaaaaaa', 'Uno otra vez', '4:12'), video('ccccccccccc', 'Tres en vivo'), video('malo', 'No sirve', '1:00')] }
      ]
    }
  };
  assert.deepStrictEqual(leerResultados(datos), [
    { id: 'aaaaaaaaaaa', titulo: 'Uno', canal: 'Canal Uno', duracion: '4:12', segundos: 252 },
    { id: 'bbbbbbbbbbb', titulo: 'Dos', canal: 'Canal Dos', duracion: '1:02:03', segundos: 3723 },
    { id: 'ccccccccccc', titulo: 'Tres en vivo', canal: 'Canal Tres en vivo', duracion: 'En vivo', segundos: 0 }
  ]);
});

test('duración en segundos', () => {
  assert.strictEqual(segundosDe('0:59'), 59);
  assert.strictEqual(segundosDe('10:00'), 600);
  assert.strictEqual(segundosDe('En vivo'), 0);
  assert.strictEqual(segundosDe(''), 0);
});

test('la orden «youtube» sólo pasa con un id de video válido', () => {
  assert.deepStrictEqual(limpiarOrdenMedios({ para: 'video', accion: 'youtube', valor: { id: 'zHREda0cy1c', nombre: ' Y qué pasó ' } }),
    { para: 'video', accion: 'youtube', valor: { id: 'zHREda0cy1c', nombre: 'Y qué pasó' } });
  assert.deepStrictEqual(limpiarOrdenMedios({ para: 'video', accion: 'youtube', valor: { id: 'zHREda0cy1c' } }).valor.nombre, 'Video de YouTube');
  assert.strictEqual(limpiarOrdenMedios({ para: 'video', accion: 'youtube', valor: 'zHREda0cy1c' }), null);
  assert.strictEqual(limpiarOrdenMedios({ para: 'video', accion: 'youtube', valor: { id: '../../x' } }), null);
  assert.strictEqual(limpiarOrdenMedios({ para: 'musica', accion: 'youtube', valor: { id: 'zHREda0cy1c' } }), null);
  assert.strictEqual(limpiarOrdenMedios({ para: 'video', accion: 'youtube', valor: { id: 'zHREda0cy1c', nombre: 'x'.repeat(500) } }).valor.nombre.length, 200);
});
