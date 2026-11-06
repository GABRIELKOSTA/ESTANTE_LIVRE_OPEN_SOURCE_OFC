package com.estantelivre.app;

import android.content.Context;
import android.net.*;
import android.os.*;
import android.util.Base64;
import android.view.WindowManager;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.util.*;

@CapacitorPlugin(name = "WifiShare")
public class WifiSharePlugin extends Plugin {
    private File staged;
    private FileOutputStream output;
    private BookShareServer server;
    private String session, filename, title, author, mime;
    private long expected, written, expiresAt;
    private InetAddress address;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable expire = () -> { synchronized (this) { cleanup(); } };

    private InetAddress wifiAddress() throws Exception {
        ConnectivityManager manager = (ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities caps = manager.getNetworkCapabilities(network);
            LinkProperties props = manager.getLinkProperties(network);
            if (caps == null || props == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            for (LinkAddress link : props.getLinkAddresses()) {
                InetAddress ip = link.getAddress();
                if (ip instanceof Inet4Address && ip.isSiteLocalAddress()) return ip;
            }
        }
        // Hotspots may have no upstream Wi-Fi Network in ConnectivityManager.
        for (NetworkInterface iface : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!iface.isUp() || !iface.getName().matches("(?i)(wlan|wifi|ap|swlan).*")) continue;
            for (InetAddress ip : Collections.list(iface.getInetAddresses()))
                if (ip instanceof Inet4Address && ip.isSiteLocalAddress()) return ip;
        }
        throw new IOException("Conecte este celular ao Wi-Fi e tente novamente. Os dois aparelhos precisam estar na mesma rede.");
    }
    private void keepScreen(boolean keep) {
        getActivity().runOnUiThread(() -> {
            if (keep) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }
    private boolean matches(PluginCall call) { return session != null && session.equals(call.getString("sessionId")); }
    @PluginMethod public synchronized void begin(PluginCall call) {
        if (session != null) { call.reject("Já existe um compartilhamento em preparação ou aberto."); return; }
        try {
            String format = call.getString("format", "");
            if (!format.matches("epub|pdf|cbz|cbr|cb7")) throw new IOException("Formato não suportado para envio.");
            expected = call.getData().optLong("size", 0L);
            if (expected <= 0 || expected > 2147483647L) throw new IOException("Tamanho de arquivo inválido para envio.");
            address = wifiAddress();
            title = call.getString("title", "Livro"); author = call.getString("author", "");
            if (title.length() > 500 || author.length() > 500) throw new IOException("Título ou autor longo demais.");
            filename = title.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (filename.length() > 100) filename = filename.substring(0, 100);
            filename += "." + format;
            mime = format.equals("pdf") ? "application/pdf" : format.equals("epub") ? "application/epub+zip" : "application/octet-stream";
            staged = File.createTempFile("wifi-share-", ".tmp", getContext().getCacheDir());
            if (staged.getParentFile().getUsableSpace() < expected + 1048576) throw new IOException("Espaço insuficiente para preparar o envio.");
            output = new FileOutputStream(staged);
            session = UUID.randomUUID().toString().replace("-", ""); written = 0;
            // Also expire abandoned preparations; no server exists before finish.
            timer.postDelayed(expire, 900000);
            JSObject result = new JSObject(); result.put("sessionId", session); call.resolve(result);
        } catch (Exception error) { cleanup(); call.reject(error.getMessage()); }
    }
    @PluginMethod public synchronized void append(PluginCall call) {
        if (!matches(call) || output == null) { call.reject("O compartilhamento foi encerrado."); return; }
        try {
            long offset = call.getData().optLong("offset", -1L);
            String encoded = call.getString("data", "");
            if (offset != written || encoded.length() > 350000) throw new IOException("Parte inválida do arquivo.");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || written + bytes.length > expected) throw new IOException("Tamanho do arquivo não confere.");
            output.write(bytes); written += bytes.length; call.resolve();
        } catch (Exception error) { cleanup(); call.reject("Falha ao preparar o envio: " + error.getMessage()); }
    }
    @PluginMethod public synchronized void finish(PluginCall call) {
        if (!matches(call) || output == null) { call.reject("O compartilhamento foi encerrado."); return; }
        try {
            if (written != expected) throw new IOException("O arquivo ainda não terminou de ser preparado.");
            output.close(); output = null;
            if (!address.equals(wifiAddress())) throw new IOException("A rede Wi-Fi mudou. Prepare o envio novamente.");
            server = new BookShareServer(staged, address, session, filename, title, author, mime);
            timer.removeCallbacks(expire); timer.postDelayed(expire, 900000);
            expiresAt = System.currentTimeMillis() + 900000;
            keepScreen(true);
            JSObject result = new JSObject(); result.put("url", server.url()); result.put("expiresAt", expiresAt); call.resolve(result);
        } catch (Exception error) { cleanup(); call.reject("Não foi possível abrir o envio: " + error.getMessage()); }
    }
    @PluginMethod public synchronized void status(PluginCall call) {
        JSObject result = new JSObject();
        boolean active = matches(call) && server != null;
        result.put("active", active);
        if (active) result.put("completed", server.completed());
        call.resolve(result);
    }
    @PluginMethod public synchronized void stop(PluginCall call) { if (matches(call)) cleanup(); call.resolve(); }
    private void cleanup() {
        timer.removeCallbacks(expire);
        if (server != null) { server.close(); server = null; }
        if (output != null) { try { output.close(); } catch (IOException ignored) {} output = null; }
        if (staged != null) { staged.delete(); staged = null; }
        session = null; keepScreen(false);
    }
    @Override protected synchronized void handleOnDestroy() { cleanup(); }
}
