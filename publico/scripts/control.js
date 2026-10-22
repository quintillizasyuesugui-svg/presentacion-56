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

  // Versión nueva de Conexiones (el servidor se reinició al publicarla): el control se recarga
  // solo, así siempre tiene los mismos botones y órdenes que la pantalla.
  let versionVista = '';
  socket.on('versionServidor', (version) => {
    if (typeof version !== 'string' || !version) return;
    if (!versionVista) { versionVista = version; return; }
    if (version !== versionVista) location.reload();
  });

  function enviar(accion) {
    // Sin una pantalla abierta no hay dónde mostrar: se avisa en vez de hacer como que anda.
    if (!hayPantalla) {
      showToast(esperandoPantalla ? '📺 Abrí la pantalla en la PC: sigue sola.' : SIN_PANTALLA);
      return;
    }
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
  // ¿Hay una pantalla abierta con este mismo PIN? Lo avisa el servidor («hayPantalla»).
  // Hasta que conteste no se sabe, y el cuadrito se ve como siempre.
  let hayPantalla = false;
  let pantallaSabida = false;
  // La pantalla se cerró en medio de la presentación: al abrirla sigue sola donde iba.
  let esperandoPantalla = false;
  const SIN_PANTALLA = '📺 Primero abrí la pantalla en la PC.';

  // Cuadrito «Mostrar»: gris «Sin pantalla» mientras no haya dónde mostrar; celeste que late
  // hasta que se toca; después verde con «3/10» y una barrita.
  function pintarMostrar() {
    const encendido = showStarted;
    const esperando = esperandoPantalla && !encendido;
    const sinPantalla = pantallaSabida && !encendido && (!hayPantalla || esperando);
    mostrarBtn.classList.toggle('sin-pantalla', sinPantalla);
    mostrarBtn.classList.toggle('listo', !encendido && !sinPantalla);
    mostrarBtn.classList.toggle('mostrando', encendido);
    document.getElementById('mostrarSin').hidden = !sinPantalla;
    document.getElementById('mostrarPlay').hidden = encendido || sinPantalla;
    const franja = document.getElementById('estadoPantalla');
    // Con «Primeros pasos» a la vista no hace falta: el paso 2 ya dice lo mismo y no sobra lugar.
    franja.hidden = !pantallaSabida || encendido || !document.getElementById('primerosPasos').hidden;
    franja.classList.toggle('lista', hayPantalla && !esperando);
    document.getElementById('estadoPantallaTitulo').textContent = esperando ? 'Esperando la pantalla.' : hayPantalla ? 'Pantalla lista.' : 'Falta la pantalla.';
    document.getElementById('estadoPantallaTexto').textContent = esperando ? (hayPantalla ? 'Ya sigue sola.' : 'Abrila: sigue sola.') : hayPantalla ? 'Tocá «Mostrar».' : 'Abrila en la PC.';
    document.getElementById('mostrarNumero').hidden = !encendido;
    document.getElementById('mostrarAvance').hidden = !encendido;
    document.getElementById('mostrarNombre').textContent = encendido ? 'En pantalla' : esperando ? 'Esperando' : sinPantalla ? 'Sin pantalla' : 'Mostrar';
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
    esperandoPantalla = false;
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
    pintarMostrar();
  }
  document.getElementById('pasosCerrar').addEventListener('click', ocultarPasos);
  function pintarPasos() {
    if (pasosOcultos || !imagenesCargadas) return;
    const hechos = [totalSlides > 0, pantallaVista, showStarted];
    hechos.forEach((hecho, i) => document.getElementById('paso' + (i + 1)).classList.toggle('hecho', hecho));
    primerosPasos.hidden = false;
    pintarMostrar();
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
  const ZOOM_PAUSA = 33; // unos 30 avisos por segundo mientras se mueve la foto
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

  // La pantalla ya no muestra nada (se cerró o se desconectó): vuelve el cartel de antes.
  function zoomApagar() {
    zoomSrc = '';
    zoomFoto.hidden = true;
    zoomFoto.removeAttribute('src');
    zoomVisor.hidden = true;
    zoomTag.hidden = true;
    document.getElementById('zoomApagado').hidden = false;
    document.getElementById('zoomAyuda').hidden = true;
  }

  // Copia del zoom que llega. Con «✂ Zona» trae también el ancho y el alto del cuadro dibujado
  // (w, h: de 0 a 1): la pantalla muestra sólo esa parte, con la forma que se dibujó.
  function copiarZoom(z) {
    const copia = { z: z.z, cx: z.cx, cy: z.cy };
    if (Number.isFinite(z.w) && Number.isFinite(z.h)) { copia.w = z.w; copia.h = z.h; }
    return copia;
  }

  function acotarZoom() {
    zoom.z = Math.min(4, Math.max(1, zoom.z));
    if (Number.isFinite(zoom.w)) {
      // El cuadro dibujado no se sale de la página.
      zoom.cx = Math.min(1 - zoom.w / 2, Math.max(zoom.w / 2, zoom.cx));
      zoom.cy = Math.min(1 - zoom.h / 2, Math.max(zoom.h / 2, zoom.cy));
      return;
    }
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
    if (alFinal || ahora - zoomUltimoEnvio >= ZOOM_PAUSA) {
      zoomUltimoEnvio = ahora;
      socket.emit('zoom', copiarZoom(zoom));
    } else {
      zoomPendiente = setTimeout(() => mandarZoom(true), ZOOM_PAUSA - (ahora - zoomUltimoEnvio));
    }
  }

  // ¿Hay algo en pantalla que se pueda agrandar? Una foto, o una página web con «✂ Zona».
  function puedeZoom() {
    return showStarted && (espejoWeb.hidden ? !zoomFoto.hidden : !zonaBtn.hidden);
  }

  function cambiarZoom(nuevo, alFinal) {
    if (!puedeZoom()) return;
    // Pellizcar o pedir zoom con la voz deja de mostrar sólo el cuadro dibujado.
    delete zoom.w;
    delete zoom.h;
    Object.assign(zoom, nuevo);
    acotarZoom();
    pintarZoom();
    if (!espejoWeb.hidden) zonaPintar();
    mandarZoom(alFinal);
  }

  // Otro celular de la misma persona hizo zoom: se ve acá también.
  socket.on('zoom', (z) => {
    if (!z) return;
    zoom = copiarZoom(z);
    pintarZoom();
    if (!espejoWeb.hidden) zonaPintar();
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

  // ---- Espejo: la página web de la pantalla, en chico ----
  // Cuando la diapositiva es una página web, en lugar de la foto para el zoom se muestra la misma
  // página. Se dibuja con el tamaño de la pantalla y se achica entera, así queda con la misma
  // forma. Si la página lleva el «puente» (publico/puente.js) avisa qué se tocó y a qué página
  // se pasó, y eso se manda a la pantalla. Este celular manda; la pantalla lo sigue.
  const espejoWeb = document.getElementById('espejoWeb');
  const espejoCaja = document.getElementById('espejoCaja');
  const espejoLienzo = document.getElementById('espejoLienzo');
  const espejoMarco = document.getElementById('espejoMarco');
  const espejoAyuda = document.getElementById('espejoAyuda');
  const zoomControl = document.querySelector('.zoom-control');
  const ESPEJO_ANCHO = 1280;
  const AYUDA_ESPEJO = 'Tocá lo que quieras: pasa lo mismo en la pantalla.';
  let espejoBase = '';       // la dirección que se agregó en Gestionar
  let espejoUrl = '';        // en cuál de sus páginas va este espejo
  let espejoPaso = 0;        // cuántas veces la pantalla pasó sola de parte (lo cuenta ella)
  let espejoAlto = 720;
  let lupaZ = 1;             // cuánto agranda la lupa este celular (1 = normal)
  let espejoPreparada = false;
  let espejoEspera = null;

  function origenDe(direccion) {
    try { return new URL(direccion).origin; } catch { return ''; }
  }

  // Página traída por Conexiones (la que no se deja mostrar adentro): si la pantalla la muestra
  // traída, el espejo también la pide así (ver servidor/traer-pagina.js). No tiene origen propio:
  // los avisos llegan con origen «null» y las órdenes van a «*» (sólo a este recuadro).
  let espejoTraer = '';
  let espejoTraerDe = '';
  const marcoDe = (direccion) => (espejoTraer ? espejoTraer + encodeURIComponent(direccion) : direccion);
  const destinoEspejo = () => (espejoTraer ? '*' : origenDe(espejoBase));

  async function espejoPedirTraida(estado) {
    if (!estado.paginaTraida || espejoTraer || espejoTraerDe === estado.pagina) return;
    espejoTraerDe = estado.pagina;
    let firma = '';
    try {
      const res = await authFetch('/api/traer/firma?u=' + encodeURIComponent(estado.pagina));
      if (res.ok) firma = (await res.json()).firma || '';
    } catch { /* sin conexión */ }
    if (!firma || espejoBase !== estado.pagina || enVivo) return;
    espejoTraer = location.origin + '/traer?f=' + encodeURIComponent(firma) + '&u=';
    espejoPreparada = false;
    espejoMarco.src = marcoDe(espejoUrl || espejoBase);
  }

  function espejoAjustar() {
    if (espejoWeb.hidden) return;
    const escala = espejoCaja.clientWidth * lupaZ / ESPEJO_ANCHO;
    espejoCaja.style.aspectRatio = ESPEJO_ANCHO + ' / ' + espejoAlto;
    espejoLienzo.style.width = (ESPEJO_ANCHO * escala) + 'px';
    espejoLienzo.style.height = (espejoAlto * escala) + 'px';
    espejoMarco.style.width = ESPEJO_ANCHO + 'px';
    espejoMarco.style.height = espejoAlto + 'px';
    espejoMarco.style.transform = 'scale(' + escala + ')';
  }

  // ---- Enlace de YouTube ----
  // YouTube no se deja mostrar adentro: en lugar del espejo, una tarjeta para buscar el video (o
  // poner el del enlace). El video lo maneja el control grande de reproductor-celular.js.
  const tarjetaYoutube = document.getElementById('tarjetaYoutube');
  const tarjetaYoutubeFoto = document.getElementById('tarjetaYoutubeFoto');
  const tarjetaYoutubePoner = document.getElementById('tarjetaYoutubePoner');
  let tarjetaYoutubeVideo = '';
  tarjetaYoutubePoner.addEventListener('click', () => {
    if (tarjetaYoutubeVideo && window.youtubeCelular) window.youtubeCelular.ponerYoutube(tarjetaYoutubeVideo);
  });
  document.getElementById('tarjetaYoutubeBuscar').addEventListener('click', () => {
    if (window.youtubeCelular) window.youtubeCelular.abrirBuscador();
  });
  function youtubeMostrar(estado) {
    espejoOcultar();
    zoomControl.hidden = true;
    tarjetaYoutube.hidden = false;
    const id = estado.paginaVideo || '';
    if (id === tarjetaYoutubeVideo) return;
    tarjetaYoutubeVideo = id;
    tarjetaYoutubeFoto.hidden = !id;
    if (id) tarjetaYoutubeFoto.src = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
    else tarjetaYoutubeFoto.removeAttribute('src');
    tarjetaYoutubePoner.hidden = !id;
    document.getElementById('tarjetaYoutubeBuscar').textContent = id ? '🔍 Buscar' : '🔍 Buscar un video';
  }
  function youtubeOcultar() {
    if (tarjetaYoutube.hidden) return;
    tarjetaYoutube.hidden = true;
    tarjetaYoutubeVideo = '';
    zoomControl.hidden = !espejoWeb.hidden;
  }

  function espejoMostrar(estado) {
    if (estado.paginaModo === 'youtube') { youtubeMostrar(estado); return; }
    youtubeOcultar();
    if (!origenDe(estado.pagina) || origenDe(estado.pagina) === location.origin) return;
    const forma = estado.ancho > 0 && estado.alto > 0 ? estado.alto / estado.ancho : 9 / 16;
    espejoAlto = Math.round(ESPEJO_ANCHO * Math.min(1, Math.max(0.4, forma)));
    zoomControl.hidden = true;
    espejoWeb.hidden = false;
    if (estado.paginaModo === 'vivo') { vivoMostrar(estado); return; }
    vivoOcultar();
    if (estado.pagina !== espejoBase) {
      espejoBase = estado.pagina;
      espejoUrl = estado.paginaActual || estado.pagina;
      lupaReiniciar();
      espejoPreparada = false;
      espejoAyuda.textContent = AYUDA_ESPEJO;
      espejoPintarMenu(null);
      document.getElementById('espejoTitulo').textContent = '🌐 Página web';
      espejoTraer = '';
      espejoTraerDe = '';
      espejoMarco.src = espejoUrl;
      clearTimeout(espejoEspera);
      espejoEspera = setTimeout(() => {
        if (!espejoPreparada) espejoAyuda.textContent = 'Esta página no está preparada para Conexiones: se ve, pero lo que toques acá no pasa en la pantalla.';
      }, 8000);
      espejoPaso = estado.paginaPaso || 0;
    } else if (Number.isInteger(estado.paginaPaso) && estado.paginaPaso !== espejoPaso) {
      // La pantalla pasó sola a otra parte del menú («Siguiente» o el temporizador): el espejo la sigue.
      espejoPaso = estado.paginaPaso;
      if (estado.paginaActual && origenDe(estado.paginaActual) === origenDe(espejoBase) && estado.paginaActual !== espejoUrl) {
        espejoUrl = estado.paginaActual;
        espejoMarco.src = marcoDe(espejoUrl);
      }
    }
    espejoPedirTraida(estado);
    espejoAjustar();
  }

  // ---- Foto en vivo: la página la abrió la app de PC ----
  // En lugar de la misma página en chico se muestra una foto de la pantalla, que llega sola cada
  // vez que algo cambia. Un toque sobre la foto es un clic en ese punto; deslizar sube o baja.
  const vivoCaja = document.getElementById('vivoCaja');
  const vivoFoto = document.getElementById('vivoFoto');
  const vivoEspera = document.getElementById('vivoEspera');
  const vivoBotones = document.getElementById('vivoBotones');
  const vivoEscribir = document.getElementById('vivoEscribir');
  const vivoTexto = document.getElementById('vivoTexto');
  const vivoTeclado = document.getElementById('vivoTeclado');
  const AYUDA_VIVO = 'Tocá donde quieras hacer clic. Deslizá para subir o bajar.';
  const AYUDA_SIN_MENU = 'No detecté cajas de menú en esta página. Tocá la foto para manejarla; deslizá para subir o bajar.';
  let enVivo = false;

  // El renglón de ayuda sólo ocupa lugar cuando avisa algo (dibujar la zona, mover el cuadro, una
  // página que no se puede manejar). La frase de siempre se esconde: así el control entra entero
  // en un celular chico sin tener que bajar.
  const esconderAyudaComun = () => { espejoAyuda.hidden = espejoAyuda.textContent === AYUDA_ESPEJO || espejoAyuda.textContent === AYUDA_VIVO; };
  new MutationObserver(esconderAyudaComun).observe(espejoAyuda, { childList: true, characterData: true, subtree: true });
  esconderAyudaComun();

  // Cajas del menú que la app de PC le leyó a la página. Sin dato todavía (null) se deja lo que
  // había, para que las cajas no parpadeen cada vez que la página cambia.
  function vivoPintarMenu(menu) {
    if (!Array.isArray(menu)) return;
    const origen = menu.length ? origenDe(menu[0].url) : '';
    espejoPintarMenu(menu, origen, (url) => vivoMandar({ accion: 'ir', url }));
    espejoAyuda.textContent = menu.length ? AYUDA_VIVO : AYUDA_SIN_MENU;
  }

  function vivoMostrar(estado) {
    const nueva = !enVivo || estado.pagina !== espejoBase;
    if (nueva) {
      enVivo = true;
      espejoBase = estado.pagina;
      lupaReiniciar();
      espejoUrl = '';
      clearTimeout(espejoEspera);
      espejoMarco.removeAttribute('src');
      espejoPintarMenu(null);
      vivoFoto.hidden = true;
      vivoEspera.hidden = false;
      document.getElementById('espejoTitulo').textContent = '🌐 ' + (new URL(estado.pagina).hostname.replace(/^www\./, ''));
    }
    const forma = estado.ancho > 0 && estado.alto > 0 ? estado.ancho / estado.alto : 16 / 9;
    vivoCaja.style.aspectRatio = String(Math.min(2.5, Math.max(1, forma)));
    for (const [elemento, visto] of [[vivoCaja, true], [vivoBotones, true], [espejoCaja, false],
      [document.getElementById('espejoAnterior').parentElement, false]]) elemento.hidden = !visto;
    if (nueva) espejoAyuda.textContent = AYUDA_VIVO;
    vivoPintarMenu(estado.paginaMenu);
  }

  function vivoOcultar() {
    if (!enVivo) return;
    enVivo = false;
    for (const [elemento, visto] of [[vivoCaja, false], [vivoBotones, false], [vivoEscribir, false], [espejoCaja, true],
      [document.getElementById('espejoAnterior').parentElement, true]]) elemento.hidden = !visto;
    vivoTeclado.setAttribute('aria-expanded', 'false');
    vivoFoto.removeAttribute('src');
    espejoBase = '';
  }

  socket.on('webFoto', (foto) => {
    if (!enVivo || !foto || typeof foto.jpg !== 'string') return;
    vivoFoto.src = 'data:image/jpeg;base64,' + foto.jpg;
    // Avisa cuando ya la puede mostrar: recién ahí el servidor manda la siguiente (la más nueva).
    const recibida = () => socket.emit('webFotoRecibida');
    if (vivoFoto.decode) vivoFoto.decode().then(recibida, recibida); else recibida();
    vivoFoto.hidden = false;
    vivoEspera.hidden = true;
    if (foto.titulo) document.getElementById('espejoTitulo').textContent = '🌐 ' + foto.titulo.slice(0, 60);
  });

  function vivoMandar(orden) {
    if (enVivo) socket.emit('web', orden);
  }

  // Anillo en el punto tocado, para ver que el toque salió.
  function vivoMarcar(x, y) {
    const anillo = document.createElement('i');
    anillo.className = 'vivo-anillo';
    anillo.style.left = (x * 100) + '%';
    anillo.style.top = (y * 100) + '%';
    vivoLienzo.append(anillo);
    anillo.addEventListener('animationend', () => anillo.remove());
  }

  // ---- Lupa: agranda sólo lo que se ve en este celular, para atinarle a los botones chicos ----
  // «+» y «−» van de a un paso y «↩ Normal» vuelve. En foto en vivo también se agranda con dos
  // dedos (y con la rueda del ratón); ya agrandada, un dedo mueve la foto en lugar de bajar la
  // página. En el recuadro del espejo los dedos los toma la página de adentro: ahí sólo botones.
  const lupaMenos = document.getElementById('lupaMenos');
  const lupaMas = document.getElementById('lupaMas');
  const lupaNormal = document.getElementById('lupaNormal');
  const vivoLienzo = document.getElementById('vivoLienzo');
  const LUPA_PASOS = [1, 1.5, 2, 3, 4];
  const LUPA_MAXIMO = 4;
  let vivoTx = 0;
  let vivoTy = 0;

  function lupaBotones() {
    lupaMenos.disabled = lupaZ <= 1.01;
    lupaMas.disabled = lupaZ >= LUPA_MAXIMO - 0.01;
    lupaNormal.hidden = lupaZ <= 1.01;
  }

  function vivoPintarLupa() {
    const ancho = vivoCaja.clientWidth;
    const alto = vivoCaja.clientHeight;
    vivoTx = Math.min(0, Math.max(ancho - ancho * lupaZ, vivoTx));
    vivoTy = Math.min(0, Math.max(alto - alto * lupaZ, vivoTy));
    vivoLienzo.style.transform = lupaZ > 1.01 ? `translate(${vivoTx}px, ${vivoTy}px) scale(${lupaZ})` : '';
  }

  // Agranda dejando quieto el punto (x, y) de la caja que se está mirando (el centro, si no se dice).
  function lupaCambiar(nuevo, x, y) {
    nuevo = Math.min(LUPA_MAXIMO, Math.max(1, nuevo));
    if (enVivo) {
      if (x === undefined) { x = vivoCaja.clientWidth / 2; y = vivoCaja.clientHeight / 2; }
      vivoTx = x - (x - vivoTx) * nuevo / lupaZ;
      vivoTy = y - (y - vivoTy) * nuevo / lupaZ;
      lupaZ = nuevo;
      vivoPintarLupa();
    } else {
      const ancho = espejoCaja.clientWidth;
      const alto = espejoCaja.clientHeight;
      const cx = (espejoCaja.scrollLeft + ancho / 2) / (espejoLienzo.offsetWidth || ancho);
      const cy = (espejoCaja.scrollTop + alto / 2) / (espejoLienzo.offsetHeight || alto);
      lupaZ = nuevo;
      espejoAjustar();
      espejoCaja.scrollLeft = cx * espejoLienzo.offsetWidth - ancho / 2;
      espejoCaja.scrollTop = cy * espejoLienzo.offsetHeight - alto / 2;
    }
    lupaBotones();
  }

  function lupaReiniciar() {
    lupaZ = 1;
    vivoTx = 0;
    vivoTy = 0;
    vivoPintarLupa();
    espejoAjustar();
    lupaBotones();
  }

  lupaMas.addEventListener('click', () => lupaCambiar(LUPA_PASOS.find((p) => p > lupaZ + 0.01) ?? LUPA_MAXIMO));
  lupaMenos.addEventListener('click', () => lupaCambiar([...LUPA_PASOS].reverse().find((p) => p < lupaZ - 0.01) ?? 1));
  lupaNormal.addEventListener('click', lupaReiniciar);

  // Un dedo: toque = clic; deslizar = subir o bajar (o mover la foto si está agrandada).
  // Dos dedos: agrandar o achicar sin que se toque nada.
  const vivoDedos = new Map();
  let vivoDedo = null;
  let vivoPellizco = null;
  function vivoMedio() {
    const [a, b] = [...vivoDedos.values()];
    const caja = vivoCaja.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - caja.left, y: (a.y + b.y) / 2 - caja.top, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  }
  vivoCaja.addEventListener('pointerdown', (e) => {
    try { vivoCaja.setPointerCapture(e.pointerId); } catch { /* algunos navegadores no la dan */ }
    // El primer dedo de un gesto nuevo: si se perdió el aviso de soltar de uno anterior, se olvida.
    if (e.isPrimary) vivoDedos.clear();
    vivoDedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (vivoDedos.size === 1) {
      vivoDedo = { id: e.pointerId, x: e.clientX, y: e.clientY, ultimaY: e.clientY, movido: false, varios: false, tx: vivoTx, ty: vivoTy, ultimoEnvio: 0, pendiente: 0 };
    } else if (vivoDedos.size === 2 && vivoDedo) {
      vivoDedo.varios = true;
      vivoDedo.pendiente = 0;
      vivoPellizco = { ...vivoMedio(), z: lupaZ, tx: vivoTx, ty: vivoTy };
    }
  });
  vivoCaja.addEventListener('pointermove', (e) => {
    if (!vivoDedos.has(e.pointerId) || !vivoDedo) return;
    vivoDedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (vivoDedos.size >= 2) {
      if (!vivoPellizco) return;
      // El punto de la foto que estaba entre los dedos sigue entre los dedos.
      const ahora = vivoMedio();
      const nuevo = Math.min(LUPA_MAXIMO, Math.max(1, vivoPellizco.z * ahora.d / vivoPellizco.d));
      vivoTx = ahora.x - (vivoPellizco.x - vivoPellizco.tx) * nuevo / vivoPellizco.z;
      vivoTy = ahora.y - (vivoPellizco.y - vivoPellizco.ty) * nuevo / vivoPellizco.z;
      lupaZ = nuevo;
      vivoPintarLupa();
      lupaBotones();
      return;
    }
    if (e.pointerId !== vivoDedo.id || vivoDedo.varios) return;
    if (!vivoDedo.movido && Math.hypot(e.clientX - vivoDedo.x, e.clientY - vivoDedo.y) < 10) return;
    vivoDedo.movido = true;
    if (lupaZ > 1.01) {
      vivoTx = vivoDedo.tx + e.clientX - vivoDedo.x;
      vivoTy = vivoDedo.ty + e.clientY - vivoDedo.y;
      vivoPintarLupa();
      return;
    }
    // Deslizar hacia arriba baja la página, como en cualquier pantalla táctil.
    vivoDedo.pendiente += (vivoDedo.ultimaY - e.clientY) / vivoCaja.clientHeight;
    vivoDedo.ultimaY = e.clientY;
    const ahora = Date.now();
    if (ahora - vivoDedo.ultimoEnvio >= 90 && Math.abs(vivoDedo.pendiente) > 0.01) {
      vivoMandar({ accion: 'rueda', dy: vivoDedo.pendiente });
      vivoDedo.pendiente = 0;
      vivoDedo.ultimoEnvio = ahora;
    }
  });
  function vivoSoltar(e) {
    if (!vivoDedos.delete(e.pointerId)) return;
    if (vivoDedos.size < 2) vivoPellizco = null;
    if (vivoDedos.size > 0 || !vivoDedo) return;
    const dedo = vivoDedo;
    vivoDedo = null;
    if (e.type === 'pointercancel' || dedo.varios) return;
    if (dedo.movido) {
      if (Math.abs(dedo.pendiente) > 0.01) vivoMandar({ accion: 'rueda', dy: dedo.pendiente });
      return;
    }
    // Se mide sobre la foto (agrandada o no), así el clic cae en el botón que se ve bajo el dedo.
    const caja = vivoCaja.getBoundingClientRect();
    if (e.clientX < caja.left || e.clientX > caja.right || e.clientY < caja.top || e.clientY > caja.bottom) return;
    const foto = vivoLienzo.getBoundingClientRect();
    const x = (e.clientX - foto.left) / foto.width;
    const y = (e.clientY - foto.top) / foto.height;
    if (x < 0 || x > 1 || y < 0 || y > 1 || vivoFoto.hidden) return;
    vivoMarcar(x, y);
    vivoMandar({ accion: 'toque', x, y });
  }
  vivoCaja.addEventListener('pointerup', vivoSoltar);
  vivoCaja.addEventListener('pointercancel', vivoSoltar);
  vivoCaja.addEventListener('wheel', (e) => {
    e.preventDefault();
    const caja = vivoCaja.getBoundingClientRect();
    lupaCambiar(lupaZ * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - caja.left, e.clientY - caja.top);
  }, { passive: false });

  document.getElementById('vivoSubir').addEventListener('click', () => vivoMandar({ accion: 'rueda', dy: -0.6 }));
  document.getElementById('vivoBajar').addEventListener('click', () => vivoMandar({ accion: 'rueda', dy: 0.6 }));
  document.getElementById('vivoVolver').addEventListener('click', () => vivoMandar({ accion: 'volver' }));
  vivoTeclado.addEventListener('click', () => {
    vivoEscribir.hidden = !vivoEscribir.hidden;
    vivoTeclado.setAttribute('aria-expanded', String(!vivoEscribir.hidden));
    if (!vivoEscribir.hidden) vivoTexto.focus();
  });
  vivoEscribir.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = vivoTexto.value;
    if (!texto) return;
    vivoMandar({ accion: 'texto', texto });
    vivoTexto.value = '';
  });
  document.getElementById('vivoBorrar').addEventListener('click', () => vivoMandar({ accion: 'tecla', tecla: 'Backspace' }));
  document.getElementById('vivoEnter').addEventListener('click', () => vivoMandar({ accion: 'tecla', tecla: 'Enter' }));

  // ---- Zona: agrandar una parte de la página en la pantalla ----
  // Con «✂ Zona» se dibuja un cuadro sobre la página y la pantalla se llena con esa parte (viaja
  // con el mismo aviso «zoom» de las fotos). El cuadro se mueve arrastrando el círculo ✥, así el
  // resto de la página se sigue pudiendo tocar. El botón pasa a «↩ Entera» para volver.
  const zonaBtn = document.getElementById('zonaBtn');
  const zonaCapa = document.createElement('div');
  zonaCapa.className = 'zona-capa';
  zonaCapa.hidden = true;
  const zonaVisor = document.createElement('div');
  zonaVisor.className = 'zona-visor';
  zonaVisor.hidden = true;
  const zonaMango = document.createElement('span');
  zonaMango.className = 'zona-mango';
  zonaMango.textContent = '✥';
  zonaMango.setAttribute('aria-label', 'Mover el cuadro');
  zonaVisor.append(zonaMango);
  const AYUDA_ZONA = 'Dibujá un cuadro para agrandar.';
  const AYUDA_MOVER = 'Mové el cuadro con ✥.';
  let zonaMarcando = false;
  let zonaAyudaAntes = '';

  // En foto en vivo la página se ve en la foto; si no, en el recuadro del espejo.
  function zonaLugar() { return enVivo ? vivoLienzo : espejoLienzo; }

  function zonaPintar() {
    const lugar = zonaLugar();
    if (zonaVisor.parentElement !== lugar) lugar.append(zonaVisor, zonaCapa);
    const agrandada = zoom.z > 1.01;
    // El cuadro amarillo tiene la forma que se dibujó; sin cuadro dibujado, la de la pantalla.
    const ancho = Number.isFinite(zoom.w) ? zoom.w * 100 : 100 / zoom.z;
    const alto = Number.isFinite(zoom.h) ? zoom.h * 100 : 100 / zoom.z;
    zonaVisor.hidden = !agrandada;
    zonaVisor.style.width = ancho + '%';
    zonaVisor.style.height = alto + '%';
    zonaVisor.style.left = (zoom.cx * 100 - ancho / 2) + '%';
    zonaVisor.style.top = (zoom.cy * 100 - alto / 2) + '%';
    zonaCapa.hidden = !zonaMarcando;
    zonaBtn.textContent = agrandada ? '↩ Entera' : '✂ Zona';
    zonaBtn.setAttribute('aria-pressed', String(zonaMarcando));
    // El renglón de ayuda dice qué hacer ahora; al terminar vuelve a decir lo de antes.
    const propia = espejoAyuda.textContent === AYUDA_ZONA || espejoAyuda.textContent === AYUDA_MOVER;
    const ahora = zonaMarcando ? AYUDA_ZONA : agrandada ? AYUDA_MOVER : '';
    if (ahora && !propia) zonaAyudaAntes = espejoAyuda.textContent;
    if (ahora) espejoAyuda.textContent = ahora;
    else if (propia) espejoAyuda.textContent = zonaAyudaAntes;
  }

  function zonaMandar(nuevo, alFinal) {
    Object.assign(zoom, nuevo);
    acotarZoom();
    zonaPintar();
    mandarZoom(alFinal);
  }

  // Lo que dice la pantalla manda: si puede agrandar páginas y qué parte está mostrando.
  function zonaDesdeEstado(estado) {
    zonaBtn.hidden = estado.paginaZoom !== true;
    if (zonaBtn.hidden) zonaMarcando = false;
    const z = estado.zoom;
    zoom = z && Number.isFinite(z.z) && !zonaBtn.hidden ? copiarZoom(z) : { z: 1, cx: 0.5, cy: 0.5 };
    zonaPintar();
  }

  function zonaApagar() {
    zonaMarcando = false;
    zonaVisor.hidden = true;
    zonaCapa.hidden = true;
    zonaBtn.hidden = true;
  }

  zonaBtn.addEventListener('click', () => {
    if (zoom.z > 1.01) {
      zonaMarcando = false;
      delete zoom.w;
      delete zoom.h;
      zonaMandar({ z: 1, cx: 0.5, cy: 0.5 }, true);
    } else {
      zonaMarcando = !zonaMarcando;
      zonaPintar();
    }
  });

  function zonaPunto(e) {
    const r = zonaLugar().getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }

  // Dibujar el cuadro. Los toques no pasan a la página de abajo mientras se marca.
  let zonaInicio = null;
  let zonaMarco = null;
  zonaCapa.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    try { zonaCapa.setPointerCapture(e.pointerId); } catch { /* algunos navegadores no la dan */ }
    zonaInicio = zonaPunto(e);
    zonaMarco = document.createElement('div');
    zonaMarco.className = 'zona-marco';
    zonaCapa.append(zonaMarco);
  });
  zonaCapa.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (!zonaMarco) return;
    const p = zonaPunto(e);
    zonaMarco.style.left = Math.min(zonaInicio.x, p.x) * 100 + '%';
    zonaMarco.style.top = Math.min(zonaInicio.y, p.y) * 100 + '%';
    zonaMarco.style.width = Math.abs(p.x - zonaInicio.x) * 100 + '%';
    zonaMarco.style.height = Math.abs(p.y - zonaInicio.y) * 100 + '%';
  });
  function zonaSoltar(e) {
    e.stopPropagation();
    if (!zonaMarco) return;
    const p = zonaPunto(e);
    const ancho = Math.abs(p.x - zonaInicio.x);
    const alto = Math.abs(p.y - zonaInicio.y);
    zonaMarco.remove();
    zonaMarco = null;
    // Un cuadro muy chico es un toque sin querer: se sigue esperando el cuadro.
    if (e.type === 'pointercancel' || ancho < 0.06 || alto < 0.06) return;
    zonaMarcando = false;
    // Se agranda lo más posible sin deformar; lo de afuera del cuadro queda oscuro en la pantalla.
    zonaMandar({ z: 1 / Math.max(ancho, alto), cx: (p.x + zonaInicio.x) / 2, cy: (p.y + zonaInicio.y) / 2, w: ancho, h: alto }, true);
  }
  zonaCapa.addEventListener('pointerup', zonaSoltar);
  zonaCapa.addEventListener('pointercancel', zonaSoltar);

  // Mover el cuadro con el círculo.
  let zonaAgarre = null;
  zonaMango.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    try { zonaMango.setPointerCapture(e.pointerId); } catch { /* algunos navegadores no la dan */ }
    zonaAgarre = { x: e.clientX, y: e.clientY, cx: zoom.cx, cy: zoom.cy };
  });
  zonaMango.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (!zonaAgarre) return;
    const r = zonaLugar().getBoundingClientRect();
    zonaMandar({ cx: zonaAgarre.cx + (e.clientX - zonaAgarre.x) / r.width, cy: zonaAgarre.cy + (e.clientY - zonaAgarre.y) / r.height });
  });
  function zonaSoltarMango(e) {
    e.stopPropagation();
    if (!zonaAgarre) return;
    zonaAgarre = null;
    mandarZoom(true);
  }
  zonaMango.addEventListener('pointerup', zonaSoltarMango);
  zonaMango.addEventListener('pointercancel', zonaSoltarMango);

  // ---- «🔄»: la página cambió en internet y la pantalla muestra la de antes ----
  // La pantalla la vuelve a pedir (la app de PC borra antes lo que tenía guardado) y contesta con su
  // estado: recién ahí se avisa «Página al día». El espejo de este celular también se vuelve a cargar.
  const actualizarBtn = document.getElementById('actualizarBtn');
  let esperandoPagina = null;
  actualizarBtn.addEventListener('click', () => {
    actualizarBtn.classList.remove('girando');
    void actualizarBtn.offsetWidth; // para que las flechitas giren otra vez aunque se toque seguido
    actualizarBtn.classList.add('girando');
    socket.emit('web', { accion: 'recargar' });
    // El espejo de este celular también: con el puente, la página trae sus archivos nuevos y se
    // recarga sola; sin puente, se la vuelve a pedir.
    if (!enVivo && espejoUrl) {
      if (espejoPreparada && espejoMarco.contentWindow) espejoMarco.contentWindow.postMessage({ conexiones: true, tipo: 'recargar' }, destinoEspejo());
      else espejoMarco.src = marcoDe(espejoUrl);
    }
    clearTimeout(esperandoPagina);
    esperandoPagina = setTimeout(() => { esperandoPagina = null; showToast('📺 La pantalla no contestó. Probá otra vez.'); }, 6000);
  });
  function paginaContesto() {
    if (!esperandoPagina) return;
    clearTimeout(esperandoPagina);
    esperandoPagina = null;
    showToast('✅ Página al día.');
  }

  function espejoOcultar() {
    if (espejoWeb.hidden) return;
    zonaApagar();
    vivoOcultar();
    espejoWeb.hidden = true;
    zoomControl.hidden = false;
    espejoBase = '';
    espejoUrl = '';
    clearTimeout(espejoEspera);
    espejoMarco.removeAttribute('src');
  }

  window.addEventListener('message', (evento) => {
    if (evento.source !== espejoMarco.contentWindow || espejoWeb.hidden) return;
    const aviso = evento.data;
    if (!aviso || aviso.conexiones !== true || evento.origin !== (espejoTraer ? 'null' : origenDe(espejoBase))) return;
    if (aviso.tipo === 'listo' && typeof aviso.url === 'string') {
      espejoPreparada = true;
      // Los videos de la página: acá se ven callados y mandan; suenan en la pantalla.
      espejoMarco.contentWindow.postMessage({ conexiones: true, tipo: 'soyEspejo' }, destinoEspejo());
      espejoAyuda.textContent = AYUDA_ESPEJO;
      if (typeof aviso.titulo === 'string' && aviso.titulo.trim()) {
        document.getElementById('espejoTitulo').textContent = '🌐 ' + aviso.titulo.trim().slice(0, 60);
      }
      if (aviso.url !== espejoUrl) {
        espejoUrl = aviso.url;
        socket.emit('web', { accion: 'ir', url: aviso.url });
      }
      espejoPintarMenu(aviso.menu);
    } else if (aviso.tipo === 'clic' && typeof aviso.ruta === 'string') {
      socket.emit('web', { accion: 'clic', ruta: aviso.ruta, navega: aviso.navega === true });
      if (aviso.navega === true && typeof aviso.url === 'string') espejoIrYa(aviso.url);
    } else if (aviso.tipo === 'desplazar') {
      socket.emit('web', { accion: 'desplazar', y: aviso.y });
    } else if (aviso.tipo === 'medio' && typeof aviso.ruta === 'string') {
      socket.emit('web', { accion: 'medio', ruta: aviso.ruta, t: aviso.t, reproduciendo: aviso.reproduciendo === true, vel: aviso.vel });
    }
  });

  // Botones del menú de la página: los detecta el puente y acá se muestran en una tira. Tocar
  // uno lleva el espejo a esa página, y la pantalla lo sigue.
  const espejoMenu = document.getElementById('espejoMenu');
  // «origen»: de qué sitio tienen que ser las cajas. «alTocar»: qué hace cada una (en el espejo
  // lleva el recuadro del celular a esa página; en vivo se lo pide a la app de PC).
  // La pantalla empieza a cargar la otra página en el mismo momento que el celular, sin esperar
  // a que el espejo termine de cargarla (antes se sumaban las dos cargas).
  function espejoIrYa(url) {
    if (url === espejoUrl || origenDe(url) !== origenDe(espejoBase)) return;
    espejoUrl = url;
    socket.emit('web', { accion: 'ir', url });
  }
  function espejoPintarMenu(menu, origen = origenDe(espejoBase), alTocar = (url) => { if (url !== espejoUrl) { espejoMarco.src = marcoDe(url); espejoIrYa(url); } }) {
    espejoMenu.textContent = '';
    const enlaces = Array.isArray(menu) ? menu.slice(0, 12).filter(e => e && typeof e.url === 'string' && typeof e.texto === 'string' && origen && origenDe(e.url) === origen) : [];
    espejoMenu.hidden = enlaces.length === 0;
    for (const enlace of enlaces) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'espejo-boton';
      if (enlace.actual === true) boton.setAttribute('aria-current', 'page');
      if (typeof enlace.icono === 'string' && origenDe(enlace.icono) === origen) {
        const dibujo = document.createElement('img');
        dibujo.src = enlace.icono;
        dibujo.alt = '';
        boton.append(dibujo);
      }
      boton.append(enlace.texto.slice(0, 30));
      boton.addEventListener('click', () => alTocar(enlace.url));
      espejoMenu.append(boton);
    }
  }

  function espejoPasarPagina(cuanto) {
    if (!espejoMarco.contentWindow || !espejoBase) return;
    if (!espejoPreparada) { showToast('Esta página no está preparada para Conexiones.'); return; }
    espejoMarco.contentWindow.postMessage({ conexiones: true, tipo: 'pagina', valor: cuanto }, destinoEspejo());
  }
  document.getElementById('espejoAnterior').addEventListener('click', () => espejoPasarPagina(-1));
  document.getElementById('espejoSiguiente').addEventListener('click', () => espejoPasarPagina(1));

  window.addEventListener('resize', () => { espejoAjustar(); vivoPintarLupa(); });

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
      // Ya contestó: o sigue donde iba («sigue») o no hay nada que esperar.
      if (esperandoPantalla && !estado.sigue) {
        esperandoPantalla = false;
        if (!estado.mostrando) { updateNavButtonsState(); pintarPasos(); }
      }
      if (estado.mostrando) {
        fotoPantalla = { foto: estado.foto, total: estado.total };
        if (!showStarted) { showStarted = true; pintarPasos(); }
        updateNavButtonsState();
        if (estado.pagina) {
          espejoMostrar(estado);
          if (!espejoWeb.hidden) zonaDesdeEstado(estado);
          paginaContesto();
        } else {
          espejoOcultar();
          youtubeOcultar();
          zoomMostrarFoto(estado.src, estado.zoom);
        }
      } else if (showStarted && estado.total === 0) {
        // Se borraron todas las imágenes mientras se mostraba: la pantalla volvió a la espera.
        showStarted = false;
        fotoPantalla = { foto: 0, total: 0 };
        espejoOcultar();
        youtubeOcultar();
        zoomApagar();
        updateNavButtonsState();
        pintarPasos();
        showToast('📷 Ya no quedan imágenes para mostrar.');
      }
    });
    // La pantalla entró o se fue. Si se va en medio de la presentación, el control deja de
    // decir «En pantalla» y vuelve a pedir que se conecte una.
    socket.on('hayPantalla', (hay, recuerda) => {
      const habia = hayPantalla;
      const sabida = pantallaSabida;
      hayPantalla = hay === true;
      pantallaSabida = true;
      esperandoPantalla = recuerda === true && !(hayPantalla && showStarted);
      if (hayPantalla) {
        pantallaVista = true;
        // Volvió la pantalla: se le pregunta en qué foto va.
        if (sabida && !habia) socket.emit('pantallaPedirEstado');
      } else {
        const estabaMostrando = showStarted;
        showStarted = false;
        fotoPantalla = { foto: 0, total: 0 };
        espejoOcultar();
        youtubeOcultar();
        zoomApagar();
        if (estabaMostrando) showToast(esperandoPantalla ? '📺 Se cerró la pantalla. Abrila: sigue sola.' : '📺 Se cerró la pantalla. Abrila otra vez.');
      }
      updateNavButtonsState();
      pintarPasos();
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

  // ---- Filo contesta hablando ----
  // Frases cortas grabadas una sola vez con la voz de Filo (publico/voz-filo/, Fish Audio): no
  // gastan nada al usarlas. «🗣️ Filo» las apaga o prende y se recuerda en este celular.
  const vozHablaBtn = document.getElementById('vozHablaBtn');
  const filoAudio = new Audio();
  let filoHabla = true;
  try { filoHabla = localStorage.getItem('filoHabla') !== 'no'; } catch { /* sin almacenamiento */ }
  let filoCallaHasta = 0;      // mientras Filo habla, lo que oye el micrófono no son órdenes
  let ordenParaFilo = null;
  let hechoParaFilo = null;
  function pintarFilo() {
    vozHablaBtn.setAttribute('aria-pressed', String(filoHabla));
    vozHablaBtn.textContent = filoHabla ? '🗣️ Filo' : '🔇 Filo';
    vozHablaBtn.setAttribute('aria-label', filoHabla ? 'Filo responde hablando: tocar para que no hable' : 'Filo no habla: tocar para que responda');
  }
  function ponerFiloHabla(si) {
    filoHabla = si;
    try { localStorage.setItem('filoHabla', filoHabla ? 'si' : 'no'); } catch { /* sin almacenamiento */ }
    if (!filoHabla) { filoAudio.pause(); filoVez++; if (typeof filoTermino === 'function') filoTermino(0); }
    pintarFilo();
  }
  vozHablaBtn.addEventListener('click', () => ponerFiloHabla(!filoHabla));
  pintarFilo();
  // Antes se dejaba de oír órdenes 4 s fijos cada vez que Filo hablaba (sus frases duran 1 s):
  // por eso a veces parecía que no escuchaba. Ahora sólo mientras suena de verdad.
  // En la app del celular, además, el micrófono se pausa mientras ella habla y sigue al terminar.
  let filoReanudar = null;
  let filoVez = 0;
  function filoTermino(margen) {
    filoCallaHasta = margen ? Date.now() + margen : 0;
    clearTimeout(filoReanudar);
    filoReanudar = null;
    if (vozDeLaApp && typeof vozDeLaApp.hablando === 'function') {
      try { vozDeLaApp.hablando(false); } catch { /* app vieja */ }
    }
  }
  filoAudio.addEventListener('playing', () => {
    const dura = isFinite(filoAudio.duration) && filoAudio.duration > 0 ? filoAudio.duration * 1000 : 2500;
    filoCallaHasta = Date.now() + Math.min(dura, 6000) + 300;
  });
  filoAudio.addEventListener('ended', () => filoTermino(300));
  filoAudio.addEventListener('error', () => filoTermino(0));
  function filoDice(clave) {
    if (!filoHabla || !clave) return;
    filoAudio.src = 'voz-filo/' + clave + '.mp3';
    if (vozDeLaApp && typeof vozDeLaApp.hablando === 'function') {
      try { vozDeLaApp.hablando(true); } catch { /* app vieja */ }
    }
    filoCallaHasta = Date.now() + 2500;
    // Por si el audio se traba sin avisar: el micrófono vuelve igual.
    clearTimeout(filoReanudar);
    filoReanudar = setTimeout(() => filoTermino(0), 7000);
    // Si llega otra frase antes, la promesa vieja falla: eso no cuenta como fin.
    const vez = ++filoVez;
    filoAudio.play().catch(() => { if (vez === filoVez) filoTermino(0); });
  }
  // Qué frase dice Filo según lo que se pidió y lo que se hizo.
  function claveDeFilo(orden, hecho) {
    const texto = String(hecho || '');
    if (!orden) return /no entend/i.test(texto) ? 'no_entendi' : null;
    if (/^(No |Todavía|primero|ese botón|el buscador|decime|no hay)/i.test(texto) || /sólo está/.test(texto)) return 'no_puedo';
    const a = orden.accion;
    switch (orden.tipo) {
      case 'cerrarRespuesta': return orden.si ? 'cerrada' : 'sigues';
      case 'ytElegido': return 'video';
      case 'cerrar': return 'cerrar';
      case 'ayuda': return 'ayuda';
      case 'youtube': return 'buscar';
      case 'boton': return orden.id === 'actualizarBtn' ? 'actualizo' : /^fs/.test(orden.id) ? 'pantalla_completa' : 'listo';
      case 'diapositiva':
        if (a === 'mostrar' || a === 'siguiente' || a === 'anterior') return a;
        return Number(a) === totalSlides && totalSlides > 1 ? 'ultima' : 'diapositiva';
      case 'zoom':
        if (a === 'acercar' || a === 'escala') return 'agrando';
        if (a === 'alejar') return 'achico';
        if (a === 'normal') return 'normal';
        return a === 'forma' ? 'forma' : 'muevo';
      case 'medios': {
        const video = orden.para === 'video' || /🎬/.test(texto);
        if (a === 'volumen') {
          if (orden.valor === 0) return 'silencio';
          return orden.valor % 10 === 0 ? 'volumen_' + orden.valor : 'listo';
        }
        if (a === 'mudo') return orden.valor ? 'silencio' : 'sonido';
        if (a === 'conSonido') return 'sonido';
        if (a === 'subirVolumen') return 'subir';
        if (a === 'bajarVolumen') return 'bajar';
        if (a === 'pausar') return 'pausa';
        if (a === 'reproducir') return /🎬/.test(texto) ? 'video' : 'seguir';
        if (a === 'elegir' || a === 'buscar') return video ? 'video' : 'cancion';
        if (a === 'azar') return video ? 'video' : 'azar';
        if (a === 'siguiente' || a === 'anterior') return video ? 'video' : a + '_cancion';
        if (a === 'terminar') return orden.para === 'musica' ? 'musica_fin' : 'video_fin';
        if (a === 'saltar') return orden.valor > 0 ? 'adelanto' : 'atraso';
        if (a === 'bucle') return orden.valor ? 'bucle' : 'listo';
        if (a === 'cual') return null; // el nombre se lee en la pantalla del control
        return ['ir', 'irMitad', 'irFinal', 'irCasiFinal', 'reiniciar'].includes(a) ? 'momento' : 'listo';
      }
      default: return 'listo';
    }
  }

  let ordenDeFilo = null;   // la orden a la que Filo está contestando ahora
  function hacerOrdenDeVoz(alternativas) {
    if (Date.now() < filoCallaHasta) {
      // Mientras Filo habla, el micrófono puede oírla a ella: eso no es una orden. Pero si la
      // persona pide OTRA cosa, Filo se calla y se cumple enseguida (así no se traba con
      // muchas órdenes seguidas). Lo que no se entiende o es lo mismo que contesta, se ignora.
      if (hojaCerrarAbierta()) return;
      const nueva = window.OrdenesVoz.interpretarVoz(alternativas, totalSlides);
      const mismaQueFilo = nueva && ordenDeFilo && nueva.tipo === ordenDeFilo.tipo &&
        nueva.accion === ordenDeFilo.accion && nueva.valor === ordenDeFilo.valor;
      if (!nueva || mismaQueFilo) return;
      filoAudio.pause();
      filoVez++;
      filoTermino(0);
    }
    ordenParaFilo = null;
    hechoParaFilo = null;
    const antes = voiceHeard.textContent;
    cumplirOrdenDeVoz(alternativas);
    if (voiceHeard.textContent !== antes || hechoParaFilo !== null) {
      ordenDeFilo = ordenParaFilo;
      filoDice(claveDeFilo(ordenParaFilo, hechoParaFilo));
    }
  }

  function cumplirOrdenDeVoz(alternativas) {
    const oido = String(alternativas[0] || '').trim();
    // Con la pregunta «¿Cerrar tu pantalla?» abierta sólo se escucha la respuesta: «sí» (o
    // «cerrar») cierra, «no» (o «seguir») la deja como está.
    if (hojaCerrarAbierta()) {
      const dichas = alternativas.flatMap(a => window.OrdenesVoz.normalizar(a).split(/\s+/));
      if (['si', 'confirmar', 'confirmo', 'cerrar', 'cierra', 'cerrala'].some(p => dichas.includes(p))) {
        cerrarPantalla();
        ordenParaFilo = { tipo: 'cerrarRespuesta', si: true };
        showHeard(oido, '✅ pantalla cerrada');
      } else if (['no', 'seguir', 'sigue', 'cancelar', 'cancela'].some(p => dichas.includes(p))) {
        ocultarHojaCerrar();
        ordenParaFilo = { tipo: 'cerrarRespuesta', si: false };
        showHeard(oido, 'seguís mostrando');
      }
      return;
    }
    // Con los resultados de YouTube a la vista, «uno», «el segundo», «pon el tres» elige ese video.
    const yt = window.youtubeCelular;
    if (yt && yt.resultadosALaVista()) {
      const n = alternativas.map(a => window.OrdenesVoz.numeroDicho(a)).find(x => x !== null && x !== undefined);
      if (n && n >= 1) {
        const titulo = yt.elegirResultado(n);
        ordenParaFilo = titulo ? { tipo: 'ytElegido' } : { tipo: 'medios', accion: 'elegir' };
        showHeard(oido, titulo ? '🎬 ' + titulo : 'no hay video ' + n + ' en los resultados');
        return;
      }
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
    ordenParaFilo = orden;
    if (orden.tipo === 'cerrar') {
      if (!showStarted) { showHeard(oido, 'no hay nada en pantalla para cerrar'); return; }
      preguntarCerrarPantalla();
      showHeard(oido, 'decí «sí» para cerrar o «no» para seguir');
      return;
    }
    // Botones del control por voz: se tocan igual que con el dedo, si están a la vista.
    if (orden.tipo === 'boton') {
      const boton = document.getElementById(orden.id);
      if (!boton || boton.hidden || boton.disabled || !boton.offsetParent) {
        showHeard(oido, orden.id === 'zonaBtn' ? '«✂ Zona» sólo está con una página web en pantalla' : 'ese botón no está ahora');
        return;
      }
      boton.click();
      showHeard(oido, '👆 ' + (boton.textContent || '').trim().slice(0, 30));
      return;
    }
    if (orden.tipo === 'filo') {
      ponerFiloHabla(orden.habla);
      ordenParaFilo = orden.habla ? { tipo: 'filoVuelve' } : null;
      showHeard(oido, orden.habla ? '🗣️ Filo vuelve a responder' : '🔇 Filo ya no habla');
      return;
    }
    if (orden.tipo === 'youtube') {
      if (!yt || !yt.buscarPorVoz(orden.texto)) { showHeard(oido, 'el buscador de YouTube no está disponible'); return; }
      showHeard(oido, '🔍 Buscando «' + orden.texto + '»… después decí «uno», «dos»… para ponerlo');
      return;
    }
    if (orden.tipo === 'ayuda') {
      showHeard(oido, '«siguiente», «atrás», «diapositiva 5», «última» · «pon música», «pon la canción …», ' +
        '«canción al azar», «¿qué canción es?», «ve al minuto 2», «termina la música» · «volumen 30», «sube 20», ' +
        '«baja a 0», «quita el silencio» · «agranda 50», «achica 30», «al doble», «derecha 20», «un cuadrado» · ' +
        '«pantalla completa», «actualiza», «zona»');
      return;
    }
    if (orden.tipo === 'diapositiva') {
      if (!hayPantalla) { showHeard(oido, 'primero abrí la pantalla'); return; }
      socket.emit('cambiar', orden.accion);
      showHeard(oido);
      return;
    }
    if (orden.tipo === 'zoom') {
      // Agrandar o achicar la imagen (o la página web) de la pantalla, igual que con los dos dedos.
      if (!puedeZoom()) { showHeard(oido, 'primero tocá «Mostrar»'); return; }
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
      if (orden.accion === 'forma') {
        // Sólo una forma en el medio, como dibujarla con «✂ Zona»: cuadrado, rectángulo largo o alto.
        // Con número, su ancho en % de la página («cuadrado 30»).
        const lugar = (espejoWeb.hidden ? zoomFoto : zonaLugar()).getBoundingClientRect();
        const proporcion = lugar.width && lugar.height ? lugar.width / lugar.height : 16 / 9;
        const lado = orden.valor ? orden.valor / 100 : orden.forma === 'cuadrado' ? 0.4 : orden.forma === 'largo' ? 0.6 : 0.35;
        let w = lado;
        let h = orden.forma === 'cuadrado' ? lado * proporcion : orden.forma === 'largo' ? lado * 0.5 * proporcion : lado * 1.8 * proporcion;
        if (h > 1) { w = w / h; h = 1; }
        Object.assign(zoom, { z: Math.min(4, 1 / Math.max(w, h)), w, h, cx: zoom.z > 1.01 ? zoom.cx : 0.5, cy: zoom.z > 1.01 ? zoom.cy : 0.5 });
        acotarZoom();
        pintarZoom();
        if (!espejoWeb.hidden) zonaPintar();
        mandarZoom(true);
        showHeard(oido, orden.forma === 'cuadrado' ? '⬛ Cuadrado' : orden.forma === 'largo' ? '▬ Rectángulo' : '▮ Rectángulo alto');
        return;
      }
      const MOVER = { derecha: [1, 0, '➡️ Derecha'], izquierda: [-1, 0, '⬅️ Izquierda'], arriba: [0, -1, '⬆️ Arriba'], abajo: [0, 1, '⬇️ Abajo'] };
      const mover = MOVER[orden.accion];
      if (mover) {
        // Sólo se puede correr una imagen agrandada: si está entera, primero se agranda al doble.
        const z = zoom.z > 1.01 ? zoom.z : 2;
        // Sin número, media ventana de lo que se ve; con número, ese % de la página («derecha 20»).
        const paso = orden.valor ? orden.valor / 100 : 0.5 / z;
        cambiarZoom({ z, cx: zoom.cx + mover[0] * paso, cy: zoom.cy + mover[1] * paso }, true);
        showHeard(oido, mover[2] + (orden.valor ? ' ' + orden.valor + ' %' : ''));
        return;
      }
      // «agranda 50» = 50 % más grande; «achica 30» = 30 % más chica; sin número, ×1,5.
      // «al doble», «agranda al 150»: ese tamaño justo.
      let nuevo;
      if (orden.accion === 'normal') nuevo = { z: 1, cx: 0.5, cy: 0.5 };
      else if (orden.accion === 'escala') nuevo = { z: orden.valor / 100 };
      else if (orden.accion === 'acercar') nuevo = { z: zoom.z * (orden.valor ? 1 + orden.valor / 100 : 1.5) };
      else nuevo = { z: zoom.z * (orden.valor ? Math.max(0.05, 1 - orden.valor / 100) : 1 / 1.5) };
      cambiarZoom(nuevo, true);
      showHeard(oido, zoom.z > 1.01 ? '🔍 ' + Math.round(zoom.z * 100) + ' %' : '🔍 Tamaño normal');
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
    hechoParaFilo = hecho || '';
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
          vigilarVoz();
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal) continue;
          hacerOrdenDeVoz(Array.from(result).map(alt => alt.transcript));
        }
      };
      recognition.onerror = (event) => {
        console.error('Voice error:', event.error);
        ultimoErrorVoz = event.error;
        // Sin permiso de micrófono no tiene sentido seguir reintentando
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          voiceActive = false;
          setVoiceUI(false);
        }
      };
      ['onstart', 'onaudiostart', 'onsoundstart', 'onspeechstart', 'onspeechend'].forEach(evento => {
        recognition[evento] = vigilarVoz;
      });
      // El navegador corta el reconocimiento solo (a veces tras una sola orden,
      // sobre todo en celular) aunque continuous=true — por eso lo reiniciamos
      // acá cada vez que termina, mientras el usuario no lo haya apagado.
      recognition.onend = () => {
        clearTimeout(vozTrabada);
        if (!voiceActive) return;
        const demora = ultimoErrorVoz === 'network' ? 1000 : 0;
        ultimoErrorVoz = null;
        volverAEscuchar(demora);
      };
    }
  }

  // Vuelve a poner el micrófono a escuchar; si el navegador no lo deja todavía («already
  // started»), prueba de nuevo hasta que ande. Antes probaba una sola vez y, si fallaba, la voz
  // quedaba muda hasta apagarla y prenderla.
  let ultimoErrorVoz = null;
  let vozReintento = null;
  let vozTrabada = null;
  function volverAEscuchar(demora) {
    clearTimeout(vozReintento);
    vozReintento = setTimeout(() => {
      if (!voiceActive || !recognition) return;
      try {
        recognition.start();
        vigilarVoz();
      } catch (e) {
        volverAEscuchar(300);
      }
    }, demora || 0);
  }
  // Si el reconocedor se queda colgado sin avisar nada por 15 s, se corta y arranca de nuevo.
  function vigilarVoz() {
    clearTimeout(vozTrabada);
    vozTrabada = setTimeout(() => {
      if (!voiceActive || !recognition) return;
      try { recognition.abort(); } catch { /* ya estaba parado */ }
      volverAEscuchar(400);
    }, 15000);
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
      clearTimeout(vozReintento);
      clearTimeout(vozTrabada);
      recognition.stop();
      setVoiceUI(false);
    } else {
      voiceActive = true;
      volverAEscuchar(0);
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
