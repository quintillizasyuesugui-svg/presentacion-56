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

test('pantalla.html: "Frase final" dura 5s (un solo golpe) y "Escribir en vivo" 3 minutos por golpe (encadenado)', () => {
  const source = readFile('pantalla.html');
  const final = source.match(/const FINAL_PHRASE_RAIN_DURATION_MS = (\d+)/);
  assert.ok(final, 'no se encontró "const FINAL_PHRASE_RAIN_DURATION_MS = ..." en pantalla.html');
  assert.equal(Number(final[1]), 5000, 'FINAL_PHRASE_RAIN_DURATION_MS debería ser 5000ms (5s)');

  const vivo = source.match(/const LIVE_WRITE_RAIN_DURATION_MS = (\d+)/);
  assert.ok(vivo, 'no se encontró "const LIVE_WRITE_RAIN_DURATION_MS = ..." en pantalla.html');
  assert.equal(Number(vivo[1]), 180000, 'LIVE_WRITE_RAIN_DURATION_MS debería ser 180000ms (3 minutos)');
});

test('pantalla.html: "Frase final" es un solo golpe (no se repite) y "Escribir en vivo" se repite en bucle sin tope de tiempo', () => {
  const source = readFile('pantalla.html');
  assert.ok(!/PARTICLE_RAIN_LOOP_MAX_MS/.test(source), 'no debería haber ningún tope de tiempo para el bucle de partículas');

  assert.match(source, /const finalPhraseRain = crearCarrilDeLluvia\(FINAL_PHRASE_RAIN_DURATION_MS, \{ loop: false \}\)/, 'finalPhraseRain debería crearse con loop: false (un solo golpe)');
  assert.match(source, /const liveWriteRain = crearCarrilDeLluvia\(LIVE_WRITE_RAIN_DURATION_MS, \{ loop: true \}\)/, 'liveWriteRain debería crearse con loop: true (bucle sin cortarse solo)');

  const match = source.match(/function crearCarrilDeLluvia\(duracionMs, \{ loop \}\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'no se encontró "function crearCarrilDeLluvia(duracionMs, { loop }) {...}" en pantalla.html');
  assert.ok(/if \(loop\) \{[\s\S]*?setInterval\([\s\S]*?particleRain\(kind, duracionMs\)[\s\S]*?, duracionMs\)/.test(match[0]), 'el carril sólo debería encadenar golpes cuando loop es true');
});

test('pantalla.html: particleRain se puede cortar antes de tiempo, y el carril corta el golpe actual (no sólo la cadena) al detenerse', () => {
  const source = readFile('pantalla.html');
  assert.match(source, /function particleRain\(kind, durationMs\) \{[\s\S]*?return \{ detener: limpiar \};\n  \}/, 'particleRain debería devolver { detener } para poder cortarse antes de tiempo');
  const match = source.match(/function crearCarrilDeLluvia\(duracionMs, \{ loop \}\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'no se encontró "function crearCarrilDeLluvia(duracionMs, { loop }) {...}" en pantalla.html');
  assert.match(match[0], /detener\(\) \{[\s\S]*?golpeActual\.detener\(\)/, 'detener() del carril debería cortar también el golpe que está cayendo ahora mismo, no sólo la cadena de golpes futuros');
});

// Saca, en orden, las keys de un objeto plano de una sola línea por entrada
// tipo PARTICLE_RAIN_ICONS = { confetti: '🎉', stars: '⭐', hearts: '💖' };
function extractInlineObjectKeys(source, varName) {
  const match = source.match(new RegExp(`const ${varName} = \\{([^}]*)\\}`));
  assert.ok(match, `no se encontró "const ${varName} = {...}"`);
  return [...match[1].matchAll(/([\w-]+):/g)].map(m => m[1]);
}

test('pantalla.html: "Atrás"/"Siguiente" no hacen nada si el show todavía no arrancó con "Mostrar"', () => {
  // Regresión: sin este chequeo, "Atrás" antes de "Mostrar" restaba 1 al
  // índice sin arrancar, se iba a negativo y "envolvía" a la última
  // diapositiva, disparando el confetti de cierre aunque las fotos siguieran
  // tapadas por la pantalla de espera.
  const source = readFile('pantalla.html');
  assert.match(
    source,
    /if \(!started && \(accion === 'siguiente' \|\| accion === 'anterior'\)\) \{\s*\n\s*return;\s*\n\s*\}/,
    'aplicarCambio debería ignorar "siguiente"/"anterior" mientras "started" sea false'
  );
});

test('control.html: "Atrás"/"Siguiente" avisan con un mensaje si se tocan antes de "Mostrar", en vez de no hacer nada', () => {
  const source = readFile('control.html');
  assert.match(source, /let showStarted = false;/, 'debería haber un "showStarted" que arranca en false');
  assert.match(
    source,
    /if \(!showStarted && \(accion === 'anterior' \|\| accion === 'siguiente'\)\) \{\s*\n\s*showToast\(/,
    'enviar() debería avisar con showToast en vez de emitir "anterior"/"siguiente" mientras showStarted sea false'
  );
  assert.match(source, /if \(accion === 'mostrar'\) \{\s*\n\s*showStarted = true;/, 'enviar() debería poner showStarted en true al mandar "mostrar"');
});

test('style.css: .is-off se ve igual que .btn:disabled pero sin bloquear el click (para poder avisar por qué)', () => {
  const source = readFile('style.css');
  const match = source.match(/\.btn\.is-off \{([^}]*)\}/);
  assert.ok(match, 'no se encontró ".btn.is-off { ... }" en style.css');
  assert.ok(!/pointer-events\s*:\s*none/.test(match[1]), '.btn.is-off no debería tener pointer-events:none (si no, no se podría avisar al tocarlo)');
});

test('avanzado.html y control.html: PARTICLE_RAIN_ICONS tiene un ícono para cada lluvia de partículas', () => {
  const esperado = ['confetti', 'stars', 'hearts'].sort();
  for (const file of ['avanzado.html', 'control.html']) {
    const keys = extractInlineObjectKeys(readFile(file), 'PARTICLE_RAIN_ICONS').sort();
    assert.deepEqual(keys, esperado, `${file}: PARTICLE_RAIN_ICONS no tiene exactamente confetti/stars/hearts`);
  }
});
