/* ProMapper — 프로젝터 매핑 메인 애플리케이션.
 * 상태 관리, 편집기 상호작용, UI, 출력 창, 프로젝트 저장/불러오기. */
"use strict";

const $ = (sel) => document.querySelector(sel);

const HANDLE_R = 6;        // 핸들 화면 반경(px)
const HIT_R = 10;          // 핸들 클릭 판정 반경(px)
const UNIT_SRC = () => [[0, 0], [1, 0], [1, 1], [0, 1]];

const state = {
  output: { w: 1920, h: 1080 },
  media: [],          // { id, name, kind: 'pattern'|'image'|'video', patternType?, source, dirty }
  surfaces: [],       // 아래 makeQuad/makeMesh 참고
  selectedId: null,
  mode: "output",     // 'output' | 'input'
  view: { scale: 1, ox: 0, oy: 0 }, // 출력 좌표 → 편집기 화면 좌표
};

let nextId = 1;
let glCanvas, overlay, octx, editorEl, renderer;
let outputWin = null;
let outputStream = null;

/* ============================== 미디어 ============================== */

function mediaById(id) {
  return state.media.find((m) => m.id === id) || null;
}

function mediaSize(m) {
  if (!m || !m.source) return [16, 9];
  if (m.kind === "video") return [m.source.videoWidth || 16, m.source.videoHeight || 9];
  return [m.source.naturalWidth || m.source.width, m.source.naturalHeight || m.source.height];
}

function addPatternMedia(type) {
  const m = {
    id: nextId++,
    name: `테스트: ${PATTERN_TYPES[type]}`,
    kind: "pattern",
    patternType: type,
    source: makePatternCanvas(type, state.output.w, state.output.h),
  };
  state.media.push(m);
  renderMediaList();
  return m;
}

function addFileMedia(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    const v = document.createElement("video");
    v.src = url;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.play().catch(() => {});
    const m = { id: nextId++, name: file.name, kind: "video", source: v };
    state.media.push(m);
    renderMediaList();
    return m;
  }
  const img = new Image();
  const m = { id: nextId++, name: file.name, kind: "image", source: null };
  img.onload = () => { m.source = img; m.dirty = true; };
  img.src = url;
  state.media.push(m);
  renderMediaList();
  return m;
}

function removeMedia(id) {
  const i = state.media.findIndex((m) => m.id === id);
  if (i < 0) return;
  renderer.releaseMedia(id);
  state.media.splice(i, 1);
  for (const s of state.surfaces) {
    if (s.mediaId === id) s.mediaId = state.media[0] ? state.media[0].id : null;
  }
  renderMediaList();
  renderProperties();
}

/* ============================== 서피스 ============================== */

function defaultRect(n) {
  const { w, h } = state.output;
  const rw = w * 0.5, rh = h * 0.5;
  const off = (n % 5) * 24;
  const x = (w - rw) / 2 + off, y = (h - rh) / 2 + off;
  return [x, y, rw, rh];
}

function baseSurface(name) {
  return {
    id: nextId++,
    name,
    mediaId: state.media[0] ? state.media[0].id : null,
    src: UNIT_SRC(),
    opacity: 1, brightness: 1, contrast: 1, saturation: 1,
    tint: "#ffffff",
    blend: { l: 0, r: 0, t: 0, b: 0 },
    visible: true,
  };
}

function makeQuad() {
  const [x, y, w, h] = defaultRect(state.surfaces.length);
  return Object.assign(baseSurface(`쿼드 ${state.surfaces.length + 1}`), {
    type: "quad",
    dst: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
  });
}

function makeMesh(cols = 4, rows = 4) {
  const [x, y, w, h] = defaultRect(state.surfaces.length);
  const points = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      points.push([x + (w * i) / (cols - 1), y + (h * j) / (rows - 1)]);
    }
  }
  return Object.assign(baseSurface(`메시 ${state.surfaces.length + 1}`), {
    type: "mesh", cols, rows, points,
  });
}

function addSurface(type) {
  const s = type === "mesh" ? makeMesh() : makeQuad();
  state.surfaces.push(s);
  selectSurface(s.id);
  renderSurfaceList();
  return s;
}

