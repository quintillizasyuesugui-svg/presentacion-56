// Decide qué hacer con una frase oída: usar las reglas, el modelo del celular, preguntarle a la
// IA de Hugging Face («nube») o no hacer nada (alguien hablando). No hace la orden: sólo decide.
// La usan control.js y entrenamiento-filo/medir.js, así lo que se mide es lo mismo que se usa.
(function (raiz) {
  const FP = typeof module !== 'undefined' && module.exports ? require('./filo-piensa') : raiz.FiloPiensa;
  // Qué tan seguro tiene que estar el modelo del celular para hacer la orden sin preguntar.
  const SEGURO = 0.8;
  // Para ganarle a las reglas, casi seguro.
  const MUY_SEGURO = 0.97;
  // Qué tan seguro para decir «esto es charla, no es una orden».
  const CHARLA = 0.6;
  // Frases más largas no se mandan a la IA: es alguien explicando.
  const MAX_PALABRAS = 16;

  // { frase, reglas (lo que entendió ordenes-voz.js o null), modelo (o null), total }
  // → { camino: 'reglas' | 'celular' | 'nube' | 'ignorar', ordenes: [...], etiqueta, prob }
  // Una parte sola: lo que dicen las reglas, o el modelo si está muy seguro.
  function unaParte(parte, modelo, total, interpretar) {
    const r = interpretar ? interpretar([parte], total) : null;
    if (r && r.tipo !== 'repetir') return r;
    if (!modelo) return null;
    const top = FP.clasificar(modelo, parte)[0];
    if (top.etiqueta === FP.IA || top.etiqueta === FP.NADA || top.prob < SEGURO) return null;
    return FP.ETIQUETAS[top.etiqueta](FP.numeroDe(parte), '', total || 0);
  }
  const UNE = /\s+y\s+(?:luego|tambien|despues|ademas|ahi)?\s*/;

  // interpretar = OrdenesVoz.interpretarVoz (para entender cada parte de una frase con «y»).
  function decidir({ frase, reglas, modelo, total, interpretar }) {
    const palabras = FP.normalizar(frase).split(' ').filter(Boolean);
    const conY = palabras.length >= 4 && palabras.slice(1, -1).includes('y');
    const top = modelo ? FP.clasificar(modelo, frase)[0] : null;
    // Dos órdenes juntas («baja la música y pasa la foto»): las reglas sólo harían una. Si cada
    // parte se entiende sola, se hacen las dos al instante; si no, que lo piense la IA.
    if (conY && palabras.length <= MAX_PALABRAS + 6 && (!top || top.etiqueta !== FP.NADA || top.prob < CHARLA)) {
      const partes = FP.normalizar(frase).split(UNE).filter(Boolean);
      if (partes.length >= 2 && partes.length <= 3) {
        const ordenes = partes.map(p => unaParte(p, modelo, total, interpretar));
        if (ordenes.every(Boolean)) return { camino: 'celular', ordenes };
        if (ordenes.some(Boolean) || (top && top.etiqueta === FP.IA)) return { camino: 'nube', ordenes: [], etiqueta: top && top.etiqueta, prob: top && top.prob };
      }
    }
    // El temporizador lo entienden sólo las reglas (el modelo chico no lo aprendió).
    if (reglas && reglas.tipo === 'temporizador') return { camino: 'reglas', ordenes: [reglas] };
    // Las reglas a veces se confunden con frases largas («vuelve a cargar la página» no es
    // «vuelve» = atrás): si el modelo está casi seguro de otra cosa, gana el modelo.
    if (reglas && top && palabras.length >= 3 && top.prob >= MUY_SEGURO && top.etiqueta !== FP.IA && top.etiqueta !== FP.NADA) {
      const orden = FP.ETIQUETAS[top.etiqueta](FP.numeroDe(frase), '', total || 0);
      if (orden && JSON.stringify(orden) !== JSON.stringify(reglas)) return { camino: 'celular', ordenes: [orden], etiqueta: top.etiqueta, prob: top.prob };
    }
    // Frase larga en la que las reglas y el modelo no están de acuerdo: que decida la IA (antes
    // que hacer algo equivocado al instante).
    if (reglas && top && palabras.length >= 4 && palabras.length <= MAX_PALABRAS && top.prob >= SEGURO && top.etiqueta !== FP.NADA) {
      const orden = top.etiqueta === FP.IA ? null : FP.ETIQUETAS[top.etiqueta](FP.numeroDe(frase), '', total || 0);
      if (!orden || JSON.stringify(orden) !== JSON.stringify(reglas)) return { camino: 'nube', ordenes: [], etiqueta: top.etiqueta, prob: top.prob, reglas };
    }
    if (reglas) return { camino: 'reglas', ordenes: [reglas] };
    if (!top) return { camino: 'ignorar', ordenes: [] };
    if (top.etiqueta === FP.NADA && top.prob >= CHARLA) return { camino: 'ignorar', ordenes: [], etiqueta: top.etiqueta, prob: top.prob };
    if (top.etiqueta !== FP.IA && top.etiqueta !== FP.NADA && top.prob >= SEGURO) {
      const orden = FP.ETIQUETAS[top.etiqueta](FP.numeroDe(frase), '', total || 0);
      if (orden) return { camino: 'celular', ordenes: [orden], etiqueta: top.etiqueta, prob: top.prob };
    }
    if (palabras.length > MAX_PALABRAS) return { camino: 'ignorar', ordenes: [] };
    return { camino: 'nube', ordenes: [], etiqueta: top.etiqueta, prob: top.prob };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = decidir;
  else raiz.filoDecide = decidir;
})(typeof window !== 'undefined' ? window : globalThis);
