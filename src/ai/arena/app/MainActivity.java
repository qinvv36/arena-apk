package ai.arena.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
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
import android.widget.ProgressBar;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity implements OnBackInvokedCallback, View.OnApplyWindowInsetsListener, View.OnTouchListener, Runnable {

    public WebView webView;
    public ProgressBar progressBar;
    @SuppressWarnings("rawtypes")
    public ValueCallback uploadMessage;
    public static final int FILECHOOSER_RESULTCODE = 1001;
    public String suiteScript = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Synchronize launcher icon based on current system Dark/Light theme
        boolean isNight = isSystemNightMode();
        checkAndSyncLauncherIcon(isNight);

        // Load userscript from assets
        suiteScript = loadAssetScript("arena_suite.js");

        // Root container
        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // Listen for WindowInsets so bottom navigation bar and keyboard automatically lift the view
        rootLayout.setOnApplyWindowInsetsListener(this);

        // WebView
        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus(View.FOCUS_DOWN);
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
        webView.setOnTouchListener(this);
        rootLayout.addView(webView);

        // Top horizontal progress bar
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 8);
        pbParams.gravity = Gravity.TOP;
        progressBar.setLayoutParams(pbParams);
        progressBar.setMax(100);
        rootLayout.addView(progressBar);

        setContentView(rootLayout);

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

        // Modern Android 13+ algorithmic darkening - only allowed in dark mode
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(isNight);
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

        // Load Arena URL
        webView.loadUrl("https://arena.ai");
    }

    public boolean isSystemNightMode() {
        int uiMode = getApplicationContext().getResources().getConfiguration().uiMode;
        return (uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
        android.graphics.Insets navInsets = insets.getInsets(
            WindowInsets.Type.navigationBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout()
        );
        v.setPadding(0, 0, 0, navInsets.bottom);
        return insets;
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean isNight = isSystemNightMode();
        updateSystemBarsAndTheme(isNight);
        checkAndSyncLauncherIcon(isNight);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean isNight = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        updateSystemBarsAndTheme(isNight);
        checkAndSyncLauncherIcon(isNight);
    }

    public void updateSystemBarsAndTheme(boolean isNight) {
        int themeColor = isNight ? Color.parseColor("#111113") : Color.parseColor("#FFFFFF");

        Window window = getWindow();
        window.setStatusBarColor(themeColor);
        window.setNavigationBarColor(themeColor);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                if (isNight) {
                    // In dark mode: status bar icons must be WHITE
                    controller.setSystemBarsAppearance(0,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                } else {
                    // In light mode: status bar icons must be DARK
                    controller.setSystemBarsAppearance(
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            }
        }

        if (webView != null) {
            webView.setBackgroundColor(themeColor);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                webView.getSettings().setAlgorithmicDarkeningAllowed(isNight);
            }
            syncWebPageTheme(isNight);
        }
    }

    public void syncWebPageTheme(boolean isNight) {
        if (webView == null) return;
        String js = String.format(
            "javascript:(function(){" +
            "var isDark = %b;" +
            "var d = document.documentElement;" +
            "var target = isDark ? 'dark' : 'light';" +
            "var remove = isDark ? 'light' : 'dark';" +
            "if(d){" +
            "  d.classList.remove(remove);" +
            "  d.classList.add(target);" +
            "  d.style.colorScheme = target;" +
            "  if(d.dataset) d.dataset.theme = target;" +
            "}" +
            "try{localStorage.setItem('theme', target);}catch(e){}" +
            "try{window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:target}));}catch(e){}" +
            "})();",
            isNight
        );
        webView.evaluateJavascript(js, null);
    }

    public void checkAndSyncLauncherIcon(boolean isNight) {
        try {
            PackageManager pm = getPackageManager();
            ComponentName lightComponent = new ComponentName(this, "ai.arena.app.MainActivityLight");
            ComponentName darkComponent = new ComponentName(this, "ai.arena.app.MainActivityDark");

            int curLight = pm.getComponentEnabledSetting(lightComponent);
            int curDark = pm.getComponentEnabledSetting(darkComponent);

            if (isNight) {
                if (curDark != PackageManager.COMPONENT_ENABLED_STATE_ENABLED || curLight != PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
                    pm.setComponentEnabledSetting(darkComponent, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                    pm.setComponentEnabledSetting(lightComponent, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            } else {
                if (curLight != PackageManager.COMPONENT_ENABLED_STATE_ENABLED || curDark != PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
                    pm.setComponentEnabledSetting(lightComponent, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                    pm.setComponentEnabledSetting(darkComponent, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
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

    public static class AndroidBridge {
        private final MainActivity activity;

        public AndroidBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void requestInputFocus() {
            if (activity != null) {
                activity.runOnUiThread(activity);
            }
        }
    }

    @Override
    public void onBackInvoked() {
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
                // 2. Sync light/dark theme according to system
                if (activity != null) {
                    activity.syncWebPageTheme(activity.isSystemNightMode());
                }

                // 3. Inject bottom lifting style fix so bottom text and input area are comfortable and never cut off
                String cssFix = "javascript:(function(){" +
                        "if(!document.getElementById('__arena_mobile_bottom_fix__')){" +
                        "var st=document.createElement('style');" +
                        "st.id='__arena_mobile_bottom_fix__';" +
                        "st.textContent='" +
                        "main,[role=\"main\"]{padding-bottom:32px !important;}" +
                        "form:has(textarea[name=\"message\"]),form:has(textarea){margin-bottom:16px !important;}" +
                        "p.text-xs,div.text-xs{margin-bottom:12px !important;}" +
                        "';" +
                        "(document.head||document.documentElement).appendChild(st);" +
                        "}})();";
                view.evaluateJavascript(cssFix, null);

                // 4. Inject userscript
                if (suiteScript != null && !suiteScript.isEmpty()) {
                    view.evaluateJavascript(suiteScript, null);
                }
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            tryInject(view, url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            tryInject(view, url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
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
            if (activity.uploadMessage != null) {
                activity.uploadMessage.onReceiveValue(null);
            }
            activity.uploadMessage = filePathCallback;

            Intent intent = null;
            try {
                intent = fileChooserParams.createIntent();
            } catch (Exception e) {
                intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
            }
            try {
                activity.startActivityForResult(intent, FILECHOOSER_RESULTCODE);
            } catch (ActivityNotFoundException e) {
                activity.uploadMessage = null;
                return false;
            }
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
            if (u.contains("arena.ai") && !u.contains("accounts.google.com") && !u.contains("oauth")) {
                dialog.dismiss();
                activity.webView.loadUrl(u);
                return true;
            }
            return false;
        }
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
                    String dataString = data.getDataString();
                    ClipData clipData = data.getClipData();
                    if (clipData != null) {
                        results = new Uri[clipData.getItemCount()];
                        for (int i = 0; i < clipData.getItemCount(); i++) {
                            results[i] = clipData.getItemAt(i).getUri();
                        }
                    } else if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }
                uploadMessage.onReceiveValue(results);
                uploadMessage = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
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
