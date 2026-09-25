// Seguimiento en vivo de los documentos que el servidor está procesando («Subir documento»).
// El servidor avisa cada paso por Socket.IO («documentoProgreso»). Al abrir o recargar la
// página, y cada vez que se reconecta, se piden todos los trabajos de nuevo (GET /api/documentos):
// así el progreso sigue aunque te vayas, recargues o se corte un momento la conexión.
(function () {
  const FASES_ACTIVAS = ['preparando', 'eligiendo', 'procesando'];
  const trabajos = new Map();
  const oyentes = new Set();
  let socket = null;

  function lista() {
    return [...trabajos.values()].sort((a, b) => a.creado - b.creado);
  }

  function avisarOyentes() {
    const actual = lista();
    oyentes.forEach((f) => f(actual));
  }

  async function refrescar() {
    if (!window.getAuth || !getAuth()) return;
    const res = await authFetch('/api/documentos');
    if (!res.ok) return;
    const recibidos = await res.json();
    trabajos.clear();
    recibidos.forEach((t) => trabajos.set(t.id, t));
    avisarOyentes();
  }

  function conectar() {
    if (socket) return;
    socket = io();
    socket.on('connect', () => {
      const auth = window.getAuth && getAuth();
      if (auth) socket.emit('identificar', auth.pin); // para recibir los avisos de la sala propia
      refrescar().catch(() => {});
    });
    socket.on('documentoProgreso', (t) => {
      trabajos.set(t.id, t);
      avisarOyentes();
    });
  }

  function textoPeso(bytes) {
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' MB';
  }

  window.TrabajosDocumentos = {
    FASES_ACTIVAS,
    esActivo: (t) => FASES_ACTIVAS.includes(t.fase),
    // Llama a `funcion(lista)` ahora y cada vez que algo cambie.
    escuchar(funcion) {
      oyentes.add(funcion);
      conectar();
      funcion(lista());
      return () => oyentes.delete(funcion);
    },
    refrescar,
    // Llamar cuando la página ya tiene el PIN (por ejemplo, justo después de ingresarlo):
    // une el socket a la sala propia para recibir los avisos en vivo.
    identificar() {
      conectar();
      const auth = window.getAuth && getAuth();
      if (auth && socket.connected) socket.emit('identificar', auth.pin);
    },
    // Por si el aviso del socket llega después que la respuesta HTTP.
    actualizar(t) {
      trabajos.set(t.id, t);
      avisarOyentes();
    },
    quitar(id) {
      trabajos.delete(id);
      avisarOyentes();
    },
    // «1,2 MB (el documento pesaba 8,4 MB, −86 %)»
    textoResultado(t) {
      const r = t.resultado;
      if (!r) return '';
      const ahorro = r.pesoOriginal > 0 ? Math.round((1 - r.pesoFinal / r.pesoOriginal) * 100) : 0;
      return `${r.subidas} ${r.subidas === 1 ? 'diapositiva' : 'diapositivas'} · ${textoPeso(r.pesoFinal)}` +
        (ahorro > 0 ? ` (el documento pesaba ${textoPeso(r.pesoOriginal)}, −${ahorro} %)` : '');
    },
    textoPeso
  };
})();
