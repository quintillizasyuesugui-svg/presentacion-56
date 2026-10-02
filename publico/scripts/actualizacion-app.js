// actualizacion-app.js — dentro de la app Conexiones Control: si hay una versión más nueva
// (descargas/version-app.json), al abrir sube una hoja desde abajo con lo que trae. «Actualizar»
// la baja con la propia app (el ícono se vuelve un anillo de progreso) y abre el instalador de
// Android. «Más tarde» la cierra hasta la próxima vez que se abra la app.
// Las apps de antes de la 1.0.4 no saben bajarla solas: a esas se les abre la descarga en el
// navegador. En el navegador común (sin app) esto no hace nada.
(function () {
  const enApp = Boolean(window.Memoria || window.App);
  if (!enApp) return;
  const actualizador = window.Actualizador || null;
  const MAS_TARDE = 'actualizacionMasTarde';
  const LARGO_ANILLO = 2 * Math.PI * 22;

  function versionActual() {
    try { return actualizador ? actualizador.versionCodigo() : 0; } catch { return 0; }
  }
  function nombreActual() {
    try { return actualizador ? actualizador.versionNombre() : ''; } catch { return ''; }
  }

  function armarHoja(datos) {
    const capa = document.createElement('div');
    capa.className = 'hoja-actualizacion-capa';
    capa.innerHTML = `
      <div class="hoja-actualizacion" role="dialog" aria-modal="true" aria-labelledby="actTitulo">
        <div class="hoja-asa" aria-hidden="true"></div>
        <div class="hoja-cabeza">
          <img class="hoja-icono" id="actIcono" src="descargas/icono-control.png" alt="">
          <div class="hoja-anillo" id="actAnillo" hidden>
            <svg viewBox="0 0 52 52" aria-hidden="true">
              <circle cx="26" cy="26" r="22" class="fondo"></circle>
              <circle cx="26" cy="26" r="22" class="avance" id="actArco"></circle>
            </svg>
            <b id="actPorcentaje">0%</b>
          </div>
          <div>
            <h2 id="actTitulo"></h2>
            <p id="actSub"></p>
          </div>
        </div>
        <ul class="hoja-novedades" id="actNovedades"></ul>
        <p class="hoja-aviso" id="actAviso" hidden></p>
        <div class="hoja-botones">
          <button type="button" class="btn" id="actLuego">Más tarde</button>
          <button type="button" class="btn primary" id="actSi">Actualizar</button>
        </div>
      </div>`;
    capa.querySelector('#actTitulo').textContent = 'Versión ' + datos.version + ' lista';
    const actual = nombreActual();
    capa.querySelector('#actSub').textContent = (actual ? 'Tenés la ' + actual : 'Tenés una versión anterior') + (datos.peso ? ' · ' + datos.peso : '');
    const lista = capa.querySelector('#actNovedades');
    for (const n of datos.novedades || []) {
      const li = document.createElement('li');
      const icono = document.createElement('i');
      icono.textContent = n.icono || '✨';
      li.append(icono, n.texto || '');
      lista.append(li);
    }
    return capa;
  }

  function mostrar(datos) {
    const capa = armarHoja(datos);
    document.body.appendChild(capa);
    requestAnimationFrame(() => capa.classList.add('show'));
    const $ = (id) => capa.querySelector('#' + id);
    const si = $('actSi');
    const aviso = $('actAviso');
    const arco = $('actArco');
    arco.style.strokeDasharray = String(LARGO_ANILLO);
    arco.style.strokeDashoffset = String(LARGO_ANILLO);

    function cerrar() {
      capa.classList.remove('show');
      setTimeout(() => capa.remove(), 300);
    }
    function avisar(texto) {
      aviso.textContent = texto;
      aviso.hidden = false;
    }

    $('actLuego').addEventListener('click', () => {
      try { sessionStorage.setItem(MAS_TARDE, datos.version); } catch { /* privado/bloqueado */ }
      cerrar();
    });

    let listo = false;
    si.addEventListener('click', () => {
      // App vieja (sin Actualizador): el enlace de otra dirección se abre en el navegador y baja ahí.
      if (!actualizador) {
        location.href = datos.apkExterno;
        avisar('Se abrió la descarga en el navegador. Cuando termine, tocá el archivo y «Actualizar».');
        return;
      }
      if (listo) {
        if (!actualizador.instalar()) avisar('Activá «Permitir de esta fuente» y volvé acá para tocar «Instalar».');
        return;
      }
      if (!actualizador.descargar(new URL(datos.apk, location.href).href)) {
        avisar('No se pudo empezar la descarga. Probá de nuevo.');
        return;
      }
      si.disabled = true;
      si.textContent = 'Bajando…';
      aviso.hidden = true;
      $('actIcono').hidden = true;
      $('actAnillo').hidden = false;
      const vigia = setInterval(() => {
        const avance = actualizador.progreso();
        if (avance < 0) {
          clearInterval(vigia);
          si.disabled = false;
          si.textContent = 'Reintentar';
          avisar('Se cortó la descarga. Revisá internet y tocá «Reintentar».');
          return;
        }
        arco.style.strokeDashoffset = String(LARGO_ANILLO * (1 - avance / 100));
        $('actPorcentaje').textContent = avance + '%';
        if (avance >= 100) {
          clearInterval(vigia);
          listo = true;
          si.disabled = false;
          si.textContent = 'Instalar';
          if (!actualizador.instalar()) avisar('Android pide permiso una sola vez: activá «Permitir de esta fuente», volvé y tocá «Instalar».');
        }
      }, 300);
    });
    si.focus();
  }

  async function revisar() {
    try {
      const res = await fetch('descargas/version-app.json', { cache: 'no-store' });
      if (!res.ok) return;
      const datos = await res.json();
      if (!(datos.codigo > versionActual())) return;
      let postergada = null;
      try { postergada = sessionStorage.getItem(MAS_TARDE); } catch { /* privado/bloqueado */ }
      if (postergada === datos.version) return;
      mostrar(datos);
    } catch { /* sin internet: se revisa la próxima vez */ }
  }

  if (document.readyState === 'complete') setTimeout(revisar, 1200);
  else window.addEventListener('load', () => setTimeout(revisar, 1200));
})();
