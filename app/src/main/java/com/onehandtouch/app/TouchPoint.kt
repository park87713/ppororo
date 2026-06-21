package com.onehandtouch.app

/**
 * 화면에서 대신 눌러줄 목표 지점 하나를 나타낸다.
 *
 * @param id    고유 식별자(생성 시각 기반)
 * @param label 플로팅 패널에 표시할 짧은 이름
 * @param x     화면 절대 좌표 X (px)
 * @param y     화면 절대 좌표 Y (px)
 */
data class TouchPoint(
    val id: Long,
    val label: String,
    val x: Float,
    val y: Float,
)
