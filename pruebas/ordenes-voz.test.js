// Órdenes por voz: frases de ejemplo y qué tiene que entender el control con cada una.
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretarVoz } = require('../publico/scripts/ordenes-voz');

const DIAPOSITIVAS = 10;
const entiende = (frase) => interpretarVoz([frase], DIAPOSITIVAS);

// [lo que se dice, lo que tiene que entender (null = no es una orden)]
const CASOS = [
  // Diapositivas, igual que antes
  ['mostrar', { tipo: 'diapositiva', accion: 'mostrar' }],
  ['Siguiente', { tipo: 'diapositiva', accion: 'siguiente' }],
  ['atrás', { tipo: 'diapositiva', accion: 'anterior' }],
  ['anterior', { tipo: 'diapositiva', accion: 'anterior' }],
  ['tres', { tipo: 'diapositiva', accion: '3' }],
  ['diapositiva 7', { tipo: 'diapositiva', accion: '7' }],
  ['sigiente', { tipo: 'diapositiva', accion: 'siguiente' }],
  ['siguente', { tipo: 'diapositiva', accion: 'siguiente' }],
  // Música
  ['pon música', { tipo: 'medios', para: 'musica', accion: 'reproducir' }],
  ['música 1', { tipo: 'medios', para: 'musica', accion: 'elegir', numero: 1 }],
  ['pon música dos', { tipo: 'medios', para: 'musica', accion: 'elegir', numero: 2 }],
  ['pon la canción 3', { tipo: 'medios', para: 'musica', accion: 'elegir', numero: 3 }],
  ['siguiente canción', { tipo: 'medios', para: 'musica', accion: 'siguiente' }],
  ['canción anterior', { tipo: 'medios', para: 'musica', accion: 'anterior' }],
  ['pausa', { tipo: 'medios', para: null, accion: 'pausar' }],
  ['pausa la música', { tipo: 'medios', para: 'musica', accion: 'pausar' }],
  ['reproducir', { tipo: 'medios', para: null, accion: 'reproducir' }],
  ['reproduce', { tipo: 'medios', para: null, accion: 'reproducir' }],
  // Volumen
  ['baja volumen', { tipo: 'medios', para: null, accion: 'bajarVolumen' }],
  ['bájale', { tipo: 'medios', para: null, accion: 'bajarVolumen' }],
  ['sube el volumen', { tipo: 'medios', para: null, accion: 'subirVolumen' }],
  ['ponlo a la mitad', { tipo: 'medios', para: null, accion: 'volumen', valor: 50 }],
  ['volumen a la mitad', { tipo: 'medios', para: null, accion: 'volumen', valor: 50 }],
  ['volumen al máximo', { tipo: 'medios', para: null, accion: 'volumen', valor: 100 }],
  ['volumen 30', { tipo: 'medios', para: null, accion: 'volumen', valor: 30 }],
  ['bolumen treinta', { tipo: 'medios', para: null, accion: 'volumen', valor: 30 }],
  ['silencio', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['baja el volumen del video', { tipo: 'medios', para: 'video', accion: 'bajarVolumen' }],
  // Video
  ['pon video 1', { tipo: 'medios', para: 'video', accion: 'elegir', numero: 1 }],
  ['video dos', { tipo: 'medios', para: 'video', accion: 'elegir', numero: 2 }],
  ['siguiente video', { tipo: 'medios', para: 'video', accion: 'siguiente' }],
  ['pausa el video', { tipo: 'medios', para: 'video', accion: 'pausar' }],
  ['quita el video', { tipo: 'medios', para: 'video', accion: 'terminar' }],
  ['reproducir video', { tipo: 'medios', para: 'video', accion: 'reproducir' }],
  // Lo que NO es una orden: frases de quien está explicando algo
  ['la temperatura baja mucho durante la noche en el desierto', null],
  ['en este cuadro vemos la mitad de la población del país', null],
  ['hay que parar un momento a pensar qué significa esto', null],
  ['hola a todos', null],
  ['volumen', null],
  ['', null]
];

for (const [frase, esperado] of CASOS) {
  test(`«${frase}» → ${esperado ? esperado.accion + (esperado.para ? ' (' + esperado.para + ')' : '') : 'no es una orden'}`, () => {
    assert.deepEqual(entiende(frase), esperado);
  });
}

test('si la primera versión de lo oído no es una orden, se usa la siguiente', () => {
  assert.deepEqual(interpretarVoz(['si gente', 'siguiente'], DIAPOSITIVAS), { tipo: 'diapositiva', accion: 'siguiente' });
});

test('un número más alto que la cantidad de diapositivas no hace nada', () => {
  assert.equal(interpretarVoz(['veinte'], DIAPOSITIVAS), null);
});