function removeSurface(id) {
  const i = state.surfaces.findIndex((s) => s.id === id);
  if (i < 0) return;
  state.surfaces.splice(i, 1);
  if (state.selectedId === id) selectSurface(null);
  renderSurfaceList();
}

function selectedSurface() {
  return state.surfaces.find((s) => s.id === state.selectedId) || null;
}

function selectSurface(id) {
  state.selectedId = id;
  renderSurfaceList();
  renderProperties();
  const s = selectedSurface();
  $("#statusSel").textContent = s ? `선택: ${s.name}` : "";
}

/* 서피스의 모든 출력 좌표 점 (이동/넛지에 사용) */
function surfacePoints(s) {
  return s.type === "mesh" ? s.points : s.dst;
}

/* 외곽선 폴리곤 (그리기/히트테스트에 사용) */
function surfaceOutline(s) {
  if (s.type !== "mesh") return s.dst;
  const { cols, rows, points } = s;
  const out = [];
  for (let i = 0; i < cols; i++) out.push(points[i]);                         // 상단
  for (let j = 1; j < rows; j++) out.push(points[j * cols + cols - 1]);       // 우측
  for (let i = cols - 2; i >= 0; i--) out.push(points[(rows - 1) * cols + i]); // 하단
  for (let j = rows - 2; j >= 1; j--) out.push(points[j * cols]);             // 좌측
  return out;
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function surfaceHit(s, x, y) {
  if (s.type !== "mesh") return pointInPolygon(x, y, s.dst);
  const { cols, rows, points } = s;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const cell = [points[j * cols + i], points[j * cols + i + 1],
                    points[(j + 1) * cols + i + 1], points[(j + 1) * cols + i]];
      if (pointInPolygon(x, y, cell)) return true;
    }
  }
  return false;
}

function translateSurface(s, dx, dy) {
  for (const p of surfacePoints(s)) { p[0] += dx; p[1] += dy; }
}

/* 메시 격자 해상도 변경: 기존 그리드를 이중선형 리샘플 */
function resampleMesh(s, nc, nr) {
  const sample = (u, v) => {
    const fx = u * (s.cols - 1), fy = v * (s.rows - 1);
    const i = Math.min(Math.floor(fx), s.cols - 2);
    const j = Math.min(Math.floor(fy), s.rows - 2);
    const tx = fx - i, ty = fy - j;
    const p00 = s.points[j * s.cols + i], p10 = s.points[j * s.cols + i + 1];
    const p01 = s.points[(j + 1) * s.cols + i], p11 = s.points[(j + 1) * s.cols + i + 1];
    return [
      (1 - ty) * ((1 - tx) * p00[0] + tx * p10[0]) + ty * ((1 - tx) * p01[0] + tx * p11[0]),
      (1 - ty) * ((1 - tx) * p00[1] + tx * p10[1]) + ty * ((1 - tx) * p01[1] + tx * p11[1]),
    ];
  };
  const points = [];
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      points.push(sample(i / (nc - 1), j / (nr - 1)));
    }
  }
  s.cols = nc;
  s.rows = nr;
  s.points = points;
}

/* ============================== 편집 뷰 ============================== */

function o2s(x, y) {
  return [x * state.view.scale + state.view.ox, y * state.view.scale + state.view.oy];
}
function s2o(x, y) {
  return [(x - state.view.ox) / state.view.scale, (y - state.view.oy) / state.view.scale];
}

function fitView() {
  const ew = editorEl.clientWidth, eh = editorEl.clientHeight;
  const { w, h } = state.output;
  const scale = Math.min((ew - 60) / w, (eh - 60) / h);
  state.view.scale = scale;
  state.view.ox = (ew - w * scale) / 2;
  state.view.oy = (eh - h * scale) / 2;
  applyViewToGlCanvas();
}

function applyViewToGlCanvas() {
  const { scale, ox, oy } = state.view;
  glCanvas.style.left = ox + "px";
  glCanvas.style.top = oy + "px";
  glCanvas.style.width = state.output.w * scale + "px";
  glCanvas.style.height = state.output.h * scale + "px";
}

function resizeOverlay() {
  const dpr = window.devicePixelRatio || 1;
  overlay.width = editorEl.clientWidth * dpr;
  overlay.height = editorEl.clientHeight * dpr;
}

