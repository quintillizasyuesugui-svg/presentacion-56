// «Personas» (Modo avanzado, sólo admin): lista de cuentas para marcar y borrar varias juntas.
// Borrar quita las cuentas y todo lo suyo (diapositivas, frase final, avance automático,
// música, videos y documentos), como si nunca hubieran existido. Pide confirmar antes, en la
// barra de abajo. Arriba se ve qué hacen los 4 guardianes y cómo se reparte el espacio; con
// una sola persona marcada se le puede fijar su espacio para música y videos.
(function () {
  const seccion = document.getElementById('adminSeccion');
  const boton = document.getElementById('personasBtn');
  const capa = document.getElementById('personasOverlay');
  const cerrar = document.getElementById('personasCerrar');
  const buscar = document.getElementById('personasBuscar');
  const resumen = document.getElementById('personasResumen');
  const botonTodas = document.getElementById('personasTodas');
  const botonNinguna = document.getElementById('personasNinguna');
  const filas = document.getElementById('personasFilas');
  const barra = document.getElementById('personasBarra');
  const aviso = document.getElementById('toast');

  let personas = [];
  const seleccion = new Set(); // nombres marcados
  let confirmando = false;
  let borrando = false;
  let temporizador;

  function avisar(mensaje, bien) {
    aviso.textContent = mensaje;
    aviso.classList.toggle('ok', !!bien);
    aviso.hidden = false;
    requestAnimationFrame(() => aviso.classList.add('show'));
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      aviso.classList.remove('show');
      setTimeout(() => { aviso.hidden = true; aviso.classList.remove('ok'); }, 200);
    }, 5000);
  }

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  const textoDiapositivas = (n) => (n === 1 ? '1 diapositiva' : `${n} diapositivas`);
  const MB = 1024 * 1024;
  const fmtMb = (b) => (Math.round((b / MB) * 10) / 10).toLocaleString('es') + ' MB';
  const textoEspacio = (e) => (e ? `🎵 ${fmtMb(e.usado)} de ${fmtMb(e.total)}${e.fijoMb != null ? ' (fijo)' : ''}` : '');

  // ---- Los 4 guardianes y el espacio ----
  const cajaGuardianes = crear('div', 'guardian-caja');
  cajaGuardianes.setAttribute('aria-live', 'polite');
  document.getElementById('personasLista').prepend(cajaGuardianes);
  const NOMBRES_TAREAS = { imagenes: 'imágenes y páginas de PDF', nube: 'música y videos', local: 'subidas en esta PC', youtube: 'enlaces de YouTube' };

  async function cargarGuardianes() {
    try {
      const [g, n] = await Promise.all([
        authFetch('/api/admin/guardian').then(r => r.json()),
        authFetch('/api/admin/nube').then(r => r.json())
      ]);
      const c = n.calculo;
      const partes = [crear('h3', '', '🛡️ Los 4 guardianes')];
      const cuantos = g.usuarios.conectados.length;
      partes.push(crear('p', '', `👤 Usuarios: ${cuantos} ${cuantos === 1 ? 'persona conectada' : 'personas conectadas'} ahora.`));
      const tareas = Object.entries(g.tareas).map(([t, f]) => `${NOMBRES_TAREAS[t] || t}: ${f.empleados} empleados (máx. ${f.maximo})${f.esperando.length ? `, ${f.esperando.length} en fila` : ''}`);
      partes.push(crear('p', '', `👷 Tareas: ${tareas.join(' · ')}.`));
      let almacen = `📦 Almacenamiento: ${c.mbPorPersona.toLocaleString('es')} MB por persona (${(c.presupuestoMb / 1000).toLocaleString('es')} GB ÷ ${c.personas} ${c.personas === 1 ? 'persona' : 'personas'}, entre ${c.minimoMb} MB y ${c.maximoMb.toLocaleString('es')} MB). Guardado en total: ${fmtMb(n.usadoTotal)}. Subidas a Cloudinary esta hora: ${g.almacenamiento.cupoNube.usado} de ${g.almacenamiento.cupoNube.limite}.`;
      const alerta = !!(n.nube && n.nube.porcentaje >= 80);
      if (n.nube && n.nube.porcentaje != null) almacen += ` Cloudinary este mes: ${Math.round(n.nube.porcentaje)} % de lo gratis.`;
      if (alerta) almacen = '⚠️ ' + almacen + ' Conviene borrar videos viejos o bajar el espacio por persona.';
      partes.push(crear('p', alerta ? 'alerta' : '', almacen));
      partes.push(crear('p', '', `📺 Pantallas: ${g.pantallas.conSonido} con sonido; cada conexión puede mandar hasta ${g.pantallas.mensajesPorSegundo} mensajes por segundo.`));
      if (g.decisiones.length) {
        const emoji = { usuarios: '👤', tareas: '👷', almacenamiento: '📦', pantallas: '📺' };
        const lista = crear('ul', 'guardian-decisiones');
        for (const d of g.decisiones.slice(0, 12)) {
          const hora = new Date(d.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
          const quien = d.persona !== '—' ? d.persona + ': ' : '';
          lista.append(crear('li', '', `${hora} ${emoji[d.guardian] || '🛡️'} ${quien}${d.que}, porque ${d.porque}.`));
        }
        partes.push(lista);
      }
      cajaGuardianes.replaceChildren(...partes);
    } catch (err) {
      cajaGuardianes.replaceChildren(crear('p', '', 'No se pudo leer a los guardianes: ' + err.message));
    }
  }
  const textoCuentas = (n) => (n === 1 ? '1 cuenta' : `${n} cuentas`);

  function visibles() {
    const filtro = buscar.value.trim().toLowerCase();
    return personas.filter((p) => !filtro || p.name.toLowerCase().includes(filtro));
  }

  async function cargar() {
    resumen.textContent = 'Cargando…';
    try {
      const res = await authFetch('/api/admin/personas');
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error || 'No se pudo cargar la lista.');
      personas = datos;
      // Si alguien ya no está (lo borró otro dispositivo), deja de estar marcado.
      for (const n of [...seleccion]) if (!personas.some((p) => p.name === n)) seleccion.delete(n);
      pintar();
    } catch (err) {
      resumen.textContent = err.message;
      filas.replaceChildren();
    }
  }

  async function borrarSeleccion() {
    const nombres = [...seleccion];
    borrando = true;
    pintar();
    try {
      const res = await authFetch('/api/admin/personas/borrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombres })
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error || 'No se pudieron borrar las cuentas.');
      const cuentas = datos.borradas.length;
      const diapositivas = datos.borradas.reduce((n, b) => n + b.diapositivas, 0);
      avisar(`🗑️ Se ${cuentas === 1 ? 'borró' : 'borraron'} ${textoCuentas(cuentas)}` +
        (diapositivas ? ` y ${textoDiapositivas(diapositivas)}.` : '.'), true);
      const borradas = new Set(datos.borradas.map((b) => b.name));
      personas = personas.filter((p) => !borradas.has(p.name));
      seleccion.clear();
    } catch (err) {
      avisar(err.message);
    } finally {
      borrando = false;
      confirmando = false;
      pintar();
    }
  }

  function filaPersona(p) {
    const marcada = seleccion.has(p.name);
    const fila = crear('button', 'persona-fila' + (marcada ? ' marcada' : ''));
    fila.type = 'button';
    fila.setAttribute('role', 'checkbox');
    fila.setAttribute('aria-checked', String(marcada));
    fila.disabled = borrando;
    const datos = crear('span', 'persona-datos');
    datos.append(crear('span', 'persona-nombre', p.name), crear('span', 'persona-detalle', [textoDiapositivas(p.diapositivas), textoEspacio(p.espacio)].filter(Boolean).join(' · ')));
    fila.append(crear('span', 'persona-casilla'), datos);
    fila.addEventListener('click', () => {
      if (marcada) seleccion.delete(p.name); else seleccion.add(p.name);
      confirmando = false;
      pintar();
    });
    return fila;
  }

  function pintarBarra() {
    const n = seleccion.size;
    barra.hidden = n === 0;
    if (!n) return barra.replaceChildren();
    const marcadas = personas.filter((p) => seleccion.has(p.name));
    const diapositivas = marcadas.reduce((s, p) => s + p.diapositivas, 0);
    if (!confirmando) {
      const borrar = crear('button', 'btn danger-solid', `🗑️ Borrar ${textoCuentas(n)}`);
      borrar.type = 'button';
      borrar.addEventListener('click', () => { confirmando = true; pintar(); });
      barra.replaceChildren(borrar);
      if (n === 1) barra.prepend(editorDeEspacio(marcadas[0]));
      return;
    }
    const pregunta = crear('p', 'persona-pregunta');
    pregunta.append(`¿Borrar ${textoCuentas(n)}` + (diapositivas ? ` y sus ${textoDiapositivas(diapositivas)}?` : '?'),
      crear('span', 'persona-lista-nombres', marcadas.map((p) => p.name).join(', ')),
      crear('span', 'persona-advertencia', 'Se borra todo lo de estas personas y no se puede deshacer.'));
    const acciones = crear('div', 'persona-acciones');
    const cancelar = crear('button', 'btn', 'Cancelar');
    cancelar.type = 'button';
    cancelar.disabled = borrando;
    cancelar.addEventListener('click', () => { confirmando = false; pintar(); });
    const si = crear('button', 'btn danger-solid', borrando ? 'Borrando…' : `🗑️ Borrar ${n}`);
    si.type = 'button';
    si.disabled = borrando;
    si.addEventListener('click', borrarSeleccion);
    acciones.append(cancelar, si);
    barra.replaceChildren(pregunta, acciones);
  }

  // Con una sola persona marcada: fijarle su espacio para música y videos, o volver al automático.
  function editorDeEspacio(p) {
    const caja = crear('div', 'espacio-editor');
    const campo = crear('input', 'campo');
    campo.type = 'number';
    campo.min = '0';
    campo.max = '5000';
    campo.id = 'espacioPersona';
    campo.value = String(Math.round((p.espacio ? p.espacio.total : 0) / MB));
    const etiqueta = crear('label', '', `📦 Espacio de ${p.name} (MB):`);
    etiqueta.htmlFor = 'espacioPersona';
    const guardar = crear('button', 'btn chico', 'Guardar');
    guardar.type = 'button';
    const automatico = crear('button', 'btn chico', 'Automático');
    automatico.type = 'button';
    automatico.disabled = !p.espacio || p.espacio.fijoMb == null;
    const ver = crear('a', 'btn chico', '🎵 Ver su música y videos');
    ver.href = 'multimedia.html?de=' + encodeURIComponent(p.name);
    async function fijar(mb) {
      guardar.disabled = true;
      automatico.disabled = true;
      try {
        const res = await authFetch('/api/admin/espacio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: p.name, mb }) });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || 'No se pudo cambiar el espacio.');
        p.espacio = { ...p.espacio, ...r.espacio };
        avisar(mb === null ? `📦 ${p.name} volvió al espacio automático (${fmtMb(r.espacio.total)}).` : `📦 ${p.name} ahora tiene ${fmtMb(r.espacio.total)} fijos.`, true);
        pintar();
        cargarGuardianes();
      } catch (err) {
        avisar(err.message);
        guardar.disabled = false;
      }
    }
    guardar.addEventListener('click', () => {
      const mb = Number(campo.value);
      if (!Number.isInteger(mb) || mb < 0 || mb > 5000) return avisar('Escribí un número de MB entre 0 y 5000.');
      fijar(mb);
    });
    automatico.addEventListener('click', () => fijar(null));
    caja.append(etiqueta, campo, guardar, automatico, ver);
    return caja;
  }

  function pintar() {
    const lista = visibles();
    const filtro = buscar.value.trim();
    const marcadas = seleccion.size ? ` · ${seleccion.size} ${seleccion.size === 1 ? 'marcada' : 'marcadas'}` : '';
    resumen.textContent = personas.length === 0 ? 'No hay personas registradas.'
      : (filtro ? `${lista.length} de ${personas.length} personas` : `${personas.length} ${personas.length === 1 ? 'persona' : 'personas'}`) + marcadas;
    botonTodas.disabled = borrando || !lista.length || lista.every((p) => seleccion.has(p.name));
    botonNinguna.disabled = borrando || !seleccion.size;
    filas.replaceChildren(...lista.map(filaPersona));
    pintarBarra();
  }

  function abrir() {
    capa.hidden = false;
    requestAnimationFrame(() => capa.classList.add('show'));
    seleccion.clear();
    confirmando = false;
    buscar.value = '';
    cargar();
    cargarGuardianes();
  }

  function ocultar() {
    capa.classList.remove('show');
    setTimeout(() => { capa.hidden = true; }, 200);
  }

  boton.addEventListener('click', abrir);
  cerrar.addEventListener('click', ocultar);
  buscar.addEventListener('input', () => { confirmando = false; pintar(); });
  // «Seleccionar todas» marca las que se ven (si hay un filtro, sólo las que coinciden).
  botonTodas.addEventListener('click', () => { visibles().forEach((p) => seleccion.add(p.name)); confirmando = false; pintar(); });
  botonNinguna.addEventListener('click', () => { seleccion.clear(); confirmando = false; pintar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !capa.hidden) ocultar(); });

  // La sección sólo se muestra al admin (el servidor igual rechaza a cualquier otro).
  ensureAuthed().then((auth) => {
    const esAdmin = !!(auth && auth.isAdmin);
    seccion.hidden = !esAdmin;
    boton.hidden = !esAdmin;
  }).catch(() => {});
})();
