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
    pc: ['pc', 'computadora', 'compu', 'computador', 'ordenador', 'windows', 'parlante', 'parlantes', 'bocina', 'bocinas'],
    poner: ['pon', 'pone', 'poner', 'ponme', 'poneme', 'ponle', 'ponga', 'ponlo', 'ponela', 'ponelo'],
    pausar: ['pausa', 'pausar', 'pausalo', 'pausala', 'detener', 'detene', 'deten', 'detenlo', 'parar', 'paralo', 'parala'],
    reproducir: ['reproduce', 'reproducir', 'reproducilo', 'reproducila', 'reproduci', 'play', 'continua', 'continuar', 'reanudar', 'reanuda'],
    quitar: ['quita', 'quitar', 'quitalo', 'saca', 'sacar', 'sacalo', 'termina', 'terminar', 'cierra', 'cerrar'],
    volumen: ['volumen', 'sonido'],
    subir: ['sube', 'subi', 'subir', 'subele', 'subile', 'subilo', 'aumenta', 'aumentar', 'fuerte'],
    bajar: ['baja', 'bajar', 'bajale', 'bajalo', 'bajala', 'disminuye', 'disminuir', 'suave', 'bajito'],
    azar: ['azar', 'aleatoria', 'aleatorio', 'cualquiera', 'random', 'sorpresa'],
    actualizar: ['actualiza', 'actualizar', 'actualizala', 'recarga', 'recargar', 'recargala', 'refresca', 'refrescar'],
    abrir: ['abre', 'abrir', 'abri', 'lista', 'menu', 'muestrame', 'elegir', 'elige'],
    ayuda: ['ayuda', 'comandos', 'ordenes'],
    mitad: ['mitad'],
    maximo: ['maximo', 'tope'],
    silencio: ['silencio', 'silenciar', 'silencia', 'mudo', 'mutea', 'mutear', 'mutealo'],
    // «activa el sonido», «quita el silencio», «desmutea»: vuelve el volumen que tenía.
    activar: ['activa', 'activar', 'activalo', 'prende', 'prender', 'enciende', 'encender', 'devuelve', 'desmutea', 'desmutear', 'desmutealo', 'desilencia'],
    ultima: ['ultima', 'ultimo'],
    doble: ['doble'],
    triple: ['triple'],
    // Formas para mostrar sólo una parte, como «✂ Zona»: «un cuadrado», «un rectángulo alto».
    cuadrado: ['cuadrado', 'cuadrada', 'cuadradito'],
    rectangulo: ['rectangulo', 'rectangular'],
    vertical: ['alto', 'vertical', 'parado'],
    zona: ['zona', 'recorte', 'recorta', 'recortar'],
    imagen: ['imagen', 'foto', 'diapositiva', 'zoom'],
    agrandar: ['agranda', 'agrandar', 'agrandala', 'agrandalo', 'acerca', 'acercar', 'acercala', 'acercalo', 'amplia', 'ampliar', 'grande'],
    achicar: ['achica', 'achicar', 'achicala', 'achicalo', 'aleja', 'alejar', 'alejala', 'alejalo', 'reduce', 'reducir', 'chico', 'chica', 'pequeno', 'pequena'],
    normal: ['normal', 'entera', 'completa', 'original'],
    adelantar: ['adelanta', 'adelantar', 'adelantala', 'adelantalo', 'adelantale', 'adelante'],
    atrasar: ['atrasa', 'atrasar', 'atrasala', 'atrasalo', 'rebobina', 'rebobinar', 'atras', 'retrocede', 'retroceder'],
    reiniciar: ['reiniciar', 'reinicia', 'reiniciala', 'reinicialo', 'principio', 'comienzo', 'inicio'],
    bucle: ['bucle', 'repetir', 'repite', 'repeti', 'repetila', 'repetilo', 'loop'],
    apagar: ['quita', 'quitar', 'saca', 'sacar', 'sin', 'apaga', 'apagar', 'desactiva', 'desactivar'],
    irA: ['ve', 'vete', 'va', 'vaya', 'ir', 'anda', 'andate', 'salta', 'saltar', 'lleva', 'llevala', 'llevalo'],
    // El temporizador es el «avance automático»: pasa sola de imagen cada tanto.
    temporizador: ['temporizador', 'temporizadora', 'temporisador', 'temporizar', 'cronometro', 'automatico'],
    segundos: ['segundo', 'segundos'],
    minutos: ['minuto', 'minutos'],
    final: ['final', 'fin'],
    casi: ['casi'],
    tope: ['tope', 'todo', 'fondo', 'borde'],
    centrar: ['centra', 'centrar', 'centro', 'centrala', 'centralo', 'centrame'],
    cerrar: ['cierra', 'cerrar', 'cerra', 'cierre', 'cerrala'],
    lugar: ['pantalla', 'sesion', 'cuenta'],
    derecha: ['derecha'],
    izquierda: ['izquierda'],
    arriba: ['arriba'],
    abajo: ['abajo']
  };

  const NUMEROS = {
    cero: 0, uno: 1, una: 1, primera: 1, primero: 1, primer: 1, dos: 2, segunda: 2, segundo: 2,
    tres: 3, tercera: 3, tercero: 3, tercer: 3, cuatro: 4, cuarta: 4, cuarto: 4, cinco: 5, quinta: 5, quinto: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
    dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40,
    cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100,
    veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
  };
  // Palabras que, justo antes del número, dicen «hasta ese número»: «baja a 10», «sube al 80».
  const HASTA = ['a', 'al', 'en', 'hasta'];
  // Palabras que no cuentan al buscar una canción o un video por su nombre.
  const RELLENO = ['la', 'el', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'se', 'llama', 'mi', 'me', 'por', 'favor',
    'le', 'lo', 'al', 'a', 'dale', 'ese', 'esa', 'este', 'esta', 'otra', 'vez', 'nuevo', 'ahora', 'ya', 'porfa', 'filo'];

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

  // El primer número de la frase y en qué palabra empieza. Junta «treinta y cinco» (35).
  function numeroCon(palabras) {
    for (let i = 0; i < palabras.length; i++) {
      const p = palabras[i];
      if (/^[0-9]{1,3}$/.test(p)) return { valor: parseInt(p, 10), en: i };
      if (NUMEROS[p] === undefined) continue;
      // «al segundo treinta»: ahí «segundo» es la unidad, no el número 2.
      if ((p === 'segundo' || p === 'segunda') && palabras.slice(i + 1).some(x => /^[0-9]{1,3}$/.test(x) || NUMEROS[x] !== undefined)) continue;
      let valor = NUMEROS[p];
      const unidad = NUMEROS[palabras[i + 2]];
      if (valor >= 30 && valor < 100 && valor % 10 === 0 && palabras[i + 1] === 'y' && unidad >= 1 && unidad <= 9) valor += unidad;
      return { valor, en: i };
    }
    return null;
  }
  function numeroDe(palabras) {
    const n = numeroCon(palabras);
    return n ? n.valor : null;
  }

  // Volumen con número: «volumen 30» o «baja a 10» lo dejan en ese número; «sube 20» o
  // «baja el volumen 15» lo mueven esa cantidad; «baja 0» lo deja en cero.
  // Sin número, sube o baja un paso (lo decide el control).
  function volumenConNumero(palabras, hacer) {
    const n = numeroCon(palabras);
    const subir = dice(palabras, 'subir');
    const bajar = dice(palabras, 'bajar');
    if (dice(palabras, 'maximo')) return hacer('volumen', 100);
    if (!n || n.valor > 100) {
      if (subir) return hacer('subirVolumen');
      if (bajar) return hacer('bajarVolumen');
      return null;
    }
    const hasta = HASTA.includes(palabras[n.en - 1]);
    if ((subir || bajar) && !hasta && n.valor > 0) return hacer(subir ? 'subirVolumen' : 'bajarVolumen', n.valor);
    return hacer('volumen', n.valor);
  }

  // Lo que quiere decir UNA frase, o null si no es ninguna orden.
  // { tipo: 'diapositiva', accion: 'mostrar' | 'siguiente' | 'anterior' | '3' }
  // { tipo: 'medios', para: 'musica' | 'video' | 'pc' | null, accion, numero?, valor? }
  //   («pc» es el volumen de Windows: sólo volumen, subir/bajar y silencio con accion 'mudo')
  // { tipo: 'repetir' } — «un poco más»: lo último otra vez
  // { tipo: 'cerrar' } — «cierra la pantalla»: terminar y dejarla libre
  // { tipo: 'zoom', accion: 'acercar' | 'alejar' | 'normal' | 'derecha' | 'izquierda' | 'arriba' | 'abajo' }
  function entender(frase, totalDiapositivas) {
    const palabras = normalizar(frase).split(/\s+/).filter(Boolean);
    if (!palabras.length) return null;
    const numero = numeroDe(palabras);
    const deMusica = dice(palabras, 'musica');
    const deVideo = dice(palabras, 'video');
    const para = deVideo ? 'video' : deMusica ? 'musica' : null;
    const deVolumen = dice(palabras, 'volumen');
    const corta4 = palabras.length <= 4;

    // «Filo apágate» la deja dormida (el micrófono sigue oyendo, pero no obedece nada);
    // «Filo enciéndete» la despierta. Sólo frases cortas hechas de estas palabras.
    if (palabras.length <= 4) {
      const junto = palabras.join(' ').replace(/\b(apaga|enciende|prende|despierta|activa) te\b/g, '$1te');
      const dichas = junto.split(' ');
      const RELLENO = ['filo', 'ya', 'ahora', 'por', 'favor', 'oye', 'hola', 'te'];
      const APAGARSE = ['apagate', 'duermete', 'desconectate', 'descansa'];
      const PRENDERSE = ['enciendete', 'prendete', 'despierta', 'despiertate', 'activate'];
      const conFilo = dichas.includes('filo');
      const soloEso = (lista, sueltas) => dichas.some(p => lista.includes(p) || (conFilo && sueltas.includes(p))) &&
        dichas.every(p => RELLENO.includes(p) || lista.includes(p) || sueltas.includes(p));
      if (soloEso(APAGARSE, ['apaga', 'apagar', 'duerme'])) return { tipo: 'filoEncendida', si: false };
      if (soloEso(PRENDERSE, ['enciende', 'encender', 'prende', 'prender', 'activa'])) return { tipo: 'filoEncendida', si: true };
    }

    // Filo contesta hablando: «Filo cállate», «no hables» la callan; «Filo habla» la prende.
    if (palabras.length <= 4) {
      const callar = palabras.some(p => ['callate', 'calla', 'callada', 'shh', 'shhh'].includes(p)) ||
        (palabras.includes('no') && palabras.some(p => ['hables', 'hable', 'hablas'].includes(p)));
      if (callar) return { tipo: 'filo', habla: false };
      if (palabras.includes('filo') && palabras.some(p => ['habla', 'hablame', 'responde', 'contesta', 'vuelve'].includes(p))) return { tipo: 'filo', habla: true };
    }

    // «busca Camilo», «búscame en YouTube la canción de Camilo»: busca videos en YouTube.
    if (['busca', 'buscar', 'buscame', 'buscale', 'encuentra', 'encuentrame'].includes(palabras[0]) && palabras.length >= 2) {
      const texto = palabras.slice(1).filter((p, i, todas) =>
        !(i < 3 && ['en', 'youtube', 'un', 'una', 'el', 'la', 'video', 'videos', 'de'].includes(p) && todas.slice(0, i).every(q => ['en', 'youtube', 'un', 'una', 'el', 'la', 'video', 'videos', 'de'].includes(q))));
      if (texto.length) return { tipo: 'youtube', texto: texto.join(' ') };
    }

    // Temporizador: «pon el temporizador», «temporizador a 10 segundos», «aumenta el temporizador»,
    // «baja el temporizador 5», «apaga el temporizador», «¿cuánto tiene el temporizador?».
    if (dice(palabras, 'temporizador')) {
      const enMinutos = dice(palabras, 'minutos');
      // «un minuto» sin número dicho = 1 minuto.
      const cuantos = numero !== null ? numero : (enMinutos ? 1 : null);
      const segundos = cuantos !== null && cuantos > 0 ? Math.round(cuantos * (enMinutos ? 60 : 1)) : null;
      // «a 20», «hasta 30»: ese tiempo exacto, aunque diga «sube» o «baja».
      const hastaNumero = segundos !== null && palabras.some((p, i) => HASTA.includes(p) && i + 1 < palabras.length &&
        (/^\d+$/.test(palabras[i + 1]) || NUMEROS[palabras[i + 1]] !== undefined));
      const t = (accion, valor) => (valor === undefined ? { tipo: 'temporizador', accion } : { tipo: 'temporizador', accion, valor });
      if (dice(palabras, 'apagar') || dice(palabras, 'pausar') || palabras.some(p => ['cancela', 'cancelar', 'cancelalo', 'detenlo'].includes(p)) ||
        (palabras.includes('para') && segundos === null)) return t('apagar');
      if (palabras.some(p => ['cuanto', 'cuantos', 'cuanta', 'cuantas'].includes(p)) || (palabras.length <= 4 && ['que', 'como'].includes(palabras[0]))) return t('cual');
      if (hastaNumero) return t('poner', segundos);
      if (dice(palabras, 'subir') || palabras.includes('mas') || palabras.some(p => ['alarga', 'alargar', 'alargalo', 'agranda', 'agrandalo'].includes(p))) return t('mas', segundos || 5);
      if (dice(palabras, 'bajar') || palabras.includes('menos') || palabras.some(p => ['acorta', 'acortar', 'acortalo', 'reduce', 'reducir', 'reducelo', 'achica', 'achicalo'].includes(p))) return t('menos', segundos || 5);
      if (segundos) return t('poner', segundos);
      return t('prender');
    }

    // Botones del control por voz (frases cortas): pantalla completa, actualizar, listas, ayuda.
    // «pantalla completa», «pon el video en pantalla completa», «la presentación en pantalla
    // completa», «quita la pantalla completa». Sin decir «celular» es la pantalla de la PC.
    if (palabras.length <= 8 && palabras.includes('completa') &&
        (dice(palabras, 'lugar') || para || palabras.some(p => ['presentacion', 'diapositiva', 'diapositivas', 'youtube'].includes(p)))) {
      if (palabras.some(p => ['celular', 'telefono', 'mio', 'mi'].includes(p))) return { tipo: 'boton', id: 'fsPhoneBtn' };
      const salir = dice(palabras, 'apagar') || palabras.some(p => ['sal', 'salir', 'salte', 'salgas', 'cierra', 'cerrar', 'cierrala', 'quitala'].includes(p));
      return { tipo: 'completa', salir };
    }
    // Página web en pantalla: «siguiente página web», «pon la página web anterior». Hace falta
    // decir «web»: sin eso, «página siguiente» es la imagen siguiente.
    if (palabras.length <= 7 && palabras.includes('web')) {
      if (palabras.some(p => ['siguiente', 'proxima', 'adelante'].includes(p))) return { tipo: 'boton', id: 'espejoSiguiente' };
      if (palabras.some(p => ['anterior', 'atras', 'previa'].includes(p))) return { tipo: 'boton', id: 'espejoAnterior' };
    }
    if (corta4 && dice(palabras, 'actualizar')) return { tipo: 'boton', id: 'actualizarBtn' };
    if (corta4 && dice(palabras, 'ayuda')) return { tipo: 'ayuda' };
    if (palabras.length <= 5 && ['que', 'cual', 'como'].includes(palabras[0]) &&
        ['es', 'suena', 'sonando', 'llama', 'esta', 'decir'].some(p => palabras.includes(p)) || (palabras.length === 2 && palabras[0] === 'que' && para)) {
      return palabras.includes('decir') ? { tipo: 'ayuda' } : { tipo: 'medios', para, accion: 'cual' };
    }
    if (corta4 && para && dice(palabras, 'abrir') && !dice(palabras, 'poner')) return { tipo: 'boton', id: para === 'video' ? 'videoBtn' : 'musicaBtn' };
    if (corta4 && dice(palabras, 'zona') && !dice(palabras, 'cuadrado') && !dice(palabras, 'rectangulo')) return { tipo: 'boton', id: 'zonaBtn' };

    // Volumen de la PC: «sube el volumen de la PC», «baja la compu», «silencia la PC».
    if (dice(palabras, 'pc')) {
      const pc = (accion, valor) => (valor === undefined ? { tipo: 'medios', para: 'pc', accion } : { tipo: 'medios', para: 'pc', accion, valor });
      if (dice(palabras, 'silencio')) return pc('mudo', !dice(palabras, 'apagar') && !dice(palabras, 'activar'));
      if (deVolumen && dice(palabras, 'activar')) return pc('mudo', false);
      if (dice(palabras, 'mitad')) return pc('volumen', 50);
      if (deVolumen || dice(palabras, 'subir') || dice(palabras, 'bajar') || dice(palabras, 'maximo')) {
        const orden = volumenConNumero(palabras, pc);
        if (orden) return orden;
      }
    }
    // Una orden suelta («bajale», «pausa», «a la mitad») se acepta si la frase es corta. En una
    // frase larga esas palabras suelen ser parte de lo que la persona está explicando («la
    // temperatura baja…»), así que ahí hace falta nombrar el volumen, la música o el video.
    const clara = palabras.length <= 4 || deVolumen || para !== null;

    // «retrocede a la mitad», «ve a la mitad de la canción»: lleva lo que suena a su mitad.
    // («ponlo a la mitad», sin un verbo de moverse, es el volumen.)
    const mueve = dice(palabras, 'adelantar') || dice(palabras, 'atrasar') || dice(palabras, 'irA');
    if (!deVolumen && mueve && dice(palabras, 'mitad')) return { tipo: 'medios', para, accion: 'irMitad' };

    const deImagen = dice(palabras, 'imagen');
    const direccion = ['arriba', 'abajo', 'derecha', 'izquierda'].find(d => dice(palabras, d)) || null;

    // «vete al final del video», «casi al final», «al final de la canción»: lleva lo que suena
    // cerca del final. Con una dirección («al final abajo») o nombrando la imagen, es la imagen.
    if (!deVolumen && !deImagen && !direccion && dice(palabras, 'final') && (para || mueve || palabras.length <= 4)) {
      return { tipo: 'medios', para, accion: dice(palabras, 'casi') ? 'irCasiFinal' : 'irFinal' };
    }
    // «vete al inicio»: vuelve a empezar lo que suena.
    if (!deImagen && mueve && palabras.includes('inicio')) return { tipo: 'medios', para, accion: 'reiniciar' };

    // Imagen hasta el borde: «vete arriba al tope», «hasta el final abajo», «a la derecha del todo».
    if (!deVolumen && para === null && direccion && (dice(palabras, 'tope') || dice(palabras, 'final')) && palabras.length <= 8) {
      return { tipo: 'zoom', accion: 'borde-' + direccion };
    }
    if (!deVolumen && para === null && deImagen && dice(palabras, 'final')) return { tipo: 'zoom', accion: 'borde-abajo' };

    // Tamaño de la imagen: «agranda», «acerca la foto», «más chico», «tamaño normal».
    // Lo mismo: suelto vale en una frase corta; en una larga hay que nombrar la imagen.
    // Mostrar sólo una forma en el medio, como «✂ Zona»: «un cuadrado», «agranda un rectángulo»,
    // «rectángulo alto», «cuadrado 30» (30 % de la página). En una frase larga («en este cuadro…»)
    // hace falta decir agrandar, zona o la imagen.
    const forma = dice(palabras, 'cuadrado') ? 'cuadrado' : dice(palabras, 'rectangulo') ? (dice(palabras, 'vertical') ? 'alto' : 'largo') : null;
    if (!deVolumen && para === null && forma && (palabras.length <= 5 || dice(palabras, 'agrandar') || dice(palabras, 'zona') || deImagen)) {
      const n = numeroCon(palabras);
      return n && n.valor >= 5 && n.valor <= 95 ? { tipo: 'zoom', accion: 'forma', forma, valor: n.valor } : { tipo: 'zoom', accion: 'forma', forma };
    }

    if (!deVolumen && para === null && (palabras.length <= 4 || deImagen || (palabras.length <= 6 && palabras.includes('ciento')))) {
      const n = numeroCon(palabras);
      const conNumero = (orden) => (n && n.valor > 0 && n.valor <= 400 ? { ...orden, valor: n.valor } : orden);
      // «centra», «al centro»: deja la imagen agrandada en el medio, sin cambiarle el tamaño.
      if (dice(palabras, 'centrar')) return { tipo: 'zoom', accion: 'centrar' };
      // Tamaño exacto: «al doble», «al triple», «agranda al 150» (150 %).
      if (dice(palabras, 'doble')) return { tipo: 'zoom', accion: 'escala', valor: 200 };
      if (dice(palabras, 'triple')) return { tipo: 'zoom', accion: 'escala', valor: 300 };
      if (dice(palabras, 'agrandar') && n && n.valor >= 100 && HASTA.includes(palabras[n.en - 1])) return { tipo: 'zoom', accion: 'escala', valor: Math.min(400, n.valor) };
      // «agranda 50», «achica 30 por ciento»: ese porcentaje más grande o más chica.
      if (dice(palabras, 'agrandar')) return conNumero({ tipo: 'zoom', accion: 'acercar' });
      if (dice(palabras, 'achicar')) return n && n.valor < 100 ? conNumero({ tipo: 'zoom', accion: 'alejar' }) : { tipo: 'zoom', accion: 'alejar' };
      if (dice(palabras, 'normal')) return { tipo: 'zoom', accion: 'normal' };
      // Mover la imagen agrandada: «derecha», «a la izquierda», «arriba», «abajo», «sube la imagen»;
      // con número, ese porcentaje de la página: «derecha 20».
      const mover = (accion) => (n && n.valor > 0 && n.valor <= 100 ? { tipo: 'zoom', accion, valor: n.valor } : { tipo: 'zoom', accion });
      if (dice(palabras, 'derecha')) return mover('derecha');
      if (dice(palabras, 'izquierda')) return mover('izquierda');
      if (dice(palabras, 'arriba') || (deImagen && dice(palabras, 'subir'))) return mover('arriba');
      if (dice(palabras, 'abajo') || (deImagen && dice(palabras, 'bajar'))) return mover('abajo');
    }

    // Volumen: «baja el volumen», «volumen a la mitad», «volumen 30», «sube 20», «baja a 0»,
    // «silencio», «sin sonido»; «quita el silencio» o «activa el sonido» lo devuelven.
    const medio = (accion, valor) => (valor === undefined ? { tipo: 'medios', para, accion } : { tipo: 'medios', para, accion, valor });
    if (clara && dice(palabras, 'silencio')) return dice(palabras, 'apagar') || dice(palabras, 'activar') ? medio('conSonido') : medio('volumen', 0);
    if (clara && deVolumen && palabras.includes('sin')) return medio('volumen', 0);
    if (clara && deVolumen && (dice(palabras, 'activar') || palabras.includes('con'))) return medio('conSonido');
    if (clara && dice(palabras, 'mitad')) return medio('volumen', 50);
    if (deVolumen || (clara && (dice(palabras, 'subir') || dice(palabras, 'bajar')))) return volumenConNumero(palabras, medio);

    if (clara && dice(palabras, 'pausar')) return { tipo: 'medios', para, accion: 'pausar' };

    // Bucle: «bucle», «repetir la canción» lo prenden; «quita el bucle», «sin repetir» lo apagan.
    if (clara && !deVideo && dice(palabras, 'bucle')) {
      return { tipo: 'medios', para: 'musica', accion: 'bucle', valor: !dice(palabras, 'apagar') };
    }
    if (deVideo && dice(palabras, 'quitar')) return { tipo: 'medios', para: 'video', accion: 'terminar' };
    // «termina la música», «quita la canción»: la corta (no sigue sola después).
    if (deMusica && dice(palabras, 'quitar') && !dice(palabras, 'bucle')) return { tipo: 'medios', para: 'musica', accion: 'terminar' };
    // «canción al azar», «pon cualquier video».
    if (para && dice(palabras, 'azar')) return { tipo: 'medios', para, accion: 'azar' };
    // Ir a un momento justo: «ve al minuto 2», «al segundo 30 del video».
    if (dice(palabras, 'irA') && !dice(palabras, 'adelantar') && !dice(palabras, 'atrasar') && numero !== null &&
        (dice(palabras, 'minutos') || dice(palabras, 'segundos'))) {
      return { tipo: 'medios', para, accion: 'ir', valor: Math.min(36000, numero * (dice(palabras, 'minutos') ? 60 : 1)) };
    }

    // Adelantar o atrasar lo que suena: «adelanta la música», «adelanta 30 segundos»,
    // «retrocede la canción». Sin nombrar la música, el video ni los segundos, «adelante» y
    // «atrás» siguen siendo las diapositivas.
    // Con un número («adelanta 10», «retrocede 20») también: son segundos de lo que suena.
    const conTiempo = dice(palabras, 'segundos') || dice(palabras, 'minutos') || (numero !== null && !deImagen);
    if (para || conTiempo) {
      const enMinutos = dice(palabras, 'minutos');
      const cuanto = numero === null ? (enMinutos ? 60 : 10) : Math.min(600, numero * (enMinutos ? 60 : 1));
      if (dice(palabras, 'adelantar')) return { tipo: 'medios', para, accion: 'saltar', valor: cuanto };
      if (dice(palabras, 'atrasar')) return { tipo: 'medios', para, accion: 'saltar', valor: -cuanto };
    }
    // «desde el inicio», «reiniciar»: vuelve a empezar la canción o el video. «Inicio» solo, sin
    // nombrarlos, sigue siendo empezar la presentación.
    if (dice(palabras, 'reiniciar') && (para || (clara && !palabras.includes('inicio')))) {
      return { tipo: 'medios', para, accion: 'reiniciar' };
    }

    // Música y video: «pon música», «música 2», «siguiente canción», «siguiente video».
    if (para) {
      // «sigue el video», «continúa con la música»: seguir lo que está en pausa, no pasar al otro.
      const sigueSolo = palabras.includes('sigue') && !palabras.some(p => ['siguiente', 'otro', 'otra', 'proximo', 'proxima'].includes(p));
      if (sigueSolo) return { tipo: 'medios', para, accion: 'reproducir' };
      if (dice(palabras, 'siguiente')) return { tipo: 'medios', para, accion: 'siguiente' };
      if (dice(palabras, 'anterior')) return { tipo: 'medios', para, accion: 'anterior' };
      if (numero !== null && numero >= 1) return { tipo: 'medios', para, accion: 'elegir', numero };
      // «pon la canción despacito», «pon el video del volcán»: busca por el nombre.
      if (dice(palabras, 'poner') || dice(palabras, 'reproducir')) {
        const resto = palabras.filter(p => !RELLENO.includes(p) && !['poner', 'reproducir', 'musica', 'video'].some(g => dice([p], g)));
        if (resto.length) return { tipo: 'medios', para, accion: 'buscar', texto: resto.join(' ') };
      }
      if (dice(palabras, 'poner') || dice(palabras, 'reproducir') || palabras.length <= 2) {
        return { tipo: 'medios', para, accion: 'reproducir' };
      }
      return null;
    }
    if (clara && dice(palabras, 'reproducir')) return { tipo: 'medios', para: null, accion: 'reproducir' };

    // «cierra», «cierra la pantalla», «cerrar sesión»: terminar y dejar la pantalla libre. El
    // control pregunta antes de cerrar.
    if (dice(palabras, 'cerrar') && (palabras.length <= 4 || dice(palabras, 'lugar'))) return { tipo: 'cerrar' };

    // Diapositivas, como siempre.
    if (dice(palabras, 'mostrar')) return { tipo: 'diapositiva', accion: 'mostrar' };
    if (dice(palabras, 'siguiente')) return { tipo: 'diapositiva', accion: 'siguiente' };
    if (dice(palabras, 'anterior')) return { tipo: 'diapositiva', accion: 'anterior' };
    // Un número suelto («tres», «diapositiva 7») va a esa diapositiva; dentro de una frase larga
    // es parte de lo que se está contando («hay una razón…»), no una orden.
    // Nombrando la diapositiva se acepta más larga: «ve a la diapositiva treinta y dos».
    const corta = palabras.length <= 4 || (deImagen && palabras.length <= 8);
    if (corta && numero !== null && numero >= 1 && numero <= totalDiapositivas) return { tipo: 'diapositiva', accion: String(numero) };
    // «última», «la última diapositiva»: la del final.
    if ((palabras.length <= 2 || (deImagen && corta)) && dice(palabras, 'ultima') && totalDiapositivas > 0) return { tipo: 'diapositiva', accion: String(totalDiapositivas) };
    // «un poco más», «más», «otro poco»: repite lo último que se pidió (subir, bajar, adelantar,
    // agrandar, correr la imagen…). El control sabe cuál fue.
    if (palabras.length <= 4 && ['mas', 'poco', 'poquito'].some(p => palabras.includes(p))) return { tipo: 'repetir' };
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
    'canción anterior', 'pausa', 'reproducir', 'temporizador', 'apaga el temporizador', 'sube el volumen', 'baja el volumen', 'volumen a la mitad',
    'volumen al máximo', 'silencio', 'quita el silencio', 'volumen cero', 'volumen cincuenta', 'baja a cero', 'sube veinte', 'baja diez',
    'última diapositiva', 'primera diapositiva', 'sube el volumen de la PC', 'baja el volumen de la PC', 'pon video', 'video uno', 'video dos', 'siguiente video', 'quita el video',
    'agranda la imagen', 'achica la imagen', 'más grande', 'más chico', 'tamaño normal',
    'derecha', 'izquierda', 'arriba', 'abajo',
    'Filo apágate', 'Filo enciéndete', 'pantalla completa', 'quita la pantalla completa',
    'siguiente página web', 'página web anterior'
  ];

  // El número que se dijo en una frase corta («el segundo», «pon el tres»), o null.
  function numeroDicho(frase) {
    const palabras = normalizar(frase).split(/\s+/).filter(Boolean);
    return palabras.length && palabras.length <= 5 ? numeroDe(palabras) : null;
  }

  const publico = { interpretarVoz, normalizar, numeroDicho, FRASES_DE_AYUDA };
  if (typeof module !== 'undefined' && module.exports) module.exports = publico;
  else raiz.OrdenesVoz = publico;
})(typeof window !== 'undefined' ? window : globalThis);
