// ---- Código QR para entrar al control desde el celular ----
// pantalla.html muestra este QR: se escanea con la cámara y abre celular.html, que abre la app
// Conexiones Control si está instalada, la descarga si no (Android) o va a control.html (iPhone).
// Se arma con la dirección con la que se abrió la pantalla, así funciona igual en Render, en la PC o en la red de la casa.
const QRCode = require('qrcode');

function direccionDelControl(req) {
  // En Render la app está detrás de un proxy: el protocolo real viene en X-Forwarded-Proto.
  const protocolo = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${protocolo}://${req.get('host')}/celular.html`;
}

// Huella de la clave con la que se firma el APK de Conexiones Control (aplicacion-celular/clave-android).
// Android la compara con la del APK instalado: si coinciden, el QR abre la app directo, sin preguntar.
const HUELLA_APK = '4A:EB:B2:00:FB:01:59:18:C6:30:20:13:3D:76:91:FD:86:05:7F:B8:03:F6:58:D0:BB:D4:62:91:F3:87:B9:41';

function registrarRutasCodigoQr(app) {
  // GET /.well-known/assetlinks.json — App Links de Android (express.static no sirve carpetas con punto)
  app.get('/.well-known/assetlinks.json', (req, res) => {
    res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.conexiones.control', sha256_cert_fingerprints: [HUELLA_APK] }
    }]);
  });

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
