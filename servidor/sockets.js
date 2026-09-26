// ---- Tiempo real (Socket.IO) entre el control (celular) y la pantalla ----
const { identificarDesde } = require('./personas');
const { ipDe } = require('./limite-intentos');
const { parseLiveWriteBody } = require('./validadores-frase');
const { limpiarOrdenMedios, limpiarEstadoMedios } = require('./validadores-medios');
const { vigilanteDeMensajes, conectar, desconectar, pantallaConSonido } = require('./guardian');

function registrarSockets(io) {
  io.on('connection', (socket) => {
    console.log('✨ Dispositivo vinculado');

    // 📺 Guardián de Pantallas: cada conexión puede mandar hasta cierta cantidad de mensajes por
    // segundo; lo que pase de ahí se descarta, así nadie tapa el tiempo real de los demás.
    const permitir = vigilanteDeMensajes();
    socket.use(([evento], next) => {
      if (evento === 'identificar' || permitir(socket.ownerName)) next();
    });
    socket.on('disconnect', () => { if (socket.ownerName) desconectar(socket.ownerName); });

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
      if (estado) socket.to('owner:' + socket.ownerName).emit('mediosEstado', estado);
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