function setOutputSize(w, h) {
  state.output.w = w;
  state.output.h = h;
  glCanvas.width = w;
  glCanvas.height = h;
  // 패턴 미디어는 출력 해상도에 맞춰 다시 생성
  for (const m of state.media) {
    if (m.kind === "pattern") {
      m.source = makePatternCanvas(m.patternType, w, h);
      m.dirty = true;
    }
  }
  $("#statusRes").textContent = `출력 ${w} × ${h}`;
  fitView();
}

/* 입력 편집 모드: 미디어를 편집 영역에 맞춰 보여주는 사각형 */
function inputFitRect() {
  const m = mediaById(selectedSurface()?.mediaId);
  const [mw, mh] = mediaSize(m);
  const ew = editorEl.clientWidth, eh = editorEl.clientHeight;
  const scale = Math.min((ew - 80) / mw, (eh - 80) / mh);
  const w = mw * scale, h = mh * scale;
  return { x: (ew - w) / 2, y: (eh - h) / 2, w, h };
}

function uv2screen(u, v, rect) {
  return [rect.x + u * rect.w, rect.y + v * rect.h];
}
function screen2uv(x, y, rect) {
  return [(x - rect.x) / rect.w, (y - rect.y) / rect.h];
}

/* ============================== 오버레이 그리기 ============================== */

function drawOverlay() {
  const dpr = window.devicePixelRatio || 1;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, editorEl.clientWidth, editorEl.clientHeight);

  if (state.mode === "input") {
    drawInputOverlay();
    return;
  }

  // 출력 프레임 테두리
  const [fx, fy] = o2s(0, 0);
  octx.strokeStyle = "#4a4a55";
  octx.lineWidth = 1;
  octx.strokeRect(fx, fy, state.output.w * state.view.scale, state.output.h * state.view.scale);

  for (const s of state.surfaces) {
    const selected = s.id === state.selectedId;
    const outline = surfaceOutline(s).map(([x, y]) => o2s(x, y));

    octx.strokeStyle = selected ? "#46a0ff" : s.visible ? "#777783" : "#44444c";
    octx.lineWidth = selected ? 1.8 : 1.2;
    octx.beginPath();
    outline.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
    octx.closePath();
    octx.stroke();

    // 이름 라벨
    const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length;
    const cy = outline.reduce((a, p) => a + p[1], 0) / outline.length;
    octx.fillStyle = selected ? "#9ecbff" : "#8e8e98";
    octx.font = "11px sans-serif";
    octx.textAlign = "center";
    octx.fillText(s.name, cx, cy);

    if (!selected) continue;

    // 메시 내부 격자선
    if (s.type === "mesh") {
      octx.strokeStyle = "rgba(70,160,255,0.35)";
      octx.lineWidth = 1;
      octx.beginPath();
      for (let j = 0; j < s.rows; j++) {
        for (let i = 0; i < s.cols; i++) {
          const [x, y] = o2s(...s.points[j * s.cols + i]);
          if (i === 0) octx.moveTo(x, y); else octx.lineTo(x, y);
        }
      }
      for (let i = 0; i < s.cols; i++) {
        for (let j = 0; j < s.rows; j++) {
          const [x, y] = o2s(...s.points[j * s.cols + i]);
          if (j === 0) octx.moveTo(x, y); else octx.lineTo(x, y);
        }
      }
      octx.stroke();
    }

    // 핸들
    for (const [px, py] of surfacePoints(s)) {
      const [x, y] = o2s(px, py);
      drawHandle(x, y, "#46a0ff");
    }
  }
}

