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
    return enlace.origin === location.origin && enlace.pathname === location.pathname && enlace.search === location.search;
  }

  // Lo que la persona toca de verdad se avisa. Los toques repetidos por el puente no vuelven
  // a avisarse (no son «de confianza» para el navegador).
  document.addEventListener('click', function (evento) {
    if (!evento.isTrusted || !(evento.target instanceof Element)) return;
    var elemento = evento.target.closest(TOCABLES) || evento.target;
    var enlace = elemento.closest('a[href]');
    // Un enlace que lleva a otra página no se repite: la pantalla va directo a esa página.
    var navega = !!enlace && !mismaPagina(enlace);
    avisar({ tipo: 'clic', ruta: rutaDe(elemento), navega: navega });
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
    if (actual !== -1 && destino) location.href = destino.href;
  }

  addEventListener('message', function (evento) {
    if (evento.source !== window.parent || !permitido(evento.origin)) return;
    var orden = evento.data;
    if (!orden || orden.conexiones !== true) return;
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
      .filter(function (enlace) { return enlace.origin === location.origin && enlace.textContent.trim(); })
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
    avisar({ tipo: 'listo', url: location.href, titulo: document.title, menu: menuDeLaPagina() });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avisarLista);
  else avisarLista();
  addEventListener('pageshow', function (evento) { if (evento.persisted) avisarLista(); });
})();
