// Órdenes por voz: convierte lo que oyó el reconocedor en una orden para el control.
// No escucha nada: recibe frases ya escritas (las que da el navegador o la app) y decide qué
// quiso decir la persona. Está aparte de control.js para poder probarlo con frases de ejemplo
// (pruebas/ordenes-voz.test.js).
(function (raiz) {
  const PALABRAS = {
    mostrar: ['mostrar', 'empezar', 'comenzar', 'iniciar', 'arrancar', 'arranca', 'inicio'],
    siguiente: ['siguiente', 'adelante', 'avanza', 'avanzar', 'proximo', 'proxima', 'sigue'],
    anterior: ['anterior', 'atras', 'regresa', 'regresar', 'retrocede', 'retroceder', 'vuelve'],
    musica: ['musica', 'cancion', 'canciones'],
    video: ['video', 'videos'],
    poner: ['pon', 'pone', 'poner', 'ponme', 'poneme', 'ponle', 'ponga', 'ponlo', 'ponela', 'ponelo'],
    pausar: ['pausa', 'pausar', 'pausalo', 'pausala', 'detener', 'detene', 'deten', 'detenlo', 'parar', 'paralo', 'parala'],
    reproducir: ['reproduce', 'reproducir', 'reproducilo', 'reproducila', 'reproduci', 'play', 'continua', 'continuar', 'reanudar', 'reanuda'],
    quitar: ['quita', 'quitar', 'quitalo', 'saca', 'sacar', 'sacalo', 'termina', 'terminar', 'cierra', 'cerrar'],
    volumen: ['volumen', 'sonido'],
    subir: ['sube', 'subi', 'subir', 'subele', 'subile', 'subilo', 'aumenta', 'aumentar'],
    bajar: ['baja', 'bajar', 'bajale', 'bajalo', 'bajala', 'disminuye', 'disminuir'],
    mitad: ['mitad'],
    maximo: ['maximo', 'tope'],
    silencio: ['silencio', 'silenciar', 'silencia', 'mudo']
  };

  const NUMEROS = {
    cero: 0, uno: 1, una: 1, primera: 1, primero: 1, primer: 1, dos: 2, segunda: 2, segundo: 2,
    tres: 3, tercera: 3, tercero: 3, tercer: 3, cuatro: 4, cuarta: 4, cuarto: 4, cinco: 5, quinta: 5, quinto: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
    dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40,
    cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100
  };

  // Quita tildes y signos: «¡Atrás!» y «atras» valen lo mismo.
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ\s]/g, ' ')
      .trim();
  }

  // ¿Se parecen? Iguales, o con una sola letra de diferencia en palabras largas («sigiente»,
  // «siguente», «bolumen»): el reconocedor a veces oye mal una letra.
  function parecidas(a, b) {
    if (a === b) return true;
    if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let fallas = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++fallas > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return fallas + (a.length - i) + (b.length - j) <= 1;
  }

  function dice(palabras, grupo) {
    return palabras.some(p => PALABRAS[grupo].some(clave => parecidas(p, clave)));
  }

  function numeroDe(palabras) {
    for (const p of palabras) {
      if (/^[0-9]{1,3}$/.test(p)) return parseInt(p, 10);
      if (NUMEROS[p] !== undefined) return NUMEROS[p];
    }
    return null;
  }

  // Lo que quiere decir UNA frase, o null si no es ninguna orden.
  // { tipo: 'diapositiva', accion: 'mostrar' | 'siguiente' | 'anterior' | '3' }
  // { tipo: 'medios', para: 'musica' | 'video' | null, accion, numero?, valor? }
  function entender(frase, totalDiapositivas) {
    const palabras = normalizar(frase).split(/\s+/).filter(Boolean);
    if (!palabras.length) return null;
    const numero = numeroDe(palabras);
    const deMusica = dice(palabras, 'musica');
    const deVideo = dice(palabras, 'video');
    const para = deVideo ? 'video' : deMusica ? 'musica' : null;
    const deVolumen = dice(palabras, 'volumen');
    // Una orden suelta («bajale», «pausa», «a la mitad») se acepta si la frase es corta. En una
    // frase larga esas palabras suelen ser parte de lo que la persona está explicando («la
    // temperatura baja…»), así que ahí hace falta nombrar el volumen, la música o el video.
    const clara = palabras.length <= 4 || deVolumen || para !== null;

    // Volumen: «baja el volumen», «volumen a la mitad», «volumen 30», «silencio».
    if (clara && dice(palabras, 'silencio')) return { tipo: 'medios', para, accion: 'volumen', valor: 0 };
    if (clara && dice(palabras, 'mitad')) return { tipo: 'medios', para, accion: 'volumen', valor: 50 };
    if (deVolumen || (clara && (dice(palabras, 'subir') || dice(palabras, 'bajar')))) {
      if (dice(palabras, 'maximo')) return { tipo: 'medios', para, accion: 'volumen', valor: 100 };
      if (dice(palabras, 'subir')) return { tipo: 'medios', para, accion: 'subirVolumen' };
      if (dice(palabras, 'bajar')) return { tipo: 'medios', para, accion: 'bajarVolumen' };
      if (numero !== null && numero <= 100) return { tipo: 'medios', para, accion: 'volumen', valor: numero };
      return null;
    }

    if (clara && dice(palabras, 'pausar')) return { tipo: 'medios', para, accion: 'pausar' };
    if (deVideo && dice(palabras, 'quitar')) return { tipo: 'medios', para: 'video', accion: 'terminar' };

    // Música y video: «pon música», «música 2», «siguiente canción», «siguiente video».
    if (para) {
      if (dice(palabras, 'siguiente')) return { tipo: 'medios', para, accion: 'siguiente' };
      if (dice(palabras, 'anterior')) return { tipo: 'medios', para, accion: 'anterior' };
      if (numero !== null && numero >= 1) return { tipo: 'medios', para, accion: 'elegir', numero };
      if (dice(palabras, 'poner') || dice(palabras, 'reproducir') || palabras.length <= 2) {
        return { tipo: 'medios', para, accion: 'reproducir' };
      }
      return null;
    }
    if (clara && dice(palabras, 'reproducir')) return { tipo: 'medios', para: null, accion: 'reproducir' };

    // Diapositivas, como siempre.
    if (dice(palabras, 'mostrar')) return { tipo: 'diapositiva', accion: 'mostrar' };
    if (dice(palabras, 'siguiente')) return { tipo: 'diapositiva', accion: 'siguiente' };
    if (dice(palabras, 'anterior')) return { tipo: 'diapositiva', accion: 'anterior' };
    // Un número suelto («tres», «diapositiva 7») va a esa diapositiva; dentro de una frase larga
    // es parte de lo que se está contando («hay una razón…»), no una orden.
    if (palabras.length <= 4 && numero !== null && numero >= 1 && numero <= totalDiapositivas) return { tipo: 'diapositiva', accion: String(numero) };
    return null;
  }

  // El reconocedor da varias versiones de lo que oyó, de la más probable a la menos: se usa la
  // primera que sea una orden.
  function interpretarVoz(alternativas, totalDiapositivas) {
    for (const frase of alternativas || []) {
      const orden = entender(frase, totalDiapositivas || 0);
      if (orden) return orden;
    }
    return null;
  }

  // Frases que se le pasan al reconocedor de la app para que las prefiera al oír.
  const FRASES_DE_AYUDA = [
    'mostrar', 'siguiente', 'atrás', 'anterior', 'pon música', 'música uno', 'música dos', 'siguiente canción',
    'canción anterior', 'pausa', 'reproducir', 'sube el volumen', 'baja el volumen', 'volumen a la mitad',
    'volumen al máximo', 'silencio', 'pon video', 'video uno', 'video dos', 'siguiente video', 'quita el video'
  ];

  const publico = { interpretarVoz, normalizar, FRASES_DE_AYUDA };
  if (typeof module !== 'undefined' && module.exports) module.exports = publico;
  else raiz.OrdenesVoz = publico;
})(typeof window !== 'undefined' ? window : globalThis);
