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

module.exports = { porteroDePedidos, POR_MINUTO };
