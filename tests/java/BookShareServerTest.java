package com.estantelivre.app;

import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class BookShareServerTest {
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static HttpURLConnection request(String url, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)new URL(url).openConnection();
        connection.setConnectTimeout(2000); connection.setReadTimeout(2000); connection.setRequestMethod(method);
        return connection;
    }
    public static void main(String[] args) throws Exception {
        Path file = Files.createTempFile("book-share-test-", ".pdf");
        byte[] bytes = new byte[1000123]; new Random(42).nextBytes(bytes); Files.write(file, bytes);
        BookShareServer server = new BookShareServer(file.toFile(), InetAddress.getLoopbackAddress(), "0123456789abcdef0123456789abcdef", "Livro de teste.pdf", "Livro <teste>", "Autora & Co", "application/pdf");
        String url = server.url();
        try {
            HttpURLConnection page = request(url, "GET");
            check(page.getResponseCode() == 200, "Landing page status");
            String html = new String(page.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            check(html.contains("Livro &lt;teste&gt;") && html.contains("Autora &amp; Co"), "Escape metadata");
            check(html.contains("estantelivre://receive?url="), "Deep link");
            page.disconnect();
            HttpURLConnection head = request(url + "/file.pdf", "HEAD");
            check(head.getContentLengthLong() == bytes.length, "HEAD length");
            check(head.getInputStream().readAllBytes().length == 0, "HEAD no body"); head.disconnect();
            check(server.completed() == 0, "HEAD not a completed transfer");
            for (int i = 0; i < 2; i++) {
                HttpURLConnection download = request(url + "/file.pdf", "GET");
                check(download.getResponseCode() == 200, "File status");
                check(download.getHeaderField("Content-Disposition").contains("filename*=UTF-8''Livro%20de%20teste.pdf"), "Download filename");
                check(Arrays.equals(bytes, download.getInputStream().readAllBytes()), "Exact book bytes"); download.disconnect();
            }
            check(server.completed() == 2, "Track completed transfers");
            for (String suffix : new String[]{"/../secret", "/file.epub", "/file.pdf?token=bad"}) {
                HttpURLConnection bad = request(url + suffix, "GET"); check(bad.getResponseCode() == 404, "Unknown route refused"); bad.disconnect();
            }
            HttpURLConnection wrong = request(url.replace("0123456789abcdef0123456789abcdef", "ffffffffffffffffffffffffffffffff"), "GET");
            check(wrong.getResponseCode() == 404, "Wrong session refused"); wrong.disconnect();
            HttpURLConnection post = request(url, "POST"); check(post.getResponseCode() == 405, "POST refused"); post.disconnect();
        } finally { server.close(); Files.delete(file); }
        try { request(url, "GET").getResponseCode(); throw new AssertionError("Server remains reachable after closing"); }
        catch (IOException expected) {}
        System.out.println("Wi-Fi server: transfer, links, token, HEAD and shutdown OK");
    }
}
