package ai.arena.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ThemeBroadcastReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        if (!MainActivity.isActivityVisible) {
            boolean isNight = MainActivity.isSystemNightMode(context);
            MainActivity.applyLauncherIconSetting(context, isNight);
        }
        try {
            context.startService(new Intent(context, ThemeMonitorService.class));
        } catch (Throwable ignored) {}
    }
}
