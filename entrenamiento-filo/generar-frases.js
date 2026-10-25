// Arma las frases para entrenar a Filo: muchas formas de pedir cada orden, frases con dos órdenes
// juntas y frases de clase que NO son órdenes. Siempre salen las mismas (semilla fija).
//   datos/entrenar.jsonl  → para aprender     { frase, salida, clase }
//   datos/prueba.jsonl    → para medir, con formas de decir que el entrenamiento no ve
// salida = lo que tiene que contestar la IA («vol.bajar 10 ; musica.siguiente» o «nada»).
// clase  = lo que aprende el modelo del celular (una etiqueta, «ia» o «nada»).
// Uso: node entrenamiento-filo/generar-frases.js
const fs = require('fs');
const path = require('path');
const { ETIQUETAS, CON_TEXTO, NADA, IA, normalizar } = require('../publico/scripts/filo-piensa');

let semilla = 20261025;
function azar() {
  semilla = (semilla + 0x6D2B79F5) >>> 0;
  let t = semilla;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const uno = (lista) => lista[Math.floor(azar() * lista.length)];

const PALABRA = { 1: 'uno', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez', 12: 'doce', 15: 'quince', 20: 'veinte', 25: 'veinticinco', 30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa' };
const comoSeDice = (n) => (PALABRA[n] && azar() < 0.5 ? PALABRA[n] : String(n));

const CANCIONES = ['despacito', 'la bamba', 'el condor pasa', 'cumpleanos feliz', 'baby shark', 'vivir mi vida', 'la flor de la canela', 'color esperanza', 'el pollito pio', 'himno nacional', 'el baile del sapito', 'la cucaracha', 'mi peru', 'contigo peru', 'waka waka', 'la vaca lola'];
const VIDEOS = ['el volcan', 'los dinosaurios', 'el sistema solar', 'el ciclo del agua', 'la fotosintesis', 'los planetas', 'machu picchu', 'las vocales', 'los numeros', 'el cuerpo humano', 'los animales de la selva', 'la tabla del dos'];
const BUSQUEDAS = ['dibujos animados', 'cuentos para ninos', 'experimentos de ciencia', 'la historia del peru', 'canciones infantiles', 'tutorial de origami', 'el sistema digestivo', 'videos de gatos', 'la independencia del peru', 'como hacer un volcan'];

// Cada orden: [formas que mandan (tú), formas en infinitivo (para «puedes…», «quiero…»)].
// {n} = un número, {t} = un nombre. Las formas marcadas con * sólo salen en la prueba.
const FORMAS = {
  'diap.mostrar': [['empieza la presentacion', 'arranca con las fotos', 'comienza a mostrar', 'muestra las imagenes', '*abre la presentacion en la pantalla', 'pon las fotos en la tele', 'dale inicio a la presentacion', 'enciende la presentacion'], ['empezar la presentacion', 'mostrar las fotos', '*arrancar con las imagenes', 'comenzar la clase con las fotos']],
  'diap.siguiente': [['pasa a la otra', 'dale a la que sigue', 'cambia de foto', 'la que sigue', 'pasa', 'otra foto', '*cambia a la proxima imagen', 'muestra la otra', 'adelanta una foto', 'pasa la diapositiva', 'cambiala', 'dale next', '*vamos con la que viene', 'pasale', 'una mas'], ['pasar a la otra', 'cambiar de foto', '*ver la que sigue', 'pasar la diapositiva', 'mostrar la otra imagen']],
  'diap.anterior': [['regresa una', 'vuelve a la de antes', 'la de antes', 'la foto anterior', 'muestra la que paso', '*retrocede una imagen', 'regresate', 'para atras', 'devuelvete una foto', '*vuelve a la que estaba', 'echate para atras'], ['volver a la de antes', 'regresar una foto', '*ver la foto que paso', 'retroceder una']],
  'diap.ultima': [['ve a la ultima foto', 'pon la ultima imagen', 'salta hasta el final de las fotos', '*muestra la foto final', 'la ultimita'], ['ver la ultima foto', 'ir a la ultima imagen', '*saltar a la ultima diapositiva']],
  'diap.ir': [['ve a la foto {n}', 'pon la imagen {n}', 'salta a la diapositiva {n}', 'muestra la numero {n}', '*llevame a la foto {n}', 'la {n} por favor', 'cambia a la imagen {n}', '*quiero la {n}'], ['ir a la foto {n}', 'ver la imagen numero {n}', '*saltar a la diapositiva {n}']],
  'medio.pausar': [['para eso', 'detenlo un momento', 'paralo ahi', 'esperate', 'congelalo', '*ponle pausa', 'quieto ahi', 'para un ratito', '*stop'], ['parar eso un momento', 'pausar lo que suena', '*detener eso']],
  'medio.reproducir': [['dale play', 'sigue sonando', 'que siga', 'continua con eso', 'dale de nuevo', '*vuelve a ponerlo', 'quitale la pausa', '*play otra vez'], ['seguir con eso', 'darle play', '*quitar la pausa']],
  'medio.reiniciar': [['empiezalo de nuevo', 'desde el principio', 'otra vez desde cero', '*ponlo desde el comienzo', 'vuelve a empezar'], ['empezarlo de nuevo', '*volverlo al principio']],
  'medio.mitad': [['llevalo a la mitad', 'pasalo hasta la mitad', '*saltate a la mitad'], ['llevarlo a la mitad', '*ir a la mitad']],
  'medio.final': [['llevalo al final', 'pasalo hasta el final', '*saltate hasta el final'], ['llevarlo al final', '*ir al final']],
  'medio.adelantar': [['adelantalo {n} segundos', 'pasa {n} segundos para adelante', 'salta {n} segundos', 'corre {n} segundos', '*adelantale un poquito', 'mas adelante {n} segundos'], ['adelantar {n} segundos', '*saltar unos segundos']],
  'medio.atrasar': [['regresalo {n} segundos', 'atrasa {n} segundos', 'vuelve {n} segundos atras', '*rebobinalo un poco', 'echalo para atras {n} segundos'], ['regresar {n} segundos', '*rebobinar un poquito']],
  'musica.reproducir': [['ponme algo de musica', 'pon una cancion', 'que suene musica', 'musica maestro', 'ponme algo tranquilo', 'pon algo alegre para la clase', '*ambienta con musica', 'ponnos una cancioncita', '*que haya musica'], ['poner musica', 'escuchar una cancion', '*oir algo de musica']],
  'musica.pausar': [['para la musica', 'pausa la cancion un rato', 'deten la musica', '*calla la musica un momento', 'pausa esa cancion'], ['parar la musica', '*pausar la cancion']],
  'musica.siguiente': [['cambia de cancion', 'otra cancion', 'pasa a la otra cancion', 'esta no me gusta cambiala', '*pon la que sigue de musica', 'salta esta cancion', 'la otra cancion'], ['cambiar de cancion', 'saltar esta cancion', '*escuchar otra cancion']],
  'musica.anterior': [['pon la cancion de antes', 'regresa a la cancion anterior', '*la cancion que sono antes', 'vuelve a la otra cancion'], ['volver a la cancion de antes', '*escuchar la cancion anterior']],
  'musica.elegir': [['pon la cancion numero {n}', 'la cancion {n}', 'pon el tema {n}', '*ponme la musica {n}', 'que suene la {n} de la lista de musica'], ['escuchar la cancion {n}', '*poner el tema numero {n}']],
  'musica.buscar': [['pon {t}', 'ponme la de {t}', 'quiero escuchar {t}', 'que suene {t}', '*busca la cancion {t} en mi musica', 'pon la cancion de {t}'], ['escuchar {t}', 'poner {t}', '*oir la cancion {t}']],
  'musica.azar': [['pon cualquier cancion', 'una cancion cualquiera', 'sorprendeme con una cancion', '*elige tu una cancion', 'la que sea de musica'], ['escuchar cualquier cancion', '*poner una cancion al azar']],
  'musica.terminar': [['quita la musica', 'apaga la musica', 'ya no quiero musica', 'basta de musica', '*sin musica por favor', 'cierra la cancion'], ['quitar la musica', 'apagar la cancion', '*terminar con la musica']],
  'musica.bucle': [['repite la cancion siempre', 'que se repita esta cancion', 'ponla en repetir', '*que suene una y otra vez'], ['repetir esta cancion', '*dejar la cancion en bucle']],
  'musica.sinBucle': [['ya no repitas la cancion', 'quita lo de repetir', '*que no se repita mas'], ['dejar de repetir la cancion', '*quitar el bucle']],
  'musica.cual': [['como se llama esta cancion', 'que cancion esta sonando', 'que tema es este', '*dime el nombre de la cancion'], ['saber que cancion es', '*conocer el nombre de esta cancion']],
  'video.reproducir': [['pon un video', 'ponme un video', 'muestra un video', '*quiero ver un videito', 'pasa un video en la tele'], ['ver un video', 'poner un video', '*mostrar un video']],
  'video.pausar': [['para el video', 'pausa el video un rato', 'deten el video', '*congela el video'], ['parar el video', '*pausar el video']],
  'video.siguiente': [['otro video', 'pasa al otro video', 'cambia de video', '*pon el video que sigue'], ['ver otro video', '*cambiar de video']],
  'video.anterior': [['el video de antes', 'regresa al video anterior', '*vuelve al otro video'], ['ver el video de antes', '*volver al video anterior']],
  'video.elegir': [['pon el video numero {n}', 'el video {n}', 'muestra el video {n}', '*ponme el video {n} de la lista'], ['ver el video {n}', '*poner el video numero {n}']],
  'video.buscar': [['pon el video de {t}', 'muestra el video sobre {t}', 'quiero ver el video de {t}', '*ponme el de {t} en video'], ['ver el video de {t}', '*mostrar el video sobre {t}']],
  'video.azar': [['pon cualquier video', 'un video cualquiera', '*sorprendeme con un video'], ['ver cualquier video', '*poner un video al azar']],
  'video.terminar': [['quita el video', 'cierra el video', 'ya no quiero el video', 'saca el video de la pantalla', '*apaga el video'], ['quitar el video', 'cerrar el video', '*sacar el video']],
  'vol.subir': [['mas fuerte', 'no se escucha', 'subele', 'subele {n}', 'que suene mas alto', 'pon mas alto', '*no se oye nada', 'mas volumen', 'aumentale {n}', '*subelo un poco', 'mas fuerte que no escuchan atras'], ['subir el volumen', 'subirle {n}', '*poner mas fuerte']],
  'vol.bajar': [['mas despacio', 'muy fuerte', 'esta muy alto', 'bajale {n}', 'bajale un poquito', 'mas bajito', 'que suene mas suave', '*me duelen los oidos', 'menos volumen', '*bajalo un poco', 'esta muy fuerte'], ['bajar el volumen', 'bajarle {n}', '*poner mas bajito']],
  'vol.poner': [['pon el volumen en {n}', 'deja el volumen en {n}', 'volumen al {n}', 'el sonido en {n}', '*sonido al {n} por ciento'], ['dejar el volumen en {n}', '*poner el sonido en {n}']],
  'vol.mitad': [['pon el sonido a la mitad', 'deja el volumen a medias', '*volumen a medio'], ['dejar el volumen a la mitad', '*poner el sonido a medias']],
  'vol.maximo': [['a todo volumen', 'subelo todo', 'lo mas fuerte que se pueda', '*al maximo el sonido'], ['subir todo el volumen', '*poner a todo volumen']],
  'vol.silencio': [['callalo', 'sin sonido', 'apaga el sonido', 'que no suene nada', 'quitale el sonido', '*mudo', 'silencio total'], ['quitar el sonido', 'apagar el volumen', '*dejarlo sin sonido']],
  'vol.sonido': [['devuelvele el sonido', 'que vuelva a sonar', 'prende el sonido', '*ponle sonido otra vez', 'quita el mudo'], ['devolverle el sonido', 'prender el sonido', '*quitar el mudo']],
  'pc.subir': [['sube el volumen de la computadora', 'mas fuerte la compu', 'que la computadora suene mas alto', '*subele {n} a la pc', 'sube los parlantes'], ['subir el volumen de la computadora', '*subirle a los parlantes']],
  'pc.bajar': [['baja el volumen de la computadora', 'mas bajo la compu', 'que la pc suene mas suave', '*bajale {n} a la compu', 'baja los parlantes'], ['bajar el volumen de la computadora', '*bajarle a los parlantes']],
  'pc.silencio': [['silencia la computadora', 'apaga el sonido de la compu', 'que la pc no suene', '*mutea los parlantes'], ['silenciar la computadora', '*apagar el sonido de la pc']],
  'pc.sonido': [['devuelve el sonido a la computadora', 'prende el sonido de la compu', '*quita el mudo de la pc'], ['prender el sonido de la computadora', '*devolverle el sonido a la pc']],
  'zoom.acercar': [['acercate', 'mas grande la foto', 'hazla mas grande', 'no se ve bien agrandala', 'haz zoom', 'acerca un poco', 'zoom', '*amplia esa parte', 'que se vea mas grande', 'agrandala {n}', '*no se ve nada de lejos'], ['agrandar la foto', 'hacer zoom', 'ver mas de cerca', '*ampliar la imagen']],
  'zoom.alejar': [['alejate', 'mas chiquita la foto', 'hazla mas chica', 'quita un poco de zoom', '*reduce esa imagen', 'aleja un poco', 'achicala {n}'], ['achicar la foto', 'alejar la imagen', '*ver mas de lejos']],
  'zoom.normal': [['quita el zoom', 'deja la foto como estaba', 'la foto completa', 'que se vea toda la imagen', '*vuelve al tamano de antes', 'sin zoom'], ['quitar el zoom', 'ver la foto completa', '*dejar la imagen normal']],
  'zoom.centrar': [['ponla al centro', 'centra la foto', 'al medio', '*llevala al centro'], ['centrar la foto', '*poner la imagen en el medio']],
  'zoom.doble': [['el doble de grande', 'hazla dos veces mas grande', '*agrandala al doble'], ['agrandar al doble', '*hacerla el doble de grande']],
  'zoom.derecha': [['muevete a la derecha', 'mas a la derecha', 'corre la foto a la derecha', 'para la derecha', '*ve hacia la derecha'], ['moverla a la derecha', '*ir a la derecha']],
  'zoom.izquierda': [['muevete a la izquierda', 'mas a la izquierda', 'corre la foto a la izquierda', 'para la izquierda', '*ve hacia la izquierda'], ['moverla a la izquierda', '*ir a la izquierda']],
  'zoom.arriba': [['muevete para arriba', 'mas arriba', 'sube la foto', 'muestra la parte de arriba', '*ve hacia arriba'], ['ver la parte de arriba', '*mover la foto para arriba']],
  'zoom.abajo': [['muevete para abajo', 'mas abajo', 'baja la foto', 'muestra la parte de abajo', '*ve hacia abajo'], ['ver la parte de abajo', '*mover la foto para abajo']],
  'zoom.cuadrado': [['muestra solo un cuadrado', 'recorta un cuadrado en el medio', '*solo un cuadradito'], ['mostrar solo un cuadrado', '*recortar un cuadrado']],
  'boton.completa': [['pon la pantalla completa', 'que ocupe toda la tele', 'agranda la pantalla entera', '*sin bordes en la tele'], ['poner pantalla completa', '*ver en toda la pantalla']],
  'boton.actualizar': [['recarga la pagina', 'refresca', 'actualiza eso', 'se trabo recargala', '*vuelve a cargar la pagina'], ['recargar la pagina', 'actualizar la pagina', '*refrescar']],
  'ayuda': [['que puedo decirte', 'que sabes hacer', 'como te uso', 'dime que ordenes hay', '*que cosas entiendes'], ['saber que puedo decir', 'ver la ayuda', '*conocer las ordenes']],
  'cerrar': [['cierra todo', 'terminamos la presentacion', 'apaga la presentacion', 'ya acabamos cierra', '*fin de la clase cierra la pantalla'], ['cerrar la presentacion', 'terminar la clase', '*cerrar la pantalla']],
  'repetir': [['otra vez', 'un poquito mas', 'de nuevo', 'mas', 'otro poquito', '*igual otra vez'], ['hacerlo otra vez', '*repetir lo mismo']],
  'filo.calla': [['ya no hables', 'callate filo', 'no me respondas', 'silencio filo', '*no digas nada'], ['que no hables', '*que te calles']],
  'filo.habla': [['vuelve a hablar', 'contestame filo', 'habla otra vez', '*ya puedes responder'], ['que vuelvas a hablar', '*que me contestes']],
  'youtube': [['busca en youtube {t}', 'buscame un video de {t} en youtube', 'pon en youtube {t}', 'encuentra en youtube {t}', '*quiero ver en youtube {t}', 'abre youtube y busca {t}'], ['buscar en youtube {t}', 'ver en youtube {t}', '*encontrar en youtube {t}']]
};

const NUMEROS_DE = {
  'diap.ir': [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15], 'musica.elegir': [1, 2, 3, 4, 5], 'video.elegir': [1, 2, 3, 4],
  'medio.adelantar': [5, 10, 15, 20, 30], 'medio.atrasar': [5, 10, 15, 20, 30], 'vol.subir': [10, 20, 30], 'vol.bajar': [10, 20, 30],
  'vol.poner': [10, 20, 30, 40, 50, 60, 70, 80, 90], 'pc.subir': [10, 20], 'pc.bajar': [10, 20], 'zoom.acercar': [20, 30, 50], 'zoom.alejar': [20, 30, 50]
};
const TEXTOS_DE = { 'musica.buscar': CANCIONES, 'video.buscar': VIDEOS, 'youtube': BUSQUEDAS };

// Cómo empieza y termina la frase. Las marcadas con * sólo salen en la prueba.
const ANTES = ['', '', '', 'filo ', 'oye filo ', 'filo por favor ', 'por favor ', 'a ver ', 'ya ', 'oye ', 'ahora ', 'este ', '*hey filo ', '*bueno filo ', '*filito ', '*ya filo '];
const PEDIR = ['puedes ', 'podrias ', 'me puedes ', 'quiero ', 'necesito ', 'me ayudas a ', 'vamos a ', '*seria bueno ', '*quisiera ', '*me haces el favor de '];
const DESPUES = ['', '', '', ' por favor', ' porfa', ' ya', ' filo', ' ahora', ' rapido', '* porfis', '* ahorita', '* si puedes'];
const entra = (x, prueba) => (x.startsWith('*') ? prueba : true);
const sinMarca = (x) => x.replace(/^\*/, '');

// El reconocedor a veces oye mal: una letra que se pierde o una palabra corta que no se oye.
// (No se cambian letras: «parar» podría volverse «pasar», que es otra orden.)
function oirMal(frase) {
  if (azar() < 0.88) return frase;
  const palabras = frase.split(' ');
  const i = Math.floor(azar() * palabras.length);
  const p = palabras[i];
  if (p.length > 4) {
    const j = 1 + Math.floor(azar() * (p.length - 2));
    palabras[i] = p.slice(0, j) + p.slice(j + 1);
  } else if (palabras.length > 3) palabras.splice(i, 1);
  return palabras.join(' ');
}

function rellenar(forma, etiqueta) {
  let n = null;
  let t = '';
  let frase = forma;
  if (frase.includes('{n}')) { n = uno(NUMEROS_DE[etiqueta]); frase = frase.replace('{n}', comoSeDice(n)); }
  if (frase.includes('{t}')) { t = uno(TEXTOS_DE[etiqueta]); frase = frase.replace('{t}', t); }
  let salida = etiqueta;
  if (n !== null) salida += ' ' + n;
  if (t) salida += ' "' + t + '"';
  return { frase, salida, n, t };
}

// Una frase para una orden: las formas que mandan van solas; las de infinitivo con «puedes…».
function unaFrase(etiqueta, prueba) {
  const [mandan, infinitivo] = FORMAS[etiqueta];
  const usarInf = azar() < 0.35;
  const formas = (usarInf ? infinitivo : mandan).filter(f => (prueba ? f.startsWith('*') : !f.startsWith('*')));
  const lista = formas.length ? formas : (usarInf ? infinitivo : mandan).filter(f => !f.startsWith('*'));
  const forma = sinMarca(uno(lista));
  const r = rellenar(forma, etiqueta);
  const antes = sinMarca(uno(ANTES.filter(x => entra(x, prueba) || !x.startsWith('*') )));
  const pedir = usarInf ? sinMarca(uno(PEDIR.filter(x => !x.startsWith('*') || prueba))) : '';
  const despues = sinMarca(uno(DESPUES.filter(x => !x.startsWith('*') || prueba)));
  return { ...r, frase: (antes + pedir + r.frase + despues).replace(/\s+/g, ' ').trim() };
}

// Frases de clase: alguien explicando. Tienen palabras parecidas a las órdenes («baja», «sube»,
// «siguiente», «música») para que el modelo aprenda que no siempre son órdenes.
const TEMAS = ['la fotosintesis', 'el ciclo del agua', 'la revolucion industrial', 'los incas', 'el sistema solar', 'las fracciones', 'la celula', 'la independencia del peru', 'los volcanes', 'la tabla periodica', 'el cuerpo humano', 'la cadena alimenticia', 'las plantas', 'el clima de la sierra', 'la musica andina', 'los numeros primos'];
const CHARLA = [
  'hoy vamos a aprender sobre {tema}', 'como ven en esta imagen {tema} es muy importante', 'esto que ven aqui es parte de {tema}',
  'la temperatura baja mucho en la noche', 'cuando sube la marea el agua llega hasta aqui', 'presten atencion chicos',
  'alguien sabe que es {tema}', 'en la siguiente clase veremos {tema}', 'la musica de los incas usaba quenas y zampoñas',
  'el volumen de un cubo se calcula multiplicando sus lados', 'saquen su cuaderno por favor', 'quien me puede decir que ven en la foto',
  'esta parte de arriba se llama copa del arbol', 'fijense en el lado derecho del dibujo', 'la imagen muestra como era lima antes',
  'muy bien esa es la respuesta correcta', 'levanten la mano si tienen dudas', 'vamos a leer juntos este parrafo',
  'el agua se evapora cuando hace calor', 'los planetas giran alrededor del sol', 'hagan silencio un momento que estoy explicando',
  'mañana hay examen de {tema}', 'pedro deja de conversar', 'que hora es en japon', 'cuanto es dos mas dos', 'como te llamas',
  'cuentame un chiste', 'que dia es hoy', 'tengo hambre', 'abran el libro en la pagina veinte', 'repitan despues de mi',
  'el sonido viaja mas rapido en el agua', 'la pelicula que vimos ayer era de {tema}', 'en el video de ayer vimos {tema}',
  'la cancion habla de {tema}', 'ese volcan esta en arequipa', 'esta foto la tome en el viaje', 'despues del recreo seguimos con {tema}',
  'por eso es importante cuidar {tema}', 'ahora escriban un resumen de {tema}', 'el primer paso es leer el problema',
  'la parte de abajo de la hoja tiene las preguntas', 'esta imagen es mas grande que la otra', 'a ver maria lee la siguiente pregunta',
  '*los dinosaurios vivieron hace millones de años', '*nadie se mueve de su sitio', '*el examen sera muy facil si estudian',
  '*mi perro se llama filo', '*la proxima semana es el dia de la madre', '*hay que traer cartulina para el lunes'
];
const ABRE_CHARLA = ['', '', '', 'bueno ', 'chicos ', 'a ver chicos ', 'ya ', 'ahora ', 'entonces ', 'miren ', 'atencion ', 'muy bien '];
const CIERRA_CHARLA = ['', '', '', ' de acuerdo', ' entendieron', ' ya', ' chicos', ' verdad', ' no es cierto'];
function unaCharla(prueba) {
  const lista = CHARLA.filter(x => (prueba ? x.startsWith('*') || azar() < 0.15 : !x.startsWith('*')));
  let frase = uno(ABRE_CHARLA) + sinMarca(uno(lista)).replace('{tema}', uno(TEMAS));
  if (azar() < 0.3) frase += ' y ' + sinMarca(uno(lista)).replace('{tema}', uno(TEMAS));
  return frase + uno(CIERRA_CHARLA);
}

// Dos órdenes juntas: «baja la música y pasa a la siguiente».
const UNIR = [' y ', ' y luego ', ' y tambien ', ' y despues ', ' y ademas '];
const PARA_JUNTAR = Object.keys(FORMAS).filter(e => !['repetir', 'ayuda', 'cerrar', 'filo.calla', 'filo.habla', 'diap.mostrar', 'youtube'].includes(e));
function dosJuntas(prueba) {
  const a = uno(PARA_JUNTAR);
  let b = uno(PARA_JUNTAR);
  while (b.split('.')[0] === a.split('.')[0] && b !== a) b = uno(PARA_JUNTAR);
  if (b === a) b = 'diap.siguiente';
  const x = unaFrase(a, prueba);
  const y = unaFrase(b, prueba);
  const sinFilo = (f) => f.replace(/^(oye |hey |bueno |ya |a ver )?fil(o|ito) (por favor )?/, '');
  return { frase: x.frase + uno(UNIR) + sinFilo(y.frase), salida: x.salida + ' ; ' + y.salida, clase: IA };
}

function armar(cuantas, prueba) {
  const lista = [];
  const vistas = new Set();
  const etiquetas = Object.keys(FORMAS);
  let intentos = 0;
  while (lista.length < cuantas && intentos++ < cuantas * 20) {
    const r = azar();
    let item;
    if (r < 0.14) { const f = unaCharla(prueba); item = { frase: f, salida: NADA, clase: NADA }; }
    else if (r < 0.24) item = dosJuntas(prueba);
    else {
      const e = uno(etiquetas);
      const x = unaFrase(e, prueba);
      item = { frase: x.frase, salida: x.salida, clase: CON_TEXTO.includes(e) ? IA : e };
    }
    item.frase = normalizar(oirMal(item.frase));
    if (!item.frase || vistas.has(item.frase)) continue;
    vistas.add(item.frase);
    lista.push(item);
  }
  return lista;
}

for (const e of Object.keys(FORMAS)) if (!ETIQUETAS[e]) throw new Error('Etiqueta sin orden: ' + e);
for (const e of Object.keys(ETIQUETAS)) if (!FORMAS[e]) throw new Error('Orden sin frases: ' + e);
const entrenar = armar(24000, false);
const yaEstan = new Set(entrenar.map(x => x.frase));
const prueba = armar(2500, true).filter(x => !yaEstan.has(x.frase));
const carpeta = path.join(__dirname, 'datos');
fs.mkdirSync(carpeta, { recursive: true });
const escribir = (nombre, lista) => fs.writeFileSync(path.join(carpeta, nombre), lista.map(x => JSON.stringify(x)).join('\n') + '\n');
escribir('entrenar.jsonl', entrenar);
escribir('prueba.jsonl', prueba);
const cuenta = (lista, c) => lista.filter(x => x.clase === c).length;
console.log(`entrenar: ${entrenar.length} frases (${cuenta(entrenar, NADA)} charla, ${cuenta(entrenar, IA)} para la IA)`);
console.log(`prueba:   ${prueba.length} frases (${cuenta(prueba, NADA)} charla, ${cuenta(prueba, IA)} para la IA)`);
