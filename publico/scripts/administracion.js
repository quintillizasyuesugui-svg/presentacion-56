// «Personas» (Modo avanzado, sólo admin): lista de cuentas para marcar y borrar varias juntas.
// Borrar quita las cuentas y todo lo suyo (diapositivas, frase final, avance automático y
// documentos), como si nunca hubieran existido. Pide confirmar antes, en la barra de abajo.
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
    datos.append(crear('span', 'persona-nombre', p.name), crear('span', 'persona-detalle', textoDiapositivas(p.diapositivas)));
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
