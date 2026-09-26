# Conexiones - Presentación Interactiva

## 🎬 Demo
Controla diapositivas en tiempo real:
- **Pantalla** (`/pantalla.html`): Muestra imágenes
- **Control** (`/control.html`): Botones anterior/mostrar/siguiente/fullscreen/voz
- **Gestionar imágenes** (`/gestionar.html`, antes `/manage.html` — el enlace viejo sigue funcionando): Subir, ordenar y borrar diapositivas desde el celular
- **Modo avanzado** (`/avanzado.html`): tamaño y posición, unir imágenes, subir documento, frase final y avance automático
- **Música y videos** (`/multimedia.html`, pestañas en Gestionar): subir canciones y videos o guardar enlaces de YouTube, y manejarlos desde el celular mientras presentás

## 🎵 Música y videos
- **Subir**: en Gestionar → 🎵 Música o 🎬 Videos. Música MP3/M4A/OGG/WAV hasta 15 MB; video
  MP4/WEBM/MOV hasta 100 MB. Los videos se achican a 720p **en el celular** antes de subir
  (Mediabunny, `publico/vendor/`), así gastan menos espacio. Con Cloudinary, el celular sube
  directo a Cloudinary con una firma del servidor (el archivo no pasa por la memoria de Render).
- **YouTube**: se guarda sólo el enlace (no ocupa espacio). Tiene que ser público o no listado;
  se puede elegir desde qué minuto y hasta cuál se muestra.
- **Borrar varios**: «☑️ Seleccionar», marcar y «🗑️ Borrar». El admin ve y borra lo de todos.
- **En el control**: «🎵 Música» (▶/⏸, barra para arrastrar con el dedo, ±10 s, siguiente,
  volumen y lista) y «🎬 Video» (se manda a la pantalla). La línea chica del reproductor aparece
  también en Gestionar y Modo avanzado.
- **En la pantalla**: tocar una vez «🔊 Permitir sonido» (los navegadores no dejan sonar nada
  sin un toque; «Ir a pantalla completa» también sirve). La música suena encima de todo; un
  video pausa todo (música, avance automático, texto en vivo) y al terminar vuelve a la misma
  diapositiva. Si la misma persona abre dos pantallas, suena sólo la última donde se permitió.
- **Espacio por persona**: `PRESUPUESTO_MB` (12 GB) se reparte entre las personas
  registradas, entre `ESPACIO_MIN_MB` (100) y `ESPACIO_MAX_MB` (2000). Con pocas personas cada
  una tiene más; con muchas, menos. El admin puede fijarle un espacio propio a alguien.
- Al borrar una cuenta se borran también su música y sus videos.

## 🛡️ Los 4 guardianes (`servidor/guardian.js`)
Para que con muchos usuarios no se atore el servidor gratis:
- **👤 Usuarios**: nadie acapara (máximo de subidas en curso por persona, turnos justos) y
  cuenta quién está conectado.
- **👷 Tareas**: «empleados» que suben imágenes (también las páginas de PDF y documentos),
  música y videos en paralelo. Si crece la fila contrata más (hasta un máximo) y después
  vuelven al mínimo. El próximo turno es para quien menos tareas tiene en curso.
- **📦 Almacenamiento**: reparte el espacio, cuida el cupo por hora de Cloudinary
  (`CUPO_NUBE_POR_HORA`, 400) y explica por qué cuando a alguien no le alcanza.
- **📺 Pantallas**: la música y los videos de cada persona van sólo a su pantalla y frena a
  quien manda más de 30 mensajes por segundo.
El admin los ve en Modo avanzado → Personas, con sus últimas decisiones y el motivo.

## 📄 Subir documento (Modo avanzado)

Subí un **PDF, Word, Excel o PowerPoint** y cada página se convierte en una diapositiva:

