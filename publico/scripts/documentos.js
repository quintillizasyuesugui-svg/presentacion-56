// «Subir documento» (Modo avanzado): PDF, Word, Excel o PowerPoint → una diapositiva por página.
// El celular sólo sube el archivo; el servidor hace todo lo demás y avisa el progreso en vivo
// (ver trabajos-documentos.js). Por eso se puede recargar o salir de la página sin perder nada.
(function () {
  const EXTENSIONES = ['.pdf', '.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'];
  const MAXIMO_MB = 25;

  const boton = document.getElementById('documentoBtn');
  const descripcion = boton.querySelector('.action-desc');
  const descripcionOriginal = descripcion.textContent;
  const entrada = document.getElementById('documentoEntrada');
  const capa = document.getElementById('documentoOverlay');
  const contenedor = document.getElementById('documentoLista');
  const botonOtro = document.getElementById('documentoOtro');
  const botonCerrarVentana = document.getElementById('documentoCerrar');
  const aviso = document.getElementById('toast');
  const vistaCapa = document.getElementById('documentoVista');
  const vistaTitulo = document.getElementById('documentoVistaTitulo');
  const vistaImagen = document.getElementById('documentoVistaImagen');
  const vistaCargando = document.getElementById('documentoVistaCargando');
  const vistaVolver = document.getElementById('documentoVistaVolver');
  const vistaAnterior = document.getElementById('documentoVistaAnterior');
  const vistaSiguiente = document.getElementById('documentoVistaSiguiente');
  let vistaActual = null; // { id, numero, total }
  const vistasGuardadas = new Map(); // 'id:numero' → dirección local de la imagen ya descargada

  // Envíos en curso desde este celular (antes de que el servidor cree el trabajo).
  const envios = new Map(); // clave → { nombre, porcentaje }
  // Lo que eligió la persona en cada trabajo que está esperando elección.
  const elecciones = new Map(); // id → { paginas: Set, calidad, recortar, miniaturas }
  const tarjetas = new Map(); // id → elemento
  let trabajos = [];
  let temporizadorAviso;
  let yaSeAbrioSola = false;

  function avisar(mensaje, bien) {
    aviso.textContent = mensaje;
    aviso.classList.toggle('ok', !!bien);
    aviso.hidden = false;
    requestAnimationFrame(() => aviso.classList.add('show'));
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => {
      aviso.classList.remove('show');
      setTimeout(() => { aviso.hidden = true; aviso.classList.remove('ok'); }, 200);
    }, 5000);
  }

  function abrirCapa() {
    if (!capa.hidden) return;
    capa.hidden = false;
    requestAnimationFrame(() => capa.classList.add('show'));
  }

  function cerrarCapa() {
    capa.classList.remove('show');
    setTimeout(() => { capa.hidden = true; }, 200);
  }

  // ---- Ver una página en grande (sólo mirar; «Volver» regresa a las miniaturas) ----
  async function mostrarPaginaGrande() {
    const { id, numero, total } = vistaActual;
    vistaTitulo.textContent = `Página ${numero} de ${total}`;
    vistaAnterior.disabled = numero <= 1;
    vistaSiguiente.disabled = numero >= total;
    vistaImagen.hidden = true;
    vistaCargando.hidden = false;
    vistaCargando.textContent = 'Cargando la página…';
    const clave = id + ':' + numero;
    try {
      let url = vistasGuardadas.get(clave);
      if (!url) {
        const res = await authFetch(`/api/documentos/${id}/pagina/${numero}`);
        if (!res.ok) {
          let mensaje = 'No se pudo mostrar la página.';
          try { mensaje = (await res.json()).error || mensaje; } catch { /* sin JSON */ }
          throw new Error(mensaje);
        }
        url = URL.createObjectURL(await res.blob());
        vistasGuardadas.set(clave, url);
        if (vistasGuardadas.size > 12) { // no guardar demasiadas en la memoria del celular
          const [vieja, direccion] = vistasGuardadas.entries().next().value;
          URL.revokeObjectURL(direccion);
          vistasGuardadas.delete(vieja);
        }
      }
      if (!vistaActual || vistaActual.id !== id || vistaActual.numero !== numero) return; // cambió mientras cargaba
      vistaImagen.src = url;
      vistaImagen.alt = `Página ${numero}`;
      vistaImagen.hidden = false;
      vistaCargando.hidden = true;
    } catch (err) {
      vistaCargando.textContent = err.message;
    }
  }

  function abrirVista(t, numero) {
    vistaActual = { id: t.id, numero, total: t.total };
    vistaCapa.hidden = false;
    vistaVolver.focus();
    mostrarPaginaGrande();
  }

  function cerrarVista() {
    vistaActual = null;
    vistaCapa.hidden = true;
  }

  function moverVista(paso) {
    if (!vistaActual) return;
    const siguiente = vistaActual.numero + paso;
    if (siguiente < 1 || siguiente > vistaActual.total) return;
    vistaActual.numero = siguiente;
    mostrarPaginaGrande();
  }

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  // Barra de progreso: con porcentaje real, o «trabajando…» animada si todavía no se puede medir.
  function barra(porcentaje) {
    const caja = crear('div', 'doc-progreso' + (porcentaje === null ? ' indeterminado' : ''));
    caja.setAttribute('role', 'progressbar');
    caja.setAttribute('aria-valuemin', '0');
    caja.setAttribute('aria-valuemax', '100');
    if (porcentaje !== null) caja.setAttribute('aria-valuenow', String(porcentaje));
    const relleno = crear('span');
    relleno.style.width = porcentaje === null ? '' : porcentaje + '%';
    caja.append(relleno);
    return caja;
  }

  function tarjetaEnvio(envio) {
    const tarjeta = crear('div', 'doc-trabajo');
    const cabecera = crear('div', 'doc-cabecera');
    cabecera.append(crear('span', 'doc-nombre', '📤 ' + envio.nombre), crear('span', 'doc-porcentaje', envio.porcentaje + ' %'));
    tarjeta.append(cabecera, barra(envio.porcentaje),
      crear('p', 'doc-paso', envio.porcentaje < 100 ? 'Enviando al servidor… (no cierres hasta que termine este paso)' : 'Recibido, empezando…'));
    return tarjeta;
  }

  function botonChico(texto, clase, accion) {
    const b = crear('button', 'chip-btn' + (clase ? ' ' + clase : ''), texto);
    b.type = 'button';
    b.addEventListener('click', accion);
    return b;
  }

  async function pedir(url, opciones) {
    const res = await authFetch(url, opciones);
    let datos = {};
    try { datos = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) throw new Error(datos.error || 'No se pudo completar.');
    return datos;
  }

  async function cancelar(t) {
    try { TrabajosDocumentos.actualizar(await pedir(`/api/documentos/${t.id}/cancelar`, { method: 'POST' })); }
    catch (err) { avisar(err.message); }
  }

  async function cerrarTrabajo(t) {
    try {
      await pedir(`/api/documentos/${t.id}`, { method: 'DELETE' });
      elecciones.delete(t.id);
      TrabajosDocumentos.quitar(t.id);
    } catch (err) { avisar(err.message); }
  }

  async function procesar(t, eleccion) {
    const paginas = [...eleccion.paginas].sort((a, b) => a - b);
    try {
      eleccion.enviando = true;
      pintar();
      TrabajosDocumentos.actualizar(await pedir(`/api/documentos/${t.id}/procesar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paginas, calidad: eleccion.calidad, recortar: eleccion.recortar })
      }));
      elecciones.delete(t.id);
    } catch (err) {
      eleccion.enviando = false;
      avisar(err.message);
      pintar();
    }
  }

  function zonaEleccion(t) {
    let eleccion = elecciones.get(t.id);
    if (!eleccion) {
      eleccion = { paginas: new Set(Array.from({ length: t.total }, (_, i) => i + 1)), calidad: 'normal', recortar: true, miniaturas: null, pidiendo: false };
      elecciones.set(t.id, eleccion);
    }
    const zona = crear('div', 'doc-eleccion');
    const grilla = crear('div', 'doc-paginas');
    grilla.dataset.trabajo = t.id;
    if (!eleccion.miniaturas) {
      grilla.append(crear('p', 'doc-paso', 'Cargando la vista previa…'));
      if (!eleccion.pidiendo) {
        eleccion.pidiendo = true;
        pedir(`/api/documentos/${t.id}/miniaturas`)
          .then((d) => { eleccion.miniaturas = d.miniaturas; })
          .catch((err) => avisar(err.message))
          .finally(() => { eleccion.pidiendo = false; pintar(); });
      }
    } else {
      // Tocar la página la muestra en grande; el círculo ✓ la marca o la quita.
      eleccion.miniaturas.forEach((src, i) => {
        const numero = i + 1;
        const elegida = eleccion.paginas.has(numero);
        const pagina = crear('div', 'doc-pagina' + (elegida ? ' selected' : ''));
        const ver = crear('button', 'doc-ver');
        ver.type = 'button';
        ver.setAttribute('aria-label', `Ver la página ${numero} en grande`);
        const img = crear('img');
        img.src = src;
        img.alt = '';
        ver.append(img, crear('span', 'doc-numero', String(numero)));
        ver.addEventListener('click', () => abrirVista(t, numero));
        const marca = crear('button', 'doc-marca');
        marca.type = 'button';
        marca.setAttribute('aria-pressed', String(elegida));
        marca.setAttribute('aria-label', elegida ? `Quitar la página ${numero}` : `Incluir la página ${numero}`);
        marca.addEventListener('click', () => {
          if (eleccion.paginas.has(numero)) eleccion.paginas.delete(numero); else eleccion.paginas.add(numero);
          pintar();
        });
        pagina.append(ver, marca);
        grilla.append(pagina);
      });
    }

    // Las miniaturas van en una fila que se desliza de costado. Las flechas hacen lo mismo
    // que deslizar el dedo, por si en algún celular el gesto no responde bien.
    const carrusel = crear('div', 'doc-carrusel');
    const flecha = (texto, etiqueta, sentido) => {
      const b = crear('button', 'doc-flecha', texto);
      b.type = 'button';
      b.setAttribute('aria-label', etiqueta);
      b.addEventListener('click', () => grilla.scrollBy({ left: sentido * grilla.clientWidth * 0.8, behavior: 'smooth' }));
      return b;
    };
    carrusel.append(flecha('◀', 'Ver páginas anteriores', -1), grilla, flecha('▶', 'Ver páginas siguientes', 1));

    const cuantas = eleccion.paginas.size;

    // Arriba de la grilla: cuántas van elegidas y atajos para marcar o desmarcar todas.
    const conteo = crear('div', 'doc-conteo');
    conteo.append(
      crear('span', 'doc-resumen', `${cuantas} de ${t.total} ${t.total === 1 ? 'elegida' : 'elegidas'}`),
      botonChico('Todas', '', () => { for (let n = 1; n <= t.total; n++) eleccion.paginas.add(n); pintar(); }),
      botonChico('Ninguna', '', () => { eleccion.paginas.clear(); pintar(); })
    );

    const calidades = crear('div', 'doc-bloque');
    calidades.append(crear('span', 'doc-etiqueta', 'Calidad de las imágenes'));
    const grupo = crear('div', 'doc-segmentos');
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', 'Calidad de las imágenes');
    [['liviana', 'Liviana'], ['normal', 'Normal'], ['alta', 'Alta']].forEach(([clave, texto]) => {
      const b = crear('button', 'doc-segmento', texto);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(eleccion.calidad === clave));
      b.addEventListener('click', () => { eleccion.calidad = clave; pintar(); });
      grupo.append(b);
    });
    calidades.append(grupo, crear('p', 'doc-ayuda', 'Liviana pesa menos y sube más rápido; Alta se ve más nítida en pantallas grandes.'));

    const recorte = crear('label', 'doc-check');
    const casilla = crear('input');
    casilla.type = 'checkbox';
    casilla.checked = eleccion.recortar;
    casilla.addEventListener('change', () => { eleccion.recortar = casilla.checked; });
    recorte.append(casilla, crear('span', '', 'Recortar márgenes blancos'));

    // Barra fija abajo: «Subir» siempre queda a mano aunque la grilla sea larga.
    const acciones = crear('div', 'doc-acciones');
    const botonCancelar = crear('button', 'btn doc-cancelar', 'Cancelar');
    botonCancelar.type = 'button';
    botonCancelar.addEventListener('click', () => cancelar(t));
    const botonSubir = crear('button', 'btn primary doc-subir', eleccion.enviando ? 'Enviando…' : (cuantas ? `Subir ${cuantas}` : 'Elegí páginas'));
    botonSubir.type = 'button';
    botonSubir.disabled = !cuantas || eleccion.enviando || !eleccion.miniaturas;
    botonSubir.addEventListener('click', () => procesar(t, eleccion));
    acciones.append(botonCancelar, botonSubir);

    zona.append(conteo, carrusel, calidades, recorte, acciones);
    return zona;
  }

  function tarjetaTrabajo(t) {
    const tarjeta = crear('div', 'doc-trabajo doc-' + t.fase);
    const cabecera = crear('div', 'doc-cabecera');
    const icono = { listo: '✅', error: '⚠️', cancelado: '⛔' }[t.fase] || '📄';
    const porcentaje = TrabajosDocumentos.esActivo(t) && t.fase !== 'eligiendo' && t.porcentaje !== null ? t.porcentaje + ' %' : '';
    // El admin ve los documentos de todos: se indica de quién es cada uno.
    const yo = window.getAuth && getAuth();
    const deQuien = yo && t.owner && t.owner !== yo.name ? ` · de ${t.owner}` : '';
    cabecera.append(crear('span', 'doc-nombre', `${icono} ${t.nombre}${deQuien}`), crear('span', 'doc-porcentaje', porcentaje));
    tarjeta.append(cabecera);

    if (t.fase === 'preparando' || t.fase === 'procesando') {
      tarjeta.append(barra(t.porcentaje), crear('p', 'doc-paso', t.paso));
      tarjeta.append(crear('p', 'doc-ayuda', 'Podés salir o recargar la página: sigue trabajando y el avance se ve aquí.'));
      const fila = crear('div', 'doc-fila');
      fila.append(botonChico('Cancelar', 'peligro', () => cancelar(t)));
      tarjeta.append(fila);
    } else if (t.fase === 'eligiendo') {
      tarjeta.append(crear('p', 'doc-paso', t.paso), zonaEleccion(t));
    } else {
      const texto = t.fase === 'listo' ? TrabajosDocumentos.textoResultado(t) : (t.error || t.paso);
      tarjeta.append(crear('p', 'doc-paso', texto));
      const fila = crear('div', 'doc-fila');
      fila.append(botonChico('Cerrar', '', () => cerrarTrabajo(t)));
      tarjeta.append(fila);
    }
    return tarjeta;
  }

  function pintar() {
    const hijos = [];
    envios.forEach((envio) => hijos.push(tarjetaEnvio(envio)));
    trabajos.forEach((t) => hijos.push(tarjetaTrabajo(t)));
    if (!hijos.length) hijos.push(crear('p', 'doc-paso', 'Elegí un PDF, Word, Excel o PowerPoint. Cada página se convierte en una diapositiva.'));
    // Conserva la posición de la lista y de cada fila de miniaturas mientras llegan avisos.
    const scroll = contenedor.scrollTop;
    const scrollFilas = new Map([...contenedor.querySelectorAll('.doc-paginas')].map((g) => [g.dataset.trabajo, g.scrollLeft]));
    contenedor.replaceChildren(...hijos);
    contenedor.scrollTop = scroll;
    contenedor.querySelectorAll('.doc-paginas').forEach((g) => {
      if (scrollFilas.has(g.dataset.trabajo)) g.scrollLeft = scrollFilas.get(g.dataset.trabajo);
    });

    const activos = trabajos.filter(TrabajosDocumentos.esActivo);
    const eligiendo = activos.filter((t) => t.fase === 'eligiendo').length;
    const trabajando = activos.filter((t) => t.fase !== 'eligiendo');
    if (envios.size || trabajando.length) {
      const primero = trabajando[0];
      descripcion.textContent = primero && primero.porcentaje !== null
        ? `En proceso: ${primero.nombre} · ${primero.porcentaje} %`
        : 'Procesando documento…';
    } else if (eligiendo) {
      descripcion.textContent = `${eligiendo} ${eligiendo === 1 ? 'documento espera' : 'documentos esperan'} que elijas las páginas`;
    } else {
      descripcion.textContent = descripcionOriginal;
    }
  }

  // Sube el archivo con XMLHttpRequest (fetch no informa el avance de la subida).
  function enviar(archivo, auth) {
    return new Promise((resolver, rechazar) => {
      const clave = Math.random().toString(36).slice(2);
      envios.set(clave, { nombre: archivo.name, porcentaje: 0 });
      pintar();
      const datos = new FormData();
      datos.append('documento', archivo);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/documentos');
      xhr.setRequestHeader('x-pin', auth.pin);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        envios.get(clave).porcentaje = Math.round((e.loaded / e.total) * 100);
        pintar();
      };
      xhr.onload = () => {
        envios.delete(clave);
        let cuerpo = {};
        try { cuerpo = JSON.parse(xhr.responseText); } catch { /* sin JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          TrabajosDocumentos.actualizar(cuerpo);
          resolver(cuerpo);
        } else {
          pintar();
          rechazar(new Error(cuerpo.error || 'No se pudo enviar el documento.'));
        }
      };
      xhr.onerror = () => {
        envios.delete(clave);
        pintar();
        rechazar(new Error('Se cortó la conexión mientras se enviaba «' + archivo.name + '».'));
      };
      xhr.send(datos);
    });
  }

  async function enviarArchivos(archivos) {
    abrirCapa();
    const auth = await ensureAuthed();
    for (const archivo of archivos) {
      const punto = archivo.name.lastIndexOf('.');
      const extension = punto === -1 ? '' : archivo.name.slice(punto).toLowerCase();
      if (!EXTENSIONES.includes(extension)) {
        avisar(`«${archivo.name}» no es PDF, Word, Excel ni PowerPoint.`);
        continue;
      }
      if (archivo.size > MAXIMO_MB * 1024 * 1024) {
        avisar(`«${archivo.name}» pesa más de ${MAXIMO_MB} MB. Guardalo como PDF o dividilo.`);
        continue;
      }
      try { await enviar(archivo, auth); } catch (err) { avisar(err.message); }
    }
  }

  // El selector de archivos se abre en el mismo toque (si se espera algo antes, Safari lo bloquea).
  boton.addEventListener('click', () => {
    if (trabajos.length || envios.size) abrirCapa();
    else entrada.click();
  });
  botonOtro.addEventListener('click', () => entrada.click());
  vistaVolver.addEventListener('click', cerrarVista);
  vistaAnterior.addEventListener('click', () => moverVista(-1));
  vistaSiguiente.addEventListener('click', () => moverVista(1));
  document.addEventListener('keydown', (e) => {
    if (vistaCapa.hidden) return;
    if (e.key === 'Escape') cerrarVista();
    if (e.key === 'ArrowLeft') moverVista(-1);
    if (e.key === 'ArrowRight') moverVista(1);
  });
  botonCerrarVentana.addEventListener('click', cerrarCapa);
  entrada.addEventListener('change', () => {
    const archivos = Array.from(entrada.files || []);
    entrada.value = '';
    if (archivos.length) enviarArchivos(archivos);
  });

  TrabajosDocumentos.escuchar((lista) => {
    const antes = new Map(trabajos.map((t) => [t.id, t.fase]));
    trabajos = lista;
    // Si el documento que se está mirando ya no espera elección (se canceló o se empezó a subir), se cierra la vista.
    if (vistaActual && !lista.some((t) => t.id === vistaActual.id && t.fase === 'eligiendo')) cerrarVista();
    lista.forEach((t) => {
      if (antes.get(t.id) === 'procesando' && t.fase === 'listo') avisar('✓ ' + t.nombre + ': ' + TrabajosDocumentos.textoResultado(t), true);
    });
    // Al abrir o recargar la página con documentos en marcha, la ventana se abre sola para seguir el avance.
    if (!yaSeAbrioSola && lista.some(TrabajosDocumentos.esActivo)) {
      yaSeAbrioSola = true;
      abrirCapa();
    }
    pintar();
  });
  // Cuando la página ya tiene el PIN, pide los trabajos (el socket también lo hace al conectarse).
  ensureAuthed().then(() => {
    TrabajosDocumentos.identificar();
    return TrabajosDocumentos.refrescar();
  }).catch(() => {});
})();
