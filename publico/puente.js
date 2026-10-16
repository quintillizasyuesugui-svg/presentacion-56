// Puente de Conexiones: una línea en tu página para poder manejarla desde el celular.
//
//   <script src="puente-conexiones.js" defer></script>
//
// Cuando la página se abre sola no hace nada. Cuando Conexiones la muestra adentro de la
// pantalla o del celular, avisa en qué página está y qué se tocó, y repite los toques que le
// llegan del celular. Sólo le hace caso a Conexiones (lista de abajo).
(function () {
  if (window.parent === window) return;

  var PERMITIDOS = [
    /^https:\/\/presentacion-56\.onrender\.com$/,
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
  ];
  // Página traída por Conexiones (servidor/traer-pagina.js): se ve desde el servidor de Conexiones
  // pero es de otro sitio. Las direcciones y el menú se cuentan con las del sitio de verdad, y
  // para pasar a otra de sus páginas se la vuelve a pedir traída.
  var TRAIDA = window.CONEXIONES_TRAIDA || null;
  var ORIGEN = TRAIDA ? TRAIDA.origen : location.origin;
  var AQUI = TRAIDA ? new URL(TRAIDA.direccion) : location;
  function ir(direccion) {
    location.href = TRAIDA ? TRAIDA.abrir + encodeURIComponent(direccion) : direccion;
  }
  var TOCABLES = 'a[href],button,summary,label,input,select,textarea,[role="button"],[role="tab"],[onclick]';

  // Adentro de un recuadro las transiciones entre páginas no funcionan y dejan un error en la
  // consola: acá se apagan. Abierta sola, la página las sigue usando.
  var sinTransicion = document.createElement('style');
  sinTransicion.textContent = '@view-transition { navigation: none; }';
  document.head.appendChild(sinTransicion);

  function permitido(origen) {
    return PERMITIDOS.some(function (patron) { return patron.test(origen); });
  }
  function avisar(datos) {
    datos.conexiones = true;
    window.parent.postMessage(datos, '*');
  }

  // Camino hasta el elemento, igual en el celular y en la pantalla porque es la misma página:
  // «#menu > a:nth-of-type(3)».
  function rutaDe(elemento) {
    var partes = [];
    var actual = elemento;
    while (actual && actual.nodeType === 1 && actual !== document.body && partes.length < 12) {
      if (actual.id) {
        partes.unshift('#' + CSS.escape(actual.id));
        return partes.join(' > ');
      }
      var etiqueta = actual.tagName.toLowerCase();
      var lugar = 1;
      var hermano = actual;
      while ((hermano = hermano.previousElementSibling)) {
        if (hermano.tagName === actual.tagName) lugar++;
      }
      partes.unshift(etiqueta + ':nth-of-type(' + lugar + ')');
      actual = actual.parentElement;
    }
    partes.unshift('body');
    return partes.join(' > ');
  }

  // Anillo que muestra dónde se tocó, para que el público lo vea en la pantalla.
  function marcar(elemento) {
    var caja = elemento.getBoundingClientRect();
    var anillo = document.createElement('div');
    var lado = Math.max(28, Math.min(innerWidth, innerHeight) * 0.05);
    anillo.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border-radius:50%;' +
      'border:' + Math.max(3, lado * 0.12) + 'px solid #34cdfa;box-sizing:border-box;' +
      'width:' + lado + 'px;height:' + lado + 'px;' +
      'left:' + (caja.left + caja.width / 2 - lado / 2) + 'px;top:' + (caja.top + caja.height / 2 - lado / 2) + 'px;';
    document.body.appendChild(anillo);
    var animacion = anillo.animate(
      [{ transform: 'scale(0.6)', opacity: 1 }, { transform: 'scale(2.6)', opacity: 0 }],
      { duration: 650, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    animacion.onfinish = function () { anillo.remove(); };
  }

  function mismaPagina(enlace) {
    return enlace.origin === ORIGEN && enlace.pathname === AQUI.pathname && enlace.search === AQUI.search;
  }

  // ---- Videos y audios de la página ----
  // El espejo del celular manda: lo que se hace con un video allá (▶, ⏸, mover la barra, la
  // velocidad) se repite en la pantalla, en el mismo segundo. En el celular se ve callado: el
  // sonido sale por la pantalla. Mientras suena, cada 2 s se avisa en qué segundo va, así la
  // pantalla se corrige sola si se atrasó (internet lento, el video tardó en cargar).
  var MEDIOS = 'video,audio';
  var soyEspejo = false;          // este puente está en el celular (lo avisa el control)
  var LATIDO_MEDIO = 2000;
  var DEMORA_AVISO = 0.25;        // lo que tarda un aviso en llegar a la pantalla, en segundos
  var DESFASE_TOLERADO = 0.5;     // más que esto de diferencia: la pantalla salta al segundo justo
  var latidoMedio = null;
  var callados = [];              // en la pantalla: los que arrancaron callados porque nadie tocó la PC

  function medioDe(elemento) {
    if (!elemento || !elemento.matches) return null;
    return elemento.matches(MEDIOS) ? elemento : elemento.querySelector(MEDIOS);
  }
  function avisarMedio(medio) {
    avisar({ tipo: 'medio', ruta: rutaDe(medio), t: medio.currentTime || 0, reproduciendo: !medio.paused && !medio.ended, vel: medio.playbackRate || 1 });
  }
  function latir() {
    if (latidoMedio) return;
    latidoMedio = setInterval(function () {
      var sonando = Array.prototype.filter.call(document.querySelectorAll(MEDIOS), function (m) { return !m.paused && !m.ended; });
      if (!sonando.length) { clearInterval(latidoMedio); latidoMedio = null; return; }
      sonando.forEach(avisarMedio);
    }, LATIDO_MEDIO);
  }
  ['play', 'pause', 'seeked', 'ratechange'].forEach(function (tipo) {
    document.addEventListener(tipo, function (evento) {
      var medio = evento.target;
      if (!soyEspejo || !(medio instanceof HTMLMediaElement)) return;
      if (tipo === 'play') { medio.muted = true; latir(); }
      avisarMedio(medio);
    }, true);
  });

  // En la pantalla: pone el video como está en el celular.
  function ponerMedio(orden) {
    var elemento = null;
    try { elemento = document.querySelector(orden.ruta); } catch (error) { /* camino que no sirve */ }
    var medio = medioDe(elemento);
    if (!medio) return;
    var vel = orden.vel || 1;
    if (medio.playbackRate !== vel) medio.playbackRate = vel;
    var destino = orden.t + (orden.reproduciendo ? DEMORA_AVISO * vel : 0);
    if (Math.abs((medio.currentTime || 0) - destino) > DESFASE_TOLERADO) medio.currentTime = destino;
    if (orden.reproduciendo && medio.paused) {
      var arranque = medio.play();
      if (arranque && arranque.catch) arranque.catch(function (error) {
        // El navegador no deja sonar hasta que alguien toque la PC: arranca callado y se avisa.
        if (!error || error.name !== 'NotAllowedError' || medio.muted) return;
        medio.muted = true;
        if (callados.indexOf(medio) === -1) callados.push(medio);
        medio.play().catch(function () { /* ni callado: queda quieto */ });
        avisar({ tipo: 'medioCallado' });
      });
    } else if (!orden.reproduciendo && !medio.paused) {
      medio.pause();
    }
  }

  // Lo que la persona toca de verdad se avisa. Los toques repetidos por el puente no vuelven
  // a avisarse (no son «de confianza» para el navegador).
  document.addEventListener('click', function (evento) {
    if (!evento.isTrusted || !(evento.target instanceof Element)) return;
    // Tocar un video (sus botones) no se repite como clic: va por «medio», arriba.
    if (evento.target.closest(MEDIOS)) return;
    var elemento = evento.target.closest(TOCABLES) || evento.target;
    var enlace = elemento.closest('a[href]');
    // Un enlace que lleva a otra página no se repite: la pantalla va directo a esa página. Se
    // mira al terminar el toque: si la página lo atajó (un enlace que abre una ventana, como el
    // «Video» del Resumidor), no se va a ningún lado y la pantalla tiene que repetir el toque.
    var ruta = rutaDe(elemento);
    setTimeout(function () {
      var navega = !!enlace && !mismaPagina(enlace) && !evento.defaultPrevented;
      avisar({ tipo: 'clic', ruta: ruta, navega: navega });
    }, 0);
  }, true);

  var ultimoAviso = 0;
  var avisoPendiente = null;
  function avisarDesplazamiento() {
    var recorrido = document.documentElement.scrollHeight - innerHeight;
    avisar({ tipo: 'desplazar', y: recorrido > 0 ? Math.min(1, Math.max(0, scrollY / recorrido)) : 0 });
  }
  addEventListener('scroll', function () {
    var ahora = Date.now();
    clearTimeout(avisoPendiente);
    if (ahora - ultimoAviso >= 100) {
      ultimoAviso = ahora;
      avisarDesplazamiento();
    } else {
      avisoPendiente = setTimeout(avisarDesplazamiento, 100);
    }
  }, { passive: true });

  // «Página anterior» y «Página siguiente»: sigue el orden de los enlaces del menú.
  function pasarPagina(cuanto) {
    var enlaces = Array.prototype.slice.call(document.querySelectorAll('nav a[href]'));
    var actual = enlaces.findIndex(function (enlace) { return enlace.hasAttribute('aria-current'); });
    if (actual === -1) actual = enlaces.findIndex(mismaPagina);
    var destino = enlaces[actual + cuanto];
    if (actual !== -1 && destino) ir(destino.href);
  }

  // «🔄» en el celular: la página cambió en internet y el navegador tiene guardada la de antes.
  // Se piden de nuevo, salteando lo guardado, la página y sus archivos (estilos, programas e
  // imágenes del mismo sitio); recién entonces se vuelve a cargar, y sale la última versión.
  // Así funciona en cualquier navegador, sin la aplicación de PC.
  var recargando = false;
  function recargar() {
    if (recargando) return;
    // Traída: el servidor la vuelve a pedir cada vez, no hay nada guardado que saltear.
    if (TRAIDA) { location.reload(); return; }
    recargando = true;
    var direcciones = [location.href];
    var piezas = document.querySelectorAll('link[rel~="stylesheet"][href], script[src], img[src]');
    for (var i = 0; i < piezas.length && direcciones.length < 80; i++) {
      var direccion = piezas[i].href || piezas[i].currentSrc || piezas[i].src;
      try {
        if (new URL(direccion, location.href).origin === location.origin && direcciones.indexOf(direccion) === -1) direcciones.push(direccion);
      } catch (error) { /* dirección que no sirve */ }
    }
    var volver = function () { if (recargando) { recargando = false; location.reload(); } };
    Promise.all(direcciones.map(function (cual) {
      return fetch(cual, { cache: 'reload' }).catch(function () { /* sin internet: se recarga igual */ });
    })).then(volver);
    setTimeout(volver, 6000); // con internet lento no se queda esperando
  }

  addEventListener('message', function (evento) {
    if (evento.source !== window.parent || !permitido(evento.origin)) return;
    var orden = evento.data;
    if (!orden || orden.conexiones !== true) return;
    if (orden.tipo === 'recargar') { recargar(); return; }
    if (orden.tipo === 'soyEspejo') {
      soyEspejo = true;
      Array.prototype.forEach.call(document.querySelectorAll(MEDIOS), function (m) { m.muted = true; });
      return;
    }
    if (orden.tipo === 'medio' && typeof orden.ruta === 'string' && isFinite(orden.t)) { ponerMedio(orden); return; }
    if (orden.tipo === 'sonido') {
      // Alguien tocó la PC: los que arrancaron callados ya se pueden escuchar.
      callados.forEach(function (m) { m.muted = false; });
      callados = [];
      return;
    }
    if (orden.tipo === 'clic' && typeof orden.ruta === 'string') {
      var elemento = null;
      try { elemento = document.querySelector(orden.ruta); } catch (error) { /* camino que no sirve */ }
      if (!elemento) return;
      marcar(elemento);
      if (!orden.navega) elemento.click();
    } else if (orden.tipo === 'desplazar' && isFinite(orden.y)) {
      scrollTo(0, orden.y * (document.documentElement.scrollHeight - innerHeight));
    } else if (orden.tipo === 'pagina') {
      pasarPagina(orden.valor > 0 ? 1 : -1);
    }
  });

  // Los enlaces del menú de la página, para que el celular los muestre como botones.
  function menuDeLaPagina() {
    return Array.prototype.slice.call(document.querySelectorAll('nav a[href]'))
      .filter(function (enlace) { return enlace.origin === ORIGEN && enlace.textContent.trim(); })
      .slice(0, 12)
      .map(function (enlace) {
        var dibujo = enlace.querySelector('img');
        return {
          texto: enlace.textContent.trim().slice(0, 30),
          url: enlace.href,
          icono: dibujo ? (dibujo.currentSrc || dibujo.src) : '',
          actual: enlace.hasAttribute('aria-current') || mismaPagina(enlace)
        };
      });
  }

  function avisarLista() {
    avisar({ tipo: 'listo', url: AQUI.href, titulo: document.title, menu: menuDeLaPagina() });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avisarLista);
  else avisarLista();
  addEventListener('pageshow', function (evento) { if (evento.persisted) avisarLista(); });
})();
