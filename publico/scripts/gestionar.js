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

  let images = [];

  const imageList = document.getElementById('imageList');
  const emptyHint = document.getElementById('emptyHint');
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');

  async function loadImages() {
    try {
      const res = await authFetch('/api/images');
      const nuevas = await res.json(); // sólo las imágenes de esta persona (o todas, si es admin)
      // En medio de un borrado no se rearma la lista (el servidor avisa «cambiaron las imágenes»
      // justo ahí y cortaría la animación): al terminar, el propio borrado deja la lista al día.
      if (borrando) return;
      images = nuevas;
      render();
    } catch (err) {
      console.error('Error loading images:', err);
    }
  }

  // ---- Elegir varias imágenes y eliminarlas juntas ----
  // «☑️ Seleccionar» pone una casilla en cada fila; abajo queda la barra con «Eliminar N» y
  // «Cancelar». Mientras se elige no se arrastra ni se reordena: tocar una fila la marca.
  let eligiendo = false;
  let borrando = false;
  const elegidas = new Set();
  const barraElegir = document.getElementById('barraElegir');
  const elegirBtn = document.getElementById('elegirBtn');
  const marcarTodasBtn = document.getElementById('marcarTodasBtn');
  const barraEliminar = document.getElementById('barraEliminar');
  const eliminarElegidasBtn = document.getElementById('eliminarElegidasBtn');
  const cancelarElegirBtn = document.getElementById('cancelarElegirBtn');
  const eliminarTexto = document.getElementById('eliminarTexto');

  // ---- Animación al eliminar: la hoja, el bollo y el tacho ----
  // El tacho abre la tapa; de cada imagen elegida sale primero la hoja (un cuadradito con la
  // foto), después se arruga en un bollo de papel y el bollo vuela al tacho, una detrás de
  // otra. Al final la tapa se cierra y el tacho da un saltito. Con «reducir movimiento» en el
  // celular no hay vuelos: las imágenes sólo se desvanecen.
  const CURVA_SALIDA = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const CURVA_MOVER = 'cubic-bezier(0.77, 0, 0.175, 1)';
  const BOLLO_SVG = '<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M11 1.6l4 1.3 3.6 2.6 1.6 4.2-.7 4.4-2.4 3.7-4 2.2-4.5.2-3.9-2-2.5-3.6-.6-4.6 1.7-4.1 3.5-2.9z" fill="#f4f1e8"/><path d="M6.5 6.5l4 3 4.5-3.5M4.5 12l5.5-1 4 3.5 4.5-2M8 17l2.5-4.5M15 16.5l-1.2-2.2" fill="none" stroke="#b9b3a1" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const MAXIMO_DE_VUELOS = 12; // con más elegidas, vuelan las primeras que se ven; el resto se va sin vuelo

  function centroDe(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function moverTapa(abrir) {
    const tapa = eliminarElegidasBtn.querySelector('.tacho-tapa');
    return tapa.animate(
      { transform: abrir ? ['rotate(0deg)', 'rotate(-38deg)'] : ['rotate(-38deg)', 'rotate(0deg)'] },
      { duration: abrir ? 180 : 160, easing: CURVA_SALIDA, fill: 'forwards' }
    ).finished;
  }

  // Una imagen: sale la hoja, se arruga en bollo y el bollo cae en el tacho.
  function tirarAlTacho(fila, boca, demora) {
    const mini = fila.querySelector('.thumb');
    const desde = centroDe(mini);
    const pieza = document.createElement('div');
    pieza.className = 'papel-volando';
    pieza.innerHTML = `<span class="papel-sube"><span class="papel-hoja"></span><span class="papel-bollo">${BOLLO_SVG}</span></span>`;
    pieza.querySelector('.papel-hoja').style.backgroundImage = `url("${mini.currentSrc || mini.src}")`;
    document.body.append(pieza);
    const base = `translate(${desde.x - 17}px, ${desde.y - 17}px)`;
    const HOJA = 150;   // la hoja aparece
    const ARRUGA = 170; // la hoja se hace bollo
    const VUELO = 420;  // el bollo va al tacho
    const total = HOJA + ARRUGA + VUELO;
    const enVuelo = (HOJA + ARRUGA) / total;

    fila.animate({ transform: ['scale(1)', 'scale(0.94)'], opacity: [1, 0] }, { duration: 160, delay: demora, easing: CURVA_SALIDA, fill: 'forwards' });
    // De costado: quieta mientras es hoja y bollo; después va pareja hasta el tacho.
    const costado = pieza.animate(
      { transform: [`${base} translateX(0px)`, `${base} translateX(0px)`, `${base} translateX(${boca.x - desde.x}px)`], offset: [0, enVuelo, 1] },
      { duration: total, delay: demora, easing: 'linear', fill: 'both' });
    // De arriba-abajo: sube un poco al salir y después cae, así dibuja un arco.
    pieza.querySelector('.papel-sube').animate(
      { transform: ['translateY(0px)', 'translateY(0px)', 'translateY(-36px)', `translateY(${boca.y - desde.y}px)`], offset: [0, enVuelo, enVuelo + (1 - enVuelo) * 0.38, 1], easing: ['linear', CURVA_SALIDA, CURVA_MOVER] },
      { duration: total, delay: demora, fill: 'both' });
    // La hoja: aparece como un cuadradito con la foto y se arruga.
    pieza.querySelector('.papel-hoja').animate(
      { transform: ['scale(0.8) rotate(0deg)', 'scale(1) rotate(0deg)', 'scale(0.45) rotate(24deg)'], opacity: [0, 1, 0], offset: [0, HOJA / (HOJA + ARRUGA), 1], easing: [CURVA_SALIDA, CURVA_MOVER] },
      { duration: HOJA + ARRUGA, delay: demora, fill: 'both' });
    // El bollo: aparece mientras la hoja se arruga y gira al volar.
    pieza.querySelector('.papel-bollo').animate(
      { transform: ['scale(0.9) rotate(0deg)', 'scale(0.9) rotate(0deg)', 'scale(1) rotate(0deg)', 'scale(0.78) rotate(300deg)'], opacity: [0, 0, 1, 1], offset: [0, HOJA / total, enVuelo, 1] },
      { duration: total, delay: demora, easing: 'linear', fill: 'both' });
    return costado.finished.then(() => pieza.remove());
  }

  async function animarEliminacion() {
    const filas = [...imageList.querySelectorAll('.image-row.elegida')];
    if (!filas.length || typeof filas[0].animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await Promise.all(filas.map(f => f.animate({ opacity: [1, 0] }, { duration: 200, easing: 'ease', fill: 'forwards' }).finished));
      return;
    }
    const tacho = eliminarElegidasBtn.querySelector('.tacho').getBoundingClientRect();
    const boca = { x: tacho.left + tacho.width / 2, y: tacho.top + tacho.height * 0.35 };
    const alto = window.innerHeight;
    const aLaVista = filas.filter(f => { const r = f.getBoundingClientRect(); return r.bottom > 0 && r.top < alto; }).slice(0, MAXIMO_DE_VUELOS);
    filas.filter(f => !aLaVista.includes(f)).forEach(f => { f.style.opacity = '0'; });
    moverTapa(true);
    // Una detrás de otra; de la sexta en adelante salen juntas, para que no se haga largo.
    await Promise.all(aLaVista.map((f, i) => tirarAlTacho(f, boca, Math.min(i, 5) * 70)));
    moverTapa(false);
    await eliminarElegidasBtn.querySelector('.tacho-cuerpo').animate({ transform: ['scaleY(1)', 'scaleY(0.9)', 'scaleY(1)'] }, { duration: 200, easing: CURVA_SALIDA }).finished;
  }

  // Las filas que quedan suben a ocupar el lugar de las eliminadas (se mide antes y después de
  // rearmar la lista, y cada una recorre la diferencia).
  function posicionesDeFilas() {
    return new Map([...imageList.children].map(f => [f.dataset.id, f.getBoundingClientRect().top]));
  }
  function subirFilas(antes) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const fila of imageList.children) {
      const corrida = antes.has(fila.dataset.id) ? antes.get(fila.dataset.id) - fila.getBoundingClientRect().top : 0;
      if (corrida && typeof fila.animate === 'function') {
        fila.animate({ transform: [`translateY(${corrida}px)`, 'translateY(0px)'] }, { duration: 220, easing: CURVA_SALIDA });
      }
    }
  }

  function pintarBarrasDeElegir() {
    // Lo que ya no está en la lista (se borró desde otro celular) deja de estar elegido.
    for (const id of [...elegidas]) if (!images.some(img => img.id === id)) elegidas.delete(id);
    if (!images.length) eligiendo = false;
    barraElegir.hidden = images.length === 0;
    elegirBtn.textContent = eligiendo ? '☑️ Seleccionando' : '☑️ Seleccionar';
    elegirBtn.classList.toggle('activo', eligiendo);
    elegirBtn.setAttribute('aria-pressed', String(eligiendo));
    marcarTodasBtn.hidden = !eligiendo;
    marcarTodasBtn.textContent = elegidas.size === images.length ? 'Desmarcar todas' : 'Marcar todas';
    barraEliminar.hidden = !eligiendo;
    eliminarElegidasBtn.disabled = elegidas.size === 0;
    eliminarTexto.textContent = elegidas.size ? `Eliminar ${elegidas.size}` : 'Eliminar';
    document.body.classList.toggle('eligiendo-imagenes', eligiendo);
  }

  function alternarElegida(id) {
    if (elegidas.has(id)) elegidas.delete(id); else elegidas.add(id);
    render();
  }

  function salirDeElegir() {
    eligiendo = false;
    elegidas.clear();
    render();
  }

  elegirBtn.addEventListener('click', () => {
    if (eligiendo) return salirDeElegir();
    eligiendo = true;
    render();
  });
  marcarTodasBtn.addEventListener('click', () => {
    const todas = elegidas.size === images.length;
    elegidas.clear();
    if (!todas) images.forEach(img => elegidas.add(img.id));
    render();
  });
  cancelarElegirBtn.addEventListener('click', salirDeElegir);
  eliminarElegidasBtn.addEventListener('click', async () => {
    const cuantas = elegidas.size;
    if (!cuantas) return;
    const ok = await askConfirm(cuantas === 1
      ? '¿Eliminar 1 imagen? Esta acción no se puede deshacer.'
      : `¿Eliminar ${cuantas} imágenes? Esta acción no se puede deshacer.`);
    if (!ok || borrando) return;
    // No se apaga el botón (se vería gris justo cuando el tacho abre la tapa): mientras se
    // borra, la barra entera deja de recibir toques.
    borrando = true;
    barraEliminar.classList.add('ocupada');
    try {
      const res = await authFetch('/api/images/borrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...elegidas] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron eliminar las imágenes. Probá de nuevo.');
      // Ya se borraron: recién ahora van al tacho (si fallaba, no se animaba nada).
      // Si por lo que sea la animación no termina (pestaña en segundo plano), no se espera más de 3 s.
      await Promise.race([animarEliminacion(), new Promise(listo => setTimeout(listo, 3000))]).catch(() => {});
      document.querySelectorAll('.papel-volando').forEach(p => p.remove());
      const antes = posicionesDeFilas();
      images = data.imagenes;
      salirDeElegir();
      subirFilas(antes);
      showToast(data.borradas === 1 ? '🗑️ Se eliminó 1 imagen.' : `🗑️ Se eliminaron ${data.borradas} imágenes.`);
    } catch (err) {
      showToast(err.message);
      pintarBarrasDeElegir();
    } finally {
      borrando = false;
      barraEliminar.classList.remove('ocupada');
    }
  });

  function render() {
    imageList.innerHTML = '';
    emptyHint.hidden = images.length > 0;
    pintarBarrasDeElegir();

    images.forEach(({ id, src }, i) => {
      const row = document.createElement('div');
      row.className = 'image-row';
      row.dataset.id = id;
      row.innerHTML = `
        <span class="order-badge">${i + 1}</span>
        <img class="thumb" src="${src}" alt="">
        <span class="filename-label">${id.split('/').pop()}</span>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir de posición">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button type="button" class="icon-btn" data-action="down" ${i === images.length - 1 ? 'disabled' : ''} aria-label="Bajar de posición">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button type="button" class="icon-btn danger" data-action="delete" aria-label="Eliminar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      `;
      if (eligiendo) {
        // La fila entera es la casilla: sin flechas, sin tacho y sin arrastrar.
        const marcada = elegidas.has(id);
        row.classList.add('elegible');
        row.classList.toggle('elegida', marcada);
        row.querySelector('.row-actions').style.display = 'none';
        const casilla = document.createElement('span');
        casilla.className = 'fila-casilla';
        casilla.textContent = '✓';
        casilla.setAttribute('aria-hidden', 'true');
        row.prepend(casilla);
        row.tabIndex = 0;
        row.setAttribute('role', 'checkbox');
        row.setAttribute('aria-checked', String(marcada));
        row.setAttribute('aria-label', `Imagen ${i + 1}`);
        row.addEventListener('click', () => alternarElegida(id));
        row.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); alternarElegida(id); }
        });
        imageList.appendChild(row);
        return;
      }
      row.querySelector('[data-action="up"]').addEventListener('click', () => move(i, -1));
      row.querySelector('[data-action="down"]').addEventListener('click', () => move(i, 1));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => remove(id));
      // Toda la fila se puede arrastrar para reordenar de un tirón, PERO las
      // flechas ▲▼ siguen ahí como respaldo — por si el arrastre no anda bien
      // en algún celular (mismo criterio que los botones del editor).
      row.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.icon-btn')) return;
        startDrag(e, row);
      });
      imageList.appendChild(row);
    });
  }

  // ---- Arrastrar con el dedo (o el mouse) para reordenar ----
  // Se agarra de cualquier parte de la fila, no de un agarradero chiquito.
  function startDrag(e, row) {
    e.preventDefault();
    const handle = e.currentTarget;
    let startY = e.clientY;

    row.classList.add('dragging');
    document.body.classList.add('dragging-active');
    handle.setPointerCapture(e.pointerId);

    function onMove(ev) {
      const dy = ev.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;

      const rowRect = row.getBoundingClientRect();
      const rowCenter = rowRect.top + rowRect.height / 2;
      const siblings = Array.from(imageList.children).filter(r => r !== row);

      for (const sib of siblings) {
        const sibRect = sib.getBoundingClientRect();
        const sibCenter = sibRect.top + sibRect.height / 2;
        const rows = Array.from(imageList.children);
        const rowIndex = rows.indexOf(row);
        const sibIndex = rows.indexOf(sib);

        if (rowIndex < sibIndex && rowCenter > sibCenter) {
          imageList.insertBefore(sib, row);
          startY += sibRect.height;
          row.style.transform = `translateY(${ev.clientY - startY}px)`;
        } else if (rowIndex > sibIndex && rowCenter < sibCenter) {
          imageList.insertBefore(row, sib);
          startY -= sibRect.height;
          row.style.transform = `translateY(${ev.clientY - startY}px)`;
        }
      }
    }

    function onUp(ev) {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      row.classList.remove('dragging');
      document.body.classList.remove('dragging-active');
      row.style.transform = '';

      // El DOM ya quedó en el orden final — reconstruimos el array a partir de él
      const byId = new Map(images.map(img => [img.id, img]));
      images = Array.from(imageList.children).map(r => byId.get(r.dataset.id));
      render();
      saveOrder();
    }

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  async function saveOrder() {
    try {
      await authFetch('/api/images/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: images.map(r => r.id) })
      });
    } catch (err) {
      console.error('No se pudo guardar el orden:', err);
    }
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    [images[index], images[target]] = [images[target], images[index]];
    render();
    saveOrder();
  }

  // ---- Confirmación propia (en vez del cartel nativo del navegador) ----
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmCancel = document.getElementById('confirmCancel');
  const confirmAccept = document.getElementById('confirmAccept');

  function askConfirm(message) {
    return new Promise(resolve => {
      confirmMessage.textContent = message;
      confirmOverlay.hidden = false;
      requestAnimationFrame(() => confirmOverlay.classList.add('show'));

      function cleanup(result) {
        confirmOverlay.classList.remove('show');
        setTimeout(() => { confirmOverlay.hidden = true; }, 200);
        confirmAccept.removeEventListener('click', onAccept);
        confirmCancel.removeEventListener('click', onCancel);
        resolve(result);
      }
      const onAccept = () => cleanup(true);
      const onCancel = () => cleanup(false);
      confirmAccept.addEventListener('click', onAccept);
      confirmCancel.addEventListener('click', onCancel);
    });
  }

  // ---- Aviso propio (en vez de alert() del navegador) ----
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

  async function remove(id) {
    const ok = await askConfirm('¿Eliminar esta imagen? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      const res = await authFetch('/api/images/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la imagen. Probá de nuevo.');
      images = data;
      render();
    } catch (err) {
      showToast(err.message);
    }
  }

  uploadBtn.addEventListener('click', () => fileInput.click());

  // Las fotos de cámara pesan varios MB: subían lento con datos del celular y la pantalla
  // tardaba en mostrarlas. Antes de subir, se achican a 1920 px del lado más largo (de sobra para
  // un proyector o una tele) y se comprimen. Si no se puede (formato que el navegador no abre,
  // como HEIC) o no ahorra nada, se sube la original.
  const LADO_MAXIMO = 1920;

  async function abrirImagen(archivo) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); } catch { /* sigue abajo */ }
    }
    const url = URL.createObjectURL(archivo);
    try {
      const imagen = new Image();
      imagen.src = url;
      await imagen.decode();
      return imagen;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function achicarFoto(archivo) {
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) return archivo;
    let imagen;
    try { imagen = await abrirImagen(archivo); } catch { return archivo; }
    const ancho = imagen.width;
    const alto = imagen.height;
    const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
    if (escala === 1 && archivo.size < 1.5 * 1024 * 1024) return archivo; // ya es liviana
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(ancho * escala);
    lienzo.height = Math.round(alto * escala);
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    if (imagen.close) imagen.close();
    // PNG puede tener partes transparentes: va a WebP, que las conserva. Las fotos, a JPEG.
    const tipo = archivo.type === 'image/png' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise(r => lienzo.toBlob(r, tipo, tipo === 'image/jpeg' ? 0.85 : 0.9));
    if (!blob || blob.size >= archivo.size) return archivo;
    const nombre = archivo.name.replace(/\.[^.]+$/, '') + (tipo === 'image/jpeg' ? '.jpg' : '.webp');
    return new File([blob], nombre, { type: tipo, lastModified: archivo.lastModified });
  }

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    const elegidas = Array.from(fileInput.files);
    const formData = new FormData();

    uploadBtn.disabled = true;
    uploadBtn.textContent = '⏳ Preparando fotos…';
    try {
      for (let i = 0; i < elegidas.length; i++) {
        if (elegidas.length > 1) uploadBtn.textContent = `⏳ Preparando fotos… ${i + 1}/${elegidas.length}`;
        formData.append('images', await achicarFoto(elegidas[i]));
      }
      uploadBtn.textContent = '⏳ Subiendo…';
      const res = await authFetch('/api/images/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron subir las imágenes. Probá de nuevo.');
      images = data;
      render();
    } catch (err) {
      showToast(err.message);
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '➕ Subir imágenes';
      fileInput.value = '';
    }
  });

  // Si alguien más sube/borra/reordena desde otro dispositivo, esta vista se actualiza sola
  socket.on('imagenesActualizadas', loadImages);

  // Primero identificar quién es (pide PIN o registra) — recién ahí carga sus imágenes.
  ensureAuthed().then((auth) => {
    authNameBadge.hidden = false;
    authNameBadge.textContent = authBadgeText(auth);
    logoutBtn.hidden = false;
    logoutBtn.addEventListener('click', async () => {
      const ok = await askConfirm('¿Salir y entrar como otra persona en este celular?');
      if (ok) logoutAuth();
    });
    loadImages();
    // El aviso de fotos nuevas le llega sólo a la sala de cada persona: este socket se suma a la suya.
    const identificarSocket = () => socket.emit('identificar', auth.pin);
    if (socket.connected) identificarSocket();
    socket.on('connect', identificarSocket);
  });
