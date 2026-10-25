// Mide qué pasa con frases que el entrenamiento no vio (datos/prueba.jsonl), antes y después:
//   antes   = sólo las reglas de ordenes-voz.js (como era)
//   después = reglas + modelo del celular; lo que el modelo duda iría a la IA de Hugging Face
// Lo peor es hacer algo equivocado al instante: eso se cuenta aparte.
// Uso: node entrenamiento-filo/medir.js
const fs = require('fs');
const path = require('path');
const { interpretarVoz } = require('../publico/scripts/ordenes-voz');
const FP = require('../publico/scripts/filo-piensa');
const decidir = require('../publico/scripts/filo-decide');

const TOTAL = 20;
const prueba = fs.readFileSync(path.join(__dirname, 'datos', 'prueba.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const modelo = FP.cargarModelo(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'publico', 'modelo-filo', 'clasificador.json'), 'utf8')));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esperado = (x) => (x.salida === FP.NADA ? [] : FP.leerRespuesta(x.salida, TOTAL));

const antes = { bien: 0, mal: 0, nada: 0 };
const despues = { bien: 0, mal: 0, nube: 0, nada: 0 };
const males = [];
for (const x of prueba) {
  const quiere = esperado(x);
  // Antes: las reglas solas. Una orden de dos partes sólo hacía la primera: cuenta como mal.
  const r = interpretarVoz([x.frase], TOTAL);
  if (!r) { if (quiere.length) antes.nada++; else antes.bien++; }
  else if (quiere.length === 1 && igual(r, quiere[0])) antes.bien++;
  else antes.mal++;
  // Después.
  const d = decidir({ frase: x.frase, reglas: r, modelo, total: TOTAL, interpretar: interpretarVoz });
  if (d.camino === 'nube') { despues.nube++; continue; }
  if (d.camino === 'ignorar') { if (quiere.length) despues.nada++; else despues.bien++; continue; }
  if (igual(d.ordenes, quiere)) despues.bien++;
  else { despues.mal++; if (males.length < 25) males.push(`${d.camino}: «${x.frase}» → ${JSON.stringify(d.ordenes)} (quería ${x.salida})`); }
}
const pct = (n) => (n * 100 / prueba.length).toFixed(1) + ' %';
console.log(`${prueba.length} frases nuevas`);
console.log(`ANTES   bien ${pct(antes.bien)} · mal ${pct(antes.mal)} · no hizo nada ${pct(antes.nada)}`);
console.log(`DESPUÉS bien al instante ${pct(despues.bien)} · mal ${pct(despues.mal)} · va a la IA ${pct(despues.nube)} · no hizo nada ${pct(despues.nada)}`);
if (process.argv.includes('--males')) console.log(males.join('\n'));
