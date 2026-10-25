// Entrena el modelo chico que corre en el celular (sin internet, al instante) y lo guarda en
// publico/modelo-filo/clasificador.json. Tarda segundos y usa poca memoria: no hace falta Colab.
// Aprende con datos/entrenar.jsonl y se mide con datos/prueba.jsonl (formas de decir que no vio).
// Uso: node entrenamiento-filo/entrenar-clasificador.js
const fs = require('fs');
const path = require('path');
const { CAJITAS, pedacitos, cargarModelo, clasificar } = require('../publico/scripts/filo-piensa');

const leer = (nombre) => fs.readFileSync(path.join(__dirname, 'datos', nombre), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const entrenar = leer('entrenar.jsonl');
const prueba = leer('prueba.jsonl');
const clases = [...new Set(entrenar.map(x => x.clase))].sort();
const indice = new Map(clases.map((c, i) => [c, i]));
const K = clases.length;
const ejemplos = entrenar.map(x => ({ f: pedacitos(x.frase), y: indice.get(x.clase) }));

// Regresión logística de varias clases, aprendida con Adam.
const W = new Float32Array(K * CAJITAS);
const b = new Float32Array(K);
const mW = new Float32Array(W.length), vW = new Float32Array(W.length);
const mb = new Float32Array(K), vb = new Float32Array(K);
const APRENDE = 0.02, B1 = 0.9, B2 = 0.999;
const L2 = Number(process.env.L2 || 5e-5), VUELTAS = Number(process.env.VUELTAS || 6);
let paso = 0;
let semilla = 7;
const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
const notas = new Float32Array(K);
for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
  for (let i = ejemplos.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [ejemplos[i], ejemplos[j]] = [ejemplos[j], ejemplos[i]]; }
  let perdida = 0;
  for (const { f, y } of ejemplos) {
    paso++;
    for (let c = 0; c < K; c++) { let s = b[c]; const base = c * CAJITAS; for (const [k, v] of f) s += W[base + k] * v; notas[c] = s; }
    let mayor = -Infinity; for (let c = 0; c < K; c++) if (notas[c] > mayor) mayor = notas[c];
    let suma = 0; for (let c = 0; c < K; c++) { notas[c] = Math.exp(notas[c] - mayor); suma += notas[c]; }
    perdida -= Math.log(notas[y] / suma + 1e-12);
    const c1 = 1 - Math.pow(B1, paso), c2 = 1 - Math.pow(B2, paso);
    for (let c = 0; c < K; c++) {
      const g = notas[c] / suma - (c === y ? 1 : 0);
      if (Math.abs(g) < 1e-4) continue; // casi nada que aprender en esta clase
      const base = c * CAJITAS;
      for (const [k, v] of f) {
        const i = base + k;
        const gi = g * v + L2 * W[i];
        mW[i] = B1 * mW[i] + (1 - B1) * gi; vW[i] = B2 * vW[i] + (1 - B2) * gi * gi;
        W[i] -= APRENDE * (mW[i] / c1) / (Math.sqrt(vW[i] / c2) + 1e-8);
      }
      mb[c] = B1 * mb[c] + (1 - B1) * g; vb[c] = B2 * vb[c] + (1 - B2) * g * g;
      b[c] -= APRENDE * (mb[c] / c1) / (Math.sqrt(vb[c] / c2) + 1e-8);
    }
  }
  console.log(`vuelta ${vuelta + 1}: pérdida ${(perdida / ejemplos.length).toFixed(4)}`);
}

// Se guarda en enteros chicos (-127 a 127) por clase: pesa 4 veces menos y el resultado casi no cambia.
const pesos = new Int8Array(W.length);
const escala = [];
for (let c = 0; c < K; c++) {
  let mayor = 0; for (let k = 0; k < CAJITAS; k++) mayor = Math.max(mayor, Math.abs(W[c * CAJITAS + k]));
  const e = mayor / 127 || 1;
  escala.push(Number(e.toPrecision(6)));
  for (let k = 0; k < CAJITAS; k++) pesos[c * CAJITAS + k] = Math.round(W[c * CAJITAS + k] / e);
}
const json = { version: 1, clases, escala, sesgo: Array.from(b, x => Number(x.toFixed(5))), pesos: Buffer.from(pesos.buffer).toString('base64') };
const modelo = cargarModelo(json);
const bien = (lista) => lista.filter(x => clasificar(modelo, x.frase)[0].etiqueta === x.clase).length / lista.length;
console.log(`acierto en entrenar: ${(bien(entrenar) * 100).toFixed(1)} %  ·  en prueba (frases que no vio): ${(bien(prueba) * 100).toFixed(1)} %`);
const destino = path.join(__dirname, '..', 'publico', 'modelo-filo', 'clasificador.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(json));
console.log(`guardado: ${destino} (${Math.round(fs.statSync(destino).size / 1024)} KB)`);
