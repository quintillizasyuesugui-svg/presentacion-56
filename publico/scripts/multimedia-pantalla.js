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
  const textoAvisoPermiso = document.getElementById('avisoPermisoTexto');
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

  // ---- Video ----
  let video = null;          // el elemento del video actual (en la lista), o null
  let elVideo = null;        // <video> para los subidos
  let yt = null;             // reproductor de YouTube
  let volumenVideo = VOLUMEN_INICIAL_VIDEO;

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

  function pedirPermiso(texto) {
    textoAvisoPermiso.textContent = texto || 'Tocá para que se escuche la música y los videos';
    avisoPermiso.hidden = false;
  }

  // ---------- estado para el celular ----------
  let aviso = null;
  function publicarEstado() {
    if (!soyLaActiva) return;
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
        volumen: volumenVideo,
        posicion: videos.indexOf(video),
        total: videos.length
      } : null
    };
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
    avisoPermiso.hidden = true;
    botonPermitir.textContent = '🔊 Sonido permitido';
    botonPermitir.disabled = true;
    emitir('mediosPantallaActiva', miPantalla);
    // Si el celular ya había pedido algo, arranca ahora.
    if (video) reanudarVideo();
    else if (quiereSonar) reproducirMusica();
    publicarEstado();
  }
  botonPermitir.addEventListener('click', permitir);
  botonAvisoPermiso.addEventListener('click', permitir);
  // Cualquier toque cuenta (por ejemplo «Ir a pantalla completa»).
  document.addEventListener('pointerdown', () => {
    if (!permitido) { permitido = true; publicarEstado(); }
  }, { capture: true });

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

  function reproducirMusica() {
    const m = musicaActual();
    if (!m) { avisarAlCelular('🎵 Todavía no tenés música. Subila en Gestionar → 🎵 Música.'); return; }
    if (video) { avisarAlCelular('🎬 Hay un video en la pantalla: la música sigue sola cuando termine.'); return; }
    quiereSonar = true;
    cargarMusica(m);
    audio.volume = 0;
    audio.play().then(() => {
      // Si mientras arrancaba llegó un video o una pausa, no sigue sonando.
      if (video || !quiereSonar) { audio.pause(); audio.volume = volumenMusica / 100; publicarEstado(); return; }
      permitido = true;
      avisoPermiso.hidden = true;
      fundir(volumenMusica / 100);
      mostrarSello('♪ ' + m.nombre);
      publicarEstado();
    }).catch((err) => {
      if (err && err.name === 'NotAllowedError') {
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

  audio.addEventListener('ended', () => {
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
    if (accion === 'alternar') return (audio.paused ? reproducirMusica() : pausarMusica());
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

  function mandarVideo(id) {
    const v = videos.find(x => x.id === id);
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
            autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3,
            ...(v.inicio ? { start: v.inicio } : {}), ...(v.fin ? { end: v.fin } : {}), origin: location.origin
          },
          events: {
            onReady: (e) => { e.target.setVolume(volumenVideo); if (permitido) e.target.playVideo(); else pedirPermiso(); publicarEstado(); },
            onStateChange: (e) => {
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
      marcoVideo.appendChild(elVideo);
      reanudarVideo();
    }
    publicarEstado();
  }

  function reanudarVideo() {
    if (elVideo) {
      elVideo.play().then(() => { permitido = true; avisoPermiso.hidden = true; }).catch((err) => {
        if (err && err.name === 'NotAllowedError') {
          permitido = false;
          pedirPermiso('Tocá para que se escuche el video');
          avisarAlCelular('🔇 Tocá «Permitir sonido» en la pantalla para ver el video.');
        }
      });
    } else if (yt && yt.playVideo) {
      yt.playVideo();
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
    elVideo = null;
    yt = null;
    video = null;
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
      if (!permitido) pedirPermiso('Tocá para que se escuche el video');
      return mandarVideo(valor);
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

  // ---------- órdenes del celular ----------
  socket.on('medios', (orden) => {
    if (!orden || !soyLaActiva) return;
    if (orden.para === 'musica') ordenMusica(orden);
    else if (orden.para === 'video') ordenVideo(orden);
  });
  socket.on('mediosPedirEstado', publicarEstado);

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
        if (video && !videos.some(v => v.id === video.id)) terminarVideo();
        publicarEstado();
      })
      .catch(err => console.error('No se pudo cargar la música y los videos:', err));
  }

  ensureAuthed({ allowRegister: false }).then(() => {
    cargarLista();
    socket.on('multimediaActualizada', cargarLista);
    socket.on('connect', () => setTimeout(() => { cargarLista(); }, 300));
  });
})();
