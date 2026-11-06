package com.estantelivre.app;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** A single temporary book, addressed by an unguessable session token. */
public final class BookShareServer implements Closeable {
    private final File file;
    private final String route, filename, title, author, mime;
    private final ServerSocket server;
    private final ExecutorService clients = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(4), new ThreadPoolExecutor.AbortPolicy());
    private final Set<Socket> sockets = Collections.synchronizedSet(new HashSet<>());
    private final AtomicLong completed = new AtomicLong();
    private volatile boolean closed;

    public BookShareServer(File file, InetAddress address, String token, String filename,
                           String title, String author, String mime) throws IOException {
        this.file = file; this.route = "/s/" + token; this.filename = filename;
        this.title = title; this.author = author; this.mime = mime;
        server = new ServerSocket();
        server.bind(new InetSocketAddress(address, 0), 4);
        Thread acceptor = new Thread(this::accept, "book-share");
        acceptor.setDaemon(true); acceptor.start();
    }

    public String url() { return "http://" + server.getInetAddress().getHostAddress() + ":" + server.getLocalPort() + route; }
    public long completed() { return completed.get(); }
    private void accept() {
        while (!closed) {
            try {
                Socket client = server.accept();
                sockets.add(client);
                try { clients.execute(() -> serve(client)); }
                catch (RejectedExecutionException busy) { sockets.remove(client); client.close(); }
            } catch (IOException stopped) { if (!closed) close(); }
        }
    }

    private String line(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < 4096; i++) {
            int b = input.read();
            if (b == -1) throw new EOFException();
            if (b == '\n') return bytes.toString("US-ASCII").replace("\r", "");
            bytes.write(b);
        }
        throw new IOException("Header too long");
    }

    private void serve(Socket client) {
        try (Socket ignored = client) {
            client.setSoTimeout(10000);
            InputStream input = new BufferedInputStream(client.getInputStream());
            String[] request = line(input).split(" ");
            if (request.length != 3) return;
            int total = 0;
            for (;;) { String header = line(input); total += header.length(); if (total > 16384) return; if (header.isEmpty()) break; }
            OutputStream out = new BufferedOutputStream(client.getOutputStream());
            if (!request[0].equals("GET") && !request[0].equals("HEAD")) {
                respond(out, "405 Method Not Allowed", "text/plain", "Método não permitido.", false); return;
            }
            boolean head = request[0].equals("HEAD");
            if (request[1].equals(route + "/file." + extension())) {
                String disposition = "attachment; filename=\"livro." + extension() + "\"; filename*=UTF-8''" + encode(filename);
                headers(out, "200 OK", mime, file.length(), "Content-Disposition: " + disposition + "\r\n");
                if (!head) {
                    try (InputStream book = new FileInputStream(file)) {
                        byte[] buffer = new byte[65536]; int n;
                        while (!closed && (n = book.read(buffer)) != -1) out.write(buffer, 0, n);
                    }
                }
                out.flush();
                if (!head && !closed) completed.incrementAndGet();
            } else if (request[1].equals(route) || request[1].equals(route + "/")) {
                respond(out, "200 OK", "text/html; charset=utf-8", landing(), head);
            } else respond(out, "404 Not Found", "text/plain; charset=utf-8", "Compartilhamento indisponível.", head);
        } catch (IOException ignored) { /* Disconnected peer; another attempt can resume by restarting. */ }
        finally { sockets.remove(client); }
    }

    private String extension() { return filename.substring(filename.lastIndexOf('.') + 1); }
    private static String encode(String s) { try { return URLEncoder.encode(s, "UTF-8").replace("+", "%20"); } catch (Exception impossible) { throw new IllegalStateException(impossible); } }
    private static String html(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }
    private String landing() {
        String download = url() + "/file." + extension();
        String app = "estantelivre://receive?url=" + encode(download) + "&title=" + encode(title) + "&author=" + encode(author);
        return "<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">" +
            "<title>Receber livro · Estante Livre</title><style>body{font:17px system-ui;background:#10121c;color:#f6f5ff;max-width:500px;margin:12vh auto;padding:24px}h1{font-size:28px}p{line-height:1.6;color:#c3c6d8}a{display:block;padding:16px;margin:16px 0;border-radius:12px;background:#7a5cff;color:white;text-decoration:none;text-align:center}.secondary{background:#292e43}</style>" +
            "<p>ESTANTE LIVRE · ENVIO POR WI-FI</p><h1>" + html(title) + "</h1><p>" + html(author) + "</p><p>" +
            String.format(Locale.ROOT, "%.1f MB", file.length() / 1048576.0) + " · " + extension().toUpperCase(Locale.ROOT) +
            "</p><p>Receba direto do outro celular, sem espera no hospedador.</p><a href=\"" + html(app) + "\">Adicionar à minha estante</a>" +
            "<a class=secondary href=\"" + html(download) + "\">Baixar arquivo</a><p>Para adicionar à estante, use o Estante Livre 1.7 ou mais recente. Mantenha os dois aparelhos na mesma rede Wi-Fi e a tela de compartilhamento aberta no aparelho que envia.</p></html>";
    }
    private void headers(OutputStream out, String status, String type, long length, String extra) throws IOException {
        out.write(("HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + length +
            "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n" +
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'\r\n" + extra + "\r\n").getBytes(StandardCharsets.UTF_8));
    }
    private void respond(OutputStream out, String status, String type, String content, boolean head) throws IOException {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        headers(out, status, type, bytes.length, ""); if (!head) out.write(bytes); out.flush();
    }
    @Override public void close() {
        closed = true;
        try { server.close(); } catch (IOException ignored) {}
        synchronized (sockets) { for (Socket s : sockets) try { s.close(); } catch (IOException ignored) {} }
        clients.shutdownNow();
    }
}
