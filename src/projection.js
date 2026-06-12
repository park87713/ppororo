import * as THREE from 'three';

// 투사광을 받는 표면용 셰이더를 프로젝터 수(n)에 맞춰 생성/관리한다.
// 각 프로젝터는 view-projection 행렬 + 깊이맵(차폐 판정용)을 제공하고,
// 표면 셰이더는 프래그먼트마다 어떤 프로젝터 빛이 닿는지 누적 계산한다.

const DEPTH_MAP_SIZE = 1024;

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

function fragmentShader(n) {
  let uniforms = '';
  let blocks = '';
  for (let i = 0; i < n; i++) {
    uniforms += /* glsl */ `
uniform mat4 uPM_${i};
uniform vec3 uPos_${i};
uniform vec3 uFwd_${i};
uniform vec3 uColor_${i};
uniform float uLumens_${i};
uniform vec2 uTan_${i};
uniform vec2 uRes_${i};
uniform float uOn_${i};
uniform sampler2D uDepth_${i};
`;
    blocks += /* glsl */ `
  {
    vec4 pc = uPM_${i} * vec4(vWorldPos, 1.0);
    if (uOn_${i} > 0.5 && pc.w > 0.0) {
      vec3 ndc = pc.xyz / pc.w;
      vec2 uv = ndc.xy * 0.5 + 0.5;
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && ndc.z < 1.0) {
        vec3 toFrag = vWorldPos - uPos_${i};
        float distAxis = dot(toFrag, uFwd_${i});
        if (distAxis > 0.05) {
          vec3 dir = normalize(toFrag);
          float facing = max(0.0, -dot(N, dir));
          float sampled = texture2D(uDepth_${i}, uv).x;
          float fragD = ndc.z * 0.5 + 0.5;
          float bias = 0.0006 + 0.0025 * (1.0 - facing);
          if (facing > 0.02 && fragD - bias <= sampled) {
            float w = 2.0 * distAxis * uTan_${i}.x;
            float h = 2.0 * distAxis * uTan_${i}.y;
            float lux = uLumens_${i} / max(w * h, 1e-4);
            float blend = 1.0;
            if (uBlendRamp > 0.001) {
              vec2 e = min(uv, 1.0 - uv);
              blend = smoothstep(0.0, uBlendRamp, e.x) * smoothstep(0.0, uBlendRamp, e.y);
            }
            vec3 pat;
            if (uPattern == 1) pat = vec3(1.0);
            else if (uPattern == 2) pat = bars(uv);
            else pat = vec3(gridPattern(uv, uRes_${i}));
            float energy = lux * blend * facing;
            totalLux += energy;
            coverage += 1.0;
            light += pat * uColor_${i} * energy;
          }
        }
      }
    }
  }
`;
  }

  return /* glsl */ `
uniform vec3 uBaseColor;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uAmbient;
uniform int uViewMode;   // 0 투사, 1 커버리지, 2 조도
uniform int uPattern;    // 0 그리드, 1 화이트, 2 컬러바
uniform float uBlendRamp;
uniform float uExposure; // full white 로 매핑되는 lux

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

${uniforms}

float gridPattern(vec2 uv, vec2 res) {
  float aspect = res.x / max(res.y, 1.0);
  float nx = 8.0;
  float ny = max(2.0, floor(nx / aspect + 0.5));
  vec2 g = fract(uv * vec2(nx, ny));
  vec2 d = min(g, 1.0 - g);
  float line = step(min(d.x, d.y), 0.03);
  vec2 b = min(uv, 1.0 - uv);
  float border = step(min(b.x, b.y), 0.012);
  float crossH = step(abs(uv.x - 0.5), 0.004);
  float crossV = step(abs(uv.y - 0.5), 0.004);
  return clamp(0.28 + line * 0.72 + border + crossH + crossV, 0.0, 1.0);
}

vec3 bars(vec2 uv) {
  float i = floor(uv.x * 8.0);
  if (i < 0.5) return vec3(1.0);
  else if (i < 1.5) return vec3(1.0, 1.0, 0.0);
  else if (i < 2.5) return vec3(0.0, 1.0, 1.0);
  else if (i < 3.5) return vec3(0.0, 1.0, 0.0);
  else if (i < 4.5) return vec3(1.0, 0.0, 1.0);
  else if (i < 5.5) return vec3(1.0, 0.0, 0.0);
  else if (i < 6.5) return vec3(0.0, 0.0, 1.0);
  return vec3(0.08);
}

vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.04, 0.01, 0.22);
  vec3 c1 = vec3(0.0, 0.55, 1.0);
  vec3 c2 = vec3(0.15, 0.95, 0.25);
  vec3 c3 = vec3(1.0, 0.9, 0.0);
  vec3 c4 = vec3(1.0, 0.12, 0.0);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  else if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  else if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  // 양면 재질(벽/판)도 빛을 받도록 보는 면 기준으로 법선 정렬
  vec3 N = gl_FrontFacing ? vWorldNormal : -vWorldNormal;
  vec3 light = vec3(0.0);
  float totalLux = 0.0;
  float coverage = 0.0;

${blocks}

  vec3 hemi = mix(vec3(0.62, 0.58, 0.55), vec3(1.0), N.y * 0.5 + 0.5);
  vec3 albedo = mix(uBaseColor, texture2D(uMap, vUv).rgb, uHasMap);
  vec3 base = albedo * hemi;
  vec3 col;

  if (uViewMode == 1) {
    // 커버리지: 0대 어두움 / 1대 녹색 / 2대 황색(블렌드 구간) / 3대 이상 적색
    if (coverage < 0.5) col = base * 0.18;
    else if (coverage < 1.5) col = mix(base * 0.25, vec3(0.18, 0.78, 0.35), 0.85);
    else if (coverage < 2.5) col = mix(base * 0.25, vec3(0.95, 0.75, 0.15), 0.9);
    else col = mix(base * 0.25, vec3(0.9, 0.2, 0.15), 0.9);
  } else if (uViewMode == 2) {
    // 조도 히트맵: sqrt 스케일, 약 1000lx 에서 최댓값
    col = heat(sqrt(totalLux / 1000.0));
  } else {
    vec3 ambientTerm = base * mix(0.05, 0.9, uAmbient);
    vec3 projTerm = light / max(uExposure, 1.0);
    col = vec3(1.0) - exp(-(ambientTerm + projTerm) * 1.6);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
}

export class ProjectionManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.count = 0;
    this.shared = {};        // 프로젝터별 공유 uniform 객체
    this.globals = {
      uAmbient: { value: 0.35 },
      uViewMode: { value: 0 },
      uPattern: { value: 0 },
      uBlendRamp: { value: 0.0 },
      uExposure: { value: 220.0 }
    };
    this.receivers = [];     // { mesh, baseColor }
    this.depthTargets = [];
    this.depthOverride = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.depthDirty = true;
  }

  // 투사광을 받을 메시 등록 (환경 재구성 시 전체 교체)
  setReceivers(list) {
    this.receivers = list;
    this._applyMaterials();
  }

  setCount(n) {
    if (n === this.count) return;
    this.count = n;

    while (this.depthTargets.length < n) {
      const rt = new THREE.WebGLRenderTarget(DEPTH_MAP_SIZE, DEPTH_MAP_SIZE);
      rt.depthTexture = new THREE.DepthTexture(DEPTH_MAP_SIZE, DEPTH_MAP_SIZE);
      rt.depthTexture.type = THREE.UnsignedIntType;
      rt.depthTexture.minFilter = THREE.NearestFilter;
      rt.depthTexture.magFilter = THREE.NearestFilter;
      this.depthTargets.push(rt);
    }

    const shared = {};
    for (let i = 0; i < n; i++) {
      shared[`uPM_${i}`] = { value: new THREE.Matrix4() };
      shared[`uPos_${i}`] = { value: new THREE.Vector3() };
      shared[`uFwd_${i}`] = { value: new THREE.Vector3(0, 0, -1) };
      shared[`uColor_${i}`] = { value: new THREE.Color(1, 1, 1) };
      shared[`uLumens_${i}`] = { value: 0 };
      shared[`uTan_${i}`] = { value: new THREE.Vector2(0.4, 0.25) };
      shared[`uRes_${i}`] = { value: new THREE.Vector2(1920, 1080) };
      shared[`uOn_${i}`] = { value: 0 };
      shared[`uDepth_${i}`] = { value: this.depthTargets[i].depthTexture };
    }
    this.shared = shared;
    this._applyMaterials();
  }

  _applyMaterials() {
    const frag = fragmentShader(this.count);
    for (const r of this.receivers) {
      const old = r.mesh.material;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: frag,
        uniforms: {
          uBaseColor: { value: new THREE.Color(r.baseColor) },
          uMap: { value: r.map || null },
          uHasMap: { value: r.map ? 1 : 0 },
          ...this.globals,
          ...this.shared
        }
      });
      mat.side = r.side ?? THREE.FrontSide;
      r.mesh.material = mat;
      if (old && old.isShaderMaterial) old.dispose();
    }
    this.depthDirty = true;
  }

  // 프로젝터 i 의 uniform 갱신 (Projector.applyToUniforms 에서 호출)
  uniformsFor(i) {
    return {
      pm: this.shared[`uPM_${i}`],
      pos: this.shared[`uPos_${i}`],
      fwd: this.shared[`uFwd_${i}`],
      color: this.shared[`uColor_${i}`],
      lumens: this.shared[`uLumens_${i}`],
      tan: this.shared[`uTan_${i}`],
      res: this.shared[`uRes_${i}`],
      on: this.shared[`uOn_${i}`]
    };
  }

  // 각 프로젝터 시점에서 깊이맵 렌더 (차폐 판정용). 변경이 있을 때만.
  renderDepthMaps(scene, projectors) {
    if (!this.depthDirty) return;
    this.depthDirty = false;
    const prevTarget = this.renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthOverride;
    for (let i = 0; i < projectors.length && i < this.count; i++) {
      const cam = projectors[i].camera;
      cam.layers.set(0);
      this.renderer.setRenderTarget(this.depthTargets[i]);
      this.renderer.clear();
      this.renderer.render(scene, cam);
    }
    scene.overrideMaterial = prevOverride;
    this.renderer.setRenderTarget(prevTarget);
  }

  markDirty() {
    this.depthDirty = true;
  }
}
