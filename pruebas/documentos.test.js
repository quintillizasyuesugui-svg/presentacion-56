// Pruebas de «Subir documento» del lado del servidor: Word/Excel/PowerPoint → PDF.
// Usan un LibreOffice simulado (datos-prueba/soffice-simulado.js), así corren en
// cualquier PC sin instalar LibreOffice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SIMULADO = path.join(__dirname, 'datos-prueba', 'soffice-simulado.js');
const MUESTRA = fs.readFileSync(path.join(__dirname, 'datos-prueba', 'muestra-5-paginas.pdf'));
const { convertirAPdf, EXTENSIONES_OFFICE } = require('../servidor/conversion-office');

function temporalesDeConversion() {
  return fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('conexiones-doc-')).length;
}

test('Word, Excel y PowerPoint se convierten a PDF', async () => {
  process.env.LIBREOFFICE_RUTA = SIMULADO;
  for (const nombre of ['informe.docx', 'notas.xlsx', 'clase.pptx', 'viejo.doc', 'tabla.ods']) {
    const pdf = await convertirAPdf(Buffer.from('contenido de prueba'), nombre);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF', nombre);
    assert.ok(pdf.equals(MUESTRA), nombre);
  }
});

test('acepta los formatos de Office y de LibreOffice, no otros', () => {
  for (const e of ['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.odt', '.ods', '.odp']) assert.ok(EXTENSIONES_OFFICE.includes(e), e);
  for (const e of ['.pdf', '.exe', '.js', '.zip', '']) assert.ok(!EXTENSIONES_OFFICE.includes(e), e);
});

test('un tipo de archivo no permitido se rechaza con 400 sin llamar a LibreOffice', async () => {
  process.env.LIBREOFFICE_RUTA = SIMULADO;
  await assert.rejects(convertirAPdf(Buffer.from('x'), 'programa.exe'), (err) => err.estado === 400);
  await assert.rejects(convertirAPdf(Buffer.from('x'), 'sin-extension'), (err) => err.estado === 400);
});

test('si el servidor no tiene LibreOffice, avisa claro (503)', async () => {
  process.env.LIBREOFFICE_RUTA = path.join(os.tmpdir(), 'no-existe-soffice-conexiones.exe');
  await assert.rejects(convertirAPdf(Buffer.from('x'), 'informe.docx'), (err) => err.estado === 503 && /LibreOffice/.test(err.message));
});

test('un documento dañado da un error entendible (422)', async () => {
  process.env.LIBREOFFICE_RUTA = SIMULADO;
  await assert.rejects(convertirAPdf(Buffer.from('DANADO'), 'danado.docx'), (err) => err.estado === 422 && /dañado/.test(err.message));
});

test('varias conversiones seguidas no dejan archivos temporales', async () => {
  process.env.LIBREOFFICE_RUTA = SIMULADO;
  const antes = temporalesDeConversion();
  const resultados = await Promise.allSettled([
    convertirAPdf(Buffer.from('a'), 'a.docx'),
    convertirAPdf(Buffer.from('DANADO'), 'b.pptx'),
    convertirAPdf(Buffer.from('c'), 'c.xlsx')
  ]);
  assert.deepEqual(resultados.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(temporalesDeConversion(), antes);
});
