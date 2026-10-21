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
      if (recibido !== antes) return;
      // Hay una pantalla abierta pero no contestó (por ejemplo, abierta desde antes de una versión
      // nueva): no es que falte, hay que recargarla.
      if (typeof hayPantalla !== 'undefined' && hayPantalla === true) avisar('📺 Tu pantalla no contestó. Recargala en la PC (tecla F5) y probá de nuevo.');
      else avisar('📺 No hay ninguna pantalla abierta con tu PIN. Abrí la pantalla en la PC y entrá con el mismo PIN.');
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

  // Volumen de Windows: una fila «🖥 PC» con −, la barra, + y silencio. Está siempre a la vista,
  // pero sólo funciona si la pantalla es la app de PC (un navegador no puede tocar el volumen de
  // Windows): con la pantalla en un navegador, tocarla avisa eso en vez de no hacer nada.
  const filasPC = [];
  let hayAppPC = false;
  const AVISO_SIN_APP = '🖥 Esto sólo funciona con la app de PC. En la página web no se puede.';
  function mandarPC(accion, valor) {
    if (!hayAppPC) { avisar(AVISO_SIN_APP); return; }
    mandar('pc', accion, valor);
  }
  function filaVolumenPC() {
    const barra = crear('input', { type: 'range', class: 'deslizador', min: '0', max: '100', step: '1', value: '50', 'aria-label': 'Volumen de la PC' });
    let tocando = false;
    let ultimoEnvio = 0;
    const pintarBarra = () => barra.style.setProperty('--lleno', barra.value + '%');
    barra.addEventListener('input', () => {
      if (!hayAppPC) return;
      tocando = true;
      pintarBarra();
      if (Date.now() - ultimoEnvio > 150) { ultimoEnvio = Date.now(); mandar('pc', 'volumen', Number(barra.value)); }
    });
    barra.addEventListener('change', () => {
      tocando = false;
      if (!hayAppPC) { barra.value = '50'; pintarBarra(); avisar(AVISO_SIN_APP); return; }
      mandar('pc', 'volumen', Number(barra.value));
    });
    let mudo = false;
    const botonMudo = crear('button', { type: 'button', class: 'mas-menos mudo-pc', 'aria-label': 'Silenciar la PC', 'aria-pressed': 'false', text: '🔇', onclick: () => mandarPC('mudo', !mudo) });
    const rotulo = crear('span', { class: 'rotulo-pc', title: 'Volumen de la PC', text: '🖥' });
    const fila = crear('div', { class: 'volumen-fila volumen-pc' }, [
      rotulo,
      crear('button', { type: 'button', class: 'mas-menos', 'aria-label': 'Bajar el volumen de la PC', text: '−', onclick: () => mandarPC('bajar', 10) }),
      barra,
      crear('button', { type: 'button', class: 'mas-menos', 'aria-label': 'Subir el volumen de la PC', text: '+', onclick: () => mandarPC('subir', 10) }),
      botonMudo
    ]);
    const yo = {
      fila,
      pintar(pc) {
        fila.classList.toggle('sin-app', !pc);
        barra.setAttribute('aria-label', pc ? 'Volumen de la PC' : 'Volumen de la PC (sólo con la app de PC)');
        if (!pc) return;
        mudo = pc.mudo;
        botonMudo.classList.toggle('activo', mudo);
        botonMudo.setAttribute('aria-pressed', String(mudo));
        botonMudo.setAttribute('aria-label', mudo ? 'Quitar el silencio de la PC' : 'Silenciar la PC');
        barra.setAttribute('aria-valuetext', mudo ? 'En silencio' : pc.volumen + ' %');
        if (!tocando) { barra.value = String(pc.volumen); pintarBarra(); }
      }
    };
    filasPC.push(yo);
    return yo;
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
      crear('button', { type: 'button', class: 'mando', 'aria-label': 'Siguiente canción', text: '⏭', onclick: () => mandar('musica', 'siguiente') }),
      crear('button', { type: 'button', class: 'mando', 'aria-label': 'Terminar la música', text: '⏹', onclick: () => { mandar('musica', 'terminar'); cerrarHoja(); } })
    ]),
    mVolumen.fila,
    filaVolumenPC().fila,
    mAyudaVacia,
    crear('details', { class: 'lista-pistas' }, [crear('summary', {}, [mResumen, crear('span', { class: 'flecha', 'aria-hidden': 'true', text: '▾' })]), mLista])
  ]);

  // ---------- hoja de video (sólo en el control) ----------
  const vLista = crear('ul', { class: 'videos-lista' });
  const vAyudaVacia = crear('p', { class: 'hoja-nota' });
  vAyudaVacia.innerHTML = 'Todavía no tenés videos. <a href="multimedia.html#videos">Subí uno o guardá un enlace de YouTube</a>.';
  const hojaVideo = conVideo ? hoja('🎬 Video', [
    crear('p', { class: 'hoja-nota', text: 'Al mandarlo, tu pantalla pausa todo: la música, el avance automático y el texto en vivo. Cuando el video termina, todo sigue donde estaba.' }),
    crear('button', { type: 'button', class: 'btn secondary', text: '🔍 Buscar en YouTube', onclick: () => abrirBuscador() }),
    vAyudaVacia,
    vLista
  ]) : null;

  // ---------- buscar en YouTube (sólo en el control) ----------
  // Se busca en el servidor (servidor/buscar-youtube.js) y el video elegido lo pone la pantalla.
  // Al elegir, la hoja se cierra sola y queda el control grande del video.
  const bTexto = crear('input', { type: 'search', id: 'buscarYoutubeTexto', class: 'buscar-youtube-texto', placeholder: 'Buscar en YouTube', 'aria-label': 'Qué video buscar', maxlength: '100', enterkeyhint: 'search', autocomplete: 'off' });
  const bBoton = crear('button', { type: 'submit', class: 'btn primary', text: 'Buscar' });
  const bForm = crear('form', { class: 'buscar-youtube', role: 'search' }, [bTexto, bBoton]);
  const bEstado = crear('p', { class: 'hoja-nota', 'aria-live': 'polite', text: 'Escribí qué querés ver: el video sale en tu pantalla.' });
  const bLista = crear('ul', { class: 'resultados-youtube' });
  const hojaBuscar = conVideo ? hoja('🔍 Buscar en YouTube', [bForm, bEstado, bLista]) : null;
  let buscando = 0;
  bForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const busqueda = bTexto.value.trim();
    if (!busqueda) { bTexto.focus(); return; }
    bTexto.blur(); // baja el teclado para ver los resultados
    const esta = ++buscando;
    bEstado.textContent = 'Buscando…';
    bBoton.disabled = true;
    let datos = null;
    try {
      const res = await authFetch('/api/youtube/buscar?q=' + encodeURIComponent(busqueda));
      datos = await res.json().catch(() => ({}));
      if (!res.ok) datos = { error: datos.error || 'No se pudo buscar. Probá de nuevo.' };
    } catch { datos = { error: 'Sin conexión. Revisá el internet del celular.' }; }
    if (esta !== buscando) return;
    bBoton.disabled = false;
    if (datos.error) { bEstado.textContent = datos.error; return; }
    const encontrados = datos.videos || [];
    bEstado.textContent = encontrados.length ? 'Tocá un video y sale en tu pantalla.' : 'No encontré videos. Probá con otras palabras.';
    bLista.replaceChildren(...encontrados.map(v => crear('li', {}, [crear('button', {
      type: 'button',
      class: 'resultado-youtube',
      'aria-label': 'Poner en la pantalla: ' + v.titulo,
      onclick: () => ponerYoutube(v.id, v.titulo)
    }, [
      crear('span', { class: 'resultado-foto' }, [
        crear('img', { src: 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg', alt: '', loading: 'lazy' }),
        crear('span', { class: 'resultado-duracion', text: v.duracion })
      ]),
      crear('span', { class: 'resultado-datos' }, [crear('b', { text: v.titulo }), crear('span', { text: v.canal })])
    ])])));
  });
  function abrirBuscador() {
    if (!hojaBuscar) return;
    abrirHoja(hojaBuscar);
    // Con resultados de antes se los deja a la vista; sin nada, directo a escribir.
    if (!bLista.children.length) setTimeout(() => bTexto.focus(), 60);
  }
  function ponerYoutube(id, nombre) {
    cerrarHoja();
    mandar('video', 'youtube', nombre ? { id, nombre } : { id });
  }
  // Por voz: «busca Camilo» abre el buscador con los resultados; después «uno», «el segundo»…
  // pone ese video en la pantalla.
  function buscarPorVoz(texto) {
    if (!hojaBuscar) return false;
    abrirHoja(hojaBuscar);
    bTexto.value = texto.slice(0, 100);
    bForm.requestSubmit();
    return true;
  }
  function resultadosALaVista() { return hojaAbierta === hojaBuscar && bLista.children.length; }
  function elegirResultado(n) {
    const boton = bLista.children[n - 1] && bLista.children[n - 1].querySelector('button');
    if (!boton) return null;
    const titulo = boton.querySelector('b').textContent;
    boton.click();
    return titulo;
  }
  // Para la tarjeta de YouTube del control (control.js) y la voz.
  window.youtubeCelular = { abrirBuscador, ponerYoutube, buscarPorVoz, resultadosALaVista, elegirResultado };

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
  let pvNombre, pvBarra, pvPlay, pvVolumen, pvCompleta;

  // ---- Pantalla completa en la PC ----
  // Se pide a la pantalla; ella contesta si quedó completa o si falta un toque en la PC (en un
  // navegador, sin un toque no se puede). Tocado de nuevo, la quita.
  let pantallaCompleta = false;
  let pidiendoCompleta = false;
  function pedirCompleta() {
    pidiendoCompleta = true;
    socket.emit('cine', pantallaCompleta ? { salir: true } : undefined);
  }
  function pintarCompleta() {
    if (!pvCompleta) return;
    pvCompleta.textContent = pantallaCompleta ? '✓ Pantalla completa' : '⛶ Pantalla completa';
    pvCompleta.classList.toggle('completa', pantallaCompleta);
    pvCompleta.setAttribute('aria-label', pantallaCompleta ? 'Quitar la pantalla completa de la PC' : 'Poner la PC en pantalla completa');
  }
  socket.on('pantallaCompletaEstado', (e) => {
    if (!e) return;
    const antes = pantallaCompleta;
    pantallaCompleta = e.completa === true;
    pintarCompleta();
    if (e.falta === 'toque' && pidiendoCompleta) avisar('👆 Tocá una vez la pantalla de la PC y se pone completa.');
    else if (pantallaCompleta && !antes) avisar('✓ La PC está en pantalla completa.');
    else if (!pantallaCompleta && antes && pidiendoCompleta) avisar('La PC salió de pantalla completa.');
    if (e.falta !== 'toque') pidiendoCompleta = false;
  });
  const panelNavegacion = document.querySelector('.panel.nav-panel');
  if (conVideo && panelNavegacion) {
    pvNombre = crear('span', { text: '' });
    pvBarra = barraArrastrable('Arrastrá para ir a otra parte del video', (t) => mandar('video', 'ir', t));
    pvPlay = crear('button', { type: 'button', class: 'mando grande', 'aria-label': 'Pausar video', text: '⏸', onclick: () => mandar('video', 'alternar') });
    pvVolumen = deslizadorVolumen('Volumen del video', (v) => mandar('video', 'volumen', v));
    pvCompleta = crear('button', { type: 'button', class: 'boton-completa', text: '⛶ Pantalla completa', onclick: pedirCompleta });
    panelVideo = crear('div', { class: 'panel video-activo', 'aria-live': 'polite' }, [
      crear('div', { class: 'cartel-video' }, [crear('span', { class: 'punto-vivo', 'aria-hidden': 'true' }), pvNombre, pvCompleta]),
      pvBarra.caja,
      crear('div', { class: 'mandos' }, [
        crear('button', { type: 'button', class: 'mando', 'aria-label': 'Retroceder 10 segundos', onclick: () => mandar('video', 'saltar', -10) }, ['⏪', crear('br'), '10']),
        pvPlay,
        crear('button', { type: 'button', class: 'mando', 'aria-label': 'Adelantar 10 segundos', onclick: () => mandar('video', 'saltar', 10) }, ['⏩', crear('br'), '10'])
      ]),
      pvVolumen.fila,
      filaVolumenPC().fila,
      crear('div', { class: 'fila-video-botones' }, [
        crear('button', { type: 'button', class: 'btn secondary', text: '🔍 Buscar otro', 'aria-label': 'Buscar otro video', onclick: () => abrirBuscador() }),
        crear('button', { type: 'button', class: 'btn secondary', text: '⏹ Terminar', 'aria-label': 'Terminar video y volver', onclick: () => mandar('video', 'terminar') })
      ])
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
    hayAppPC = Boolean(estado && estado.pc);
    filasPC.forEach((f) => f.pintar(estado && estado.pc));
  }
  setInterval(() => { if (estado && ((estado.musica && estado.musica.sonando) || (estado.video && estado.video.sonando))) pintar(); }, 500);

  socket.on('mediosEstado', (e) => {
    estado = e;
    recibido = Date.now();
    if (e.aviso) avisar(e.aviso);
    pintar();
    pintarListas();
  });

  // ---------- órdenes por voz ----------
  // control.js entiende lo que se dijo (ordenes-voz.js) y le pasa acá la orden de música o
  // video. Devuelve un texto corto con lo que hizo, para mostrarlo en el control.
  const volumenAntesDelSilencio = { musica: 0, video: 0 };
  window.ordenDeVozMedios = function ordenDeVozMedios(orden) {
    const v = estado && estado.video;
    const m = estado && estado.musica;
    // Volumen de Windows: sólo si la pantalla es la app de PC.
    if (orden.para === 'pc') {
      const pc = estado && estado.pc;
      if (!pc) return AVISO_SIN_APP;
      if (orden.accion === 'mudo') { mandar('pc', 'mudo', orden.valor); return orden.valor ? '🔇 PC en silencio' : '🔊 PC con sonido'; }
      if (orden.accion === 'subirVolumen' || orden.accion === 'bajarVolumen') {
        const subir = orden.accion === 'subirVolumen';
        const paso = orden.valor || 20;
        mandar('pc', subir ? 'subir' : 'bajar', paso);
        return `🖥 Volumen de la PC ${Math.max(0, Math.min(100, pc.volumen + (subir ? paso : -paso)))} %`;
      }
      if (orden.accion === 'volumen') { mandar('pc', 'volumen', orden.valor); return `🖥 Volumen de la PC ${orden.valor} %`; }
      return null;
    }
    // Sin decir «música» ni «video», la orden va a lo que está en la pantalla ahora.
    const para = orden.para || (v ? 'video' : 'musica');
    const lista = para === 'video' ? videos : musicas;
    const cual = para === 'video' ? 'video' : 'canción';
    const actual = para === 'video' ? v : m;

    if (orden.accion === 'volumen' || orden.accion === 'subirVolumen' || orden.accion === 'bajarVolumen' || orden.accion === 'conSonido') {
      const ahoraVolumen = actual ? actual.volumen : 70;
      // «sube 20» / «baja 15»: esa cantidad; sin número, 20.
      const paso = orden.valor || 20;
      const nuevo = orden.accion === 'volumen' ? orden.valor
        : orden.accion === 'conSonido' ? (ahoraVolumen > 0 ? ahoraVolumen : volumenAntesDelSilencio[para] || 70)
          : ahoraVolumen + (orden.accion === 'subirVolumen' ? paso : -paso);
      const volumen = Math.max(0, Math.min(100, Math.round(nuevo)));
      // Al dejarlo en cero se recuerda cuánto tenía, para «quita el silencio».
      if (volumen === 0 && ahoraVolumen > 0) volumenAntesDelSilencio[para] = ahoraVolumen;
      mandar(para, 'volumen', volumen);
      return volumen === 0 ? '🔇 Volumen 0 %' : `🔊 Volumen ${volumen} %`;
    }
    if (orden.accion === 'pausar') { mandar(para, 'pausar'); return '⏸ Pausa'; }
    if (orden.accion === 'bucle') {
      mandar('musica', 'bucle', orden.valor);
      return orden.valor ? '🔁 Bucle: se repite esta canción' : '➡️ Bucle quitado';
    }
    if (orden.accion === 'saltar') {
      mandar(para, 'saltar', orden.valor);
      return (orden.valor > 0 ? '⏩ Adelanté ' : '⏪ Retrocedí ') + Math.abs(orden.valor) + ' s';
    }
    if (orden.accion === 'irMitad') {
      if (!actual || !actual.duracion) return para === 'video' ? 'No hay ningún video en la pantalla.' : 'No hay ninguna canción sonando.';
      mandar(para, 'ir', Math.round(actual.duracion / 2));
      return '⏱ A la mitad';
    }
    if (orden.accion === 'irFinal' || orden.accion === 'irCasiFinal') {
      if (!actual || !actual.duracion) return para === 'video' ? 'No hay ningún video en la pantalla.' : 'No hay ninguna canción sonando.';
      // «Al final» deja los últimos 5 segundos; «casi al final», el último tramo (90 %).
      const destino = orden.accion === 'irFinal' ? Math.max(0, actual.duracion - 5) : actual.duracion * 0.9;
      mandar(para, 'ir', Math.round(destino));
      return orden.accion === 'irFinal' ? '⏭ Al final' : '⏩ Casi al final';
    }
    if (orden.accion === 'reiniciar') {
      mandar(para, 'ir', 0);
      mandar(para, 'reproducir');
      return '⏮ Desde el inicio';
    }
    if (orden.accion === 'terminar') {
      if (para === 'musica') { mandar('musica', 'terminar'); return '⏹ Música terminada'; }
      mandar('video', 'terminar');
      return '⏹ Video terminado';
    }
    // «¿qué canción es?»: dice el nombre de lo que está en la pantalla.
    if (orden.accion === 'cual') {
      if (!actual) return para === 'video' ? 'No hay ningún video en la pantalla.' : 'No hay ninguna canción puesta.';
      const nombre = actual.nombre || (lista.find(e => e.id === actual.id) || {}).nombre || 'sin nombre';
      return (para === 'video' ? '🎬 ' : '🎵 ') + nombre + (actual.sonando ? '' : ' (en pausa)');
    }
    // «ve al minuto 2»: a ese momento de lo que suena.
    if (orden.accion === 'ir') {
      if (!actual) return para === 'video' ? 'No hay ningún video en la pantalla.' : 'No hay ninguna canción puesta.';
      const destino = actual.duracion ? Math.min(orden.valor, Math.max(0, actual.duracion - 1)) : orden.valor;
      mandar(para, 'ir', destino);
      return `⏱ ${Math.floor(destino / 60)}:${String(Math.round(destino % 60)).padStart(2, '0')}`;
    }

    const poner = (elemento) => {
      mandar(para, para === 'video' ? 'mandar' : 'elegir', elemento.id);
      return (para === 'video' ? '🎬 ' : '🎵 ') + elemento.nombre;
    };
    if (orden.accion === 'azar') {
      if (!lista.length) return para === 'video' ? 'Todavía no tenés videos.' : 'Todavía no tenés música.';
      const otros = lista.length > 1 && actual ? lista.filter(e => e.id !== actual.id) : lista;
      return '🎲 ' + poner(otros[Math.floor(Math.random() * otros.length)]);
    }
    // «pon la canción despacito»: la de la lista cuyo nombre tiene más de las palabras dichas.
    if (orden.accion === 'buscar') {
      const limpiar = t => window.OrdenesVoz.normalizar(t).split(/\s+/).filter(p => p.length > 1);
      const buscadas = limpiar(orden.texto);
      let mejor = null;
      let puntos = 0;
      for (const e of lista) {
        const nombre = limpiar(e.nombre || '');
        const n = buscadas.filter(b => nombre.some(p => p === b || (b.length >= 4 && (p.startsWith(b) || b.startsWith(p))))).length;
        if (n > puntos) { puntos = n; mejor = e; }
      }
      if (mejor) return poner(mejor);
      return `No encontré «${orden.texto}» en tu ${para === 'video' ? 'lista de videos' : 'música'}.`;
    }
    if (orden.accion === 'elegir') {
      const elemento = lista[orden.numero - 1];
      return elemento ? poner(elemento) : `No tenés ${cual} ${orden.numero} (hay ${lista.length}).`;
    }
    if (!lista.length) return para === 'video' ? 'Todavía no tenés videos.' : 'Todavía no tenés música.';
    if (orden.accion === 'siguiente' || orden.accion === 'anterior') {
      if (para === 'musica') { mandar('musica', orden.accion); return orden.accion === 'siguiente' ? '⏭ Siguiente canción' : '⏮ Canción anterior'; }
      const paso = orden.accion === 'siguiente' ? 1 : -1;
      const donde = v ? lista.findIndex(e => e.id === v.id) : -1;
      return poner(lista[donde === -1 ? 0 : (donde + paso + lista.length) % lista.length]);
    }
    // «reproducir»: sigue lo que estaba; un video que todavía no está en pantalla se manda.
    if (para === 'video' && !v) return poner(lista[0]);
    mandar(para, 'reproducir');
    return '▶ Reproduciendo';
  };

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
