package com.onehandtouch.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityEvent

/**
 * root 권한 없이 임의의 화면 좌표를 실제로 "탭" 하기 위한 접근성 서비스.
 *
 * Android 7.0(API 24)부터 제공되는 [dispatchGesture] 를 사용해
 * 지정한 좌표에 짧은 탭 제스처를 주입한다. 이 서비스가 켜져 있어야
 * 플로팅 버튼이 대신 눌러주는 동작을 할 수 있다.
 */
class AutoTouchAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // 이 앱은 이벤트를 관찰할 필요가 없으므로 비워 둔다.
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    /**
     * 화면 절대 좌표 [x], [y] 위치를 한 번 탭한다.
     * @return 제스처 디스패치가 시작되면 true.
     */
    fun performTap(x: Float, y: Float): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, TAP_DURATION_MS)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    companion object {
        private const val TAP_DURATION_MS = 60L

        /** 현재 실행 중인 서비스 인스턴스(없으면 null). */
        @Volatile
        var instance: AutoTouchAccessibilityService? = null
            private set

        /** 접근성 서비스가 활성화되어 탭을 수행할 수 있는 상태인지. */
        fun isReady(): Boolean = instance != null
    }
}
