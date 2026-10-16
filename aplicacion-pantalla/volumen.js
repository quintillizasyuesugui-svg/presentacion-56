// Volumen de Windows (el de la barrita de la PC), para manejarlo desde el celular.
// Electron no trae una forma de tocarlo, así que se le pide a PowerShell, que habla con el
// sonido de Windows. PowerShell se abre una sola vez (tarda unos segundos) y queda esperando
// órdenes de a una por línea: «leer», «poner 40», «mudo 1». Contesta «ok <volumen> <0|1>».
const { spawn } = require('child_process');

const GUION = String.raw`
$codigo = @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float nivel, Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float nivel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mudo, Guid ctx);
  int GetMute(out bool mudo);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flujo, int rol, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerador { }
public static class VolumenPC {
  static IAudioEndpointVolume Salida() {
    var e = (IMMDeviceEnumerator)(new Enumerador());
    IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    var id = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static string Leer() { var s = Salida(); float v; bool m; s.GetMasterVolumeLevelScalar(out v); s.GetMute(out m); return Math.Round(v * 100) + " " + (m ? 1 : 0); }
  public static string Poner(int v) { var s = Salida(); s.SetMute(false, Guid.Empty); s.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, v)) / 100f, Guid.Empty); return Leer(); }
  public static string Mudo(bool m) { var s = Salida(); s.SetMute(m, Guid.Empty); return Leer(); }
}
"@
Add-Type -TypeDefinition $codigo
[Console]::Out.WriteLine("listo")
while ($null -ne ($linea = [Console]::In.ReadLine())) {
  try {
    $p = $linea.Split(' ')
    if ($p[0] -eq 'poner') { $r = [VolumenPC]::Poner([int]$p[1]) }
    elseif ($p[0] -eq 'mudo') { $r = [VolumenPC]::Mudo($p[1] -eq '1') }
    else { $r = [VolumenPC]::Leer() }
    [Console]::Out.WriteLine("ok " + $r)
  } catch { [Console]::Out.WriteLine("error") }
}
`;
const ESPERA_MAXIMA_MS = 15000;

let proceso = null;
let listo = null;       // promesa: PowerShell terminó de arrancar
let pendientes = [];    // { resolver } en el orden en que se mandaron
let sobra = '';

function cerrar() {
  if (proceso) { try { proceso.kill(); } catch { /* ya estaba cerrado */ } }
  proceso = null;
  listo = null;
  pendientes.splice(0).forEach((p) => p.resolver(null));
}

function arrancar() {
  if (listo) return listo;
  listo = new Promise((resolver) => {
    const codificado = Buffer.from(GUION, 'utf16le').toString('base64');
    proceso = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado], { windowsHide: true });
    sobra = '';
    const tope = setTimeout(() => { resolver(false); cerrar(); }, ESPERA_MAXIMA_MS);
    proceso.stdout.setEncoding('utf8');
    proceso.stdout.on('data', (trozo) => {
      sobra += trozo;
      let fin;
      while ((fin = sobra.indexOf('\n')) >= 0) {
        const linea = sobra.slice(0, fin).trim();
        sobra = sobra.slice(fin + 1);
        if (linea === 'listo') { clearTimeout(tope); resolver(true); continue; }
        const quien = pendientes.shift();
        if (!quien) continue;
        const [estado, volumen, mudo] = linea.split(' ');
        quien.resolver(estado === 'ok' ? { volumen: Number(volumen), mudo: mudo === '1' } : null);
      }
    });
    proceso.on('error', () => { clearTimeout(tope); resolver(false); cerrar(); });
    proceso.on('exit', () => { clearTimeout(tope); resolver(false); proceso = null; listo = null; pendientes.splice(0).forEach((p) => p.resolver(null)); });
  });
  return listo;
}

// Devuelve { volumen, mudo } como quedó, o null si Windows no contestó.
async function pedir(orden) {
  if (process.platform !== 'win32') return null;
  if (!(await arrancar()) || !proceso) return null;
  return new Promise((resolver) => {
    // Si no contesta, se cierra: así ninguna respuesta atrasada le llega a otra orden.
    const tope = setTimeout(cerrar, ESPERA_MAXIMA_MS);
    const quien = { resolver: (r) => { clearTimeout(tope); resolver(r); } };
    pendientes.push(quien);
    proceso.stdin.write(orden + '\n');
  });
}

const leer = () => pedir('leer');
function poner(volumen) {
  const v = Number(volumen);
  if (!Number.isFinite(v)) return Promise.resolve(null);
  return pedir('poner ' + Math.max(0, Math.min(100, Math.round(v))));
}
const silenciar = (siNo) => pedir('mudo ' + (siNo ? 1 : 0));

module.exports = { leer, poner, silenciar, cerrar };
