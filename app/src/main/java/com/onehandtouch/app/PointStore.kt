package com.onehandtouch.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 목표 지점 목록을 SharedPreferences 에 JSON 으로 저장/로드한다.
 * 외부 의존성 없이 가볍게 영속화하기 위해 직접 직렬화한다.
 */
object PointStore {

    private const val PREF = "one_hand_touch_prefs"
    private const val KEY_POINTS = "points"

    fun load(context: Context): MutableList<TouchPoint> {
        val raw = prefs(context).getString(KEY_POINTS, null) ?: return mutableListOf()
        val list = mutableListOf<TouchPoint>()
        runCatching {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(
                    TouchPoint(
                        id = o.getLong("id"),
                        label = o.getString("label"),
                        x = o.getDouble("x").toFloat(),
                        y = o.getDouble("y").toFloat(),
                    )
                )
            }
        }
        return list
    }

    fun save(context: Context, points: List<TouchPoint>) {
        val arr = JSONArray()
        points.forEach { p ->
            arr.put(
                JSONObject()
                    .put("id", p.id)
                    .put("label", p.label)
                    .put("x", p.x.toDouble())
                    .put("y", p.y.toDouble())
            )
        }
        prefs(context).edit().putString(KEY_POINTS, arr.toString()).apply()
    }

    fun add(context: Context, point: TouchPoint) {
        val list = load(context)
        list.add(point)
        save(context, list)
    }

    fun remove(context: Context, id: Long) {
        val list = load(context)
        list.removeAll { it.id == id }
        save(context, list)
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
}
