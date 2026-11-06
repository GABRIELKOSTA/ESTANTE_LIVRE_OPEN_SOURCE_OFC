package com.estantelivre.app;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import androidx.core.app.NotificationCompat;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;
import org.json.JSONTokener;

/** A separate WebView runs the host's ordinary free-download flow. No bridge is
 * exposed to remote pages; only the resulting download URL is returned. */
@CapacitorPlugin(name = "HostedDownload", permissions = {
    @Permission(alias = "notifications", strings = { android.Manifest.permission.POST_NOTIFICATIONS })
})
public class HostedDownloadPlugin extends Plugin {
    private static final String NOTIFICATION_CHANNEL = "hosted-download";
    private static volatile boolean appBackground = false;
    private static volatile HostedDownloadPlugin current;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView view;
    private PluginCall active;
    private String requestId;
    private String script;
    private long started;
    private int emptyPolls;
    private Dialog verificationDialog;
    private TextView verificationHint;
    private long verificationStarted;
    private String pendingVerification;
    private int lastRemainingSeconds = -1;
    private long remainingObservedAt;
    private boolean countdownNotificationSent;
    private final Runnable countdownAlert = new Runnable() {
        @Override public void run() {
            if (active == null || lastRemainingSeconds <= 0) return;
            int remaining = Math.max(0, lastRemainingSeconds - (int)((SystemClock.elapsedRealtime() - remainingObservedAt) / 1000));
            if (remaining <= 30 && appBackground) {
                countdownNotificationSent = true;
                postReturnNotification("Faltam cerca de " + remaining + " segundos. Volte ao Estante Livre para concluir o CAPTCHA do hospedador.", false);
            } else if (remaining > 30) {
                handler.postDelayed(this, Math.max(250, (remaining - 30) * 1000L));
            }
        }
    };

    public static void setAppBackground(boolean background) {
        appBackground = background;
        HostedDownloadPlugin plugin = current;
        if (plugin != null) plugin.handler.post(() -> {
            if (background && plugin.active != null) {
                int remaining = plugin.estimatedRemainingSeconds();
                if (remaining > 0 && remaining <= 30 && !plugin.countdownNotificationSent) {
                    plugin.countdownNotificationSent = true;
                    plugin.postReturnNotification("Faltam cerca de " + remaining + " segundos. Volte ao Estante Livre para concluir o CAPTCHA do hospedador.", false);
                }
            }
            if (!background) {
                String message = plugin.pendingVerification;
                if (message != null && plugin.active != null) plugin.showVerification(message);
            }
        });
    }

    private int estimatedRemainingSeconds() {
        if (lastRemainingSeconds <= 0) return -1;
        return Math.max(0, lastRemainingSeconds - (int)((SystemClock.elapsedRealtime() - remainingObservedAt) / 1000));
    }

