// Reproductor en el celular: maneja la música y los videos que suenan en TU pantalla.
// Se usa en control.html (con video) y en gestionar.html, multimedia.html y avanzado.html
// (sólo la línea chica de la música), así la música se maneja desde cualquier página.
// El celular no reproduce nada: manda órdenes («medios») y muestra lo que cuenta la pantalla
// («mediosEstado»). Las barras se arrastran con el dedo y además hay botones de ±10 s por si
// arrastrar falla en algún celular.
(function () {
  const PAGINA = document.body.dataset.reproductor || 'mini'; // 'control' o 'mini'
  const conVideo = PAGINA === 'control';

  const fmt = (s) => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  function crear(etiqueta, props = {}, hijos = []) {
    const el = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const h of [].concat(hijos)) if (h) el.append(h);
    return el;
  }

  // ---------- aviso propio ----------
  const toast = crear('div', { class: 'toast medios', role: 'status' });
  toast.hidden = true;
  document.body.append(toast);
  let temporizadorToast;
  function avisar(texto) {
    toast.textContent = texto;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 200);
    }, 4200);
  }

  // ---------- estado ----------
  let estado = null;          // lo último que contó la pantalla
  let recibido = 0;           // cuándo (para mover la barra entre un aviso y otro)
  let musicas = [];
  let videos = [];
  let esperandoRespuesta = null;

  function ahora(p) {
    if (!p) return 0;
    const t = p.sonando ? p.t + (Date.now() - recibido) / 1000 : p.t;
    return p.duracion ? Math.min(t, p.duracion) : t;
  }

  function mandar(para, accion, valor) {
    const orden = { para, accion };
    if (valor !== undefined) orden.valor = valor;
    socket.emit('medios', orden);
    // Si en 2,5 s ninguna pantalla contesta, se avisa por qué no pasa nada.
    clearTimeout(esperandoRespuesta);
    const antes = recibido;
    esperandoRespuesta = setTimeout(() => {
      if (recibido === antes) avisar('📺 No hay ninguna pantalla abierta con tu PIN. Abrí la pantalla en la PC y entrá con el mismo PIN.');
    }, 2500);
  }

  // ---------- barra que se arrastra ----------
  function barraArrastrable(etiqueta, alSoltar) {
    const burbuja = crear('span', { class: 'barra-burbuja', text: '0:00' });
    const barra = crear('input', { type: 'range', class: 'deslizador', min: '0', max: '1', step: '0.1', value: '0', 'aria-label': etiqueta });
    const actual = crear('span', { text: '0:00' });
    const total = crear('span', { text: '0:00' });
    const caja = crear('div', { class: 'barra-arrastre' }, [burbuja, barra, crear('div', { class: 'tiempos' }, [actual, total])]);
    let arrastrando = false;
    function pintarBurbuja() {
      const r = Number(barra.max) ? barra.value / barra.max : 0;
      burbuja.style.left = `calc(${r * 100}% + ${14 - 28 * r}px)`;
      burbuja.textContent = fmt(barra.value);
      actual.textContent = fmt(barra.value);
      barra.style.setProperty('--lleno', r * 100 + '%');
    }
    const empezar = () => { arrastrando = true; burbuja.classList.add('ver'); pintarBurbuja(); };
    const soltar = () => {
      if (!arrastrando) return;
      arrastrando = false;
      burbuja.classList.remove('ver');
      alSoltar(Number(barra.value));
    };
    barra.addEventListener('pointerdown', empezar);
    barra.addEventListener('input', empezar);
    ['change', 'pointerup', 'pointercancel', 'blur'].forEach(ev => barra.addEventListener(ev, soltar));
    return {
      caja,
      pintar(t, duracion) {
        total.textContent = fmt(duracion);
        if (arrastrando) return;
        barra.max = String(Math.max(1, duracion || 0));
        barra.value = String(Math.min(t, duracion || t));
        actual.textContent = fmt(t);
        barra.style.setProperty('--lleno', (duracion ? (100 * t) / duracion : 0) + '%');
      }
    };
  }

  function deslizadorVolumen(etiqueta, alCambiar) {
    const barra = crear('input', { type: 'range', class: 'deslizador', min: '0', max: '100', step: '1', value: '70', 'aria-label': etiqueta });
    const salida = crear('output', { text: '70 %' });
    let tocando = false;
    let ultimoEnvio = 0;
    const pintar = () => { salida.textContent = barra.value + ' %'; barra.style.setProperty('--lleno', barra.value + '%'); };
    barra.addEventListener('input', () => {
      tocando = true;
      pintar();
      if (Date.now() - ultimoEnvio > 150) { ultimoEnvio = Date.now(); alCambiar(Number(barra.value)); }
    });
    barra.addEventListener('change', () => { tocando = false; alCambiar(Number(barra.value)); });
    const fila = crear('div', { class: 'volumen-fila' }, [crear('span', { 'aria-hidden': 'true', text: '🔈' }), barra, crear('span', { 'aria-hidden': 'true', text: '🔊' }), salida]);
    return { fila, pintar(v) { if (!tocando) { barra.value = String(v); pintar(); } } };
  }

  // ---------- hojas ----------
  const velo = crear('div', { class: 'hoja-velo' });
  velo.hidden = true;
  document.body.append(velo);
  let hojaAbierta = null;
  function abrirHoja(hoja) {
    if (hojaAbierta && hojaAbierta !== hoja) cerrarHoja();
    hojaAbierta = hoja;
    velo.hidden = false;
    hoja.hidden = false;
    requestAnimationFrame(() => { velo.classList.add('abierta'); hoja.classList.add('abierta'); });
    const foco = hoja.querySelector('.mando.grande, .btn.primary, button');
    if (foco) setTimeout(() => foco.focus(), 50);
  }
  function cerrarHoja() {
    const hoja = hojaAbierta;
    if (!hoja) return;
    hojaAbierta = null;
    velo.classList.remove('abierta');
    hoja.classList.remove('abierta');
    setTimeout(() => { if (!hojaAbierta) velo.hidden = true; hoja.hidden = true; }, 320);
  }
  velo.addEventListener('click', cerrarHoja);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHoja(); });

  function hoja(titulo, contenido) {
    const cerrar = crear('button', { type: 'button', class: 'hoja-cerrar', 'aria-label': 'Cerrar', text: '✕', onclick: cerrarHoja });
    const el = crear('section', { class: 'hoja-medios', role: 'dialog', 'aria-label': titulo }, [
      crear('div', { class: 'hoja-asa' }),
      crear('div', { class: 'hoja-cabecera' }, [crear('h2', { text: titulo }), cerrar]),
      ...contenido
    ]);
    el.hidden = true;
    document.body.append(el);
    return el;
  }

  // ---------- hoja de música ----------
  const mNombre = crear('b', { text: 'Sin canción' });
  const mPosicion = crear('span', { text: '' });
  const mBarra = barraArrastrable('Arrastrá para ir a otra parte de la canción', (t) => mandar('musica', 'ir', t));
  const mPlay = crear('button', { type: 'button', class: 'mando grande', 'aria-label': 'Reproducir', text: '▶', onclick: () => mandar('musica', 'alternar') });
  const mVolumen = deslizadorVolumen('Volumen de la música', (v) => mandar('musica', 'volumen', v));
  const mLista = crear('ul', { class: 'pistas' });
  const mResumen = crear('span', { text: '🎶 Canciones (0)' });
  const mAyudaVacia = crear('p', { class: 'hoja-nota' });
  mAyudaVacia.innerHTML = 'Todavía no tenés música. <a href="multimedia.html#musica">Subila acá</a>.';
  const hojaMusica = hoja('🎵 Música', [
    crear('div', { class: 'pista-actual' }, [crear('div', { class: 'pista-disco', 'aria-hidden': 'true', text: '🌸' }), crear('div', { class: 'pista-textos' }, [mNombre, mPosicion])]),
    mBarra.caja,
    crear('p', { class: 'pista-ayuda', text: 'Arrastrá con el dedo para adelantar o retroceder' }),
    crear('div', { class: 'mandos' }, [
      crear('button', { type: 'button', class: 'mando', 'aria-label': 'Retroceder 10 segundos', onclick: () => mandar('musica', 'saltar', -10) }, ['⏪', crear('br'), '10']),
      mPlay,
      crear('button', { type: 'button', class: 'mando', 'aria-label': 'Adelantar 10 segundos', onclick: () => mandar('musica', 'saltar', 10) }, ['⏩', crear('br'), '10']),
      crear('button', { type: 'button', class: 'mando', 'aria-label': 'Siguiente canción', text: '⏭', onclick: () => mandar('musica', 'siguiente') })
    ]),
    mVolumen.fila,
    mAyudaVacia,
    crear('details', { class: 'lista-pistas' }, [crear('summary', {}, [mResumen, crear('span', { class: 'flecha', 'aria-hidden': 'true', text: '▾' })]), mLista])
  ]);

  // ---------- hoja de video (sólo en el control) ----------
  const vLista = crear('ul', { class: 'videos-lista' });
  const vAyudaVacia = crear('p', { class: 'hoja-nota' });
  vAyudaVacia.innerHTML = 'Todavía no tenés videos. <a href="multimedia.html#videos">Subí uno o guardá un enlace de YouTube</a>.';
  const hojaVideo = conVideo ? hoja('🎬 Video', [
    crear('p', { class: 'hoja-nota', text: 'Al mandarlo, tu pantalla pausa todo: la música, el avance automático y el texto en vivo. Cuando el video termina, todo sigue donde estaba.' }),
    vAyudaVacia,
    vLista
  ]) : null;

  // ---------- mini reproductor ----------
  const miniNombre = crear('b', { text: '' });
  const miniTiempo = crear('span', { text: '' });
  const miniBarra = crear('i');
  const miniPlay = crear('button', { type: 'button', class: 'boton-redondo', 'aria-label': 'Reproducir o pausar', text: '▶' });
  const mini = crear('div', { class: 'mini-reproductor' }, [
    crear('button', { type: 'button', class: 'mini-abrir', 'aria-label': 'Abrir la música', onclick: () => abrirHoja(hojaMusica) }, [
      crear('span', { class: 'mini-nota', 'aria-hidden': 'true', text: '♪' }),
      crear('span', { class: 'mini-textos' }, [miniNombre, miniTiempo, crear('div', { class: 'mini-barra' }, [miniBarra])])
    ]),
    miniPlay
  ]);
  mini.hidden = true;
  miniPlay.addEventListener('click', () => {
    if (estado && estado.video) mandar('video', 'alternar');
    else mandar('musica', 'alternar');
  });
  const lugarMini = document.getElementById('lugarMiniReproductor');
  if (lugarMini) lugarMini.replaceWith(mini);

  // ---------- panel del video en el control (reemplaza Atrás/Siguiente) ----------
  let panelVideo = null;
  let pvNombre, pvBarra, pvPlay, pvVolumen;
  const panelNavegacion = document.querySelector('.panel.nav-panel');
  if (conVideo && panelNavegacion) {
    pvNombre = crear('span', { text: '' });
    pvBarra = barraArrastrable('Arrastrá para ir a otra parte del video', (t) => mandar('video', 'ir', t));
    pvPlay = crear('button', { type: 'button', class: 'mando grande', 'aria-label': 'Pausar video', text: '⏸', onclick: () => mandar('video', 'alternar') });
    pvVolumen = deslizadorVolumen('Volumen del video', (v) => mandar('video', 'volumen', v));
    panelVideo = crear('div', { class: 'panel video-activo', 'aria-live': 'polite' }, [
      crear('div', { class: 'cartel-video' }, [crear('span', { class: 'punto-vivo', 'aria-hidden': 'true' }), pvNombre]),
      pvBarra.caja,
      crear('div', { class: 'mandos' }, [
        crear('button', { type: 'button', class: 'mando', 'aria-label': 'Retroceder 10 segundos', onclick: () => mandar('video', 'saltar', -10) }, ['⏪', crear('br'), '10']),
        pvPlay,
        crear('button', { type: 'button', class: 'mando', 'aria-label': 'Adelantar 10 segundos', onclick: () => mandar('video', 'saltar', 10) }, ['⏩', crear('br'), '10'])
      ]),
      pvVolumen.fila,
      crear('button', { type: 'button', class: 'btn secondary', text: '⏹ Terminar video y volver', onclick: () => mandar('video', 'terminar') })
    ]);
    panelVideo.hidden = true;
    panelNavegacion.after(panelVideo);
  }

  // Botones «🎵 Música» y «🎬 Video» del control.
  const botonMusica = document.getElementById('musicaBtn');
  const botonVideo = document.getElementById('videoBtn');
  if (botonMusica) botonMusica.addEventListener('click', () => abrirHoja(hojaMusica));
  if (botonVideo && hojaVideo) botonVideo.addEventListener('click', () => abrirHoja(hojaVideo));

  // ---------- pintar ----------
  // Las listas se redibujan sólo si cambió algo (no con cada aviso de la pantalla): así un
  // toque nunca cae sobre un botón que se está reemplazando.
  let firmaListas = '';
  function pintarListas() {
    const actual = estado && estado.musica ? estado.musica.id + (estado.musica.sonando ? '+' : '-') : '';
    const firma = actual + '|' + musicas.map(m => m.id + m.nombre).join(',') + '|' + videos.map(v => v.id + v.nombre).join(',');
    if (firma === firmaListas) return;
    firmaListas = firma;
    mResumen.textContent = `🎶 Canciones (${musicas.length})`;
    mAyudaVacia.hidden = musicas.length > 0;
    const actualId = estado && estado.musica ? estado.musica.id : null;
    mLista.replaceChildren(...musicas.map((m, i) => {
      const sonando = m.id === actualId && estado.musica.sonando;
      return crear('li', {}, [crear('button', {
        type: 'button',
        class: m.id === actualId ? 'actual' : '',
        onclick: () => mandar('musica', 'elegir', m.id)
      }, [crear('span', { text: sonando ? '♪' : String(i + 1) }), crear('span', { text: m.nombre }), crear('span', { class: 'duracion', text: m.duracion ? fmt(m.duracion) : '' })])]);
    }));
    if (!hojaVideo) return;
    vAyudaVacia.hidden = videos.length > 0;
    vLista.replaceChildren(...videos.map((v) => {
      const detalle = (v.origen === 'youtube' ? 'YouTube' : 'Subido') + (v.duracion ? ' · ' + fmt(v.duracion) : '');
      return crear('li', { class: 'video-fila' }, [
        crear('span', { class: 'video-icono' + (v.origen === 'youtube' ? ' youtube' : ''), 'aria-hidden': 'true', text: v.origen === 'youtube' ? '▶ YT' : '▶' }),
        crear('span', { class: 'video-datos' }, [crear('b', { text: v.nombre }), crear('span', { text: detalle })]),
        crear('button', {
          type: 'button',
          class: 'btn primary',
          'aria-label': 'Mandar a la pantalla: ' + v.nombre,
          text: '📺 Mandar',
          onclick: () => { cerrarHoja(); mandar('video', 'mandar', v.id); }
        })
      ]);
    }));
  }

  function pintar() {
    const m = estado && estado.musica;
    const v = estado && estado.video;
    // Hoja de música
    mNombre.textContent = m ? m.nombre : 'Sin canción';
    mPosicion.textContent = m ? `Canción ${m.posicion + 1} de ${m.total}` : (musicas.length ? 'Tocá ▶ para empezar' : '');
    mBarra.pintar(ahora(m), m ? m.duracion : 0);
    mPlay.textContent = m && m.sonando ? '⏸' : '▶';
    mPlay.setAttribute('aria-label', m && m.sonando ? 'Pausar' : 'Reproducir');
    if (m) mVolumen.pintar(m.volumen);
    // Mini
    const hayAlgo = v || (m && (m.sonando || m.t > 0));
    mini.hidden = !hayAlgo;
    mini.classList.toggle('con-video', !!v);
    if (v) {
      miniNombre.textContent = '🎬 ' + v.nombre;
      miniTiempo.textContent = `${fmt(ahora(v))} / ${fmt(v.duracion)}` + (m && estado.musica ? ' · música en pausa' : '');
      miniBarra.style.width = (v.duracion ? (100 * ahora(v)) / v.duracion : 0) + '%';
      miniPlay.textContent = v.sonando ? '⏸' : '▶';
    } else if (m) {
      miniNombre.textContent = m.nombre;
      miniTiempo.textContent = `${fmt(ahora(m))} / ${fmt(m.duracion)}`;
      miniBarra.style.width = (m.duracion ? (100 * ahora(m)) / m.duracion : 0) + '%';
      miniPlay.textContent = m.sonando ? '⏸' : '▶';
    }
    // Panel del video en el control
    if (panelVideo) {
      panelVideo.hidden = !v;
      panelNavegacion.hidden = !!v;
      if (v) {
        pvNombre.textContent = (v.silenciado ? '🔇 Sin sonido: tocá la pantalla de la PC · ' : '🎬 En tu pantalla: ') + v.nombre;
        pvBarra.pintar(ahora(v), v.duracion);
        pvPlay.textContent = v.sonando ? '⏸' : '▶';
        pvPlay.setAttribute('aria-label', v.sonando ? 'Pausar video' : 'Reproducir video');
        pvVolumen.pintar(v.volumen);
      }
    }
  }
  setInterval(() => { if (estado && ((estado.musica && estado.musica.sonando) || (estado.video && estado.video.sonando))) pintar(); }, 500);

  socket.on('mediosEstado', (e) => {
    estado = e;
    recibido = Date.now();
    if (e.aviso) avisar(e.aviso);
    pintar();
    pintarListas();
  });

  function cargarLista() {
    return authFetch('/api/multimedia')
      .then(r => r.json())
      .then((datos) => {
        const propios = datos.elementos || [];
        musicas = propios.filter(e => e.tipo === 'musica');
        videos = propios.filter(e => e.tipo === 'video');
        pintarListas();
      })
      .catch(err => console.error('No se pudo cargar la música y los videos:', err));
  }

  ensureAuthed().then((auth) => {
    cargarLista();
    socket.on('multimediaActualizada', cargarLista);
    // Se une a la sala de su dueño (por el PIN) y un momento después pide el estado a la pantalla.
    const alConectar = () => {
      socket.emit('identificar', auth.pin);
      setTimeout(() => socket.emit('mediosPedirEstado'), 400);
    };
    if (socket.connected) alConectar();
    socket.on('connect', alConectar);
  }).catch(() => {});
})();
