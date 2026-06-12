import { PROJECTOR_SPECS, getSpec } from './presets.js';
import { OBJECT_TYPES } from './objects.js';

// DOM 패널/툴바와 앱 상태를 연결한다.
export function setupUI(app) {
  const ui = {
    listEl: document.getElementById('projector-list'),
    propsBody: document.getElementById('props-body'),
    propsEmpty: document.getElementById('props-empty'),
    envControls: document.getElementById('env-controls'),
    metricSummary: document.getElementById('metric-summary'),
    metricDetail: document.getElementById('metric-detail'),
    propsBuiltFor: null,
    fields: {}
  };

  // ---------- 툴바 ----------
  const envSelect = document.getElementById('env-preset');
  envSelect.addEventListener('change', () => {
    app.setEnvironment(envSelect.value);
  });

  document.querySelectorAll('#view-mode button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-mode button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      app.manager.globals.uViewMode.value = parseInt(btn.dataset.mode, 10);
    });
  });

  document.getElementById('pattern-select').addEventListener('change', (e) => {
    app.manager.globals.uPattern.value = parseInt(e.target.value, 10);
  });

  const blendToggle = document.getElementById('blend-toggle');
  const blendRamp = document.getElementById('blend-ramp');
  const syncBlend = () => {
    app.manager.globals.uBlendRamp.value = blendToggle.checked ? blendRamp.value / 100 : 0;
  };
  blendToggle.addEventListener('change', syncBlend);
  blendRamp.addEventListener('input', syncBlend);

  document.getElementById('btn-add-projector').addEventListener('click', () => app.addProjector());
  document.getElementById('btn-add-object').addEventListener('click', () => {
    app.addObject(document.getElementById('obj-type').value);
  });
  const modelInput = document.getElementById('model-input');
  document.getElementById('btn-add-model').addEventListener('click', () => modelInput.click());
  modelInput.addEventListener('change', () => {
    const f = modelInput.files[0];
    if (f) app.importModelFile(f);
    modelInput.value = '';
  });
  document.getElementById('btn-save').addEventListener('click', () => app.saveToFile());
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('현재 장면을 버리고 기본 장면으로 초기화할까요?')) app.resetDefault();
  });

  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-load').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    f.text().then((t) => {
      try {
        app.loadProject(JSON.parse(t));
      } catch {
        alert('프로젝트 파일을 읽을 수 없습니다.');
      }
    });
    fileInput.value = '';
  });

  // ---------- 모바일 드로어 / 뷰포트 툴 ----------
  const leftPanel = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  ui.isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  const syncBackdrop = () => {
    drawerBackdrop.hidden = !(leftPanel.classList.contains('open') || rightPanel.classList.contains('open'));
  };
  ui.closeDrawers = () => {
    leftPanel.classList.remove('open');
    rightPanel.classList.remove('open');
    syncBackdrop();
  };
  ui.openDrawer = (side) => {
    leftPanel.classList.toggle('open', side === 'left');
    rightPanel.classList.toggle('open', side === 'right');
    syncBackdrop();
  };
  document.getElementById('btn-panel-left').addEventListener('click', () => {
    leftPanel.classList.contains('open') ? ui.closeDrawers() : ui.openDrawer('left');
  });
  document.getElementById('btn-panel-right').addEventListener('click', () => {
    rightPanel.classList.contains('open') ? ui.closeDrawers() : ui.openDrawer('right');
  });
  drawerBackdrop.addEventListener('click', ui.closeDrawers);

  const vtMove = document.getElementById('vt-move');
  const vtRotate = document.getElementById('vt-rotate');
  ui.syncGizmoButtons = (mode) => {
    vtMove.classList.toggle('active', mode === 'translate');
    vtRotate.classList.toggle('active', mode === 'rotate');
  };
  vtMove.addEventListener('click', () => app.setGizmoMode('translate'));
  vtRotate.addEventListener('click', () => app.setGizmoMode('rotate'));
  document.getElementById('vt-aim').addEventListener('click', () => app.aimSelectedAtTarget());

  // ---------- 프로젝터 리스트 ----------
  ui.refreshList = () => {
    ui.listEl.innerHTML = '';
    for (const p of app.projectors) {
      const li = document.createElement('li');
      if (p.data.id === app.selectedId) li.classList.add('selected');
      li.innerHTML = `
        <span class="dot" style="background:${p.data.color}"></span>
        <span class="name">${p.data.name}<br><span class="sub">${getSpec(p.data.specId).name}</span></span>
        <span class="pwr ${p.data.on ? '' : 'off'}">${p.data.on ? 'ON' : 'OFF'}</span>
      `;
      li.addEventListener('click', () => {
        app.select(p.data.id);
        // 모바일: 목록에서 고르면 바로 속성 드로어로 전환
        if (ui.isMobile()) ui.openDrawer('right');
      });
      ui.listEl.appendChild(li);
    }
    syncSummary();
  };

  function syncSummary() {
    const objPart = app.objects.length ? ` · 오브젝트 ${app.objects.length}개` : '';
    ui.metricSummary.textContent = `프로젝터 ${app.projectors.length}대${objPart}`;
  }

  // ---------- 오브젝트 리스트 ----------
  ui.refreshObjectList = () => {
    const el = document.getElementById('object-list');
    el.innerHTML = '';
    if (!app.objects.length) {
      el.innerHTML = '<li class="empty-hint" style="cursor:default;border:none;background:none">위 ＋ 버튼으로 매핑 대상 오브젝트를 추가하세요</li>';
    }
    for (const o of app.objects) {
      const li = document.createElement('li');
      if (o.data.id === app.selectedObjectId) li.classList.add('selected');
      const typeName = o.data.type === 'model' ? '모델' : OBJECT_TYPES[o.data.type].name;
      li.innerHTML = `
        <span class="dot" style="background:${o.data.color || '#9aa1ac'}"></span>
        <span class="name">${o.data.name} <span class="sub">${typeName}</span></span>
      `;
      li.addEventListener('click', () => {
        app.selectObject(o.data.id);
        if (ui.isMobile()) ui.openDrawer('right');
      });
      el.appendChild(li);
    }
    syncSummary();
  };

  // ---------- 환경 패널 ----------
  ui.refreshEnvPanel = () => {
    envSelect.value = app.env.preset;
    ui.envControls.innerHTML = '';
    for (const s of app.env.paramSchema()) {
      const row = document.createElement('div');
      row.className = 'prop-row';
      row.innerHTML = `
        <label>${s.label}</label>
        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${app.env.params[s.key]}">
        <span class="val">${app.env.params[s.key]}</span>
      `;
      const range = row.querySelector('input');
      const val = row.querySelector('.val');
      range.addEventListener('input', () => {
        val.textContent = range.value;
        app.env.setParams({ [s.key]: parseFloat(range.value) });
        app.manager.markDirty();
        app.scheduleAutosave();
      });
      ui.envControls.appendChild(row);
    }
    // 주변광
    const amb = document.createElement('div');
    amb.className = 'prop-row';
    amb.innerHTML = `
      <label title="장면의 주변광 수준 — 투사 영상의 체감 명암비에 영향">주변광</label>
      <input type="range" min="0" max="100" step="1" value="${Math.round(app.manager.globals.uAmbient.value * 100)}">
      <span class="val">${Math.round(app.manager.globals.uAmbient.value * 100)}%</span>
    `;
    const ambRange = amb.querySelector('input');
    const ambVal = amb.querySelector('.val');
    ambRange.addEventListener('input', () => {
      ambVal.textContent = `${ambRange.value}%`;
      app.manager.globals.uAmbient.value = ambRange.value / 100;
      app.scheduleAutosave();
    });
    ui.envControls.appendChild(amb);
  };

  // ---------- 속성 패널 ----------
  function row(labelText, inputEl, title) {
    const div = document.createElement('div');
    div.className = 'prop-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    if (title) label.title = title;
    div.appendChild(label);
    div.appendChild(inputEl);
    return div;
  }

  function numInput(value, step, onChange) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    input.value = round3(value);
    input.addEventListener('change', () => onChange(parseFloat(input.value) || 0));
    return input;
  }

  function sliderRow(labelText, min, max, step, value, fmt, onChange, title) {
    const div = document.createElement('div');
    div.className = 'prop-row';
    div.innerHTML = `<label${title ? ` title="${title}"` : ''}>${labelText}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><span class="val"></span>`;
    const range = div.querySelector('input');
    const val = div.querySelector('.val');
    const sync = () => { val.textContent = fmt(parseFloat(range.value)); };
    range.addEventListener('input', () => { sync(); onChange(parseFloat(range.value)); });
    sync();
    return { el: div, range, sync };
  }

  ui.refreshProps = (force = false) => {
    const p = app.selectedProjector();
    const o = app.selectedObject();
    if (!p && !o) {
      ui.propsEmpty.hidden = false;
      ui.propsBody.hidden = true;
      ui.propsBuiltFor = null;
      return;
    }
    ui.propsEmpty.hidden = true;
    ui.propsBody.hidden = false;

    if (o) {
      const key = `obj:${o.data.id}:${o.data.type}`;
      if (!force && ui.propsBuiltFor === key) {
        updatePoseFields(o.data);
        return;
      }
      ui.propsBuiltFor = key;
      buildObjectProps(o);
      return;
    }

    const key = `${p.data.id}:${p.data.specId}`;
    if (!force && ui.propsBuiltFor === key) {
      updatePoseFields(p.data);
      return;
    }
    ui.propsBuiltFor = key;
    buildProps(p);
  };

  function buildProps(p) {
    const d = p.data;
    const spec = getSpec(d.specId);
    ui.propsBody.innerHTML = '';
    ui.fields = {};

    // --- 일반 ---
    const g1 = group('일반');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = d.name;
    nameInput.addEventListener('change', () => {
      d.name = nameInput.value || d.name;
      p.syncFromData();
      ui.refreshList();
      app.scheduleAutosave();
    });
    g1.appendChild(row('이름', nameInput));

    const specSel = document.createElement('select');
    specSel.innerHTML = PROJECTOR_SPECS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    specSel.value = d.specId;
    specSel.addEventListener('change', () => app.changeSpec(d.id, specSel.value));
    g1.appendChild(row('기종', specSel));

    const lm = numInput(d.lumens, 100, (v) => { d.lumens = Math.max(100, v); app.touch(); });
    g1.appendChild(row('밝기 (lm)', lm, 'ANSI 루멘 — 표면 조도 계산에 사용'));

    const resWrap = document.createElement('div');
    resWrap.className = 'prop-row3';
    const rx = numInput(d.resX, 1, (v) => { d.resX = Math.max(16, Math.round(v)); app.touch(); p.syncFromData(); });
    const ry = numInput(d.resY, 1, (v) => { d.resY = Math.max(16, Math.round(v)); app.touch(); p.syncFromData(); });
    resWrap.appendChild(rx);
    resWrap.appendChild(ry);
    g1.appendChild(row('해상도', resWrap));

    const onChk = document.createElement('input');
    onChk.type = 'checkbox';
    onChk.checked = d.on;
    onChk.addEventListener('change', () => { d.on = onChk.checked; app.touch(); ui.refreshList(); });
    g1.appendChild(row('전원', onChk));

    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = d.color;
    colorIn.addEventListener('input', () => { d.color = colorIn.value; p.syncFromData(); app.touch(); ui.refreshList(); });
    g1.appendChild(row('구분 색상', colorIn));

    // --- 위치 / 회전 ---
    const g2 = group('위치 · 회전');
    const posWrap = document.createElement('div');
    posWrap.className = 'prop-row3';
    ui.fields.pos = [0, 1, 2].map((i) => {
      const input = numInput(d.position[i], 0.1, (v) => {
        d.position[i] = v;
        p.syncFromData();
        app.touch();
      });
      posWrap.appendChild(input);
      return input;
    });
    g2.appendChild(row('위치 XYZ (m)', posWrap));

    const rotWrap = document.createElement('div');
    rotWrap.className = 'prop-row3';
    ui.fields.rot = ['pan', 'tilt', 'roll'].map((k) => {
      const input = numInput(d[k], 0.5, (v) => {
        d[k] = v;
        p.syncFromData();
        app.touch();
      });
      rotWrap.appendChild(input);
      return input;
    });
    g2.appendChild(row('팬/틸트/롤 (°)', rotWrap));

    // --- 렌즈 ---
    const g3 = group('렌즈');
    const trRange = spec.id === 'custom' ? [0.25, 15.0] : spec.tr;
    const fixedTr = Math.abs(trRange[0] - trRange[1]) < 1e-6;
    const trSlider = sliderRow(
      '스로우비', fixedTr ? trRange[0] * 0.99 : trRange[0], fixedTr ? trRange[0] * 1.01 : trRange[1], 0.01,
      d.throwRatio, (v) => v.toFixed(2),
      (v) => { d.throwRatio = v; p.syncFromData(); app.touch(); },
      '투사거리 ÷ 화면폭 — 줌 렌즈 가동 범위 내 조정'
    );
    g3.appendChild(trSlider.el);
    ui.fields.tr = trSlider;

    const sv = sliderRow(
      'V 시프트', -spec.shiftV * 100, spec.shiftV * 100, 1,
      d.shiftV * 100, (v) => `${v.toFixed(0)}%`,
      (v) => { d.shiftV = v / 100; p.syncFromData(); app.touch(); },
      '수직 렌즈 시프트 — 본체 각도를 바꾸지 않고 화면을 상하 이동(키스톤 없음)'
    );
    g3.appendChild(sv.el);
    const sh = sliderRow(
      'H 시프트', -spec.shiftH * 100, spec.shiftH * 100, 1,
      d.shiftH * 100, (v) => `${v.toFixed(0)}%`,
      (v) => { d.shiftH = v / 100; p.syncFromData(); app.touch(); },
      '수평 렌즈 시프트'
    );
    g3.appendChild(sh.el);

    // --- 동작 버튼 ---
    const g4 = group('동작');
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    const aimBtn = document.createElement('button');
    aimBtn.textContent = '타깃 정조준';
    aimBtn.title = '주 투사면 중심을 향해 팬/틸트 자동 설정';
    aimBtn.addEventListener('click', () => app.aimSelectedAtTarget());
    const dupBtn = document.createElement('button');
    dupBtn.textContent = '복제';
    dupBtn.addEventListener('click', () => app.duplicateProjector(d.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => app.removeProjector(d.id));
    btns.append(aimBtn, dupBtn, delBtn);
    g4.appendChild(btns);

    // --- 측정값 ---
    const g5 = group('투사 분석');
    const box = document.createElement('div');
    box.className = 'metrics-box';
    box.id = 'metrics-box';
    g5.appendChild(box);
    ui.fields.metrics = box;

    function group(title) {
      const div = document.createElement('div');
      div.className = 'prop-group';
      div.innerHTML = `<h4>${title}</h4>`;
      ui.propsBody.appendChild(div);
      return div;
    }
  }

  function buildObjectProps(o) {
    const d = o.data;
    const isModel = d.type === 'model';
    const typeDef = isModel ? null : OBJECT_TYPES[d.type];
    ui.propsBody.innerHTML = '';
    ui.fields = {};

    const group = (title) => {
      const div = document.createElement('div');
      div.className = 'prop-group';
      div.innerHTML = `<h4>${title}</h4>`;
      ui.propsBody.appendChild(div);
      return div;
    };

    // --- 일반 ---
    const g1 = group(isModel ? `모델 — ${d.fileName}` : `오브젝트 — ${typeDef.name}`);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = d.name;
    nameInput.addEventListener('change', () => {
      d.name = nameInput.value || d.name;
      ui.refreshObjectList();
      app.scheduleAutosave();
    });
    g1.appendChild(row('이름', nameInput));

    if (!isModel) {
      const colorIn = document.createElement('input');
      colorIn.type = 'color';
      colorIn.value = d.color;
      colorIn.addEventListener('input', () => {
        d.color = colorIn.value;
        o.mesh.material?.uniforms?.uBaseColor?.value.set(d.color);
        app.touch();
        ui.refreshObjectList();
      });
      g1.appendChild(row('표면 색상', colorIn, '투사면의 반사 기본색 — 밝을수록 영상이 잘 보입니다'));
    }

    // --- 크기 ---
    const g2 = group('크기');
    if (isModel) {
      const sizeInput = numInput(d.targetSize, 0.1, (v) => {
        d.targetSize = Math.max(0.1, v);
        o.applyScale();
        app.touch();
      });
      g2.appendChild(row('최대 변 (m)', sizeInput, '모델의 가장 긴 변을 이 길이에 맞춰 균일 스케일'));
    } else {
      for (const param of typeDef.params) {
        const input = numInput(d.size[param.key], 0.1, (v) => {
          o.setSize({ [param.key]: Math.max(param.min, v) });
          app.touch();
        });
        g2.appendChild(row(param.label, input));
      }
    }

    // --- 위치 / 회전 ---
    const g3 = group('위치 · 회전');
    const posWrap = document.createElement('div');
    posWrap.className = 'prop-row3';
    ui.fields.pos = [0, 1, 2].map((i) => {
      const input = numInput(d.position[i], 0.1, (v) => {
        d.position[i] = v;
        o.syncFromData();
        app.touch();
      });
      posWrap.appendChild(input);
      return input;
    });
    g3.appendChild(row('위치 XYZ (m)', posWrap));

    const rotWrap = document.createElement('div');
    rotWrap.className = 'prop-row3';
    ui.fields.rot = ['pan', 'tilt', 'roll'].map((k) => {
      const input = numInput(d[k], 1, (v) => {
        d[k] = v;
        o.syncFromData();
        app.touch();
      });
      rotWrap.appendChild(input);
      return input;
    });
    g3.appendChild(row('회전 Y/X/Z (°)', rotWrap));

    // --- 동작 ---
    const g4 = group('동작');
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    const dupBtn = document.createElement('button');
    dupBtn.textContent = '복제';
    dupBtn.addEventListener('click', () => app.duplicateObject(d.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => app.removeObject(d.id));
    btns.append(dupBtn, delBtn);
    g4.appendChild(btns);
  }

  function updatePoseFields(d) {
    if (ui.fields.pos) {
      ui.fields.pos.forEach((input, i) => {
        if (document.activeElement !== input) input.value = round3(d.position[i]);
      });
    }
    if (ui.fields.rot) {
      const vals = [d.pan, d.tilt, d.roll];
      ui.fields.rot.forEach((input, i) => {
        if (document.activeElement !== input) input.value = round3(vals[i]);
      });
    }
  }

  // ---------- 측정값 표시 ----------
  ui.refreshMetrics = () => {
    const p = app.selectedProjector();
    if (!p) {
      ui.metricDetail.textContent = '';
      return;
    }
    const m = p.computeMetrics(app.receiverMeshes);
    const box = ui.fields.metrics;
    if (!m) {
      ui.metricDetail.textContent = `${p.data.name}: 투사면에 닿지 않음`;
      if (box) box.innerHTML = '<div class="m-row"><span>상태</span><span class="warn">광축이 투사면에 닿지 않음</span></div>';
      return;
    }
    const ambLux = app.manager.globals.uAmbient.value * 400 + 5;
    const contrast = (m.lux + ambLux) / ambLux;
    const cClass = contrast >= 7 ? 'good' : contrast >= 3 ? 'warn' : 'bad';
    const cText = contrast > 99 ? '99+ : 1' : `${contrast.toFixed(1)} : 1`;
    ui.metricDetail.textContent =
      `${p.data.name} · 투사거리 ${m.dist.toFixed(2)}m · 화면 ${m.w.toFixed(2)}×${m.h.toFixed(2)}m · ${m.pxPerM.toFixed(0)}px/m · ${m.lux.toFixed(0)}lx`;
    if (box) {
      box.innerHTML = `
        <div class="m-row"><span>투사거리</span><span>${m.dist.toFixed(2)} m</span></div>
        <div class="m-row"><span>화면 크기</span><span>${m.w.toFixed(2)} × ${m.h.toFixed(2)} m</span></div>
        <div class="m-row"><span>픽셀 밀도</span><span>${m.pxPerM.toFixed(0)} px/m</span></div>
        <div class="m-row"><span>표면 조도</span><span>${m.lux.toFixed(0)} lx</span></div>
        <div class="m-row"><span>체감 명암비</span><span class="${cClass}">${cText}</span></div>
      `;
    }
  };

  ui.syncToolbar = () => {
    const g = app.manager.globals;
    document.querySelectorAll('#view-mode button').forEach((b) => {
      b.classList.toggle('active', parseInt(b.dataset.mode, 10) === g.uViewMode.value);
    });
    document.getElementById('pattern-select').value = String(g.uPattern.value);
    blendToggle.checked = g.uBlendRamp.value > 0;
    if (g.uBlendRamp.value > 0) blendRamp.value = Math.round(g.uBlendRamp.value * 100);
  };

  return ui;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
