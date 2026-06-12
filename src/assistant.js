import { PROJECTOR_SPECS, getSpec } from './presets.js';

export const MAX_PROJECTORS = 8;

// 투사면 크기 + 목표 품질(픽셀 밀도/조도) → 필요 대수와 배치를 산출
export function computePlan(input) {
  const { W, H, spec, throwRatio, overlap: ov, targetPxm, ambientLux, maxThrow } = input;
  const aspect = spec.resX / spec.resY;
  const notes = [];

  // 행 수를 늘려가며 목표 픽셀 밀도를 만족하는 최소 분할 탐색
  let chosen = null;
  for (let rows = 1; rows <= 4; rows++) {
    const h = H / (rows * (1 - ov) + ov);
    const w = h * aspect;
    const cols = Math.max(1, Math.ceil((W / w - ov) / (1 - ov) - 1e-6));
    chosen = { rows, cols, w, h, pxm: spec.resY / h };
    if (chosen.pxm >= targetPxm) break;
  }
  if (chosen.pxm < targetPxm) {
    notes.push({ level: 'bad', text: '4단 분할로도 목표 픽셀 밀도에 미달합니다. 더 높은 해상도 기종을 검토하세요.' });
  }

  // 투사거리: 지정 스로우비 기준, 공간 깊이를 초과하면 광각(최소 TR)으로 보정
  let tr = throwRatio;
  let dist = tr * chosen.w;
  if (maxThrow && dist > maxThrow) {
    tr = spec.tr[0];
    dist = tr * chosen.w;
    if (dist > maxThrow) {
      notes.push({ level: 'bad', text: `최소 스로우비(${tr})로도 필요 투사거리 ${dist.toFixed(1)}m가 가용 깊이 ${maxThrow.toFixed(1)}m를 초과합니다. 단초점(UST) 기종 또는 미러 폴딩이 필요합니다.` });
    } else {
      notes.push({ level: 'warn', text: `공간 깊이에 맞춰 스로우비를 최소값 ${tr}으로 조정했습니다.` });
    }
  }

  // 밝기: 화이트 전체 기준 표면 조도와 주변광 대비 명암비
  const lux = spec.lumens / (chosen.w * chosen.h);
  const contrast = (lux + ambientLux) / Math.max(ambientLux, 1);
  let grade;
  if (contrast >= 15) grade = { level: 'good', text: `우수 (${contrast.toFixed(1)} : 1)` };
  else if (contrast >= 7) grade = { level: 'good', text: `양호 (${contrast.toFixed(1)} : 1)` };
  else if (contrast >= 3) grade = { level: 'warn', text: `보통 (${contrast.toFixed(1)} : 1) — 콘텐츠 시인성 저하 가능` };
  else grade = { level: 'bad', text: `부족 (${contrast.toFixed(1)} : 1) — 더 밝은 기종/스택 또는 차광 필요` };
  if (contrast < 7) {
    notes.push({ level: 'warn', text: '명암비가 낮습니다. 동일 위치 2대 스택(밝기 2배) 또는 고휘도 기종을 검토하세요.' });
  }

  const total = chosen.rows * chosen.cols;
  if (total > MAX_PROJECTORS) {
    notes.push({ level: 'warn', text: `필요 대수 ${total}대 중 시뮬레이터에는 최대 ${MAX_PROJECTORS}대까지만 배치됩니다.` });
  }

  // 실제 커버 폭 대비 여유/부족
  const span = chosen.w * (chosen.cols * (1 - ov) + ov);
  const over = ((span - W) / W) * 100;

  return { ...chosen, tr, dist, lux, contrast, grade, total, span, over, notes, ov, spec };
}

// ---------------- 모달 UI ----------------

