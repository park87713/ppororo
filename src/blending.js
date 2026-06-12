import * as THREE from 'three';

// 프로젝터 쌍별 엣지 블렌딩(오버랩) 실측 분석
// 각 프로젝터 이미지에서 광선 그리드를 쏘아 실제 표면 도달점을 구하고,
// 그 점이 상대 프로젝터의 프러스텀 안에 들어가는지로 오버랩 밴드를 측정한다.
// (평면·곡면·오브젝트 등 모든 지오메트리에서 동일하게 동작)

const NU = 48; // 가로 샘플 (해상도 ≈ 2%)
const NV = 9;  // 세로 샘플

export function computeBlendAnalysis(app) {
  const meshes = app.receiverMeshes;
  const ons = app.projectors.filter((p) => p.data.on);
  if (ons.length < 2) return { pairs: [], count: ons.length };

  // 1) 프로젝터별 이미지 그리드 → 표면 도달점 샘플
  const ray = new THREE.Raycaster();
  ray.layers.set(0);
  ray.far = 1000;
  const samples = new Map();
  for (const p of ons) {
    p.group.updateMatrixWorld(true);
    const cam = p.camera;
    const origin = p.worldPosition();
    const pts = [];
    for (let iu = 0; iu < NU; iu++) {
      for (let iv = 0; iv < NV; iv++) {
        const u = (iu + 0.5) / NU;
        const v = (iv + 0.5) / NV;
        const pw = new THREE.Vector3(u * 2 - 1, v * 2 - 1, 0.5)
          .applyMatrix4(cam.projectionMatrixInverse)
          .applyMatrix4(cam.matrixWorld);
        ray.set(origin, pw.sub(origin).normalize());
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) pts.push({ u, v, point: hit.point });
      }
    }
    samples.set(p, pts);
  }

  // 2) 방향별 커버 측정: a 의 샘플 중 b 프러스텀에 들어가는 영역
  const vp = new THREE.Matrix4();
  const clip = new THREE.Vector4();
  function coverOf(a, b) {
    b.camera.matrixWorldInverse.copy(b.camera.matrixWorld).invert();
    vp.multiplyMatrices(b.camera.projectionMatrix, b.camera.matrixWorldInverse);
    let covered = 0;
    let uMin = 1, uMax = 0, vMin = 1, vMax = 0;
    const pts = samples.get(a);
    for (const s of pts) {
      clip.set(s.point.x, s.point.y, s.point.z, 1).applyMatrix4(vp);
      if (clip.w <= 0) continue;
      const x = clip.x / clip.w;
      const y = clip.y / clip.w;
      const z = clip.z / clip.w;
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1) {
        covered++;
        uMin = Math.min(uMin, s.u); uMax = Math.max(uMax, s.u);
        vMin = Math.min(vMin, s.v); vMax = Math.max(vMax, s.v);
      }
    }
    if (!covered || !pts.length) return null;
    const frac = covered / pts.length;
    const uSpan = uMax - uMin, vSpan = vMax - vMin;
    // 방향/밴드 판정
    let dir, bandFrac, axis;
    if (frac > 0.7) {
      dir = 'stack'; bandFrac = frac; axis = 'h';
    } else if (vSpan >= 0.6 && uSpan < 0.97) {
      axis = 'h';
      if (uMax > 0.96) { dir = 'right'; bandFrac = 1 - uMin; }
      else if (uMin < 0.04) { dir = 'left'; bandFrac = uMax; }
      else { dir = 'inner'; bandFrac = uSpan; }
    } else if (uSpan >= 0.6) {
      axis = 'v';
      if (vMax > 0.96) { dir = 'top'; bandFrac = 1 - vMin; }
      else if (vMin < 0.05) { dir = 'bottom'; bandFrac = vMax; }
      else { dir = 'inner'; bandFrac = vSpan; }
    } else {
      dir = 'corner'; bandFrac = frac; axis = 'h';
    }
    return { dir, axis, frac: bandFrac, areaFrac: frac };
  }

  // 3) 쌍별 결합 (양방향 측정 → 하나의 리포트)
  const pairs = [];
  for (let i = 0; i < ons.length; i++) {
    for (let j = i + 1; j < ons.length; j++) {
      const a = ons[i], b = ons[j];
      const ab = coverOf(a, b);
      const ba = coverOf(b, a);
      if (!ab || !ba) continue;
      const mA = a.computeMetrics(meshes);
      const axis = ab.axis;
      const resA = axis === 'h' ? a.data.resX : a.data.resY;
      const resB = axis === 'h' ? b.data.resX : b.data.resY;
      const sizeA = mA ? (axis === 'h' ? mA.w : mA.h) : 0;
      pairs.push({
        a, b,
        stack: ab.dir === 'stack' || ba.dir === 'stack',
        corner: ab.dir === 'corner' && ba.dir === 'corner',
        axis,
        dirA: ab.dir,
        fracA: ab.frac,
        fracB: ba.frac,
        pxA: Math.round(ab.frac * resA),
        pxB: Math.round(ba.frac * resB),
        meters: sizeA * ab.frac
      });
    }
  }
  return { pairs, count: ons.length };
}

