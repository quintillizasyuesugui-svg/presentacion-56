// Aviso chico de «Subir documento» en control.html y gestionar.html: si hay un documento
// procesándose, muestra el avance en vivo aunque estés en otra página. Tocarlo lleva a
// Modo avanzado, donde está el detalle. Sólo aparece si ya hay un PIN guardado.
(function () {
  if (!window.getAuth || !getAuth()) return;

  const aviso = document.createElement('a');
  aviso.className = 'doc-aviso';
  aviso.href = 'avanzado.html';
  aviso.hidden = true;
  const texto = document.createElement('span');
  texto.className = 'doc-aviso-texto';
  const barra = document.createElement('span');
  barra.className = 'doc-aviso-barra';
  const relleno = document.createElement('span');
  barra.append(relleno);
  aviso.append(texto, barra);
  // Va dentro de la página, arriba de todo: si flotara encima, taparía el nombre y «Cerrar sesión».
  (document.querySelector('.app') || document.body).prepend(aviso);

  TrabajosDocumentos.escuchar((lista) => {
    const activos = lista.filter(TrabajosDocumentos.esActivo);
    const trabajando = activos.filter((t) => t.fase !== 'eligiendo');
    if (!activos.length) {
      aviso.hidden = true;
      return;
    }
    aviso.hidden = false;
    const t = trabajando[0] || activos[0];
    const otros = activos.length > 1 ? ` (+${activos.length - 1})` : '';
    if (t.fase === 'eligiendo') {
      texto.textContent = `📄 ${t.nombre}: elegí las páginas${otros} ›`;
      barra.hidden = true;
    } else {
      texto.textContent = `📄 ${t.nombre}${t.porcentaje !== null ? ' · ' + t.porcentaje + ' %' : ' · convirtiendo…'}${otros} ›`;
      barra.hidden = false;
      barra.classList.toggle('indeterminado', t.porcentaje === null);
      relleno.style.width = t.porcentaje === null ? '' : t.porcentaje + '%';
    }
  });
  TrabajosDocumentos.identificar();
})();
