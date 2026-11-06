package com.estantelivre.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onResume() {
        super.onResume();
        HostedDownloadPlugin.setAppBackground(false);
    }

    @Override public void onPause() {
        HostedDownloadPlugin.setAppBackground(true);
        super.onPause();
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HostedDownloadPlugin.class);
        registerPlugin(WifiSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
