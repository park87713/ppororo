import * as THREE from 'three';
import { getSpec } from './presets.js';

const DEG = THREE.MathUtils.degToRad;

let nextId = 1;
export function newProjectorId() {
  return nextId++;
}

export function defaultProjectorData(overrides = {}) {
  // undefined 값으로 기본값이 덮어써지지 않도록 정리
  overrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined)
  );
  const spec = getSpec(overrides.specId || 'wuxga7500');
  const data = {
    id: newProjectorId(),
    name: '',
    color: '#4da3ff',
    specId: spec.id,
    lumens: spec.lumens,
    resX: spec.resX,
    resY: spec.resY,
    throwRatio: (spec.tr[0] + spec.tr[1]) / 2,
    shiftV: 0,
    shiftH: 0,
    on: true,
    position: [0, 1.6, 4],
    pan: 0,
    tilt: 0,
    roll: 0,
    ...overrides
  };
  if (!data.name) data.name = `P${data.id}`;
  return data;
}

// 단일 프로젝터: 3D 본체 + 투사 카메라 + 프러스텀 표시를 관리
export class Projector {
  constructor(data) {
    this.data = data;
    this.index = -1; // ProjectionManager 상의 슬롯 (외부에서 할당)

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';

    // far 400m: 장초점 렌즈(최대 14.6:1)로 300m급 원거리 투사까지 커버
    this.camera = new THREE.PerspectiveCamera(30, 16 / 10, 0.4, 400);
    this.group.add(this.camera);

    this._buildBody();
    this._buildFrustum();
    this._buildLabel();

    this.lastHitDistance = 8;
    this.syncFromData();
  }

