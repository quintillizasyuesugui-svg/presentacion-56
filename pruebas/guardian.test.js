// Pruebas de los 4 guardianes: empleados y fila (Tareas), tope por persona y conectados
// (Usuarios), explicaciones del espacio (Almacenamiento) y mensajes de más (Pantallas).
const test = require('node:test');
const assert = require('node:assert/strict');
const { enFila, explicarEspacio, estadoGuardian, empleadosAhora, vigilanteDeMensajes, conectar, desconectar, pantallaConSonido, LIMITES } = require('../servidor/guardian');

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

test('atiende varias a la vez sin pasar del máximo aunque pidan muchas personas', async () => {
  let enCurso = 0;
  let maximo = 0;
  const tarea = async () => { enCurso++; maximo = Math.max(maximo, enCurso); await esperar(10500); enCurso--; return 'ok'; };
  const personas = Array.from({ length: 15 }, (_, i) => `persona ${i}`);
  const resultados = await Promise.all(personas.map(p => enFila('youtube', p, tarea)));
  assert.ok(resultados.every(r => r === 'ok'));
  assert.ok(maximo > LIMITES.youtube.minimo, `contrató empleados de más (llegó a ${maximo})`);
  assert.ok(maximo <= LIMITES.youtube.maximo, `nunca pasa del máximo (${maximo})`);
  const estado = estadoGuardian();
  assert.equal(estado.tareas.youtube.trabajando.length, 0);
  assert.ok(estado.decisiones.some(d => /esperó/.test(d.que)));
});

test('una sola persona no puede acaparar la fila, y se le explica', async () => {
  const lenta = () => esperar(80);
  const permitidas = Array.from({ length: LIMITES.youtube.porPersona }, () => enFila('youtube', 'Acaparadora', lenta));
  await assert.rejects(enFila('youtube', 'Acaparadora', lenta), (err) => err.estado === 429 && /Ya tenés/.test(err.message));
  await Promise.all(permitidas);
  // Terminadas las suyas, puede volver a pedir.
  await enFila('youtube', 'Acaparadora', () => 'de nuevo');
  assert.ok(estadoGuardian().decisiones.some(d => d.persona === 'Acaparadora' && /ya tenía/.test(d.porque)));
});

test('un error de la tarea le llega a quien la pidió y la fila sigue', async () => {
  await assert.rejects(enFila('youtube', 'Ana', () => { throw new Error('falló'); }), /falló/);
  assert.equal(await enFila('youtube', 'Ana', () => 7), 7);
});

test('explica el espacio según cuántas personas hay', () => {
  const MB = 1024 * 1024;
  const calculo = (personas, mbPorPersona) => ({ personas, presupuestoMb: 12000, minimoMb: 100, maximoMb: 2000, mbPorPersona });
  assert.match(explicarEspacio({ usado: 0, total: 2000 * MB, fijoMb: null, calculo: calculo(3, 2000) }), /pocas personas \(3\)/);
  assert.match(explicarEspacio({ usado: 0, total: 400 * MB, fijoMb: null, calculo: calculo(30, 400) }), /30 personas y los 12 GB/);
  assert.match(explicarEspacio({ usado: 0, total: 100 * MB, fijoMb: null, calculo: calculo(500, 100) }), /muchas personas \(500\)/);
  assert.match(explicarEspacio({ usado: 150 * MB, total: 100 * MB, fijoMb: null, calculo: calculo(500, 100) }), /no se borra nada/);
  assert.match(explicarEspacio({ usado: 0, total: 50 * MB, fijoMb: 50, calculo: calculo(30, 400) }), /el admin te lo dejó fijo/);
});

