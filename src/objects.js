import * as THREE from 'three';

// 사용자가 직접 추가하는 투사 대상 오브젝트
export const MAX_OBJECTS = 16;

export const OBJECT_TYPES = {
  box: {
    name: '박스',
    params: [
      { key: 'w', label: '폭 (m)', def: 1.5, min: 0.1 },
      { key: 'h', label: '높이 (m)', def: 1.5, min: 0.1 },
      { key: 'd', label: '깊이 (m)', def: 1.5, min: 0.1 }
    ]
  },
  sphere: {
    name: '구',
    params: [{ key: 'r', label: '반지름 (m)', def: 0.9, min: 0.05 }]
  },
  cylinder: {
    name: '원기둥',
    params: [
      { key: 'r', label: '반지름 (m)', def: 0.7, min: 0.05 },
      { key: 'h', label: '높이 (m)', def: 2.0, min: 0.1 }
    ]
  },
  cone: {
    name: '원뿔',
    params: [
      { key: 'r', label: '반지름 (m)', def: 0.8, min: 0.05 },
      { key: 'h', label: '높이 (m)', def: 1.6, min: 0.1 }
    ]
  },
  plane: {
    name: '벽 / 판',
    params: [
      { key: 'w', label: '폭 (m)', def: 3.0, min: 0.1 },
      { key: 'h', label: '높이 (m)', def: 2.0, min: 0.1 }
    ]
  }
};

let nextObjectId = 1;

export function defaultObjectData(type, overrides = {}) {
  overrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined)
  );
  const def = OBJECT_TYPES[type] || OBJECT_TYPES.box;
  const size = {};
  for (const p of def.params) size[p.key] = p.def;
  const data = {
    id: nextObjectId++,
    type: OBJECT_TYPES[type] ? type : 'box',
    name: '',
    color: '#d8d4cc',
    size,
    position: [0, 1, 0],
    pan: 0,
    tilt: 0,
    roll: 0,
    ...overrides
  };
  data.size = { ...size, ...(overrides.size || {}) };
  if (!data.name) data.name = `O${data.id}`;
  return data;
}

export class SceneObject {
  constructor(data) {
    this.data = data;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.mesh = new THREE.Mesh(this._buildGeometry(), new THREE.MeshBasicMaterial());
    this.mesh.userData.objectId = data.id;
    this.mesh.userData.isReceiver = true;
    this.group.add(this.mesh);
    this.syncFromData();
  }

  _buildGeometry() {
    const s = this.data.size;
    switch (this.data.type) {
      case 'sphere': return new THREE.SphereGeometry(s.r, 48, 32);
      case 'cylinder': return new THREE.CylinderGeometry(s.r, s.r, s.h, 48);
      case 'cone': return new THREE.ConeGeometry(s.r, s.h, 48);
      case 'plane': return new THREE.PlaneGeometry(s.w, s.h);
      default: return new THREE.BoxGeometry(s.w, s.h, s.d);
    }
  }

  // 크기 변경: 메시 객체는 유지하고 지오메트리만 교체 (재질/리시버 등록 유지)
  setSize(partial) {
    Object.assign(this.data.size, partial);
    this.mesh.geometry.dispose();
    this.mesh.geometry = this._buildGeometry();
  }

  // 바닥 위에 놓일 때의 피벗 높이
  restHeight() {
    const s = this.data.size;
    if (this.data.type === 'sphere') return s.r;
    return (s.h ?? s.r * 2) / 2;
  }

  syncFromData() {
    const d = this.data;
    this.group.position.fromArray(d.position);
    this.group.rotation.set(
      THREE.MathUtils.degToRad(d.tilt),
      THREE.MathUtils.degToRad(d.pan),
      THREE.MathUtils.degToRad(d.roll)
    );
  }

  syncToData() {
    const d = this.data;
    d.position = this.group.position.toArray();
    d.tilt = THREE.MathUtils.radToDeg(this.group.rotation.x);
    d.pan = THREE.MathUtils.radToDeg(this.group.rotation.y);
    d.roll = THREE.MathUtils.radToDeg(this.group.rotation.z);
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    if (this.mesh.material && this.mesh.material.dispose) this.mesh.material.dispose();
  }
}
