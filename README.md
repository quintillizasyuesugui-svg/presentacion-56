# Conexiones - Presentación Interactiva

## 🎬 Demo
Controla diapositivas en tiempo real:
- **Pantalla** (`/pantalla.html`): Muestra imágenes
- **Control** (`/control.html`): Botones anterior/mostrar/siguiente/fullscreen/voz
- **Gestionar imágenes** (`/manage.html`): Subir, ordenar y borrar diapositivas desde el celular

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
`1.png`...`7.png` del repo sobreviven porque viajan con el código, pero lo que
subas en vivo desde `/manage.html` necesita guardarse en otro lado para no
perderse — por eso ese servidor usa [Cloudinary](https://cloudinary.com)
(plan gratis) como almacenamiento permanente.

1. Creá una cuenta gratis en [cloudinary.com](https://cloudinary.com).
2. En el Dashboard, copiá **Cloud name**, **API Key** y **API Secret**.
3. Local: copiá `.env.example` a `.env` y completá esos tres valores.
4. Render: agregá las mismas tres variables en **Environment** del servicio.

Sin estas variables, la pantalla y el control funcionan igual, pero el botón
de subir imágenes en `/manage.html` no va a andar (avisa con un error claro).

## 🧪 Local
```bash
npm install
npm start
```
- http://localhost:3000/pantalla.html
- http://localhost:3000/control.html
- http://localhost:3000/manage.html

## 📱 Features
- Socket.IO real-time
- Fullscreen cinema mode
- Imágenes auto-detectadas (PNG/JPG/WEBP) y subidas en vivo desde el celular
- Reconocimiento de voz en español (mostrar/siguiente/atrás/números)
- Responsive design (PC y celular)

**Free tier Render**: Sleeps after 15min inactivity, wakes on request.
