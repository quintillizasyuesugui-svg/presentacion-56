# Imagen para Render (tipo de servicio: Docker). Incluye LibreOffice para convertir
# Word, Excel y PowerPoint a PDF en «Subir documento» (Modo avanzado).
FROM node:22-bookworm-slim

# LibreOffice sin interfaz gráfica + fuentes con las mismas medidas que las de Office
# (Carlito = Calibri, Caladea = Cambria, Liberation = Arial/Times/Courier), así los
# documentos se ven igual que en Word/PowerPoint. Poppler (pdftoppm) dibuja cada página
# del PDF como imagen, con todas sus letras y fotos.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui poppler-utils \
      fonts-dejavu-core fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["npm", "start"]