export function setupAssistant(app) {
  const backdrop = document.getElementById('modal-backdrop');
  const body = document.getElementById('assistant-body');

  function close() {
    backdrop.hidden = true;
  }

  function open() {
    const target = app.env.getTarget();
    body.innerHTML = '';

    const form = document.createElement('div');
    form.innerHTML = `
      <div class="prop-row"><label>투사면</label><span style="color:var(--text-dim)">${target.label}</span></div>
      <div class="prop-row"><label>면 폭 (m)</label><input type="number" id="as-w" value="${target.width.toFixed(1)}" step="0.5" min="1"></div>
      <div class="prop-row"><label>면 높이 (m)</label><input type="number" id="as-h" value="${target.height.toFixed(1)}" step="0.5" min="1"></div>
      <hr class="sep">
      <div class="prop-row"><label>프로젝터 기종</label>
        <select id="as-spec">${PROJECTOR_SPECS.filter(s => s.id !== 'custom').map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
      </div>
      <div class="prop-row"><label>스로우비</label><input type="number" id="as-tr" step="0.1" min="0.2" max="4"></div>
      <div class="prop-row"><label>블렌딩 오버랩 (%)</label><input type="number" id="as-ov" value="15" step="5" min="0" max="40"></div>
      <hr class="sep">
      <div class="prop-row"><label>목표 픽셀 밀도</label><input type="number" id="as-pxm" value="40" step="5" min="5"> <span style="color:var(--text-dim)">px/m</span></div>
      <div class="prop-row"><label>주변광 환경</label>
        <select id="as-amb">
          <option value="10">어두운 실내/야간 (10 lx)</option>
          <option value="50" selected>조명 약한 행사장 (50 lx)</option>
          <option value="150">일반 사무 조명 (150 lx)</option>
          <option value="400">밝은 로비/주간 (400 lx)</option>
        </select>
      </div>
      <div class="btn-row">
        <button id="as-calc" class="primary">계산</button>
        <button id="as-close">닫기</button>
      </div>
      <div id="as-result"></div>
    `;
    body.appendChild(form);

    const specSel = form.querySelector('#as-spec');
    const trInput = form.querySelector('#as-tr');
    const syncTr = () => {
      const s = getSpec(specSel.value);
      trInput.value = ((s.tr[0] + s.tr[1]) / 2).toFixed(2);
    };
    specSel.addEventListener('change', syncTr);
    syncTr();

    form.querySelector('#as-close').addEventListener('click', close);
    form.querySelector('#as-calc').addEventListener('click', () => {
      const spec = getSpec(specSel.value);
      const plan = computePlan({
        W: parseFloat(form.querySelector('#as-w').value) || target.width,
        H: parseFloat(form.querySelector('#as-h').value) || target.height,
        spec,
        throwRatio: parseFloat(trInput.value) || (spec.tr[0] + spec.tr[1]) / 2,
        overlap: (parseFloat(form.querySelector('#as-ov').value) || 0) / 100,
        targetPxm: parseFloat(form.querySelector('#as-pxm').value) || 40,
        ambientLux: parseFloat(form.querySelector('#as-amb').value),
        maxThrow: target.maxThrow
      });
      renderResult(form.querySelector('#as-result'), plan, spec);
    });

    backdrop.hidden = false;
  }

  function renderResult(el, plan, spec) {
    const noteHtml = plan.notes
      .map((n) => `<div class="${n.level}">⚠ ${n.text}</div>`)
      .join('');
    el.innerHTML = `
      <div class="assist-result">
        <h5>권장 구성: ${plan.cols} × ${plan.rows} = 총 ${plan.total}대</h5>
        <div>기종: ${spec.name}</div>
        <div>대당 화면: ${plan.w.toFixed(2)} × ${plan.h.toFixed(2)} m (오버랩 ${(plan.ov * 100).toFixed(0)}%)</div>
        <div>커버 폭: ${plan.span.toFixed(1)} m (${plan.over >= 0 ? '+' : ''}${plan.over.toFixed(0)}% ${plan.over >= 0 ? '여유' : '부족'})</div>
        <div>투사거리: ${plan.dist.toFixed(2)} m (TR ${plan.tr.toFixed(2)})</div>
        <div>픽셀 밀도: ${plan.pxm.toFixed(0)} px/m</div>
        <div>표면 조도: ${plan.lux.toFixed(0)} lx · 명암비 <span class="${plan.grade.level}">${plan.grade.text}</span></div>
        ${noteHtml}
        <div class="btn-row">
          <button id="as-apply" class="primary">이 배치를 3D 장면에 적용 (기존 교체)</button>
        </div>
      </div>
    `;
    el.querySelector('#as-apply').addEventListener('click', () => {
      app.applyPlan(plan);
      close();
    });
  }

  document.getElementById('btn-assistant').addEventListener('click', open);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
}
