// Adapted from TaskMint apps/desktop/src-tauri/gen/android/app/src/main/java/com/taskmint/android/MainActivity.kt @ 5c802e7.
package com.budgetmint.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.splashscreen.SplashScreenViewProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.budgetmint.android.widgets.WidgetData
import com.google.firebase.analytics.FirebaseAnalytics
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /** The launch screen while it covers the app, and whether the page has drawn. */
  private var splash: SplashScreenViewProvider? = null
  private var pageDrawn = false

  /** The theme the page last gave the status bar (SystemBars); light icons on the launch screen's teal until then. */
  private var barsTheme = "dark"

  /**
   * BudgetMint: what covers the app's edges, in dp (the page's CSS px): the
   * status bar, the navigation bar or gesture area and a camera cutout (top,
   * right, bottom, left), and the on-screen keyboard while it's up (from the
   * screen's bottom edge, so over the navigation bar). The app draws under
   * all of them (edge to edge), and the webview doesn't say so to the page
   * (env(safe-area-inset-bottom) is 0, and older webviews don't shrink the
   * visual viewport for the keyboard), so the page asks (SystemBars) and
   * hears of each change (window.__budgetmintInsets). As TaskMint's, which
   * keeps the bottom's alone.
   */
  @Volatile private var edgeInsetsDp = floatArrayOf(0f, 0f, 0f, 0f)
  @Volatile private var keyboardInsetDp = 0f

  /**
   * BudgetMint: what the app was opened for (a launcher shortcut, a widget,
   * a reminder that was tapped), as one of the page's menu ids
   * (useMenuCommands.ts), until the page takes it (Launch).
   */
  @Volatile private var pendingOpen: String? = null

  /** This device's own settings that hold before the page loads (screen privacy). */
  private val deviceSettings get() = getSharedPreferences(DEVICE_SETTINGS, Context.MODE_PRIVATE)

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applyBarsTheme()
    // BudgetMint: before anything is drawn, so no preview of it is ever taken
    applyScreenPrivacy(deviceSettings.getBoolean(SCREEN_PRIVATE, false))
    // Not again when Android brings the activity back with the intent it
    // was first started with
    if (savedInstanceState == null) pendingOpen = openTarget(intent)
    setShortcuts()
    askForLocalNetwork()
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
      val density = resources.displayMetrics.density
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val edges = floatArrayOf(bars.top / density, bars.right / density, bars.bottom / density, bars.left / density)
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / density
      if (!edges.contentEquals(edgeInsetsDp) || keyboard != keyboardInsetDp) {
        edgeInsetsDp = edges
        keyboardInsetDp = keyboard
        webView?.evaluateJavascript("window.__budgetmintInsets && window.__budgetmintInsets()", null)
      }
      // The decor view still lays itself and the webview out as before
      ViewCompat.onApplyWindowInsets(view, insets)
    }

    // The launch screen (Theme.budgetmint.Starting) would go with the first
    // frame, long before the webview has anything to show. It stays until the
    // page says it has drawn (Splash), or 10 s have passed (the page may never
    // load), and the app draws underneath meanwhile.
    splashScreen.setOnExitAnimationListener { provider ->
      splash = provider
      // The hand-over applies the app theme's bars; light icons on the teal
      setLightStatusBar(false)
      if (pageDrawn) dismissSplash()
    }
    window.decorView.postDelayed({ onPageDrawn() }, SPLASH_TIMEOUT_MS)
  }

  /** Opened again while it runs: the page hears there's something to take. */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val target = openTarget(intent) ?: return
    pendingOpen = target
    webView?.evaluateJavascript("window.__budgetmintLaunch && window.__budgetmintLaunch()", null)
  }

  /**
   * What `intent` opens the app for: a shortcut's or a widget's own extra,
   * or a tapped reminder's. The notification plugin's tap intent says only
   * which notification it was (its id, core's id for the reminder), so the
   * page says what each reminder opens when it schedules them (Launch),
   * and it's looked up here. Only something shaped like one of the page's
   * ids, which ignores the ones it doesn't know: any app can send this
   * activity an intent.
   */
  private fun openTarget(intent: Intent?): String? {
    if (intent == null || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
    val target = intent.getStringExtra(EXTRA_OPEN) ?: reminderTarget(intent)
    return target?.takeIf { OPEN_TARGET.matches(it) }
  }

  private fun reminderTarget(intent: Intent): String? {
    val id = intent.getIntExtra(NOTIFICATION_ID_EXTRA, Int.MIN_VALUE)
    if (id == Int.MIN_VALUE) return null
    val targets = deviceSettings.getString(REMINDER_TARGETS, null) ?: return null
    return runCatching { JSONObject(targets).optString(id.toString()) }.getOrNull()
  }

  /** The launcher's long-press shortcuts: each opens the app for one thing. */
  private fun setShortcuts() {
    val shortcut = { id: String, label: Int, icon: Int ->
      ShortcutInfoCompat.Builder(this, id)
        .setShortLabel(getString(label))
        .setIcon(IconCompat.createWithResource(this, icon))
        .setIntent(openIntent(this, id))
        .build()
    }
    // Android keeps them between runs; a failure (a launcher without them) loses nothing
    runCatching {
      ShortcutManagerCompat.setDynamicShortcuts(
        this,
        listOf(
          shortcut("new-bill", R.string.shortcut_new_bill, R.drawable.ic_shortcut_add),
          shortcut("update-balance", R.string.shortcut_update_balance, R.drawable.ic_shortcut_balance),
          shortcut("record", R.string.shortcut_record, R.drawable.ic_shortcut_spend),
        ),
      )
    }
  }

  /**
   * A debug build asks for the local network (src/debug's manifest says
   * why), once: until it's allowed, the emulators and a dev server over
   * Wi-Fi can't be reached. A release build never asks.
   */
  private fun askForLocalNetwork() {
    if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < LOCAL_NETWORK_SINCE) return
    if (checkSelfPermission(LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(LOCAL_NETWORK), 0)
    }
  }

  /** Screenshots, screen recordings and the recent apps' preview show nothing of the app, or do. */
  private fun applyScreenPrivacy(on: Boolean) {
    if (on) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
  }

  private fun onPageDrawn() {
    if (pageDrawn) return
    pageDrawn = true
    dismissSplash()
  }

  private fun dismissSplash() {
    val provider = splash ?: return
    provider.view.animate().alpha(0f).setDuration(SPLASH_FADE_MS).withEndAction {
      // Removing it puts back the bars it found (Android 12 and later), so
      // the page's theme goes on again after
      provider.remove()
      splash = null
      applyBarsTheme()
    }
  }

  private fun applyBarsTheme() = setLightStatusBar(barsTheme == "light")

  /**
   * Dark clock and icons (for a light background) or light ones. BudgetMint:
   * the navigation bar's buttons too (three-button navigation), which sit
   * over the app's own bottom bar and would otherwise follow the system's
   * theme, not the app's.
   */
  private fun setLightStatusBar(light: Boolean) {
    val bars = WindowCompat.getInsetsController(window, window.decorView)
    bars.isAppearanceLightStatusBars = light
    bars.isAppearanceLightNavigationBars = light
  }

  // Added before the page loads, so the webview has them from the start
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // BudgetMint: the page's text follows the system's font size, up to 130%.
    // Past that the bottom tabs' labels run into each other and figures are
    // cut off in their cards (seen at 200%); to 130% every page holds.
    webView.settings.textZoom =
      (minOf(resources.configuration.fontScale, MAX_FONT_SCALE) * 100).toInt()
    webView.addJavascriptInterface(Splash(), "BudgetMintSplash")
    webView.addJavascriptInterface(SystemBars(), "BudgetMintSystemBars")
    webView.addJavascriptInterface(GoogleSignIn(), "BudgetMintGoogleSignIn")
    webView.addJavascriptInterface(Analytics(), "BudgetMintAnalytics")
    webView.addJavascriptInterface(Screen(), "BudgetMintScreen")
    webView.addJavascriptInterface(Launch(), "BudgetMintLaunch")
    webView.addJavascriptInterface(Widgets(), "BudgetMintWidgets")
    releaseFieldWhenKeyboardHides(webView)
  }

  /**
   * Back with a field in the page still focused after its keyboard has gone
   * goes to the input method, which has nothing left to close, so the page
   * never hears it: a dialog stays open, the page doesn't go back. Once the
   * keyboard is down, the field lets go of the focus, and the next Back
   * reaches the page (NavigationContext's back stack). A tap on the field
   * brings the keyboard back.
   */
  private fun releaseFieldWhenKeyboardHides(webView: WebView) {
    var keyboardShown = false
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val shown = insets.isVisible(WindowInsetsCompat.Type.ime())
      if (keyboardShown && !shown) webView.evaluateJavascript(RELEASE_FIELD, null)
      keyboardShown = shown
      // The webview handles its insets as it would without this
      ViewCompat.onApplyWindowInsets(view, insets)
    }
  }

  /**
   * The page has drawn (App.tsx's Gate: the session is past loading;
   * start.tsx: a startup error is on screen), so the launch screen fades out
   * to it.
   */
  private inner class Splash {
    @JavascriptInterface
    fun hide() {
      runOnUiThread { onPageDrawn() }
    }
  }

  /**
   * The app draws under the status bar (edge to edge), and its top bar
   * follows the theme chosen in Settings → Appearance, which may differ from
   * the system's. The webview says which theme shows (useSystemBarsTheme.ts,
   * through tauriShell.ts), and the status bar's clock and icons follow it,
   * once the launch screen is gone. BudgetMint: the page also asks what the
   * bars and the keyboard cover (useSystemInsets.ts, useKeyboardInset.ts).
   */
  private inner class SystemBars {
    /** What covers each edge, in CSS px, for the page to keep its bars, tabs and dialogs clear of. */
    @JavascriptInterface
    fun topInset(): Float = edgeInsetsDp[0]

    @JavascriptInterface
    fun rightInset(): Float = edgeInsetsDp[1]

    @JavascriptInterface
    fun bottomInset(): Float = edgeInsetsDp[2]

    @JavascriptInterface
    fun leftInset(): Float = edgeInsetsDp[3]

    /** The keyboard's height from the screen's bottom, in CSS px (0 while it's down), for the page to sit above. */
    @JavascriptInterface
    fun keyboardInset(): Float = keyboardInsetDp

    @JavascriptInterface
    fun setTheme(theme: String) {
      // The bridge calls in on its own thread
      runOnUiThread {
        barsTheme = theme
        if (splash == null) applyBarsTheme()
      }
    }
  }

  /**
   * Google sign-in. Google refuses sign-in inside a webview, so Android's
   * account picker (Credential Manager) asks, and the Google ID token goes
   * back to the page (window.__budgetmintGoogleSignIn), which signs in to
   * BudgetMint's Firebase project and TaskMint's with it (firebaseStore.ts).
   * default_web_client_id is budgetmint's web client, from
   * google-services.json; TaskMint's project safelists it.
   */
  private inner class GoogleSignIn {
    @JavascriptInterface
    fun start() {
      runOnUiThread {
        val option = GetSignInWithGoogleOption.Builder(getString(R.string.default_web_client_id)).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        CredentialManager.create(this@MainActivity).getCredentialAsync(
          this@MainActivity,
          request,
          CancellationSignal(),
          ContextCompat.getMainExecutor(this@MainActivity),
          object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
            override fun onResult(result: GetCredentialResponse) {
              val credential = result.credential
              if (credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                answer(JSONObject().put("idToken", GoogleIdTokenCredential.createFrom(credential.data).idToken))
              } else {
                answer(JSONObject().put("error", "Google sign-in didn't return a Google account."))
              }
            }

            override fun onError(e: GetCredentialException) {
              val message = if (e is GetCredentialCancellationException) {
                "Google sign-in was cancelled."
              } else {
                "Google sign-in failed: ${e.message ?: e.type}"
              }
              answer(JSONObject().put("error", message))
            }
          },
        )
      }
    }

    private fun answer(answer: JSONObject) {
      runOnUiThread {
        webView?.evaluateJavascript("window.__budgetmintGoogleSignIn && window.__budgetmintGoogleSignIn($answer)", null)
      }
    }
  }

  /**
   * Firebase Analytics (Settings → Privacy can turn it off; the setting
   * persists here), and the pages the app shows, as screen views: only the
   * page's name, never amounts, bills or balances (utils/analytics.ts).
   */
  private inner class Analytics {
    private val analytics get() = FirebaseAnalytics.getInstance(this@MainActivity)

    @JavascriptInterface
    fun setEnabled(enabled: Boolean) {
      analytics.setAnalyticsCollectionEnabled(enabled)
    }

    @JavascriptInterface
    fun screen(name: String) {
      analytics.logEvent(
        FirebaseAnalytics.Event.SCREEN_VIEW,
        Bundle().apply {
          putString(FirebaseAnalytics.Param.SCREEN_NAME, name)
          putString(FirebaseAnalytics.Param.SCREEN_CLASS, "MainActivity")
        },
      )
    }
  }

  /**
   * BudgetMint: Settings → Privacy can keep the app out of screenshots,
   * screen recordings and the recent apps' previews (FLAG_SECURE, which
   * from Android 17 is also the only way out of content capture). Kept
   * here, not by the page, so it holds from the app's first frame.
   */
  private inner class Screen {
    @JavascriptInterface
    fun isPrivate(): Boolean = deviceSettings.getBoolean(SCREEN_PRIVATE, false)

    @JavascriptInterface
    fun setPrivate(on: Boolean) {
      deviceSettings.edit().putBoolean(SCREEN_PRIVATE, on).apply()
      runOnUiThread { applyScreenPrivacy(on) }
    }
  }

  /**
   * BudgetMint: what the app was opened for, taken once by the page when
   * the budget is open (tauriShell.ts hands it on as a menu click).
   */
  private inner class Launch {
    @JavascriptInterface
    fun take(): String {
      val target = pendingOpen
      pendingOpen = null
      return target ?: ""
    }

    /**
     * What a tap on each scheduled reminder opens: `{ id: menu id }` as
     * JSON (openTarget reads it). Added to the ones before: a reminder
     * already shown is no longer among the scheduled, and is still there
     * to tap. The oldest go once there are more than MAX_REMINDER_TARGETS.
     */
    @JavascriptInterface
    fun setReminderTargets(targets: String) {
      val kept = runCatching {
        val all = JSONObject(deviceSettings.getString(REMINDER_TARGETS, null) ?: "{}")
        val added = JSONObject(targets)
        for (id in added.keys()) {
          // Last in, so the newest are the ones kept
          all.remove(id)
          all.put(id, added.getString(id))
        }
        val ids = all.keys().asSequence().toList()
        for (id in ids.dropLast(MAX_REMINDER_TARGETS)) all.remove(id)
        all.toString()
      }.getOrDefault(targets)
      deviceSettings.edit().putString(REMINDER_TARGETS, kept).apply()
    }
  }

  /**
   * BudgetMint: the home screen's widgets. The page sends what they show,
   * worded, whenever the budget changes (useWidgetSnapshot.ts), and '' once
   * signed out; WidgetData keeps it and draws them again.
   */
  private inner class Widgets {
    @JavascriptInterface
    fun set(snapshot: String) {
      WidgetData.save(this@MainActivity, snapshot)
    }
  }

  companion object {
    /** The intent that opens the app for `target`, one of the page's menu ids (shortcuts, widgets). */
    fun openIntent(context: Context, target: String): Intent =
      Intent(context, MainActivity::class.java)
        // Not ACTION_MAIN: the notification plugin reads those as its own
        .setAction(Intent.ACTION_VIEW)
        .putExtra(EXTRA_OPEN, target)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private const val EXTRA_OPEN = "com.budgetmint.android.OPEN"

    /** Where tauri-plugin-notification's tap intent carries the notification's id. */
    private const val NOTIFICATION_ID_EXTRA = "NotificationId"
    private const val REMINDER_TARGETS = "reminderTargets"
    private const val MAX_REMINDER_TARGETS = 200
    private val OPEN_TARGET = Regex("[a-z][a-z-]{0,31}")
    private const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

    /** Android 17 (API 37): the first to keep an app off the local network without it. */
    private const val LOCAL_NETWORK_SINCE = 37
    private const val DEVICE_SETTINGS = "device"
    private const val SCREEN_PRIVATE = "screenPrivate"

    /** Blurs the focused text field, if one is. */
    private const val RELEASE_FIELD =
      "(() => { const field = document.activeElement; " +
        "if (field && field.matches('input, textarea, [contenteditable]')) field.blur(); })()"
    private const val SPLASH_FADE_MS = 250L
    private const val SPLASH_TIMEOUT_MS = 10_000L

    /** BudgetMint: the largest system font size the page's text follows. */
    private const val MAX_FONT_SCALE = 1.3f
  }
}
