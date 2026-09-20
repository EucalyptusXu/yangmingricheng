package com.yangming.schedule

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * 提醒到点的接收器：发一条通知（正文是那句配对出来的王阳明语录），
 * 重复日程顺手把下一次排上，用户点「稍后提醒」则延后 10 分钟。
 */
class ReminderReceiver : BroadcastReceiver() {

    companion object {
        const val CHANNEL_ID = "ym_reminder"
        const val ACTION_SNOOZE = "com.yangming.schedule.SNOOZE"
        private const val SNOOZE_MINUTES = 10

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) != null) return
            val ch = NotificationChannel(
                CHANNEL_ID,
                "日程提醒",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "日程到点时提醒你，并附一句对得上的王阳明语录"
                enableLights(true)
                enableVibration(true)
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            }
            nm.createNotificationChannel(ch)
        }

        /** 网页端通过桥主动弹一条（用于测试提醒是否通） */
        fun postNow(context: Context, title: String, body: String, id: Int) {
            ensureChannel(context)
            val n = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openApp(context))
                .build()
            postNotification(context, id, n)
        }

        fun openApp(context: Context): PendingIntent {
            val i = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            return PendingIntent.getActivity(
                context, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        // 名字刻意避开 Object.notify()，免得解析歧义
        fun postNotification(context: Context, id: Int, n: Notification) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return
            try {
                NotificationManagerCompat.from(context).notify(id, n)
            } catch (e: SecurityException) {
                // 权限被撤销，忽略
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(ReminderScheduler.EXTRA_ID) ?: ""
        val title = intent.getStringExtra(ReminderScheduler.EXTRA_TITLE) ?: "日程提醒"
        val quote = intent.getStringExtra(ReminderScheduler.EXTRA_QUOTE) ?: ""
        val repeat = intent.getStringExtra(ReminderScheduler.EXTRA_REPEAT) ?: "none"
        val date = intent.getStringExtra(ReminderScheduler.EXTRA_DATE) ?: ""
        val time = intent.getStringExtra(ReminderScheduler.EXTRA_TIME) ?: ""
        val kind = intent.getStringExtra(ReminderScheduler.EXTRA_KIND) ?: ReminderScheduler.KIND_REMINDER

        if (intent.action == ACTION_SNOOZE) {
            ReminderScheduler.snooze(context, intent, SNOOZE_MINUTES)
            return
        }

        ensureChannel(context)

        /* 早晨推送走更轻的形态：保留标题(今日一句·篇名) + 正文(语录)，不带稍后按钮，不排下次。
         * 否则和日程提醒长得一样，用户会以为是日程漏掉了。 */
        if (kind == ReminderScheduler.KIND_MORNING) {
            val n = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(quote)
                .setStyle(NotificationCompat.BigTextStyle().bigText(quote))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
                .setAutoCancel(true)
                .setContentIntent(openApp(context))
                .build()
            postNotification(context, id.hashCode(), n)
            return
        }

        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(time.takeIf { it.isNotEmpty() }?.let { "$it · $title" } ?: title)
            .setContentText(quote.ifEmpty { "点一下，看看今天" })
            .setStyle(NotificationCompat.BigTextStyle().bigText(quote.ifEmpty { "点一下，看看今天" }))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .addAction(0, "延后$SNOOZE_MINUTES分钟", snoozeIntent(context, intent, id))
            .build()

        postNotification(context, id.hashCode(), n)
        vibrate(context)
        // 重复日程：先把下一次排上，避免用户长期不开 App 就断了
        val next = ReminderScheduler.nextOccurrence(date, time, repeat)
        if (next != null && next > System.currentTimeMillis()) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? android.app.AlarmManager
            if (am != null) {
                val nextIntent = Intent(intent).apply {
                    putExtra(ReminderScheduler.EXTRA_DATE, nextDate(date))
                }
                ReminderScheduler.schedule(context, am, next, nextIntent)
            }
        }
    }

    private fun snoozeIntent(context: Context, src: Intent, id: String): PendingIntent {
        val i = Intent(context, ReminderReceiver::class.java).apply {
            action = ACTION_SNOOZE
            putExtra(ReminderScheduler.EXTRA_ID, "$id-snooze")
            putExtra(ReminderScheduler.EXTRA_TITLE, src.getStringExtra(ReminderScheduler.EXTRA_TITLE))
            putExtra(ReminderScheduler.EXTRA_QUOTE, src.getStringExtra(ReminderScheduler.EXTRA_QUOTE))
            putExtra(ReminderScheduler.EXTRA_TIME, src.getStringExtra(ReminderScheduler.EXTRA_TIME))
            putExtra(ReminderScheduler.EXTRA_REPEAT, "none")
        }
        return PendingIntent.getBroadcast(
            context, ("$id-snooze").hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun vibrate(context: Context) {
        try {
            val v = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(180, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(180)
            }
        } catch (e: Exception) {
            // 没有振动器就算了
        }
    }

    /** "2026-09-20" → 次日（仅用于给兜底闹钟标注日期） */
    private fun nextDate(date: String): String {
        val p = date.split("-")
        if (p.size != 3) return date
        return try {
            val c = java.util.Calendar.getInstance()
            c.set(p[0].toInt(), p[1].toInt() - 1, p[2].toInt())
            c.add(java.util.Calendar.DAY_OF_MONTH, 1)
            String.format("%04d-%02d-%02d",
                c.get(java.util.Calendar.YEAR),
                c.get(java.util.Calendar.MONTH) + 1,
                c.get(java.util.Calendar.DAY_OF_MONTH))
        } catch (e: Exception) {
            date
        }
    }
}
