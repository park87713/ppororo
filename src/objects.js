import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 사용자가 직접 추가하는 투사 대상 오브젝트
export const MAX_OBJECTS = 16;
// 모델 임포트 시 유지할 최대 서브메시 수 (초과 시 단일 메시로 병합)
const MAX_MODEL_MESHES = 24;

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

export function defaultModelData(overrides = {}) {
  overrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined)
  );
  const data = {
    id: nextObjectId++,
    type: 'model',
    name: '',
    fileName: 'model.glb',
    fileB64: '',
    targetSize: 2.0,
    position: [0, 0, 0],
    pan: 0,
    tilt: 0,
    roll: 0,
    ...overrides
  };
  if (!data.name) data.name = `O${data.id}`;
  return data;
}

// 파일(.glb/.gltf/.obj/.stl) → 베이크된 메시 그룹 + 최대 치수
export async function parseModelFile(fileName, arrayBuffer) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  let root;
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    const data = ext === 'glb' ? arrayBuffer : new TextDecoder().decode(arrayBuffer);
    const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
    root = gltf.scene || gltf.scenes?.[0];
  } else if (ext === 'obj') {
    root = new OBJLoader().parse(new TextDecoder().decode(arrayBuffer));
  } else if (ext === 'stl') {
    const geo = new STLLoader().parse(arrayBuffer);
    // STL의 파일 법선은 0벡터/비정규 값이 흔해 항상 재계산 (NaN 셰이딩 방지)
    geo.deleteAttribute('normal');
    geo.computeVertexNormals();
    root = new THREE.Group();
    root.add(new THREE.Mesh(geo));
  } else {
    throw new Error('지원하지 않는 형식입니다 (.glb / .gltf / .obj / .stl)');
  }
  if (!root) throw new Error('장면을 찾을 수 없습니다');

  root.updateMatrixWorld(true);
  const srcMeshes = [];
  root.traverse((o) => { if (o.isMesh) srcMeshes.push(o); });
  if (!srcMeshes.length) throw new Error('파일에 메시가 없습니다');

  const group = new THREE.Group();
  if (srcMeshes.length > MAX_MODEL_MESHES) {
    // 서브메시 과다: 위치/법선만 남기고 단일 메시로 병합 (재질 수 폭증 방지)
    const geos = srcMeshes.map((m) => {
      let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const clean = new THREE.BufferGeometry();
      clean.setAttribute('position', g.getAttribute('position'));
      clean.setAttribute('normal', g.getAttribute('normal'));
      return clean;
    });
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
    mesh.userData.baseColor = '#cfccc4';
    group.add(mesh);
  } else {
    // 월드 변환을 지오메트리에 베이크해 평탄화, 원본 재질의 반사색만 유지
    for (const m of srcMeshes) {
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      mesh.userData.baseColor = mat?.color ? `#${mat.color.getHexString()}` : '#cfccc4';
      group.add(mesh);
    }
  }

  const bbox = new THREE.Box3().setFromObject(group);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return { group, maxDim };
}

// 불러온 3D 모델 오브젝트 — SceneObject 와 동일한 인터페이스
export class ModelObject {
  constructor(data, contentGroup, maxDim) {
    this.data = data;
    this.maxDim = maxDim;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.content = contentGroup;
    this.group.add(contentGroup);
    this.meshes = [];
    contentGroup.traverse((o) => {
      if (o.isMesh) {
        o.userData.objectId = data.id;
        o.userData.isReceiver = true;
        this.meshes.push(o);
      }
    });
    this.bbox = new THREE.Box3().setFromObject(contentGroup); // 비스케일 기준
    this.applyScale();
    this.syncFromData();
  }

  // targetSize(최대 변, m)에 맞춰 균일 스케일 + 바닥 중심 피벗 정렬
  applyScale() {
    const s = this.data.targetSize / this.maxDim;
    this.content.scale.setScalar(s);
    const c = this.bbox.getCenter(new THREE.Vector3());
    this.content.position.set(-c.x * s, -this.bbox.min.y * s, -c.z * s);
  }

  restHeight() {
    return 0; // 피벗이 바닥 중심
  }

  receiverEntries() {
    // 임포트 모델은 법선 방향이 제각각인 경우가 많아 양면 수광
    return this.meshes.map((m) => ({
      mesh: m,
      baseColor: m.userData.baseColor,
      side: THREE.DoubleSide
    }));
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
    for (const m of this.meshes) {
      m.geometry.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    }
  }
}

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
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

  get meshes() {
    return [this.mesh];
  }

  receiverEntries() {
    return [{
      mesh: this.mesh,
      baseColor: this.data.color,
      side: this.data.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide
    }];
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