1. Tocá «Subir documento» y elegí uno o varios archivos (hasta 25 MB cada uno).
2. El servidor detecta las páginas («Detecté 5 páginas») y muestra las miniaturas en una fila:
   se desliza con el dedo o con las flechas ◀ ▶. Tocá una página para verla en grande
   (con ◀ Anterior / Siguiente ▶ y «Volver»); el círculo ✓ la marca o la quita.
   Nada se agrega al show hasta tocar «Subir».
3. Elegí la calidad (Liviana / Normal / Alta, en WebP) y si recortar los márgenes blancos.
4. «Subir»: el progreso se ve en vivo. **Podés salir o recargar la página**: el servidor sigue
   trabajando y, al volver, la barra continúa donde iba. En Control y Gestionar aparece un aviso
   con el avance. Al terminar dice cuánto pesa (por ejemplo «0,5 MB; el documento pesaba 0,9 MB, −45 %»).

- Cada persona ve y maneja sólo sus documentos; el admin (`ADMIN_PIN`) ve los de todos.
- Los documentos se procesan de a uno para no pasar la memoria de Render; si hay varios, los
  demás esperan con «Esperando turno».
- Los PDF funcionan en cualquier servidor. **Word, Excel y PowerPoint necesitan LibreOffice**:
  en Render hay que usar el servicio con **Docker** (el `Dockerfile` ya lo instala, con fuentes
  compatibles con las de Office). Sin LibreOffice, la app avisa «Guardalo como PDF y subilo».
- Si Render reinicia el servidor mientras procesa, **el trabajo no se pierde**: al volver a arrancar
  sigue desde la página donde iba (las ya subidas no se repiten). Para eso, en Render hace falta la
  base de datos (`DATABASE_URL`); sin ella el estado queda en el disco, que Render borra al reiniciar.

## 📁 Estructura

```
servidor/                 Todo lo que corre en el servidor (Node)
  index.js                Arranque: sirve publico/ y conecta cada parte
  configuracion.js        Puerto, carpetas y Cloudinary
  base-datos.js           Conexión a Postgres (si hay DATABASE_URL)
  almacen.js              Guardar los datos (Postgres o datos/*.json) con respaldo privado en Cloudinary
  personas.js             PIN por persona (registro, entrar, permisos; el PIN se guarda cifrado)
  limite-intentos.js      Bloqueo por PIN equivocados
  diapositivas.js         Orden, subir, borrar, ajustar, unir y reordenar imágenes
  documentos.js           «Subir documento»: trabajos en segundo plano con progreso en vivo
  conversion-office.js    Word/Excel/PowerPoint → PDF con LibreOffice
  paginas-pdf.js          Cada página del PDF → imagen WebP (recorte de márgenes y calidad)
  administracion.js       Sólo admin: lista de personas y borrar cuentas con todo lo suyo
  frase-final.js          Frase de cierre de cada persona
  avance-automatico.js    Avance automático de cada persona
  sockets.js              Tiempo real entre el control y la pantalla
  validadores-frase.js    Listas de letras/efectos y validación de textos
  multimedia.js           Música y videos: subir (firma de Cloudinary), YouTube, borrar, orden y espacio
  validadores-medios.js   Validación de las órdenes de música/video y del estado de la pantalla
  guardian.js             Los 4 guardianes: filas con empleados, turnos, espacio y mensajes de más
publico/                  Lo único que ve el navegador
  pantalla.html, control.html, gestionar.html, multimedia.html, avanzado.html, index.html
  estilos/estilos.css     Estilos de todas las páginas
  estilos/multimedia.css  Estilos de la música y los videos
  vendor/                 Mediabunny (achica los videos en el navegador; licencia MPL-2.0)
  multimedia/             Música y videos subidos al probar en la PC sin Cloudinary (no va a git)
  scripts/                El código de cada página (pantalla.js, control.js, …), autenticacion.js y
                          documentos.js / trabajos-documentos.js / progreso-documentos.js
  diapositivas/           Imágenes opcionales que viajan con el código
datos/                    Lo que genera la app (no va a git): orden-imagenes.json, personas.json,
                          frases-finales.json, avance-automatico.json
pruebas/                  Pruebas automáticas (npm test) y prueba de carga (npm run carga)
Dockerfile                Imagen para Render con LibreOffice (Word/Excel/PowerPoint)
server.js                 Sólo compatibilidad: si Render arranca con «node server.js», llama a servidor/
```

