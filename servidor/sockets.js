// ---- Tiempo real (Socket.IO) entre el control (celular) y la pantalla ----
const { identificarDesde } = require('./personas');
const { ipDe } = require('./limite-intentos');
const { parseLiveWriteBody } = require('./validadores-frase');
const { limpiarOrdenMedios, limpiarEstadoMedios } = require('./validadores-medios');
const { vigilanteDeMensajes, conectar, desconectar, pantallaConSonido } = require('./guardian');
const { limpiarDireccion, limpiarOrdenWeb, limpiarFotoWeb, limpiarMenuWeb } = require('./validadores-pagina');

// En qué foto va la presentación de cada persona. Si la pantalla se cierra o se recarga en
// medio, al volver a abrirla sigue sola desde ahí. Se olvida al tocar «Cerrar pantalla» en el
// celular o al cerrar la sesión de la pantalla.
const recuerdos = new Map();
// Lo mismo con la música, el video y «Escribir en vivo»: la pantalla que vuelve a abrirse sigue
// con la misma canción o el mismo video en el segundo en que iban, y con la letra en vivo.
const recuerdosMedios = new Map();
const recuerdosVivo = new Map();
// Pasado este tiempo con la pantalla cerrada, la música y el video ya no siguen solos.
const MEDIOS_VENCEN_MS = 6 * 60 * 60 * 1000;
function olvidarTodo(nombre) {
  recuerdos.delete(nombre);
  recuerdosMedios.delete(nombre);
  recuerdosVivo.delete(nombre);
}

// Hasta tres fotos en camino a cada celular: con el servidor lejos, mientras una va llegando ya
// sale la otra (con una sola, la ida y vuelta del aviso dejaba al celular esperando).
// Si el celular no avisa en este tiempo (se cortó, quedó en segundo plano), se le manda igual.
const FOTOS_EN_CAMINO = 3;
const FOTO_SIN_AVISO_MS = 2000;
function mandarFotoWeb(celular, foto) {
  const ahora = Date.now();
  celular.fotosEnCamino = (celular.fotosEnCamino || []).filter(t => ahora - t < FOTO_SIN_AVISO_MS);
  if (celular.avisaFotos && celular.fotosEnCamino.length >= FOTOS_EN_CAMINO) {
    celular.fotoGuardada = foto;
    return;
  }
  celular.fotosEnCamino.push(ahora);
  celular.fotoGuardada = null;
  celular.emit('webFoto', foto);
}

