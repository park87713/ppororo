import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ProjectionManager } from './projection.js';
import { Environment } from './environment.js';
import { Projector, defaultProjectorData } from './projector.js';
import { setupUI } from './ui.js';
import { setupAssistant, MAX_PROJECTORS } from './assistant.js';
import { PROJECTOR_COLORS, getSpec } from './presets.js';

const AUTOSAVE_KEY = 'promap-sim-autosave';

class App {
  constructor() {
    this.viewport = document.getElementById('viewport');
    this.projectors = [];
    this.selectedId = null;
    this.seq = 0;
    this._autosaveTimer = null;
    this._frame = 0;

    this._initThree();
    this.manager = new ProjectionManager(this.renderer);
    this.env = new Environment(this.scene, this.manager);

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

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
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
      if (!p) return;
      p.syncToData();
      p.syncFromData();
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
      if (moved > 5 || this.transform.dragging) return;
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      ray.setFromCamera(ndc, this.camera);
      const bodies = [];
      for (const p of this.projectors) p.body.traverse((o) => { if (o.isMesh) bodies.push(o); });
      const hits = ray.intersectObjects(bodies, false);
      if (hits.length) this.select(hits[0].object.userData.projectorId);
      else this.select(null);
    });
  }

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W') this.transform.setMode('translate');
      else if (e.key === 'e' || e.key === 'E') this.transform.setMode('rotate');
      else if (e.key === 'f' || e.key === 'F') {
        const p = this.selectedProjector();
        if (p) this.controls.target.copy(p.worldPosition());
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedId != null) this.removeProjector(this.selectedId);
      } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (this.selectedId != null) this.duplicateProjector(this.selectedId);
      }
    });
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
    if (this.selectedId === id) this.select(null);
    this.projectors[i].dispose();
    this.projectors.splice(i, 1);
    this._rebuildSlots();
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
    for (const p of this.projectors) p.setSelected(p.data.id === id);
    const sel = this.selectedProjector();
    if (sel) this.transform.attach(sel.group);
    else this.transform.detach();
    this.ui.refreshList();
    this.ui.refreshProps(true);
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
    const spots = this.env.planPositions(plan.cols, plan.rows, plan.w, plan.h, plan.dist, plan.ov)
      .slice(0, MAX_PROJECTORS);
    for (const s of spots) {
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
      projectors: this.projectors.map((p) => ({ ...p.data }))
    };
  }

  loadProject(json, frame = true) {
    while (this.projectors.length) this.removeProjector(this.projectors[0].data.id);
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
      const meshes = this.env.receiverMeshes;
      for (const p of this.projectors) {
        if (p.data.id !== this.selectedId) p.computeMetrics(meshes);
      }
      this.ui.refreshMetrics();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

new App();
