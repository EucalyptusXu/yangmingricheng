package com.yangming.schedule

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * 一个 WebView 壳：
 * - 网页（assets/www）负责全部 UI 与业务，数据存在 localStorage
 * - 原生负责本地通知、精确闹钟、开机恢复 —— 这三件事浏览器做不了
 * - 桥名固定为 YMBridge，网页侧做能力探测，没有桥也能正常跑
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) toast("未授予通知权限，提醒只会在应用内出现")
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ReminderReceiver.ensureChannel(this)

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#F7F4EC"))
            isVerticalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
        }
        setContentView(web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            // allowContentAccess 用不到（没有 content:// 资源），databaseEnabled 是已废弃的
            // WebSQL 且是已知安全面 —— 都不开，只留真正需要的
            allowContentAccess = false
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100
            // 应用本身是浅色宣纸风，禁掉系统的强制深色反色
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                forceDark = WebSettings.FORCE_DARK_OFF
            }
        }
        // 调试开关刻意不写死开：我们对外分发的就是 debug 包，
        // 开着 setWebContentsDebuggingEnabled 等于允许任何 adb 读 localStorage（= 全部日程）。
        // 本地开发要查 WebView 时，把下面这行临时改回 true 即可。
        WebView.setWebContentsDebuggingEnabled(false)

        web.webChromeClient = WebChromeClient()

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith("file://")) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                } catch (e: Exception) {
                    true
                }
            }
        }

        web.addJavascriptInterface(Bridge(), "YMBridge")
        web.loadUrl("file:///android_asset/www/index.html")

        /* 返回键优先交给网页处理（关面板 / 回今日），网页不接手才退出 */
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript(
                    "(function(){try{return window.YM_onAndroidBack?window.YM_onAndroidBack():false}catch(e){return false}})()"
                ) { result ->
                    if (result != "true") finish()
                }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        // 回到前台：让网页校准日期并重算提醒
        web.evaluateJavascript(
            "window.YM_nativeRefresh&&window.YM_nativeRefresh()", null
        )
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            web.removeJavascriptInterface("YMBridge")
            web.destroy()
        }
        super.onDestroy()
    }

    /* ==================== JS ↔ 原生 ==================== */

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun askExactAlarmPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val am = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        if (am.canScheduleExactAlarms()) return
        try {
            startActivity(Intent(
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:$packageName")
            ))
        } catch (e: Exception) {
            // 某些定制 ROM 没有这个页面，忽略即可（会退回不精确闹钟）
        }
    }

    private fun toast(msg: String) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
    }

    inner class Bridge {

        @JavascriptInterface
        fun platform(): String = "android"

        /** 网页算好未来几天的提醒，整体交下来，原生负责真正把它们叫醒 */
        @JavascriptInterface
        fun setReminders(json: String) {
            runOnUiThread {
                try {
                    ReminderScheduler.apply(applicationContext, json)
                } catch (e: Exception) {
                    // 清单格式异常时不排程，也不崩
                }
            }
        }

        @JavascriptInterface
        fun requestNotificationPermission() = runOnUiThread { askNotificationPermission() }

        @JavascriptInterface
        fun ensureExactAlarm() = runOnUiThread { askExactAlarmPermission() }

        /** 立刻弹一条通知（用于「测试提醒是否通」） */
        @JavascriptInterface
        fun notify(title: String, body: String) {
            runOnUiThread {
                ReminderReceiver.postNow(applicationContext, title, body, 999001)
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Int) {
            runOnUiThread {
                try {
                    val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return@runOnUiThread
                    val d = ms.coerceIn(1, 2000).toLong()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        v.vibrate(d)
                    }
                } catch (e: Exception) {
                    // 忽略
                }
            }
        }
    }
}
