# Conexiones - Presentación Interactiva

## 🎬 Demo
Controla diapositivas en tiempo real:
- **Pantalla** (`/pantalla.html`): Muestra imágenes
- **Control** (`/control.html`): Botones anterior/mostrar/siguiente/fullscreen/voz
- **Gestionar imágenes** (`/gestionar.html`, antes `/manage.html` — el enlace viejo sigue funcionando): Subir, ordenar y borrar diapositivas desde el celular
- **Modo avanzado** (`/avanzado.html`): tamaño y posición, unir imágenes, subir documento, frase final y avance automático

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
- Si Render reinicia el servidor mientras procesa, ese trabajo se pierde (hay que subirlo de nuevo).

## 📁 Estructura

```
servidor/                 Todo lo que corre en el servidor (Node)
  index.js                Arranque: sirve publico/ y conecta cada parte
  configuracion.js        Puerto, carpetas y Cloudinary
  almacen.js              Guardar JSON en datos/ con respaldo en Cloudinary
  personas.js             PIN por persona (registro, entrar, permisos)
  diapositivas.js         Orden, subir, borrar, ajustar, unir y reordenar imágenes
  documentos.js           «Subir documento»: trabajos en segundo plano con progreso en vivo
  conversion-office.js    Word/Excel/PowerPoint → PDF con LibreOffice
  paginas-pdf.js          Cada página del PDF → imagen WebP (recorte de márgenes y calidad)
  administracion.js       Sólo admin: lista de personas y borrar cuentas con todo lo suyo
  frase-final.js          Frase de cierre de cada persona
  avance-automatico.js    Avance automático de cada persona
  sockets.js              Tiempo real entre el control y la pantalla
  validadores-frase.js    Listas de letras/efectos y validación de textos
publico/                  Lo único que ve el navegador
  pantalla.html, control.html, gestionar.html, avanzado.html, index.html
  estilos/estilos.css     Estilos de todas las páginas
  scripts/                El código de cada página (pantalla.js, control.js, …), autenticacion.js y
                          documentos.js / trabajos-documentos.js / progreso-documentos.js
  diapositivas/           Imágenes opcionales que viajan con el código
datos/                    Lo que genera la app (no va a git): orden-imagenes.json, personas.json,
                          frases-finales.json, avance-automatico.json
pruebas/                  Pruebas automáticas (npm test)
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
- Los PIN se guardan en `datos/personas.json`, respaldado en Cloudinary igual que
  `datos/orden-imagenes.json` — sobrevive a los redeploys de Render sin base de datos.
  (Los respaldos en Cloudinary conservan sus nombres de siempre, así no se pierde nada.)
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
- `npm test` corre las pruebas de `pruebas/`

## 📱 Features
- Socket.IO real-time
- Fullscreen cinema mode
- Imágenes auto-detectadas (PNG/JPG/WEBP) y subidas en vivo desde el celular
- Reconocimiento de voz en español (mostrar/siguiente/atrás/números)
- Responsive design (PC y celular)

**Free tier Render**: Sleeps after 15min inactivity, wakes on request.
