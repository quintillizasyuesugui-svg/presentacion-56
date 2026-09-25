// ---- Tiempo real (Socket.IO) entre el control (celular) y la pantalla ----
const { identificar } = require('./personas');
const { parseLiveWriteBody } = require('./validadores-frase');

function registrarSockets(io) {
  io.on('connection', (socket) => {
    console.log('✨ Dispositivo vinculado');

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
    socket.on('identificar', async (pin) => {
      try {
        const persona = await identificar(pin);
        if (persona) {
          socket.join('owner:' + persona.name);
          // Sala sólo para el ADMIN_PIN de verdad: recibe el progreso de los documentos de todos.
          if (persona.isAdmin) socket.join('admins');
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
  });
}

module.exports = { registrarSockets };
