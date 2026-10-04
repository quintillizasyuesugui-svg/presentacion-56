  const socket = io();
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const authNameBadge = document.getElementById('authNameBadge');
  const logoutBtn = document.getElementById('logoutBtn');

  socket.on('connect', () => {
    statusDot.classList.add('online');
    statusText.textContent = 'Conectado';
  });
  socket.on('disconnect', () => {
    statusDot.classList.remove('online');
    statusText.textContent = 'Sin conexión';
  });

  function enviar(accion) {
    // "Atrás"/"Siguiente" antes de "Mostrar" no tienen nada que recorrer
    // (pantalla.html los ignora igual, ver aplicarCambio ahí) — en vez de que
    // no pase nada en silencio, avisa por qué.
    if (!showStarted && (accion === 'anterior' || accion === 'siguiente')) {
      showToast('Apretá "Mostrar" para encender');
      return;
    }
    if (accion === 'mostrar' && showStarted) {
      // Ya está mostrando: tocar «Mostrar» de nuevo es para terminar. Se pregunta antes de cerrar.
      preguntarCerrarPantalla();
      return;
    }
    if (accion === 'mostrar') {
      // Sin imágenes la pantalla no tiene qué mostrar: se avisa acá en vez de no hacer nada.
      if (imagenesCargadas && totalSlides === 0) {
        showToast('📷 Primero subí tus imágenes en «🖼️ Gestionar».');
        return;
      }
      showStarted = true;
      if (!fotoPantalla.foto) fotoPantalla = { foto: 1, total: totalSlides || 1 };
      updateNavButtonsState();
      pintarPasos();
    }
    socket.emit('cambiar', accion);
  }

  // ---- Aviso propio (en vez de alert()) ----
  const toast = document.getElementById('toast');
  let toastTimer;
  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 200);
    }, 3200);
  }

  // ---- Avance automático: contador en vivo, sincronizado con pantalla.html ----
  // pantalla.html es la que de verdad pasa las diapositivas (esto es 100% local
  // ahí) — este contador es sólo un espejo, avisado por socket al mismo
  // instante en que arranca cada cuenta regresiva allá.
  const autoCountdownInline = document.getElementById('autoCountdownInline');
  const anteriorBtn = document.getElementById('anteriorBtn');
  const siguienteBtn = document.getElementById('siguienteBtn');
  const mostrarBtn = document.getElementById('mostrarBtn');
  let autoAdvanceEndAt = null;
  let autoAdvanceOn = false;
  let showStarted = false; // recién true al apretar "Mostrar" — antes, pantalla.html no tiene nada que recorrer
  let fotoPantalla = { foto: 0, total: 0 }; // en qué foto va la pantalla (lo cuenta ella, ver «pantallaEstado»)

  // Cuadrito «Mostrar»: celeste que late hasta que se toca; después verde con «3/10» y una barrita.
  function pintarMostrar() {
    const encendido = showStarted;
    mostrarBtn.classList.toggle('listo', !encendido);
    mostrarBtn.classList.toggle('mostrando', encendido);
    document.getElementById('mostrarPlay').hidden = encendido;
    document.getElementById('mostrarNumero').hidden = !encendido;
    document.getElementById('mostrarAvance').hidden = !encendido;
    document.getElementById('mostrarNombre').textContent = encendido ? 'En pantalla' : 'Mostrar';
    if (encendido) {
      const total = Math.max(1, fotoPantalla.total || totalSlidesSeguro());
      const foto = Math.min(total, Math.max(1, fotoPantalla.foto || 1));
      document.getElementById('mostrarFoto').textContent = foto;
      document.getElementById('mostrarTotal').textContent = total;
      document.getElementById('mostrarBarra').style.width = (foto / total * 100) + '%';
      mostrarBtn.setAttribute('aria-label', `En pantalla: foto ${foto} de ${total}. Tocá para cerrar tu pantalla al terminar.`);
    } else {
      mostrarBtn.removeAttribute('aria-label');
    }
  }
  // ---- Cerrar la pantalla al terminar ----
  // Una hoja pregunta antes de cerrar, para que un toque sin querer no corte la presentación.
  // Al confirmar, la pantalla de la PC cierra la sesión y queda libre para la siguiente persona.
  let hojaCerrar = null;
  function armarHojaCerrar() {
    const velo = document.createElement('div');
    velo.className = 'hoja-velo';
    velo.hidden = true;
    const hoja = document.createElement('section');
    hoja.className = 'hoja-medios';
    hoja.hidden = true;
    hoja.setAttribute('role', 'dialog');
    hoja.setAttribute('aria-label', '¿Cerrar tu pantalla?');
    const asa = document.createElement('div');
    asa.className = 'hoja-asa';
    const titulo = document.createElement('h2');
    titulo.textContent = '¿Cerrar tu pantalla?';
    const nota = document.createElement('p');
    nota.className = 'hoja-nota';
    nota.textContent = 'La pantalla de la PC cierra tu sesión y queda libre para la siguiente persona. Tus fotos no se borran.';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'btn danger-solid';
    cerrar.textContent = 'Cerrar pantalla';
    cerrar.addEventListener('click', cerrarPantalla);
    const seguir = document.createElement('button');
    seguir.type = 'button';
    seguir.className = 'btn secondary';
    seguir.textContent = 'Seguir mostrando';
    seguir.addEventListener('click', ocultarHojaCerrar);
    velo.addEventListener('click', ocultarHojaCerrar);
    hoja.append(asa, titulo, nota, cerrar, seguir);
    document.body.append(velo, hoja);
    return { velo, hoja, seguir };
  }
  function preguntarCerrarPantalla() {
    if (!hojaCerrar) hojaCerrar = armarHojaCerrar();
    hojaCerrar.velo.hidden = false;
    hojaCerrar.hoja.hidden = false;
    requestAnimationFrame(() => { hojaCerrar.velo.classList.add('abierta'); hojaCerrar.hoja.classList.add('abierta'); });
    setTimeout(() => hojaCerrar.seguir.focus(), 50);
  }
  function hojaCerrarAbierta() {
    return Boolean(hojaCerrar && !hojaCerrar.hoja.hidden);
  }
  function ocultarHojaCerrar() {
    if (!hojaCerrar) return;
    hojaCerrar.velo.classList.remove('abierta');
    hojaCerrar.hoja.classList.remove('abierta');
    setTimeout(() => { hojaCerrar.velo.hidden = true; hojaCerrar.hoja.hidden = true; }, 320);
  }
  function cerrarPantalla() {
    ocultarHojaCerrar();
    socket.emit('cerrarPantalla');
    showStarted = false;
    fotoPantalla = { foto: 0, total: 0 };
    updateNavButtonsState();
    pintarPasos();
    showToast('✅ Pantalla cerrada. Ya puede entrar la siguiente persona.');
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hojaCerrarAbierta()) ocultarHojaCerrar(); });

  function totalSlidesSeguro() {
    try { return totalSlides; } catch { return 0; } // totalSlides se declara más abajo
  }

  // Mientras "Escribir en vivo" está mostrándose, NINGÚN botón de navegación
  // hace nada en pantalla.html (ver aplicarCambio ahí) — ni Mostrar, ni
  // Siguiente/Atrás — así que los 3 se apagan acá también, para que no
  // parezcan rotos. El avance automático, en cambio, sólo frena
  // Siguiente/Atrás, nunca Mostrar (así ya funcionaba antes).
  //
  // Antes de arrancar con "Mostrar", Atrás/Siguiente también se ven apagados
  // — pero con una clase aparte ("is-off", sin pointer-events:none) en vez de
  // "disabled", para que el click siga entrando y avise con un mensaje en vez
  // de no hacer nada en silencio (ver enviar()).
  function updateNavButtonsState() {
    anteriorBtn.disabled = autoAdvanceOn || lwActive;
    siguienteBtn.disabled = autoAdvanceOn || lwActive;
    mostrarBtn.disabled = lwActive;
    // Cuadrito «Escribir» con punto rojo mientras se ve en la pantalla.
    const lw = document.getElementById('liveWriteBtn');
    if (lw) {
      lw.classList.toggle('en-vivo', !!lwActive);
      document.getElementById('liveWritePunto').hidden = !lwActive;
    }
    pintarMostrar();
    anteriorBtn.classList.toggle('is-off', !showStarted);
    siguienteBtn.classList.toggle('is-off', !showStarted);
  }
  // Estado inicial: "is-off" nomás (autoAdvanceOn/lwActive todavía no existen
  // acá arriba en el archivo — se declaran más abajo — así que no se puede
  // llamar a updateNavButtonsState() todavía; da lo mismo, al arrancar
  // siempre están en false).
  anteriorBtn.classList.add('is-off');
  siguienteBtn.classList.add('is-off');

  function refreshAutoAdvanceEnabled() {
    authFetch('/api/avance-automatico')
      .then(res => res.json())
      .then(auto => { autoAdvanceOn = !!(auto && auto.enabled); updateNavButtonsState(); })
      .catch(err => console.error('Error loading avance automático:', err));
  }

  function formatCountdown(totalSeconds) {
    if (totalSeconds >= 60) {
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      return m + 'm ' + String(s).padStart(2, '0') + 's';
    }
    return totalSeconds + 's';
  }

  function updateAutoCountdownInline() {
    if (!autoAdvanceEndAt) { autoCountdownInline.hidden = true; return; }
    const remaining = Math.max(0, Math.ceil((autoAdvanceEndAt - Date.now()) / 1000));
    autoCountdownInline.hidden = false;
    autoCountdownInline.textContent = '⏱️ Siguiente en ' + formatCountdown(remaining);
  }
  setInterval(updateAutoCountdownInline, 1000);

  socket.on('avanceAutoAviso', (payload) => {
    if (!payload) return;
    if (payload.tipo === 'cuenta') {
      autoAdvanceEndAt = Date.now() + payload.segundos * 1000;
      updateAutoCountdownInline();
      autoAdvanceOn = true;
      updateNavButtonsState();
    } else if (payload.tipo === 'terminamos') {
      autoAdvanceEndAt = null;
      updateAutoCountdownInline();
      autoAdvanceOn = false;
      updateNavButtonsState();
      showToast('🏁 Terminamos — avance automático desactivado.');
    }
  });

  let recognition;
  let voiceActive = false;

  // Total de diapositivas reales — acota qué números tiene sentido reconocer por voz
  // (si hay 8 imágenes, acepta "1".."8"; si hay 3, sólo "1".."3"). Cuenta las
  // propias de quien está controlando (o todas, con el PIN admin) — mismo
  // criterio que pantalla.html, para que los números coincidan con lo que se ve ahí.
  let totalSlides = 0;
  let imagenesCargadas = false;
  function refreshSlideCount() {
    authFetch('/api/images')
      .then(res => res.json())
      .then(images => { totalSlides = images.length; imagenesCargadas = true; pintarPasos(); })
      .catch(err => console.error('Error loading images:', err));
  }

  // ---- Primeros pasos: guía de 3 pasos que se marcan solos ----
  // 1) imágenes subidas, 2) la pantalla de la PC abierta con el mismo PIN (contesta por
  // socket), 3) «Mostrar». Se oculta sola al completar los tres o con ✕ (queda recordado).
  const primerosPasos = document.getElementById('primerosPasos');
  const CLAVE_PASOS = 'conexionesPrimerosPasosOculto';
  let pantallaVista = false;
  let pasosOcultos = false;
  try { pasosOcultos = localStorage.getItem(CLAVE_PASOS) === '1'; } catch { /* sin almacenamiento */ }
  document.getElementById('direccionPantalla').textContent = location.host + '/pantalla.html';
  function ocultarPasos() {
    pasosOcultos = true;
    try { localStorage.setItem(CLAVE_PASOS, '1'); } catch { /* sin almacenamiento */ }
    primerosPasos.hidden = true;
  }
  document.getElementById('pasosCerrar').addEventListener('click', ocultarPasos);
  function pintarPasos() {
    if (pasosOcultos || !imagenesCargadas) return;
    const hechos = [totalSlides > 0, pantallaVista, showStarted];
    hechos.forEach((hecho, i) => document.getElementById('paso' + (i + 1)).classList.toggle('hecho', hecho));
    primerosPasos.hidden = false;
    if (hechos.every(Boolean)) {
      document.getElementById('pasosTitulo').textContent = '✅ ¡Listo! Ya estás presentando';
      setTimeout(ocultarPasos, 4000);
    }
  }
  socket.on('mediosEstado', (estado) => {
    if (!pantallaVista) { pantallaVista = true; pintarPasos(); }
    const sonando = !!(estado && estado.musica && estado.musica.sonando);
    const musicaBtn = document.getElementById('musicaBtn');
    if (musicaBtn) {
      musicaBtn.classList.toggle('sonando', sonando);
      document.getElementById('musicaPunto').hidden = !sonando;
    }
  });

  // ---- Zoom: la foto de la pantalla en el celular ----
  // Con dos dedos se agranda (hasta ×4), con uno se mueve, con doble toque vuelve a la foto
  // entera; en la PC, la rueda del mouse agranda. La pantalla hace lo mismo al instante. Se
  // mandan como mucho unos 12 avisos por segundo (el guardián de pantallas corta en 30).
  const zoomMini = document.getElementById('zoomMini');
  const zoomFoto = document.getElementById('zoomFoto');
  const zoomVisor = document.getElementById('zoomVisor');
  const zoomTag = document.getElementById('zoomTag');
  let zoom = { z: 1, cx: 0.5, cy: 0.5 };
  let zoomSrc = '';
  let zoomUltimoEnvio = 0;
  let zoomPendiente = null;

  // Para la foto chica del celular alcanza una versión liviana (Cloudinary la achica).
  function fotoChica(src) {
    if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(src)) return src;
    if (/\/upload\/(w|q|f|c)_/.test(src)) return src;
    return src.replace('/image/upload/', '/image/upload/f_auto,q_auto,c_limit,w_800/');
  }

  function zoomMostrarFoto(src, z) {
    if (!src) return;
    if (src !== zoomSrc) {
      zoomSrc = src;
      zoomFoto.src = fotoChica(src);
    }
    zoomFoto.hidden = false;
    document.getElementById('zoomApagado').hidden = true;
    document.getElementById('zoomAyuda').hidden = false;
    zoomTag.hidden = false;
    zoom = z && Number.isFinite(z.z) ? { z: z.z, cx: z.cx, cy: z.cy } : { z: 1, cx: 0.5, cy: 0.5 };
    pintarZoom();
  }

  function acotarZoom() {
    zoom.z = Math.min(4, Math.max(1, zoom.z));
    const m = 0.5 / zoom.z;
    zoom.cx = Math.min(1 - m, Math.max(m, zoom.cx));
    zoom.cy = Math.min(1 - m, Math.max(m, zoom.cy));
  }

  function pintarZoom() {
    const lado = 100 / zoom.z;
    zoomVisor.hidden = zoom.z <= 1.01;
    zoomVisor.style.width = lado + '%';
    zoomVisor.style.height = lado + '%';
    zoomVisor.style.left = (zoom.cx * 100 - lado / 2) + '%';
    zoomVisor.style.top = (zoom.cy * 100 - lado / 2) + '%';
    zoomTag.textContent = zoom.z > 1.01 ? '🔍 ×' + zoom.z.toFixed(1) : '🔍 Normal';
  }

  function mandarZoom(alFinal) {
    const ahora = Date.now();
    clearTimeout(zoomPendiente);
    if (alFinal || ahora - zoomUltimoEnvio >= 80) {
      zoomUltimoEnvio = ahora;
      socket.emit('zoom', { z: zoom.z, cx: zoom.cx, cy: zoom.cy });
    } else {
      zoomPendiente = setTimeout(() => mandarZoom(true), 80 - (ahora - zoomUltimoEnvio));
    }
  }

  function cambiarZoom(nuevo, alFinal) {
    if (!showStarted || zoomFoto.hidden) return;
    Object.assign(zoom, nuevo);
    acotarZoom();
    pintarZoom();
    mandarZoom(alFinal);
  }

  // Otro celular de la misma persona hizo zoom: se ve acá también.
  socket.on('zoom', (z) => {
    if (!z) return;
    zoom = { z: z.z, cx: z.cx, cy: z.cy };
    pintarZoom();
  });

  const dedos = new Map();
  let gesto = null;
  let ultimoToque = 0;
  function distancia(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function centro(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function empezarGesto() {
    const lista = [...dedos.values()];
    gesto = { z: zoom.z, cx: zoom.cx, cy: zoom.cy, lista: lista.map(p => ({ ...p })) };
  }
  zoomMini.addEventListener('pointerdown', (e) => {
    try { zoomMini.setPointerCapture(e.pointerId); } catch { /* algunos navegadores no la dan */ }
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    empezarGesto();
  });
  zoomMini.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId) || !gesto) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = zoomMini.getBoundingClientRect();
    const ahora = [...dedos.values()];
    if (ahora.length >= 2 && gesto.lista.length >= 2) {
      const antes = gesto.lista;
      const escala = distancia(ahora[0], ahora[1]) / Math.max(1, distancia(antes[0], antes[1]));
      const c0 = centro(antes[0], antes[1]);
      const c1 = centro(ahora[0], ahora[1]);
      const z = gesto.z * escala;
      cambiarZoom({ z, cx: gesto.cx - (c1.x - c0.x) / r.width / z, cy: gesto.cy - (c1.y - c0.y) / r.height / z });
    } else if (ahora.length === 1 && gesto.lista.length === 1) {
      const a = gesto.lista[0];
      cambiarZoom({ cx: gesto.cx - (ahora[0].x - a.x) / r.width / gesto.z, cy: gesto.cy - (ahora[0].y - a.y) / r.height / gesto.z });
    }
  });
  function soltar(e) {
    if (!dedos.has(e.pointerId)) return;
    const quieto = gesto && gesto.lista.length === 1 && dedos.size === 1 &&
      Math.abs(e.clientX - gesto.lista[0].x) < 8 && Math.abs(e.clientY - gesto.lista[0].y) < 8;
    dedos.delete(e.pointerId);
    if (quieto) {
      const ahora = Date.now();
      if (ahora - ultimoToque < 320) { cambiarZoom({ z: 1, cx: 0.5, cy: 0.5 }, true); ultimoToque = 0; }
      else ultimoToque = ahora;
    }
    if (dedos.size) empezarGesto(); else { gesto = null; mandarZoom(true); }
  }
  zoomMini.addEventListener('pointerup', soltar);
  zoomMini.addEventListener('pointercancel', soltar);
  zoomMini.addEventListener('wheel', (e) => {
    e.preventDefault();
    cambiarZoom({ z: zoom.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12) }, true);
  }, { passive: false });

  ensureAuthed().then((auth) => {
    authNameBadge.hidden = false;
    authNameBadge.textContent = authBadgeText(auth);
    logoutBtn.hidden = false;
    logoutBtn.addEventListener('click', () => logoutAuth());
    refreshSlideCount();
    socket.on('imagenesActualizadas', refreshSlideCount);
    refreshAutoAdvanceEnabled();
    // El servidor avisa al instante cuando cambia ('avanceActualizado'); esto es sólo un respaldo
    // por si se cortó el aviso (antes era cada 4 s: con varias escuelas eran miles de pedidos).
    socket.on('avanceActualizado', refreshAutoAdvanceEnabled);
    setInterval(refreshAutoAdvanceEnabled, 30000);

    // Vincula este socket a la sala de este dueño (por PIN) para recibir los
    // avisos del avance automático de SU PROPIA pantalla.html — nunca los de
    // otra persona. Se repite en cada reconexión, igual que en pantalla.html.
    function identificarSocket() { socket.emit('identificar', auth.pin); }
    // Recién identificado (al abrir o al volver de Gestionar): ¿la pantalla ya está mostrando?
    socket.on('identificado', () => socket.emit('pantallaPedirEstado'));
    socket.on('pantallaEstado', (estado) => {
      if (!estado) return;
      if (estado.mostrando) {
        fotoPantalla = { foto: estado.foto, total: estado.total };
        if (!showStarted) { showStarted = true; pintarPasos(); }
        updateNavButtonsState();
        zoomMostrarFoto(estado.src, estado.zoom);
      }
    });
    identificarSocket();
    socket.on('connect', identificarSocket);
  });

  // Qué quiso decir la persona lo decide ordenes-voz.js (diapositivas, música, video y
  // volumen). Acá sólo se hace lo que entendió y se muestra en el control.
  // «alternativas»: las versiones de lo oído, de la más probable a la menos.
  // Lo último que se pidió y que tiene sentido repetir con «un poco más»: subir o bajar el
  // volumen, adelantar o atrasar, agrandar, achicar o correr la imagen.
  let ultimaOrdenDeVoz = null;
  const SE_REPITE = ['subirVolumen', 'bajarVolumen', 'saltar', 'acercar', 'alejar', 'derecha', 'izquierda', 'arriba', 'abajo'];

  function hacerOrdenDeVoz(alternativas) {
    const oido = String(alternativas[0] || '').trim();
    // Con la pregunta «¿Cerrar tu pantalla?» abierta sólo se escucha la respuesta: «sí» (o
    // «cerrar») cierra, «no» (o «seguir») la deja como está.
    if (hojaCerrarAbierta()) {
      const dichas = alternativas.flatMap(a => window.OrdenesVoz.normalizar(a).split(/\s+/));
      if (['si', 'confirmar', 'confirmo', 'cerrar', 'cierra', 'cerrala'].some(p => dichas.includes(p))) {
        cerrarPantalla();
        showHeard(oido, '✅ pantalla cerrada');
      } else if (['no', 'seguir', 'sigue', 'cancelar', 'cancela'].some(p => dichas.includes(p))) {
        ocultarHojaCerrar();
        showHeard(oido, 'seguís mostrando');
      }
      return;
    }
    let orden = window.OrdenesVoz.interpretarVoz(alternativas, totalSlides);
    if (!orden) {
      // Una frase corta que no se entendió se muestra, para saber qué oyó; una larga es
      // alguien hablando y no hace falta avisar nada.
      if (oido && oido.split(/\s+/).length <= 4) showHeard(oido, 'no entendí esa orden');
      return;
    }
    if (orden.tipo === 'repetir') {
      if (!ultimaOrdenDeVoz) { showHeard(oido, 'decime primero qué: «sube el volumen», «agranda», «adelanta la música»…'); return; }
      orden = ultimaOrdenDeVoz;
    }
    ultimaOrdenDeVoz = SE_REPITE.includes(orden.accion) ? orden : null;
    if (orden.tipo === 'cerrar') {
      if (!showStarted) { showHeard(oido, 'no hay nada en pantalla para cerrar'); return; }
      preguntarCerrarPantalla();
      showHeard(oido, 'decí «sí» para cerrar o «no» para seguir');
      return;
    }
    if (orden.tipo === 'diapositiva') {
      socket.emit('cambiar', orden.accion);
      showHeard(oido);
      return;
    }
    if (orden.tipo === 'zoom') {
      // Agrandar o achicar la imagen de la pantalla, igual que con los dos dedos.
      if (!showStarted || zoomFoto.hidden) { showHeard(oido, 'primero tocá «Mostrar»'); return; }
      if (orden.accion === 'centrar') {
        // Sólo centra: el tamaño queda como estaba.
        cambiarZoom({ cx: 0.5, cy: 0.5 }, true);
        showHeard(oido, zoom.z > 1.01 ? '🎯 Centrada' : '🎯 Ya está entera y centrada');
        return;
      }
      const BORDE = { 'borde-arriba': [{ cy: 0 }, '⤒ Arriba del todo'], 'borde-abajo': [{ cy: 1 }, '⤓ Abajo del todo'], 'borde-izquierda': [{ cx: 0 }, '⇤ A la izquierda del todo'], 'borde-derecha': [{ cx: 1 }, '⇥ A la derecha del todo'] };
      const borde = BORDE[orden.accion];
      if (borde) {
        // Hasta el borde de la imagen (cambiarZoom no deja pasarse); entera, primero al doble.
        cambiarZoom(Object.assign({ z: zoom.z > 1.01 ? zoom.z : 2 }, borde[0]), true);
        showHeard(oido, borde[1]);
        return;
      }
      const MOVER = { derecha: [1, 0, '➡️ Derecha'], izquierda: [-1, 0, '⬅️ Izquierda'], arriba: [0, -1, '⬆️ Arriba'], abajo: [0, 1, '⬇️ Abajo'] };
      const mover = MOVER[orden.accion];
      if (mover) {
        // Sólo se puede correr una imagen agrandada: si está entera, primero se agranda al doble.
        const z = zoom.z > 1.01 ? zoom.z : 2;
        const paso = 0.5 / z; // media ventana de lo que se ve
        cambiarZoom({ z, cx: zoom.cx + mover[0] * paso, cy: zoom.cy + mover[1] * paso }, true);
        showHeard(oido, mover[2]);
        return;
      }
      const nuevo = orden.accion === 'normal' ? { z: 1, cx: 0.5, cy: 0.5 } : { z: zoom.z * (orden.accion === 'acercar' ? 1.5 : 1 / 1.5) };
      cambiarZoom(nuevo, true);
      showHeard(oido, zoom.z > 1.01 ? '🔍 ×' + zoom.z.toFixed(1) : '🔍 Tamaño normal');
      return;
    }
    const hecho = typeof window.ordenDeVozMedios === 'function' ? window.ordenDeVozMedios(orden) : null;
    showHeard(oido, hecho);
  }

  // El español del celular (es-AR, es-MX, es-PE…) entiende mejor el acento de la persona que
  // el de España fijo; si el celular está en otro idioma, se usa español igual.
  function idiomaDeVoz() {
    const idioma = navigator.language || '';
    return /^es\b/i.test(idioma) ? idioma : 'es-ES';
  }

  const voiceBtn = document.getElementById('voiceBtn');
  const voiceStatus = document.getElementById('voiceStatus');
  const voiceHeard = document.getElementById('voiceHeard');

  function setVoiceUI(active) {
    voiceBtn.textContent = active ? '🛑 Detener voz' : '🎤 Voz';
    voiceBtn.classList.toggle('active', active);
    voiceStatus.hidden = !active;
    if (!active) voiceHeard.hidden = true;
  }

  // Muestra en verde lo último que se reconoció por voz y, si hay, lo que se hizo con eso
  function showHeard(text, hecho) {
    voiceHeard.textContent = '🎙️ "' + text + '"' + (hecho ? ' · ' + hecho : '');
    voiceHeard.hidden = false;
    voiceHeard.classList.remove('pulse');
    void voiceHeard.offsetWidth; // fuerza reflow para poder repetir la animación
    voiceHeard.classList.add('pulse');
  }

  function initVoice() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 5;
      recognition.lang = idiomaDeVoz();
      recognition.onresult = (event) => {
        // Solo procesar los resultados nuevos desde resultIndex — leer siempre
        // results[0] hacía que, en modo continuo, sólo se escuchara la primera frase de la sesión.
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal) continue;
          hacerOrdenDeVoz(Array.from(result).map(alt => alt.transcript));
        }
      };
      recognition.onerror = (event) => {
        console.error('Voice error:', event.error);
        // Sin permiso de micrófono no tiene sentido seguir reintentando
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          voiceActive = false;
          setVoiceUI(false);
        }
      };
      // El navegador corta el reconocimiento solo (a veces tras una sola orden,
      // sobre todo en celular) aunque continuous=true — por eso lo reiniciamos
      // acá cada vez que termina, mientras el usuario no lo haya apagado.
      recognition.onend = () => {
        if (!voiceActive) return;
        try {
          recognition.start();
        } catch (e) {
          // A veces onend llega justo después de un start() y tira "already started"
          setTimeout(() => {
            if (voiceActive) {
              try { recognition.start(); } catch (e2) { /* se reintentará en el próximo onend */ }
            }
          }, 250);
        }
      };
    }
  }

  // En la app Conexiones Control escucha el reconocedor de voz del propio celular (el navegador
  // que lleva la app adentro no tiene uno). La app avisa acá lo que oyó.
  const vozDeLaApp = (() => {
    try { return window.Voz && window.Voz.disponible() ? window.Voz : null; } catch { return null; }
  })();
  window.vozNativa = {
    resultado(alternativas) {
      if (voiceActive && Array.isArray(alternativas) && alternativas.length) hacerOrdenDeVoz(alternativas);
    },
    aviso(motivo) {
      voiceActive = false;
      setVoiceUI(false);
      alert(motivo === 'sin-permiso'
        ? 'Para darle órdenes por voz, la app necesita permiso para usar el micrófono. Tocá «🎤 Voz» de nuevo y elegí «Permitir».'
        : 'Este celular no tiene reconocimiento de voz disponible. Instalá o activá la app «Google» y probá de nuevo.');
    }
  };

  function toggleVoice() {
    if (vozDeLaApp) {
      voiceActive = !voiceActive;
      if (voiceActive) vozDeLaApp.empezar(idiomaDeVoz(), JSON.stringify(window.OrdenesVoz.FRASES_DE_AYUDA));
      else vozDeLaApp.detener();
      setVoiceUI(voiceActive);
      return;
    }
    if (!recognition) initVoice();
    if (!recognition) {
      alert('Este navegador no puede escuchar órdenes por voz. Probá con Chrome o con la app Conexiones Control.');
      return;
    }
    if (voiceActive) {
      voiceActive = false;
      recognition.stop();
      setVoiceUI(false);
    } else {
      voiceActive = true;
      recognition.start();
      setVoiceUI(true);
    }
  }

  // El botón "Pantalla" puede referirse a dos pantallas distintas (el celular
  // con el control, o la PC/proyector con pantalla.html) — antes hacía las
  // dos cosas a la vez sin preguntar, así que ahora se elige primero cuál.
  const fsOverlay = document.getElementById('fsOverlay');
  const fsPhoneBtn = document.getElementById('fsPhoneBtn');
  const fsPcBtn = document.getElementById('fsPcBtn');

  function openFullscreenPicker() {
    fsOverlay.hidden = false;
    requestAnimationFrame(() => fsOverlay.classList.add('show'));
  }

  function closeFullscreenPicker() {
    fsOverlay.classList.remove('show');
    setTimeout(() => { fsOverlay.hidden = true; }, 200);
  }

  function requestFullscreenLocal() {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
    else if (el.msRequestFullscreen) el.msRequestFullscreen();
  }

  fsPhoneBtn.addEventListener('click', () => {
    closeFullscreenPicker();
    requestFullscreenLocal();
  });

  fsPcBtn.addEventListener('click', () => {
    closeFullscreenPicker();
    socket.emit('cine'); // pantalla.html se pone fullscreen sola si hace falta
  });

  fsOverlay.addEventListener('click', (event) => {
    if (event.target === fsOverlay) closeFullscreenPicker();
  });

  // ---- Escribir en vivo ----
  // Las keys tienen que coincidir 1:1 con FRASE_FONTS/FRASE_EFFECTS de
  // el servidor (que valida contra esa misma lista) y con pantalla.html (que
  // las usa para mostrar el texto de verdad, con la misma fuente/efecto).
  // "Máquina de escribir" y "Ola" quedan afuera: tipean letra por letra, y acá
  // ya estás tipeando en vivo — sería una animación encima de otra.
  const LW_FONTS = [
    { key: 'sans', label: 'Moderna', family: "'Poppins', sans-serif" },
    { key: 'serif', label: 'Elegante', family: "'Playfair Display', serif" },
    { key: 'script', label: 'Manuscrita', family: "'Dancing Script', cursive" },
    { key: 'display', label: 'Impacto', family: "'Bebas Neue', sans-serif" },
    { key: 'casual', label: 'Divertida', family: "'Pacifico', cursive" },
    { key: 'geometric', label: 'Geométrica', family: "'Montserrat', sans-serif" },
    { key: 'bold-script', label: 'Retro', family: "'Lobster', cursive" },
    { key: 'poster', label: 'Póster', family: "'Oswald', sans-serif" },
    { key: 'calligraphy', label: 'Caligrafía', family: "'Great Vibes', cursive" },
    { key: 'huge', label: 'Gigante', family: "'Anton', sans-serif" },
    { key: 'handwritten', label: 'A mano', family: "'Caveat', cursive" },
    { key: 'marker', label: 'Marcador', family: "'Permanent Marker', cursive" },
    { key: 'comic', label: 'Cómic', family: "'Bangers', cursive" },
    { key: 'thin-hand', label: 'Fina a mano', family: "'Amatic SC', cursive" },
    { key: 'rounded', label: 'Redondeada', family: "'Fredoka', sans-serif" },
    { key: 'elegant-script', label: 'Fina elegante', family: "'Satisfy', cursive" },
    { key: 'strong', label: 'Fuerte', family: "'Righteous', sans-serif" },
    { key: 'notebook', label: 'Cuaderno', family: "'Kalam', cursive" },
    { key: 'royal', label: 'Imperial', family: "'Cinzel Decorative', serif" },
    { key: 'shadow-3d', label: 'Sombra 3D', family: "'Bungee Shade', sans-serif" },
    { key: 'neon-tube', label: 'Tubo neón', family: "'Monoton', sans-serif" },
    { key: 'graffiti', label: 'Grafiti', family: "'Luckiest Guy', cursive" },
    { key: 'curvy-bold', label: 'Curva fuerte', family: "'Shrikhand', cursive" },
    { key: 'bubble', label: 'Burbuja', family: "'Chewy', cursive" },
    { key: 'comic-3d', label: 'Cómic 3D', family: "'Titan One', sans-serif" },
    { key: 'urban', label: 'Urbana', family: "'Faster One', sans-serif" },
    { key: 'outline', label: 'Contorno', family: "'Bungee Inline', sans-serif" }
  ];
  const LW_EFFECTS = [
    { key: 'fade', label: '✨ Fundido' },
    { key: 'slide-up', label: '⬆️ Deslizar arriba' },
    { key: 'slide-down', label: '⬇️ Deslizar abajo' },
    { key: 'zoom', label: '🔍 Zoom' },
    { key: 'bounce', label: '🏀 Rebote' },
    { key: 'rotate', label: '🔄 Girar' },
    { key: 'glow', label: '💡 Destello' },
    { key: 'pulse', label: '💓 Latido' },
    { key: 'float', label: '🎈 Flotar' },
    { key: 'sway', label: '🌴 Balanceo' },
    { key: 'shimmer', label: '🌟 Brillo' },
    { key: 'rainbow', label: '🌈 Arcoíris' },
    { key: 'shake', label: '📳 Vibración' },
    { key: 'flicker', label: '🕯️ Parpadeo' },
    { key: 'spin', label: '🌀 Giro continuo' },
    { key: 'bounce-loop', label: '⚡ Rebote continuo' },
    { key: 'wiggle', label: '🐍 Vaivén' },
    { key: 'jelly', label: '🍮 Gelatina' },
    { key: 'heartbeat', label: '❤️ Corazón' },
    { key: 'rock', label: '🕰️ Tambaleo' },
    { key: 'stretch', label: '🫧 Elástico' },
    { key: 'neon', label: '💡 Neón' },
    { key: 'confetti', label: '🎉 Confeti' },
    { key: 'stars', label: '⭐ Lluvia de estrellas' },
    { key: 'hearts', label: '💖 Corazones de colores' }
  ];
  // Mismas 6 combinaciones que "Frase final", para que el menú de color se
  // vea igual en las 2 funciones.
  const COLOR_COMBOS = [
    ['#fbbf24', '#ef4444'],
    ['#38bdf8', '#6366f1'],
    ['#fb923c', '#ec4899'],
    ['#22c55e', '#eab308'],
    ['#8b5cf6', '#ec4899'],
    ['#2dd4bf', '#38bdf8']
  ];
  const LW_STEPS = ['letra', 'tamano', 'animacion', 'color', 'escribir'];
  const LW_STEP_HINTS = {
    letra: 'Paso 1 de 5 · Elegí el tipo de letra.',
    tamano: 'Paso 2 de 5 · Elegí el tamaño de letra.',
    animacion: 'Paso 3 de 5 · Elegí la animación.',
    color: 'Paso 4 de 5 · Elegí el color.',
    escribir: 'Paso 5 de 5 · Escribí — aparece en tu pantalla al toque. Letra, animación y color los podés seguir cambiando, el tamaño ya quedó fijo.'
  };

  const liveWriteBtn = document.getElementById('liveWriteBtn');
  const lwOverlay = document.getElementById('lwOverlay');
  const lwStepHint = document.getElementById('lwStepHint');
  const lwPanels = document.querySelectorAll('#lwOverlay .fp-tab-panel');
  const lwFontGrid = document.getElementById('lwFontGrid');
  const lwEffectGrid = document.getElementById('lwEffectGrid');
  const lwFontSize = document.getElementById('lwFontSize');
  const lwFontSizeValue = document.getElementById('lwFontSizeValue');
  const lwColor = document.getElementById('lwColor');
  const lwColor1 = document.getElementById('lwColor1');
  const lwColor2 = document.getElementById('lwColor2');
  const lwComboGrid = document.getElementById('lwComboGrid');
  const lwColorModeTabs = document.getElementById('lwColorModeTabs');
  const lwText = document.getElementById('lwText');
  const lwBack = document.getElementById('lwBack');
  const lwNext = document.getElementById('lwNext');
  const lwFinish = document.getElementById('lwFinish');
  const lwLiveAdjustTabs = document.getElementById('lwLiveAdjustTabs');

  let lwStepIndex = 0;
  let lwState = { font: null, fontSize: 1, effect: null, color: '#ffffff', color2: '', text: '' };
  // Las 4 son obligatorias: no alcanza con que tamaño/color ya tengan un
  // valor por default, hay que tocarlos sí o sí para poder avanzar — igual
  // que letra y efecto, que ya obligan por no tener nada seleccionado al abrir.
  let lwSizeChosen = false;
  let lwColorChosen = false;
  let lwActive = false; // true mientras algo se está mostrando de verdad en la pantalla
  let lwLiveAdjustTab = 'letra'; // cuál de los 3 (letra/animación/color) se ve en el último paso

  // Igual que en "Frase final": cada botón de efecto trae su propia mini
  // pantalla negra que repite la animación en loop con un texto fijo ("Hola")
  // — así se ve de qué se trata cada uno sin tener que elegirlo primero.
  // Mismos 3 keys que PARTICLE_RAIN_EFFECTS de pantalla.html — el emoji de
  // cada uno es el mismo que ya se usa en su label del menú de efectos.
  const PARTICLE_RAIN_ICONS = { confetti: '🎉', stars: '⭐', hearts: '💖' };
  function buildMiniRainHtml(key) {
    const icon = PARTICLE_RAIN_ICONS[key];
    if (!icon) return '';
    const posiciones = [8, 28, 50, 72, 90];
    return '<span class="fp-mini-rain">' + posiciones.map((left, i) =>
      '<span style="left:' + left + '%; animation-delay:' + (i * 0.3) + 's;">' + icon + '</span>'
    ).join('') + '</span>';
  }

  function lwBuildGrid(container, items, selectedKey, onPick) {
    container.innerHTML = '';
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.classList.add('fp-option-btn');
      btn.dataset.key = item.key;
      if (item.key === selectedKey) btn.classList.add('selected');
      if (item.family) {
        btn.textContent = item.label;
        btn.style.fontFamily = item.family;
      } else {
        // "confetti"/"stars"/"hearts" son una lluvia de partículas de verdad
        // (ver particleRain en pantalla.html), no una animación de texto — acá
        // se les agrega un puñado de emoji cayendo para que se note.
        btn.classList.add('fp-effect-btn');
        btn.innerHTML = '<span class="fp-mini-stage">' + buildMiniRainHtml(item.key) +
          '<span class="fp-anim-target"></span></span>' +
          '<span class="fp-mini-label">' + item.label + '</span>';
      }
      btn.addEventListener('click', () => onPick(item.key));
      container.appendChild(btn);
    });
    if (items === LW_EFFECTS) lwStartEffectMiniLoop();
  }

  let lwEffectMiniTimer = null;
  function lwPlayEffectMinis() {
    document.querySelectorAll('#lwEffectGrid .fp-effect-btn').forEach((btn) => {
      const stage = btn.querySelector('.fp-mini-stage');
      const target = btn.querySelector('.fp-anim-target');
      target.textContent = 'Hola';
      stage.style.setProperty('--fp-duration', '900ms');
      stage.className = 'fp-mini-stage';
      void stage.offsetWidth; // fuerza reflow para poder repetir la animación
      stage.classList.add('fp-' + btn.dataset.key);
    });
  }
  function lwStartEffectMiniLoop() {
    lwPlayEffectMinis();
    if (lwEffectMiniTimer) clearInterval(lwEffectMiniTimer);
    lwEffectMiniTimer = setInterval(lwPlayEffectMinis, 2200);
  }
  function lwStopEffectMiniLoop() {
    if (lwEffectMiniTimer) { clearInterval(lwEffectMiniTimer); lwEffectMiniTimer = null; }
  }

  // ---- Combinar 2 colores (mismo mecanismo que "Frase final") ----
  function lwBuildComboGrid() {
    lwComboGrid.innerHTML = '';
    COLOR_COMBOS.forEach(([c1, c2]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch';
      btn.style.background = 'linear-gradient(90deg, ' + c1 + ', ' + c2 + ')';
      if (lwState.color === c1 && lwState.color2 === c2) btn.classList.add('selected');
      btn.addEventListener('click', () => lwSelectCombo(c1, c2));
      lwComboGrid.appendChild(btn);
    });
  }

  function lwMarkSelectedCombo() {
    lwComboGrid.querySelectorAll('.color-swatch').forEach((btn, i) => {
      const [c1, c2] = COLOR_COMBOS[i];
      btn.classList.toggle('selected', lwState.color === c1 && lwState.color2 === c2);
    });
  }

  function lwSelectCombo(c1, c2) {
    lwState.color = c1;
    lwState.color2 = c2;
    lwColorChosen = true;
    lwColor1.value = c1;
    lwColor2.value = c2;
    lwMarkSelectedCombo();
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  }

  function lwSelectColorMode(mode) {
    lwColorModeTabs.querySelectorAll('.fp-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.colorMode === mode);
    });
    document.querySelectorAll('#lwOverlay [data-color-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.colorPanel !== mode;
    });
    if (mode === 'solido') {
      lwState.color2 = '';
    } else if (!lwState.color2) {
      lwState.color = lwColor1.value;
      lwState.color2 = lwColor2.value;
      lwMarkSelectedCombo();
    }
    lwColorChosen = true;
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  }
  lwColorModeTabs.querySelectorAll('.fp-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => lwSelectColorMode(btn.dataset.colorMode));
  });

  lwColor1.addEventListener('input', () => {
    lwState.color = lwColor1.value;
    lwColorChosen = true;
    lwMarkSelectedCombo();
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  });
  lwColor2.addEventListener('input', () => {
    lwState.color2 = lwColor2.value;
    lwColorChosen = true;
    lwMarkSelectedCombo();
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  });

  function lwCanAdvance() {
    const step = LW_STEPS[lwStepIndex];
    if (step === 'letra') return !!lwState.font;
    if (step === 'tamano') return lwSizeChosen;
    if (step === 'animacion') return !!lwState.effect;
    if (step === 'color') return lwColorChosen;
    return true;
  }

  // En el último paso (escribir), letra/animación/color no se apilan los 3
  // juntos — hay un menú de 3 botones y sólo se ve el que está elegido, igual
  // que cualquier otro paso del asistente.
  function lwApplyPanels() {
    const step = LW_STEPS[lwStepIndex];
    const isLast = step === 'escribir';
    lwPanels.forEach((panel) => {
      const key = panel.dataset.step;
      if (isLast && (key === 'letra' || key === 'animacion' || key === 'color')) {
        panel.hidden = key !== lwLiveAdjustTab;
      } else {
        panel.hidden = key !== step;
      }
    });
    const efectoVisible = step === 'animacion' || (isLast && lwLiveAdjustTab === 'animacion');
    if (efectoVisible) lwStartEffectMiniLoop(); else lwStopEffectMiniLoop();
  }

  function lwShowLiveAdjustTab(tab) {
    lwLiveAdjustTab = tab;
    document.querySelectorAll('#lwLiveAdjustTabs .fp-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.adjust === tab);
    });
    lwApplyPanels();
  }
  document.querySelectorAll('#lwLiveAdjustTabs .fp-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => lwShowLiveAdjustTab(btn.dataset.adjust));
  });

  function lwShowStep(i) {
    lwStepIndex = i;
    const step = LW_STEPS[i];
    const isLast = i === LW_STEPS.length - 1;
    lwApplyPanels();
    lwLiveAdjustTabs.hidden = !isLast;
    lwStepHint.textContent = LW_STEP_HINTS[step];
    lwBack.hidden = i === 0;
    lwNext.hidden = isLast;
    lwFinish.hidden = !isLast;
    lwNext.disabled = !lwCanAdvance();
  }

  function lwSelectFont(key) {
    lwState.font = key;
    lwBuildGrid(lwFontGrid, LW_FONTS, key, lwSelectFont);
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  }
  function lwSelectEffect(key) {
    lwState.effect = key;
    lwBuildGrid(lwEffectGrid, LW_EFFECTS, key, lwSelectEffect);
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  }

  lwFontSize.addEventListener('input', () => {
    lwState.fontSize = parseFloat(lwFontSize.value);
    lwFontSizeValue.textContent = Math.round(lwState.fontSize * 100) + '%';
    lwSizeChosen = true;
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  });
  lwColor.addEventListener('input', () => {
    lwState.color = lwColor.value;
    lwColorChosen = true;
    lwNext.disabled = !lwCanAdvance();
    lwBroadcastIfActive();
  });
  lwText.addEventListener('input', () => {
    lwState.text = lwText.value;
    lwBroadcast();
  });

  // Manda el estado completo a TU pantalla (sala 'owner:', ver identificarSocket
  // más arriba) — nunca a la de otra persona. "active" se calcula del texto:
  // en cuanto hay algo escrito se prende sola, y al borrarlo todo se apaga sola.
  function lwBroadcast() {
    const hasText = lwState.text.trim().length > 0;
    lwActive = hasText;
    updateNavButtonsState();
    socket.emit('escribirVivoEstado', {
      active: hasText,
      text: lwState.text,
      font: lwState.font,
      fontSize: lwState.fontSize,
      effect: lwState.effect,
      color: lwState.color,
      color2: lwState.color2
    });
  }
  // Reemite sólo si ya hay algo en pantalla — así, si volvés a "Animación" o
  // "Color" a cambiar algo mientras estás escribiendo, se actualiza en el
  // momento sin tener que retocar el texto.
  function lwBroadcastIfActive() {
    if (lwActive) lwBroadcast();
  }
  function lwStop() {
    if (!lwActive) return;
    lwActive = false;
    updateNavButtonsState();
    socket.emit('escribirVivoEstado', { active: false, text: '', font: lwState.font, fontSize: lwState.fontSize, effect: lwState.effect, color: lwState.color, color2: lwState.color2 });
  }

  function openLiveWrite() {
    lwState = { font: null, fontSize: 1, effect: null, color: '#ffffff', color2: '', text: '' };
    lwSizeChosen = false;
    lwColorChosen = false;
    lwText.value = '';
    lwFontSize.value = 1;
    lwFontSizeValue.textContent = '100%';
    lwColor.value = '#ffffff';
    lwColor1.value = '#38bdf8';
    lwColor2.value = '#a855f7';
    lwColorModeTabs.querySelectorAll('.fp-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.colorMode === 'solido');
    });
    document.querySelectorAll('#lwOverlay [data-color-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.colorPanel !== 'solido';
    });
    lwLiveAdjustTab = 'letra';
    document.querySelectorAll('#lwLiveAdjustTabs .fp-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.adjust === 'letra');
    });
    lwBuildGrid(lwFontGrid, LW_FONTS, null, lwSelectFont);
    lwBuildGrid(lwEffectGrid, LW_EFFECTS, null, lwSelectEffect);
    lwBuildComboGrid();
    lwShowStep(0);
    lwOverlay.hidden = false;
    requestAnimationFrame(() => lwOverlay.classList.add('show'));
  }
  function closeLiveWrite() {
    lwStop();
    lwStopEffectMiniLoop();
    lwOverlay.classList.remove('show');
    setTimeout(() => { lwOverlay.hidden = true; }, 200);
  }

  liveWriteBtn.addEventListener('click', openLiveWrite);
  lwNext.addEventListener('click', () => { if (lwCanAdvance()) lwShowStep(lwStepIndex + 1); });
  lwBack.addEventListener('click', () => lwShowStep(lwStepIndex - 1));
  lwFinish.addEventListener('click', closeLiveWrite);
  document.getElementById('lwCancel').addEventListener('click', closeLiveWrite);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lwOverlay.hidden) closeLiveWrite(); });
