// Sólo por compatibilidad: si el servicio en Render arranca con «node server.js»,
// sigue funcionando. Todo el servidor vive en servidor/ (npm start usa servidor/index.js).
require('./servidor/index.js');
