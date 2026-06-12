import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ProjectionManager } from './projection.js';
import { Environment } from './environment.js';
import { Projector, defaultProjectorData } from './projector.js';
import { setupUI } from './ui.js';
import { setupAssistant, MAX_PROJECTORS } from './assistant.js';
import { PROJECTOR_COLORS, getSpec } from './presets.js';
import {
  SceneObject, ModelObject, defaultObjectData, defaultModelData,
  parseModelFile, arrayBufferToBase64, base64ToArrayBuffer, MAX_OBJECTS
} from './objects.js';

const AUTOSAVE_KEY = 'promap-sim-autosave';

class App {
  constructor() {
    this.viewport = document.getElementById('viewport');
    this.projectors = [];
    this.objects = [];
    this.selectedId = null;
    this.selectedObjectId = null;
    this.seq = 0;
    this.objSeq = 0;
    this._autosaveTimer = null;
    this._frame = 0;

    this._initThree();
    this.manager = new ProjectionManager(this.renderer);
    this.env = new Environment(this.scene, this.manager);
    this.env.onRebuilt = () => this.refreshReceivers();

    this.ui = setupUI(this);
    setupAssistant(this);

    this._initGizmo();
    this._initPicking();
    this._initKeyboard();

    if (!this._tryLoadAutosave()) this.resetDefault(false);

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  // ---------- three.js 기본 구성 ----------
  _initThree() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.viewport.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1013);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.camera.position.set(9, 6, 11);
    this.camera.layers.enable(1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.5, -1);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.52;

    // 프로젝터 본체 등 일반 재질용 조명 (투사면은 자체 셰이더로 계산)
    const hemi = new THREE.HemisphereLight(0xcdd9e5, 0x3c3c40, 1.4);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(80, 80, 0x3c424d, 0x23262c);
    grid.position.y = 0.015;
    grid.layers.set(1);
    this.scene.add(grid);

    const resize = () => {
      const w = this.viewport.clientWidth;
      const h = this.viewport.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(this.viewport);
    resize();
  }

