package com.onehandtouch.app

import android.os.Bundle
import android.view.MotionEvent
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * 반투명 전체 화면 위에서 사용자가 한 번 탭한 위치를 목표 지점으로 기록한다.
 *
 * 탭한 좌표(rawX/rawY)는 화면 절대 좌표이므로 접근성 서비스의
 * dispatchGesture 좌표와 동일하게 사용할 수 있다. 좌표를 잡은 뒤
 * 이름을 입력받아 [PointStore] 에 저장한다.
 */
class PointPickerActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply {
            setBackgroundColor(0x66000000) // 반투명 검정
        }

        val hint = TextView(this).apply {
            text = getString(R.string.picker_hint)
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 18f
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        root.addView(hint)

        root.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_UP) {
                askLabelAndSave(event.rawX, event.rawY)
            }
            true
        }

        setContentView(root)
    }

    private fun askLabelAndSave(x: Float, y: Float) {
        val input = EditText(this).apply {
            hint = getString(R.string.picker_label_hint)
            setText(getString(R.string.picker_label_default))
            setSelection(text.length)
        }

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.picker_dialog_title, x.toInt(), y.toInt()))
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val label = input.text.toString().ifBlank {
                    getString(R.string.picker_label_default)
                }
                PointStore.add(
                    this,
                    TouchPoint(
                        id = System.currentTimeMillis(),
                        label = label,
                        x = x,
                        y = y,
                    ),
                )
                finish()
            }
            .setNegativeButton(android.R.string.cancel) { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }
}
