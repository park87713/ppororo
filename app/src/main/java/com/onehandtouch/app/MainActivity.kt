package com.onehandtouch.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.onehandtouch.app.databinding.ActivityMainBinding

/**
 * 앱의 제어판 화면.
 *
 * 권한 두 가지(다른 앱 위에 표시 + 접근성)를 안내/연결하고,
 * 플로팅 버튼 서비스를 켜고 끄며, 저장된 목표 지점을 관리한다.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.overlayButton.setOnClickListener { openOverlaySettings() }
        binding.accessibilityButton.setOnClickListener { openAccessibilitySettings() }
        binding.toggleButton.setOnClickListener { toggleFloating() }
        binding.addPointButton.setOnClickListener { openPicker() }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        refreshPoints()
    }

    // --------------------------------------------------------------- 권한 상태

    private fun refreshStatus() {
        val canOverlay = Settings.canDrawOverlays(this)
        binding.overlayStatus.text = getString(
            if (canOverlay) R.string.status_granted else R.string.status_denied
        )
        binding.overlayButton.isEnabled = !canOverlay

        val accOn = isAccessibilityEnabled()
        binding.accessibilityStatus.text = getString(
            if (accOn) R.string.status_granted else R.string.status_denied
        )

        binding.toggleButton.text = getString(
            if (isFloatingRunning) R.string.stop_floating else R.string.start_floating
        )
    }

    private fun openOverlaySettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName"),
        )
        startActivity(intent)
    }

    private fun openAccessibilitySettings() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        Toast.makeText(this, R.string.accessibility_guide, Toast.LENGTH_LONG).show()
    }

    private fun isAccessibilityEnabled(): Boolean {
        val expected = "$packageName/${AutoTouchAccessibilityService::class.java.name}"
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        while (splitter.hasNext()) {
            if (splitter.next().equals(expected, ignoreCase = true)) return true
        }
        return false
    }

    // ------------------------------------------------------------- 플로팅 제어

    private val isFloatingRunning: Boolean
        get() = isServiceRunning(FloatingService::class.java)

    private fun toggleFloating() {
        if (isFloatingRunning) {
            stopService(Intent(this, FloatingService::class.java))
            Toast.makeText(this, R.string.floating_stopped, Toast.LENGTH_SHORT).show()
        } else {
            if (!Settings.canDrawOverlays(this)) {
                Toast.makeText(this, R.string.need_overlay_first, Toast.LENGTH_LONG).show()
                return
            }
            val intent = Intent(this, FloatingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            Toast.makeText(this, R.string.floating_started, Toast.LENGTH_SHORT).show()
        }
        binding.toggleButton.postDelayed({ refreshStatus() }, 300)
    }

    @Suppress("DEPRECATION")
    private fun isServiceRunning(serviceClass: Class<*>): Boolean {
        val manager = getSystemService(Context.ACTIVITY_SERVICE)
                as android.app.ActivityManager
        return manager.getRunningServices(Int.MAX_VALUE)
            .any { it.service.className == serviceClass.name }
    }

    // -------------------------------------------------------------- 지점 목록

    private fun openPicker() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, R.string.need_overlay_first, Toast.LENGTH_LONG).show()
            return
        }
        startActivity(Intent(this, PointPickerActivity::class.java))
    }

    private fun refreshPoints() {
        val container = binding.pointsContainer
        container.removeAllViews()
        val points = PointStore.load(this)

        if (points.isEmpty()) {
            container.addView(TextView(this).apply {
                text = getString(R.string.no_points)
                setPadding(0, dp(8), 0, dp(8))
            })
            return
        }

        points.forEach { p ->
            container.addView(buildPointRow(p))
        }
    }

    private fun buildPointRow(point: TouchPoint): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val label = TextView(this).apply {
            text = getString(R.string.point_row, point.label, point.x.toInt(), point.y.toInt())
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f,
            )
        }

        val delete = Button(this).apply {
            text = getString(R.string.delete)
            setOnClickListener {
                PointStore.remove(this@MainActivity, point.id)
                refreshPoints()
            }
        }

        row.addView(label)
        row.addView(delete)
        return row
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
