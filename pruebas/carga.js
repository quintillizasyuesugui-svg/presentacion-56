// Prueba de carga: muchas personas usando la app al mismo tiempo.
//   node pruebas/carga.js [dirección] [personas] [documentos]
//   ej.: node pruebas/carga.js http://127.0.0.1:3000 400 20
// Hace, con todas a la vez: registrarse, conectar el celular (Socket.IO), mirar la pantalla,
// guardar la frase final y el avance automático, entrar con el PIN y subir documentos PDF.
// Al final comprueba que no se haya perdido nada (cada persona ve su propia frase).
// No usar contra Render sin avisar: crea cuentas de prueba de verdad (borrarlas desde «Personas»).
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const PERSONAS = Number(process.argv[3]) || 400;
const DOCUMENTOS = Number(process.argv[4]) || 20;
const PDF = fs.readFileSync(path.join(__dirname, 'datos-prueba', 'muestra-5-paginas.pdf'));
const marca = 'Carga ' + Date.now().toString(36);

async function pedir(ruta, { pin, metodo = 'GET', json, formulario } = {}) {
  const headers = {};
  if (pin) headers['x-pin'] = pin;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (formulario) body = formulario;
  const inicio = performance.now();
  try {
    const r = await fetch(BASE + ruta, { method: metodo, headers, body });
    const cuerpo = await r.json().catch(() => null);
    return { estado: r.status, cuerpo, ms: performance.now() - inicio };
  } catch (err) {
    return { estado: 0, cuerpo: null, ms: performance.now() - inicio, error: err.message };
  }
}

function informe(nombre, respuestas, esperado = 200) {
  const tiempos = respuestas.map(r => r.ms).sort((a, b) => a - b);
  const p = (q) => Math.round(tiempos[Math.min(tiempos.length - 1, Math.floor(q * tiempos.length))]);
  const fallas = respuestas.filter(r => r.estado !== esperado);
  console.log(`${nombre.padEnd(34)} ${String(respuestas.length).padStart(4)} pedidos · mitad < ${String(p(0.5)).padStart(5)} ms · 95 % < ${String(p(0.95)).padStart(5)} ms · peor ${String(p(1)).padStart(5)} ms · fallas ${fallas.length}${fallas.length ? ' (' + [...new Set(fallas.map(f => f.estado + (f.error ? ' ' + f.error : '')))].join(', ') + ')' : ''}`);
  return fallas.length;
}

const todos = (n, tarea) => Promise.all(Array.from({ length: n }, (_, i) => tarea(i)));

(async () => {
  console.log(`Prueba de carga contra ${BASE}: ${PERSONAS} personas, ${DOCUMENTOS} documentos a la vez.\n`);
  let fallas = 0;

  const altas = await todos(PERSONAS, i => pedir('/api/auth/register', { metodo: 'POST', json: { name: `${marca} ${i}` } }));
  fallas += informe('Registrarse (todas a la vez)', altas);
  const personas = altas.filter(a => a.estado === 200).map(a => a.cuerpo);

  const conectados = [];
  const inicioSockets = performance.now();
  await todos(personas.length, i => new Promise((resolver) => {
    const s = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 20000 });
    const inicio = performance.now();
    s.on('connect', () => { s.emit('identificar', personas[i].pin); conectados.push(s); resolver({ estado: 200, ms: performance.now() - inicio }); });
    s.on('connect_error', (e) => resolver({ estado: 0, ms: performance.now() - inicio, error: e.message }));
  })).then(r => { fallas += informe('Conectar celular (Socket.IO)', r); });
  const msSockets = Math.round(performance.now() - inicioSockets);

  fallas += informe('Pantalla: GET /images', await todos(personas.length, () => pedir('/images')));
  fallas += informe('Gestionar: GET /api/images', await todos(personas.length, i => pedir('/api/images', { pin: personas[i].pin })));
  fallas += informe('Entrar con PIN', await todos(personas.length, i => pedir('/api/auth/login', { metodo: 'POST', json: { pin: personas[i].pin } })));
  fallas += informe('Guardar frase final', await todos(personas.length, i => pedir('/api/frase-final', { pin: personas[i].pin, metodo: 'POST',
    json: { text: 'Frase de ' + personas[i].name, font: 'sans', color: '#ffffff', effect: 'fade', duration: 1, fontSize: 1, position: 'middle' } })));
  fallas += informe('Guardar avance automático', await todos(personas.length, i => pedir('/api/avance-automatico', { pin: personas[i].pin, metodo: 'POST', json: { enabled: i % 2 === 0, seconds: 10 + (i % 50) } })));

  // ¿Se perdió algo? Cada una tiene que ver su propia frase y su avance.
  const frases = await todos(personas.length, i => pedir('/api/frase-final', { pin: personas[i].pin }));
  const frasesBien = frases.filter((r, i) => r.cuerpo && r.cuerpo.text === 'Frase de ' + personas[i].name).length;
  const avances = await todos(personas.length, i => pedir('/api/avance-automatico', { pin: personas[i].pin }));
  const avancesBien = avances.filter((r, i) => r.cuerpo && r.cuerpo.seconds === 10 + (i % 50)).length;
  const cuentas = await todos(personas.length, i => pedir('/api/auth/login', { metodo: 'POST', json: { pin: personas[i].pin } }));
  const cuentasBien = cuentas.filter((r, i) => r.cuerpo && r.cuerpo.name === personas[i].name).length;
  console.log(`\nNada perdido: cuentas ${cuentasBien}/${personas.length} · frases ${frasesBien}/${personas.length} · avances ${avancesBien}/${personas.length}`);

  // Documentos: se suben todos juntos; el servidor los procesa de a uno.
  const inicioDocs = performance.now();
  const subidos = await todos(Math.min(DOCUMENTOS, personas.length), async (i) => {
    const f = new FormData();
    f.append('documento', new Blob([PDF]), `carga-${i}.pdf`);
    const r = await pedir('/api/documentos', { pin: personas[i].pin, metodo: 'POST', formulario: f });
    if (r.estado !== 202) return { ...r, listoEn: null };
    for (;;) {
      const lista = (await pedir('/api/documentos', { pin: personas[i].pin })).cuerpo || [];
      const t = lista.find(d => d.id === r.cuerpo.id);
      if (!t || ['eligiendo', 'error'].includes(t.fase)) return { ...r, listoEn: performance.now() - inicioDocs, fase: t && t.fase };
      await new Promise(res => setTimeout(res, 300));
    }
  });
  fallas += informe('Subir documento (recibido)', subidos, 202);
  const tiempos = subidos.filter(s => s.listoEn).map(s => s.listoEn).sort((a, b) => a - b);
  console.log(`Documentos con las páginas detectadas: ${subidos.filter(s => s.fase === 'eligiendo').length}/${subidos.length} · el primero a los ${(tiempos[0] / 1000).toFixed(1)} s · el último a los ${(tiempos[tiempos.length - 1] / 1000).toFixed(1)} s`);

  const memoria = await pedir('/images');
  console.log(`\n${conectados.length} celulares conectados a la vez (en ${msSockets} ms). La pantalla sigue respondiendo: ${memoria.estado === 200 ? 'sí' : 'NO'}.`);
  conectados.forEach(s => s.close());
  const perdidos = (personas.length - frasesBien) + (personas.length - avancesBien) + (personas.length - cuentasBien);
  console.log(fallas || perdidos ? `\n❌ Hubo ${fallas} pedidos con error y ${perdidos} datos perdidos.` : '\n✅ Sin errores y sin datos perdidos.');
  process.exit(fallas || perdidos ? 1 : 0);
})();
