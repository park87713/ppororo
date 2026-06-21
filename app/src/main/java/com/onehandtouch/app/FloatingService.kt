package com.onehandtouch.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import kotlin.math.abs

/**
 * 다른 앱 위에 떠 있는 플로팅 버튼을 그리는 포그라운드 서비스.
 *
 * - 동그란 버튼을 드래그해 엄지가 닿기 좋은 위치에 둘 수 있다.
 * - 버튼을 탭하면 저장된 목표 지점 목록 패널이 펼쳐진다.
 * - 목록의 항목을 누르면 접근성 서비스가 그 좌표를 대신 탭한다.
 */
class FloatingService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var rootView: LinearLayout
    private lateinit var panel: LinearLayout
    private lateinit var fab: TextView
    private lateinit var params: WindowManager.LayoutParams

    private val handler = Handler(Looper.getMainLooper())
    private var expanded = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startAsForeground()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        buildOverlay()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        if (this::rootView.isInitialized && rootView.isAttachedToWindow) {
            runCatching { windowManager.removeView(rootView) }
        }
        super.onDestroy()
    }

    // ----------------------------------------------------------------- UI 구성

    private fun buildOverlay() {
        rootView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setBackgroundResource(R.drawable.bg_panel)
            val pad = dp(8)
            setPadding(pad, pad, pad, pad)
        }

        fab = TextView(this).apply {
            text = getString(R.string.fab_label)
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setBackgroundResource(R.drawable.bg_fab)
            val size = dp(56)
            layoutParams = LinearLayout.LayoutParams(size, size)
        }

        rootView.addView(panel)
        rootView.addView(fab)

        attachDragAndTap(fab)

        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(16)
            y = dp(240)
        }

        windowManager.addView(rootView, params)
    }

    /** 드래그(이동)와 탭(펼치기/접기)을 구분해 처리한다. */
    private fun attachDragAndTap(handle: View) {
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        val slop = dp(8)

        handle.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x
                    startY = params.y
                    touchX = event.rawX
                    touchY = event.rawY
                    moved = false
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchX).toInt()
                    val dy = (event.rawY - touchY).toInt()
                    if (abs(dx) > slop || abs(dy) > slop) moved = true
                    params.x = startX + dx
                    params.y = startY + dy
                    windowManager.updateViewLayout(rootView, params)
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!moved) togglePanel()
                    true
                }

                else -> false
            }
        }
    }

    // ------------------------------------------------------------- 패널 펼치기

    private fun togglePanel() {
        if (expanded) collapse() else expand()
    }

    private fun expand() {
        panel.removeAllViews()
        val points = PointStore.load(this)

        if (points.isEmpty()) {
            panel.addView(makeHint(getString(R.string.no_points_hint)))
        } else {
            points.forEach { p -> panel.addView(makePointButton(p)) }
        }

        panel.addView(makeActionButton(getString(R.string.add_point)) {
            collapse()
            openPicker()
        })
        panel.addView(makeActionButton(getString(R.string.close_panel)) { collapse() })

        panel.visibility = View.VISIBLE
        fab.text = getString(R.string.fab_label_open)
        expanded = true
    }

    private fun collapse() {
        panel.visibility = View.GONE
        fab.text = getString(R.string.fab_label)
        expanded = false
    }

    private fun makePointButton(point: TouchPoint): Button =
        makeActionButton("▶ ${point.label}") {
            // 패널을 먼저 접어 오버레이가 대상 좌표를 가리지 않게 한 뒤 탭한다.
            collapse()
            handler.postDelayed({ fireTap(point) }, 120)
        }

    private fun fireTap(point: TouchPoint) {
        val service = AutoTouchAccessibilityService.instance
        if (service == null) {
            toast(getString(R.string.accessibility_off))
            return
        }
        service.performTap(point.x, point.y)
    }

    private fun makeActionButton(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                dp(180),
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(4) }
        }

    private fun makeHint(text: String): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(0xFFFFFFFF.toInt())
            val pad = dp(8)
            setPadding(pad, pad, pad, pad)
        }

    private fun openPicker() {
        val intent = Intent(this, PointPickerActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
    }

    // --------------------------------------------------------------- 유틸리티

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    private fun startAsForeground() {
        val channelId = "floating_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                channelId,
                getString(R.string.notif_channel_name),
                NotificationManager.IMPORTANCE_MIN,
            )
            nm.createNotificationChannel(channel)
        }

        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setSmallIcon(R.drawable.ic_touch)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

        // specialUse 포그라운드 서비스 타입은 API 34부터 지원되므로 그때만 명시한다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIF_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val NOTIF_ID = 1001
    }
}
