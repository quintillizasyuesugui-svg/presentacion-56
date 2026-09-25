// LibreOffice simulado para las pruebas: recibe los mismos argumentos que soffice
// y deja en --outdir un PDF de 5 páginas. Si el archivo se llama «danado.*» falla,
// como LibreOffice con un documento roto.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const carpeta = args[args.indexOf('--outdir') + 1];
const entrada = args[args.length - 1];

if (!args.includes('--headless') || !args.includes('--convert-to') || !carpeta || !fs.existsSync(entrada)) {
  console.error('argumentos inesperados:', args.join(' '));
  process.exit(2);
}
if (fs.readFileSync(entrada, 'utf8').includes('DANADO')) {
  console.error('Error: source file could not be loaded');
  process.exit(1);
}
const salida = path.join(carpeta, path.basename(entrada, path.extname(entrada)) + '.pdf');
fs.copyFileSync(path.join(__dirname, 'muestra-5-paginas.pdf'), salida);
