// Música y videos en la pantalla (PC o proyector), manejados desde el celular.
// - La música suena por encima de todo: diapositivas, «Escribir en vivo», frase final y
//   pantalla completa. Sólo se pausa sola mientras hay un video.
// - Un video (subido o de YouTube) tapa las diapositivas y pausa todo (ver pantallaVideo en
//   pantalla.js); al terminar, vuelve a la misma diapositiva y la música sigue donde iba.
// - Los navegadores no dejan sonar nada hasta que alguien toca la página: el botón
//   «🔊 Permitir sonido» (o cualquier toque, como «Ir a pantalla completa») lo habilita.
// - Si la misma persona tiene dos pantallas abiertas, suena sólo en la última donde se
//   permitió el sonido, así no se oye con eco.
(function () {
  const miPantalla = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const VOLUMEN_INICIAL_MUSICA = 70;
  const VOLUMEN_INICIAL_VIDEO = 85;
  const FUNDIDO_MS = 700;

  const botonPermitir = document.getElementById('permitirSonido');
  const avisoPermiso = document.getElementById('avisoPermiso');
  const botonAvisoPermiso = document.getElementById('avisoPermisoBtn');
  const sonidoListo = document.getElementById('sonidoListo');
  const sello = document.getElementById('selloMusica');
  const selloTexto = document.getElementById('selloMusicaTexto');
  const capaVideo = document.getElementById('capaVideo');
  const marcoVideo = document.getElementById('marcoVideo');
  const tituloVideo = document.getElementById('tituloVideo');

  let musicas = [];
  let videos = [];
  let permitido = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  let soyLaActiva = true;

  // ---- Música ----
  const audio = new Audio();
  audio.preload = 'auto';
  let musicaId = null;
  let quiereSonar = false; // lo que pidió el celular (aunque el navegador todavía no deje)
  let volumenMusica = VOLUMEN_INICIAL_MUSICA;
  let fundido = null;
  let musicaAntesDelVideo = false;
  let musicaSinSonido = false; // siguió sola al volver a abrir la pantalla, sin que nadie tocara la PC

  // ---- Video ----
  let video = null;          // el elemento del video actual (en la lista), o null
  let elVideo = null;        // <video> para los subidos
  let yt = null;             // reproductor de YouTube
  let volumenVideo = VOLUMEN_INICIAL_VIDEO;
  let videoSinSonido = false; // arrancó sin sonido porque nadie había tocado la PC
  let vigiaVideo = null;
  let pausarAlEmpezar = false; // YouTube siguió en pausa: se pone en el segundo y se frena

  // ---------- utilidades ----------
  function emitir(nombre, datos) { socket.emit(nombre, datos); }

  function musicaActual() {
    return musicas.find(m => m.id === musicaId) || musicas[0] || null;
  }

  function fundir(hasta, alTerminar) {
    clearInterval(fundido);
    const desde = audio.volume;
    const pasos = 14;
    let n = 0;
    fundido = setInterval(() => {
      n++;
      audio.volume = Math.max(0, Math.min(1, desde + (hasta - desde) * (n / pasos)));
      if (n >= pasos) {
        clearInterval(fundido);
        fundido = null;
        if (alTerminar) alTerminar();
      }
    }, FUNDIDO_MS / pasos);
  }

  let temporizadorSello;
  function mostrarSello(texto) {
    selloTexto.textContent = texto;
    sello.classList.toggle('sonando', !audio.paused);
    sello.hidden = false;
    requestAnimationFrame(() => sello.classList.add('ver'));
    clearTimeout(temporizadorSello);
    temporizadorSello = setTimeout(() => {
      sello.classList.remove('ver');
      setTimeout(() => { sello.hidden = true; }, 300);
    }, 4000);
  }

  // Pastilla «🔇 Sonido apagado» abajo a la izquierda, igual para la música y para el video.
  let temporizadorListo;
  function pedirPermiso() {
    clearTimeout(temporizadorListo);
    sonidoListo.hidden = true;
    avisoPermiso.hidden = false;
  }

  // ---------- estado para el celular ----------
  let aviso = null;
  let volumenPC = null; // volumen de Windows { volumen, mudo }, sólo con la app de PC
  // Hasta saber si hay que seguir con la música o el video de antes (ver «mediosSeguir»), la
  // pantalla no cuenta nada: si contara «no suena nada», el servidor se olvidaría de lo que iba.
  let contando = false;
  function publicarEstado() {
    if (!soyLaActiva || !contando) return;
    const m = musicaActual();
    const estado = {
      pantalla: miPantalla,
      permitido,
      musica: m ? {
        id: m.id,
        nombre: m.nombre,
        origen: 'subido',
        t: m.id === musicaId ? audio.currentTime || 0 : 0,
        duracion: (m.id === musicaId && Number.isFinite(audio.duration) ? audio.duration : m.duracion) || 0,
        // Durante el fundido para pausar ya cuenta como pausada (es lo que pidió el celular).
        sonando: m.id === musicaId && !audio.paused && quiereSonar,
        volumen: volumenMusica,
        posicion: musicas.indexOf(m),
        total: musicas.length
      } : null,
      video: video ? {
        id: video.id,
        nombre: video.nombre,
        origen: video.origen,
        t: tiempoVideo(),
        duracion: duracionVideo(),
        sonando: videoSonando(),
        silenciado: videoSinSonido,
        volumen: volumenVideo,
        posicion: videos.indexOf(video),
        total: videos.length
      } : null,
      musicaDespues: Boolean(video && musicaAntesDelVideo)
    };
    if (volumenPC) estado.pc = volumenPC;
    if (aviso) { estado.aviso = aviso; aviso = null; }
    emitir('mediosEstado', estado);
  }
  setInterval(() => { if (!audio.paused || videoSonando()) publicarEstado(); }, 1000);

  function avisarAlCelular(texto) {
    aviso = texto;
    publicarEstado();
  }

  // ---------- permiso de sonido ----------
  function permitir() {
    permitido = true;
    soyLaActiva = true;
    if (!avisoPermiso.hidden) {
      // Estaba la pastilla: se avisa un momento que ya se escucha.
      sonidoListo.hidden = false;
      clearTimeout(temporizadorListo);
      temporizadorListo = setTimeout(() => { sonidoListo.hidden = true; }, 2000);
    }
    avisoPermiso.hidden = true;
    botonPermitir.textContent = '🔊 Sonido permitido';
    botonPermitir.disabled = true;
    emitir('mediosPantallaActiva', miPantalla);
    if (musicaSinSonido) { musicaSinSonido = false; audio.muted = false; }
    // Si el celular ya había pedido algo, arranca ahora (y el video que iba sin sonido, se escucha).
    if (video) { videoSinSonido = false; activarSonidoDelVideo(); reanudarVideo(); }
    else if (quiereSonar) reproducirMusica();
    publicarEstado();
  }
  botonPermitir.addEventListener('click', permitir);
  botonAvisoPermiso.addEventListener('click', permitir);
  // Cualquier toque cuenta (por ejemplo «Ir a pantalla completa»).
  document.addEventListener('pointerdown', (e) => {
    if ((videoSinSonido || musicaSinSonido || !avisoPermiso.hidden) && !avisoPermiso.contains(e.target)) { permitir(); return; }
    if (!permitido) { permitido = true; publicarEstado(); }
  }, { capture: true });

  // La pastilla sale siempre que el navegador tiene el sonido apagado, aunque se estén mostrando
  // fotos o una página: así se toca la PC antes de que haga falta. La app de PC nunca lo apaga.
  function sonidoApagado() {
    if (permitido) return false;
    try {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto) return false;
      const prueba = new Contexto();
      const apagado = prueba.state !== 'running';
      prueba.close();
      return apagado;
    } catch { return false; }
  }
  if (sonidoApagado()) pedirPermiso();

  // Otra pantalla de la misma persona se quedó con el sonido: ésta se calla.
  socket.on('mediosPantallaActiva', (id) => {
    if (id === miPantalla) return;
    soyLaActiva = false;
    quiereSonar = false;
    audio.pause();
    if (video) terminarVideo({ avisar: false });
    botonPermitir.disabled = false;
    botonPermitir.textContent = '🔊 Permitir sonido aquí';
  });

  // ---------- música ----------
  function cargarMusica(m) {
    if (!m) return false;
    if (musicaId !== m.id) {
      musicaId = m.id;
      audio.src = m.src;
    }
    return true;
  }

  function reproducirMusica({ seguida = false } = {}) {
    const m = musicaActual();
    if (!m) { avisarAlCelular('🎵 Todavía no tenés música. Subila en Gestionar → 🎵 Música.'); return; }
    if (video) { avisarAlCelular('🎬 Hay un video en la pantalla: la música sigue sola cuando termine.'); return; }
    quiereSonar = true;
    cargarMusica(m);
    audio.volume = 0;
    audio.play().then(() => {
      // Si mientras arrancaba llegó un video o una pausa, no sigue sonando.
      if (video || !quiereSonar) { audio.pause(); audio.volume = volumenMusica / 100; publicarEstado(); return; }
      // Sin sonido (siguió sola) todavía hace falta el toque en la PC.
      if (!audio.muted) { permitido = true; avisoPermiso.hidden = true; }
      fundir(volumenMusica / 100);
      mostrarSello('♪ ' + m.nombre);
      publicarEstado();
    }).catch((err) => {
      if (err && err.name === 'NotAllowedError' && seguida && !audio.muted) {
        // Siguió sola al volver a abrir la pantalla: suena sin sonido (eso siempre se puede)
        // y con un toque en la PC se escucha, sin perder el segundo en que iba.
        musicaSinSonido = true;
        audio.muted = true;
        permitido = false;
        pedirPermiso();
        avisarAlCelular('🔇 La música sigue sin sonido porque la pantalla se volvió a abrir. Tocá la pantalla de la PC una vez y se escucha.');
        reproducirMusica();
      } else if (err && err.name === 'NotAllowedError') {
        permitido = false;
        pedirPermiso();
        avisarAlCelular('🔇 Tocá «Permitir sonido» en la pantalla y después ▶ de nuevo.');
      } else {
        avisarAlCelular('No se pudo reproducir «' + m.nombre + '». Probá con otra canción.');
      }
    });
  }

  function pausarMusica({ fundido: conFundido = true } = {}) {
    quiereSonar = false;
    if (audio.paused) { publicarEstado(); return; }
    const alFinal = () => { audio.pause(); audio.volume = volumenMusica / 100; publicarEstado(); };
    if (conFundido) fundir(0, alFinal); else alFinal();
    const m = musicaActual();
    if (m) mostrarSello('⏸ ' + m.nombre);
  }

  // «⏹» del celular: la música se corta y vuelve al principio; no sigue sola después de un video.
  function terminarMusica() {
    quiereSonar = false;
    musicaAntesDelVideo = false;
    const alFinal = () => {
      audio.pause();
      try { audio.currentTime = 0; } catch { /* sin datos todavía */ }
      audio.volume = volumenMusica / 100;
      publicarEstado();
    };
    if (audio.paused) alFinal(); else fundir(0, alFinal);
    mostrarSello('⏹ Música terminada');
  }

  function cambiarCancion(paso) {
    if (!musicas.length) return reproducirMusica();
    const actual = musicas.findIndex(m => m.id === musicaId);
    const siguienteI = ((actual === -1 ? 0 : actual + paso) + musicas.length) % musicas.length;
    const seguia = !video && (!audio.paused || quiereSonar);
    audio.pause();
    musicaId = null;
    cargarMusica(musicas[siguienteI]);
    if (seguia) reproducirMusica();
    else { mostrarSello('♪ ' + musicas[siguienteI].nombre); publicarEstado(); }
  }

  // Con el bucle prendido (orden «bucle» desde el celular), al terminar se repite la misma canción.
  let bucleMusica = false;
  audio.addEventListener('ended', () => {
    if (bucleMusica && !video) {
      audio.currentTime = 0;
      reproducirMusica();
      return;
    }
    // Terminó la canción: pasa a la siguiente (si hay un video, la deja lista sin sonar).
    if (video) { musicaAntesDelVideo = true; quiereSonar = false; }
    cambiarCancion(1);
  });
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    avisarAlCelular('No se pudo cargar esa canción. Paso a la siguiente.');
    if (musicas.length > 1) setTimeout(() => cambiarCancion(1), 800);
  });

  function ordenMusica({ accion, valor }) {
    if (accion === 'reproducir') return reproducirMusica();
    if (accion === 'pausar') return pausarMusica();
    if (accion === 'terminar') return terminarMusica();
    if (accion === 'alternar') return (audio.paused ? reproducirMusica() : pausarMusica());
    if (accion === 'bucle') {
      bucleMusica = valor === true;
      mostrarSello(bucleMusica ? '🔁 Se repite esta canción' : '➡️ Sin repetir');
      return publicarEstado();
    }
    if (accion === 'siguiente') return cambiarCancion(1);
    if (accion === 'anterior') {
      // Como en cualquier reproductor: si ya avanzó, vuelve al principio de la misma.
      if (audio.currentTime > 5) { audio.currentTime = 0; return publicarEstado(); }
      return cambiarCancion(-1);
    }
    if (accion === 'elegir') {
      const m = musicas.find(x => x.id === valor);
      if (!m) return avisarAlCelular('Esa canción ya no está.');
      audio.pause();
      musicaId = null;
      cargarMusica(m);
      return reproducirMusica();
    }
    if (accion === 'volumen') {
      volumenMusica = valor;
      if (!fundido) audio.volume = valor / 100;
      return publicarEstado();
    }
    const m = musicaActual();
    if (!m) return;
    cargarMusica(m);
    const duracion = Number.isFinite(audio.duration) ? audio.duration : m.duracion || Infinity;
    if (accion === 'ir') audio.currentTime = Math.min(valor, Math.max(0, duracion - 0.5));
    if (accion === 'saltar') audio.currentTime = Math.max(0, Math.min((audio.currentTime || 0) + valor, duracion - 0.5));
    publicarEstado();
  }

  // ---------- video ----------
  const inicioYt = () => (video && video.inicio) || 0;
  function tiempoVideo() {
    if (elVideo) return elVideo.currentTime || 0;
    if (yt && yt.getCurrentTime) return Math.max(0, (yt.getCurrentTime() || 0) - inicioYt());
    return 0;
  }
  function duracionVideo() {
    if (elVideo) return Number.isFinite(elVideo.duration) ? elVideo.duration : (video.duracion || 0);
    if (yt && yt.getDuration) {
      const total = yt.getDuration() || 0;
      const fin = video.fin || total;
      return Math.max(0, fin - inicioYt());
    }
    return video ? video.duracion || 0 : 0;
  }
  function videoSonando() {
    if (elVideo) return !elVideo.paused && !elVideo.ended;
    if (yt && yt.getPlayerState && window.YT) return yt.getPlayerState() === window.YT.PlayerState.PLAYING;
    return false;
  }

  let promesaYoutube = null;
  function cargarYoutube() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!promesaYoutube) {
      promesaYoutube = new Promise((resolver, rechazar) => {
        const anterior = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (anterior) anterior(); resolver(); };
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => { promesaYoutube = null; rechazar(new Error('sin YouTube')); };
        document.head.appendChild(s);
      });
    }
    return promesaYoutube;
  }

  // Un video de YouTube buscado desde el celular: no está en la lista de la persona. Su id
  // empieza con «yt:» (así se reconoce también al volver a abrir la pantalla).
  function videoBuscado(youtubeId, nombre) {
    return { id: 'yt:' + youtubeId, nombre: nombre || 'Video de YouTube', origen: 'youtube', youtubeId, buscado: true };
  }
  const esBuscado = (id) => typeof id === 'string' && id.startsWith('yt:');

  // «desde» y «pausado»: al volver a abrir la pantalla, el video sigue en el segundo en que iba.
  // «cual» es el id de un video de la lista o el video mismo (uno buscado en YouTube).
  function mandarVideo(cual, { desde = 0, pausado = false } = {}) {
    const v = typeof cual === 'object' ? cual : videos.find(x => x.id === cual);
    if (!v) return avisarAlCelular('Ese video ya no está.');
    if (video) terminarVideo({ avisar: false, reanudar: false });
    else {
      musicaAntesDelVideo = !audio.paused || quiereSonar;
      if (!audio.paused) pausarMusica();
      quiereSonar = false;
    }
    video = v;
    window.pantallaVideo.empezar();
    marcoVideo.replaceChildren();
    tituloVideo.textContent = '🎬 ' + v.nombre;
    capaVideo.hidden = false;
    requestAnimationFrame(() => capaVideo.classList.add('ver'));

    if (v.origen === 'youtube') {
      const lugar = document.createElement('div');
      marcoVideo.appendChild(lugar);
      cargarYoutube().then(() => {
        if (video !== v) return;
        yt = new window.YT.Player(lugar, {
          width: '100%',
          height: '100%',
          videoId: v.youtubeId,
          playerVars: {
            autoplay: pausado ? 0 : 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3,
            ...(v.inicio || desde ? { start: Math.floor((v.inicio || 0) + desde) } : {}), ...(v.fin ? { end: v.fin } : {}), origin: location.origin
          },
          events: {
            onReady: (e) => {
              // El enlace de la diapositiva no trae el título: lo dice el reproductor.
              const datos = e.target.getVideoData ? e.target.getVideoData() : null;
              if (v.sinTitulo && datos && datos.title) { v.nombre = datos.title; v.sinTitulo = false; tituloVideo.textContent = '🎬 ' + v.nombre; }
              if (pausado) {
                // YouTube no deja ponerse en un segundo sin arrancar: arranca callado y se frena.
                e.target.setVolume(volumenVideo);
                e.target.mute();
                pausarAlEmpezar = true;
                e.target.seekTo(Math.floor((v.inicio || 0) + desde), true);
                e.target.playVideo();
              } else arrancarYoutube(e.target);
              publicarEstado();
            },
            onStateChange: (e) => {
              if (pausarAlEmpezar && e.data === window.YT.PlayerState.PLAYING) {
                pausarAlEmpezar = false;
                e.target.pauseVideo();
                if (permitido && !videoSinSonido) e.target.unMute();
                return;
              }
              if (e.data === window.YT.PlayerState.ENDED) terminarVideo();
              else publicarEstado();
            },
            onError: (e) => {
              const motivo = e.data === 101 || e.data === 150
                ? 'El dueño de ese video no deja verlo fuera de YouTube. Elegí otro.'
                : 'No se pudo abrir ese video de YouTube. Revisá que sea público o no listado.';
              terminarVideo({ avisar: false });
              avisarAlCelular('🎬 ' + motivo);
            }
          }
        });
      }).catch(() => {
        terminarVideo({ avisar: false });
        avisarAlCelular('🎬 No se pudo conectar con YouTube. Revisá el internet de la PC.');
      });
    } else {
      elVideo = document.createElement('video');
      elVideo.src = v.src;
      elVideo.playsInline = true;
      elVideo.preload = 'auto';
      elVideo.volume = volumenVideo / 100;
      elVideo.addEventListener('ended', () => terminarVideo());
      elVideo.addEventListener('play', publicarEstado);
      elVideo.addEventListener('pause', publicarEstado);
      elVideo.addEventListener('loadedmetadata', publicarEstado);
      elVideo.addEventListener('error', () => {
        terminarVideo({ avisar: false });
        avisarAlCelular('🎬 No se pudo cargar ese video.');
      });
      if (desde) {
        const este = elVideo;
        este.addEventListener('loadedmetadata', () => {
          const total = Number.isFinite(este.duration) ? este.duration : Infinity;
          este.currentTime = Math.min(desde, Math.max(0, total - 0.5));
        }, { once: true });
      }
      marcoVideo.appendChild(elVideo);
      if (!pausado) reanudarVideo();
    }
    publicarEstado();
  }

  // Los navegadores no dejan que un video CON sonido arranque solo si nadie tocó la pantalla
  // de la PC. Entonces el video arranca igual, sin sonido (eso siempre está permitido), y se
  // pide un toque en la PC: con cualquier toque se activa el sonido sin cortar el video.
  function sinSonido() {
    if (videoSinSonido) return;
    videoSinSonido = true;
    permitido = false;
    pedirPermiso();
    avisarAlCelular('🔇 El video arrancó sin sonido porque nadie tocó la PC todavía. Tocá la pantalla de la PC una vez y se escucha.');
  }

  function activarSonidoDelVideo() {
    if (elVideo) { elVideo.muted = false; elVideo.volume = volumenVideo / 100; }
    if (yt && yt.unMute) { yt.unMute(); yt.setVolume(volumenVideo); }
  }

  function arrancarYoutube(p) {
    p.setVolume(volumenVideo);
    if (permitido && !videoSinSonido) p.unMute(); else { p.mute(); sinSonido(); }
    p.playVideo();
    // Si en 2 s no arrancó (el navegador lo frenó por el sonido), arranca sin sonido.
    clearTimeout(vigiaVideo);
    vigiaVideo = setTimeout(() => {
      if (yt !== p || !p.getPlayerState || !window.YT) return;
      const estadoYt = p.getPlayerState();
      const S = window.YT.PlayerState;
      if (estadoYt !== S.PLAYING && estadoYt !== S.BUFFERING && estadoYt !== S.PAUSED) {
        p.mute();
        p.playVideo();
        sinSonido();
      }
    }, 2000);
  }

  function reanudarVideo() {
    if (elVideo) {
      elVideo.muted = videoSinSonido;
      elVideo.play().then(() => {
        if (!videoSinSonido) { permitido = true; avisoPermiso.hidden = true; }
      }).catch((err) => {
        if (err && err.name === 'NotAllowedError' && elVideo) {
          elVideo.muted = true;
          sinSonido();
          elVideo.play().catch(() => {});
        }
      });
    } else if (yt && yt.playVideo) {
      arrancarYoutube(yt);
    }
  }

  function pausarVideo() {
    if (elVideo) elVideo.pause();
    else if (yt && yt.pauseVideo) yt.pauseVideo();
  }

  function terminarVideo({ avisar = true, reanudar = true } = {}) {
    if (!video) return;
    const nombre = video.nombre;
    if (elVideo) { elVideo.pause(); elVideo.removeAttribute('src'); elVideo.load(); }
    if (yt && yt.destroy) yt.destroy();
    pausarAlEmpezar = false;
    elVideo = null;
    yt = null;
    video = null;
    clearTimeout(vigiaVideo);
    if (videoSinSonido) { videoSinSonido = false; avisoPermiso.hidden = true; }
    capaVideo.classList.remove('ver');
    setTimeout(() => { if (!video) { capaVideo.hidden = true; marcoVideo.replaceChildren(); } }, 500);
    if (reanudar) {
      window.pantallaVideo.terminar();
      if (musicaAntesDelVideo) reproducirMusica();
      musicaAntesDelVideo = false;
    }
    if (avisar) avisarAlCelular('✅ Terminó «' + nombre + '». Volviste a tu diapositiva' + (quiereSonar ? ' y la música sigue.' : '.'));
    else publicarEstado();
  }

  function ordenVideo({ accion, valor }) {
    if (accion === 'mandar') {
      if (!permitido) pedirPermiso();
      return mandarVideo(valor);
    }
    if (accion === 'youtube') {
      if (!permitido) pedirPermiso();
      const v = videoBuscado(valor.id, valor.nombre);
      // Desde el enlace de una diapositiva llega sin título: lo dice el reproductor al cargar.
      v.sinTitulo = valor.nombre === 'Video de YouTube';
      return mandarVideo(v);
    }
    if (!video) return;
    if (accion === 'terminar') return terminarVideo();
    if (accion === 'reproducir') reanudarVideo();
    if (accion === 'pausar') pausarVideo();
    if (accion === 'alternar') { if (videoSonando()) pausarVideo(); else reanudarVideo(); }
    if (accion === 'volumen') {
      volumenVideo = valor;
      if (elVideo) elVideo.volume = valor / 100;
      if (yt && yt.setVolume) yt.setVolume(valor);
    }
    if (accion === 'ir' || accion === 'saltar') {
      const duracion = duracionVideo() || Infinity;
      const destino = Math.max(0, Math.min(accion === 'ir' ? valor : tiempoVideo() + valor, duracion - 0.5));
      if (elVideo) elVideo.currentTime = destino;
      else if (yt && yt.seekTo) yt.seekTo(inicioYt() + destino, true);
    }
    setTimeout(publicarEstado, 150);
  }

  // ---------- volumen de Windows (sólo con la app de PC) ----------
  // El navegador no puede tocarlo; la app sí (ver aplicacion-pantalla/volumen.js). Se lee cada
  // tanto por si alguien lo cambió con las teclas de la PC, así el celular muestra lo de verdad.
  const windows = window.ConexionesPC && window.ConexionesPC.volumen;
  function anotarPC(r, avisar = true) {
    if (!r || !Number.isFinite(r.volumen)) return;
    const cambio = !volumenPC || volumenPC.volumen !== r.volumen || volumenPC.mudo !== (r.mudo === true);
    volumenPC = { volumen: r.volumen, mudo: r.mudo === true };
    if (cambio && avisar) publicarEstado();
  }
  // Las órdenes van de a una: dos «−» seguidos tienen que bajar 20, no leer los dos el mismo número.
  let colaPC = Promise.resolve();
  function ordenPC(orden) {
    colaPC = colaPC.then(() => cumplirOrdenPC(orden), () => {});
    return colaPC;
  }
  async function cumplirOrdenPC({ accion, valor }) {
    if (!windows) return;
    if (!volumenPC) anotarPC(await windows.leer(), false);
    const ahora = volumenPC ? volumenPC.volumen : 50;
    if (accion === 'volumen') anotarPC(await windows.poner(valor), false);
    else if (accion === 'subir') anotarPC(await windows.poner(ahora + valor), false);
    else if (accion === 'bajar') anotarPC(await windows.poner(ahora - valor), false);
    else if (accion === 'mudo') anotarPC(await windows.mudo(valor), false);
    // Siempre contesta, aunque no cambie (ya estaba al máximo): así el celular sabe que llegó.
    publicarEstado();
  }
  if (windows) {
    windows.leer().then(anotarPC, () => {});
    setInterval(() => { if (soyLaActiva) windows.leer().then(anotarPC, () => {}); }, 4000);
  }

  // ---------- órdenes del celular ----------
  socket.on('medios', (orden) => {
    if (!orden || !soyLaActiva) return;
    if (orden.para === 'musica') ordenMusica(orden);
    else if (orden.para === 'video') ordenVideo(orden);
    else if (orden.para === 'pc') ordenPC(orden);
  });
  socket.on('mediosPedirEstado', publicarEstado);
  // Para recargarse con una versión nueva (pantalla.js): espera a que no suene nada y antes cuenta
  // lo que había, así sigue igual después.
  window.mediosSonando = () => (!audio.paused && quiereSonar) || videoSonando();
  window.addEventListener('conexiones:contarMedios', publicarEstado);

  // ---------- seguir donde iba ----------
  // La pantalla se cerró o se recargó con música o un video: el servidor cuenta qué sonaba, en
  // qué segundo y hace cuánto. Se sigue una sola vez, apenas está la lista de esta persona.
  let listaCargada = false;
  let paraSeguir;      // undefined: todavía no contestó el servidor; null: nada que seguir
  let yaSeguido = false;
  socket.on('mediosSeguir', (recuerdo) => {
    if (yaSeguido) return;
    paraSeguir = recuerdo || null;
    seguirDondeIba();
  });

  function seguirDondeIba() {
    if (yaSeguido || !listaCargada || paraSeguir === undefined) return;
    yaSeguido = true;
    const r = paraSeguir;
    paraSeguir = null;
    contando = true;
    if (!r || !soyLaActiva) return publicarEstado();
    const paso = Math.max(0, (Number(r.hace) || 0) / 1000);
    const m = r.musica && musicas.find(x => x.id === r.musica.id);
    const v = r.video && (esBuscado(r.video.id)
      ? videoBuscado(r.video.id.slice(3), r.video.nombre)
      : videos.find(x => x.id === r.video.id));
    if (r.musica) volumenMusica = r.musica.volumen;
    if (r.video) volumenVideo = r.video.volumen;
    audio.volume = volumenMusica / 100;

    // El video sigue si todavía no había terminado.
    let desde = 0;
    let quedaVideo = false;
    if (v) {
      desde = r.video.t + (r.video.sonando ? paso : 0);
      quedaVideo = !r.video.duracion || desde < r.video.duracion - 1;
    }

    if (m) {
      cargarMusica(m);
      // Con un video encima la canción no corrió: sigue en el mismo segundo.
      const t = r.musica.t + (r.musica.sonando && !v ? paso : 0);
      const total = r.musica.duracion || m.duracion || 0;
      const destino = total && t >= total - 0.5 ? 0 : t;
      const ponerEn = () => { try { audio.currentTime = destino; } catch (e) { /* sin datos todavía */ } };
      if (destino) {
        if (audio.readyState >= 1) ponerEn();
        else audio.addEventListener('loadedmetadata', ponerEn, { once: true });
      }
    }

    if (v && quedaVideo) {
      mandarVideo(v, { desde, pausado: !r.video.sonando });
      musicaAntesDelVideo = Boolean(m && (r.musicaDespues || r.musica.sonando));
    } else if (m && (r.musica.sonando || (r.video && r.musicaDespues))) {
      reproducirMusica({ seguida: true });
    }
    publicarEstado();
  }

  // ---------- lista de música y videos de esta persona ----------
  function cargarLista() {
    return authFetch('/api/multimedia')
      .then(res => res.json())
      .then((datos) => {
        const elementos = datos.elementos || [];
        musicas = elementos.filter(e => e.tipo === 'musica');
        videos = elementos.filter(e => e.tipo === 'video');
        // Si se borró lo que estaba sonando, se detiene.
        if (musicaId && !musicas.some(m => m.id === musicaId)) {
          audio.pause();
          audio.removeAttribute('src');
          musicaId = null;
          quiereSonar = false;
        }
        if (video && !video.buscado && !videos.some(v => v.id === video.id)) terminarVideo();
        listaCargada = true;
        seguirDondeIba();
        publicarEstado();
      })
      .catch(err => console.error('No se pudo cargar la música y los videos:', err));
  }

  window.esperarSesionPantalla().then(() => {
    cargarLista();
    // Un servidor viejo no contesta «mediosSeguir»: igual se empieza a contar.
    setTimeout(() => { if (paraSeguir === undefined) { paraSeguir = null; seguirDondeIba(); } }, 8000);
    socket.on('multimediaActualizada', cargarLista);
    socket.on('connect', () => setTimeout(() => { cargarLista(); }, 300));
  });
})();
