package ai.arena.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.provider.MediaStore;
import android.util.TypedValue;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity implements OnBackInvokedCallback, View.OnApplyWindowInsetsListener, View.OnTouchListener, Runnable {

    public FrameLayout rootLayout;
    public WebView webView;
    public ProgressBar progressBar;
    public LinearLayout ptrHeaderView;
    public TextView ptrArrowView;
    public ProgressBar ptrSpinnerView;
    public TextView ptrLabelView;
    public View ptrBorderView;
    public View topDividerView;
    public float density = 3.0f;
    public int ptrHeaderHeightPx = 480;
    public float ptrThresholdPx = 168f;
    public float ptrMaxPullPx = 390f;
    public float ptrRefreshHoldPx = 156f;
    public float ptrTouchSlop = 24f;
    public float ptrDownX = 0f;
    public float ptrDownY = 0f;
    public float ptrPullStartY = 0f;
    public float ptrCurrentPullPx = 0f;
    public boolean ptrIsPulling = false;
    public boolean ptrIgnoreGesture = false;
    public boolean ptrIsRefreshing = false;
    public volatile boolean webViewCanPull = true;

    @SuppressWarnings("rawtypes")
    public ValueCallback uploadMessage;
    public WebChromeClient.FileChooserParams pendingChooserParams;
    public static final int FILECHOOSER_RESULTCODE = 1001;
    public static final int PERMISSION_REQUEST_MEDIA = 2001;
    public static volatile boolean isActivityVisible = false;
    public String suiteScript = "";
    public String accountSwitchScript = "";
    public int topCutoutOffsetPx = 0;
    public volatile boolean isModalActive = false;
    public boolean isCurrentDark = false;
    public boolean lastConfigNight = false;
    public boolean needsWebThemeSync = true;
    public boolean targetWebThemeDark = false;
    public boolean isWaitingForResult = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        isActivityVisible = true;

        // Enable true immersive fullscreen & camera cutout area
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                Window window = getWindow();
                if (window != null) {
                    WindowManager.LayoutParams lp = window.getAttributes();
                    if (lp != null) {
                        lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                        window.setAttributes(lp);
                    }
                }
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }

        boolean isNight = isSystemNightMode(this);
        this.lastConfigNight = isNight;
        this.isCurrentDark = isNight;
        this.needsWebThemeSync = true;
        this.targetWebThemeDark = isNight;

        try {
            startService(new Intent(this, ThemeMonitorService.class));
        } catch (Throwable ignored) {}

        // Ensure any broken cached script from previous APK versions is wiped on APK upgrade
        try {
            SharedPreferences sp = getSharedPreferences("app_meta", MODE_PRIVATE);
            int lastVer = sp.getInt("last_apk_version", 0);
            if (lastVer < 31) {
                File brokenSuite = new File(getFilesDir(), "arena_suite_latest.js");
                if (brokenSuite.exists()) brokenSuite.delete();
                File brokenTmp = new File(getFilesDir(), "arena_suite_latest.tmp");
                if (brokenTmp.exists()) brokenTmp.delete();
                File brokenSwitch = new File(getFilesDir(), "arena_account_switch_latest.js");
                if (brokenSwitch.exists()) brokenSwitch.delete();
                File brokenSwitchTmp = new File(getFilesDir(), "arena_account_switch_latest.tmp");
                if (brokenSwitchTmp.exists()) brokenSwitchTmp.delete();
                sp.edit().putInt("last_apk_version", 31).apply();
            }
        } catch (Throwable ignored) {}

        // Load userscripts (prioritizes hot-updated scripts in filesDir over APK assets)
        suiteScript = loadCurrentScript();
        accountSwitchScript = loadCurrentAccountSwitchScript();

        density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 3.0f;
        ptrHeaderHeightPx = Math.round(180f * density);
        ptrThresholdPx = 56f * density;
        ptrMaxPullPx = 132f * density;
        ptrRefreshHoldPx = 52f * density;
        ptrTouchSlop = Math.max(ViewConfiguration.get(this).getScaledTouchSlop(), Math.round(8f * density));

        // Root container (fills 100% full screen including punch-hole camera cutout)
        rootLayout = new FrameLayout(this);
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // Listen for WindowInsets so bottom navigation bar and keyboard automatically lift the view
        rootLayout.setOnApplyWindowInsetsListener(this);

        // True edge-to-edge layout: WebView spans from y=0 to physical top edge, web UI handles safe padding
        topCutoutOffsetPx = 0;

        // WebView
        webView = new WebView(this);
        FrameLayout.LayoutParams wvParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        wvParams.topMargin = 0;
        webView.setLayoutParams(wvParams);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus(View.FOCUS_DOWN);
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
        webView.setOnTouchListener(this);
        rootLayout.addView(webView);

        // Top divider hairline: hidden in edge-to-edge mode for seamless background
        topDividerView = new View(this);
        topDividerView.setVisibility(View.GONE);
        topDividerView.setFocusable(false);
        topDividerView.setClickable(false);
        rootLayout.addView(topDividerView);

        // Native Pull-To-Refresh Header (sinks together with WebView from top edge)
        ptrHeaderView = new LinearLayout(this);
        ptrHeaderView.setOrientation(LinearLayout.VERTICAL);
        ptrHeaderView.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams ptrParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ptrHeaderHeightPx);
        ptrParams.gravity = Gravity.TOP;
        ptrHeaderView.setLayoutParams(ptrParams);
        ptrHeaderView.setTranslationY(-ptrHeaderHeightPx);

        LinearLayout ptrRow = new LinearLayout(this);
        ptrRow.setOrientation(LinearLayout.HORIZONTAL);
        ptrRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.round(52f * density));
        ptrRow.setLayoutParams(rowParams);

        ptrArrowView = new TextView(this);
        ptrArrowView.setText("↓");
        ptrArrowView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
        ptrArrowView.setTypeface(Typeface.DEFAULT_BOLD);
        ptrArrowView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams arrowParams = new LinearLayout.LayoutParams(
                Math.round(20f * density), Math.round(20f * density));
        ptrArrowView.setLayoutParams(arrowParams);
        ptrRow.addView(ptrArrowView);

        ptrSpinnerView = new ProgressBar(this);
        ptrSpinnerView.setIndeterminate(true);
        ptrSpinnerView.setVisibility(View.GONE);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(
                Math.round(16f * density), Math.round(16f * density));
        ptrSpinnerView.setLayoutParams(spinnerParams);
        ptrRow.addView(ptrSpinnerView);

        ptrLabelView = new TextView(this);
        ptrLabelView.setText("下拉刷新");
        ptrLabelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        ptrLabelView.setPadding(Math.round(8f * density), 0, 0, 0);
        ptrRow.addView(ptrLabelView);

        ptrHeaderView.addView(ptrRow);

        ptrBorderView = new View(this);
        ptrBorderView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, Math.round(0.8f * density))));
        ptrHeaderView.addView(ptrBorderView);

        rootLayout.addView(ptrHeaderView);

        // Top horizontal progress bar
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 8);
        pbParams.gravity = Gravity.TOP;
        progressBar.setLayoutParams(pbParams);
        progressBar.setMax(100);
        rootLayout.addView(progressBar);

        setContentView(rootLayout);

        // Apply fullscreen safely after decor view is attached
        applyFullScreen();

        // Apply dark/light status bar & navigation bar colors
        updateSystemBarsAndTheme(isNight);

        // Configure modern WebSettings
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSafeBrowsingEnabled(true);

        // Disable algorithmic darkening so webpage can freely toggle light and dark mode without forced inversion
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        }

        // Configure modern Chrome Mobile User Agent (Android 14 Chrome 128+)
        String ua = settings.getUserAgentString();
        if (ua != null) {
            ua = ua.replace("; wv", "").replace("Version/4.0 ", "");
            if (!ua.contains("Chrome/")) {
                ua = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
            }
            settings.setUserAgentString(ua);
        }

        // Enable Cookies
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // Disable native overscroll glow/stretch to allow smooth page pull-down
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // Set Clients
        webView.setWebViewClient(new ArenaWebViewClient(this, suiteScript));
        webView.setWebChromeClient(new ArenaWebChromeClient(this));

        // Modern Android 13/14+ Predictive Back Navigation
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                this
            );
        }

        // Load Arena URL (defaults to /agent)
        webView.loadUrl("https://arena.ai/agent");
    }

    public boolean isSystemNightMode() {
        return isSystemNightMode(this);
    }

    public static boolean isSystemNightMode(Context context) {
        if (context == null) return false;
        int uiMode = context.getResources().getConfiguration().uiMode;
        return (uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
        if (insets == null) return insets;
        try {
            int imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
            v.setPadding(0, 0, 0, imeBottom);
        } catch (Throwable t) {
            t.printStackTrace();
        }
        return insets;
    }

    public void applyFullScreen() {
        try {
            Window window = getWindow();
            if (window == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
                View decorView = window.peekDecorView();
                if (decorView == null) {
                    try {
                        decorView = window.getDecorView();
                    } catch (Throwable ignored) {}
                }
                if (decorView != null) {
                    WindowInsetsController controller = decorView.getWindowInsetsController();
                    if (controller != null) {
                        controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                        controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    }
                }
            } else {
                View decorView = window.peekDecorView();
                if (decorView == null) {
                    try {
                        decorView = window.getDecorView();
                    } catch (Throwable ignored) {}
                }
                if (decorView != null) {
                    decorView.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    );
                }
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        applyFullScreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyFullScreen();
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        isActivityVisible = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        isActivityVisible = true;
        isWaitingForResult = false;
        applyFullScreen();
        boolean isNight = isSystemNightMode(this);
        if (isNight != this.lastConfigNight) {
            this.lastConfigNight = isNight;
            this.isCurrentDark = isNight;
            this.needsWebThemeSync = true;
            this.targetWebThemeDark = isNight;
            updateSystemBarsAndTheme(isNight);
            syncWebPageTheme(isNight);
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (!isWaitingForResult) {
            isActivityVisible = false;
            applyLauncherIconSetting(this, isSystemNightMode(this));
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean isNight = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        this.lastConfigNight = isNight;
        this.isCurrentDark = isNight;
        this.needsWebThemeSync = true;
        this.targetWebThemeDark = isNight;
        updateSystemBarsAndTheme(isNight);
        syncWebPageTheme(isNight);
        if (!isActivityVisible) {
            applyLauncherIconSetting(this, isNight);
        }
    }

    public static void applyLauncherIconSetting(Context context, boolean isNight) {
        if (context == null) return;
        try {
            PackageManager pm = context.getPackageManager();
            ComponentName lightComp = new ComponentName(context, "ai.arena.app.MainActivityLight");
            ComponentName darkComp = new ComponentName(context, "ai.arena.app.MainActivityDark");

            int lightState = pm.getComponentEnabledSetting(lightComp);
            int darkState = pm.getComponentEnabledSetting(darkComp);

            boolean isLightEnabled = (lightState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    || lightState == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT);
            boolean isDarkEnabled = (darkState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED);

            if (isNight) {
                if (!isDarkEnabled) {
                    pm.setComponentEnabledSetting(darkComp, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                }
                if (isLightEnabled) {
                    pm.setComponentEnabledSetting(lightComp, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            } else {
                if (!isLightEnabled) {
                    pm.setComponentEnabledSetting(lightComp, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                }
                if (isDarkEnabled) {
                    pm.setComponentEnabledSetting(darkComp, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    public static class DelayedThemeSyncRunnable implements Runnable {
        private final MainActivity activity;
        private final boolean isNight;

        public DelayedThemeSyncRunnable(MainActivity activity, boolean isNight) {
            this.activity = activity;
            this.isNight = isNight;
        }

        @Override
        public void run() {
            if (activity != null && activity.webView != null) {
                activity.executeThemeSyncJs(isNight);
            }
        }
    }

    public void syncWebPageTheme(boolean isNight) {
        if (webView == null) return;
        executeThemeSyncJs(isNight);
        webView.postDelayed(new DelayedThemeSyncRunnable(this, isNight), 250);
    }

    public void executeThemeSyncJs(boolean isNight) {
        if (webView == null) return;
        String js = String.format(
            "javascript:(function(){" +
            "  var isDark = %b;" +
            "  var target = isDark ? 'dark' : 'light';" +
            "  var remove = isDark ? 'light' : 'dark';" +
            "  var d = document.documentElement;" +
            "  if (d) {" +
            "    d.classList.remove(remove);" +
            "    d.classList.add(target);" +
            "    d.style.colorScheme = target;" +
            "    if (d.dataset) {" +
            "      d.dataset.theme = target;" +
            "      d.dataset.colorScheme = target;" +
            "    }" +
            "  }" +
            "  if (document.body) {" +
            "    document.body.classList.remove(remove);" +
            "    document.body.classList.add(target);" +
            "    document.body.style.colorScheme = target;" +
            "  }" +
            "  try { localStorage.setItem('theme', target); } catch(e) {}" +
            "  try {" +
            "    window.dispatchEvent(new StorageEvent('storage', {" +
            "      key: 'theme'," +
            "      newValue: target," +
            "      oldValue: remove," +
            "      storageArea: localStorage," +
            "      url: window.location.href" +
            "    }));" +
            "  } catch(e) {}" +
            "})();",
            isNight
        );
        webView.evaluateJavascript(js, null);
    }

    public void updateFullscreenModalState(boolean isModalOpen) {
        this.isModalActive = isModalOpen;
        if (webView != null) {
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) webView.getLayoutParams();
            if (lp != null && lp.topMargin != 0) {
                lp.topMargin = 0;
                webView.setLayoutParams(lp);
            }
        }
        if (topDividerView != null) {
            topDividerView.setVisibility(View.GONE);
        }
        if (rootLayout != null) {
            if (isModalOpen) {
                rootLayout.setBackgroundColor(Color.parseColor("#161513"));
            } else {
                int themeColor = isCurrentDark ? Color.parseColor("#252523") : Color.parseColor("#FBFAF8");
                rootLayout.setBackgroundColor(themeColor);
            }
        }
    }

    public void updateSystemBarsAndTheme(boolean isDark) {
        try {
            this.isCurrentDark = isDark;
            int themeColor = isDark ? Color.parseColor("#252523") : Color.parseColor("#FBFAF8");

            if (rootLayout != null) {
                if (!isModalActive) {
                    rootLayout.setBackgroundColor(themeColor);
                }
            }

            Window window = getWindow();
            if (window != null) {
                window.setStatusBarColor(Color.TRANSPARENT);
                window.setNavigationBarColor(Color.TRANSPARENT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    View decorView = window.peekDecorView();
                    if (decorView == null) {
                        try {
                            decorView = window.getDecorView();
                        } catch (Throwable ignored) {}
                    }
                    if (decorView != null) {
                        WindowInsetsController controller = decorView.getWindowInsetsController();
                        if (controller != null) {
                            if (isDark) {
                                controller.setSystemBarsAppearance(0,
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                            } else {
                                controller.setSystemBarsAppearance(
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                            }
                        }
                    }
                }
            }

            if (webView != null) {
                webView.setBackgroundColor(themeColor);
            }
            if (topDividerView != null) {
                int dividerColor = isDark ? Color.parseColor("#1AFFFFFF") : Color.parseColor("#14000000");
                topDividerView.setBackgroundColor(dividerColor);
            }
            updatePtrHeaderTheme(isDark, ptrIsRefreshing || ptrCurrentPullPx >= ptrThresholdPx);
            applyFullScreen();
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    public void updatePtrHeaderTheme(boolean isDark, boolean isReadyOrRefreshing) {
        if (ptrHeaderView == null) return;
        int bgColor = isDark ? Color.parseColor("#252523") : Color.parseColor("#FBFAF8");
        int borderColor = isDark ? Color.parseColor("#1AFFFFFF") : Color.parseColor("#14000000");
        int fgColor;
        if (isDark) {
            fgColor = isReadyOrRefreshing ? Color.parseColor("#E5E7EB") : Color.parseColor("#9CA3AF");
        } else {
            fgColor = isReadyOrRefreshing ? Color.parseColor("#1F2937") : Color.parseColor("#6B7280");
        }
        ptrHeaderView.setBackgroundColor(bgColor);
        if (ptrBorderView != null) {
            ptrBorderView.setBackgroundColor(borderColor);
        }
        if (ptrArrowView != null) {
            ptrArrowView.setTextColor(fgColor);
        }
        if (ptrLabelView != null) {
            ptrLabelView.setTextColor(fgColor);
        }
        if (ptrSpinnerView != null) {
            ptrSpinnerView.setIndeterminateTintList(ColorStateList.valueOf(fgColor));
        }
    }

    public void resetNativePullToRefresh() {
        ptrIsRefreshing = false;
        ptrIsPulling = false;
        ptrCurrentPullPx = 0f;
        if (webView != null) {
            webView.animate().translationY(0f).setDuration(240).start();
        }
        if (topDividerView != null) {
            topDividerView.animate().translationY(0f).setDuration(240).start();
        }
        if (ptrHeaderView != null) {
            ptrHeaderView.animate().translationY(-ptrHeaderHeightPx).setDuration(240).start();
        }
        if (ptrArrowView != null) {
            ptrArrowView.setVisibility(View.VISIBLE);
            ptrArrowView.setRotation(0f);
        }
        if (ptrSpinnerView != null) {
            ptrSpinnerView.setVisibility(View.GONE);
        }
        if (ptrLabelView != null) {
            ptrLabelView.setText("下拉刷新");
        }
        updatePtrHeaderTheme(isCurrentDark, false);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (ev == null || webView == null || ptrHeaderView == null) {
            return super.dispatchTouchEvent(ev);
        }
        int action = ev.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            ptrDownX = ev.getRawX();
            ptrDownY = ev.getRawY();
            ptrPullStartY = ptrDownY;
            ptrIsPulling = false;
            ptrCurrentPullPx = 0f;
            ptrIgnoreGesture = ptrIsRefreshing || isModalActive || webView.canScrollVertically(-1);
            if (!ptrIgnoreGesture) {
                webViewCanPull = true;
            }
            return super.dispatchTouchEvent(ev);
        }

        if (action == MotionEvent.ACTION_POINTER_DOWN) {
            if (ptrIsPulling) {
                resetNativePullToRefresh();
            }
            ptrIgnoreGesture = true;
            return super.dispatchTouchEvent(ev);
        }

        if (action == MotionEvent.ACTION_MOVE) {
            if (ptrIgnoreGesture || ptrIsRefreshing) {
                return super.dispatchTouchEvent(ev);
            }
            float dx = ev.getRawX() - ptrDownX;
            float dy = ev.getRawY() - ptrDownY;

            if (!ptrIsPulling) {
                if (Math.abs(dx) > ptrTouchSlop && Math.abs(dx) > Math.abs(dy)) {
                    ptrIgnoreGesture = true;
                    return super.dispatchTouchEvent(ev);
                }
                if (dy < -ptrTouchSlop) {
                    ptrIgnoreGesture = true;
                    return super.dispatchTouchEvent(ev);
                }
                if (dy > ptrTouchSlop && dy > Math.abs(dx) * 1.25f) {
                    if (webViewCanPull && !webView.canScrollVertically(-1)) {
                        ptrIsPulling = true;
                        ptrPullStartY = ev.getRawY();
                        webView.animate().cancel();
                        if (topDividerView != null) {
                            topDividerView.animate().cancel();
                        }
                        ptrHeaderView.animate().cancel();
                        MotionEvent cancelEv = MotionEvent.obtain(ev);
                        cancelEv.setAction(MotionEvent.ACTION_CANCEL);
                        super.dispatchTouchEvent(cancelEv);
                        cancelEv.recycle();
                    } else {
                        ptrIgnoreGesture = true;
                        return super.dispatchTouchEvent(ev);
                    }
                }
            }

            if (ptrIsPulling) {
                float rawPull = Math.max(0f, ev.getRawY() - ptrPullStartY);
                float dampedDp = (float) (Math.pow(rawPull / density, 0.84) * 1.65);
                ptrCurrentPullPx = Math.min(ptrMaxPullPx, dampedDp * density);
                webView.setTranslationY(ptrCurrentPullPx);
                if (topDividerView != null) {
                    topDividerView.setTranslationY(ptrCurrentPullPx);
                }
                ptrHeaderView.setTranslationY(ptrCurrentPullPx - ptrHeaderHeightPx);

                boolean ready = ptrCurrentPullPx >= ptrThresholdPx;
                if (ptrLabelView != null) {
                    ptrLabelView.setText(ready ? "释放立即刷新" : "下拉刷新");
                }
                if (ptrArrowView != null) {
                    float deg = Math.min(180f, (ptrCurrentPullPx / ptrThresholdPx) * 180f);
                    ptrArrowView.setRotation(deg);
                }
                updatePtrHeaderTheme(isCurrentDark, ready);
                return true;
            }
        }

        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            if (ptrIsPulling) {
                ptrIsPulling = false;
                if (action == MotionEvent.ACTION_UP && ptrCurrentPullPx >= ptrThresholdPx) {
                    ptrIsRefreshing = true;
                    if (ptrArrowView != null) ptrArrowView.setVisibility(View.GONE);
                    if (ptrSpinnerView != null) ptrSpinnerView.setVisibility(View.VISIBLE);
                    if (ptrLabelView != null) ptrLabelView.setText("正在刷新...");
                    updatePtrHeaderTheme(isCurrentDark, true);
                    webView.animate().translationY(ptrRefreshHoldPx).setDuration(200).start();
                    if (topDividerView != null) {
                        topDividerView.animate().translationY(ptrRefreshHoldPx).setDuration(200).start();
                    }
                    ptrHeaderView.animate().translationY(ptrRefreshHoldPx - ptrHeaderHeightPx).setDuration(200).start();
                    if (progressBar != null) {
                        progressBar.setVisibility(View.VISIBLE);
                        progressBar.setProgress(15);
                    }
                    webView.reload();
                    webView.postDelayed(new PtrResetRunnable(this), 6000);
                } else {
                    resetNativePullToRefresh();
                }
                return true;
            }
        }

        return super.dispatchTouchEvent(ev);
    }

    public static class PtrResetRunnable implements Runnable {
        private final MainActivity activity;

        public PtrResetRunnable(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void run() {
            if (activity != null) {
                activity.resetNativePullToRefresh();
            }
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_DOWN || event.getAction() == MotionEvent.ACTION_UP) {
            if (!v.hasFocus()) {
                v.requestFocus();
            }
        }
        return false;
    }

    @Override
    public void run() {
        if (webView != null) {
            if (!webView.hasFocus()) {
                webView.requestFocus();
            }
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.restartInput(webView);
                imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
            }
        }
    }

    public static class ReloadRunnable implements Runnable {
        private final WebView webView;

        public ReloadRunnable(WebView webView) {
            this.webView = webView;
        }

        @Override
        public void run() {
            if (webView != null) {
                webView.reload();
            }
        }
    }

    public static class DownloaderRunnable implements Runnable {
        private final MainActivity activity;
        private final String urlStr;

        public DownloaderRunnable(MainActivity activity, String urlStr) {
            this.activity = activity;
            this.urlStr = urlStr;
        }

        @Override
        public void run() {
            if (activity != null) {
                activity.downloadWorker(urlStr);
            }
        }
    }

    public static class WebReloadRunnable implements Runnable {
        private final MainActivity activity;

        public WebReloadRunnable(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void run() {
            if (activity != null) {
                if (activity.progressBar != null) {
                    activity.progressBar.setVisibility(View.VISIBLE);
                    activity.progressBar.setProgress(15);
                }
                if (activity.webView != null) {
                    activity.webView.reload();
                }
            }
        }
    }

    public static class ModalStateRunnable implements Runnable {
        private final MainActivity activity;
        private final boolean isModalOpen;

        public ModalStateRunnable(MainActivity activity, boolean isModalOpen) {
            this.activity = activity;
            this.isModalOpen = isModalOpen;
        }

        @Override
        public void run() {
            if (activity != null) {
                activity.updateFullscreenModalState(isModalOpen);
            }
        }
    }

    public static class ThemeChangeRunnable implements Runnable {
        private final MainActivity activity;
        private final boolean isDark;

        public ThemeChangeRunnable(MainActivity activity, boolean isDark) {
            this.activity = activity;
            this.isDark = isDark;
        }

        @Override
        public void run() {
            if (activity != null) {
                activity.updateSystemBarsAndTheme(isDark);
            }
        }
    }

    public static class TopColorRunnable implements Runnable {
        private final MainActivity activity;
        private final int color;

        public TopColorRunnable(MainActivity activity, int color) {
            this.activity = activity;
            this.color = color;
        }

        @Override
        public void run() {
            if (activity != null) {
                if (activity.rootLayout != null && !activity.isModalActive) {
                    activity.rootLayout.setBackgroundColor(color);
                }
                if (activity.webView != null) {
                    activity.webView.setBackgroundColor(color);
                }
                if (activity.ptrHeaderView != null) {
                    activity.ptrHeaderView.setBackgroundColor(color);
                }
                if (activity.topDividerView != null) {
                    int r = Color.red(color);
                    int g = Color.green(color);
                    int b = Color.blue(color);
                    double lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
                    boolean isDark = lum < 0.5;
                    int divColor = isDark ? Color.parseColor("#1AFFFFFF") : Color.parseColor("#14000000");
                    activity.topDividerView.setBackgroundColor(divColor);
                }
            }
        }
    }

    public static class AndroidBridge {
        private final MainActivity activity;

        public AndroidBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void setFullscreenModal(boolean isModalOpen) {
            if (activity != null) {
                activity.runOnUiThread(new ModalStateRunnable(activity, isModalOpen));
            }
        }

        @JavascriptInterface
        public void setCanPullToRefresh(boolean canPull) {
            if (activity != null) {
                activity.webViewCanPull = canPull;
            }
        }

        @JavascriptInterface
        public void onThemeChanged(boolean isDark) {
            if (activity != null) {
                activity.runOnUiThread(new ThemeChangeRunnable(activity, isDark));
            }
        }

        @JavascriptInterface
        public void syncTopBarColor(int r, int g, int b) {
            if (activity != null && r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
                activity.runOnUiThread(new TopColorRunnable(activity, Color.rgb(r, g, b)));
            }
        }

        @JavascriptInterface
        public void requestInputFocus() {
            if (activity != null) {
                activity.runOnUiThread(activity);
            }
        }

        @JavascriptInterface
        public void reloadPage() {
            if (activity != null) {
                activity.runOnUiThread(new WebReloadRunnable(activity));
            }
        }

        @JavascriptInterface
        public void applyHotUpdate(String code) {
            if (activity != null) {
                activity.applyHotUpdate(code);
            }
        }

        @JavascriptInterface
        public void performHotUpdate(String url) {
            if (activity != null) {
                activity.downloadAndApplyScript(url);
            }
        }

        @JavascriptInterface
        public void applyAccountSwitchHotUpdate(String code) {
            if (activity != null) {
                activity.applyAccountSwitchHotUpdate(code);
            }
        }

        @JavascriptInterface
        public void performAccountSwitchHotUpdate(String url) {
            if (activity != null) {
                activity.downloadAndApplyAccountSwitchScript(url);
            }
        }

        @JavascriptInterface
        public String gmGetValue(String key) {
            if (activity == null || key == null) return "";
            try {
                SharedPreferences sp = activity.getSharedPreferences("arena_gm_store", Context.MODE_PRIVATE);
                return sp.getString(key, "");
            } catch (Throwable ignored) {}
            return "";
        }

        @JavascriptInterface
        public void gmSetValue(String key, String jsonValue) {
            if (activity == null || key == null) return;
            try {
                SharedPreferences sp = activity.getSharedPreferences("arena_gm_store", Context.MODE_PRIVATE);
                sp.edit().putString(key, jsonValue != null ? jsonValue : "").apply();
            } catch (Throwable ignored) {}
        }

        @JavascriptInterface
        public void setClipboard(String text) {
            if (activity == null || text == null) return;
            try {
                ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("arena", text));
                }
            } catch (Throwable ignored) {}
        }

        @JavascriptInterface
        public String gmCookieList(String url) {
            try {
                CookieManager cm = CookieManager.getInstance();
                String target = (url != null && !url.isEmpty()) ? url : "https://arena.ai/";
                String raw = cm.getCookie(target);
                if (raw == null || raw.isEmpty()) {
                    raw = cm.getCookie("https://arena.ai/");
                }
                if (raw == null || raw.isEmpty()) {
                    raw = cm.getCookie("https://arena.ai");
                }
                if (raw == null || raw.isEmpty()) return "[]";
                JSONArray arr = new JSONArray();
                String[] parts = raw.split(";\\s*");
                for (int i = 0; i < parts.length; i++) {
                    String part = parts[i];
                    int eq = part.indexOf('=');
                    if (eq > 0) {
                        String k = part.substring(0, eq).trim();
                        String v = part.substring(eq + 1).trim();
                        JSONObject obj = new JSONObject();
                        obj.put("name", k);
                        obj.put("value", v);
                        obj.put("domain", "arena.ai");
                        obj.put("path", "/");
                        obj.put("secure", true);
                        obj.put("httpOnly", false);
                        obj.put("hostOnly", true);
                        obj.put("sameSite", "lax");
                        arr.put(obj);
                    }
                }
                return arr.toString();
            } catch (Throwable ignored) {}
            return "[]";
        }

        @JavascriptInterface
        public void gmCookieDelete(String url, String name, String path) {
            if (name == null || name.isEmpty()) return;
            try {
                CookieManager cm = CookieManager.getInstance();
                String p = (path != null && !path.isEmpty()) ? path : "/";
                String delHeader = name + "=; Path=" + p + "; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
                cm.setCookie("https://arena.ai", delHeader);
                cm.setCookie("https://arena.ai/", delHeader);
                cm.setCookie("https://arena.ai", delHeader + "; Domain=arena.ai");
                cm.setCookie("https://arena.ai/", delHeader + "; Domain=arena.ai");
                cm.setCookie("https://arena.ai", delHeader + "; Domain=.arena.ai");
                cm.setCookie("https://arena.ai/", delHeader + "; Domain=.arena.ai");
                cm.flush();
            } catch (Throwable ignored) {}
        }

        @JavascriptInterface
        public void gmCookieSet(String url, String name, String value, String domain, String path, boolean secure, boolean httpOnly) {
            if (name == null || name.isEmpty()) return;
            try {
                CookieManager cm = CookieManager.getInstance();
                String p = (path != null && !path.isEmpty()) ? path : "/";
                String val = (value != null) ? value : "";
                String baseHeader = name + "=" + val + "; Path=" + p + "; Max-Age=34560000; Secure; SameSite=Lax";
                cm.setCookie("https://arena.ai", baseHeader);
                cm.setCookie("https://arena.ai/", baseHeader);
                cm.setCookie("https://www.arena.ai", baseHeader);
                String dom = (domain != null && !domain.isEmpty()) ? domain : "arena.ai";
                cm.setCookie("https://arena.ai", baseHeader + "; Domain=" + dom);
                cm.setCookie("https://arena.ai/", baseHeader + "; Domain=" + dom);
                cm.flush();
            } catch (Throwable ignored) {}
        }
    }

    public static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    @Override
    public void onBackInvoked() {
        if (isModalActive) {
            if (webView != null) {
                webView.evaluateJavascript(
                    "if(typeof closeSwitcher==='function'){closeSwitcher();}" +
                    "var f=document.querySelector('[data-amp-login-form]');if(f)f.remove();", null);
            }
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    public static class ArenaWebViewClient extends WebViewClient {
        private final MainActivity activity;
        private final String suiteScript;

        public ArenaWebViewClient(MainActivity activity, String suiteScript) {
            this.activity = activity;
            this.suiteScript = suiteScript;
        }

        private void tryInject(WebView view, String url) {
            // 0. Intercept userscript update downloads in web page context (both Suite & Account-Switch)
            String updateHook = "javascript:(function(){" +
                    "if(window.__arena_update_hook__)return;" +
                    "window.__arena_update_hook__=true;" +
                    "var origOpen=window.open;" +
                    "window.open=function(u,t,f){" +
                    "  if(u&&typeof u==='string'){" +
                    "    if(u.indexOf('Arena-Native-Suite.user.js')!==-1&&window.AndroidBridge&&window.AndroidBridge.performHotUpdate){" +
                    "      (async function(){" +
                    "        try{" +
                    "          var resp=await(window.__ampNativeFetch||fetch)(u,{cache:'no-store'});" +
                    "          if(resp.ok){" +
                    "            var text=await resp.text();" +
                    "            if(text&&text.length>5000){" +
                    "              window.AndroidBridge.applyHotUpdate(text);" +
                    "              return;" +
                    "            }" +
                    "          }" +
                    "        }catch(e){}" +
                    "        window.AndroidBridge.performHotUpdate(u);" +
                    "      })();" +
                    "      return null;" +
                    "    }" +
                    "    if(u.indexOf('Arena-Account-Switch.user.js')!==-1&&window.AndroidBridge&&window.AndroidBridge.performAccountSwitchHotUpdate){" +
                    "      (async function(){" +
                    "        try{" +
                    "          var resp=await(window.__ampNativeFetch||fetch)(u,{cache:'no-store'});" +
                    "          if(resp.ok){" +
                    "            var text=await resp.text();" +
                    "            if(text&&text.length>2000){" +
                    "              window.AndroidBridge.applyAccountSwitchHotUpdate(text);" +
                    "              return;" +
                    "            }" +
                    "          }" +
                    "        }catch(e){}" +
                    "        window.AndroidBridge.performAccountSwitchHotUpdate(u);" +
                    "      })();" +
                    "      return null;" +
                    "    }" +
                    "  }" +
                    "  return origOpen?origOpen.apply(this,arguments):null;" +
                    "};" +
                    "})();";
            view.evaluateJavascript(updateHook, null);

            // 1. Universal input focus & soft keyboard handshake fix (all pages & SPA navigation)
            String inputFix = "javascript:(function(){" +
                    "if(window.__arena_input_focus_fix_installed__)return;" +
                    "window.__arena_input_focus_fix_installed__=true;" +
                    "function triggerNative(el){" +
                    "  if(!el)return;" +
                    "  try{if(window.AndroidBridge&&window.AndroidBridge.requestInputFocus){window.AndroidBridge.requestInputFocus();}}catch(e){}" +
                    "}" +
                    "var lastActive=null;" +
                    "function checkActive(){" +
                    "  var el=document.activeElement;" +
                    "  if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)){" +
                    "    if(el!==lastActive){lastActive=el;triggerNative(el);}" +
                    "  }else{lastActive=null;}" +
                    "}" +
                    "document.addEventListener('focusin',function(e){" +
                    "  var el=e.target;" +
                    "  if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)){" +
                    "    lastActive=el;triggerNative(el);" +
                    "  }" +
                    "},true);" +
                    "var onTouch=function(e){" +
                    "  var el=e.target;" +
                    "  if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)){" +
                    "    triggerNative(el);" +
                    "  }" +
                    "};" +
                    "document.addEventListener('pointerdown',onTouch,{passive:true,capture:true});" +
                    "document.addEventListener('touchstart',onTouch,{passive:true,capture:true});" +
                    "document.addEventListener('click',onTouch,true);" +
                    "try{" +
                    "  var ob=new MutationObserver(function(){checkActive();});" +
                    "  ob.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden','type']});" +
                    "}catch(e){}" +
                    "checkActive();" +
                    "})();";
            view.evaluateJavascript(inputFix, null);

            if (url != null && (url.contains("arena.ai") || url.contains("lmsys.org"))) {
                // 2. Observe web page theme changes (user toggling light/dark inside the app) and sync to native status bar + exact RGB top bar
                String themeObserver = "javascript:(function(){" +
                        "if(window.__arena_theme_observer_installed__)return;" +
                        "window.__arena_theme_observer_installed__=true;" +
                        "function reportTheme(){" +
                        "  var d=document.documentElement;" +
                        "  if(!d)return;" +
                        "  var isDark=d.classList.contains('dark')||(d.dataset&&d.dataset.theme==='dark')||(!d.classList.contains('light')&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
                        "  try{" +
                        "    if(window.AndroidBridge&&window.AndroidBridge.onThemeChanged){" +
                        "      window.AndroidBridge.onThemeChanged(isDark);" +
                        "    }" +
                        "    var bgEl=document.body||d;" +
                        "    var cs=bgEl?window.getComputedStyle(bgEl).backgroundColor:'';" +
                        "    var m=cs&&cs.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);" +
                        "    if(m&&window.AndroidBridge&&window.AndroidBridge.syncTopBarColor){" +
                        "      var r=parseInt(m[1],10),g=parseInt(m[2],10),b=parseInt(m[3],10);" +
                        "      if(r+g+b>0)window.AndroidBridge.syncTopBarColor(r,g,b);" +
                        "    }" +
                        "  }catch(e){}" +
                        "}" +
                        "reportTheme();" +
                        "setTimeout(reportTheme,150);" +
                        "setTimeout(reportTheme,500);" +
                        "try{" +
                        "  var ob=new MutationObserver(reportTheme);" +
                        "  ob.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});" +
                        "}catch(e){}" +
                        "window.addEventListener('storage',function(e){if(e.key==='theme')reportTheme();});" +
                        "})();";
                view.evaluateJavascript(themeObserver, null);

                // 3. Inject bottom lifting style fix so bottom text and input area are comfortable and never cut off
                String cssFix = "javascript:(function(){" +
                        "if(!document.getElementById('__arena_mobile_bottom_fix__')){" +
                        "var st=document.createElement('style');" +
                        "st.id='__arena_mobile_bottom_fix__';" +
                        "st.textContent='" +
                        "main,[role=\"main\"]{padding-bottom:32px !important;}" +
                        "form:has(textarea[name=\"message\"]),form:has(textarea){margin-bottom:16px !important;}" +
                        "#amp-native-bar{z-index:99999 !important;}" +
                        "#amp-lite-panel,[data-entry]{display:none !important;}" +
                        "div[data-sidebar=\"footer\"]{padding-bottom:28px !important;}" +
                        "';" +
                        "(document.head||document.documentElement).appendChild(st);" +
                        "}})();";
                view.evaluateJavascript(cssFix, null);

                // 3.5 Watch for fullscreen modals (Account Switcher, Login Form, Memo, etc.) to expand WebView to true 100% full screen
                String modalObserver = "javascript:(function(){" +
                        "if(window.__arena_modal_watcher_installed__)return;" +
                        "window.__arena_modal_watcher_installed__=true;" +
                        "var wasModal=false;" +
                        "function checkModal(){" +
                        "  var has=!!document.querySelector('[data-amp-switcher],[data-amp-login-form]');" +
                        "  if(has!==wasModal){" +
                        "    wasModal=has;" +
                        "    try{if(window.AndroidBridge&&window.AndroidBridge.setFullscreenModal){window.AndroidBridge.setFullscreenModal(has);}}catch(e){}" +
                        "  }" +
                        "}" +
                        "try{" +
                        "  var obs=new MutationObserver(checkModal);" +
                        "  obs.observe(document.documentElement||document,{childList:true,subtree:true});" +
                        "}catch(e){}" +
                        "checkModal();" +
                        "})();";
                view.evaluateJavascript(modalObserver, null);

                // 3.6 Inject mobile CSS layout overrides for switcher & login modals
                String switcherFixCss = "javascript:(function(){" +
                        "if(!document.getElementById('__arena_switcher_mobile_fix__')){" +
                        "var st=document.createElement('style');" +
                        "st.id='__arena_switcher_mobile_fix__';" +
                        "st.textContent='" +
                        "[data-amp-switcher] .sw-warn{display:none !important;}" +
                        "[data-amp-switcher].vert .sw-tl{left:12px !important;top:14px !important;display:flex !important;flex-wrap:nowrap !important;gap:6px !important;max-width:calc(100vw - 64px) !important;z-index:5 !important;}" +
                        "[data-amp-switcher].vert .sw-tl .sw-hkb{display:none !important;}" +
                        "[data-amp-switcher].vert .sw-tl .sw-memob{padding:6px 11px !important;font-size:12px !important;border-radius:999px !important;background:rgba(255,255,255,.12) !important;backdrop-filter:blur(4px) !important;white-space:nowrap !important;}" +
                        "[data-amp-switcher].vert .sw-close{right:12px !important;top:14px !important;width:34px !important;height:34px !important;line-height:34px !important;font-size:18px !important;z-index:5 !important;}" +
                        "[data-amp-switcher].vert .sw-top{top:58px !important;left:0 !important;right:0 !important;text-align:center !important;pointer-events:none !important;z-index:2 !important;}" +
                        "[data-amp-switcher].vert .sw-title{font-size:17px !important;font-weight:600 !important;letter-spacing:.3px !important;}" +
                        "[data-amp-switcher].vert .sw-sub{display:block !important;font-size:11.5px !important;color:rgba(243,241,236,.55) !important;margin-top:2px !important;}" +
                        "[data-amp-switcher].vert .sw-stage{top:43% !important;}" +
                        "[data-amp-switcher].vert .sw-mside{top:43% !important;right:calc(50% + 72px) !important;width:calc(50% - 84px) !important;max-width:140px !important;text-align:right !important;}" +
                        "[data-amp-switcher].vert .sw-mside .sw-q0{font-size:11.5px !important;font-weight:600 !important;}" +
                        "[data-amp-switcher].vert .sw-mside .sw-q1{font-size:17px !important;font-weight:700 !important;line-height:1.15 !important;white-space:nowrap !important;}" +
                        "[data-amp-switcher].vert .sw-addb{right:12px !important;top:43% !important;font-size:10.5px !important;}" +
                        "[data-amp-switcher].vert .sw-mcard{bottom:calc(max(14px, env(safe-area-inset-bottom, 14px)) + 36px) !important;width:min(320px, calc(100vw - 32px)) !important;padding:10px 14px !important;border-radius:14px !important;}" +
                        "[data-amp-switcher].vert .sw-hint{left:0 !important;right:0 !important;bottom:max(12px, env(safe-area-inset-bottom, 12px)) !important;text-align:center !important;font-size:11.5px !important;color:rgba(243,241,236,.45) !important;}" +
                        "[data-amp-login-form] .lf-card{max-width:min(380px, calc(100vw - 32px)) !important;box-sizing:border-box !important;}" +
                        "';" +
                        "(document.head||document.documentElement).appendChild(st);" +
                        "}})();";
                view.evaluateJavascript(switcherFixCss, null);

                // 4. Inject native Tampermonkey GM_* polyfill bridge for Arena-Account-Switch
                String gmPolyfill = "javascript:(function(){" +
                        "if(window.__arena_gm_polyfill__)return;" +
                        "window.__arena_gm_polyfill__=true;" +
                        "window.GM_getValue=function(k,defVal){" +
                        "  try{" +
                        "    if(window.AndroidBridge&&window.AndroidBridge.gmGetValue){" +
                        "      var raw=window.AndroidBridge.gmGetValue(String(k));" +
                        "      if(raw!==null&&raw!==undefined&&raw!=='')return JSON.parse(raw);" +
                        "    }" +
                        "  }catch(e){}" +
                        "  return defVal;" +
                        "};" +
                        "window.GM_setValue=function(k,val){" +
                        "  try{" +
                        "    if(window.AndroidBridge&&window.AndroidBridge.gmSetValue){" +
                        "      window.AndroidBridge.gmSetValue(String(k),JSON.stringify(val));" +
                        "    }" +
                        "  }catch(e){}" +
                        "};" +
                        "window.GM_addValueChangeListener=function(){};" +
                        "window.GM_registerMenuCommand=function(){};" +
                        "window.GM_setClipboard=function(text){" +
                        "  try{" +
                        "    if(window.AndroidBridge&&window.AndroidBridge.setClipboard){" +
                        "      window.AndroidBridge.setClipboard(String(text||''));" +
                        "    }else if(navigator.clipboard&&navigator.clipboard.writeText){" +
                        "      navigator.clipboard.writeText(String(text||''));" +
                        "    }" +
                        "  }catch(e){}" +
                        "};" +
                        "window.GM_cookie={" +
                        "  list:function(details,cb){" +
                        "    try{" +
                        "      var raw=window.AndroidBridge.gmCookieList((details&&details.url)||location.origin+'/');" +
                        "      var arr=JSON.parse(raw||'[]');" +
                        "      if(typeof cb==='function')cb(arr,null);" +
                        "    }catch(e){if(typeof cb==='function')cb(null,String(e));}" +
                        "  }," +
                        "  delete:function(details,cb){" +
                        "    try{" +
                        "      window.AndroidBridge.gmCookieDelete((details&&details.url)||location.origin+'/',(details&&details.name)||'',(details&&details.path)||'/');" +
                        "      if(typeof cb==='function')cb(null);" +
                        "    }catch(e){if(typeof cb==='function')cb(String(e));}" +
                        "  }," +
                        "  set:function(details,cb){" +
                        "    try{" +
                        "      window.AndroidBridge.gmCookieSet((details&&details.url)||location.origin+'/',(details&&details.name)||'',(details&&details.value)||'',(details&&details.domain)||'',(details&&details.path)||'/',details?details.secure!==false:true,!!(details&&details.httpOnly));" +
                        "      if(typeof cb==='function')cb(null);" +
                        "    }catch(e){if(typeof cb==='function')cb(String(e));}" +
                        "  }" +
                        "};" +
                        "window.GM=window.GM||{};window.GM.cookie=window.GM_cookie;" +
                        "})();";
                view.evaluateJavascript(gmPolyfill, null);

                // 5. Inject Arena-Native-Suite userscript
                String scriptToInject = activity != null ? activity.suiteScript : suiteScript;
                if (scriptToInject != null && !scriptToInject.isEmpty()) {
                    view.evaluateJavascript(scriptToInject, null);
                }

                // 6. Inject Arena-Account-Switch userscript
                String accScriptToInject = activity != null ? activity.accountSwitchScript : "";
                if (accScriptToInject != null && !accScriptToInject.isEmpty()) {
                    view.evaluateJavascript(accScriptToInject, null);
                }
            }
        }

        private void injectPullToRefresh(WebView view) {
            String ptrScript = "javascript:(function(){" +
                    "if(window.__arena_ptr_hook__)return;" +
                    "window.__arena_ptr_hook__=true;" +
                    "function checkCanPull(target){" +
                    "  if(!target)return true;" +
                    "  if(target.closest&&target.closest('input,textarea,[contenteditable=\"true\"],aside,[data-sidebar],#amp-lite-dock'))return false;" +
                    "  if(window.scrollY>2||(document.documentElement&&document.documentElement.scrollTop>2)||(document.body&&document.body.scrollTop>2))return false;" +
                    "  var el=target;" +
                    "  while(el&&el!==document.body&&el!==document.documentElement){" +
                    "    if(el.scrollTop>2)return false;" +
                    "    el=el.parentElement;" +
                    "  }" +
                    "  return true;" +
                    "}" +
                    "document.addEventListener('touchstart',function(e){" +
                    "  try{" +
                    "    var t=(e.touches&&e.touches[0])?document.elementFromPoint(e.touches[0].clientX,e.touches[0].clientY):e.target;" +
                    "    var ok=checkCanPull(t||e.target);" +
                    "    if(window.AndroidBridge&&window.AndroidBridge.setCanPullToRefresh){" +
                    "      window.AndroidBridge.setCanPullToRefresh(ok);" +
                    "    }" +
                    "  }catch(err){}" +
                    "},{passive:true,capture:true});" +
                    "})();";
            view.evaluateJavascript(ptrScript, null);
        }

        public static void resetPullToRefresh(WebView view) {
            if (view == null) return;
            Context ctx = view.getContext();
            if (ctx instanceof MainActivity) {
                final MainActivity act = (MainActivity) ctx;
                view.postDelayed(new PtrResetRunnable(act), 280);
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if (activity != null && activity.needsWebThemeSync && url != null && (url.contains("arena.ai") || url.contains("lmsys.org"))) {
                activity.executeThemeSyncJs(activity.targetWebThemeDark);
            }
            tryInject(view, url);
            injectPullToRefresh(view);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (activity != null && activity.needsWebThemeSync && url != null && (url.contains("arena.ai") || url.contains("lmsys.org"))) {
                activity.syncWebPageTheme(activity.targetWebThemeDark);
                activity.needsWebThemeSync = false;
            }
            tryInject(view, url);
            injectPullToRefresh(view);
            resetPullToRefresh(view);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request != null && request.getUrl() != null) {
                String u = request.getUrl().toString();
                if (u.contains("Arena-Native-Suite.user.js")) {
                    if (activity != null) {
                        activity.downloadAndApplyScript(u);
                    }
                    return true;
                }
                if (u.contains("Arena-Account-Switch.user.js")) {
                    if (activity != null) {
                        activity.downloadAndApplyAccountSwitchScript(u);
                    }
                    return true;
                }
            }
            return false;
        }
    }

    public static class ArenaWebChromeClient extends WebChromeClient {
        private final MainActivity activity;

        public ArenaWebChromeClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (newProgress >= 100) {
                activity.progressBar.setVisibility(View.GONE);
                ArenaWebViewClient.resetPullToRefresh(view);
            } else {
                if (activity.progressBar.getVisibility() == View.GONE) {
                    activity.progressBar.setVisibility(View.VISIBLE);
                }
                activity.progressBar.setProgress(newProgress);
            }
        }

        @SuppressWarnings("rawtypes")
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback filePathCallback,
                                         FileChooserParams fileChooserParams) {
            if (activity == null) return false;

            if (activity.uploadMessage != null) {
                activity.uploadMessage.onReceiveValue(null);
                activity.uploadMessage = null;
            }
            activity.uploadMessage = filePathCallback;
            activity.pendingChooserParams = fileChooserParams;
            activity.isWaitingForResult = true;

            // Check if media permissions need to be requested dynamically from the user
            List<String> neededPermissions = new ArrayList<>();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (activity.checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                    neededPermissions.add(android.Manifest.permission.READ_MEDIA_IMAGES);
                }
                if (activity.checkSelfPermission(android.Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED) {
                    neededPermissions.add(android.Manifest.permission.READ_MEDIA_VIDEO);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    if (activity.checkSelfPermission(android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) != PackageManager.PERMISSION_GRANTED) {
                        neededPermissions.add(android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
                    }
                }
            } else {
                if (activity.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    neededPermissions.add(android.Manifest.permission.READ_EXTERNAL_STORAGE);
                }
            }

            if (!neededPermissions.isEmpty()) {
                // Explicitly send runtime permission request to user via system dialog
                activity.requestPermissions(neededPermissions.toArray(new String[0]), PERMISSION_REQUEST_MEDIA);
                return true;
            }

            // Permissions already granted, launch chooser directly
            activity.launchFileChooser(fileChooserParams);
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final Dialog dialog = new Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen);
            WebView subWebView = new WebView(activity);
            WebSettings subSettings = subWebView.getSettings();
            subSettings.setJavaScriptEnabled(true);
            subSettings.setDomStorageEnabled(true);
            subSettings.setDatabaseEnabled(true);
            subSettings.setUserAgentString(view.getSettings().getUserAgentString());
            CookieManager.getInstance().setAcceptThirdPartyCookies(subWebView, true);

            dialog.setContentView(subWebView);
            dialog.show();

            subWebView.setWebChromeClient(new DialogWebChromeClient(dialog));
            subWebView.setWebViewClient(new DialogWebViewClient(dialog, activity));

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(subWebView);
            resultMsg.sendToTarget();
            return true;
        }
    }

    public static class DialogWebChromeClient extends WebChromeClient {
        private final Dialog dialog;

        public DialogWebChromeClient(Dialog dialog) {
            this.dialog = dialog;
        }

        @Override
        public void onCloseWindow(WebView window) {
            dialog.dismiss();
        }
    }

    public static class DialogWebViewClient extends WebViewClient {
        private final Dialog dialog;
        private final MainActivity activity;

        public DialogWebViewClient(Dialog dialog, MainActivity activity) {
            this.dialog = dialog;
            this.activity = activity;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String u = request.getUrl().toString();
            if (u.contains("Arena-Native-Suite.user.js")) {
                dialog.dismiss();
                if (activity != null) {
                    activity.downloadAndApplyScript(u);
                }
                return true;
            }
            if (u.contains("Arena-Account-Switch.user.js")) {
                dialog.dismiss();
                if (activity != null) {
                    activity.downloadAndApplyAccountSwitchScript(u);
                }
                return true;
            }
            if (u.contains("arena.ai") && !u.contains("accounts.google.com") && !u.contains("oauth")) {
                dialog.dismiss();
                activity.webView.loadUrl(u);
                return true;
            }
            return false;
        }
    }

    public void downloadAndApplyScript(String urlStr) {
        new Thread(new DownloaderRunnable(this, urlStr)).start();
    }

    public void downloadAndApplyAccountSwitchScript(String urlStr) {
        new Thread(new DownloaderRunnable(this, urlStr)).start();
    }

    public void downloadWorker(String urlStr) {
        try {
            String fetchUrl = urlStr;
            if (!fetchUrl.contains("?t=") && !fetchUrl.contains("&t=")) {
                fetchUrl += (fetchUrl.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis();
            }
            URL url = new URL(fetchUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14)");
            conn.setRequestProperty("Cache-Control", "no-cache");
            conn.connect();
            if (conn.getResponseCode() == 200) {
                try (InputStream is = conn.getInputStream();
                     BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                    if (urlStr != null && urlStr.contains("Arena-Account-Switch")) {
                        applyAccountSwitchHotUpdate(sb.toString());
                    } else {
                        applyHotUpdate(sb.toString());
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void applyHotUpdate(String code) {
        if (code == null || code.length() < 5000) {
            return;
        }
        if (!code.contains("Arena") && !code.contains("UserScript") && !code.contains("mergedArenaTools")) {
            return;
        }
        String ver = extractVersion(code);
        if ("1.11.65".equals(ver)) {
            return;
        }
        try {
            String patched = patchMobileSafeMargin(code);
            File targetFile = new File(getFilesDir(), "arena_suite_latest.js");
            File tempFile = new File(getFilesDir(), "arena_suite_latest.tmp");
            try (FileOutputStream fos = new FileOutputStream(tempFile)) {
                fos.write(patched.getBytes(StandardCharsets.UTF_8));
            }
            if (!tempFile.renameTo(targetFile)) {
                targetFile.delete();
                tempFile.renameTo(targetFile);
            }
            this.suiteScript = patched;
            runOnUiThread(new ReloadRunnable(this.webView));
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void applyAccountSwitchHotUpdate(String code) {
        if (code == null || code.length() < 2000) {
            return;
        }
        if (!code.contains("arenaAccountSwitch") && !code.contains("UserScript")) {
            return;
        }
        try {
            String patched = code.replace("left:14px;bottom:14px;", "left:24px;bottom:34px;");
            File targetFile = new File(getFilesDir(), "arena_account_switch_latest.js");
            File tempFile = new File(getFilesDir(), "arena_account_switch_latest.tmp");
            try (FileOutputStream fos = new FileOutputStream(tempFile)) {
                fos.write(patched.getBytes(StandardCharsets.UTF_8));
            }
            if (!tempFile.renameTo(targetFile)) {
                targetFile.delete();
                tempFile.renameTo(targetFile);
            }
            this.accountSwitchScript = patched;
            runOnUiThread(new ReloadRunnable(this.webView));
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static String patchMobileSafeMargin(String code) {
        if (code == null) return "";
        // 1. Ensure mini mode detail button safe margin (20px)
        code = code.replace(":host([data-mini]) .bar{padding-right:6px}", ":host([data-mini]) .bar{padding-right:20px}");
        // 2. Ensure bottom bar left & right safe padding (padding: 0 20px 0 24px)
        code = code.replaceAll("(\\.bar\\{box-sizing:border-box;height:\\$\\{BAR_H\\}px;display:flex;align-items:center;gap:0;)padding:[^;]+;",
                "$1padding:0 20px 0 24px;");
        // 3. Ensure bottom bar stays on top of sidebar drawers
        code = code.replace("z-index:30;", "z-index:99999;");
        // 4. Remove top-right theme toggle button (#amp-lite-panel / .theme-toggle)
        code = code.replace("const entry=el('div');entry.id='amp-lite-panel';entry.setAttribute('data-entry','');document.body.append(entry);",
                "const entry=el('div');entry.id='amp-lite-panel';entry.setAttribute('data-entry','');entry.hidden=true;entry.style.setProperty('display','none','important');");
        code = code.replace("const eligible=/^\\/agent(?:\\/|$)/.test(location.pathname);entry.hidden=!eligible;",
                "const eligible=/^\\/agent(?:\\/|$)/.test(location.pathname);entry.hidden=true;");
        code = code.replace(":host([data-entry]){all:initial;display:inline-flex;align-items:center;margin-right:6px;font:500 12px/1 var(--font-basel-grotesk,var(--font-inter,system-ui)),'PingFang SC','Microsoft YaHei',sans-serif}",
                ":host([data-entry]){display:none!important}");
        return code;
    }

    public static String extractVersion(String script) {
        if (script == null) return "0.0.0";
        try {
            Pattern p = Pattern.compile("@version\\s+([0-9.]+)");
            Matcher m = p.matcher(script);
            if (m.find()) {
                return m.group(1);
            }
        } catch (Exception e) {}
        return "0.0.0";
    }

    public static int compareVersions(String v1, String v2) {
        if (v1 == null) v1 = "0.0.0";
        if (v2 == null) v2 = "0.0.0";
        String[] p1 = v1.split("\\.");
        String[] p2 = v2.split("\\.");
        int len = Math.max(p1.length, p2.length);
        for (int i = 0; i < len; i++) {
            int n1 = 0;
            int n2 = 0;
            try {
                if (i < p1.length) n1 = Integer.parseInt(p1[i].trim());
            } catch (Exception e) {}
            try {
                if (i < p2.length) n2 = Integer.parseInt(p2[i].trim());
            } catch (Exception e) {}
            if (n1 != n2) {
                return n1 > n2 ? 1 : -1;
            }
        }
        return 0;
    }

    public String loadCurrentScript() {
        String assetScript = patchMobileSafeMargin(loadAssetScript("arena_suite.js"));
        String assetVer = extractVersion(assetScript);
        File diskFile = new File(getFilesDir(), "arena_suite_latest.js");
        if (diskFile.exists() && diskFile.length() > 5000) {
            try (InputStream is = new FileInputStream(diskFile);
                 BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                String diskScript = sb.toString();
                String diskVer = extractVersion(diskScript);
                if ("1.11.65".equals(diskVer) || compareVersions(diskVer, assetVer) <= 0) {
                    diskFile.delete();
                } else {
                    return patchMobileSafeMargin(diskScript);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        return assetScript;
    }

    public String loadCurrentAccountSwitchScript() {
        String assetScript = loadAssetScript("arena_account_switch.js");
        String assetVer = extractVersion(assetScript);
        File diskFile = new File(getFilesDir(), "arena_account_switch_latest.js");
        if (diskFile.exists() && diskFile.length() > 2000) {
            try (InputStream is = new FileInputStream(diskFile);
                 BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                String diskScript = sb.toString();
                String diskVer = extractVersion(diskScript);
                if (compareVersions(diskVer, assetVer) > 0) {
                    return diskScript;
                } else {
                    diskFile.delete();
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        return assetScript;
    }

    private String loadAssetScript(String assetName) {
        StringBuilder sb = new StringBuilder();
        try (InputStream is = getAssets().open(assetName);
             BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILECHOOSER_RESULTCODE) {
            if (uploadMessage != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    ClipData clipData = data.getClipData();
                    if (clipData != null && clipData.getItemCount() > 0) {
                        int count = clipData.getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            Uri u = clipData.getItemAt(i).getUri();
                            results[i] = u;
                            grantUriPermissionsSafely(u);
                        }
                    } else if (data.getData() != null) {
                        Uri u = data.getData();
                        results = new Uri[]{u};
                        grantUriPermissionsSafely(u);
                    } else if (data.getDataString() != null) {
                        try {
                            Uri u = Uri.parse(data.getDataString());
                            results = new Uri[]{u};
                            grantUriPermissionsSafely(u);
                        } catch (Throwable ignored) {}
                    }
                }
                uploadMessage.onReceiveValue(results);
                uploadMessage = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    private void grantUriPermissionsSafely(Uri uri) {
        if (uri == null) return;
        try {
            grantUriPermission(getPackageName(), uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Throwable ignored) {}
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Throwable ignored) {}
    }

    public void launchFileChooser(WebChromeClient.FileChooserParams fileChooserParams) {
        Intent chooserIntent = null;
        try {
            // 1. Primary intent from fileChooserParams (handles all files)
            Intent contentIntent = fileChooserParams != null ? fileChooserParams.createIntent() : null;
            if (contentIntent == null) {
                contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
                contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
                contentIntent.setType("*/*");
            }
            contentIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (fileChooserParams != null && fileChooserParams.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                contentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }

            // 2. Extra initial intents (Native Gallery & Modern Photo Picker)
            List<Intent> extraIntents = new ArrayList<>();

            // Native Gallery picker (broad compatibility with Xiaomi, Huawei, Oppo, Vivo, Samsung)
            try {
                Intent galleryIntent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
                galleryIntent.setType("image/*");
                galleryIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (fileChooserParams != null && fileChooserParams.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                    galleryIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                extraIntents.add(galleryIntent);
            } catch (Throwable ignored) {}

            // Android 13+ (API 33) Modern Photo Picker
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                try {
                    Intent photoPickerIntent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                    photoPickerIntent.setType("image/*");
                    photoPickerIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    if (fileChooserParams != null && fileChooserParams.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                        photoPickerIntent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit());
                    }
                    extraIntents.add(photoPickerIntent);
                } catch (Throwable ignored) {}
            }

            chooserIntent = Intent.createChooser(contentIntent, "选择图片或文件");
            if (!extraIntents.isEmpty()) {
                chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, extraIntents.toArray(new Intent[0]));
            }
        } catch (Exception e) {
            Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
            fallback.addCategory(Intent.CATEGORY_OPENABLE);
            fallback.setType("*/*");
            fallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooserIntent = Intent.createChooser(fallback, "选择图片或文件");
        }

        try {
            startActivityForResult(chooserIntent, FILECHOOSER_RESULTCODE);
        } catch (Exception e) {
            if (uploadMessage != null) {
                uploadMessage.onReceiveValue(null);
                uploadMessage = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == PERMISSION_REQUEST_MEDIA) {
            if (uploadMessage != null) {
                launchFileChooser(pendingChooserParams);
                pendingChooserParams = null;
            }
        } else {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
