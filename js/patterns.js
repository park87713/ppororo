/* 프로젝터 정렬용 테스트 패턴 생성기. 캔버스를 반환한다. */
"use strict";

const PATTERN_TYPES = {
  grid:      "그리드",
  checker:   "체커보드",
  colorbars: "컬러 바",
  gradient:  "그라디언트",
  white:     "화이트",
};

function makePatternCanvas(type, w = 1920, h = 1080) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");

  switch (type) {
    case "grid": {
      x.fillStyle = "#000";
      x.fillRect(0, 0, w, h);
      const step = Math.round(h / 12);
      x.strokeStyle = "#9a9a9a";
      x.lineWidth = 1;
      x.beginPath();
      for (let gx = step; gx < w; gx += step) { x.moveTo(gx + .5, 0); x.lineTo(gx + .5, h); }
      for (let gy = step; gy < h; gy += step) { x.moveTo(0, gy + .5); x.lineTo(w, gy + .5); }
      x.stroke();
      // 중앙 십자 + 원
      x.strokeStyle = "#fff";
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(w / 2, 0); x.lineTo(w / 2, h);
      x.moveTo(0, h / 2); x.lineTo(w, h / 2);
      x.stroke();
      x.beginPath();
      x.arc(w / 2, h / 2, h * 0.4, 0, Math.PI * 2);
      x.stroke();
      // 외곽 테두리
      x.lineWidth = 6;
      x.strokeRect(3, 3, w - 6, h - 6);
      // 방향 식별용 코너 마커 (TL빨강 TR초록 BR파랑 BL노랑)
      const m = step;
      x.fillStyle = "#e33"; x.fillRect(0, 0, m, m);
      x.fillStyle = "#3c3"; x.fillRect(w - m, 0, m, m);
      x.fillStyle = "#36f"; x.fillRect(w - m, h - m, m, m);
      x.fillStyle = "#fc3"; x.fillRect(0, h - m, m, m);
      x.fillStyle = "#fff";
      x.font = `bold ${Math.round(h / 18)}px sans-serif`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(`${w} × ${h}`, w / 2, h / 2 - step * 1.5);
      break;
    }

    case "checker": {
      const s = Math.round(h / 9);
      for (let j = 0; j * s < h; j++) {
        for (let i = 0; i * s < w; i++) {
          x.fillStyle = (i + j) % 2 ? "#e8e8e8" : "#111";
          x.fillRect(i * s, j * s, s, s);
        }
      }
      break;
    }

    case "colorbars": {
      const colors = ["#bfbfbf", "#bfbf00", "#00bfbf", "#00bf00",
                      "#bf00bf", "#bf0000", "#0000bf", "#131313"];
      const bw = w / colors.length;
      colors.forEach((col, i) => {
        x.fillStyle = col;
        x.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h);
      });
      break;
    }

    case "gradient": {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "#000");
      g.addColorStop(1, "#fff");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      break;
    }

    case "white":
    default: {
      x.fillStyle = "#fff";
      x.fillRect(0, 0, w, h);
      break;
    }
  }
  return c;
}
