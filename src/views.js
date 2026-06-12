import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 뷰포트 분할 관리: 단일 캔버스에 시저 렌더링으로 1~4분할,
// 분할창별 독립 카메라(자유/상면/정면/측면/프로젝터 POV)와 컨트롤을 제공한다.

const LAYOUTS = {
  1: [{ x: 0, y: 0, w: 1, h: 1 }],
  2: [
    { x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }
  ],
  3: [
    { x: 0, y: 0, w: 0.62, h: 1 },
    { x: 0.62, y: 0, w: 0.38, h: 0.5 }, { x: 0.62, y: 0.5, w: 0.38, h: 0.5 }
  ],
  4: [
    { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
  ]
};

export const VIEW_TYPES = {
  free: '자유',
  top: '상면',
  front: '정면',
  side: '측면',
  projector: '프로젝터'
};

const DEFAULT_TYPES = ['free', 'top', 'front', 'side'];
const ORTHO_DIST = 250;

export class ViewManager {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('viewport');
    this.panesEl = document.getElementById('panes');
    this.layout = 1;
    this.panes = [];

    // 분할창 진입(클릭/터치) 시 기즈모를 해당 창 기준으로 리바인딩
    this.panesEl.addEventListener('pointerdown', (e) => {
      const hit = this.paneAt(e.clientX, e.clientY);
      if (hit) this.app.onPaneActivate(hit.pane);
    }, true);

    this.setLayout(1, DEFAULT_TYPES);
  }

  setLayout(n, types) {
    const prevTypes = types || this.panes.map((p) => p.type);
    for (const p of this.panes) this._disposePane(p);
    this.panes = [];
    this.panesEl.innerHTML = '';
    this.layout = n;
    LAYOUTS[n].forEach((rect, i) => {
      this._createPane(i, rect, prevTypes[i] || DEFAULT_TYPES[i] || 'free');
    });
    this.resize();
    this.app.onPaneStructureChanged?.(this.panes[0]);
  }

  _createPane(i, rect, type) {
    const el = document.createElement('div');
    el.className = 'pane';
    el.style.left = `${rect.x * 100}%`;
    el.style.top = `${rect.y * 100}%`;
    el.style.width = `${rect.w * 100}%`;
    el.style.height = `${rect.h * 100}%`;

    const head = document.createElement('div');
    head.className = 'pane-head';
    const sel = document.createElement('select');
    sel.innerHTML = Object.entries(VIEW_TYPES)
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    sel.value = type;
    head.appendChild(sel);
    const label = document.createElement('span');
    label.className = 'pane-label';
    label.hidden = true;
    head.appendChild(label);
    el.appendChild(head);
    this.panesEl.appendChild(el);

    const pane = { i, rect, el, sel, label, type: null, camera: null, controls: null };
    sel.addEventListener('change', () => {
      this.setPaneType(pane, sel.value);
      this.app.scheduleAutosave();
    });
    this.panes.push(pane);
    this.setPaneType(pane, type);
    return pane;
  }

  setPaneType(pane, type) {
    if (pane.controls) {
      if (pane.type === 'free' && pane.i === 0) {
        this.app._lastFreeTarget = pane.controls.target.clone();
      }
      pane.controls.dispose();
      pane.controls = null;
    }
    pane.type = type;
    pane.sel.value = type;
    pane.label.hidden = type !== 'projector';

    if (type === 'free') {
      // 0번 분할창은 앱 메인 자유 카메라를 공유 (frameView/테스트 호환)
      pane.camera = pane.i === 0
        ? this.app.freeCamera
        : this.app.freeCamera.clone();
      pane.camera.layers.enable(1);
      const c = new OrbitControls(pane.camera, pane.el);
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      c.maxPolarAngle = Math.PI * 0.52;
      const t = this.app._lastFreeTarget || this._sceneCenter();
      c.target.copy(t);
      pane.controls = c;
    } else if (type === 'projector') {
      pane.camera = null; // 렌더 시점에 선택 프로젝터 카메라 사용
      this.refreshProjectorLabels();
    } else {
      const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
      cam.layers.enable(1);
      pane.camera = cam;
      const c = new OrbitControls(cam, pane.el);
      c.enableRotate = false;
      c.screenSpacePanning = true;
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      pane.controls = c;
      this._frameOrtho(pane);
    }
    if (this.app.transformPane === pane) this.app.onPaneActivate(pane);
  }

  _sceneCenter() {
    const t = this.app.env.getTarget();
    return new THREE.Vector3(0, t.centerY, t.z / 2);
  }

  _frameOrtho(pane) {
    const t = this.app.env.getTarget();
    const c = this._sceneCenter();
    const ext = Math.max(t.width, t.height, Math.abs(t.z) * 2.2, 8) * 0.65;
    pane.ext = ext;
    const cam = pane.camera;
    if (pane.type === 'top') {
      cam.position.set(c.x, ORTHO_DIST, c.z);
      cam.up.set(0, 0, -1);
    } else if (pane.type === 'front') {
      cam.position.set(c.x, c.y, ORTHO_DIST);
      cam.up.set(0, 1, 0);
    } else {
      cam.position.set(ORTHO_DIST, c.y, c.z);
      cam.up.set(0, 1, 0);
    }
    cam.zoom = 1;
    pane.controls.target.copy(c);
    this._applyOrthoFrustum(pane);
  }

  _applyOrthoFrustum(pane) {
    const { w, h } = this._panePx(pane);
    const aspect = h > 0 ? w / h : 1;
    const cam = pane.camera;
    cam.left = -pane.ext * aspect;
    cam.right = pane.ext * aspect;
    cam.top = pane.ext;
    cam.bottom = -pane.ext;
    cam.updateProjectionMatrix();
  }

  // 환경이 바뀌면 직교 뷰를 다시 프레이밍
  frameAllOrtho() {
    for (const p of this.panes) {
      if (p.type !== 'free' && p.type !== 'projector') this._frameOrtho(p);
    }
  }

  refreshProjectorLabels() {
    const p = this.app.selectedProjector?.() || this.app.projectors?.[0];
    for (const pane of this.panes) {
      if (pane.type === 'projector') {
        pane.label.textContent = p ? `${p.data.name} 시점` : '프로젝터 없음';
      }
    }
  }

  _panePx(pane) {
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;
    return {
      x: Math.floor(pane.rect.x * W),
      y: Math.floor(pane.rect.y * H),
      w: Math.floor(pane.rect.w * W),
      h: Math.floor(pane.rect.h * H),
      W, H
    };
  }

  paneAt(clientX, clientY) {
    const r = this.container.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    for (const pane of this.panes) {
      const { rect } = pane;
      if (fx >= rect.x && fx <= rect.x + rect.w && fy >= rect.y && fy <= rect.y + rect.h) {
        const ndc = new THREE.Vector2(
          ((fx - rect.x) / rect.w) * 2 - 1,
          -(((fy - rect.y) / rect.h) * 2 - 1)
        );
        return { pane, ndc };
      }
    }
    return null;
  }

  cameraFor(pane) {
    if (pane.type !== 'projector') return pane.camera;
    const p = this.app.selectedProjector() || this.app.projectors[0];
    return p ? p.camera : null;
  }

  resize() {
    for (const pane of this.panes) {
      const { w, h } = this._panePx(pane);
      if (!w || !h) continue;
      if (pane.type === 'free') {
        pane.camera.aspect = w / h;
        pane.camera.updateProjectionMatrix();
      } else if (pane.camera) {
        this._applyOrthoFrustum(pane);
      }
    }
  }

  update() {
    for (const pane of this.panes) pane.controls?.update();
  }

  render(renderer, scene) {
    const single = this.panes.length === 1 && this.panes[0].type !== 'projector';
    renderer.setScissorTest(true);
    for (const pane of this.panes) {
      const { x, y, w, h, H } = this._panePx(pane);
      if (!w || !h) continue;
      const glY = H - y - h;
      const cam = this.cameraFor(pane);
      if (!cam) {
        renderer.setViewport(x, glY, w, h);
        renderer.setScissor(x, glY, w, h);
        renderer.setClearColor(0x07080b);
        renderer.clear(true, true, false);
        continue;
      }
      if (pane.type === 'projector') {
        // 프로젝터 POV: 이미지 종횡비에 맞춰 레터박스
        renderer.setViewport(x, glY, w, h);
        renderer.setScissor(x, glY, w, h);
        renderer.setClearColor(0x000000);
        renderer.clear(true, true, false);
        const pa = w / h;
        let sw = w, sh = h;
        if (cam.aspect > pa) sh = Math.floor(w / cam.aspect);
        else sw = Math.floor(h * cam.aspect);
        const sx = x + Math.floor((w - sw) / 2);
        const sy = glY + Math.floor((h - sh) / 2);
        cam.layers.set(0); // 헬퍼 제외, 실제 투사 시야만
        renderer.setViewport(sx, sy, sw, sh);
        renderer.setScissor(sx, sy, sw, sh);
        renderer.render(scene, cam);
      } else {
        renderer.setViewport(x, glY, w, h);
        renderer.setScissor(x, glY, w, h);
        renderer.render(scene, cam);
      }
    }
    renderer.setScissorTest(false);
    return single;
  }

  serialize() {
    return { n: this.layout, types: this.panes.map((p) => p.type) };
  }

  applyState(state) {
    if (!state || !LAYOUTS[state.n]) return;
    this.setLayout(state.n, state.types || []);
  }

  _disposePane(pane) {
    if (pane.controls) {
      if (pane.type === 'free' && pane.i === 0) {
        this.app._lastFreeTarget = pane.controls.target.clone();
      }
      pane.controls.dispose();
    }
    pane.el.remove();
  }
}
