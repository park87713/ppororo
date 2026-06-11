/* 3x3 호모그래피 (투시 변환) 유틸리티.
 * 행렬은 row-major 9원소 배열: [a b c; d e f; g h i] */
"use strict";

const H3 = {
  /* 단위 정사각형 (0,0),(1,0),(1,1),(0,1) → 임의 사각형 q 로의 투시 변환.
   * Heckbert, "Fundamentals of Texture Mapping and Image Warping" 방식. */
  squareToQuad(q) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const sx = x0 - x1 + x2 - x3;
    const sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
      // 평행사변형 → 어파인으로 충분
      return [x1 - x0, x3 - x0, x0,
              y1 - y0, y3 - y0, y0,
              0, 0, 1];
    }
    const dx1 = x1 - x2, dy1 = y1 - y2;
    const dx2 = x3 - x2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - sy * dx2) / den;
    const h = (dx1 * sy - dy1 * sx) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
            y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
            g, h, 1];
  },

  invert(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = c * h - b * i;
    const C = b * f - c * e;
    const det = a * A + d * B + g * C;
    const s = 1 / det;
    return [A * s, B * s, C * s,
            (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s,
            (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s];
  },

  multiply(m, n) {
    const r = new Array(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        r[row * 3 + col] =
          m[row * 3] * n[col] +
          m[row * 3 + 1] * n[3 + col] +
          m[row * 3 + 2] * n[6 + col];
      }
    }
    return r;
  },

  /* from 사각형 → to 사각형으로 가는 호모그래피 (코너 순서 일치 기준) */
  quadToQuad(from, to) {
    return H3.multiply(H3.squareToQuad(to), H3.invert(H3.squareToQuad(from)));
  },

  /* 동차 좌표 적용: [X, Y, W] 반환 (W로 나누지 않음 — 셰이더에서 나눔) */
  applyHomogeneous(m, x, y) {
    return [m[0] * x + m[1] * y + m[2],
            m[3] * x + m[4] * y + m[5],
            m[6] * x + m[7] * y + m[8]];
  },

  /* 일반 적용: W로 나눈 2D 점 반환 */
  apply(m, x, y) {
    const [X, Y, W] = H3.applyHomogeneous(m, x, y);
    return [X / W, Y / W];
  },
};
