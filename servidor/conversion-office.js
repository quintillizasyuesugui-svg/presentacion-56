// ---- Word, Excel y PowerPoint → PDF con LibreOffice ----
const { execFile } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const EXTENSIONES_OFFICE = ['.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'];
const TIEMPO_MAXIMO_MS = 90 * 1000;

class ErrorDocumento extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

// Dónde está LibreOffice: variable LIBREOFFICE_RUTA, la instalación típica de
// Windows, o "soffice" (Linux / Docker). Si LIBREOFFICE_RUTA termina en .js se
// corre con Node: sirve para las pruebas automáticas sin instalar LibreOffice.
function programaLibreOffice() {
  const elegido = process.env.LIBREOFFICE_RUTA;
  if (elegido && elegido.endsWith('.js')) return { comando: process.execPath, antes: [elegido] };
  if (elegido) return { comando: elegido, antes: [] };
  if (process.platform === 'win32') {
    return { comando: 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', antes: [] };
  }
  return { comando: 'soffice', antes: [] };
}

function ejecutar(comando, args, opciones) {
  return new Promise((resolver, rechazar) => {
    execFile(comando, args, opciones, (error, salida, errores) => {
      if (error) {
        error.salida = String(errores || salida || '');
        rechazar(error);
      } else {
        resolver(salida);
      }
    });
  });
}

async function convertirAPdf(contenido, nombreOriginal) {
  const extension = path.extname(nombreOriginal || '').toLowerCase();
  if (!EXTENSIONES_OFFICE.includes(extension)) {
    throw new ErrorDocumento('Ese tipo de archivo no se puede convertir. Usá PDF, Word, Excel o PowerPoint.', 400);
  }
  const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'conexiones-doc-'));
  try {
    const entrada = path.join(carpeta, 'documento' + extension);
    await fs.writeFile(entrada, contenido);
    const { comando, antes } = programaLibreOffice();
    // Perfil propio en la carpeta temporal: no choca con otro LibreOffice abierto y se borra al final.
    const perfil = pathToFileURL(path.join(carpeta, 'perfil')).href;
    try {
      await ejecutar(comando, [...antes, `-env:UserInstallation=${perfil}`, '--headless', '--norestore', '--nolockcheck',
        '--convert-to', 'pdf', '--outdir', carpeta, entrada], { timeout: TIEMPO_MAXIMO_MS, killSignal: 'SIGKILL', windowsHide: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new ErrorDocumento('Este servidor no tiene LibreOffice, así que no puede convertir Word, Excel ni PowerPoint. Guardalo como PDF y subilo.', 503);
      }
      if (err.killed || err.signal) {
        throw new ErrorDocumento('El documento tardó demasiado en convertirse. Probá guardarlo como PDF y subirlo.', 504);
      }
      console.error('LibreOffice falló:', err.message, err.salida);
      throw new ErrorDocumento('No se pudo convertir el documento. Revisá que no esté dañado o con contraseña.', 422);
    }
    try {
      return await fs.readFile(path.join(carpeta, 'documento.pdf'));
    } catch {
      throw new ErrorDocumento('No se pudo convertir el documento. Revisá que no esté dañado o con contraseña.', 422);
    }
  } finally {
    await fs.rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { convertirAPdf, ErrorDocumento, EXTENSIONES_OFFICE };
