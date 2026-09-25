// ---- Código QR para entrar al control desde el celular ----
// pantalla.html muestra este QR: se escanea con la cámara y abre control.html en el celular,
// sin tener que escribir la dirección. Se arma con la dirección con la que se abrió la
// pantalla, así funciona igual en Render, en la PC o en la red de la casa.
const QRCode = require('qrcode');

function direccionDelControl(req) {
  // En Render la app está detrás de un proxy: el protocolo real viene en X-Forwarded-Proto.
  const protocolo = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${protocolo}://${req.get('host')}/control.html`;
}

function registrarRutasCodigoQr(app) {
  // GET /api/qr-control — { direccion, svg }
  app.get('/api/qr-control', async (req, res) => {
    try {
      const direccion = direccionDelControl(req);
      const svg = await QRCode.toString(direccion, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.set('Cache-Control', 'no-store').json({ direccion, svg });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo armar el código QR.' });
    }
  });
}

module.exports = { registrarRutasCodigoQr };
