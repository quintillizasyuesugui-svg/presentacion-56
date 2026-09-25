// Pruebas unitarias de servidor/validadores-frase.js — corren con el test runner nativo
// de Node (node --test), sin depender de ningún paquete extra ni de levantar
// el servidor real (Express/Socket.IO/Cloudinary quedan afuera).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FRASE_FONTS,
  FRASE_EFFECTS,
  FRASE_POSITIONS,
  parseColor2,
  parseFraseBody,
  parseLiveWriteBody
} = require('../servidor/validadores-frase');

test('FRASE_FONTS incluye los tipos de letra nuevos (elegantes/3D/curvas/grafiti)', () => {
  for (const key of ['royal', 'shadow-3d', 'neon-tube', 'graffiti', 'curvy-bold', 'bubble', 'comic-3d', 'urban', 'outline']) {
    assert.ok(FRASE_FONTS.includes(key), `falta la key "${key}"`);
  }
  assert.equal(new Set(FRASE_FONTS).size, FRASE_FONTS.length, 'no debería haber keys repetidas');
});

test('FRASE_EFFECTS incluye los efectos nuevos de lluvia de partículas', () => {
  assert.ok(FRASE_EFFECTS.includes('stars'));
  assert.ok(FRASE_EFFECTS.includes('hearts'));
  assert.equal(new Set(FRASE_EFFECTS).size, FRASE_EFFECTS.length, 'no debería haber keys repetidas');
});

test('parseColor2: vacío/ausente es "un solo color" válido', () => {
  assert.equal(parseColor2(undefined), '');
  assert.equal(parseColor2(null), '');
  assert.equal(parseColor2(''), '');
});

test('parseColor2: acepta un hex de 6 dígitos y rechaza cualquier otra cosa', () => {
  assert.equal(parseColor2('#ff00aa'), '#ff00aa');
  assert.equal(parseColor2('#FFF'), null);       // hex corto, no vale
  assert.equal(parseColor2('red'), null);        // nombre de color, no vale
  assert.equal(parseColor2('<script>'), null);   // nada de HTML/JS suelto
});

test('parseFraseBody: acepta un cuerpo válido con un tipo de letra nuevo', () => {
  const resultado = parseFraseBody({
    text: 'Gracias por venir',
    font: 'graffiti',
    color: '#ffffff',
    effect: 'stars',
    position: 'bottom',
    duration: 1.5,
    fontSize: 1.2
  });
  assert.deepEqual(resultado, {
    text: 'Gracias por venir',
    font: 'graffiti',
    color: '#ffffff',
    color2: '',
    effect: 'stars',
    duration: 1.5,
    fontSize: 1.2,
    position: 'bottom'
  });
});

test('parseFraseBody: rechaza un tipo de letra o efecto que no está en el menú cerrado', () => {
  const base = { text: 'hola', color: '#ffffff', position: 'middle', duration: 1, fontSize: 1 };
  assert.equal(parseFraseBody({ ...base, font: 'comic-sans-inventada', effect: 'fade' }), null);
  assert.equal(parseFraseBody({ ...base, font: 'sans', effect: 'explosion-inventada' }), null);
});

test('parseFraseBody: rechaza texto vacío y recorta a 60 caracteres', () => {
  assert.equal(parseFraseBody({ text: '   ', font: 'sans', color: '#ffffff', effect: 'fade', position: 'middle', duration: 1, fontSize: 1 }), null);

  const textoLargo = 'x'.repeat(200);
  const resultado = parseFraseBody({ text: textoLargo, font: 'sans', color: '#ffffff', effect: 'fade', position: 'middle', duration: 1, fontSize: 1 });
  assert.equal(resultado.text.length, 60);
});

test('parseFraseBody: la duración y el tamaño de letra quedan acotados a su rango', () => {
  const base = { text: 'hola', font: 'sans', color: '#ffffff', effect: 'fade', position: 'middle' };
  assert.equal(parseFraseBody({ ...base, duration: 999, fontSize: 1 }).duration, 3);
  assert.equal(parseFraseBody({ ...base, duration: -5, fontSize: 1 }).duration, 0.4);
  assert.equal(parseFraseBody({ ...base, duration: 1, fontSize: 999 }).fontSize, 1.8);
  assert.equal(parseFraseBody({ ...base, duration: 1, fontSize: -5 }).fontSize, 0.6);
});

test('parseLiveWriteBody: acepta un cuerpo válido con un efecto de lluvia de partículas', () => {
  const resultado = parseLiveWriteBody({
    active: true,
    text: 'Feliz cumple',
    font: 'bubble',
    color: '#ff477e',
    effect: 'hearts',
    fontSize: 1.4
  });
  assert.deepEqual(resultado, {
    active: true,
    text: 'Feliz cumple',
    font: 'bubble',
    effect: 'hearts',
    color: '#ff477e',
    color2: '',
    fontSize: 1.4
  });
});

test('parseLiveWriteBody: "active" se apaga solo si el texto queda vacío', () => {
  const resultado = parseLiveWriteBody({ active: true, text: '   ', font: 'sans', color: '#ffffff', effect: 'fade', fontSize: 1 });
  assert.equal(resultado.active, false);
});

test('parseLiveWriteBody: rechaza un color que no es un hex válido', () => {
  assert.equal(parseLiveWriteBody({ text: 'hola', font: 'sans', color: 'no-es-un-color', effect: 'fade', fontSize: 1 }), null);
});

test('FRASE_POSITIONS tiene las 3 posiciones esperadas', () => {
  assert.deepEqual(FRASE_POSITIONS, ['top', 'middle', 'bottom']);
});
