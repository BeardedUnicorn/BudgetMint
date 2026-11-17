// Adapted from TaskMint apps/desktop/src-tauri/gen/android/app/src/main/java/com/taskmint/android/AppUpdate.kt @ 94318ec.
package com.budgetmint.android

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.json.JSONObject

/**
 * The app's own update: it downloads a release's APK from GitHub into its
 * cache and hands it to Android's installer, which asks before replacing the
 * app (and, the first time, for BudgetMint to be allowed to install apps).
 * Where it fails, the page offers the browser instead (apk_update.rs).
 */
object AppUpdate {
  /**
   * The release's APK, as scripts/release/lib.mjs names it and apk_update.rs
   * links it (whose test reads this file, so the two stay the same address).
   */
  private const val RELEASES = "https://github.com/BeardedUnicorn/BudgetMint/releases/download"
  private const val APK_TYPE = "application/vnd.android.package-archive"
  private val VERSION = Regex("""\d+\.\d+\.\d+""")
  private const val TIMEOUT_MS = 30_000
  private const val REPORT_EVERY_MS = 250L

  private val running = AtomicBoolean(false)

  /**
   * Downloads `version` and opens the installer on it. `report` hears
   * `{"downloaded", "total"}` (bytes; `total` null when GitHub doesn't say)
   * as it goes, then `{"done": true}` once the installer is open, or
   * `{"error"}`. It's called on a background thread.
   */
  fun download(context: Context, version: String, report: (JSONObject) -> Unit) {
    if (!VERSION.matches(version)) {
      report(failure("$version isn't a version."))
      return
    }
    if (!running.compareAndSet(false, true)) {
      report(failure("The update is already downloading."))
      return
    }
    thread(name = "budgetmint-update") {
      try {
        val apk = fetch(context, version, report)
        check(context, apk, version)
        install(context, apk)
        report(JSONObject().put("done", true))
      } catch (e: Exception) {
        report(failure(e.message ?: e.javaClass.simpleName))
      } finally {
        running.set(false)
      }
    }
  }

  private fun failure(message: String) = JSONObject().put("error", message)

  private fun fetch(context: Context, version: String, report: (JSONObject) -> Unit): File {
    // In the cache, which res/xml/file_paths.xml lets the installer read
    val folder = File(context.cacheDir, "updates")
    // Earlier downloads go: one APK is tens of megabytes
    folder.deleteRecursively()
    if (!folder.mkdirs()) throw IOException("The download has nowhere to go.")
    val apk = File(folder, "BudgetMint-$version.apk")

    val connection = URL("$RELEASES/v$version/BudgetMint-$version-android-arm64.apk").openConnection() as HttpURLConnection
    connection.connectTimeout = TIMEOUT_MS
    connection.readTimeout = TIMEOUT_MS
    try {
      val status = connection.responseCode
      if (status != HttpURLConnection.HTTP_OK) throw IOException("GitHub answered $status.")
      val total = connection.contentLengthLong.takeIf { it > 0 }
      var downloaded = 0L
      var reportedAt = 0L
      connection.inputStream.use { input ->
        apk.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            downloaded += read
            val now = System.currentTimeMillis()
            if (now - reportedAt >= REPORT_EVERY_MS) {
              reportedAt = now
              report(progress(downloaded, total))
            }
          }
        }
      }
      if (total != null && downloaded != total) throw IOException("The download stopped early.")
      report(progress(downloaded, total))
    } finally {
      connection.disconnect()
    }
    return apk
  }

  private fun progress(downloaded: Long, total: Long?) =
    JSONObject().put("downloaded", downloaded).put("total", total ?: JSONObject.NULL)

  /**
   * The download is this app at that version. (Android itself refuses an
   * update signed with another key, or an older version than the one
   * installed.)
   */
  private fun check(context: Context, apk: File, version: String) {
    val info = context.packageManager.getPackageArchiveInfo(apk.path, 0)
      ?: throw IOException("The download isn't an app.")
    if (info.packageName != context.packageName) throw IOException("The download isn't BudgetMint.")
    if (info.versionName != version) throw IOException("The download isn't BudgetMint $version.")
  }

  private fun install(context: Context, apk: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
    context.startActivity(
      Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, APK_TYPE)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    )
  }
}