function drawInputOverlay() {
  const ew = editorEl.clientWidth, eh = editorEl.clientHeight;
  octx.fillStyle = "#141417";
  octx.fillRect(0, 0, ew, eh);

  const s = selectedSurface();
  if (!s) {
    octx.fillStyle = "#8e8e98";
    octx.font = "14px sans-serif";
    octx.textAlign = "center";
    octx.fillText("입력 영역을 편집할 서피스를 선택하세요", ew / 2, eh / 2);
    return;
  }

  const m = mediaById(s.mediaId);
  const rect = inputFitRect();

  if (m && m.source && (m.kind !== "video" || m.source.readyState >= 2)) {
    try { octx.drawImage(m.source, rect.x, rect.y, rect.w, rect.h); } catch (e) { /* 로딩 중 */ }
  } else {
    octx.fillStyle = "#2a2a30";
    octx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  octx.strokeStyle = "#4a4a55";
  octx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  // 사용 영역 바깥 어둡게
  const pts = s.src.map(([u, v]) => uv2screen(u, v, rect));
  octx.save();
  octx.beginPath();
  octx.rect(rect.x, rect.y, rect.w, rect.h);
  octx.moveTo(pts[0][0], pts[0][1]);
  for (let i = pts.length - 1; i >= 0; i--) octx.lineTo(pts[i][0], pts[i][1]);
  octx.closePath();
  octx.fillStyle = "rgba(0,0,0,0.55)";
  octx.fill("evenodd");
  octx.restore();

  // 소스 사각형 + 핸들
  octx.strokeStyle = "#ffb83d";
  octx.lineWidth = 1.8;
  octx.beginPath();
  pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
  octx.closePath();
  octx.stroke();
  for (const [x, y] of pts) drawHandle(x, y, "#ffb83d");

  octx.fillStyle = "#8e8e98";
  octx.font = "12px sans-serif";
  octx.textAlign = "center";
  octx.fillText(`${s.name} — 소스 사용 영역`, ew / 2, rect.y - 12);
}

function drawHandle(x, y, color) {
  octx.fillStyle = "#16161a";
  octx.strokeStyle = color;
  octx.lineWidth = 1.5;
  octx.beginPath();
  octx.rect(x - HANDLE_R, y - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
  octx.fill();
  octx.stroke();
}

/* ============================== 마우스/키보드 ============================== */

const drag = { type: null }; // 'handle' | 'move' | 'pan' | 'src-handle'
let spaceDown = false;

function bindEditorEvents() {
  overlay.addEventListener("mousedown", (e) => {
    const mx = e.offsetX, my = e.offsetY;

    if (e.button === 1 || spaceDown) {
      drag.type = "pan";
      drag.start = [mx, my];
      drag.viewStart = [state.view.ox, state.view.oy];
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    if (state.mode === "input") {
      const s = selectedSurface();
      if (!s) return;
      const rect = inputFitRect();
      for (let i = 0; i < 4; i++) {
        const [hx, hy] = uv2screen(s.src[i][0], s.src[i][1], rect);
        if (Math.hypot(mx - hx, my - hy) <= HIT_R) {
          drag.type = "src-handle";
          drag.index = i;
          drag.rect = rect;
          return;
        }
      }
      return;
    }

    const [ox, oy] = s2o(mx, my);
    const sel = selectedSurface();

    // 1) 선택된 서피스의 핸들
    if (sel) {
      const pts = surfacePoints(sel);
      const hitR = HIT_R / state.view.scale;
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(ox - pts[i][0], oy - pts[i][1]) <= hitR) {
          drag.type = "handle";
          drag.index = i;
          return;
        }
      }
    }

    // 2) 서피스 선택/이동 (위에 그려진 것 우선)
    for (let i = state.surfaces.length - 1; i >= 0; i--) {
      const s = state.surfaces[i];
      if (!s.visible) continue;
      if (surfaceHit(s, ox, oy)) {
        selectSurface(s.id);
        drag.type = "move";
        drag.last = [ox, oy];
        return;
      }
    }
    selectSurface(null);
  });

  window.addEventListener("mousemove", (e) => {
    const r = overlay.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;

    if (state.mode === "output") {
      const [ox, oy] = s2o(mx, my);
      $("#statusMouse").textContent = `${Math.round(ox)}, ${Math.round(oy)}`;
    }

    if (drag.type === "pan") {
      state.view.ox = drag.viewStart[0] + (mx - drag.start[0]);
      state.view.oy = drag.viewStart[1] + (my - drag.start[1]);
      applyViewToGlCanvas();
      return;
    }

    const sel = selectedSurface();
    if (!sel) return;

    if (drag.type === "handle") {
      const [ox, oy] = s2o(mx, my);
      const pts = surfacePoints(sel);
      pts[drag.index][0] = ox;
      pts[drag.index][1] = oy;
    } else if (drag.type === "move") {
      const [ox, oy] = s2o(mx, my);
      translateSurface(sel, ox - drag.last[0], oy - drag.last[1]);
      drag.last = [ox, oy];
    } else if (drag.type === "src-handle") {
      const [u, v] = screen2uv(mx, my, drag.rect);
      sel.src[drag.index][0] = Math.min(1, Math.max(0, u));
      sel.src[drag.index][1] = Math.min(1, Math.max(0, v));
    }
  });

  window.addEventListener("mouseup", () => { drag.type = null; });

  overlay.addEventListener("wheel", (e) => {
    if (state.mode === "input") return;
    e.preventDefault();
    const f = Math.pow(1.0015, -e.deltaY);
    const ns = Math.min(20, Math.max(0.05, state.view.scale * f));
    const k = ns / state.view.scale;
    state.view.ox = e.offsetX - (e.offsetX - state.view.ox) * k;
    state.view.oy = e.offsetY - (e.offsetY - state.view.oy) * k;
    state.view.scale = ns;
    applyViewToGlCanvas();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (e.code === "Space") { spaceDown = true; e.preventDefault(); return; }
    if (e.key === "f" || e.key === "F") { fitView(); return; }

    const sel = selectedSurface();
    if (!sel) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      removeSurface(sel.id);
      e.preventDefault();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      translateSurface(sel, ...moves[e.key]);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceDown = false;
  });
}

/* ============================== UI: 목록/속성 ============================== */

function renderMediaList() {
  const list = $("#mediaList");
  list.innerHTML = "";
  if (!state.media.length) {
    list.innerHTML = `<div class="empty">미디어 없음</div>`;
  }
  for (const m of state.media) {
    const item = document.createElement("div");
    item.className = "item";
    const sel = selectedSurface();
    if (sel && sel.mediaId === m.id) item.classList.add("selected");

    const kindLabel = { pattern: "패턴", image: "이미지", video: "비디오" }[m.kind];
    item.innerHTML = `<span class="label">${escapeHtml(m.name)}</span>
                      <span class="kind">${kindLabel}</span>
                      <button class="icon-btn" title="삭제">✕</button>`;
    item.addEventListener("click", () => {
      const s = selectedSurface();
      if (s) {
        s.mediaId = m.id;
        renderMediaList();
        renderProperties();
      }
    });
    item.querySelector(".icon-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeMedia(m.id);
    });
    list.appendChild(item);
  }
}

