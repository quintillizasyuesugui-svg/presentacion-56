// Subidas que siguen aunque cambies de pantalla, y la barra de arriba que muestra el avance.
//
// Las páginas que suben (Gestionar, Subir música y videos) llaman SubidasFondo.encolar(...) y el
// ayudante (ayudante-subidas.js) sube de a 3. Todas las pantallas que cargan este archivo
// (también el Control) muestran la barra «⬆️ Subiendo N archivos · 12 de 32 · 45 %».
// Si el navegador no tiene ayudante, sube la propia página y avisa antes de salir.
//
// Avisos:
//  - Si un video se está achicando (eso sólo lo puede hacer la página abierta), al tocar un
//    enlace para salir pregunta «¿Esperar o salir igual?».
//  - Al llegar a otra pantalla con subidas en curso: «Tus archivos se siguen subiendo».
//  - Si el celular cerró la página mientras se elegían los archivos (le faltó memoria), lo dice
//    al volver, para que no parezca que «no cargó nada».
(function () {
  const PREGUNTA_CADA_MS = 20000;
  const CLAVE_ELIGIENDO = 'conexiones-eligiendo-archivos';
  const CLAVE_SALIO = 'conexiones-salio-subiendo';

  const conAyudante = 'serviceWorker' in navigator && window.isSecureContext;
  let trabajos = [];
  const escuchas = [];
  const alTerminar = [];
  const achicando = new Map(); // nombre → % de los videos que la página está achicando

  // ---------- barra de arriba ----------
  const barra = document.createElement('div');
  barra.className = 'barra-subidas';
  barra.hidden = true;
  barra.setAttribute('role', 'status');
  barra.innerHTML = '<div class="barra-subidas-texto"><span class="bs-que"></span><span class="bs-cuanto"></span></div><div class="barra-subidas-riel"><i></i></div>';
  let ocultar = null;

  function ponerBarra() {
    if (!barra.isConnected) (document.querySelector('.app') || document.body).prepend(barra);
  }

  // «✅ Se subieron 12 imágenes a 🖼️ Imágenes»: dice dónde quedó lo que se subió.
  const DONDE = {
    imagen: ['imagen', 'imágenes', '🖼️ Imágenes'],
    musica: ['canción', 'canciones', '🎵 Música'],
    video: ['video', 'videos', '🎬 Videos']
  };
  let avisoFinalDado = false;
  function textoListo(listos) {
    const tipos = [...new Set(trabajos.filter(t => t.estado === 'listo').map(t => t.tipo))];
    if (tipos.length === 1 && DONDE[tipos[0]]) {
      const [uno, varios, lugar] = DONDE[tipos[0]];
      return listos === 1 ? `✅ Se subió 1 ${uno} a ${lugar}` : `✅ Se subieron ${listos} ${varios} a ${lugar}`;
    }
    return listos === 1 ? '✅ Se subió 1 archivo' : `✅ Se subieron ${listos} archivos`;
  }

  function pintarBarra() {
    ponerBarra();
    const activos = trabajos.filter(t => t.estado === 'espera' || t.estado === 'subiendo');
    const listos = trabajos.filter(t => t.estado === 'listo').length;
    const errores = trabajos.filter(t => t.estado === 'error').length;
    const nAchicando = achicando.size;
    const que = barra.querySelector('.bs-que');
    const cuanto = barra.querySelector('.bs-cuanto');
    const relleno = barra.querySelector('i');
    barra.classList.remove('lista', 'con-error');
    if (activos.length || nAchicando) {
      avisoFinalDado = false;
      clearTimeout(ocultar);
      ocultar = null;
      const total = trabajos.length;
      const suma = trabajos.reduce((s, t) => s + (t.estado === 'subiendo' ? (t.avance || 0) : t.estado === 'espera' ? 0 : 1), 0);
      const pct = total ? Math.round((suma / total) * 100) : 0;
      const faltan = activos.length + nAchicando;
      que.textContent = `⬆️ Subiendo ${faltan} ${faltan === 1 ? 'archivo' : 'archivos'}`;
      cuanto.textContent = total ? `${listos} de ${total} · ${pct} %` : 'Preparando…';
      relleno.style.width = pct + '%';
      barra.hidden = false;
      return;
    }
    if (!trabajos.length) { barra.hidden = true; return; }
    // Terminó todo: se ve unos segundos y se va.
    if (errores) {
      barra.classList.add('con-error');
      que.textContent = `⚠️ ${errores} no se ${errores === 1 ? 'pudo' : 'pudieron'} subir`;
      cuanto.textContent = listos ? `${listos} ${listos === 1 ? 'lista' : 'listas'}` : '';
    } else {
      barra.classList.add('lista');
      que.textContent = textoListo(listos);
      cuanto.textContent = '';
      if (!avisoFinalDado) { avisoFinalDado = true; avisoCorto(textoListo(listos)); }
    }
    relleno.style.width = '100%';
    barra.hidden = false;
    if (!ocultar) {
      ocultar = setTimeout(() => {
        barra.hidden = true;
        trabajos = [];
        enviar({ tipo: 'olvidar' });
        avisarEscuchas();
      }, errores ? 9000 : 4000);
    }
  }

  function avisarEscuchas() {
    for (const f of escuchas) { try { f(trabajos); } catch (err) { console.error(err); } }
  }

  function recibir(estado) {
    trabajos = estado.trabajos || [];
    pintarBarra();
    avisarEscuchas();
  }

  // ---------- con ayudante ----------
  let listo = null;
  function ayudante() {
    if (!listo) {
      listo = navigator.serviceWorker.register('/ayudante-subidas.js')
        .then(() => navigator.serviceWorker.ready)
        .then((r) => r.active);
    }
    return listo;
  }
  function enviar(mensaje) {
    if (!conAyudante) return;
    ayudante().then((a) => a && a.postMessage(mensaje)).catch(() => {});
  }

  if (conAyudante) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.tipo === 'estado') recibir(m);
      else if (m.tipo === 'termino') for (const f of alTerminar) f(m);
    });
    enviar({ tipo: 'estado' });
    // Mientras haya algo subiendo, pregunta cada tanto: así el ayudante no se duerme.
    setInterval(() => {
      if (trabajos.some(t => t.estado === 'espera' || t.estado === 'subiendo')) enviar({ tipo: 'estado' });
    }, PREGUNTA_CADA_MS);
  }

  // ---------- sin ayudante: sube la página ----------
  let siguienteId = 1;
  let corriendo = 0;
  function subirEnLaPagina() {
    while (corriendo < SubirNube.A_LA_VEZ) {
      const t = trabajos.find(x => x.estado === 'espera');
      if (!t) return;
      t.estado = 'subiendo';
      corriendo++;
      SubirNube.subir(t, t.pin, (f) => { t.avance = f; recibir({ trabajos }); })
        .then(() => { t.estado = 'listo'; t.avance = 1; }, (err) => { t.estado = 'error'; t.error = err.message || 'No se pudo subir.'; })
        .finally(() => {
          corriendo--;
          t.archivo = null;
          recibir({ trabajos });
          for (const f of alTerminar) f({ tipo: 'termino', id: t.id, trabajo: t.tipo, estado: t.estado });
          subirEnLaPagina();
        });
    }
  }

  // ---------- salir de la pantalla ----------
  function hayPendientes() {
    return trabajos.some(t => t.estado === 'espera' || t.estado === 'subiendo');
  }

  function preguntarSalir(titulo, texto) {
    return new Promise((resolver) => {
      const velo = document.createElement('div');
      velo.className = 'modal-overlay';
      velo.innerHTML = `<div class="modal-card" role="alertdialog" aria-modal="true"><h2></h2><p></p><div class="btn-row"><button type="button" class="btn primary" data-r="esperar">Esperar</button><button type="button" class="btn" data-r="salir">Salir igual</button></div></div>`;
      velo.querySelector('h2').textContent = titulo;
      velo.querySelector('p').textContent = texto;
      document.body.append(velo);
      requestAnimationFrame(() => velo.classList.add('show'));
      velo.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        velo.classList.remove('show');
        setTimeout(() => velo.remove(), 200);
        resolver(b.dataset.r === 'salir');
      });
      velo.querySelector('[data-r="esperar"]').focus();
    });
  }

  // Al tocar un enlace a otra pantalla.
  document.addEventListener('click', async (e) => {
    const enlace = e.target.closest('a[href]');
    if (!enlace || e.defaultPrevented || enlace.target === '_blank' || e.ctrlKey || e.metaKey) return;
    const destino = new URL(enlace.href, location.href);
    if (destino.origin !== location.origin || (destino.pathname === location.pathname && destino.hash)) return;
    const pendientesSinAyudante = !conAyudante && hayPendientes();
    if (!achicando.size && !pendientesSinAyudante) {
      if (hayPendientes()) sessionStorage.setItem(CLAVE_SALIO, '1');
      return;
    }
    e.preventDefault();
    let salir;
    if (achicando.size) {
      const [nombre, pct] = [...achicando.entries()][0];
      salir = await preguntarSalir('🎬 Un video se está achicando',
        `«${nombre}» va en ${pct} %. Si salís ahora, ese video se cancela. Lo demás se sigue subiendo.`);
    } else {
      const faltan = trabajos.filter(t => t.estado === 'espera' || t.estado === 'subiendo').length;
      salir = await preguntarSalir('⬆️ Todavía se está subiendo',
        `Faltan ${faltan} ${faltan === 1 ? 'archivo' : 'archivos'}. En este celular la subida no sigue en otra pantalla: si salís, se cortan.`);
    }
    if (!salir) return;
    achicando.clear();
    if (hayPendientes()) sessionStorage.setItem(CLAVE_SALIO, '1');
    location.href = enlace.href;
  });

  // Atrás del celular, cerrar la pestaña o recargar: el navegador sólo deja su cartel propio.
  window.addEventListener('beforeunload', (e) => {
    if (achicando.size || (!conAyudante && hayPendientes())) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- avisos al llegar ----------
  function avisoCorto(texto) {
    const t = document.createElement('div');
    t.className = 'toast ok aviso-subidas';
    t.setAttribute('role', 'status');
    t.textContent = texto;
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 4200);
  }

  if (sessionStorage.getItem(CLAVE_SALIO)) {
    sessionStorage.removeItem(CLAVE_SALIO);
    setTimeout(() => { if (hayPendientes()) avisoCorto('⬆️ Tus archivos se siguen subiendo. Mirá la barra de arriba.'); }, 600);
  }

  const eligiendoDesde = Number(sessionStorage.getItem(CLAVE_ELIGIENDO)) || 0;
  sessionStorage.removeItem(CLAVE_ELIGIENDO);
  if (eligiendoDesde && Date.now() - eligiendoDesde < 5 * 60000) {
    setTimeout(() => avisoCorto('📱 El celular cerró la página mientras elegías (le faltó memoria). Volvé a elegir los archivos; si pasa seguido, cerrá otras apps.'), 600);
  }

  // ---------- la «i» de los límites ----------
  // <button data-info="idDeUnTemplate">: abre una hoja abajo con lo que diga ese <template>.
  // Un <li data-copiar="id"> se llena con el texto de ese elemento (p. ej. la explicación del espacio).
  document.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-info]');
    const plantilla = boton && document.getElementById(boton.dataset.info);
    if (!plantilla) return;
    const velo = document.createElement('div');
    velo.className = 'modal-overlay hoja-limites';
    const hoja = document.createElement('div');
    hoja.className = 'modal-card';
    hoja.setAttribute('role', 'dialog');
    hoja.setAttribute('aria-modal', 'true');
    hoja.append(plantilla.content.cloneNode(true));
    for (const li of hoja.querySelectorAll('[data-copiar]')) {
      const origen = document.getElementById(li.dataset.copiar);
      li.textContent = origen ? origen.textContent : '';
    }
    const entendido = document.createElement('button');
    entendido.type = 'button';
    entendido.className = 'btn primary';
    entendido.textContent = 'Entendido';
    hoja.append(entendido);
    velo.append(hoja);
    document.body.append(velo);
    requestAnimationFrame(() => velo.classList.add('show'));
    entendido.focus();
    const cerrar = () => { velo.classList.remove('show'); setTimeout(() => velo.remove(), 200); boton.focus(); };
    entendido.addEventListener('click', cerrar);
    velo.addEventListener('click', (ev) => { if (ev.target === velo) cerrar(); });
    velo.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrar(); });
  });

  // ---------- lo que usan las páginas ----------
  window.SubidasFondo = {
    conAyudante,
    // trabajos: [{ tipo: 'imagen'|'musica'|'video', nombre, archivo, duracion? }]
    encolar(lista) {
      const auth = window.getAuth && getAuth();
      if (!auth || !lista.length) return;
      clearTimeout(ocultar);
      ocultar = null;
      if (conAyudante) {
        // Mientras el ayudante contesta, la barra ya muestra que empezó.
        if (!hayPendientes()) trabajos = [];
        trabajos = trabajos.concat(lista.map(t => ({ id: 'nuevo' + siguienteId++, tipo: t.tipo, nombre: t.nombre, estado: 'espera', avance: 0 })));
        pintarBarra();
        avisarEscuchas();
        enviar({ tipo: 'encolar', pin: auth.pin, trabajos: lista });
      } else {
        if (!hayPendientes()) trabajos = [];
        for (const t of lista) trabajos.push(Object.assign({ id: siguienteId++, estado: 'espera', avance: 0, error: '', pin: auth.pin }, t));
        recibir({ trabajos });
        subirEnLaPagina();
      }
    },
    escuchar(f) { escuchas.push(f); f(trabajos); },
    alTerminar(f) { alTerminar.push(f); },
    // La página avisa el % de un video que está achicando (null = terminó o falló).
    achicando(nombre, pct) {
      if (pct == null) achicando.delete(nombre); else achicando.set(nombre, pct);
      pintarBarra();
    },
    // Abrir el selector de archivos recordando que se está eligiendo.
    elegir(input) {
      sessionStorage.setItem(CLAVE_ELIGIENDO, String(Date.now()));
      const limpiar = () => sessionStorage.removeItem(CLAVE_ELIGIENDO);
      input.addEventListener('change', limpiar, { once: true });
      input.addEventListener('cancel', limpiar, { once: true });
      // Algunos celulares no avisan si se canceló: al volver a la página, se borra igual.
      const alVolver = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', alVolver);
        setTimeout(limpiar, 4000);
      };
      document.addEventListener('visibilitychange', alVolver);
      input.click();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintarBarra);
  else pintarBarra();
})();
