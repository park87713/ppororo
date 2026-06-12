import * as THREE from 'three';

// 사진 → 3D 공간 재구성
// 단안 깊이 추정(Depth Anything V2, transformers.js — 전부 브라우저 내 실행)으로
// 사진의 깊이맵을 만들고, 릴리프 메시 + 사진 텍스처를 가진 투사 수광 표면을 생성한다.
// 깊이맵은 프로젝트에 PNG로 저장되어 다시 열 때 모델 없이 복원된다.

const MODEL_ID = 'onnx-community/depth-anything-v2-small';
const TEX_MAX = 1024;   // 표면 텍스처 최대 변
const MODEL_MAX = 640;  // 모델 입력 최대 변
const DEPTH_MAX = 256;  // 저장용 깊이맵 최대 변
const GRID_X = 128;     // 릴리프 메시 가로 분할

let pipePromise = null;

async function getPipeline(onProgress) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const progress_callback = (p) => {
        if (p.status === 'progress' && p.total) {
          onProgress?.(`모델 다운로드 ${Math.round((p.loaded / p.total) * 100)}%`);
        }
      };
      const device = navigator.gpu ? 'webgpu' : 'wasm';
      try {
        return await pipeline('depth-estimation', MODEL_ID, { device, dtype: 'q8', progress_callback });
      } catch {
        return await pipeline('depth-estimation', MODEL_ID, { progress_callback });
      }
    })();
    pipePromise.catch(() => { pipePromise = null; }); // 실패 시 재시도 가능
  }
  return pipePromise;
}

function drawScaled(img, maxSide, mime = 'image/jpeg', q = 0.85) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(mime, q);
}

export function loadImage(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'));
    img.src = dataURL;
  });
}

export async function fileToDataURLs(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return {
      texURL: drawScaled(img, TEX_MAX),
      modelURL: drawScaled(img, MODEL_MAX)
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 사진 → 깊이맵(그레이스케일 PNG dataURL). 밝을수록 가까움(디스패리티).
export async function estimateDepthPNG(modelURL, onProgress) {
  onProgress?.('모델 준비 중…');
  const pipe = await getPipeline(onProgress);
  onProgress?.('깊이 추정 중…');
  const out = await pipe(modelURL);
  const depth = out.depth; // RawImage (1채널, 0~255)
  const c = document.createElement('canvas');
  const s = Math.min(1, DEPTH_MAX / Math.max(depth.width, depth.height));
  c.width = Math.max(1, Math.round(depth.width * s));
  c.height = Math.max(1, Math.round(depth.height * s));
  // RawImage → 캔버스 (원본 크기) → 축소
  const src = document.createElement('canvas');
  src.width = depth.width;
  src.height = depth.height;
  const id = src.getContext('2d').createImageData(depth.width, depth.height);
  for (let i = 0; i < depth.width * depth.height; i++) {
    const v = depth.data[i];
    id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  src.getContext('2d').putImageData(id, 0, 0);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export async function loadImageData(dataURL) {
  const img = await loadImage(dataURL);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

let nextPhotoSeq = 1;

export function defaultPhotoData(overrides = {}) {
  overrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined)
  );
  const seq = nextPhotoSeq++;
  const data = {
    id: Date.now() * 100 + (seq % 100),
    type: 'photo',
    name: `사진면 ${seq}`,
    fileName: 'photo.jpg',
    photoB64: '',
    depthB64: '',
    width: 4,
    depthScale: 0.6,
    position: [0, 0, 0],
    pan: 0,
    tilt: 0,
    roll: 0,
    ...overrides
  };
  return data;
}

// 깊이 릴리프 표면 — SceneObject 와 동일한 인터페이스
export class PhotoSurface {
  constructor(data, photoImage, depthImageData) {
    this.data = data;
    this.depthData = depthImageData;
    this.aspect = photoImage.width / photoImage.height;

    this.texture = new THREE.Texture(photoImage);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.mesh = new THREE.Mesh(this._buildGeometry(), new THREE.MeshBasicMaterial());
    this.mesh.userData.objectId = data.id;
    this.mesh.userData.isReceiver = true;
    this.group.add(this.mesh);
    this.syncFromData();
  }

  _sampleDepth(u, v) {
    const d = this.depthData;
    const px = Math.min(d.width - 1, Math.max(0, Math.round(u * (d.width - 1))));
    const py = Math.min(d.height - 1, Math.max(0, Math.round((1 - v) * (d.height - 1))));
    return d.data[(py * d.width + px) * 4] / 255;
  }

  _buildGeometry() {
    const W = this.data.width;
    const H = W / this.aspect;
    const ny = Math.max(8, Math.round(GRID_X / this.aspect));
    const geo = new THREE.PlaneGeometry(W, H, GRID_X, ny);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const d = this._sampleDepth(uv.getX(i), uv.getY(i));
      pos.setZ(i, (d - 0.5) * this.data.depthScale);
    }
    geo.computeVertexNormals();
    return geo;
  }

  rebuild() {
    this.mesh.geometry.dispose();
    this.mesh.geometry = this._buildGeometry();
  }

  restHeight() {
    return this.data.width / this.aspect / 2;
  }

  get meshes() {
    return [this.mesh];
  }

  receiverEntries() {
    return [{
      mesh: this.mesh,
      baseColor: '#ffffff',
      side: THREE.DoubleSide,
      map: this.texture
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
    if (this.mesh.material?.dispose) this.mesh.material.dispose();
    this.texture.dispose();
  }
}
