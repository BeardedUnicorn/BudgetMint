// BudgetMint: the home screen's widgets (not in the Tauri template).
package com.budgetmint.android.widgets

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView
import androidx.appcompat.app.AppCompatActivity
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.lifecycle.lifecycleScope
import com.budgetmint.android.R
import kotlinx.coroutines.launch

/**
 * Which goal a Savings goal widget shows: the names of the bills being
 * saved up for (today's day of the page's snapshot), one tap to pick.
 * With none to pick from (signed out, or nothing saved up for) the widget
 * is added as it is, and says so itself.
 */
class GoalConfigActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    // Backing out adds no widget
    setResult(RESULT_CANCELED)
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()

    val state = WidgetData.state(WidgetData.snapshot(this).value)
    val goals = (state as? WidgetState.Ready)?.day?.goals.orEmpty()
    if (goals.isEmpty()) return done(widgetId, null)

    title = getString(R.string.widget_goal_choose)
    val list = ListView(this)
    list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, goals.map { it.name })
    list.setOnItemClickListener { _, _, position, _ -> done(widgetId, goals[position].id) }
    setContentView(list)
  }

  private fun done(widgetId: Int, goalId: String?) {
    lifecycleScope.launch {
      if (goalId != null) {
        val glanceId = GlanceAppWidgetManager(this@GoalConfigActivity).getGlanceIdBy(widgetId)
        updateAppWidgetState(this@GoalConfigActivity, glanceId) { it[GoalWidget.GOAL_ID] = goalId }
        GoalWidget().update(this@GoalConfigActivity, glanceId)
      }
      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
      finish()
    }
  }
}
