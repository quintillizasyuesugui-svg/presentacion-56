const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs").promises;
const path = require("path");

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.redirect('/pantalla.html');
});

// API para leer imágenes dinámicamente
app.get("/images", async (req, res) => {
  try {
    const files = await fs.readdir(__dirname);
    const images = files
      .filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    res.json(images);
  } catch (err) {
    res.status(500).send("Error en servidor");
  }
});

io.on("connection", (socket) => {
  console.log("✨ Dispositivo vinculado");
  socket.on("cambiar", (accion) => io.emit("cambiar", accion));
  socket.on("cine", () => io.emit("cine"));
});

server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Cinema en http://0.0.0.0:${PORT}`));