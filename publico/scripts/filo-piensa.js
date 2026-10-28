// Filo piensa: entiende frases dichas «a su manera» que las reglas de ordenes-voz.js no
// reconocen. Tiene dos ayudantes:
//   1. Un modelo chico que corre en el celular (modelo-filo/clasificador.json): al instante.
//   2. Una IA entrenada en Google Colab que vive en Hugging Face: para frases raras o con dos
//      órdenes juntas. Si tarda más de 2 s no se la espera.
// Los dos sólo pueden elegir órdenes de la lista ETIQUETAS: nunca inventan una acción nueva.
// La IA contesta en un formato corto («vol.bajar 10 ; musica.siguiente») para tardar poco.
(function (raiz) {
  // Cada etiqueta se convierte en la misma orden que daría ordenes-voz.js.
  // n = número dicho (o null), t = texto (nombre de canción, búsqueda).
  const medio = (para, accion) => () => ({ tipo: 'medios', para, accion });
  const medioN = (para, accion, campo, defecto) => (n) =>
    (n === null || n === undefined ? (defecto === undefined ? { tipo: 'medios', para, accion } : { tipo: 'medios', para, accion, [campo]: defecto }) : { tipo: 'medios', para, accion, [campo]: n });
  const zoomN = (accion) => (n) => (n ? { tipo: 'zoom', accion, valor: n } : { tipo: 'zoom', accion });
  const ETIQUETAS = {
    'diap.mostrar': () => ({ tipo: 'diapositiva', accion: 'mostrar' }),
    'diap.siguiente': () => ({ tipo: 'diapositiva', accion: 'siguiente' }),
    'diap.anterior': () => ({ tipo: 'diapositiva', accion: 'anterior' }),
    'diap.ultima': (n, t, total) => (total > 0 ? { tipo: 'diapositiva', accion: String(total) } : null),
    'diap.ir': (n, t, total) => (n >= 1 && (!total || n <= total) ? { tipo: 'diapositiva', accion: String(n) } : null),
    'medio.pausar': medio(null, 'pausar'),
    'medio.reproducir': medio(null, 'reproducir'),
    'medio.reiniciar': medio(null, 'reiniciar'),
    'medio.mitad': medio(null, 'irMitad'),
    'medio.final': medio(null, 'irFinal'),
    'medio.adelantar': (n) => ({ tipo: 'medios', para: null, accion: 'saltar', valor: Math.min(600, n || 10) }),
    'medio.atrasar': (n) => ({ tipo: 'medios', para: null, accion: 'saltar', valor: -Math.min(600, n || 10) }),
    'musica.reproducir': medio('musica', 'reproducir'),
    'musica.pausar': medio('musica', 'pausar'),
    'musica.siguiente': medio('musica', 'siguiente'),
    'musica.anterior': medio('musica', 'anterior'),
    'musica.elegir': (n) => (n >= 1 ? { tipo: 'medios', para: 'musica', accion: 'elegir', numero: n } : null),
    'musica.buscar': (n, t) => (t ? { tipo: 'medios', para: 'musica', accion: 'buscar', texto: t } : null),
    'musica.azar': medio('musica', 'azar'),
    'musica.terminar': medio('musica', 'terminar'),
    'musica.bucle': () => ({ tipo: 'medios', para: 'musica', accion: 'bucle', valor: true }),
    'musica.sinBucle': () => ({ tipo: 'medios', para: 'musica', accion: 'bucle', valor: false }),
    'musica.cual': medio('musica', 'cual'),
    'video.reproducir': medio('video', 'reproducir'),
    'video.pausar': medio('video', 'pausar'),
    'video.siguiente': medio('video', 'siguiente'),
    'video.anterior': medio('video', 'anterior'),
    'video.elegir': (n) => (n >= 1 ? { tipo: 'medios', para: 'video', accion: 'elegir', numero: n } : null),
    'video.buscar': (n, t) => (t ? { tipo: 'medios', para: 'video', accion: 'buscar', texto: t } : null),
    'video.azar': medio('video', 'azar'),
    'video.terminar': medio('video', 'terminar'),
    'vol.subir': medioN(null, 'subirVolumen', 'valor'),
    'vol.bajar': medioN(null, 'bajarVolumen', 'valor'),
    'vol.poner': (n) => (n !== null && n !== undefined && n <= 100 ? { tipo: 'medios', para: null, accion: 'volumen', valor: n } : null),
    'vol.mitad': () => ({ tipo: 'medios', para: null, accion: 'volumen', valor: 50 }),
    'vol.maximo': () => ({ tipo: 'medios', para: null, accion: 'volumen', valor: 100 }),
    'vol.silencio': () => ({ tipo: 'medios', para: null, accion: 'volumen', valor: 0 }),
    'vol.sonido': medio(null, 'conSonido'),
    'pc.subir': medioN('pc', 'subirVolumen', 'valor'),
    'pc.bajar': medioN('pc', 'bajarVolumen', 'valor'),
    'pc.silencio': () => ({ tipo: 'medios', para: 'pc', accion: 'mudo', valor: true }),
    'pc.sonido': () => ({ tipo: 'medios', para: 'pc', accion: 'mudo', valor: false }),
    'zoom.acercar': zoomN('acercar'),
    'zoom.alejar': zoomN('alejar'),
    'zoom.normal': () => ({ tipo: 'zoom', accion: 'normal' }),
    'zoom.centrar': () => ({ tipo: 'zoom', accion: 'centrar' }),
    'zoom.doble': () => ({ tipo: 'zoom', accion: 'escala', valor: 200 }),
    'zoom.derecha': zoomN('derecha'),
    'zoom.izquierda': zoomN('izquierda'),
    'zoom.arriba': zoomN('arriba'),
    'zoom.abajo': zoomN('abajo'),
    'zoom.cuadrado': () => ({ tipo: 'zoom', accion: 'forma', forma: 'cuadrado' }),
    'boton.completa': () => ({ tipo: 'completa', salir: false }),
    'boton.actualizar': () => ({ tipo: 'boton', id: 'actualizarBtn' }),
    'ayuda': () => ({ tipo: 'ayuda' }),
    'cerrar': () => ({ tipo: 'cerrar' }),
    'repetir': () => ({ tipo: 'repetir' }),
    'filo.calla': () => ({ tipo: 'filo', habla: false }),
    'filo.habla': () => ({ tipo: 'filo', habla: true }),
    'youtube': (n, t) => (t ? { tipo: 'youtube', texto: t } : null)
  };
  // Etiquetas que llevan un texto: el modelo del celular no lo puede sacar, se las pasa a la IA.
  const CON_TEXTO = ['musica.buscar', 'video.buscar', 'youtube'];
  // Etiquetas sólo del modelo del celular: «nada» = alguien hablando (no es una orden);
  // «ia» = es una orden, pero difícil (dos juntas, un nombre): que la piense la IA.
  const NADA = 'nada';
  const IA = 'ia';

  const NUMEROS = {
    cero: 0, uno: 1, una: 1, un: 1, primera: 1, primero: 1, primer: 1, dos: 2, segunda: 2, tres: 3, tercera: 3, tercero: 3,
    cuatro: 4, cuarta: 4, cuarto: 4, cinco: 5, quinta: 5, quinto: 5, seis: 6, sexta: 6, siete: 7, septima: 7,
    ocho: 8, octava: 8, nueve: 9, novena: 9, diez: 10, decima: 10, once: 11, doce: 12, trece: 13, catorce: 14,
    quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veinticinco: 25,
    treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100
  };

  function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // El número de la frase para una etiqueta que lo necesita («baja 10», «la diapositiva cinco»).
  // «un» y «una» sólo cuentan pegados a algo que se cuenta («la una»), no como artículo.
  function numeroDe(frase) {
    const palabras = normalizar(frase).split(' ');
    for (let i = 0; i < palabras.length; i++) {
      const p = palabras[i];
      if (/^[0-9]{1,3}$/.test(p)) return parseInt(p, 10);
      if (p === 'un' || p === 'una') continue;
      if (NUMEROS[p] === undefined) continue;
      let valor = NUMEROS[p];
      const unidad = NUMEROS[palabras[i + 2]];
      if (valor >= 30 && valor < 100 && valor % 10 === 0 && palabras[i + 1] === 'y' && unidad >= 1 && unidad <= 9) valor += unidad;
      return valor;
    }
    return null;
  }

  // Lo que contesta la IA («vol.bajar 10 ; musica.buscar "despacito"»), convertido en órdenes.
  // Algo fuera de la lista se descarta: la IA no puede pedir otra cosa.
  function leerRespuesta(texto, totalDiapositivas) {
    const ordenes = [];
    for (const parte of String(texto || '').split(';').slice(0, 3)) {
      const m = parte.trim().match(/^([a-z.]+)(?:\s+(-?\d{1,3}))?(?:\s+"([^"]{1,60})")?$/i);
      if (!m || !ETIQUETAS[m[1]]) continue;
      const orden = ETIQUETAS[m[1]](m[2] === undefined ? null : Math.abs(parseInt(m[2], 10)), m[3] ? m[3].trim() : '', totalDiapositivas || 0);
      if (orden) ordenes.push(orden);
    }
    return ordenes;
  }

  // ---- Modelo del celular: suma de pesos por pedacitos de la frase ----
  // Los pedacitos son las palabras, los pares de palabras y trozos de 3 letras; cada uno cae en
  // una de 4096 cajitas (con un número sacado de sus letras), así el modelo no necesita guardar
  // un diccionario. entrenar-clasificador.js (Node) usa estas MISMAS funciones para aprender.
  const CAJITAS = 4096;
  function cajita(texto) {
    let h = 2166136261;
    for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h % CAJITAS;
  }
  function pedacitos(frase) {
    const palabras = normalizar(frase).split(' ').filter(Boolean)
      .map(p => (/^[0-9]+$/.test(p) || NUMEROS[p] !== undefined && p !== 'un' && p !== 'una' ? '#' : p));
    const lista = ['largo:' + Math.min(palabras.length, 12)];
    palabras.forEach((p, i) => {
      lista.push('p:' + p);
      if (i) lista.push('pp:' + palabras[i - 1] + ' ' + p);
      const w = '<' + p + '>';
      for (let j = 0; j + 3 <= w.length; j++) lista.push('l:' + w.slice(j, j + 3));
    });
    if (palabras.includes('y')) lista.push('tiene_y');
    const cuenta = new Map();
    for (const x of lista) { const c = cajita(x); cuenta.set(c, (cuenta.get(c) || 0) + 1); }
    const norma = Math.sqrt([...cuenta.values()].reduce((s, v) => s + v * v, 0)) || 1;
    return [...cuenta].map(([c, v]) => [c, v / norma]);
  }
  // modelo = { clases: [...], escala: [...], pesos: Int8Array (clases × CAJITAS), sesgo: [...] }
  function cargarModelo(json) {
    const bin = typeof atob === 'function' ? atob(json.pesos) : Buffer.from(json.pesos, 'base64').toString('binary');
    const pesos = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pesos[i] = bin.charCodeAt(i) << 24 >> 24;
    return { clases: json.clases, escala: json.escala, sesgo: json.sesgo, pesos, umbral: json.umbral || {} };
  }
  // Las 3 etiquetas más probables, con su probabilidad (0 a 1).
  function clasificar(modelo, frase) {
    const f = pedacitos(frase);
    const k = modelo.clases.length;
    const notas = new Array(k);
    for (let c = 0; c < k; c++) {
      let s = 0;
      const base = c * CAJITAS;
      for (const [i, v] of f) s += modelo.pesos[base + i] * v;
      notas[c] = s * modelo.escala[c] + modelo.sesgo[c];
    }
    const mayor = Math.max(...notas);
    const ex = notas.map(x => Math.exp(x - mayor));
    const suma = ex.reduce((a, b) => a + b, 0);
    return ex.map((e, c) => ({ etiqueta: modelo.clases[c], prob: e / suma }))
      .sort((a, b) => b.prob - a.prob).slice(0, 3);
  }

  const publico = { ETIQUETAS, CON_TEXTO, NADA, IA, CAJITAS, normalizar, numeroDe, leerRespuesta, pedacitos, cargarModelo, clasificar };
  if (typeof module !== 'undefined' && module.exports) module.exports = publico;
  else raiz.FiloPiensa = publico;
})(typeof window !== 'undefined' ? window : globalThis);
