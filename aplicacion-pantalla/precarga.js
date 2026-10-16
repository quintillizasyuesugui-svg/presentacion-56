// Lo que la pantalla de Conexiones puede pedirle a la app de PC: abrir una página web de verdad
// (como un navegador), manejarla y sacarle fotos para el celular. El programa principal sólo le
// hace caso a la pantalla de Conexiones, no a otras páginas. También el volumen de Windows.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ConexionesPC', {
  pagina: {
    abrir: (direccion) => ipcRenderer.invoke('pagina:abrir', direccion),
    cerrar: () => ipcRenderer.invoke('pagina:cerrar'),
    visible: (siNo) => ipcRenderer.invoke('pagina:visible', siNo),
    orden: (orden) => ipcRenderer.invoke('pagina:orden', orden),
    foto: () => ipcRenderer.invoke('pagina:foto'),
    zoom: (zona) => ipcRenderer.invoke('pagina:zoom', zona),
    limpiar: () => ipcRenderer.invoke('pagina:limpiar')
  },
  // Volumen de Windows: cada uno devuelve { volumen, mudo } como quedó, o null.
  volumen: {
    leer: () => ipcRenderer.invoke('volumen:leer'),
    poner: (valor) => ipcRenderer.invoke('volumen:poner', valor),
    mudo: (siNo) => ipcRenderer.invoke('volumen:mudo', siNo)
  }
});