    @PluginMethod public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            NotificationManager manager = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            JSObject result = new JSObject(); result.put("granted", true);
            result.put("notificationsEnabled", manager != null && manager.areNotificationsEnabled());
            call.resolve(result); return;
        }
        if (getActivity().shouldShowRequestPermissionRationale(android.Manifest.permission.POST_NOTIFICATIONS)) {
            JSObject result = new JSObject(); result.put("granted", false); result.put("settingsRequired", true); call.resolve(result); return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback private void notificationPermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = getPermissionState("notifications") == PermissionState.GRANTED;
        NotificationManager manager = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        boolean enabled = manager != null && manager.areNotificationsEnabled();
        result.put("granted", granted); result.put("notificationsEnabled", enabled);
        result.put("settingsRequired", !granted || !enabled); call.resolve(result);
    }

    private void postReturnNotification(String text, boolean urgent) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || !manager.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(NOTIFICATION_CHANNEL, "Downloads gratuitos", NotificationManager.IMPORTANCE_HIGH));
        Intent intent = new Intent(getActivity(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent back = PendingIntent.getActivity(getContext(), 9472, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(getContext(), NOTIFICATION_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Volte ao Estante Livre")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(back).setAutoCancel(true).setOnlyAlertOnce(!urgent)
            .setPriority(NotificationCompat.PRIORITY_HIGH).build();
        manager.notify(9472, notification);
    }

    private boolean supported(Uri uri) {
        String host = uri.getHost();
        return "https".equalsIgnoreCase(uri.getScheme()) && host != null &&
            (host.equals("asdocs.net") || host.endsWith(".asdocs.net") ||
             host.equals("mediafire.com") || host.endsWith(".mediafire.com"));
    }

    private boolean fileAddress(Uri uri) {
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.ROOT);
        return path.matches(".*\\.(epub|pdf|cbr|cbz)$") || uri.getQueryParameter("download_token") != null;
    }

    @PluginMethod
    public void resolve(PluginCall call) {
        String url = call.getString("url", "");
        if (!supported(Uri.parse(url))) { call.reject("Este hospedador não tem resolução dinâmica integrada."); return; }
        getActivity().runOnUiThread(() -> start(call, url));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void start(PluginCall call, String url) {
        if (active != null) { call.reject("Aguarde o download do outro livro terminar de ser preparado."); return; }
        current = this;
        active = call;
        requestId = call.getString("requestId", "");
        started = SystemClock.elapsedRealtime();
        emptyPolls = 0;
        lastRemainingSeconds = -1;
        remainingObservedAt = 0;
        countdownNotificationSent = false;
        handler.removeCallbacks(countdownAlert);
        try { DownloadKeepAliveService.start(getContext()); }
        catch (Exception error) { android.util.Log.e("EstanteLivre", "Could not start download service", error); }
        try {
            try (InputStream input = getContext().getAssets().open("public/hosted-download-probe.js")) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int size;
                while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
                script = new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
            view = new WebView(getActivity());
            WebSettings settings = view.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(false);
            view.setAlpha(0f);
            view.setClickable(false);
            view.setFocusable(false);
            // It stays behind the app, attached so the host's regular timers run.
            ViewGroup parent = getActivity().findViewById(android.R.id.content);
            parent.addView(view, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            view.setDownloadListener((address, agent, disposition, mime, size) -> handler.post(() -> complete(address)));
            view.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                    if (!request.isForMainFrame()) return false;
                    Uri target = request.getUrl();
                    if (!"https".equalsIgnoreCase(target.getScheme())) return true;
                    if (fileAddress(target)) { handler.post(() -> complete(target.toString())); return true; }
                    return !supported(target);
                }
                @Override public void onReceivedError(WebView web, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) fail("Não foi possível carregar o hospedador: " + error.getDescription());
                }
            });
            view.loadUrl(url);
            handler.postDelayed(poll, 1500);
        } catch (Exception error) { fail("Não foi possível preparar o download: " + error.getMessage()); }
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (active == null || view == null) return;
            if (verificationDialog != null) return;
            if (SystemClock.elapsedRealtime() - started > 600000) { fail("O hospedador não liberou o arquivo após a espera."); return; }
            WebView current = view;
            current.evaluateJavascript(script, value -> {
                if (active == null || view != current) return;
                try {
                    Object decoded = new JSONTokener(value).nextValue();
                    JSONObject result = new JSONObject(String.valueOf(decoded));
                    String kind = result.optString("kind");
                    String stage = result.optString("stage", "Preparando o download…");
                    if ("ready".equals(kind)) { complete(result.optString("url")); return; }
                    if ("verification".equals(kind)) {
                        JSObject progress = new JSObject();
                        progress.put("requestId", requestId);
                        progress.put("kind", kind);
                        progress.put("stage", stage);
                        notifyListeners("progress", progress);
                        if (appBackground) {
                            pendingVerification = "A verificação do hospedador está pronta. Toque para voltar e concluir o CAPTCHA.";
                            postReturnNotification(pendingVerification, true);
                        } else showVerification(stage);
                        return;
                    }
                    if ("blocked".equals(kind)) { fail(stage); return; }
                    emptyPolls = "missing".equals(kind) ? emptyPolls + 1 : 0;
                    if (emptyPolls >= 20) {
                        JSObject progress = new JSObject();
                        progress.put("requestId", requestId);
                        progress.put("kind", "verification");
                        progress.put("stage", "Conclua a etapa de download na página do hospedador.");
                        notifyListeners("progress", progress);
                        String message = "O download automático precisa de ajuda. Toque na opção de download gratuito na página abaixo.";
                        if (appBackground) {
                            pendingVerification = "O download precisa de ajuda. Toque para voltar ao Estante Livre e continuar.";
                            postReturnNotification(pendingVerification, true);
                        } else showVerification(message);
                        return;
                    }
                    JSObject progress = new JSObject();
                    progress.put("requestId", requestId);
                    progress.put("kind", kind);
                    if (result.has("remainingSeconds") && !result.isNull("remainingSeconds")) {
                        int seconds = result.optInt("remainingSeconds");
                        progress.put("remainingSeconds", seconds);
                        if (seconds > 0) {
                            lastRemainingSeconds = seconds;
                            remainingObservedAt = SystemClock.elapsedRealtime();
                            handler.removeCallbacks(countdownAlert);
                            if (seconds <= 30) {
                                if (appBackground && !countdownNotificationSent) {
                                    countdownNotificationSent = true;
                                    postReturnNotification("Faltam cerca de " + seconds + " segundos. Volte ao Estante Livre para concluir o CAPTCHA do hospedador.", false);
                                }
                            } else handler.postDelayed(countdownAlert, (seconds - 30) * 1000L);
                        }
                    }
                    progress.put("stage", stage);
                    notifyListeners("progress", progress);
                } catch (Exception ignored) { /* The document may still be navigating. */ }
                if (active != null) handler.postDelayed(this, 2000);
            });
        }
    };

    private void detachView() {
        if (view != null && view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
    }

    private void showVerification(String message) {
        if (active == null || view == null || verificationDialog != null) return;
        try {
        pendingVerification = null;
        ((NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE)).cancel(9472);
        verificationStarted = SystemClock.elapsedRealtime();
        emptyPolls = 0;
        handler.removeCallbacks(poll);
        handler.removeCallbacks(countdownAlert);
        lastRemainingSeconds = -1;
        detachView();
        view.setAlpha(1f);
        view.setClickable(true);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        verificationDialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
        LinearLayout layout = new LinearLayout(getActivity());
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(16 * getContext().getResources().getDisplayMetrics().density);
        verificationHint = new TextView(getActivity());
        verificationHint.setText(message + " Depois toque em Continuar download.");
        verificationHint.setTextSize(16);
        verificationHint.setPadding(padding, padding, padding, padding);
        layout.addView(verificationHint);
        layout.addView(view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        LinearLayout actions = new LinearLayout(getActivity());
        actions.setPadding(padding, padding / 2, padding, padding / 2);
        Button cancel = new Button(getActivity());
        cancel.setText("Cancelar download");
        cancel.setOnClickListener(v -> fail("Verificação cancelada. Você pode tentar baixar novamente."));
        Button proceed = new Button(getActivity());
        proceed.setText("Continuar download");
        proceed.setOnClickListener(v -> continueAfterVerification());
        actions.addView(cancel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        actions.addView(proceed, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        layout.addView(actions);
        verificationDialog.setContentView(layout);
        verificationDialog.setCanceledOnTouchOutside(false);
        verificationDialog.setOnCancelListener(dialog -> fail("Verificação cancelada. Você pode tentar baixar novamente."));
        verificationDialog.show();
        if (verificationDialog.getWindow() != null) verificationDialog.getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        } catch (Exception error) { fail("Não foi possível abrir a verificação: " + error.getMessage()); }
    }

    private void continueAfterVerification() {
        if (view == null || active == null || verificationDialog == null) return;
        WebView current = view;
        current.evaluateJavascript(script, value -> {
            if (active == null || view != current || verificationDialog == null) return;
            try {
                JSONObject result = new JSONObject(String.valueOf(new JSONTokener(value).nextValue()));
                String kind = result.optString("kind");
                if ("ready".equals(kind)) { complete(result.optString("url")); return; }
                if ("verification".equals(kind)) {
                    verificationHint.setText("A verificação ainda está pendente. Marque o CAPTCHA abaixo e toque em Continuar download.");
                    return;
                }
                if ("blocked".equals(kind)) { fail(result.optString("stage")); return; }
                if ("missing".equals(kind)) {
                    verificationHint.setText("Toque na opção de download gratuito na página abaixo. Se a página ainda estiver carregando, aguarde e toque em Continuar download.");
                    return;
                }
                // Reattach the same WebView: cookies, tokens and the current page survive.
                detachView();
                Dialog dialog = verificationDialog;
                verificationDialog = null;
                verificationHint = null;
                dialog.dismiss();
                started += SystemClock.elapsedRealtime() - verificationStarted;
                current.setAlpha(0f);
                current.setClickable(false);
                current.setFocusable(false);
                ViewGroup parent = getActivity().findViewById(android.R.id.content);
                parent.addView(current, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                handler.postDelayed(poll, 1000);
            } catch (Exception error) {
                if (verificationHint != null) verificationHint.setText("A página ainda está carregando. Conclua a verificação e tente continuar novamente.");
            }
        });
    }

    private void complete(String url) {
        if (active == null || view == null) return;
        Uri target = Uri.parse(url);
        if (!"https".equalsIgnoreCase(target.getScheme())) { fail("O hospedador retornou um endereço de download inválido."); return; }
        JSObject result = new JSObject();
        result.put("url", url);
        result.put("referer", view.getUrl());
        JSObject headers = new JSObject();
        headers.put("User-Agent", view.getSettings().getUserAgentString());
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) headers.put("Cookie", cookie);
        result.put("headers", headers);
        PluginCall call = active;
        cleanup();
        call.resolve(result);
    }

    private void fail(String message) {
        PluginCall call = active;
        cleanup();
        if (call != null) call.reject(message);
    }

    private void cleanup() {
        handler.removeCallbacks(poll);
        active = null;
        if (verificationDialog != null) {
            detachView();
            Dialog dialog = verificationDialog;
            verificationDialog = null;
            verificationHint = null;
            dialog.dismiss();
        }
        pendingVerification = null;
        NotificationManager notifications = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (notifications != null) notifications.cancel(9472);
        if (current == this) current = null;
        DownloadKeepAliveService.stop(getContext());
        if (view != null) {
            view.stopLoading();
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view.destroy();
            view = null;
        }
    }

    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> fail("Preparação do download interrompida."));
    }
}
