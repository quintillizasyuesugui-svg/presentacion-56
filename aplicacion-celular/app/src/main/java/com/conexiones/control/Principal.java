package com.conexiones.control;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.Manifest;
import android.media.AudioManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import java.io.File;
import java.util.ArrayList;
import org.json.JSONArray;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

// Abre el control de Conexiones (el mismo de Render) como app del celular.
public class Principal extends Activity {
    private static final String DIRECCION = "https://presentacion-56.onrender.com";
    private static final String SERVIDOR = Uri.parse(DIRECCION).getHost();
    private static final String CONTROL = DIRECCION + "/control.html";
    private static final int ELEGIR_ARCHIVO = 1;
    private static final int PEDIR_MICROFONO = 2;

    // Órdenes por voz: escucha el reconocedor del propio celular y le avisa a la página lo que oyó.
    private SpeechRecognizer reconocedor;
    private boolean vozActiva = false;
    private boolean vozSilencio = false;
    private String vozIdioma = "es-ES";
    private final ArrayList<String> vozFrases = new ArrayList<>();

    private WebView web;
    private FrameLayout raiz;
    private WebChromeClient navegador;
    private View videoGrande;
    private WebChromeClient.CustomViewCallback cerrarVideoGrande;
    private ValueCallback<Uri[]> archivosPedidos;
    private String ultimaDireccion = CONTROL;
    private long descargaId = -1;
    // true sólo mientras lo que se ve es una página de Conexiones. Las funciones que la app le
    // presta a la página (el PIN guardado, bajar e instalar la versión nueva) no contestan si se
    // está mostrando otra cosa: así ningún otro sitio puede leer el PIN ni pedir una descarga.
    private volatile boolean paginaPropia = false;

