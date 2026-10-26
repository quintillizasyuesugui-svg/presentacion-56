// El control (y su modo avanzado) se maneja desde el celular. Abierto en una PC, la ventana
// se parte en dos: a la izquierda el QR para abrirlo en el celular y a la derecha el botón
// para usar esta PC como pantalla. Celulares, tablets y pantallas táctiles siguen como siempre.
(function () {
  const ua = navigator.userAgent;
  const movil = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPad que se presenta como Mac
  let tactil = false;
  try { tactil = matchMedia('(any-pointer: coarse)').matches; } catch { /* navegador viejo */ }
  if (movil || tactil) { ajustarTablet(); return; }

  // Se esconde el control desde ya (antes de que se dibuje) y se pone el aviso apenas hay <body>.
  document.documentElement.classList.add('control-en-pc');

  function pintar() {
    const aviso = document.createElement('div');
    aviso.className = 'solo-celular';
    aviso.id = 'soloCelular';
    aviso.innerHTML =
      '<div class="solo-celular-mitades">' +
        '<div class="solo-celular-mitad izq">' +
          '<div class="solo-celular-qr" id="soloCelularQr" aria-label="Código QR para abrir el control en el celular"></div>' +
          '<h1>📱 El control va en el celular</h1>' +
          '<p>Escaneá el código con la cámara del celular y entrá con tu PIN.</p>' +
        '</div>' +
        '<div class="solo-celular-mitad der">' +
          '<div class="solo-celular-pantallita" aria-hidden="true">📺</div>' +
          '<h2>Esta PC es la pantalla</h2>' +
          '<p>Abrila y mostrala en el proyector o la tele.</p>' +
          '<a class="btn primary" href="pantalla.html">Abrir la pantalla</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(aviso);
    fetch('/api/qr-control')
      .then((res) => res.json())
      .then((datos) => { document.getElementById('soloCelularQr').innerHTML = datos.svg; })
      .catch(() => {
        document.getElementById('soloCelularQr').textContent = 'Abrí ' + location.host + '/control.html en el celular';
      });
  }
  if (document.body) pintar();
  else document.addEventListener('DOMContentLoaded', pintar);

  // Tablet: el mismo control del celular, agrandado parejo hasta llenar la pantalla (sin
  // franjas vacías a los costados). Se mide como si fuera un celular de 460 × 780 y se
  // agranda lo que haga falta; en un celular (o acostado, sin alto) no cambia nada.
  function ajustarTablet() {
    const raiz = document.documentElement;
    function medir() {
      const tablet = innerWidth >= 700 && innerHeight >= 600;
      const z = tablet ? Math.max(1, Math.min(innerWidth / 460, innerHeight / 780, 1.8)) : 1;
      raiz.classList.toggle('es-tablet', tablet);
      raiz.style.zoom = z > 1 ? z.toFixed(3) : '';
      // Con zoom, «100dvh» también se agranda y sobra alto: el CSS usa este alto ya achicado.
      raiz.style.setProperty('--alto-tablet', (innerHeight / z).toFixed(1) + 'px');
    }
    medir();
    addEventListener('resize', medir);
  }
})();
