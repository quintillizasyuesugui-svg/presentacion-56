// «Personas» (Modo avanzado, sólo admin): lista de cuentas con 🗑️ para borrar una.
// Borrar quita la cuenta y todo lo suyo (diapositivas, frase final, avance automático y
// documentos), como si nunca hubiera existido. Pide confirmar antes, en la misma fila.
(function () {
  const seccion = document.getElementById('adminSeccion');
  const boton = document.getElementById('personasBtn');
  const capa = document.getElementById('personasOverlay');
  const cerrar = document.getElementById('personasCerrar');
  const buscar = document.getElementById('personasBuscar');
  const resumen = document.getElementById('personasResumen');
  const filas = document.getElementById('personasFilas');
  const aviso = document.getElementById('toast');

  let personas = [];
  let confirmando = null; // nombre de la persona cuya fila pide confirmación
  let borrando = null;
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
    }, 4500);
  }

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function textoDiapositivas(n) {
    return n === 1 ? '1 diapositiva' : `${n} diapositivas`;
  }

  async function cargar() {
    resumen.textContent = 'Cargando…';
    try {
      const res = await authFetch('/api/admin/personas');
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error || 'No se pudo cargar la lista.');
      personas = datos;
      pintar();
    } catch (err) {
      resumen.textContent = err.message;
      filas.replaceChildren();
    }
  }

  async function borrar(nombre) {
    borrando = nombre;
    pintar();
    try {
      const res = await authFetch('/api/admin/personas/' + encodeURIComponent(nombre), { method: 'DELETE' });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error || 'No se pudo borrar la cuenta.');
      avisar(`🗑️ Se borró «${nombre}»` + (datos.diapositivas ? ` y sus ${textoDiapositivas(datos.diapositivas)}.` : '.'), true);
      personas = personas.filter(p => p.name !== nombre);
    } catch (err) {
      avisar(err.message);
    } finally {
      borrando = null;
      confirmando = null;
      pintar();
    }
  }

  function filaPersona(p) {
    const fila = crear('div', 'persona-fila');
    if (confirmando === p.name) {
      fila.classList.add('confirmando');
      const pregunta = crear('p', 'persona-pregunta');
      pregunta.append('¿Borrar a ', crear('strong', '', p.name),
        p.diapositivas ? ` y sus ${textoDiapositivas(p.diapositivas)}?` : '?',
        crear('span', 'persona-advertencia', ' Se borra todo lo suyo y no se puede deshacer.'));
      const acciones = crear('div', 'persona-acciones');
      const cancelar = crear('button', 'btn', 'Cancelar');
      cancelar.type = 'button';
      cancelar.disabled = borrando === p.name;
      cancelar.addEventListener('click', () => { confirmando = null; pintar(); });
      const si = crear('button', 'btn danger-solid', borrando === p.name ? 'Borrando…' : '🗑️ Borrar');
      si.type = 'button';
      si.disabled = borrando === p.name;
      si.addEventListener('click', () => borrar(p.name));
      acciones.append(cancelar, si);
      fila.append(pregunta, acciones);
      return fila;
    }
    const datos = crear('div', 'persona-datos');
    datos.append(crear('span', 'persona-nombre', p.name), crear('span', 'persona-detalle', textoDiapositivas(p.diapositivas)));
    const basura = crear('button', 'persona-basura', '🗑️');
    basura.type = 'button';
    basura.setAttribute('aria-label', `Borrar a ${p.name}`);
    basura.disabled = !!borrando;
    basura.addEventListener('click', () => { confirmando = p.name; pintar(); });
    fila.append(datos, basura);
    return fila;
  }

  function pintar() {
    const filtro = buscar.value.trim().toLowerCase();
    const visibles = personas.filter(p => !filtro || p.name.toLowerCase().includes(filtro));
    resumen.textContent = personas.length === 0 ? 'No hay personas registradas.'
      : filtro ? `${visibles.length} de ${personas.length} personas`
        : `${personas.length} ${personas.length === 1 ? 'persona registrada' : 'personas registradas'}. Tocá 🗑️ para borrar una cuenta y todo lo suyo.`;
    filas.replaceChildren(...visibles.map(filaPersona));
  }

  function abrir() {
    capa.hidden = false;
    requestAnimationFrame(() => capa.classList.add('show'));
    confirmando = null;
    buscar.value = '';
    cargar();
  }

  function ocultar() {
    capa.classList.remove('show');
    setTimeout(() => { capa.hidden = true; }, 200);
  }

  boton.addEventListener('click', abrir);
  cerrar.addEventListener('click', ocultar);
  buscar.addEventListener('input', () => { confirmando = null; pintar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !capa.hidden) ocultar(); });

  // La sección sólo se muestra al admin (el servidor igual rechaza a cualquier otro).
  ensureAuthed().then((auth) => {
    const esAdmin = !!(auth && auth.isAdmin);
    seccion.hidden = !esAdmin;
    boton.hidden = !esAdmin;
  }).catch(() => {});
})();
