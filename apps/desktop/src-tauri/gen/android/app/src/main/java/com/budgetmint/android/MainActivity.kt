// Adapted from TaskMint apps/desktop/src-tauri/gen/android/app/src/main/java/com/taskmint/android/MainActivity.kt @ 5c802e7.
package com.budgetmint.android

import android.os.Bundle
import android.os.CancellationSignal
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
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

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applyBarsTheme()
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

  private companion object {
    /** Blurs the focused text field, if one is. */
    const val RELEASE_FIELD =
      "(() => { const field = document.activeElement; " +
        "if (field && field.matches('input, textarea, [contenteditable]')) field.blur(); })()"
    const val SPLASH_FADE_MS = 250L
    const val SPLASH_TIMEOUT_MS = 10_000L

    /** BudgetMint: the largest system font size the page's text follows. */
    const val MAX_FONT_SCALE = 1.3f
  }
}
