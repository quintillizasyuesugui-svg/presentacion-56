// Lista larga que se ordena arrastrando (imágenes en Gestionar, música y videos).
//
// Con miles de filas la página se pone lenta aunque nadie toque nada, así que sólo se dibujan
// las filas a la vista (y unas cuantas más); arriba y abajo queda un espacio vacío del mismo alto.
// Todas las filas tienen que medir lo mismo.
//
// Arrastrar:
// - Se agarra de cualquier parte de la fila. Con el dedo hay que dejarlo apoyado un instante
//   (deslizar sin esperar sigue bajando la página). Con «ya» (el agarradero ≡) agarra sin esperar.
// - La fila no pasa de la primera ni de la última.
// - Las demás se corren y un marco muestra la fila en transparente donde va a quedar.
// - Al llevarla al borde, la lista sube o baja sola, cada vez más rápido.
// - Al soltar, la fila entra sola a su lugar.
(function () {
  const UMBRAL = 6;          // px que hay que mover el mouse antes de que empiece
  const ESPERA_DEDO = 180;   // ms con el dedo apoyado para agarrar
  const TEMBLOR_DEDO = 10;   // px que el dedo se puede mover mientras espera
  const ZONA = 80;           // px desde el borde donde la lista se desplaza sola
  const VELOCIDAD = 16;      // px por cuadro al empezar
  const ACELERA = 8;         // hasta 8 veces más rápido si se queda en el borde
  const DURACION = 170;      // ms de cada movimiento
  const DE_MAS = 15;         // filas de más que se dibujan arriba y abajo de lo visible

  let activo = null;
  // Mientras se arrastra con el dedo, la página no se desliza por su cuenta.
  document.addEventListener('touchmove', (ev) => {
    if (activo && activo.empezo && ev.cancelable) ev.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', (ev) => { if (activo) ev.preventDefault(); });

  const sinMovimiento = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function contenedorDesplazable(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return null;
  }

  // opciones:
  //   crearFila(item, indice) → elemento (con data-id)
  //   arrastre(evento, fila) → false | 'esperar' | 'ya'
  //   numero: selector del número de la fila (para el marco)
  //   alOrdenar(desde, hacia): ya se movió el elemento en la lista que se pasó a poner()
  window.listaVirtual = function (lista, opciones) {
    let items = [];
    let paso = 0;              // alto de una fila + el espacio entre filas
    let desde = 0, hasta = -1; // filas dibujadas
    let hechas = new Map();    // id → fila ya armada
    let pedido = 0;
    let d = null;              // arrastre en curso

    const caja = () => contenedorDesplazable(lista);
    const bordes = () => {
      const c = caja();
      return c ? c.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    };
    const filaDe = (item, i) => {
      let f = hechas.get(item.id);
      if (!f) { f = opciones.crearFila(item, i); f.dataset.indice = String(i); hechas.set(item.id, f); }
      return f;
    };

    function medir() {
      if (!items.length) { paso = 0; return; }
      const prueba = filaDe(items[0], 0);
      const suelta = !prueba.isConnected;
      if (suelta) lista.append(prueba);
      const hueco = parseFloat(getComputedStyle(lista).rowGap) || 0;
      // Escondida (otra pestaña): todavía no se puede medir
      paso = prueba.offsetHeight ? prueba.offsetHeight + hueco : 0;
      if (suelta) prueba.remove();
    }

    // Qué filas tocan a la vista
    function rango() {
      const n = items.length;
      if (!paso) return [0, Math.min(n - 1, 40)];
      const r = lista.getBoundingClientRect();
      const b = bordes();
      const arriba = Math.floor((b.top - r.top) / paso) - DE_MAS;
      const abajo = Math.ceil((b.bottom - r.top) / paso) + DE_MAS;
      return [Math.max(0, arriba), Math.min(n - 1, Math.max(0, abajo))];
    }

    // Orden que se ve: sin arrastre, la lista; arrastrando, sin la agarrada y con el marco en su lugar
    function enLugar(k) {
      if (!d || !d.empezo) return items[k];
      if (k === d.hacia) return null;
      const j = k < d.hacia ? k : k - 1;
      return d.resto[j];
    }

    function dibujar(forzar) {
      const n = items.length;
      if (!n) { lista.replaceChildren(); lista.style.paddingTop = lista.style.paddingBottom = ''; desde = 0; hasta = -1; return; }
      if (!paso) medir();
      const [a, b] = rango();
      // Lo que se ve sigue dentro de lo dibujado: no hace falta nada
      if (!forzar && a >= desde && b <= hasta) return;
      const viejo = new Map();
      if (d && d.empezo) for (const f of lista.children) if (f.dataset.k) viejo.set(f, Number(f.dataset.k));
      desde = Math.max(0, a - (forzar ? 0 : 5));
      hasta = Math.min(n - 1, b + (forzar ? 0 : 5));
      const filas = [];
      for (let k = desde; k <= hasta; k++) {
        const it = enLugar(k);
        let f;
        // Arrastrando, las demás conservan su número hasta soltar
        if (it) f = filaDe(it, d && d.empezo ? d.indiceDe.get(it.id) : k);
        else f = d.marco;
        f.dataset.k = String(k);
        filas.push(f);
      }
      if (d && d.empezo) filas.push(d.fila);
      lista.style.paddingTop = (desde * paso) + 'px';
      lista.style.paddingBottom = ((n - 1 - hasta) * paso) + 'px';
      lista.replaceChildren(...filas);
      // Las que cambiaron de lugar se deslizan desde donde estaban
      if (viejo.size && !sinMovimiento()) {
        for (const [f, k0] of viejo) {
          if (!f.isConnected || f === d.fila) continue;
          const k1 = Number(f.dataset.k);
          if (k0 === k1) continue;
          f.animate([{ transform: `translateY(${(k0 - k1) * paso}px)` }, { transform: 'translateY(0)' }],
            { duration: DURACION, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
    }

    function alDesplazar() {
      if (pedido || (d && d.empezo)) return;
      pedido = requestAnimationFrame(() => { pedido = 0; dibujar(false); });
    }
    window.addEventListener('scroll', alDesplazar, { passive: true });
    window.addEventListener('resize', () => { if (!(d && d.empezo)) { paso = 0; dibujar(true); } }, { passive: true });
    // Al aparecer (pestaña que estaba escondida) recién se puede medir
    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (!paso && items.length && lista.offsetWidth) dibujar(true); }).observe(lista);
    }

    // ---------- arrastrar ----------
    lista.addEventListener('pointerdown', (e) => {
      if (activo || (e.button !== undefined && e.button > 0)) return;
      const fila = e.target.closest('[data-id]');
      if (!fila || fila.parentElement !== lista || fila.classList.contains('orden-fantasma')) return;
      const modo = opciones.arrastre ? opciones.arrastre(e, fila) : 'esperar';
      if (!modo) return;
      const conDedo = e.pointerType === 'touch' || e.pointerType === 'pen';
      const espera = conDedo && modo === 'esperar';
      if (!espera) e.preventDefault();
      d = { fila, id: e.pointerId, y0: e.clientY, y: e.clientY, empezo: false, soltando: false, espera };
      activo = d;
      try { lista.setPointerCapture(e.pointerId); } catch (_) {}
      if (espera) d.reloj = setTimeout(empezar, ESPERA_DEDO);
    });

    lista.addEventListener('pointermove', (ev) => {
      if (!d || ev.pointerId !== d.id) return;
      d.y = ev.clientY;
      if (d.empezo) return;
      if (d.espera) { if (Math.abs(d.y - d.y0) > TEMBLOR_DEDO) cancelar(); }
      else if (Math.abs(d.y - d.y0) > UMBRAL) empezar();
    });
    const alSoltar = (ev) => { if (d && ev.pointerId === d.id) soltar(); };
    lista.addEventListener('pointerup', alSoltar);
    lista.addEventListener('pointercancel', alSoltar);
    lista.addEventListener('lostpointercapture', alSoltar);

    function cancelar() {
      clearTimeout(d.reloj);
      try { lista.releasePointerCapture(d.id); } catch (_) {}
      d = null; activo = null;
    }

    function empezar() {
      if (!d || d.soltando || d.empezo) return;
      const id = d.fila.dataset.id;
      const de = items.findIndex(x => x.id === id);
      if (de < 0 || items.length < 2) return cancelar();
      if (!paso) medir();
      if (d.espera) d.y0 = d.y;
      const c = caja();
      d.leerScroll = () => (c ? c.scrollTop : window.scrollY);
      d.s0 = d.leerScroll();
      d.caja = c;
      d.de = de;
      d.hacia = de;
      d.resto = items.filter((_, i) => i !== de);
      d.indiceDe = new Map(items.map((x, i) => [x.id, i]));
      d.enBorde = 0;
      d.antes = performance.now();

      // Marco fantasma: copia de la fila, en transparente, donde va a quedar
      const marco = d.fila.cloneNode(true);
      marco.removeAttribute('id');
      marco.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
      delete marco.dataset.id;
      marco.classList.add('orden-fantasma');
      marco.setAttribute('aria-hidden', 'true');
      d.marco = marco;
      ponerNumero(de);

      if (getComputedStyle(lista).position === 'static') { lista.style.position = 'relative'; d.posicionPuesta = true; }
      const f = d.fila;
      f.style.top = (de * paso) + 'px';
      f.classList.add('orden-agarrada');
      d.empezo = true;
      dibujar(true);
      if (d.espera && navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      bucle();
    }

    function ponerNumero(k) {
      if (!opciones.numero) return;
      const num = d.marco.querySelector(opciones.numero);
      if (num) num.textContent = String(k + 1);
    }

    function bucle() {
      if (!d || !d.empezo || d.soltando) return;
      const ahora = performance.now();
      const dt = Math.min(50, ahora - d.antes) / 16.7;
      d.antes = ahora;
      const b = bordes();
      let fuerza = 0;
      if (d.y < b.top + ZONA) fuerza = -Math.min(1, (b.top + ZONA - d.y) / ZONA);
      else if (d.y > b.bottom - ZONA) fuerza = Math.min(1, (d.y - (b.bottom - ZONA)) / ZONA);
      if (fuerza) {
        d.enBorde += dt * 16.7;
        const vel = fuerza * VELOCIDAD * Math.min(ACELERA, 1 + d.enBorde / 600) * dt;
        if (d.caja) d.caja.scrollTop += vel; else window.scrollBy(0, vel);
      } else {
        d.enBorde = 0;
      }
      pintar();
      d.cuadro = requestAnimationFrame(bucle);
    }

    function pintar() {
      const n = items.length;
      let dy = (d.y - d.y0) + (d.leerScroll() - d.s0);
      dy = Math.max(-d.de * paso, Math.min((n - 1 - d.de) * paso, dy));
      d.fila.style.transform = `translate3d(0,${dy}px,0) scale(0.97)`;
      const hacia = Math.max(0, Math.min(n - 1, Math.round(d.de + dy / paso)));
      const [a, b] = rango();
      if (hacia !== d.hacia) { d.hacia = hacia; ponerNumero(hacia); dibujar(true); }
      else if (a < desde || b > hasta) dibujar(true);
    }

    function soltar() {
      if (!d || d.soltando) return;
      clearTimeout(d.reloj);
      d.soltando = true;
      try { lista.releasePointerCapture(d.id); } catch (_) {}
      if (!d.empezo) { d = null; activo = null; return; }
      cancelAnimationFrame(d.cuadro);
      const f = d.fila;
      f.classList.add('orden-cayendo');
      f.style.transform = `translate3d(0,${(d.hacia - d.de) * paso}px,0)`;
      setTimeout(terminar, (sinMovimiento() ? 0 : DURACION) + 20);
    }

    function terminar() {
      const { de, hacia, fila, pendiente } = d;
      fila.classList.remove('orden-agarrada', 'orden-cayendo');
      fila.style.transform = '';
      fila.style.top = '';
      if (d.posicionPuesta) lista.style.position = '';
      d = null; activo = null;
      if (hacia !== de) {
        const [x] = items.splice(de, 1);
        items.splice(hacia, 0, x);
        hechas = new Map(); // los números cambiaron
      }
      dibujar(true);
      if (hacia !== de && opciones.alOrdenar) opciones.alOrdenar(de, hacia);
      if (pendiente) { items = pendiente; hechas = new Map(); dibujar(true); }
    }

    return {
      // Lista nueva (o cambiada): se arma de nuevo lo que se ve
      poner(nuevos) {
        // Llegó una lista nueva en medio de un arrastre: se usa al soltar
        if (d && d.empezo) { d.pendiente = nuevos; return; }
        items = nuevos;
        hechas = new Map();
        paso = 0;
        dibujar(true);
      },
      filas: () => [...lista.children].filter(f => f.dataset.id),
      arrastrando: () => !!(d && d.empezo)
    };
  };
})();