function gradeOf(p) {
  const f = Math.min(p.fracA, p.fracB);
  const px = Math.min(p.pxA, p.pxB);
  if (p.stack) return { level: 'good', text: '스택(이중 투사) — 밝기 2배 구성' };
  if (p.corner) return { level: 'warn', text: '모서리/대각 중첩 — 격자 배치 확인 필요' };
  if (f > 0.32) return { level: 'warn', text: '오버랩 과다 — 유효 해상도 손실 큼, 간격을 넓히세요' };
  if (f >= 0.10 || px >= 240) return { level: 'good', text: '양호 (권장 10~25%)' };
  if (f >= 0.05) return { level: 'warn', text: '최소 수준 — 블렌드 품질 저하 가능, 10% 이상 권장' };
  return { level: 'bad', text: '부족 — 심(seam)이 보일 수 있음, 간격을 좁히세요' };
}

const DIR_LABEL = {
  left: '좌측', right: '우측', top: '상단', bottom: '하단',
  inner: '내부', stack: '전면', corner: '모서리'
};

// ---------------- 모달 UI ----------------

export function setupBlendPanel(app) {
  const backdrop = document.getElementById('modal-backdrop');
  const assistantModal = document.getElementById('assistant-modal');
  const modal = document.getElementById('blend-modal');
  const body = document.getElementById('blend-body');

  function close() {
    backdrop.hidden = true;
    modal.hidden = true;
    assistantModal.hidden = false;
  }

  function open() {
    const { pairs, count } = computeBlendAnalysis(app);
    body.innerHTML = '';

    if (count < 2) {
      body.innerHTML = '<div class="assist-result">켜져 있는 프로젝터가 2대 이상이어야 분석할 수 있습니다.</div>';
    } else if (!pairs.length) {
      body.innerHTML = '<div class="assist-result">중첩되는 프로젝터 쌍이 없습니다.<br>화면이 겹치도록 배치하면 블렌드 영역이 분석됩니다.</div>';
    } else {
      for (const p of pairs) {
        const g = gradeOf(p);
        const div = document.createElement('div');
        div.className = 'assist-result';
        const axisLabel = p.stack ? '' : p.corner ? '' : p.axis === 'h' ? '수평' : '수직';
        div.innerHTML = `
          <h5>${p.a.data.name} ↔ ${p.b.data.name} ${axisLabel ? `· ${axisLabel} 오버랩` : ''}</h5>
          <div>오버랩 폭: <b>${p.meters.toFixed(2)} m</b></div>
          <div>${p.a.data.name} 기준: ${(p.fracA * 100).toFixed(1)}% · <b>${p.pxA}px</b> (${DIR_LABEL[p.dirA]} 에지부터)</div>
          <div>${p.b.data.name} 기준: ${(p.fracB * 100).toFixed(1)}% · <b>${p.pxB}px</b></div>
          <div>평가: <span class="${g.level}">${g.text}</span></div>
        `;
        body.appendChild(div);
      }
      // 측정 기반 램프 적용
      const blendPairs = pairs.filter((p) => !p.stack && !p.corner);
      if (blendPairs.length) {
        const avg = blendPairs.reduce((s, p) => s + (p.fracA + p.fracB) / 2, 0) / blendPairs.length;
        const rampPct = Math.round(THREE.MathUtils.clamp(avg * 100, 2, 30));
        const foot = document.createElement('div');
        foot.className = 'btn-row';
        foot.innerHTML = `<button id="blend-apply" class="primary">측정 평균 ${(avg * 100).toFixed(1)}% → 블렌드 램프 ${rampPct}% 적용</button>
          <button id="blend-close2">닫기</button>`;
        body.appendChild(foot);
        foot.querySelector('#blend-apply').addEventListener('click', () => {
          app.manager.globals.uBlendRamp.value = rampPct / 100;
          document.getElementById('blend-toggle').checked = true;
          document.getElementById('blend-ramp').value = rampPct;
          close();
        });
        foot.querySelector('#blend-close2').addEventListener('click', close);
      }
      const tip = document.createElement('div');
      tip.className = 'help-text';
      tip.style.marginTop = '10px';
      tip.innerHTML = '픽셀 값은 미디어 서버/프로젝터의 블렌드 영역 설정에 그대로 사용합니다.<br>실무 권장: 오버랩 10~25%, 감마 보정 블렌드 곡선(γ≈2.2) 적용.';
      body.appendChild(tip);
    }

    assistantModal.hidden = true;
    modal.hidden = false;
    backdrop.hidden = false;
  }

  document.getElementById('btn-blend-calc').addEventListener('click', open);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
}
