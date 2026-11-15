// BudgetMint: the home screen's widgets (not in the Tauri template).
package com.budgetmint.android.widgets

import android.content.Context
import androidx.glance.appwidget.updateAll
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** A line of the Coming up widget. */
data class WidgetItem(val name: String, val amount: String, val whenText: String, val tone: String)

/** A bill being saved up for. */
data class WidgetGoal(
  val id: String,
  val name: String,
  val saved: String,
  val target: String,
  val percent: Int,
  val next: String,
)

/** One day's widgets, in the page's words (useWidgetSnapshot.ts's WidgetDay). */
data class WidgetDay(
  val date: String,
  val safeToSpend: String,
  val balance: String,
  /** "short" or "low", with its words; none when the balance holds. */
  val alertLevel: String?,
  val alertText: String,
  val dueThisWeek: String,
  val dueThisWeekNote: String,
  val comingIn: String,
  /** TaskMint's next withdrawal; null where TaskMint isn't used. */
  val withdrawal: String?,
  val withdrawalNote: String,
  val items: List<WidgetItem>,
  val goals: List<WidgetGoal>,
)

/** What a widget has to show. */
sealed interface WidgetState {
  /** Nobody is signed in (or the app has never run): nothing of any budget. */
  data object SignedOut : WidgetState

  /** The app hasn't run for longer than the days it left: it has to be opened. */
  data object Stale : WidgetState

  data class Ready(val day: WidgetDay) : WidgetState
}

/**
 * What the widgets show: the page's snapshot (a week of days, each worded;
 * the page sends it whenever the budget changes, and '' when signed out),
 * kept in the app's own preferences so the widgets have it with the app
 * closed. They pick today's day and show it: no sums, no formatting here
 * (the rules are core's, the words the page's).
 */
object WidgetData {
  private const val PREFERENCES = "widgets"
  private const val SNAPSHOT = "snapshot"

  /** The snapshot's shape this build reads (useWidgetSnapshot.ts's WIDGET_SNAPSHOT_VERSION). */
  private const val VERSION = 1

  private val snapshot = MutableStateFlow<String?>(null)
  @Volatile private var loaded = false

  /** The snapshot as it stands, for a widget to redraw when it changes while it's being drawn. */
  fun snapshot(context: Context): StateFlow<String?> {
    if (!loaded) {
      snapshot.value =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(SNAPSHOT, null)
      loaded = true
    }
    return snapshot
  }

  /** The page's snapshot ('' for none), kept, and every widget drawn again. */
  fun save(context: Context, json: String) {
    val app = context.applicationContext
    val kept = json.takeIf { it.isNotEmpty() }
    app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, kept).apply()
    loaded = true
    snapshot.value = kept
    CoroutineScope(Dispatchers.Default).launch {
      runCatching {
        SafeToSpendWidget().updateAll(app)
        ComingUpWidget().updateAll(app)
        ThisWeekWidget().updateAll(app)
        GoalWidget().updateAll(app)
      }
    }
  }

  /** Today's date as the snapshot's days have it, where the phone is. */
  fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  /** What `json` gives a widget on `today`. */
  fun state(json: String?, today: String = today()): WidgetState {
    if (json == null) return WidgetState.SignedOut
    val days = runCatching {
      val root = JSONObject(json)
      // A shape this build doesn't know (the page is newer or older): opening the app sends its own
      if (root.optInt("version") != VERSION) return WidgetState.Stale
      root.getJSONArray("days")
    }.getOrNull() ?: return WidgetState.Stale
    for (index in 0 until days.length()) {
      val day = days.optJSONObject(index) ?: continue
      if (day.optString("date") == today) {
        return runCatching { WidgetState.Ready(day(day)) }.getOrDefault(WidgetState.Stale)
      }
    }
    return WidgetState.Stale
  }

  private fun day(json: JSONObject): WidgetDay {
    val alert = json.optJSONObject("alert")
    val withdrawal = json.optJSONObject("withdrawal")
    return WidgetDay(
      date = json.getString("date"),
      safeToSpend = json.getString("safeToSpend"),
      balance = json.getString("balance"),
      alertLevel = alert?.optString("level"),
      alertText = alert?.optString("text").orEmpty(),
      dueThisWeek = json.getString("dueThisWeek"),
      dueThisWeekNote = json.getString("dueThisWeekNote"),
      comingIn = json.getString("comingIn"),
      withdrawal = withdrawal?.optString("amount"),
      withdrawalNote = withdrawal?.optString("note").orEmpty(),
      items = objects(json.getJSONArray("items")).map {
        WidgetItem(it.getString("name"), it.getString("amount"), it.getString("when"), it.getString("tone"))
      },
      goals = objects(json.getJSONArray("goals")).map {
        WidgetGoal(
          it.getString("id"),
          it.getString("name"),
          it.getString("saved"),
          it.getString("target"),
          it.getInt("percent"),
          it.getString("next"),
        )
      },
    )
  }

  private fun objects(array: JSONArray): List<JSONObject> =
    (0 until array.length()).map { array.getJSONObject(it) }
}