Antes todo estaba suelto en la raíz y el servidor publicaba la carpeta entera,
incluido `people.json` con los PIN de todos; ahora sólo se publica `publico/`.

## 🖥️ Despliegue en Render.com

1. **Push a GitHub**:
   ```
   git init
   git add .
   git commit -m "Ready for Render"
   git branch -M main
   git remote add origin https://github.com/quintillizasyuesugui-svg/presentaci-n-subir-contenido.git
   git push -u origin main
   ```

2. **Render.com**:
   - Crea cuenta en [render.com](https://render.com)
   - New → Web Service → Connect GitHub repo
   - **Runtime**: Node
   - **Build**: `npm install`
   - **Start**: `npm start` (auto from package.json)
   - Agregá las variables de entorno de Cloudinary (ver abajo)
   - Deploy! URL: `https://tu-app.onrender.com`

3. **Uso**:
   - Abre `/pantalla.html` en proyector/TV
   - Abre `/control.html` en celular (misma red)
   - ¡Controla las imágenes!

## ☁️ Imágenes permanentes con Cloudinary

Render borra el disco del servidor en cada reinicio o redeploy. Las imágenes
que pongas en `publico/diapositivas/` sobreviven porque viajan con el código, pero lo que
subas en vivo desde `/gestionar.html` necesita guardarse en otro lado para no
perderse — por eso ese servidor usa [Cloudinary](https://cloudinary.com)
(plan gratis) como almacenamiento permanente.

1. Creá una cuenta gratis en [cloudinary.com](https://cloudinary.com).
2. En el Dashboard, copiá **Cloud name**, **API Key** y **API Secret**.
3. Local: copiá `.env.example` a `.env` y completá esos tres valores.
4. Render: agregá las mismas tres variables en **Environment** del servicio.

Sin estas variables, la pantalla y el control funcionan igual, pero el botón
de subir imágenes en `/gestionar.html` no va a andar (avisa con un error claro).

## 🗄️ Base de datos (recomendada)

Con la variable `DATABASE_URL` la app guarda todo en **Postgres** en vez de archivos JSON. Sirve el
plan gratis de [Neon](https://neon.tech) o [Supabase](https://supabase.com) (el Postgres gratis de
Render se borra a los 30 días).

1. En Neon: creá un proyecto (misma región que Render, por ejemplo US West / Oregon) y en
   **Connect** copiá la dirección que empieza con `postgresql://`.
2. En Render → tu servicio → **Environment**: agregá `DATABASE_URL` con esa dirección.
3. Al arrancar, la app crea sus tablas y **copia sola los datos de siempre** (cuentas, orden de las
   diapositivas, frases, avance). Los respaldos de Cloudinary no se borran.

Qué cambia:
- Cada cambio escribe sólo lo que cambió (antes se reescribía el archivo entero).
- Los datos se leen una vez al arrancar y quedan en memoria: la pantalla responde sin tocar el disco.
- Los cambios van de a uno: antes, si muchas personas se registraban o guardaban a la vez, se
  pisaban (en la prueba de carga con 400 personas el archivo de cuentas quedó roto).
- Los documentos en proceso sobreviven a un reinicio (ver «Subir documento»).

Sin `DATABASE_URL` todo sigue funcionando como antes, con `datos/*.json`. Las dos formas dejan
además un respaldo **privado** en Cloudinary (sólo se baja con la firma del servidor; antes era
público y se podía bajar la lista de personas).

Es para **un solo servidor** (como Render hoy): si algún día hubiera varios a la vez, cada uno
tendría su propia copia en memoria.

## 🔒 PIN por persona

`/gestionar.html` y `/avanzado.html` piden identificarse antes de dejar subir,
borrar o reordenar nada. El sistema se encarga solo, no hay que configurar
usuarios a mano:

- La primera vez, cada uno escribe su nombre y toca "Soy nuevo/a" — el
  servidor le genera un PIN de 4 dígitos único (nadie lo elige) y se lo
  muestra una vez en pantalla.
- Ese PIN queda guardado en el celular (no lo vuelve a pedir en ese mismo
  dispositivo). Para entrar desde otro celular, escribe el mismo PIN en
  "Ya tengo PIN".
- Cada persona sólo ve y puede tocar **sus propias** imágenes — las de los
  demás ni aparecen en su lista. La pantalla proyectada (`pantalla.html`)
  sigue mostrando el show combinado de todos, sin cambios ahí.
- **El PIN no se guarda escrito**: sólo su huella (HMAC-SHA256). Para que ni con los datos se pueda
  averiguar, agregá en Render → Environment la variable **`PIN_SECRETO`** (botón «Generate»).
  **No la cambies nunca después**: las huellas dejarían de coincidir y nadie podría entrar. Las
  cuentas de antes se pasan solas a huella; todos siguen entrando con su mismo PIN.
- **Límite de intentos** (lo lleva el servidor, no se saltea borrando el navegador): después de
  5 PIN equivocados distintos desde la misma conexión, espera 1 minuto; si sigue fallando, 2, 4, 8
  y como mucho 15 minutos. Tras una hora sin errores vuelve a empezar. El mismo PIN viejo guardado
  en un celular cuenta una sola vez, así un aula entera con la misma conexión no queda afuera.
- Como el PIN ya no se puede leer, el admin tampoco puede ver el PIN de nadie: si alguien lo
  olvida, se borra su cuenta y se registra de nuevo.
- Opcional: `ADMIN_PIN` en las variables de entorno da un PIN que ve y
  controla las imágenes de todos (para vos, como organizador).
- **Borrar cuentas (sólo admin):** en Modo avanzado, con el PIN de admin aparece
  «👥 Personas»: la lista de cuentas con cuántas diapositivas tiene cada una. Tocá las que
  sobran para marcarlas (o «Seleccionar todas», que respeta el buscador) y abajo aparece
  «🗑️ Borrar N cuentas». Al borrar (pide confirmar, con los nombres) se va todo lo de esas
  personas, como si nunca hubieran existido:
  la cuenta y su PIN, sus diapositivas (también en Cloudinary), su frase final, su avance
  automático y sus documentos en proceso. Su nombre queda libre. Nadie más ve esta sección,
  y el servidor rechaza a cualquiera que no sea admin. El nombre «admin» está reservado.

## 🧪 Local
```bash
npm install
npm start
```
- http://localhost:3000/pantalla.html
- http://localhost:3000/control.html
- http://localhost:3000/gestionar.html
- Para probar música y videos sin Cloudinary: `DOCUMENTOS_SIN_NUBE_LOCAL=1 npm start`
  (se guardan en `publico/multimedia/`)
- `npm test` corre las pruebas de `pruebas/`
- `npm run carga -- http://localhost:3000 400 20` simula 400 personas y 20 documentos a la vez
  (crea cuentas de prueba: no usarlo contra Render sin borrarlas después)
- Para probar con Postgres sin instalar nada: `DATABASE_URL=pglite:./datos/pg` (sólo en la PC)

## 📱 Features
- Socket.IO real-time
- Fullscreen cinema mode
- Imágenes auto-detectadas (PNG/JPG/WEBP) y subidas en vivo desde el celular
- Reconocimiento de voz en español (mostrar/siguiente/atrás/números)
- Responsive design (PC y celular)

**Free tier Render**: Sleeps after 15min inactivity, wakes on request.
