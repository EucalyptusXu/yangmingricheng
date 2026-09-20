package com.yangming.schedule

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 重启、改时间、换时区、应用更新之后，闹钟会被系统清空，这里把存档重放一遍。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> {
                ReminderReceiver.ensureChannel(context)
                ReminderScheduler.rescheduleAll(context)
            }
        }
    }
}