  _initGizmo() {
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.transform.traverse((o) => o.layers.set(1));
    this.transform.getRaycaster().layers.enable(1);
    this.transform.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
    });
    this.transform.addEventListener('objectChange', () => {
      const p = this.selectedProjector();
      if (p) {
        p.syncToData();
        p.syncFromData();
      } else {
        const o = this.selectedObject();
        if (!o) return;
        o.syncToData();
      }
      this.touch();
      this.ui.refreshProps();
    });
    this.scene.add(this.transform);
  }

  _initPicking() {
    const dom = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    let downPos = null;
    dom.addEventListener('pointerdown', (e) => {
      downPos = [e.clientX, e.clientY];
    });
    dom.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
      downPos = null;
      // 터치는 손떨림 여유를 더 줌
      if (moved > (e.pointerType === 'touch' ? 12 : 5) || this.transform.dragging) return;
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      ray.setFromCamera(ndc, this.camera);
      const pickables = [];
      for (const p of this.projectors) p.body.traverse((o) => { if (o.isMesh) pickables.push(o); });
      for (const o of this.objects) pickables.push(...o.meshes);
      const hits = ray.intersectObjects(pickables, false);
      if (!hits.length) {
        this.select(null);
        return;
      }
      const ud = hits[0].object.userData;
      if (ud.projectorId != null) this.select(ud.projectorId);
      else if (ud.objectId != null) this.selectObject(ud.objectId);
    });
  }

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W') this.setGizmoMode('translate');
      else if (e.key === 'e' || e.key === 'E') this.setGizmoMode('rotate');
      else if (e.key === 'f' || e.key === 'F') {
        const t = this.selectedProjector()?.worldPosition() || this.selectedObject()?.group.position;
        if (t) this.controls.target.copy(t);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedObjectId != null) this.removeObject(this.selectedObjectId);
        else if (this.selectedId != null) this.removeProjector(this.selectedId);
      } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (this.selectedObjectId != null) this.duplicateObject(this.selectedObjectId);
        else if (this.selectedId != null) this.duplicateProjector(this.selectedId);
      }
    });
  }

  setGizmoMode(mode) {
    this.transform.setMode(mode);
    this.ui.syncGizmoButtons(mode);
  }

  // ---------- 프로젝터 관리 ----------
  selectedProjector() {
    return this.projectors.find((p) => p.data.id === this.selectedId) || null;
  }

  addProjector(overrides = {}, opts = {}) {
    if (this.projectors.length >= MAX_PROJECTORS) {
      alert(`프로젝터는 최대 ${MAX_PROJECTORS}대까지 배치할 수 있습니다.`);
      return null;
    }
    this.seq += 1;
    const data = defaultProjectorData({
      name: `P${this.seq}`,
      color: PROJECTOR_COLORS[(this.seq - 1) % PROJECTOR_COLORS.length],
      ...overrides
    });
    const p = new Projector(data);
    // 위치 미지정 시: 현재 환경의 타깃 면을 향하도록 자동 배치 (겹침 방지 스태거)
    if (overrides.position === undefined) {
      const t = this.env.getTarget();
      const dist = THREE.MathUtils.clamp(t.height * 1.5, 2.5, t.maxThrow);
      const x = ((this.projectors.length % 5) - 2) * 1.2;
      data.position = [x, THREE.MathUtils.clamp(t.centerY, 1.0, 6.0), t.z + dist];
      p.syncFromData();
      p.aimAt(new THREE.Vector3(0, t.centerY, t.z));
    }
    this.scene.add(p.group);
    this.projectors.push(p);
    this._rebuildSlots();
    if (!opts.silent) {
      this.select(data.id);
      this.ui.refreshList();
      this.touch();
    }
    return p;
  }

  removeProjector(id) {
    const i = this.projectors.findIndex((p) => p.data.id === id);
    if (i < 0) return;
    const wasSelected = this.selectedId === id;
    if (wasSelected) this.select(null);
    this.projectors[i].dispose();
    this.projectors.splice(i, 1);
    this._rebuildSlots();
    // 삭제 후 인접 프로젝터를 자동 선택해 작업 흐름 유지
    if (wasSelected && this.projectors.length) {
      this.select(this.projectors[Math.min(i, this.projectors.length - 1)].data.id);
    }
    this.ui.refreshList();
    this.touch();
  }

  duplicateProjector(id) {
    const src = this.projectors.find((p) => p.data.id === id);
    if (!src) return;
    const d = src.data;
    this.addProjector({
      ...structuredClone(d),
      id: undefined,
      name: undefined,
      position: [d.position[0] + 0.7, d.position[1], d.position[2]]
    });
  }

  select(id) {
    this.selectedId = id;
    this.selectedObjectId = null;
    for (const p of this.projectors) p.setSelected(p.data.id === id);
    const sel = this.selectedProjector();
    if (sel) this.transform.attach(sel.group);
    else this.transform.detach();
    this._refreshSelectionUI();
  }

  _refreshSelectionUI() {
    this.ui.refreshList();
    this.ui.refreshObjectList();
    this.ui.refreshProps(true);
    this.ui.refreshMetrics();
  }

  // ---------- 커스텀 오브젝트 ----------
  selectedObject() {
    return this.objects.find((o) => o.data.id === this.selectedObjectId) || null;
  }

  selectObject(id) {
    this.selectedObjectId = id;
    this.selectedId = null;
    for (const p of this.projectors) p.setSelected(false);
    const o = this.selectedObject();
    if (o) this.transform.attach(o.group);
    else this.transform.detach();
    this._refreshSelectionUI();
  }

  addObject(type, overrides = {}, opts = {}) {
    if (this.objects.length >= MAX_OBJECTS) {
      alert(`오브젝트는 최대 ${MAX_OBJECTS}개까지 추가할 수 있습니다.`);
      return null;
    }
    this.objSeq += 1;
    const data = defaultObjectData(type, { name: `O${this.objSeq}`, ...overrides });
    const o = new SceneObject(data);
    // 위치 미지정 시: 타깃 면 앞 바닥 위에 스태거 배치
    if (overrides.position === undefined) {
      const t = this.env.getTarget();
      data.position = [
        ((this.objects.length % 5) - 2) * 1.6,
        o.restHeight(),
        t.z + Math.min(3, Math.max(1.5, t.maxThrow * 0.35))
      ];
      o.syncFromData();
    }
    this.scene.add(o.group);
    this.objects.push(o);
    this.refreshReceivers();
    if (!opts.silent) {
      this.selectObject(data.id);
      this.touch();
    }
    return o;
  }

  removeObject(id) {
    const i = this.objects.findIndex((o) => o.data.id === id);
    if (i < 0) return;
    if (this.selectedObjectId === id) this.selectObject(null);
    this.objects[i].dispose();
    this.objects.splice(i, 1);
    this.refreshReceivers();
    this.ui.refreshObjectList();
    this.touch();
  }

  duplicateObject(id) {
    const src = this.objects.find((o) => o.data.id === id);
    if (!src) return;
    const d = src.data;
    if (d.type === 'model') {
      this._addModelFromData({
        ...structuredClone(d),
        id: undefined,
        name: undefined,
        position: [d.position[0] + d.targetSize + 0.3, d.position[1], d.position[2]]
      }, { silent: false });
      return;
    }
    const offset = (d.size.w ?? (d.size.r ?? 0.5) * 2) + 0.3;
    this.addObject(d.type, {
      ...structuredClone(d),
      id: undefined,
      name: undefined,
      position: [d.position[0] + offset, d.position[1], d.position[2]]
    });
  }

  // ---------- 3D 모델 불러오기 ----------
  async importModelFile(file) {
    if (file.size > 12 * 1024 * 1024 &&
        !confirm(`파일이 ${(file.size / 1048576).toFixed(1)}MB로 큽니다. 프로젝트 저장 파일에 포함되어 용량이 커집니다. 계속할까요?`)) {
      return;
    }
    const buf = await file.arrayBuffer();
    await this._addModelFromData({
      fileName: file.name,
      fileB64: arrayBufferToBase64(buf)
    }, { silent: false });
  }

  async _addModelFromData(d, opts = {}) {
    if (this.objects.length >= MAX_OBJECTS) {
      alert(`오브젝트는 최대 ${MAX_OBJECTS}개까지 추가할 수 있습니다.`);
      return null;
    }
    try {
      const { group, maxDim } = await parseModelFile(d.fileName, base64ToArrayBuffer(d.fileB64));
      this.objSeq += 1;
      const data = defaultModelData({ name: `O${this.objSeq}`, ...d });
      const o = new ModelObject(data, group, maxDim);
      if (d.position === undefined) {
        const t = this.env.getTarget();
        data.position = [
          ((this.objects.length % 5) - 2) * 1.6,
          0,
          t.z + Math.min(3, Math.max(1.5, t.maxThrow * 0.35))
        ];
        o.syncFromData();
      }
      this.scene.add(o.group);
      this.objects.push(o);
      this.refreshReceivers();
      this.ui.refreshObjectList();
      if (!opts.silent) this.selectObject(data.id);
      this.touch();
      return o;
    } catch (e) {
      console.error(e);
      alert(`모델을 불러오지 못했습니다: ${e.message}\n(외부 텍스처/Draco 압축을 참조하는 .gltf는 단일 .glb로 변환해 주세요)`);
      return null;
    }
  }

  // 환경 + 커스텀 오브젝트를 합쳐 투사 리시버 갱신
  refreshReceivers() {
    this.manager.setReceivers([
      ...this.env.receivers,
      ...this.objects.flatMap((o) => o.receiverEntries())
    ]);
  }

  get receiverMeshes() {
    return [...this.env.receiverMeshes, ...this.objects.flatMap((o) => o.meshes)];
  }

  changeSpec(id, specId) {
    const p = this.projectors.find((x) => x.data.id === id);
    if (!p) return;
    const spec = getSpec(specId);
    const d = p.data;
    d.specId = specId;
    d.lumens = spec.lumens;
    d.resX = spec.resX;
    d.resY = spec.resY;
    d.throwRatio = THREE.MathUtils.clamp(d.throwRatio, spec.tr[0], spec.tr[1]);
    d.shiftV = THREE.MathUtils.clamp(d.shiftV, -spec.shiftV, spec.shiftV);
    d.shiftH = THREE.MathUtils.clamp(d.shiftH, -spec.shiftH, spec.shiftH);
    p.syncFromData();
    this.ui.refreshList();
    this.ui.refreshProps(true);
    this.touch();
  }

  aimSelectedAtTarget() {
    const p = this.selectedProjector();
    if (!p) return;
    const t = this.env.getTarget();
    p.aimAt(new THREE.Vector3(0, t.centerY, t.z));
    this.ui.refreshProps();
    this.touch();
  }

  _rebuildSlots() {
    this.manager.setCount(this.projectors.length);
    this.projectors.forEach((p, i) => { p.index = i; });
    this.manager.markDirty();
  }

  // ---------- 환경 ----------
  setEnvironment(preset, params, frame = true) {
    this.env.setPreset(preset, params);
    this.ui.refreshEnvPanel();
    if (frame) this.frameView();
    this.touch();
  }

  frameView() {
    const t = this.env.getTarget();
    const d = Math.max(t.width, t.height);
    this.controls.target.set(0, t.centerY, t.z + 1);
    this.camera.position.set(d * 0.5, t.centerY + d * 0.4, t.z + Math.min(d * 1.3 + 4, 70));
  }

  // ---------- 세팅 도우미 적용 ----------
  applyPlan(plan) {
    while (this.projectors.length) this.removeProjector(this.projectors[0].data.id);
    this.seq = 0;
    const base = this.env.planPositions(plan.cols, plan.rows, plan.w, plan.h, plan.dist, plan.ov);
    // 스택: 같은 조준점에 본체를 수직으로 겹쳐 밝기를 배가
    const spots = [];
    for (const s of base) {
      for (let k = 0; k < (plan.stack || 1); k++) {
        spots.push({ ...s, position: [s.position[0], s.position[1] + k * 0.4, s.position[2]] });
      }
    }
    for (const s of spots.slice(0, MAX_PROJECTORS)) {
      this.addProjector({
        specId: plan.spec.id,
        lumens: plan.spec.lumens,
        resX: plan.spec.resX,
        resY: plan.spec.resY,
        throwRatio: plan.tr,
        position: s.position,
        pan: s.pan,
        tilt: s.tilt
      }, { silent: true });
    }
    if (this.projectors.length) this.select(this.projectors[0].data.id);
    this.ui.refreshList();
    this.touch();
  }

  // ---------- 저장 / 불러오기 ----------
  serialize() {
    const g = this.manager.globals;
    return {
      version: 1,
      env: { preset: this.env.preset, params: { ...this.env.params } },
      display: {
        ambient: g.uAmbient.value,
        viewMode: g.uViewMode.value,
        pattern: g.uPattern.value,
        blendRamp: g.uBlendRamp.value
      },
      seq: this.seq,
      objSeq: this.objSeq,
      projectors: this.projectors.map((p) => ({ ...p.data })),
      objects: this.objects.map((o) => structuredClone(o.data))
    };
  }

  loadProject(json, frame = true) {
    while (this.projectors.length) this.removeProjector(this.projectors[0].data.id);
    while (this.objects.length) this.removeObject(this.objects[0].data.id);
    this.env.setPreset(json.env?.preset || 'room', json.env?.params);
    const g = this.manager.globals;
    const disp = json.display || {};
    g.uAmbient.value = disp.ambient ?? 0.35;
    g.uViewMode.value = disp.viewMode ?? 0;
    g.uPattern.value = disp.pattern ?? 0;
    g.uBlendRamp.value = disp.blendRamp ?? 0;
    for (const d of json.projectors || []) {
      this.addProjector({ ...d, id: undefined }, { silent: true });
    }
    this.seq = json.seq || this.projectors.length;
    for (const d of json.objects || []) {
      if (d.type === 'model') this._addModelFromData({ ...d, id: undefined }, { silent: true });
      else this.addObject(d.type, { ...d, id: undefined }, { silent: true });
    }
    this.objSeq = json.objSeq || this.objects.length;
    this.ui.refreshObjectList();
    if (this.projectors.length) this.select(this.projectors[0].data.id);
    this.ui.refreshEnvPanel();
    this.ui.refreshList();
    this.ui.syncToolbar();
    if (frame) this.frameView();
    this.touch();
  }

  resetDefault(confirmFrame = true) {
    localStorage.removeItem(AUTOSAVE_KEY);
    this.loadProject({
      env: { preset: 'room' },
      display: { ambient: 0.3 },
      projectors: [
        defaultProjectorData({ name: 'P1', color: PROJECTOR_COLORS[0], position: [0, 1.7, 3.2] })
      ],
      seq: 1
    }, confirmFrame);
    this.frameView();
  }

  saveToFile() {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'promap-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _tryLoadAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      this.loadProject(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.serialize()));
      } catch { /* 저장 공간 부족 등은 무시 */ }
    }, 800);
  }

  touch() {
    this.manager.markDirty();
    this.scheduleAutosave();
  }

  // ---------- 렌더 루프 ----------
  _animate() {
    requestAnimationFrame(this._animate);
    this._frame += 1;
    this.controls.update();

    for (const p of this.projectors) p.applyToUniforms(this.manager);
    this.manager.renderDepthMaps(this.scene, this.projectors);

    // 프러스텀 길이/측정값은 10프레임마다 갱신 (레이캐스트 비용 절약)
    if (this._frame % 10 === 0) {
      const meshes = this.receiverMeshes;
      for (const p of this.projectors) {
        if (p.data.id !== this.selectedId) p.computeMetrics(meshes);
      }
      this.ui.refreshMetrics();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// 콘솔 디버깅/자동화 테스트용 핸들
window.__app = new App();
