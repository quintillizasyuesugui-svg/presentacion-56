// Portero de pedidos: cuida todas las puertas (páginas y API), no sólo el registro.
// Cuenta los pedidos de cada conexión (IP) por minuto. Una clase usando la app manda unos
// 45 pedidos por minuto por pantalla y menos por celular, así que el tope es alto: sólo frena a
// quien manda miles por minuto desde la misma conexión. Las conexiones VIP (donde entró el
// admin o alguien con fotos, ver limite-registros.js) tienen un tope VECES_VIP veces más alto,
// para que una escuela entera detrás de la misma IP use la app sin que nadie quede frenado.
// No reemplaza a una protección de red (Cloudflare): contra un ataque enorme desde miles de
// conexiones lo que se cae es la conexión de Render, antes de llegar acá.
const { ipDe } = require('./limite-intentos');
const { conexionConfiable, VECES_VIP } = require('./limite-registros');

const POR_MINUTO = Number(process.env.PEDIDOS_POR_MINUTO) || 3000;
const MINUTO = 60 * 1000;

// Ventana fija de un minuto por conexión: barata (un número por IP) y suficiente para frenar.
let ventana = { desde: Date.now(), cuentas: new Map() };

function porteroDePedidos(req, res, next) {
  const ahora = Date.now();
  if (ahora - ventana.desde >= MINUTO) ventana = { desde: ahora, cuentas: new Map() };
  const ip = ipDe(req.headers, req.socket.remoteAddress);
  const cuenta = (ventana.cuentas.get(ip) || 0) + 1;
  ventana.cuentas.set(ip, cuenta);
  if (cuenta <= POR_MINUTO) return next();
  if (cuenta <= POR_MINUTO * VECES_VIP && conexionConfiable(ip)) return next();
  const segundos = Math.max(1, Math.ceil((ventana.desde + MINUTO - ahora) / 1000));
  res.set('Retry-After', String(segundos));
  res.status(429).json({ error: `Demasiados pedidos desde esta conexión. Esperá ${segundos} segundos.` });
}

// ---- Conexiones en tiempo real (Socket.IO) ----
// Esas conexiones no pasan por el portero de arriba (las atiende Socket.IO antes que Express),
// así que sin tope alguien podía abrir miles y dejar al servidor sin memoria. Cada conexión (IP)
// puede tener CONEXIONES_POR_IP abiertas a la vez; las VIP, VECES_VIP veces más. A la que se
// pasa se le dice que espere: el celular o la pantalla reintentan solos cada pocos segundos.
const CONEXIONES_POR_IP = Number(process.env.CONEXIONES_POR_IP) || 600;
const abiertas = new Map(); // ip → cuántas conexiones tiene abiertas ahora

function entrarConexion(ip) {
  const cuenta = abiertas.get(ip) || 0;
  const tope = conexionConfiable(ip) ? CONEXIONES_POR_IP * VECES_VIP : CONEXIONES_POR_IP;
  if (cuenta >= tope) return false;
  abiertas.set(ip, cuenta + 1);
  return true;
}

function salirConexion(ip) {
  const cuenta = (abiertas.get(ip) || 0) - 1;
  if (cuenta > 0) abiertas.set(ip, cuenta); else abiertas.delete(ip);
}

function porteroDeConexiones(io) {
  io.use((socket, next) => {
    const ip = ipDe(socket.handshake.headers, socket.handshake.address);
    if (!entrarConexion(ip)) return next(new Error('Hay demasiadas conexiones desde esta red. Esperá un momento: se vuelve a intentar solo.'));
    socket.on('disconnect', () => salirConexion(ip));
    next();
  });
}

module.exports = { porteroDePedidos, porteroDeConexiones, entrarConexion, salirConexion, POR_MINUTO, CONEXIONES_POR_IP };
