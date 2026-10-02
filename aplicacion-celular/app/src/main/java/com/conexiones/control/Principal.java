package com.conexiones.control;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
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

    private WebView web;
    private FrameLayout raiz;
    private WebChromeClient navegador;
    private View videoGrande;
    private WebChromeClient.CustomViewCallback cerrarVideoGrande;
    private ValueCallback<Uri[]> archivosPedidos;
    private String ultimaDireccion = CONTROL;

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

        if (guardado != null) web.restoreState(guardado);
        else web.loadUrl(CONTROL);
    }

    private class Reintento {
        @JavascriptInterface
        public void reintentar() {
            web.post(() -> web.loadUrl(ultimaDireccion));
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
            return datos().getString("auth", null);
        }

        @JavascriptInterface
        public void guardar(String texto) {
            datos().edit().putString("auth", texto).commit();
        }

        @JavascriptInterface
        public void borrar() {
            datos().edit().remove("auth").commit();
        }
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
            archivosPedidos.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, datos));
            archivosPedidos = null;
            return;
        }
        super.onActivityResult(pedido, resultado, datos);
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

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }
}
