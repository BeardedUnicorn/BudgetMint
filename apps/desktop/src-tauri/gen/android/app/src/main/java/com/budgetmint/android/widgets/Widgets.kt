// BudgetMint: the home screen's widgets (not in the Tauri template).
package com.budgetmint.android.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.budgetmint.android.MainActivity
import com.budgetmint.android.R

/**
 * The four widgets. Each shows today's day of the page's snapshot
 * (WidgetData) in text alone (no bitmaps: Android 17 limits a widget's),
 * and a tap opens the app at the page it's from. With no snapshot it asks
 * to sign in; with one that has run out of days, to be opened.
 */

/** Below zero, low, and money coming in: the app's own red, amber and green, light and dark. */
private val SHORT = ColorProvider(day = Color(0xFFB3261E), night = Color(0xFFF2B8B5))
private val LOW = ColorProvider(day = Color(0xFF8A5300), night = Color(0xFFFFB95C))
private val INCOME = ColorProvider(day = Color(0xFF0B7A45), night = Color(0xFF6DD9A0))

@Composable private fun label() = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp)

@Composable
private fun figure(size: Int = 22, color: ColorProvider = GlanceTheme.colors.onSurface) =
  TextStyle(color = color, fontSize = size.sp, fontWeight = FontWeight.Medium)

@Composable private fun body() = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp)

private fun alertColor(level: String?): ColorProvider = if (level == "short") SHORT else LOW

/** The widget's card: the system's widget background and corners, and a tap that opens `target`. */
@Composable
private fun Card(context: Context, target: String, content: @Composable () -> Unit) {
  GlanceTheme {
    Column(
      modifier = GlanceModifier
        .fillMaxSize()
        .appWidgetBackground()
        .background(GlanceTheme.colors.widgetBackground)
        .cornerRadius(16.dp)
        .padding(12.dp)
        .clickable(actionStartActivity(MainActivity.openIntent(context, target))),
    ) {
      content()
    }
  }
}

/** A widget of `target`'s page: today's day, or what to do to have one. */
@Composable
private fun Widget(context: Context, target: String, content: @Composable (WidgetDay) -> Unit) {
  val json by WidgetData.snapshot(context).collectAsState()
  Card(context, target) {
    when (val state = WidgetData.state(json)) {
      is WidgetState.Ready -> content(state.day)
      WidgetState.SignedOut -> Text(context.getString(R.string.widget_signed_out), style = body())
      WidgetState.Stale -> Text(context.getString(R.string.widget_stale), style = body())
    }
  }
}

class SafeToSpendWidget : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
    Widget(context, "go-overview") { day ->
      Text(context.getString(R.string.widget_safe_to_spend), style = label(), maxLines = 1)
      Text(day.safeToSpend, style = figure(), maxLines = 1)
      Spacer(GlanceModifier.height(2.dp))
      if (day.alertLevel != null) {
        Text(day.alertText, style = TextStyle(color = alertColor(day.alertLevel), fontSize = 12.sp), maxLines = 1)
      } else {
        Text(
          context.getString(R.string.widget_balance_today, day.balance),
          style = label(),
          maxLines = 1,
        )
      }
    }
  }
}

class ComingUpWidget : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
    Widget(context, "go-overview") { day ->
      Text(context.getString(R.string.widget_coming_up), style = label(), maxLines = 1)
      Spacer(GlanceModifier.height(4.dp))
      if (day.items.isEmpty()) {
        Text(context.getString(R.string.widget_nothing_due), style = body())
      } else {
        LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
          items(day.items) { item ->
            Row(
              modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Column(modifier = GlanceModifier.defaultWeight()) {
                Text(item.name, style = body(), maxLines = 1)
                Text(
                  item.whenText,
                  style = TextStyle(
                    color = if (item.tone == "overdue") SHORT else GlanceTheme.colors.onSurfaceVariant,
                    fontSize = 12.sp,
                  ),
                  maxLines = 1,
                )
              }
              Spacer(GlanceModifier.width(8.dp))
              Text(
                item.amount,
                style = TextStyle(
                  color = if (item.tone == "income") INCOME else GlanceTheme.colors.onSurface,
                  fontSize = 14.sp,
                  fontWeight = FontWeight.Medium,
                ),
                maxLines = 1,
              )
            }
          }
        }
      }
    }
  }
}

class ThisWeekWidget : GlanceAppWidget() {
  @Composable
  private fun Stat(title: String, value: String, note: String, modifier: GlanceModifier) {
    Column(modifier = modifier) {
      Text(title, style = label(), maxLines = 1)
      Text(value, style = figure(18), maxLines = 1)
      Text(note, style = label(), maxLines = 1)
    }
  }

  override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
    Widget(context, "go-overview") { day ->
      Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        val cell = GlanceModifier.defaultWeight()
        Stat(context.getString(R.string.widget_due_this_week), day.dueThisWeek, day.dueThisWeekNote, cell)
        Stat(
          context.getString(R.string.widget_coming_in),
          day.comingIn,
          context.getString(R.string.widget_coming_in_note),
          cell,
        )
        if (day.withdrawal != null) {
          Stat(context.getString(R.string.widget_withdrawal), day.withdrawal, day.withdrawalNote, cell)
        }
      }
    }
  }
}

class GoalWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
    // The goal chosen for this widget (GoalConfigActivity); the first, until one is, or once it's gone
    val chosen = currentState(GOAL_ID)
    Widget(context, "go-savings") { day ->
      val goal = day.goals.firstOrNull { it.id == chosen } ?: day.goals.firstOrNull()
      if (goal == null) {
        Text(context.getString(R.string.widget_no_goals), style = body())
      } else {
        Text(goal.name, style = label(), maxLines = 1)
        Text(goal.saved, style = figure(), maxLines = 1)
        Text(context.getString(R.string.widget_goal_of, goal.target), style = label(), maxLines = 1)
        Spacer(GlanceModifier.height(6.dp))
        LinearProgressIndicator(
          progress = goal.percent / 100f,
          modifier = GlanceModifier.fillMaxWidth().height(6.dp),
          color = GlanceTheme.colors.primary,
          backgroundColor = GlanceTheme.colors.surfaceVariant,
        )
        Spacer(GlanceModifier.height(6.dp))
        Text(goal.next, style = label(), maxLines = 1)
      }
    }
  }

  companion object {
    /** Which goal a Savings goal widget shows: the item's id. */
    val GOAL_ID = stringPreferencesKey("goalId")
  }
}

class SafeToSpendReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SafeToSpendWidget()
}

class ComingUpReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = ComingUpWidget()
}

class ThisWeekReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = ThisWeekWidget()
}

class GoalReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = GoalWidget()
}