test('por turnos: quien sube poco no espera detrás de quien sube mucho', async () => {
  const orden = [];
  const tarea = (quien) => async () => { orden.push(quien); await esperar(30); };
  // 20 imágenes de una persona y, apenas después, 1 de otra.
  const muchas = Array.from({ length: 20 }, () => enFila('imagenes', 'Muchas fotos', tarea('muchas')));
  const una = enFila('imagenes', 'Una foto', tarea('una'));
  await Promise.all([...muchas, una]);
  const turnoDeLaUna = orden.indexOf('una');
  // Entra apenas se libera un empleado, antes que las fotos de la otra persona que seguían en fila.
  assert.ok(turnoDeLaUna <= LIMITES.imagenes.maximo, `la de una foto empezó en el turno ${turnoDeLaUna}`);
  assert.ok(orden.slice(turnoDeLaUna + 1).length >= 20 - LIMITES.imagenes.maximo, 'quedaban fotos de la otra persona después');
});

test('con más gente contrata más empleados y después vuelven al mínimo', async () => {
  let enCurso = 0;
  let maximo = 0;
  const tarea = async () => { enCurso++; maximo = Math.max(maximo, enCurso); await esperar(25); enCurso--; };
  const pocas = Array.from({ length: 3 }, (_, i) => enFila('imagenes', `poca ${i}`, tarea));
  await Promise.all(pocas);
  assert.ok(maximo <= LIMITES.imagenes.minimo);

  maximo = 0;
  const muchas = Array.from({ length: 80 }, (_, i) => enFila('imagenes', `persona ${i % 25}`, tarea));
  await Promise.all(muchas);
  assert.equal(maximo, LIMITES.imagenes.maximo, 'con 80 esperando trabajan todos los empleados posibles');
  assert.equal(empleadosAhora('imagenes'), LIMITES.imagenes.minimo, 'sin trabajo, vuelve al mínimo');
  assert.ok(estadoGuardian().decisiones.some(d => /contrató empleados para imagenes/.test(d.que)));
});

test('los 4 guardianes: usuarios conectados, pantallas y mensajes de más', () => {
  conectar('Gabi'); conectar('Gabi'); conectar('Hugo');
  desconectar('Gabi');
  let estado = estadoGuardian();
  assert.deepEqual(Object.keys(estado.guardianes), ['usuarios', 'tareas', 'almacenamiento', 'pantallas']);
  assert.ok(estado.usuarios.conectados.includes('Gabi'), 'sigue conectada con su otra conexión');
  desconectar('Gabi'); desconectar('Hugo');
  assert.ok(!estadoGuardian().usuarios.conectados.includes('Gabi'));

  pantallaConSonido('Gabi', 'pc-1');
  pantallaConSonido('Gabi', 'tele-2');
  assert.ok(estadoGuardian().decisiones.some(d => d.guardian === 'pantallas' && d.persona === 'Gabi' && /otra pantalla/.test(d.que)));

  const permitir = vigilanteDeMensajes();
  let pasaron = 0;
  for (let i = 0; i < 100; i++) if (permitir('Ruidoso')) pasaron++;
  assert.ok(pasaron >= 20 && pasaron < 100, `pasaron ${pasaron} de 100 en un segundo`);
  assert.ok(estadoGuardian().decisiones.some(d => d.guardian === 'pantallas' && d.persona === 'Ruidoso'));
});

test('simulacro: se ven empleados trabajando y no se lanzan dos a la vez', async () => {
  const { simulacro } = require('../servidor/guardian');
  assert.equal(simulacro(), true);
  assert.equal(simulacro(), false, 'no arranca otro mientras hay uno');
  await esperar(300);
  const e = estadoGuardian();
  assert.ok(e.simulacro);
  assert.ok(e.tareas.imagenes.trabajando.length > LIMITES.imagenes.minimo, 'contrató más empleados');
  assert.ok(e.decisiones.some(d => d.persona === 'Simulacro acaparador'), 'frenó al que quería acaparar');
  while (estadoGuardian().simulacro) await esperar(200);
  assert.equal(estadoGuardian().tareas.imagenes.empleados, LIMITES.imagenes.minimo);
});