    private static boolean esDeConexiones(String direccion) {
        if (direccion == null) return false;
        Uri uri = Uri.parse(direccion);
        return "https".equals(uri.getScheme()) && SERVIDOR.equals(uri.getHost());
    }

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        raiz = new FrameLayout(this);
        web = new WebView(this);
        raiz.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(raiz);

        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setMediaPlaybackRequiresUserGesture(false);
        ajustes.setAllowFileAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView vista, String direccion, android.graphics.Bitmap icono) {
                paginaPropia = esDeConexiones(direccion);
                // Una página nueva arranca con la voz apagada: se deja de escuchar la anterior.
                if (vozActiva) dejarDeEscuchar();
                super.onPageStarted(vista, direccion, icono);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
                Uri uri = pedido.getUrl();
                // Las páginas de Conexiones se quedan en la app; lo demás (YouTube, etc.) va al navegador.
                if ("https".equals(uri.getScheme()) && SERVIDOR.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignorado) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView vista, WebResourceRequest pedido, WebResourceError error) {
                if (!pedido.isForMainFrame()) return;
                ultimaDireccion = pedido.getUrl().toString();
                vista.loadDataWithBaseURL(null, paginaSinConexion(), "text/html", "UTF-8", null);
            }
        });

        navegador = new WebChromeClient() {
            // «Subir documento», música y videos: abre el selector de archivos del celular.
            @Override
            public boolean onShowFileChooser(WebView vista, ValueCallback<Uri[]> respuesta, FileChooserParams parametros) {
                if (archivosPedidos != null) archivosPedidos.onReceiveValue(null);
                archivosPedidos = respuesta;
                try {
                    Intent elegir = parametros.createIntent();
                    if (parametros.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) elegir.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(elegir, ELEGIR_ARCHIVO);
                } catch (ActivityNotFoundException e) {
                    archivosPedidos = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onShowCustomView(View vista, CustomViewCallback cerrar) {
                if (videoGrande != null) { cerrar.onCustomViewHidden(); return; }
                videoGrande = vista;
                cerrarVideoGrande = cerrar;
                raiz.addView(vista, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                if (videoGrande == null) return;
                raiz.removeView(videoGrande);
                videoGrande = null;
                cerrarVideoGrande.onCustomViewHidden();
            }
        };
        web.setWebChromeClient(navegador);

        web.addJavascriptInterface(new Reintento(), "App");
        web.addJavascriptInterface(new Memoria(), "Memoria");
        web.addJavascriptInterface(new Actualizador(), "Actualizador");
        web.addJavascriptInterface(new Voz(), "Voz");

        if (guardado != null) web.restoreState(guardado);
        else web.loadUrl(direccionDe(getIntent()));
    }

    // El QR de una invitación (…/celular.html?inv=TIGRE-4821) abre la app: el código pasa al
    // control para que el alumno sólo escriba su nombre.
    private String direccionDe(Intent intento) {
        Uri datos = intento == null ? null : intento.getData();
        String codigo = datos == null ? null : datos.getQueryParameter("inv");
        if (codigo == null || codigo.isEmpty()) return CONTROL;
        return CONTROL + "?inv=" + Uri.encode(codigo);
    }

    @Override
    protected void onNewIntent(Intent intento) {
        super.onNewIntent(intento);
        setIntent(intento);
        String direccion = direccionDe(intento);
        if (!direccion.equals(CONTROL)) web.loadUrl(direccion);
    }

    private class Reintento {
        @JavascriptInterface
        public void reintentar() {
            web.post(() -> web.loadUrl(esDeConexiones(ultimaDireccion) ? ultimaDireccion : CONTROL));
        }
    }

    // Guarda el PIN (con «Recordarme» marcado) en la memoria de la app: el localStorage del
    // WebView se escribe tarde y se perdía si la app se cerraba enseguida. commit() lo escribe ya.
    private class Memoria {
        private SharedPreferences datos() {
            return getSharedPreferences("sesion", MODE_PRIVATE);
        }

        @JavascriptInterface
        public String leer() {
            if (!paginaPropia) return null;
            return datos().getString("auth", null);
        }

        @JavascriptInterface
        public void guardar(String texto) {
            if (!paginaPropia) return;
            datos().edit().putString("auth", texto).commit();
        }

        @JavascriptInterface
        public void borrar() {
            if (!paginaPropia) return;
            datos().edit().remove("auth").commit();
        }
    }

    // Versión nueva: la página pregunta qué versión es ésta, y si hay otra la baja con el
    // DownloadManager de Android (sin pedir permisos de archivos) y abre el instalador.
    private class Actualizador {
        private DownloadManager descargas() {
            return (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        }

        private File archivo() {
            return new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "conexiones-control.apk");
        }

        @JavascriptInterface
        public int versionCodigo() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
            } catch (PackageManager.NameNotFoundException e) {
                return 0;
            }
        }

        @JavascriptInterface
        public String versionNombre() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "";
            }
        }

        // Sólo baja APK del propio servidor de Conexiones.
        @JavascriptInterface
        public boolean descargar(String direccion) {
            if (!paginaPropia || !esDeConexiones(direccion)) return false;
            Uri uri = Uri.parse(direccion);
            File viejo = archivo();
            if (viejo.exists()) viejo.delete();
            DownloadManager.Request pedido = new DownloadManager.Request(uri)
                .setTitle("Conexiones Control")
                .setDescription("Versión nueva")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(Principal.this, Environment.DIRECTORY_DOWNLOADS, "conexiones-control.apk");
            descargaId = descargas().enqueue(pedido);
            return true;
        }

        // 0 a 99 mientras baja, 100 cuando terminó, -1 si falló.
        @JavascriptInterface
        public int progreso() {
            if (descargaId < 0) return -1;
            try (Cursor c = descargas().query(new DownloadManager.Query().setFilterById(descargaId))) {
                if (c == null || !c.moveToFirst()) return -1;
                int estado = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (estado == DownloadManager.STATUS_SUCCESSFUL) return 100;
                if (estado == DownloadManager.STATUS_FAILED) return -1;
                long bajado = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                return total > 0 ? (int) Math.min(99, bajado * 100 / total) : 0;
            }
        }

        // Abre el instalador de Android. La primera vez Android pide «Permitir de esta fuente»:
        // se abre esa pantalla y devuelve false (al volver, se toca «Instalar» de nuevo).
        @JavascriptInterface
        public boolean instalar() {
            if (!paginaPropia) return false;
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                Intent permiso = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                runOnUiThread(() -> {
                    try { startActivity(permiso); } catch (ActivityNotFoundException ignorado) { }
                });
                return false;
            }
            Uri apk = descargaId >= 0 ? descargas().getUriForDownloadedFile(descargaId) : null;
            if (apk == null) return false;
            Intent instalar = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(apk, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnUiThread(() -> {
                try { startActivity(instalar); } catch (ActivityNotFoundException ignorado) { }
            });
            return true;
        }
    }

    // La página llama a Voz.empezar() al tocar «🎤 Voz» y a Voz.detener() al apagarla. Lo que se
    // oye vuelve a la página por window.vozNativa.resultado([...]), de lo más probable a lo menos.
    private class Voz {
        @JavascriptInterface
        public boolean disponible() {
            return SpeechRecognizer.isRecognitionAvailable(Principal.this);
        }

        @JavascriptInterface
        public void empezar(String idioma, String frasesJson) {
            if (!paginaPropia) return;
            runOnUiThread(() -> {
                if (idioma != null && !idioma.isEmpty()) vozIdioma = idioma;
                vozFrases.clear();
                try {
                    JSONArray frases = new JSONArray(frasesJson);
                    for (int i = 0; i < frases.length() && i < 100; i++) vozFrases.add(frases.getString(i));
                } catch (Exception ignorado) { }
                vozActiva = true;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, PEDIR_MICROFONO);
                    return;
                }
                escuchar();
            });
        }

        @JavascriptInterface
        public void detener() {
            runOnUiThread(Principal.this::dejarDeEscuchar);
        }
    }

    // El reconocedor de Android escucha una frase y se detiene: mientras la voz esté prendida se
    // lo vuelve a poner a escuchar después de cada frase, de cada silencio y de cada error.
    private void escuchar() {
        if (!vozActiva) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { avisarVoz("no-disponible"); return; }
        if (reconocedor == null) {
            reconocedor = SpeechRecognizer.createSpeechRecognizer(this);
            reconocedor.setRecognitionListener(new Oyente());
        }
        silenciarAvisos(true);
        Intent pedido = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE, vozIdioma);
        pedido.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        pedido.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        // Android 13 o más: se le dice qué frases esperar, así las prefiere al oír algo parecido.
        if (Build.VERSION.SDK_INT >= 33 && !vozFrases.isEmpty()) {
            pedido.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, vozFrases);
        }
        try {
            reconocedor.startListening(pedido);
        } catch (Exception e) {
            web.postDelayed(this::escuchar, 1000);
        }
    }

    private void dejarDeEscuchar() {
        vozActiva = false;
        if (reconocedor != null) reconocedor.cancel();
        silenciarAvisos(false);
    }

    // En muchos celulares el reconocedor hace «bip» cada vez que empieza a escuchar, y acá
    // empieza cada pocos segundos. Mientras la voz está prendida se silencia ese sonido (el
    // celular no reproduce nada: la música y los videos suenan en la pantalla); al apagarla
    // vuelve a como estaba.
    private void silenciarAvisos(boolean silenciar) {
        if (silenciar == vozSilencio) return;
        vozSilencio = silenciar;
        try {
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            int accion = silenciar ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
            audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, accion, 0);
            audio.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, accion, 0);
        } catch (Exception ignorado) { }
    }

    private void avisarVoz(String motivo) {
        dejarDeEscuchar();
        web.evaluateJavascript("window.vozNativa&&window.vozNativa.aviso('" + motivo + "')", null);
    }

    private class Oyente implements RecognitionListener {
        @Override
        public void onResults(Bundle resultados) {
            ArrayList<String> oido = resultados.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (vozActiva && paginaPropia && oido != null && !oido.isEmpty()) {
                web.evaluateJavascript("window.vozNativa&&window.vozNativa.resultado(" + new JSONArray(oido) + ")", null);
            }
            web.postDelayed(Principal.this::escuchar, 150);
        }

        @Override
        public void onError(int error) {
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { avisarVoz("sin-permiso"); return; }
            // No se oyó nada o no se entendió: se sigue escuchando enseguida. Si el reconocedor
            // está ocupado o falló la conexión, se espera un poco más antes de volver a probar.
            boolean enseguida = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && reconocedor != null) reconocedor.cancel();
            web.postDelayed(Principal.this::escuchar, enseguida ? 150 : 1500);
        }

        @Override public void onReadyForSpeech(Bundle parametros) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float nivel) { }
        @Override public void onBufferReceived(byte[] datos) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onPartialResults(Bundle parciales) { }
        @Override public void onEvent(int tipo, Bundle datos) { }
    }

    @Override
    public void onRequestPermissionsResult(int pedido, String[] permisos, int[] respuestas) {
        super.onRequestPermissionsResult(pedido, permisos, respuestas);
        if (pedido != PEDIR_MICROFONO) return;
        if (respuestas.length > 0 && respuestas[0] == PackageManager.PERMISSION_GRANTED) escuchar();
        else avisarVoz("sin-permiso");
    }

    private String paginaSinConexion() {
        return "<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            + "<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#000;color:#f2f2f2;font-family:sans-serif;text-align:center;padding:0 24px}"
            + "h1{font-size:1.4rem;margin:0 0 10px}p{color:#a8a8a8;line-height:1.5;margin:0 0 22px}"
            + "button{font:inherit;font-weight:600;padding:12px 28px;border:0;border-radius:999px;background:#f2f2f2;color:#000}</style></head>"
            + "<body><main><h1>No se pudo abrir el control</h1><p>Revisá que el celular tenga internet.<br>Si el servidor estaba dormido, tarda hasta un minuto en despertar.</p>"
            + "<button onclick='App.reintentar()'>Reintentar</button></main></body></html>";
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        if (pedido == ELEGIR_ARCHIVO && archivosPedidos != null) {
            archivosPedidos.onReceiveValue(archivosElegidos(resultado, datos));
            archivosPedidos = null;
            return;
        }
        super.onActivityResult(pedido, resultado, datos);
    }

    // Cuando se pide «varias», la galería de los Android nuevos devuelve los archivos en un
    // ClipData aunque se elija uno solo; parseResult sólo lee el archivo suelto (getData) y
    // devolvía null, así que no se subía nada. Se leen los dos casos.
    private static Uri[] archivosElegidos(int resultado, Intent datos) {
        if (resultado != RESULT_OK || datos == null) return null;
        ClipData varios = datos.getClipData();
        if (varios != null && varios.getItemCount() > 0) {
            Uri[] uris = new Uri[varios.getItemCount()];
            for (int i = 0; i < uris.length; i++) uris[i] = varios.getItemAt(i).getUri();
            return uris;
        }
        Uri uno = datos.getData();
        return uno != null ? new Uri[] { uno } : null;
    }

    @Override
    public void onBackPressed() {
        if (videoGrande != null) { navegador.onHideCustomView(); return; }
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle estado) {
        super.onSaveInstanceState(estado);
        web.saveState(estado);
    }

    // Al salir de la app se deja de escuchar (y vuelve el sonido del celular); al volver, si la
    // voz seguía prendida en la página, se escucha de nuevo.
    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        if (reconocedor != null) reconocedor.cancel();
        silenciarAvisos(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (vozActiva) escuchar();
    }

    @Override
    protected void onDestroy() {
        silenciarAvisos(false);
        if (reconocedor != null) { reconocedor.destroy(); reconocedor = null; }
        super.onDestroy();
    }
}
