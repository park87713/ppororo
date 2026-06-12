import * as THREE from 'three';
import { ENV_DEFAULTS } from './presets.js';

// 환경(투사 대상 공간) 구성: 프리셋별 지오메트리 생성과
// 세팅 도우미를 위한 타깃 면 정보/배치 계획을 제공한다.
export class Environment {
  constructor(scene, projectionManager) {
    this.scene = scene;
    this.manager = projectionManager;
    this.preset = 'room';
    this.params = { ...ENV_DEFAULTS.room };
    this.group = null;
    this.receivers = [];
  }

  setPreset(preset, params) {
    this.preset = preset;
    this.params = { ...ENV_DEFAULTS[preset], ...(params || {}) };
    this.rebuild();
  }

  setParams(params) {
    Object.assign(this.params, params);
    this.rebuild();
  }

  rebuild() {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.isShaderMaterial) o.material.dispose();
      });
    }
    this.group = new THREE.Group();
    this.receivers = [];

    const build = {
      room: () => this._buildRoom(),
      facade: () => this._buildFacade(),
      curved: () => this._buildCurved(),
      stage: () => this._buildStage()
    }[this.preset];
    build();

    this.scene.add(this.group);
    // 앱이 커스텀 오브젝트와 합쳐 리시버를 갱신하도록 위임 (미설정 시 단독 등록)
    if (this.onRebuilt) this.onRebuilt();
    else this.manager.setReceivers(this.receivers);
  }

  get receiverMeshes() {
    return this.receivers.map((r) => r.mesh);
  }

  _addReceiver(mesh, baseColor) {
    mesh.userData.isReceiver = true;
    this.receivers.push({ mesh, baseColor });
    this.group.add(mesh);
    return mesh;
  }

  _plane(w, h) {
    return new THREE.PlaneGeometry(w, h);
  }

  _buildRoom() {
    const { width, depth, height } = this.params;
    // 바닥
    const floor = new THREE.Mesh(this._plane(width, depth));
    floor.rotation.x = -Math.PI / 2;
    this._addReceiver(floor, '#5d6167');
    // 후면(타깃) 벽 — +z 방향을 바라봄
    const back = new THREE.Mesh(this._plane(width, height));
    back.position.set(0, height / 2, -depth / 2);
    this._addReceiver(back, '#b9b5ad');
    // 좌/우 벽
    const left = new THREE.Mesh(this._plane(depth, height));
    left.rotation.y = Math.PI / 2;
    left.position.set(-width / 2, height / 2, 0);
    this._addReceiver(left, '#a8a49c');
    const right = new THREE.Mesh(this._plane(depth, height));
    right.rotation.y = -Math.PI / 2;
    right.position.set(width / 2, height / 2, 0);
    this._addReceiver(right, '#a8a49c');
  }

  _buildFacade() {
    const { width, height, ground } = this.params;
    const g = new THREE.Mesh(this._plane(ground, ground));
    g.rotation.x = -Math.PI / 2;
    g.position.z = ground / 2 - 2;
    this._addReceiver(g, '#4c4f55');
    // 파사드 본체
    const wall = new THREE.Mesh(this._plane(width, height));
    wall.position.set(0, height / 2, 0);
    this._addReceiver(wall, '#b3a99a');
    // 돌출 요소(필라스터/처마) — 차폐와 굴곡 매핑 확인용
    const pil = new THREE.BoxGeometry(1.0, height * 0.75, 0.5);
    for (const x of [-width / 4, width / 4]) {
      const p = new THREE.Mesh(pil.clone());
      p.position.set(x, height * 0.375, 0.25);
      this._addReceiver(p, '#a89e90');
    }
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.35, 0.7));
    ledge.position.set(0, height * 0.62, 0.35);
    this._addReceiver(ledge, '#a89e90');
  }

  _buildCurved() {
    const { radius, angleDeg, height, ground } = this.params;
    const g = new THREE.Mesh(this._plane(ground, ground));
    g.rotation.x = -Math.PI / 2;
    this._addReceiver(g, '#4c4f55');

    // 곡률 중심이 원점, 화면은 -z 쪽에 위치 (안쪽 법선이 +z 방향)
    const seg = 64;
    const ang = THREE.MathUtils.degToRad(angleDeg);
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const phi = -ang / 2 + (ang * i) / seg;
      const sx = radius * Math.sin(phi);
      const sz = -radius * Math.cos(phi);
      for (const y of [0, height]) {
        pos.push(sx, y, sz);
        nor.push(-Math.sin(phi), 0, Math.cos(phi));
        uv.push(i / seg, y > 0 ? 1 : 0);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const screen = new THREE.Mesh(geo);
    screen.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this._addReceiver(screen, '#c4c0b8');
  }

  _buildStage() {
    const { width, depth, height } = this.params;
    const floor = new THREE.Mesh(this._plane(width, depth));
    floor.rotation.x = -Math.PI / 2;
    this._addReceiver(floor, '#3f4147');
    const back = new THREE.Mesh(this._plane(width, height));
    back.position.set(0, height / 2, -depth / 2);
    this._addReceiver(back, '#8e8a84');
    // 매핑 대상 오브젝트
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8));
    cube.position.set(-2.4, 0.9, -depth / 6);
    cube.rotation.y = Math.PI / 7;
    this._addReceiver(cube, '#d8d4cc');
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32));
    sphere.position.set(1.6, 1.1, -depth / 8);
    this._addReceiver(sphere, '#d8d4cc');
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 40));
    cyl.position.set(4.2, 1.3, -depth / 5);
    this._addReceiver(cyl, '#d8d4cc');
  }

  // 세팅 도우미용 주 타깃 면 정보 (모든 프리셋에서 +z 법선 기준)
  getTarget() {
    const p = this.params;
    switch (this.preset) {
      case 'room':
        return { width: p.width, height: p.height, z: -p.depth / 2, centerY: p.height / 2, maxThrow: p.depth - 0.5, label: '후면 벽' };
      case 'facade':
        return { width: p.width, height: p.height, z: 0, centerY: p.height / 2, maxThrow: p.ground - 4, label: '파사드' };
      case 'curved': {
        const arc = p.radius * THREE.MathUtils.degToRad(p.angleDeg);
        // 곡률 중심보다 뒤로는 물러날 수 없으므로 최대 투사거리는 반경으로 제한
        return { width: arc, height: p.height, z: -p.radius, centerY: p.height / 2, maxThrow: Math.max(p.radius - 0.3, 0.5), label: '곡면 스크린(호 길이 기준)', curved: true };
      }
      case 'stage':
        return { width: p.width, height: p.height, z: -p.depth / 2, centerY: p.height / 2, maxThrow: p.depth - 0.5, label: '무대 배경막' };
    }
  }

  // cols × rows 배치 계획 → 프로젝터 위치/방향 목록
  planPositions(cols, rows, imgW, imgH, dist, ov) {
    const t = this.getTarget();
    const out = [];

    if (this.preset === 'curved') {
      const r = this.params.radius;
      const stepPhi = (imgW * (1 - ov)) / r;
      const totalPhi = stepPhi * (cols - 1);
      const rp = Math.max(r - dist, 0.3);
      for (let row = 0; row < rows; row++) {
        const y = this._rowY(t, rows, row, imgH, ov);
        for (let i = 0; i < cols; i++) {
          const phi = -totalPhi / 2 + stepPhi * i;
          out.push({
            position: [rp * Math.sin(phi), y, -rp * Math.cos(phi)],
            pan: -THREE.MathUtils.radToDeg(phi),
            tilt: 0
          });
        }
      }
      return out;
    }

    const stepX = imgW * (1 - ov);
    const spanX = imgW + stepX * (cols - 1);
    const x0 = -spanX / 2 + imgW / 2;
    for (let row = 0; row < rows; row++) {
      const y = this._rowY(t, rows, row, imgH, ov);
      for (let i = 0; i < cols; i++) {
        out.push({
          position: [x0 + stepX * i, y, t.z + dist],
          pan: 0,
          tilt: 0
        });
      }
    }
    return out;
  }

  _rowY(target, rows, row, imgH, ov) {
    if (rows <= 1) return target.centerY;
    const stepY = imgH * (1 - ov);
    const spanY = imgH + stepY * (rows - 1);
    const y0 = target.centerY + spanY / 2 - imgH / 2;
    return THREE.MathUtils.clamp(y0 - stepY * row, 0.3, 1e6);
  }

  // 환경 패널 UI 스키마
  paramSchema() {
    switch (this.preset) {
      case 'room':
        return [
          { key: 'width', label: '방 폭 (m)', min: 4, max: 40, step: 0.5 },
          { key: 'depth', label: '방 깊이 (m)', min: 3, max: 40, step: 0.5 },
          { key: 'height', label: '천장 높이 (m)', min: 2.2, max: 12, step: 0.1 }
        ];
      case 'facade':
        return [
          { key: 'width', label: '파사드 폭 (m)', min: 6, max: 80, step: 1 },
          { key: 'height', label: '파사드 높이 (m)', min: 4, max: 60, step: 1 }
        ];
      case 'curved':
        return [
          { key: 'radius', label: '곡률 반경 (m)', min: 2, max: 30, step: 0.5 },
          { key: 'angleDeg', label: '스크린 각도 (°)', min: 30, max: 200, step: 5 },
          { key: 'height', label: '스크린 높이 (m)', min: 2, max: 15, step: 0.5 }
        ];
      case 'stage':
        return [
          { key: 'width', label: '무대 폭 (m)', min: 6, max: 40, step: 0.5 },
          { key: 'depth', label: '무대 깊이 (m)', min: 4, max: 30, step: 0.5 },
          { key: 'height', label: '배경막 높이 (m)', min: 3, max: 15, step: 0.5 }
        ];
    }
  }
}
