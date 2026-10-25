---
title: Filo piensa
emoji: 🗣️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

Entiende lo que se le dice a Filo en el control de Conexiones y contesta con órdenes cortas de
la presentación (pasar fotos, música, video, volumen, zoom). No maneja cuentas, PIN ni
contraseñas: el celular sólo cumple órdenes de su propia lista.

`POST /pensar` con `{"frase": "baja la música y pasa la foto"}` → `{"respuesta": "vol.bajar ; diap.siguiente", "ms": 400}`
