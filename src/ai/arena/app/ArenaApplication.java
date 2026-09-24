package ai.arena.app;

import android.app.Application;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;

public class ArenaApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_CONFIGURATION_CHANGED);
            registerReceiver(new ThemeBroadcastReceiver(), filter);
        } catch (Throwable t) {
            t.printStackTrace();
        }
        if (!MainActivity.isActivityVisible) {
            boolean isNight = MainActivity.isSystemNightMode(this);
            MainActivity.applyLauncherIconSetting(this, isNight);
        }
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
}