function renderSurfaceList() {
  const list = $("#surfaceList");
  list.innerHTML = "";
  if (!state.surfaces.length) {
    list.innerHTML = `<div class="empty">+ 쿼드 / + 메시로 추가</div>`;
  }
  for (const s of state.surfaces) {
    const item = document.createElement("div");
    item.className = "item";
    if (s.id === state.selectedId) item.classList.add("selected");
    if (!s.visible) item.classList.add("hidden-surface");
    item.innerHTML = `<button class="icon-btn eye" title="표시/숨김">${s.visible ? "👁" : "—"}</button>
                      <span class="label">${escapeHtml(s.name)}</span>
                      <span class="kind">${s.type === "mesh" ? "메시" : "쿼드"}</span>`;
    item.addEventListener("click", () => selectSurface(s.id));
    item.querySelector(".eye").addEventListener("click", (e) => {
      e.stopPropagation();
      s.visible = !s.visible;
      renderSurfaceList();
    });
    list.appendChild(item);
  }
}

function renderProperties() {
  const s = selectedSurface();
  const panel = $("#props");
  panel.hidden = !s;
  if (!s) return;

  $("#p_name").value = s.name;

  const mediaSel = $("#p_media");
  mediaSel.innerHTML = state.media
    .map((m) => `<option value="${m.id}" ${m.id === s.mediaId ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");

  $("#meshRow").hidden = s.type !== "mesh";
  if (s.type === "mesh") {
    $("#p_cols").value = s.cols;
    $("#p_rows").value = s.rows;
  }

  const setSlider = (id, val, fmt = (v) => v.toFixed(2)) => {
    $("#p_" + id).value = val;
    $("#o_" + id).textContent = fmt(val);
  };
  setSlider("opacity", s.opacity);
  setSlider("brightness", s.brightness);
  setSlider("contrast", s.contrast);
  setSlider("saturation", s.saturation);
  setSlider("blendL", s.blend.l);
  setSlider("blendR", s.blend.r);
  setSlider("blendT", s.blend.t);
  setSlider("blendB", s.blend.b);
  $("#p_tint").value = s.tint;
}

function bindPropertyEvents() {
  $("#p_name").addEventListener("input", (e) => {
    const s = selectedSurface();
    if (s) { s.name = e.target.value; renderSurfaceList(); }
  });
  $("#p_media").addEventListener("change", (e) => {
    const s = selectedSurface();
    if (s) { s.mediaId = Number(e.target.value); renderMediaList(); }
  });

  const bindSlider = (id, apply) => {
    $("#p_" + id).addEventListener("input", (e) => {
      const s = selectedSurface();
      if (!s) return;
      const v = Number(e.target.value);
      apply(s, v);
      $("#o_" + id).textContent = v.toFixed(2);
    });
  };
  bindSlider("opacity", (s, v) => (s.opacity = v));
  bindSlider("brightness", (s, v) => (s.brightness = v));
  bindSlider("contrast", (s, v) => (s.contrast = v));
  bindSlider("saturation", (s, v) => (s.saturation = v));
  bindSlider("blendL", (s, v) => (s.blend.l = v));
  bindSlider("blendR", (s, v) => (s.blend.r = v));
  bindSlider("blendT", (s, v) => (s.blend.t = v));
  bindSlider("blendB", (s, v) => (s.blend.b = v));

  $("#p_tint").addEventListener("input", (e) => {
    const s = selectedSurface();
    if (s) s.tint = e.target.value;
  });

  const applyMeshRes = () => {
    const s = selectedSurface();
    if (!s || s.type !== "mesh") return;
    const nc = Math.min(12, Math.max(2, Number($("#p_cols").value) || s.cols));
    const nr = Math.min(12, Math.max(2, Number($("#p_rows").value) || s.rows));
    if (nc !== s.cols || nr !== s.rows) resampleMesh(s, nc, nr);
    $("#p_cols").value = s.cols;
    $("#p_rows").value = s.rows;
  };
  $("#p_cols").addEventListener("change", applyMeshRes);
  $("#p_rows").addEventListener("change", applyMeshRes);

  $("#btnResetDst").addEventListener("click", () => {
    const s = selectedSurface();
    if (!s) return;
    const [x, y, w, h] = defaultRect(0);
    if (s.type === "mesh") {
      const fresh = makeMesh(s.cols, s.rows);
      s.points = fresh.points;
    } else {
      s.dst = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
  });
  $("#btnResetSrc").addEventListener("click", () => {
    const s = selectedSurface();
    if (s) s.src = UNIT_SRC();
  });
  $("#btnDelete").addEventListener("click", () => {
    const s = selectedSurface();
    if (s) removeSurface(s.id);
  });
}

/* ============================== 출력 창 ============================== */

function openOutputWindow() {
  if (outputWin && !outputWin.closed) {
    outputWin.focus();
    return;
  }
  outputWin = window.open("", "promapper-output", "width=960,height=540");
  if (!outputWin) {
    alert("팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.");
    return;
  }
  const d = outputWin.document;
  d.title = "ProMapper 출력 — 더블클릭: 전체화면";
  d.body.style.cssText = "margin:0;background:#000;overflow:hidden;cursor:none;";
  const v = d.createElement("video");
  v.muted = true;
  v.autoplay = true;
  v.playsInline = true;
  v.style.cssText = "width:100vw;height:100vh;object-fit:contain;display:block;";
  d.body.appendChild(v);

  if (!outputStream) outputStream = glCanvas.captureStream(60);
  v.srcObject = outputStream;
  v.play().catch(() => {});

  d.body.addEventListener("dblclick", () => {
    if (d.fullscreenElement) d.exitFullscreen();
    else d.documentElement.requestFullscreen().catch(() => {});
  });
}

/* ============================== 저장/불러오기 ============================== */

function serializeProject() {
  return {
    app: "ProMapper",
    version: 1,
    output: { ...state.output },
    media: state.media.map((m) => {
      const base = { id: m.id, name: m.name, kind: m.kind };
      if (m.kind === "pattern") base.patternType = m.patternType;
      if (m.kind === "image" && m.source) {
        const c = document.createElement("canvas");
        c.width = m.source.naturalWidth;
        c.height = m.source.naturalHeight;
        c.getContext("2d").drawImage(m.source, 0, 0);
        base.dataURL = c.toDataURL("image/png");
      }
      // 비디오 파일은 임베드 불가 — 이름만 저장, 불러온 뒤 재연결 필요
      return base;
    }),
    surfaces: state.surfaces,
    nextId,
  };
}

function saveProject() {
  const blob = new Blob([JSON.stringify(serializeProject())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "promapper-project.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadProject(json) {
  for (const m of state.media) renderer.releaseMedia(m.id);
  state.media = [];
  state.surfaces = [];
  state.selectedId = null;

  nextId = json.nextId || 1;
  setOutputSize(json.output.w, json.output.h);
  $("#resSelect").value = `${json.output.w}x${json.output.h}`;

  for (const m of json.media) {
    if (m.kind === "pattern") {
      state.media.push({
        id: m.id, name: m.name, kind: "pattern", patternType: m.patternType,
        source: makePatternCanvas(m.patternType, state.output.w, state.output.h),
      });
    } else if (m.kind === "image" && m.dataURL) {
      const img = new Image();
      const item = { id: m.id, name: m.name, kind: "image", source: null };
      img.onload = () => { item.source = img; item.dirty = true; };
      img.src = m.dataURL;
      state.media.push(item);
    } else {
      // 비디오: 소스 없는 자리표시자 (다시 추가 후 서피스에 할당 필요)
      state.media.push({ id: m.id, name: m.name + " (재연결 필요)", kind: m.kind, source: null });
    }
  }
  state.surfaces = json.surfaces;

  renderMediaList();
  renderSurfaceList();
  renderProperties();
}

/* ============================== 초기화 ============================== */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setMode(mode) {
  state.mode = mode;
  $("#modeOutput").classList.toggle("active", mode === "output");
  $("#modeInput").classList.toggle("active", mode === "input");
  glCanvas.style.visibility = mode === "input" ? "hidden" : "visible";
}

function bindUI() {
  $("#modeOutput").addEventListener("click", () => setMode("output"));
  $("#modeInput").addEventListener("click", () => setMode("input"));

  $("#resSelect").addEventListener("change", (e) => {
    const [w, h] = e.target.value.split("x").map(Number);
    setOutputSize(w, h);
  });

  $("#btnFit").addEventListener("click", fitView);
  $("#btnOutput").addEventListener("click", openOutputWindow);

  $("#btnAddQuad").addEventListener("click", () => addSurface("quad"));
  $("#btnAddMesh").addEventListener("click", () => addSurface("mesh"));

  $("#btnAddMedia").addEventListener("click", () => $("#mediaFile").click());
  $("#mediaFile").addEventListener("change", (e) => {
    for (const f of e.target.files) addFileMedia(f);
    e.target.value = "";
  });

  $("#btnSave").addEventListener("click", saveProject);
  $("#btnLoad").addEventListener("click", () => $("#projectFile").click());
  $("#projectFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      loadProject(JSON.parse(await f.text()));
    } catch (err) {
      alert("프로젝트 파일을 읽을 수 없습니다: " + err.message);
    }
    e.target.value = "";
  });

  bindPropertyEvents();
  bindEditorEvents();

  new ResizeObserver(() => {
    resizeOverlay();
  }).observe(editorEl);
  window.addEventListener("resize", resizeOverlay);
}

function loop() {
  renderer.render(state, mediaById);
  drawOverlay();
  requestAnimationFrame(loop);
}

function init() {
  glCanvas = $("#gl");
  overlay = $("#overlay");
  octx = overlay.getContext("2d");
  editorEl = $("#editor");

  renderer = new Renderer(glCanvas);

  resizeOverlay();
  setOutputSize(1920, 1080);

  // 기본 미디어 + 첫 서피스
  addPatternMedia("grid");
  addPatternMedia("checker");
  addPatternMedia("colorbars");
  addPatternMedia("gradient");
  addPatternMedia("white");
  addSurface("quad");

  bindUI();
  fitView();
  loop();
}

window.addEventListener("DOMContentLoaded", init);