  _buildBody() {
    const body = new THREE.Group();
    const color = new THREE.Color(this.data.color);

    const boxMat = new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.7 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.36), boxMat);
    box.position.z = 0.05;
    body.add(box);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.1, 24),
      new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.3 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.17;
    body.add(lens);

    this.ringMat = new THREE.MeshBasicMaterial({ color });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 8, 32), this.ringMat);
    ring.position.z = -0.215;
    body.add(ring);

    // 피킹용 식별자
    body.traverse((o) => { o.userData.projectorId = this.data.id; });
    this.body = body;
    this.group.add(body);
  }

  _buildFrustum() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.frustumMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.data.color),
      transparent: true,
      opacity: 0.35
    });
    this.frustum = new THREE.LineSegments(geo, this.frustumMat);
    this.frustum.frustumCulled = false;
    this.frustum.layers.set(1);
    this.group.add(this.frustum);
  }

  _buildLabel() {
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 80;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    const mat = new THREE.SpriteMaterial({ map: this.labelTexture, depthTest: false });
    this.label = new THREE.Sprite(mat);
    this.label.scale.set(0.9, 0.28, 1);
    this.label.position.set(0, 0.32, 0);
    this.label.layers.set(1);
    this.group.add(this.label);
  }

  _redrawLabel() {
    const ctx = this.labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 80);
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.data.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 6;
    const text = this.data.name;
    ctx.strokeText(text, 128, 40);
    ctx.fillText(text, 128, 40);
    this.labelTexture.needsUpdate = true;
  }

  get aspect() {
    return this.data.resX / Math.max(1, this.data.resY);
  }

  get tanHalfH() {
    return 1 / (2 * this.data.throwRatio);
  }

  get tanHalfV() {
    return this.tanHalfH / this.aspect;
  }

  syncFromData() {
    const d = this.data;
    this.group.position.fromArray(d.position);
    this.group.rotation.set(DEG(d.tilt), DEG(d.pan), DEG(d.roll));

    // 스로우비 → 화각, 렌즈 시프트 → 오프축 투영
    this.camera.aspect = this.aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(this.tanHalfV));
    this.camera.updateProjectionMatrix();
    const pm = this.camera.projectionMatrix;
    pm.elements[8] = 2 * d.shiftH;
    pm.elements[9] = 2 * d.shiftV;
    this.camera.projectionMatrixInverse.copy(pm).invert();

    this.ringMat.color.set(d.color);
    this.frustumMat.color.set(d.color);
    this._redrawLabel();
    this.updateFrustum(this.lastHitDistance);
  }

  // 데이터 ← 기즈모 조작 결과 반영
  syncToData() {
    const d = this.data;
    d.position = this.group.position.toArray();
    d.tilt = THREE.MathUtils.radToDeg(this.group.rotation.x);
    d.pan = THREE.MathUtils.radToDeg(this.group.rotation.y);
    d.roll = THREE.MathUtils.radToDeg(this.group.rotation.z);
  }

  setSelected(sel) {
    this.frustumMat.opacity = sel ? 0.9 : 0.35;
  }

  // 프러스텀 라인: 원점 → 표시거리 d 의 이미지 사각형
  updateFrustum(d) {
    const sH = 2 * this.data.shiftH;
    const sV = 2 * this.data.shiftV;
    const x = d * this.tanHalfH;
    const y = d * this.tanHalfV;
    const c = [
      new THREE.Vector3((-1 + sH) * x, (-1 + sV) * y, -d),
      new THREE.Vector3((1 + sH) * x, (-1 + sV) * y, -d),
      new THREE.Vector3((1 + sH) * x, (1 + sV) * y, -d),
      new THREE.Vector3((-1 + sH) * x, (1 + sV) * y, -d)
    ];
    const o = new THREE.Vector3(0, 0, 0);
    const pts = [
      o, c[0], o, c[1], o, c[2], o, c[3],
      c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]
    ];
    const attr = this.frustum.geometry.getAttribute('position');
    for (let i = 0; i < 16; i++) attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    attr.needsUpdate = true;
  }

  worldPosition(target = new THREE.Vector3()) {
    return this.group.getWorldPosition(target);
  }

  worldForward(target = new THREE.Vector3()) {
    target.set(0, 0, -1);
    return target.applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
  }

  // 셰이더 uniform 갱신
  applyToUniforms(manager) {
    if (this.index < 0) return;
    const u = manager.uniformsFor(this.index);
    if (!u.pm) return;
    this.group.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    u.pm.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.worldPosition(u.pos.value);
    this.worldForward(u.fwd.value);
    u.color.value.set(this.data.color).lerp(new THREE.Color(1, 1, 1), 0.45);
    u.lumens.value = this.data.lumens;
    u.tan.value.set(this.tanHalfH, this.tanHalfV);
    u.res.value.set(this.data.resX, this.data.resY);
    u.on.value = this.data.on ? 1 : 0;
  }

  // 정면 광축 레이캐스트로 투사거리/화면크기/품질 지표 계산
  computeMetrics(receiverMeshes) {
    const origin = this.worldPosition();
    const dir = this.worldForward();
    const ray = new THREE.Raycaster(origin, dir, 0.05, 1000);
    ray.layers.set(0);
    const hits = ray.intersectObjects(receiverMeshes, false);
    if (!hits.length) {
      this.lastHitDistance = 8;
      this.updateFrustum(8);
      return null;
    }
    const dist = hits[0].distance;
    this.lastHitDistance = dist;
    this.updateFrustum(dist);
    const w = 2 * dist * this.tanHalfH;
    const h = 2 * dist * this.tanHalfV;
    const lux = this.data.lumens / Math.max(w * h, 1e-4);
    return {
      dist,
      w,
      h,
      pxPerM: this.data.resX / w,
      lux,
      hitPoint: hits[0].point
    };
  }

  aimAt(point) {
    const pos = this.worldPosition();
    const d = point.clone().sub(pos).normalize();
    this.data.pan = THREE.MathUtils.radToDeg(Math.atan2(-d.x, -d.z));
    this.data.tilt = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)));
    this.data.roll = 0;
    this.syncFromData();
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
    this.labelTexture.dispose();
  }
}