function registrarSockets(io) {
  io.on('connection', (socket) => {
    console.log('✨ Dispositivo vinculado');

    // 📺 Guardián de Pantallas: cada conexión puede mandar hasta cierta cantidad de mensajes por
    // segundo; lo que pase de ahí se descarta, así nadie tapa el tiempo real de los demás.
    const permitir = vigilanteDeMensajes();
    socket.use(([evento], next) => {
      if (evento === 'identificar' || permitir(socket.ownerName)) next();
    });
    socket.on('disconnect', () => {
      if (!socket.ownerName) return;
      desconectar(socket.ownerName);
      // Se fue una pantalla (cerró sesión, se recargó o se cortó): sus celulares se enteran.
      if (socket.esPantalla) avisarPantalla(socket.ownerName);
    });

    // ¿Esta persona tiene alguna pantalla abierta? Las pantallas entran a una sala propia
    // ('pantalla:' + nombre); el celular no deja tocar «Mostrar» hasta que haya una.
    const hayPantalla = (nombre) => Boolean((io.sockets.adapter.rooms.get('pantalla:' + nombre) || { size: 0 }).size);
    // El segundo dato dice si hay una presentación a medias para seguir.
    const avisarPantalla = (nombre) => io.to('owner:' + nombre).emit('hayPantalla', hayPantalla(nombre), recuerdos.has(nombre));
    // Las pantallas que se están cerrando todavía contestan un momento (mientras sale «Cerrando
    // sesión…»): lo que cuenten ya no se recuerda, si no volvería todo al abrir otra.
    function marcarCerradas(nombre) {
      for (const id of io.sockets.adapter.rooms.get('pantalla:' + nombre) || []) {
        const otro = io.sockets.sockets.get(id);
        if (otro) otro.cerrada = true;
      }
    }
    function marcarPantalla() {
      if (!socket.ownerName || socket.esPantalla) return;
      socket.esPantalla = true;
      socket.join('pantalla:' + socket.ownerName);
      avisarPantalla(socket.ownerName);
    }
    socket.on('soyPantalla', () => {
      if (!socket.ownerName) return;
      // Estaba mostrando cuando se cerró: la pantalla que entra sigue en la misma foto.
      const recuerdo = recuerdos.get(socket.ownerName);
      if (recuerdo && !socket.esPantalla) socket.emit('pantallaSeguir', recuerdo);
      if (!socket.esPantalla) {
        const vivo = recuerdosVivo.get(socket.ownerName);
        if (vivo) socket.emit('escribirVivoEstado', vivo);
        // Siempre contesta (aunque no haya nada), así la pantalla sabe que puede empezar a contar.
        const medios = recuerdosMedios.get(socket.ownerName);
        const hace = medios ? Date.now() - medios.en : 0;
        socket.emit('mediosSeguir', medios && hace < MEDIOS_VENCEN_MS ? { ...medios.estado, hace } : null);
      }
      marcarPantalla();
    });
    // La pantalla terminó (cerró su sesión o se quedó sin imágenes): no hay nada que seguir.
    // Con 'todo' (cerró su sesión) también se olvidan la música, el video y la letra en vivo.
    socket.on('pantallaOlvidar', (que) => {
      if (!socket.ownerName || !socket.esPantalla) return;
      if (que === 'todo') { socket.cerrada = true; olvidarTodo(socket.ownerName); }
      else recuerdos.delete(socket.ownerName);
    });

    // "cambiar"/"cine" van SÓLO a la sala del propio dueño (según el PIN con el
    // que el control se identificó) — antes se mandaban a TODAS las pantallas
    // conectadas sin importar el PIN, así que cualquiera podía controlar la
    // pantalla de cualquier otra persona. Si el socket todavía no se identificó
    // (por ejemplo, llegó antes de que termine el login), no tiene sala propia
    // todavía y el comando no va a ningún lado — mejor eso que mandarlo a ciegas.
    socket.on('cambiar', (accion) => {
      if (socket.ownerName) io.to('owner:' + socket.ownerName).emit('cambiar', accion);
    });
    socket.on('cine', () => {
      if (socket.ownerName) io.to('owner:' + socket.ownerName).emit('cine');
    });

    // Vincula este socket a la "sala" de su dueño (según el PIN) — así se le
    // puede mandar algo sólo a él/ella, como probar la frase final en su propia
    // pantalla sin que le aparezca a nadie más. Se repite en cada reconexión
    // porque las salas son por socket (conexión), no por dispositivo.
    // Un PIN equivocado cuenta para el límite de intentos igual que en un pedido.
    socket.on('identificar', async (pin) => {
      try {
        const { persona } = await identificarDesde(ipDe(socket.handshake.headers, socket.handshake.address), pin);
        if (persona) {
          socket.join('owner:' + persona.name);
          // Sala sólo para el ADMIN_PIN de verdad: recibe el progreso de los documentos de todos.
          if (persona.isAdmin) socket.join('admins');
          // 👤 Guardián de Usuarios: cuenta quién está conectado (una vez por conexión).
          if (socket.ownerName !== persona.name) {
            if (socket.ownerName) desconectar(socket.ownerName);
            conectar(persona.name);
          }
          socket.ownerName = persona.name; // para poder re-emitir avisos del avance automático a esta misma sala
          // Ya está en su sala: el control recién ahí le pregunta a la pantalla si ya está mostrando.
          socket.emit('identificado');
        }
      } catch (err) {
        console.error('No se pudo identificar el socket:', err.message);
      }
    });

    // Aviso del avance automático de pantalla.html (es 100% local ahí — esto es
    // sólo para que el/la dueña se entere también desde su control, ej. el
    // celular, sin tener que estar mirando la pantalla grande todo el tiempo).
    // Sólo le llega a sus propios dispositivos (misma sala 'owner:'), nunca a
    // los de otra persona.
    socket.on('avanceAutoAviso', (datos) => {
      if (socket.ownerName) io.to('owner:' + socket.ownerName).emit('avanceAutoAviso', datos);
    });

    // "Escribir en vivo": retransmite el texto tipeado en el celular a la
    // pantalla propia, letra por letra según se va escribiendo. Igual que
    // "cambiar"/"cine"/"fraseFinalAhora", sólo va a la sala del propio dueño
    // ('owner:' + nombre) — nunca a la de otra persona, aunque estén usando
    // "Escribir en vivo" al mismo tiempo.
    socket.on('escribirVivoEstado', (datos) => {
      if (!socket.ownerName) return;
      const limpio = parseLiveWriteBody(datos);
      if (!limpio) return;
      if (limpio.active) recuerdosVivo.set(socket.ownerName, limpio);
      else recuerdosVivo.delete(socket.ownerName);
      io.to('owner:' + socket.ownerName).emit('escribirVivoEstado', limpio);
    });

    // ---- Música y videos ----
    // «medios»: el celular le da una orden a su pantalla (poner, pausar, volumen, mandar un
    // video…). «mediosEstado»: la pantalla cuenta cómo va, para que el celular lo muestre.
    // «mediosPedirEstado»: un celular que recién abre la página pide ese estado.
    // «mediosPantallaActiva»: la pantalla donde se tocó «Permitir sonido» avisa que el sonido
    // es suyo, así si la misma persona tiene dos pantallas abiertas no suenan las dos.
    // Todo va sólo a la sala del propio dueño, igual que las diapositivas.
    socket.on('medios', (datos) => {
      if (!socket.ownerName) return;
      const orden = limpiarOrdenMedios(datos);
      if (orden) io.to('owner:' + socket.ownerName).emit('medios', orden);
    });
    socket.on('mediosEstado', (datos) => {
      if (!socket.ownerName) return;
      const estado = limpiarEstadoMedios(datos);
      if (!estado) return;
      // Lo que suena se recuerda, salvo que esta pantalla se esté cerrando.
      if (!socket.cerrada) {
        if (estado.musica || estado.video) {
          recuerdosMedios.set(socket.ownerName, {
            en: Date.now(),
            estado: { musica: estado.musica, video: estado.video, musicaDespues: estado.musicaDespues === true }
          });
        } else recuerdosMedios.delete(socket.ownerName);
      }
      socket.to('owner:' + socket.ownerName).emit('mediosEstado', estado);
    });
    // «¿Ya estás mostrando?»: el control que se abre (o vuelve de Gestionar) le pregunta a la
    // pantalla de la misma persona; ella contesta en qué foto va. Así «Mostrar» se toca una vez.
    socket.on('pantallaPedirEstado', () => {
      if (!socket.ownerName) return;
      socket.emit('hayPantalla', hayPantalla(socket.ownerName), recuerdos.has(socket.ownerName));
      socket.to('owner:' + socket.ownerName).emit('pantallaPedirEstado');
    });
    // «Cerrar pantalla»: quien terminó de presentar cierra, desde su celular, la sesión de sus
    // propias pantallas; quedan libres para que entre la siguiente persona. Sólo va a la sala
    // del dueño, así nadie puede cerrarle la pantalla a otro.
    socket.on('cerrarPantalla', () => {
      if (!socket.ownerName) return;
      olvidarTodo(socket.ownerName);
      marcarCerradas(socket.ownerName);
      socket.to('owner:' + socket.ownerName).emit('cerrarPantalla');
    });
    socket.on('pantallaEstado', (datos) => {
      if (!socket.ownerName || !datos || typeof datos !== 'object') return;
      // Una pantalla abierta desde antes (página guardada vieja) no avisa «soyPantalla»,
      // pero sólo las pantallas cuentan su estado: con eso alcanza para reconocerla.
      marcarPantalla();
      const z = datos.zoom && typeof datos.zoom === 'object' ? datos.zoom : {};
      const limpio = {
        mostrando: datos.mostrando === true,
        // Todavía no muestra, pero está por seguir donde había quedado.
        sigue: datos.mostrando !== true && datos.sigue === true,
        foto: Number.isInteger(datos.foto) ? datos.foto : 0,
        total: Number.isInteger(datos.total) ? datos.total : 0,
        src: typeof datos.src === 'string' ? datos.src.slice(0, 600) : '',
        // Página web en pantalla: su dirección, en cuál de sus páginas va y el tamaño de la
        // pantalla, para que el celular la muestre en chico con la misma forma.
        pagina: limpiarDireccion(datos.pagina) || '',
        paginaActual: limpiarDireccion(datos.paginaActual) || '',
        // «espejo»: la página lleva el puente. «vivo»: la abrió la app de PC y manda fotos.
        paginaModo: datos.paginaModo === 'espejo' || datos.paginaModo === 'vivo' ? datos.paginaModo : '',
        // La pantalla la muestra traída por Conexiones (no se deja mostrar adentro): el espejo también.
        paginaTraida: datos.paginaTraida === true,
        // En «vivo»: el menú que la app de PC le leyó a la página, para las cajas del celular.
        paginaMenu: datos.paginaModo === 'vivo' ? limpiarMenuWeb(datos.paginaMenu) : null,
        // ¿Esta pantalla puede agrandar una parte de la página? (la app de PC, desde la 1.3.0)
        paginaZoom: datos.paginaZoom === true,
        // Sube cada vez que la pantalla pasa sola a otra parte del menú: el espejo del celular la sigue.
        paginaPaso: Number.isInteger(datos.paginaPaso) && datos.paginaPaso > 0 ? Math.min(datos.paginaPaso, 1e9) : 0,
        ancho: Number.isInteger(datos.ancho) ? Math.min(8000, Math.max(0, datos.ancho)) : 0,
        alto: Number.isInteger(datos.alto) ? Math.min(8000, Math.max(0, datos.alto)) : 0,
        zoom: {
          z: Number.isFinite(z.z) ? Math.min(4, Math.max(1, z.z)) : 1,
          cx: Number.isFinite(z.cx) ? Math.min(1, Math.max(0, z.cx)) : 0.5,
          cy: Number.isFinite(z.cy) ? Math.min(1, Math.max(0, z.cy)) : 0.5
        }
      };
      if (limpio.mostrando && limpio.foto > 0 && !socket.cerrada) recuerdos.set(socket.ownerName, { foto: limpio.foto });
      socket.to('owner:' + socket.ownerName).emit('pantallaEstado', limpio);
    });

    // Zoom desde el celular: sólo números acotados, a la sala de la misma persona.
    socket.on('zoom', (datos) => {
      if (!socket.ownerName || !datos || typeof datos !== 'object') return;
      const numero = (v, min, max, siNo) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : siNo);
      socket.to('owner:' + socket.ownerName).emit('zoom', {
        z: numero(datos.z, 1, 4, 1),
        cx: numero(datos.cx, 0, 1, 0.5),
        cy: numero(datos.cy, 0, 1, 0.5)
      });
    });

    // Página web: lo que se toca en el espejo del celular va a las pantallas de la misma persona.
    socket.on('web', (datos) => {
      if (!socket.ownerName) return;
      const orden = limpiarOrdenWeb(datos);
      if (orden) socket.to('owner:' + socket.ownerName).emit('web', orden);
    });

    // Foto en vivo: la app de PC manda cómo se ve la página y va a los celulares de la misma persona.
    // Con un video andando la foto cambia todo el tiempo: a un celular con internet lento no se le
    // manda la siguiente hasta que avisa que mostró la anterior; mientras tanto se guarda sólo la
    // más nueva. Así no se amontonan y el celular nunca queda mirando fotos viejas. Los celulares
    // con el control de antes (no avisan) siguen recibiendo todas. El «listo» le dice a la pantalla
    // que la foto ya llegó, para que no suba la siguiente antes.
    socket.on('webFoto', (datos, listo) => {
      if (typeof listo === 'function') listo();
      if (!socket.ownerName) return;
      const foto = limpiarFotoWeb(datos);
      if (!foto) return;
      for (const id of io.sockets.adapter.rooms.get('owner:' + socket.ownerName) || []) {
        const otro = id !== socket.id && io.sockets.sockets.get(id);
        if (otro) mandarFotoWeb(otro, foto);
      }
    });
    socket.on('webFotoRecibida', () => {
      // Cuánto tardó en llegarle: la pantalla achica las fotos si algún celular va lento.
      const salio = (socket.fotosEnCamino || []).shift();
      if (salio && socket.ownerName) socket.to('owner:' + socket.ownerName).emit('webFotoTardanza', Date.now() - salio);
      socket.avisaFotos = true;
      const guardada = socket.fotoGuardada;
      socket.fotoGuardada = null;
      if (guardada) mandarFotoWeb(socket, guardada);
    });

    socket.on('mediosPedirEstado', () => {
      if (socket.ownerName) socket.to('owner:' + socket.ownerName).emit('mediosPedirEstado');
    });
    socket.on('mediosPantallaActiva', (id) => {
      if (socket.ownerName && typeof id === 'string' && id.length <= 64) {
        pantallaConSonido(socket.ownerName, id);
        socket.to('owner:' + socket.ownerName).emit('mediosPantallaActiva', id);
      }
    });
  });
}

module.exports = { registrarSockets };
