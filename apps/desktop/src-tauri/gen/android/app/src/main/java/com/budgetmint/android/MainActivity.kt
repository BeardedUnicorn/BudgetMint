// Adapted from TaskMint apps/desktop/src-tauri/gen/android/app/src/main/java/com/taskmint/android/MainActivity.kt @ ce9f22f.
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

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applyBarsTheme()

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

  /** Dark clock and icons (for a light background) or light ones. */
  private fun setLightStatusBar(light: Boolean) {
    WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = light
  }

  // Added before the page loads, so the webview has them from the start
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
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
   * once the launch screen is gone.
   */
  private inner class SystemBars {
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
  }
}
