// El proyecto no usa ningún build step: las listas de tipos de letra y
// efectos viven duplicadas a mano en control.html, avanzado.html y
// pantalla.html, y server.js valida contra su propia copia (frase-validators.js).
// Los propios comentarios del código avisan "las keys tienen que coincidir
// 1:1" — esta prueba automatiza justo esa verificación, para que agregar o
// cambiar un tipo de letra/efecto en un solo archivo y olvidarse de los otros
// falle acá en vez de romperse en silencio en pantalla.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FRASE_FONTS, FRASE_EFFECTS } = require('./frase-validators');

function readFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

// Saca, en orden, las keys de un array de objetos tipo:
//   const NOMBRE = [
//     { key: 'sans', label: 'Moderna', ... },
//     ...
//   ];
function extractArrayKeys(source, varName) {
  const start = source.indexOf(`const ${varName} = [`);
  assert.ok(start !== -1, `no se encontró "const ${varName} = ["`);
  const end = source.indexOf('];', start);
  assert.ok(end !== -1, `no se encontró el cierre "];" de ${varName}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/key:\s*'([^']+)'/g)].map(m => m[1]);
}

// Saca, en orden, las keys de un objeto plano tipo:
//   const NOMBRE = {
//     sans: "'Poppins', sans-serif",
//     'shadow-3d': "'Bungee Shade', sans-serif",
//   };
function extractObjectKeys(source, varName) {
  const start = source.indexOf(`const ${varName} = {`);
  assert.ok(start !== -1, `no se encontró "const ${varName} = {"`);
  const end = source.indexOf('};', start);
  assert.ok(end !== -1, `no se encontró el cierre "};" de ${varName}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/^\s*(?:'([\w-]+)'|([\w-]+)):\s*"/gm)].map(m => m[1] || m[2]);
}

test('control.html: LW_FONTS tiene exactamente las mismas keys, en el mismo orden, que FRASE_FONTS', () => {
  const keys = extractArrayKeys(readFile('control.html'), 'LW_FONTS');
  assert.deepEqual(keys, FRASE_FONTS);
});

test('avanzado.html: FRASE_FONTS (editor) coincide con la lista que valida server.js', () => {
  const keys = extractArrayKeys(readFile('avanzado.html'), 'FRASE_FONTS');
  assert.deepEqual(keys, FRASE_FONTS);
});

test('pantalla.html: FRASE_FONT_FAMILIES tiene una entrada por cada tipo de letra, en el mismo orden', () => {
  const keys = extractObjectKeys(readFile('pantalla.html'), 'FRASE_FONT_FAMILIES');
  assert.deepEqual(keys, FRASE_FONTS);
});

test('avanzado.html: FRASE_EFFECTS (editor) coincide con la lista que valida server.js', () => {
  const keys = extractArrayKeys(readFile('avanzado.html'), 'FRASE_EFFECTS');
  assert.deepEqual(keys, FRASE_EFFECTS);
});

test('control.html: todas las keys de LW_EFFECTS existen en FRASE_EFFECTS', () => {
  const keys = extractArrayKeys(readFile('control.html'), 'LW_EFFECTS');
  for (const key of keys) {
    assert.ok(FRASE_EFFECTS.includes(key), `LW_EFFECTS tiene "${key}", que no está en FRASE_EFFECTS`);
  }
});

test('control.html: las 3 lluvias de partículas (confetti/stars/hearts) están habilitadas en "Escribir en vivo"', () => {
  const keys = extractArrayKeys(readFile('control.html'), 'LW_EFFECTS');
  for (const key of ['confetti', 'stars', 'hearts']) {
    assert.ok(keys.includes(key), `falta "${key}" en LW_EFFECTS`);
  }
});

test('pantalla.html: PARTICLE_RAIN_EFFECTS son justo las 3 lluvias de partículas', () => {
  const source = readFile('pantalla.html');
  const match = source.match(/const PARTICLE_RAIN_EFFECTS = \[([^\]]+)\]/);
  assert.ok(match, 'no se encontró "const PARTICLE_RAIN_EFFECTS = [...]" en pantalla.html');
  const keys = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(keys.sort(), ['confetti', 'hearts', 'stars'].sort());
});

test('pantalla.html: cada golpe de lluvia de partículas dura 3 minutos', () => {
  const source = readFile('pantalla.html');
  const match = source.match(/const PARTICLE_RAIN_DURATION_MS = (\d+)/);
  assert.ok(match, 'no se encontró "const PARTICLE_RAIN_DURATION_MS = ..." en pantalla.html');
  assert.equal(Number(match[1]), 180000, 'PARTICLE_RAIN_DURATION_MS debería ser 180000ms (3 minutos)');
});

test('pantalla.html: la lluvia se repite en bucle sin tope de tiempo (sólo se corta al apagar el texto o cambiar de efecto)', () => {
  const source = readFile('pantalla.html');
  assert.ok(!/PARTICLE_RAIN_LOOP_MAX_MS/.test(source), 'no debería haber ningún tope de tiempo para el bucle de partículas');
  const match = source.match(/function crearCarrilDeLluvia\(\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'no se encontró "function crearCarrilDeLluvia() {...}" en pantalla.html');
  assert.ok(/setInterval\(\(\) => particleRain\(kind\), PARTICLE_RAIN_DURATION_MS\)/.test(match[0]), 'el carril debería encadenar particleRain sin condición de corte');
});

// Saca, en orden, las keys de un objeto plano de una sola línea por entrada
// tipo PARTICLE_RAIN_ICONS = { confetti: '🎉', stars: '⭐', hearts: '💖' };
function extractInlineObjectKeys(source, varName) {
  const match = source.match(new RegExp(`const ${varName} = \\{([^}]*)\\}`));
  assert.ok(match, `no se encontró "const ${varName} = {...}"`);
  return [...match[1].matchAll(/([\w-]+):/g)].map(m => m[1]);
}

test('avanzado.html y control.html: PARTICLE_RAIN_ICONS tiene un ícono para cada lluvia de partículas', () => {
  const esperado = ['confetti', 'stars', 'hearts'].sort();
  for (const file of ['avanzado.html', 'control.html']) {
    const keys = extractInlineObjectKeys(readFile(file), 'PARTICLE_RAIN_ICONS').sort();
    assert.deepEqual(keys, esperado, `${file}: PARTICLE_RAIN_ICONS no tiene exactamente confetti/stars/hearts`);
  }
});
