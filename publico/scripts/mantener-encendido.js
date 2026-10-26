// mantener-encendido.js — mientras el control o la pantalla están abiertos, el aparato no apaga
// su pantalla. En el celular, si se apagara, el navegador corta la conexión y la presentación
// queda sin control; en la PC se apagaría el monitor en plena exposición. El permiso se pierde al
// cambiar de app o minimizar: al volver a la página se pide de nuevo. Los navegadores sin Wake
// Lock (o sin https) siguen como siempre. La app de PC lo hace por su cuenta (principal.js).
(function () {
  if (!('wakeLock' in navigator)) return;
  let bloqueo = null;

  async function pedir() {
    if (bloqueo || document.visibilityState !== 'visible') return;
    try {
      bloqueo = await navigator.wakeLock.request('screen');
      bloqueo.addEventListener('release', () => { bloqueo = null; });
    } catch {
      bloqueo = null;
    }
  }

  document.addEventListener('visibilitychange', pedir);
  // Algunos navegadores sólo lo dan después de un toque: se vuelve a pedir con el primero.
  document.addEventListener('pointerdown', pedir, { passive: true });
  pedir();
})();
