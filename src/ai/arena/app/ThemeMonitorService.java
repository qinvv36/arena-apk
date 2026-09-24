package ai.arena.app;

import android.app.Service;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.os.IBinder;

public class ThemeMonitorService extends Service {

    private ThemeBroadcastReceiver receiver;

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            receiver = new ThemeBroadcastReceiver();
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_CONFIGURATION_CHANGED);
            registerReceiver(receiver, filter);
        } catch (Throwable t) {
            t.printStackTrace();
        }
        if (!MainActivity.isActivityVisible) {
            MainActivity.applyLauncherIconSetting(this, MainActivity.isSystemNightMode(this));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!MainActivity.isActivityVisible) {
            MainActivity.applyLauncherIconSetting(this, MainActivity.isSystemNightMode(this));
        }
        return START_STICKY;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (newConfig == null) return;
        boolean isNight = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        if (!MainActivity.isActivityVisible) {
            MainActivity.applyLauncherIconSetting(this, isNight);
        }
    }

    @Override
    public void onDestroy() {
        if (receiver != null) {
            try {
                unregisterReceiver(receiver);
            } catch (Throwable ignored) {}
            receiver = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
