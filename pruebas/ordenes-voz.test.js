// Órdenes por voz: frases de ejemplo y qué tiene que entender el control con cada una.
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretarVoz } = require('../publico/scripts/ordenes-voz');

const DIAPOSITIVAS = 10;
const entiende = (frase) => interpretarVoz([frase], DIAPOSITIVAS);

// [lo que se dice, lo que tiene que entender (null = no es una orden)]
const CASOS = [
  // Diapositivas, igual que antes
  ['mostrar', { tipo: 'diapositiva', accion: 'mostrar' }],
  ['Siguiente', { tipo: 'diapositiva', accion: 'siguiente' }],
  ['atrás', { tipo: 'diapositiva', accion: 'anterior' }],
  ['anterior', { tipo: 'diapositiva', accion: 'anterior' }],
  ['tres', { tipo: 'diapositiva', accion: '3' }],
  ['diapositiva 7', { tipo: 'diapositiva', accion: '7' }],
  ['sigiente', { tipo: 'diapositiva', accion: 'siguiente' }],
  ['siguente', { tipo: 'diapositiva', accion: 'siguiente' }],
  // Música
  ['pon música', { tipo: 'medios', para: 'musica', accion: 'reproducir' }],
  ['música 1', { tipo: 'medios', para: 'musica', accion: 'elegir', numero: 1 }],
  ['pon música dos', { tipo: 'medios', para: 'musica', accion: 'elegir', numero: 2 }],
  ['pon la canción 3', { tipo: 'medios', para: 'musica', accion: 'elegir', numero: 3 }],
  ['siguiente canción', { tipo: 'medios', para: 'musica', accion: 'siguiente' }],
  ['canción anterior', { tipo: 'medios', para: 'musica', accion: 'anterior' }],
  ['pausa', { tipo: 'medios', para: null, accion: 'pausar' }],
  ['pausa la música', { tipo: 'medios', para: 'musica', accion: 'pausar' }],
  ['reproducir', { tipo: 'medios', para: null, accion: 'reproducir' }],
  ['reproduce', { tipo: 'medios', para: null, accion: 'reproducir' }],
  // Volumen
  ['baja volumen', { tipo: 'medios', para: null, accion: 'bajarVolumen' }],
  ['bájale', { tipo: 'medios', para: null, accion: 'bajarVolumen' }],
  ['sube el volumen', { tipo: 'medios', para: null, accion: 'subirVolumen' }],
  ['ponlo a la mitad', { tipo: 'medios', para: null, accion: 'volumen', valor: 50 }],
  ['volumen a la mitad', { tipo: 'medios', para: null, accion: 'volumen', valor: 50 }],
  ['volumen al máximo', { tipo: 'medios', para: null, accion: 'volumen', valor: 100 }],
  ['volumen 30', { tipo: 'medios', para: null, accion: 'volumen', valor: 30 }],
  ['bolumen treinta', { tipo: 'medios', para: null, accion: 'volumen', valor: 30 }],
  ['silencio', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['baja el volumen del video', { tipo: 'medios', para: 'video', accion: 'bajarVolumen' }],
  // Volumen con número: «a N» lo deja en N; un número suelto con sube/baja lo mueve esa cantidad
  ['baja 0', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['baja a cero', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['volumen cero', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['volumen 0', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['sube 20', { tipo: 'medios', para: null, accion: 'subirVolumen', valor: 20 }],
  ['sube el volumen quince', { tipo: 'medios', para: null, accion: 'subirVolumen', valor: 15 }],
  ['baja diez', { tipo: 'medios', para: null, accion: 'bajarVolumen', valor: 10 }],
  ['baja la música 30', { tipo: 'medios', para: 'musica', accion: 'bajarVolumen', valor: 30 }],
  ['sube el volumen a 80', { tipo: 'medios', para: null, accion: 'volumen', valor: 80 }],
  ['baja al 10', { tipo: 'medios', para: null, accion: 'volumen', valor: 10 }],
  ['pon el volumen en 60', { tipo: 'medios', para: null, accion: 'volumen', valor: 60 }],
  ['volumen treinta y cinco', { tipo: 'medios', para: null, accion: 'volumen', valor: 35 }],
  ['volumen veinticinco', { tipo: 'medios', para: null, accion: 'volumen', valor: 25 }],
  ['volumen del video setenta y dos', { tipo: 'medios', para: 'video', accion: 'volumen', valor: 72 }],
  ['sin sonido', { tipo: 'medios', para: null, accion: 'volumen', valor: 0 }],
  ['quita el silencio', { tipo: 'medios', para: null, accion: 'conSonido' }],
  ['activa el sonido', { tipo: 'medios', para: null, accion: 'conSonido' }],
  ['con sonido', { tipo: 'medios', para: null, accion: 'conSonido' }],
  ['sube la pc 10', { tipo: 'medios', para: 'pc', accion: 'subirVolumen', valor: 10 }],
  ['baja la computadora a cero', { tipo: 'medios', para: 'pc', accion: 'volumen', valor: 0 }],
  ['quita el silencio de la pc', { tipo: 'medios', para: 'pc', accion: 'mudo', valor: false }],
  // Diapositivas por nombre
  ['última diapositiva', { tipo: 'diapositiva', accion: '10' }],
  ['la última', { tipo: 'diapositiva', accion: '10' }],
  ['primera diapositiva', { tipo: 'diapositiva', accion: '1' }],
  ['ve a la diapositiva nueve', { tipo: 'diapositiva', accion: '9' }],
  ['la última vez que fuimos', null],
  // Zoom con números y formas (fotos y páginas web)
  ['agranda 50', { tipo: 'zoom', accion: 'acercar', valor: 50 }],
  ['agranda 50 por ciento', { tipo: 'zoom', accion: 'acercar', valor: 50 }],
  ['achica 30', { tipo: 'zoom', accion: 'alejar', valor: 30 }],
  ['al doble', { tipo: 'zoom', accion: 'escala', valor: 200 }],
  ['agranda al 150', { tipo: 'zoom', accion: 'escala', valor: 150 }],
  ['derecha 20', { tipo: 'zoom', accion: 'derecha', valor: 20 }],
  ['sube la imagen 10', { tipo: 'zoom', accion: 'arriba', valor: 10 }],
  ['un cuadrado', { tipo: 'zoom', accion: 'forma', forma: 'cuadrado' }],
  ['rectángulo alto', { tipo: 'zoom', accion: 'forma', forma: 'alto' }],
  ['agranda un rectángulo', { tipo: 'zoom', accion: 'forma', forma: 'largo' }],
  ['cuadrado 30', { tipo: 'zoom', accion: 'forma', forma: 'cuadrado', valor: 30 }],
  // Botones y ayuda
  ['zona', { tipo: 'boton', id: 'zonaBtn' }],
  ['pantalla completa', { tipo: 'boton', id: 'fsPcBtn' }],
  ['pantalla completa en mi celular', { tipo: 'boton', id: 'fsPhoneBtn' }],
  ['actualiza la página', { tipo: 'boton', id: 'actualizarBtn' }],
  ['abre la música', { tipo: 'boton', id: 'musicaBtn' }],
  ['lista de videos', { tipo: 'boton', id: 'videoBtn' }],
  ['ayuda', { tipo: 'ayuda' }],
  ['qué puedo decir', { tipo: 'ayuda' }],
  // Más órdenes de música y video
  ['qué canción es', { tipo: 'medios', para: 'musica', accion: 'cual' }],
  ['qué suena', { tipo: 'medios', para: null, accion: 'cual' }],
  ['termina la música', { tipo: 'medios', para: 'musica', accion: 'terminar' }],
  ['canción al azar', { tipo: 'medios', para: 'musica', accion: 'azar' }],
  ['pon la canción despacito', { tipo: 'medios', para: 'musica', accion: 'buscar', texto: 'despacito' }],
  ['pon el video del volcán', { tipo: 'medios', para: 'video', accion: 'buscar', texto: 'volcan' }],
  ['ve al minuto dos', { tipo: 'medios', para: null, accion: 'ir', valor: 120 }],
  ['ve al segundo treinta del video', { tipo: 'medios', para: 'video', accion: 'ir', valor: 30 }],
  ['más fuerte', { tipo: 'medios', para: null, accion: 'subirVolumen' }],
  ['más suave', { tipo: 'medios', para: null, accion: 'bajarVolumen' }],
  ['segunda diapositiva', { tipo: 'diapositiva', accion: '2' }],
  // Filo habla o se calla
  ['Filo cállate', { tipo: 'filo', habla: false }],
  ['no hables', { tipo: 'filo', habla: false }],
  ['Filo habla', { tipo: 'filo', habla: true }],
  // Buscar en YouTube
  ['busca camilo', { tipo: 'youtube', texto: 'camilo' }],
  ['búscame en youtube la canción de camilo', { tipo: 'youtube', texto: 'cancion de camilo' }],
  ['busca un video de gatos', { tipo: 'youtube', texto: 'gatos' }],
  // Volumen de Windows (con la app de PC)
  ['sube el volumen de la PC', { tipo: 'medios', para: 'pc', accion: 'subirVolumen' }],
  ['baja la compu', { tipo: 'medios', para: 'pc', accion: 'bajarVolumen' }],
  ['volumen de la computadora a 40', { tipo: 'medios', para: 'pc', accion: 'volumen', valor: 40 }],
  ['PC al máximo', { tipo: 'medios', para: 'pc', accion: 'volumen', valor: 100 }],
  ['silencia la pc', { tipo: 'medios', para: 'pc', accion: 'mudo', valor: true }],
  ['quita el silencio de la PC', { tipo: 'medios', para: 'pc', accion: 'mudo', valor: false }],
  // Video
  ['pon video 1', { tipo: 'medios', para: 'video', accion: 'elegir', numero: 1 }],
  ['video dos', { tipo: 'medios', para: 'video', accion: 'elegir', numero: 2 }],
  ['siguiente video', { tipo: 'medios', para: 'video', accion: 'siguiente' }],
  ['pausa el video', { tipo: 'medios', para: 'video', accion: 'pausar' }],
  ['quita el video', { tipo: 'medios', para: 'video', accion: 'terminar' }],
  ['reproducir video', { tipo: 'medios', para: 'video', accion: 'reproducir' }],
  // Bucle, desde el inicio, adelantar y atrasar
  ['bucle', { tipo: 'medios', para: 'musica', accion: 'bucle', valor: true }],
  ['repetir la canción', { tipo: 'medios', para: 'musica', accion: 'bucle', valor: true }],
  ['quita el bucle', { tipo: 'medios', para: 'musica', accion: 'bucle', valor: false }],
  ['sin repetir', { tipo: 'medios', para: 'musica', accion: 'bucle', valor: false }],
  ['poner inicio música', { tipo: 'medios', para: 'musica', accion: 'reiniciar' }],
  ['música desde el inicio', { tipo: 'medios', para: 'musica', accion: 'reiniciar' }],
  ['reiniciar', { tipo: 'medios', para: null, accion: 'reiniciar' }],
  ['desde el principio', { tipo: 'medios', para: null, accion: 'reiniciar' }],
  ['inicio', { tipo: 'diapositiva', accion: 'mostrar' }],
  ['adelanta la música', { tipo: 'medios', para: 'musica', accion: 'saltar', valor: 10 }],
  ['que adelante la música', { tipo: 'medios', para: 'musica', accion: 'saltar', valor: 10 }],
  ['adelanta 30 segundos', { tipo: 'medios', para: null, accion: 'saltar', valor: 30 }],
  ['adelanta un minuto la canción', { tipo: 'medios', para: 'musica', accion: 'saltar', valor: 60 }],
  ['retrocede a la mitad', { tipo: 'medios', para: null, accion: 'irMitad' }],
  ['ve a la mitad de la canción', { tipo: 'medios', para: 'musica', accion: 'irMitad' }],
  ['ponlo a la mitad', { tipo: 'medios', para: null, accion: 'volumen', valor: 50 }],
  ['un poco más', { tipo: 'repetir' }],
  ['más', { tipo: 'repetir' }],
  ['otro poco', { tipo: 'repetir' }],
  ['adelanta 2 minutos', { tipo: 'medios', para: null, accion: 'saltar', valor: 120 }],
  ['adelanta 10', { tipo: 'medios', para: null, accion: 'saltar', valor: 10 }],
  ['retrocede 20', { tipo: 'medios', para: null, accion: 'saltar', valor: -20 }],
  ['video adelante 10', { tipo: 'medios', para: 'video', accion: 'saltar', valor: 10 }],
  ['adelanta el video', { tipo: 'medios', para: 'video', accion: 'saltar', valor: 10 }],
  ['retrocede el video', { tipo: 'medios', para: 'video', accion: 'saltar', valor: -10 }],
  ['retrocede la canción', { tipo: 'medios', para: 'musica', accion: 'saltar', valor: -10 }],
  ['atrasa el video 20 segundos', { tipo: 'medios', para: 'video', accion: 'saltar', valor: -20 }],
  ['adelante', { tipo: 'diapositiva', accion: 'siguiente' }],
  ['retrocede', { tipo: 'diapositiva', accion: 'anterior' }],
  // Cerrar la pantalla al terminar
  ['cierra', { tipo: 'cerrar' }],
  ['cierra la pantalla', { tipo: 'cerrar' }],
  ['cerrar sesión', { tipo: 'cerrar' }],
  ['cierra el video', { tipo: 'medios', para: 'video', accion: 'terminar' }],
  ['al cerrar la puerta se escucha un ruido muy fuerte', null],
  // Ir al final, casi al final, a la mitad o al inicio de lo que suena
  ['vete al final del video', { tipo: 'medios', para: 'video', accion: 'irFinal' }],
  ['casi al final', { tipo: 'medios', para: null, accion: 'irCasiFinal' }],
  ['vete casi al final de la música', { tipo: 'medios', para: 'musica', accion: 'irCasiFinal' }],
  ['vete al final', { tipo: 'medios', para: null, accion: 'irFinal' }],
  ['vete a la mitad', { tipo: 'medios', para: null, accion: 'irMitad' }],
  ['vete al inicio', { tipo: 'medios', para: null, accion: 'reiniciar' }],
  ['al inicio mi música', { tipo: 'medios', para: 'musica', accion: 'reiniciar' }],
  // Imagen hasta el borde y centrar
  ['vete hasta el final abajo', { tipo: 'zoom', accion: 'borde-abajo' }],
  ['vete arriba al tope', { tipo: 'zoom', accion: 'borde-arriba' }],
  ['arriba del todo', { tipo: 'zoom', accion: 'borde-arriba' }],
  ['a la derecha del todo', { tipo: 'zoom', accion: 'borde-derecha' }],
  ['imagen al final', { tipo: 'zoom', accion: 'borde-abajo' }],
  ['centra', { tipo: 'zoom', accion: 'centrar' }],
  ['al centro', { tipo: 'zoom', accion: 'centrar' }],
  ['centra la imagen', { tipo: 'zoom', accion: 'centrar' }],
  ['el centro de la ciudad queda lejos de la costa', null],
  // Tamaño de la imagen
  ['agranda la imagen', { tipo: 'zoom', accion: 'acercar' }],
  ['agranda', { tipo: 'zoom', accion: 'acercar' }],
  ['acerca la foto', { tipo: 'zoom', accion: 'acercar' }],
  ['más grande', { tipo: 'zoom', accion: 'acercar' }],
  ['achica la imagen', { tipo: 'zoom', accion: 'alejar' }],
  ['achícala', { tipo: 'zoom', accion: 'alejar' }],
  ['más chico', { tipo: 'zoom', accion: 'alejar' }],
  ['aleja', { tipo: 'zoom', accion: 'alejar' }],
  ['tamaño normal', { tipo: 'zoom', accion: 'normal' }],
  ['imagen completa', { tipo: 'zoom', accion: 'normal' }],
  // Mover la imagen agrandada
  ['derecha', { tipo: 'zoom', accion: 'derecha' }],
  ['a la izquierda', { tipo: 'zoom', accion: 'izquierda' }],
  ['isquierda', { tipo: 'zoom', accion: 'izquierda' }],
  ['arriba', { tipo: 'zoom', accion: 'arriba' }],
  ['abajo', { tipo: 'zoom', accion: 'abajo' }],
  ['sube la imagen', { tipo: 'zoom', accion: 'arriba' }],
  ['baja la foto', { tipo: 'zoom', accion: 'abajo' }],
  ['sube', { tipo: 'medios', para: null, accion: 'subirVolumen' }],
  ['el pueblo queda más abajo siguiendo el curso del río', null],
  // Lo que NO es una orden: frases de quien está explicando algo
  ['este es un país muy grande con mucha gente', null],
  ['lo normal es que llueva en esta época del año', null],
  ['la temperatura baja mucho durante la noche en el desierto', null],
  ['en este cuadro vemos la mitad de la población del país', null],
  ['hay que parar un momento a pensar qué significa esto', null],
  ['hola a todos', null],
  ['volumen', null],
  ['', null]
];

for (const [frase, esperado] of CASOS) {
  test(`«${frase}» → ${esperado ? esperado.accion + (esperado.para ? ' (' + esperado.para + ')' : '') : 'no es una orden'}`, () => {
    assert.deepEqual(entiende(frase), esperado);
  });
}

test('si la primera versión de lo oído no es una orden, se usa la siguiente', () => {
  assert.deepEqual(interpretarVoz(['si gente', 'siguiente'], DIAPOSITIVAS), { tipo: 'diapositiva', accion: 'siguiente' });
});

test('un número más alto que la cantidad de diapositivas no hace nada', () => {
  assert.equal(interpretarVoz(['veinte'], DIAPOSITIVAS), null);
});
