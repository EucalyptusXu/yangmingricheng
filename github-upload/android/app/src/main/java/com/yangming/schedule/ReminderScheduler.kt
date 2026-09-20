package com.yangming.schedule

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import java.util.Calendar

/**
 * 提醒排程：网页端把「未来几天的提醒 + 早晨推送」算好后整体交下来，
 * 这里写进 AlarmManager，并在开机 / 时间变更后重放。
 *
 * 策略是「整体替换」：每次收到新清单，先按旧存档撤掉全部闹钟，再排新的，
 * 端上永远只有一份真相，不会残留幽灵通知。
 *
 * JSON 形态兼容两种：
 * 1) 旧：[ {...}, {...} ]  （纯数组，每条都是日程提醒）
 * 2) 新：{ "reminders":[...], "morning":[...] }  （拆成两类）
 *    两类用不同的 id 前缀 → requestCode 自然不冲突。
 */
object ReminderScheduler {

    const val EXTRA_ID = "id"
    const val EXTRA_TITLE = "title"
    const val EXTRA_QUOTE = "quote"
    const val EXTRA_DATE = "date"
    const val EXTRA_TIME = "time"
    const val EXTRA_REPEAT = "repeat"
    const val EXTRA_KIND = "kind"

    const val KIND_REMINDER = "reminder"
    const val KIND_MORNING = "morning"

    private const val PREFS = "ym_reminders"
    private const val KEY_PAYLOAD = "payload"

    /** 请求码必须处处一致，否则取消不掉已经排上的闹钟 */
    private fun reqCode(id: String): Int = id.hashCode()

    /* ---------------- 存档 ---------------- */

    fun store(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_PAYLOAD, json).apply()
    }

    fun loadJson(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PAYLOAD, null)

    /* ---------------- 排程 ---------------- */

    /** 网页端调用入口：整体替换 */
    fun apply(context: Context, json: String) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return

        loadJson(context)?.let { cancelAll(context, am, it) }
        store(context, json)

        val items = parseItems(json)
        val now = System.currentTimeMillis()
        for (o in items) {
            val id = o.optString("id", "")
            if (id.isEmpty()) continue
            val triggerAt = o.optLong("triggerAt", 0L)
            if (triggerAt <= now) continue
            schedule(context, am, triggerAt, intentFor(context, id, o))
        }
    }

    /**
     * 解析 JSON。可能是顶层数组（兼容旧版），也可能是 {reminders, morning}（新版）。
     * 返回值合并两类，id 原样带上；requestCode 由 id 算出所以不会有冲突。
     */
    private fun parseItems(json: String): List<org.json.JSONObject> {
        return try {
            val v = org.json.JSONObject(json)
            val out = mutableListOf<org.json.JSONObject>()
            v.optJSONArray("reminders")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let(out::add) }
            v.optJSONArray("morning")?.let { a -> for (i in 0 until a.length()) a.optJSONObject(i)?.let(out::add) }
            if (out.isEmpty()) emptyList() else out
        } catch (e: Exception) {
            // 兼容：纯数组
            try {
                val a = JSONArray(json)
                val out = mutableListOf<org.json.JSONObject>()
                for (i in 0 until a.length()) a.optJSONObject(i)?.let(out::add)
                out
            } catch (e2: Exception) {
                emptyList()
            }
        }
    }

    /** 开机 / 时间或时区变更后重放存档 */
    fun rescheduleAll(context: Context) {
        val json = loadJson(context) ?: return
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        cancelAll(context, am, json)
        apply(context, json)
    }

    private fun cancelAll(context: Context, am: AlarmManager, json: String) {
        val items = parseItems(json)
        for (o in items) {
            val id = o.optString("id", "")
            if (id.isEmpty()) continue
            am.cancel(pendingIntent(context, intentFor(context, id, o), reqCode(id)))
        }
    }

    /* ---------------- 单个闹钟 ---------------- */

    private fun intentFor(context: Context, id: String, o: org.json.JSONObject): Intent =
        Intent(context, ReminderReceiver::class.java).apply {
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_TITLE, o.optString("title", "日程提醒"))
            putExtra(EXTRA_QUOTE, o.optString("quote", ""))
            putExtra(EXTRA_DATE, o.optString("date", ""))
            putExtra(EXTRA_TIME, o.optString("time", ""))
            putExtra(EXTRA_REPEAT, o.optString("repeat", "none"))
            /* 早晨推送走单独通道（更轻、不带稍后提醒按钮、不再排下一次） */
            if (id.startsWith("morning_")) putExtra(EXTRA_KIND, KIND_MORNING)
        }

    fun pendingIntent(context: Context, intent: Intent, requestCode: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    fun schedule(context: Context, am: AlarmManager, triggerAt: Long, intent: Intent) {
        val requestCode = intent.getStringExtra(EXTRA_ID)?.let { reqCode(it) } ?: triggerAt.hashCode()
        val pi = pendingIntent(context, intent, requestCode)
        try {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms() ->
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                else ->
                    am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } catch (e: SecurityException) {
            // 精确闹钟权限被系统撤销，退回不精确的
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
        }
    }

    /** 通知里的「稍后提醒」 */
    fun snooze(context: Context, intent: Intent, minutes: Int) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        schedule(context, am, System.currentTimeMillis() + minutes * 60_000L, intent)
    }

    /**
     * 重复日程的下一次触发时间。
     * 网页端每次打开都会重算并整体覆盖，这里只是「用户很久没打开 App」时的兜底。
     */
    fun nextOccurrence(dateOnly: String, hourMinute: String, repeat: String): Long? {
        if (dateOnly.isEmpty() || hourMinute.isEmpty() || repeat == "none") return null
        val d = dateOnly.split("-")
        val hm = hourMinute.split(":")
        if (d.size != 3 || hm.size != 2) return null
        val cal = Calendar.getInstance()
        return try {
            cal.set(d[0].toInt(), d[1].toInt() - 1, d[2].toInt(), hm[0].toInt(), hm[1].toInt(), 0)
            cal.set(Calendar.MILLISECOND, 0)
            when (repeat) {
                "daily" -> cal.add(Calendar.DAY_OF_MONTH, 1)
                "weekday" -> {
                    cal.add(Calendar.DAY_OF_MONTH, 1)
                    while (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY ||
                        cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
                        cal.add(Calendar.DAY_OF_MONTH, 1)
                    }
                }
                "weekly" -> cal.add(Calendar.WEEK_OF_YEAR, 1)
                "monthly" -> cal.add(Calendar.MONTH, 1)
                else -> return null
            }
            cal.timeInMillis
        } catch (e: Exception) {
            null
        }
    }
}
