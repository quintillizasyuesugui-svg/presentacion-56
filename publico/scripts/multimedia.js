// Dos páginas usan este script:
//  - multimedia.html: ver, ordenar (arrastrando o con ▲▼) y borrar tu música y tus videos.
//    El admin ve lo de todas las personas y puede borrar lo de cualquiera.
//  - subir-multimedia.html: subir canciones y videos o guardar un enlace de YouTube. Los
//    videos se achican a 720p en el mismo celular antes de subir (Mediabunny, publico/vendor).
// Cada parte se activa sólo si su página la tiene.
const socket = io();
(function () {
  const $ = (id) => document.getElementById(id);
  const statusDot = $('statusDot');
  const statusText = $('statusText');
  socket.on('connect', () => { statusDot.classList.add('online'); statusText.textContent = 'Conectado'; });
  socket.on('disconnect', () => { statusDot.classList.remove('online'); statusText.textContent = 'Sin conexión'; });

  const MB = 1024 * 1024;
  const fmtTiempo = (s) => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const fmtMb = (b) => (Math.round((b / MB) * 10) / 10).toLocaleString('es') + ' MB';

  const hayListas = !!$('listaMusica');
  const haySubida = !!$('subirMusicaBtn');
  let auth = null;
  let datos = { elementos: [], espacio: { usado: 0, total: 0 }, explicacion: '', subida: 'no', limites: { musica: 15 * MB, video: 100 * MB } };
  const seleccion = { musica: new Set(), video: new Set() };
  const seleccionando = { musica: false, video: false };
  // Listas plegadas: se ven las primeras VISIBLES_PLEGADA y un botón «Ver todas».
  const VISIBLES_PLEGADA = 5;
  const desplegada = { musica: false, video: false };
  let filtroPersona = new URLSearchParams(location.search).get('de') || ''; // el admin llega desde «Personas»

  // ---------- aviso ----------
  const toast = $('toast');
  let temporizador;
  function avisar(texto, bien) {
    toast.textContent = texto;
    toast.classList.toggle('ok', !!bien);
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; toast.classList.remove('ok'); }, 200);
    }, 6000);
  }

  function crear(etiqueta, props = {}, hijos = []) {
    const el = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const h of [].concat(hijos)) if (h) el.append(h);
    return el;
  }

  async function pedir(ruta, cuerpo) {
    const res = await authFetch(ruta, cuerpo ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    } : {});
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Algo salió mal. Probá de nuevo.');
    return json;
  }

  // ---------- pestañas ----------
  function pestana() {
    const videosActiva = location.hash === '#videos';
    $('seccionMusica').hidden = videosActiva;
    $('seccionVideos').hidden = !videosActiva;
    $('pestanaMusica').setAttribute('aria-current', videosActiva ? 'false' : 'page');
    $('pestanaVideos').setAttribute('aria-current', videosActiva ? 'page' : 'false');
    if ($('verLista')) $('verLista').href = 'multimedia.html' + (videosActiva ? '#videos' : '#musica');
  }
  window.addEventListener('hashchange', pestana);
  pestana();

  // ---------- espacio ----------
  function pintarEspacio() {
    const { usado, total } = datos.espacio;
    const pct = total ? Math.min(100, (100 * usado) / total) : 100;
    $('espacioTexto').textContent = `Usaste ${fmtMb(usado)} de ${fmtMb(total)}`;
    $('espacioRiel').firstElementChild.style.width = pct + '%';
    $('espacioRiel').classList.toggle('lleno', pct >= 90);
    $('espacioExplicacion').textContent = '📦 ' + datos.explicacion + ' Los enlaces de YouTube no ocupan espacio.';
  }

  // ---------- listas ----------
  function elementosDe(tipo) {
    return datos.elementos.filter(e => e.tipo === tipo && (!filtroPersona || e.owner === filtroPersona));
  }

  function pintarFiltroAdmin() {
    if (!auth || !auth.isAdmin || !$('filtroAdmin')) return;
    const personas = [...new Set(datos.elementos.map(e => e.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const select = $('filtroPersona');
    const actual = filtroPersona;
    select.replaceChildren(crear('option', { value: '', text: `Todas las personas (${personas.length})` }), ...personas.map(p => crear('option', { value: p, text: p })));
    select.value = personas.includes(actual) ? actual : '';
    filtroPersona = select.value;
    $('filtroAdmin').hidden = false;
  }

  const virtuales = {};
  function pintarLista(tipo) {
    const lista = tipo === 'musica' ? $('listaMusica') : $('listaVideos');
    const barra = tipo === 'musica' ? $('seleccionMusica') : $('seleccionVideos');
    const items = elementosDe(tipo);
    const sel = seleccion[tipo];
    for (const id of [...sel]) if (!items.some(e => e.id === id)) sel.delete(id);
    const uno = tipo === 'musica' ? 'canción' : 'video';
    const varios = tipo === 'musica' ? 'canciones' : 'videos';
    // Se ordena lo de una sola persona: lo propio o, para el admin, la persona elegida en «Ver de».
    const duenos = [...new Set(items.map(e => e.owner))];
    const dueno = duenos.length === 1 ? duenos[0] : null;
    const propios = dueno && (dueno === auth.name || auth.isAdmin) ? items : [];
    const ayuda = tipo === 'musica' ? $('ayudaOrdenMusica') : $('ayudaOrdenVideos');
    if (ayuda) {
      ayuda.textContent = auth.isAdmin && duenos.length > 1
        ? 'Para ordenar, elegí una persona en «Ver de».'
        : `Arrastrá ≡ (o usá ▲▼) para elegir qué ${tipo === 'musica' ? 'canción' : 'video'} sale primero.`;
    }

    if (seleccionando[tipo]) {
      const todas = crear('input', { type: 'checkbox', id: 'todas-' + tipo });
      todas.checked = items.length > 0 && sel.size === items.length;
      todas.addEventListener('change', () => {
        sel.clear();
        if (todas.checked) items.forEach(e => sel.add(e.id));
        pintarLista(tipo);
      });
      barra.replaceChildren(
        crear('label', { for: 'todas-' + tipo }, [todas, 'Todas']),
        crear('span', { class: 'grupo' }, [
          crear('button', { type: 'button', class: 'btn chico secondary', text: 'Cancelar', onclick: () => { seleccionando[tipo] = false; sel.clear(); pintarLista(tipo); } }),
          crear('button', { type: 'button', class: 'btn chico danger-solid', text: `🗑️ Borrar (${sel.size})`, disabled: sel.size === 0, onclick: () => pedirBorrar(tipo, [...sel]) })
        ])
      );
    } else {
      barra.replaceChildren(
        crear('span', { text: items.length ? `${items.length} ${items.length === 1 ? uno : varios}` : `Todavía no hay ${varios}.` }),
        ...(items.length ? [crear('button', { type: 'button', class: 'btn chico', text: '☑️ Seleccionar', onclick: () => { seleccionando[tipo] = true; pintarLista(tipo); } })] : [])
      );
    }

    // Se puede ordenar (arrastrando ≡ o con ▲▼) cuando todo lo que se ve es de uno mismo.
    const ordenable = !seleccionando[tipo] && items.length > 1 && propios.length === items.length;
    const visibles = desplegada[tipo] ? items : items.slice(0, VISIBLES_PLEGADA);
    const boton = tipo === 'musica' ? $('verTodasMusica') : $('verTodasVideos');
    boton.hidden = items.length <= VISIBLES_PLEGADA;
    boton.textContent = desplegada[tipo] ? 'Ver menos ▴' : `Ver todas (${items.length}) ▾`;

    // Con miles de filas sólo se dibujan las que se ven (lista-virtual.js)
    const ctx = { tipo, sel, ordenable, dueno, total: items.length };
    if (!virtuales[tipo]) {
      virtuales[tipo] = window.listaVirtual(lista, {
        crearFila: (e, n) => crearFilaMedio(virtuales[tipo].ctx, e, n),
        numero: '.numero-orden',
        // Se agarra de cualquier parte de la fila (no de los botones); con ≡ agarra sin esperar.
        arrastre: (ev) => {
          if (!virtuales[tipo].ctx.ordenable) return false;
          const sobre = ev.target.closest('button, input, a, select, textarea');
          if (sobre && !sobre.classList.contains('asa-orden')) return false;
          return sobre ? 'ya' : 'esperar';
        },
        alOrdenar: () => guardarOrden(virtuales[tipo].ctx.tipo, virtuales[tipo].ctx.dueno, virtuales[tipo].visibles)
      });
    }
    virtuales[tipo].ctx = ctx;
    virtuales[tipo].visibles = visibles;
    virtuales[tipo].poner(visibles);
  }

  function crearFilaMedio({ tipo, sel, ordenable, dueno, total }, e, n) {
    const marcada = sel.has(e.id);
    const detalles = [];
    if (e.origen === 'youtube') detalles.push('🔗 YouTube' + (e.inicio != null || e.fin != null ? ` (${fmtTiempo(e.inicio || 0)} a ${e.fin != null ? fmtTiempo(e.fin) : 'el final'})` : ''));
    if (e.duracion) detalles.push(fmtTiempo(e.duracion));
    detalles.push(e.bytes ? fmtMb(e.bytes) : '0 MB');
    if (auth.isAdmin && e.owner && e.owner !== auth.name) detalles.push('👤 ' + e.owner);
    const fila = crear('li', { class: 'fila-medio' + (marcada ? ' marcada' : ''), 'data-id': e.id });
    if (ordenable) {
      fila.append(crear('button', { type: 'button', class: 'asa-orden', 'aria-label': 'Arrastrar para cambiar el orden de ' + e.nombre, text: '≡' }));
      fila.classList.add('ordenable');
    }
    fila.append(crear('span', { class: 'numero-orden', 'aria-hidden': 'true', text: String(n + 1) }));
    if (seleccionando[tipo]) {
      const cb = crear('input', { type: 'checkbox', 'aria-label': 'Marcar ' + e.nombre });
      cb.checked = marcada;
      cb.addEventListener('change', () => { if (cb.checked) sel.add(e.id); else sel.delete(e.id); pintarLista(tipo); });
      fila.append(cb);
    }
    fila.append(crear('span', { class: 'datos-medio' }, [crear('b', { text: (e.origen === 'youtube' ? '' : tipo === 'video' ? '📁 ' : '') + e.nombre }), crear('span', { text: detalles.join(' · ') })]));
    if (!seleccionando[tipo]) {
      if (ordenable) {
        fila.append(
          crear('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir de posición', text: '▲', disabled: n === 0, onclick: () => mover(tipo, e.id, -1, dueno) }),
          crear('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bajar de posición', text: '▼', disabled: n === total - 1, onclick: () => mover(tipo, e.id, 1, dueno) })
        );
      }
      fila.append(crear('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Borrar ' + e.nombre, text: '🗑️', onclick: () => pedirBorrar(tipo, [e.id]) }));
    }
    return fila;
  }

  function pintarTodo() {
    pintarEspacio();
    if (!hayListas) return;
    pintarFiltroAdmin();
    pintarLista('musica');
    pintarLista('video');
  }
  if (hayListas) $('filtroPersona').addEventListener('change', (e) => { filtroPersona = e.target.value; pintarLista('musica'); pintarLista('video'); });

  async function cargar() {
    try {
      datos = await pedir('/api/multimedia');
      pintarTodo();
    } catch (err) {
      avisar(err.message);
    }
  }

  // ---- Arrastrar para ordenar (las flechas ▲▼ quedan de respaldo) ----
  async function guardarOrden(tipo, dueno, visibles) {
    // Lo que se ve quedó en el orden nuevo; lo que estaba plegado sigue detrás, igual que antes.
    const vistos = visibles.map(x => x.id);
    const yaVistos = new Set(vistos);
    const resto = datos.elementos.filter(x => x.tipo === tipo && x.owner === dueno && !yaVistos.has(x.id)).map(x => x.id);
    const ids = [...vistos, ...resto];
    const antes = datos.elementos.filter(x => x.tipo === tipo && x.owner === dueno).map(x => x.id);
    if (ids.join() === antes.join()) return;
    try {
      datos = await pedir('/api/multimedia/orden', { tipo, ids, dueno });
      avisar('✅ Orden guardado: así van a salir en el celular.', true);
    } catch (err) {
      avisar(err.message);
      pintarTodo();
    }
  }

  if (hayListas) {
    $('verTodasMusica').addEventListener('click', () => { desplegada.musica = !desplegada.musica; pintarLista('musica'); });
    $('verTodasVideos').addEventListener('click', () => { desplegada.video = !desplegada.video; pintarLista('video'); });
  }

  async function mover(tipo, id, paso, dueno) {
    const propios = datos.elementos.filter(e => e.tipo === tipo && e.owner === dueno).map(e => e.id);
    const i = propios.indexOf(id);
    const j = i + paso;
    if (i === -1 || j < 0 || j >= propios.length) return;
    [propios[i], propios[j]] = [propios[j], propios[i]];
    try {
      datos = await pedir('/api/multimedia/orden', { tipo, ids: propios, dueno });
      pintarTodo();
    } catch (err) {
      avisar(err.message);
    }
  }

  // ---------- animación al borrar: la fila se rompe como vidrio ----------
  // La fila tiembla, se parte en triángulos (copias de la fila recortadas con clip-path) y los
  // pedazos caen girando. Después las filas de abajo suben a ocupar el lugar. Con «reducir
  // movimiento» la fila sólo se desvanece.
  const CURVA_SALIDA = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const CURVA_MOVER = 'cubic-bezier(0.77, 0, 0.175, 1)';
  const MAXIMO_ROTAS = 8; // con más, se rompen las primeras que se ven y el resto se va sin pedazos
  const azar = (a, b) => a + Math.random() * (b - a);

  function triangulosDe(ancho, alto) {
    const N = 7;
    const arriba = [0];
    for (let i = 1; i < N; i++) arriba.push(ancho * i / N + azar(-ancho / (N * 3), ancho / (N * 3)));
    arriba.push(ancho);
    const abajo = arriba.map((x, i) => (i === 0 || i === N ? x : x + azar(-ancho / (N * 2.5), ancho / (N * 2.5))));
    const piezas = [];
    for (let i = 0; i < N; i++) {
      piezas.push({ puntos: `${arriba[i]}px 0,${arriba[i + 1]}px 0,${abajo[i + 1]}px ${alto}px`, cx: (arriba[i] + arriba[i + 1] + abajo[i + 1]) / 3, cy: alto / 3 });
      piezas.push({ puntos: `${arriba[i]}px 0,${abajo[i + 1]}px ${alto}px,${abajo[i]}px ${alto}px`, cx: (arriba[i] + abajo[i + 1] + abajo[i]) / 3, cy: alto * 2 / 3 });
    }
    return piezas;
  }

  async function romperFila(fila, demora) {
    await fila.animate({ transform: ['translateX(0)', 'translateX(-3px)', 'translateX(3px)', 'translateX(-2px)', 'translateX(0)'] },
      { duration: 160, delay: demora, easing: 'linear' }).finished;
    const r = fila.getBoundingClientRect();
    const pedazos = triangulosDe(r.width, r.height).map((t) => {
      const copia = fila.cloneNode(true);
      copia.classList.add('pedazo-vidrio');
      copia.removeAttribute('data-id');
      Object.assign(copia.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', clipPath: `polygon(${t.puntos})`, transformOrigin: `${t.cx}px ${t.cy}px` });
      document.body.append(copia);
      const dx = (t.cx - r.width / 2) / r.width * 70 + azar(-12, 12);
      return copia.animate({
        transform: ['translate(0, 0) rotate(0deg)', `translate(${dx}px, ${azar(70, 140)}px) rotate(${azar(-55, 55)}deg)`],
        opacity: [1, 1, 0], offset: [0, 0.55, 1]
      }, { duration: azar(480, 620), easing: CURVA_MOVER, fill: 'forwards' });
    });
    fila.style.visibility = 'hidden';
    await Promise.all(pedazos.map(a => a.finished));
    pedazos.forEach(a => a.effect.target.remove());
  }

  async function romperFilas(ids) {
    const quitar = new Set(ids);
    const filas = [...document.querySelectorAll('.lista-medios .fila-medio')].filter(f => quitar.has(f.dataset.id));
    if (!filas.length || typeof filas[0].animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await Promise.all(filas.map(f => f.animate({ opacity: [1, 0] }, { duration: 200, easing: 'ease', fill: 'forwards' }).finished));
      return;
    }
    const alto = window.innerHeight;
    const aLaVista = filas.filter(f => { const r = f.getBoundingClientRect(); return r.bottom > 0 && r.top < alto; }).slice(0, MAXIMO_ROTAS);
    filas.filter(f => !aLaVista.includes(f)).forEach(f => { f.style.opacity = '0'; });
    await Promise.all(aLaVista.map((f, i) => romperFila(f, i * 60)));
  }

  function posicionesDeFilas() {
    return new Map([...document.querySelectorAll('.lista-medios .fila-medio')].map(f => [f.dataset.id, f.getBoundingClientRect().top]));
  }
  function subirFilas(antes) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const fila of document.querySelectorAll('.lista-medios .fila-medio')) {
      const corrida = antes.has(fila.dataset.id) ? antes.get(fila.dataset.id) - fila.getBoundingClientRect().top : 0;
      if (corrida && typeof fila.animate === 'function') {
        fila.animate({ transform: [`translateY(${corrida}px)`, 'translateY(0px)'] }, { duration: 220, easing: CURVA_SALIDA });
      }
    }
  }

  // ---------- borrar (una o varias) ----------
  const capa = $('confirmar');
  let porBorrar = null;
  function pedirBorrar(tipo, ids) {
    if (!ids.length) return;
    const items = datos.elementos.filter(e => ids.includes(e.id));
    const libera = items.reduce((s, e) => s + (e.bytes || 0), 0);
    const nombre = tipo === 'musica' ? (ids.length === 1 ? 'canción' : 'canciones') : (ids.length === 1 ? 'video' : 'videos');
    $('confirmarTitulo').textContent = `¿Estás seguro de borrar ${ids.length} ${nombre}?`;
    const ajenos = [...new Set(items.map(e => e.owner).filter(o => o && o !== auth.name))];
    $('confirmarTexto').textContent = 'Se borra para siempre: no se puede recuperar ni cancelar.' +
      (libera ? ` Se liberan ${fmtMb(libera)}.` : '') +
      (ajenos.length ? ` Es de: ${ajenos.join(', ')}.` : '') +
      ' Si algo está sonando en una pantalla, se detiene.';
    porBorrar = { tipo, ids };
    capa.hidden = false;
    requestAnimationFrame(() => capa.classList.add('show'));
    $('confirmarNo').focus();
  }
  function cerrarConfirmar() {
    capa.classList.remove('show');
    setTimeout(() => { capa.hidden = true; }, 200);
    porBorrar = null;
  }
  if (hayListas) $('confirmarNo').addEventListener('click', cerrarConfirmar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && capa && !capa.hidden) cerrarConfirmar(); });
  if (hayListas) $('confirmarSi').addEventListener('click', async () => {
    if (!porBorrar) return;
    const { tipo, ids } = porBorrar;
    $('confirmarSi').disabled = true;
    try {
      const nuevos = await pedir('/api/multimedia/borrar', { ids });
      cerrarConfirmar();
      // Se rompe recién cuando el servidor confirmó el borrado: si falla, la fila sigue entera.
      await romperFilas(ids);
      const antes = posicionesDeFilas();
      datos = nuevos;
      seleccion[tipo].clear();
      seleccionando[tipo] = false;
      pintarTodo();
      subirFilas(antes);
      avisar(`🗑️ Listo: se ${ids.length === 1 ? 'borró 1' : 'borraron ' + ids.length}.`, true);
    } catch (err) {
      avisar(err.message);
      cerrarConfirmar();
    } finally {
      $('confirmarSi').disabled = false;
    }
  });

  // ---------- subir ----------
  function leerDuracion(blob, tipo) {
    return new Promise((listo) => {
      const el = document.createElement(tipo === 'video' ? 'video' : 'audio');
      const url = URL.createObjectURL(blob);
      const fin = (d) => { URL.revokeObjectURL(url); listo(Number.isFinite(d) ? d : 0); };
      el.preload = 'metadata';
      el.onloadedmetadata = () => fin(el.duration);
      el.onerror = () => fin(0);
      setTimeout(() => fin(0), 10000);
      el.src = url;
    });
  }

  // Achica el video a 720p en el celular/PC. Si el navegador no puede (formato raro, un
  // navegador viejo), devuelve el original y se sube tal cual (hasta 100 MB).
  async function comprimirVideo(archivo, alAvanzar) {
    try {
      return await achicar(archivo, alAvanzar);
    } catch (err) {
      console.warn('No se pudo achicar el video, se sube tal cual:', err);
      return { archivo, comprimido: false };
    }
  }

  async function achicar(archivo, alAvanzar) {
    if (!('VideoEncoder' in window)) return { archivo, comprimido: false };
    let M;
    try {
      M = await import('/vendor/mediabunny.min.mjs');
    } catch {
      return { archivo, comprimido: false };
    }
    const entrada = new M.Input({ source: new M.BlobSource(archivo), formats: M.ALL_FORMATS });
    const pista = await entrada.getPrimaryVideoTrack();
    if (!pista) throw new Error('Ese archivo no tiene video.');
    const ancho = pista.displayWidth;
    const alto = pista.displayHeight;
    const duracion = await entrada.computeDuration();
    const BITRATE = 1800000; // ~14 MB por minuto con el audio
    const bitsPorSegundo = duracion ? (archivo.size * 8) / duracion : Infinity;
    const lado = Math.min(ancho, alto);
    if (lado <= 720 && bitsPorSegundo <= BITRATE * 1.3 && /\.mp4$/i.test(archivo.name)) return { archivo, comprimido: false };

    const escala = lado > 720 ? 720 / lado : 1;
    const par = (n) => Math.max(2, Math.round((n * escala) / 2) * 2);
    const opcionesVideo = { codec: 'avc', bitrate: BITRATE, width: par(ancho), height: par(alto), fit: 'fill' };

    async function intentar(codecAudio) {
      const salida = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
      const conversion = await M.Conversion.init({
        input: entrada,
        output: salida,
        video: opcionesVideo,
        audio: { codec: codecAudio, bitrate: 128000 },
        showWarnings: false
      });
      const perdioAudio = conversion.discardedTracks.some(d => d.track.type === 'audio' && d.reason !== 'discarded_by_user');
      if (!conversion.isValid || perdioAudio) return null;
      conversion.onProgress = (p) => alAvanzar(p);
      await conversion.execute();
      return new Blob([salida.target.buffer], { type: 'video/mp4' });
    }
    const resultado = (await intentar('aac')) || (await intentar('opus'));
    if (!resultado || resultado.size >= archivo.size) return { archivo, comprimido: false };
    const nombre = archivo.name.replace(/\.[^.]+$/, '') + '.mp4';
    return { archivo: new File([resultado], nombre, { type: 'video/mp4' }), comprimido: true, antes: archivo.size };
  }

  function enviarConProgreso(url, formulario, cabeceras, alAvanzar) {
    return new Promise((listo, fallo) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      for (const [k, v] of Object.entries(cabeceras || {})) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar(e.loaded / e.total); };
      xhr.onload = () => {
        let json = {};
        try { json = JSON.parse(xhr.responseText); } catch { /* respuesta vacía */ }
        if (xhr.status >= 200 && xhr.status < 300) listo(json);
        else fallo(new Error(json.error ? (json.error.message || json.error) : 'No se pudo subir.'));
      };
      xhr.onerror = () => fallo(new Error('Se cortó la conexión mientras se subía.'));
      xhr.send(formulario);
    });
  }

  function filaDeSubida(contenedor, nombre) {
    const estado = crear('span', { text: 'Preparando…' });
    const barra = crear('i');
    const fila = crear('div', { class: 'subida' }, [crear('b', { text: nombre }), estado, crear('div', { class: 'subida-riel' }, [barra])]);
    contenedor.prepend(fila);
    return {
      paso(texto, fraccion) {
        estado.textContent = texto;
        if (fraccion != null) barra.style.width = Math.round(fraccion * 100) + '%';
      },
      listo(texto) { fila.classList.add('lista'); estado.textContent = texto; barra.style.width = '100%'; setTimeout(() => fila.remove(), 8000); },
      error(texto) { fila.classList.add('error'); estado.textContent = texto; }
    };
  }

  async function subirUno(original, tipo, contenedor) {
    const ui = filaDeSubida(contenedor, original.name);
    try {
      let archivo = original;
      if (tipo === 'video') {
        ui.paso('Achicando el video a 720p… 0 %', 0);
        const r = await comprimirVideo(original, (p) => ui.paso(`Achicando el video a 720p… ${Math.round(p * 100)} %`, p));
        archivo = r.archivo;
        if (r.comprimido) ui.paso(`Achicado: de ${fmtMb(r.antes)} a ${fmtMb(archivo.size)}`, 0);
      }
      if (archivo.size > datos.limites[tipo]) {
        throw new Error(`Pesa ${fmtMb(archivo.size)} y el máximo es ${fmtMb(datos.limites[tipo])}.` + (tipo === 'video' ? ' Para videos largos usá un enlace de YouTube.' : ''));
      }
      const duracion = await leerDuracion(archivo, tipo);
      const firma = await pedir('/api/multimedia/firma', { tipo, nombre: archivo.name, bytes: archivo.size });
      const avance = (f) => ui.paso(`Subiendo… ${Math.round(f * 100)} %`, f);
      if (firma.modo === 'nube') {
        const formulario = new FormData();
        for (const [k, v] of Object.entries(firma.campos)) formulario.append(k, v);
        formulario.append('file', archivo);
        const subido = await enviarConProgreso(firma.url, formulario, {}, avance);
        ui.paso('Guardando…', 1);
        datos = await pedir('/api/multimedia/registrar', { public_id: subido.public_id || firma.campos.public_id });
      } else {
        const formulario = new FormData();
        formulario.append('tipo', tipo);
        formulario.append('duracion', String(duracion));
        formulario.append('archivo', archivo);
        datos = await enviarConProgreso(firma.url, formulario, { 'x-pin': auth.pin }, avance);
      }
      pintarTodo();
      ui.listo('✅ Listo: ya está en tu lista');
    } catch (err) {
      ui.error('❌ ' + err.message);
    }
  }

  // De a 2 a la vez desde el mismo celular: rápido sin trabar la conexión.
  async function subirVarios(archivos, tipo, contenedor) {
    const fila = [...archivos];
    const trabajador = async () => { while (fila.length) await subirUno(fila.shift(), tipo, contenedor); };
    await Promise.all([trabajador(), trabajador()]);
    cargar();
  }

  if (haySubida) {
    $('subirMusicaBtn').addEventListener('click', () => $('archivoMusica').click());
    $('subirVideoBtn').addEventListener('click', () => $('archivoVideo').click());
    $('archivoMusica').addEventListener('change', (e) => { subirVarios(e.target.files, 'musica', $('subidasMusica')); e.target.value = ''; });
    $('archivoVideo').addEventListener('change', (e) => { subirVarios(e.target.files, 'video', $('subidasVideo')); e.target.value = ''; });
  }

  // ---------- YouTube ----------
  function aSegundos(texto) {
    const t = String(texto || '').trim();
    if (!t) return '';
    if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN;
    return t.split(':').reduce((s, p) => s * 60 + Number(p), 0);
  }
  if (haySubida) $('formYoutube').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inicio = aSegundos($('inicioYoutube').value);
    const fin = aSegundos($('finYoutube').value);
    if (Number.isNaN(inicio) || Number.isNaN(fin)) return avisar('Escribí el tiempo así: 1:10 (minutos:segundos).');
    const boton = $('guardarYoutube');
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      datos = await pedir('/api/multimedia/youtube', { url: $('enlaceYoutube').value, inicio, fin });
      $('formYoutube').reset();
      pintarTodo();
      avisar('✅ Enlace guardado. Ya lo podés mandar a tu pantalla desde el Control.', true);
    } catch (err) {
      avisar(err.message);
    } finally {
      boton.disabled = false;
      boton.textContent = 'Guardar';
    }
  });

  // ---------- arranque ----------
  ensureAuthed().then((a) => {
    auth = a;
    $('authNameBadge').hidden = false;
    $('authNameBadge').textContent = authBadgeText(a);
    $('logoutBtn').hidden = false;
    $('logoutBtn').addEventListener('click', () => logoutAuth());
    const identificar = () => socket.emit('identificar', a.pin);
    if (socket.connected) identificar();
    socket.on('connect', identificar);
    socket.on('multimediaActualizada', cargar);
    cargar();
  });
})();
