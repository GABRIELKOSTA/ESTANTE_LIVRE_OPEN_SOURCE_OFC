package com.estantelivre.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/** Keeps the host countdown alive when HyperOS puts the app in the background. */
public final class DownloadKeepAliveService extends Service {
    private static final String CHANNEL = "download-countdown";
    private static final int ID = 9469;

    public static void start(Context context) {
        Intent intent = new Intent(context, DownloadKeepAliveService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, DownloadKeepAliveService.class));
    }

    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Preparação de download", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantém ativa a preparação do download gratuito em segundo plano.");
            channel.setShowBadge(false);
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Estante Livre preparando download")
            .setContentText("A contagem continua em segundo plano. Avisaremos quando for hora de concluir o CAPTCHA.")
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(ID, notification);
        return START_NOT_STICKY;
    }

    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
