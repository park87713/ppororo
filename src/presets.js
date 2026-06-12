// 프로젝터 기종 프리셋 — 실무에서 흔히 쓰이는 사양대를 일반화한 값
// tr: [최소, 최대] 스로우비(투사거리 / 화면폭), shiftV/H: 렌즈 시프트 가동 범위(화면 대비 비율)
export const PROJECTOR_SPECS = [
  {
    id: 'wuxga7500',
    name: '설치형 WUXGA 7,500lm',
    resX: 1920, resY: 1200, lumens: 7500,
    tr: [1.2, 2.0], shiftV: 0.5, shiftH: 0.2
  },
  {
    id: 'fhd6000',
    name: '설치형 FHD 6,000lm',
    resX: 1920, resY: 1080, lumens: 6000,
    tr: [1.3, 2.1], shiftV: 0.4, shiftH: 0.15
  },
  {
    id: 'xga4000',
    name: '비즈니스 XGA 4,000lm',
    resX: 1024, resY: 768, lumens: 4000,
    tr: [1.4, 2.2], shiftV: 0.3, shiftH: 0.1
  },
  {
    id: 'uhd12000',
    name: '대형 행사용 4K 12,000lm',
    resX: 3840, resY: 2160, lumens: 12000,
    tr: [1.4, 2.8], shiftV: 0.6, shiftH: 0.25
  },
  {
    id: 'uhd20000',
    name: '대형 행사용 4K 20,000lm',
    resX: 3840, resY: 2160, lumens: 20000,
    tr: [1.5, 3.0], shiftV: 0.6, shiftH: 0.3
  },
  {
    id: 'uhd20000lt',
    name: '대형 4K 20,000lm + 장초점 렌즈 (7.4–14.6:1)',
    resX: 3840, resY: 2160, lumens: 20000,
    tr: [7.4, 14.6], shiftV: 0.6, shiftH: 0.3
  },
  {
    id: 'wuxga30000lt',
    name: '최대급 WUXGA 30,000lm + 장초점 렌즈',
    resX: 1920, resY: 1200, lumens: 30000,
    tr: [7.4, 14.6], shiftV: 0.5, shiftH: 0.25
  },
  {
    id: 'ust4500',
    name: '초단초점(UST) FHD 4,500lm',
    resX: 1920, resY: 1080, lumens: 4500,
    tr: [0.25, 0.25], shiftV: 0, shiftH: 0
  },
  {
    id: 'custom',
    name: '커스텀 (직접 입력)',
    resX: 1920, resY: 1080, lumens: 5000,
    tr: [0.25, 15.0], shiftV: 0.8, shiftH: 0.5
  }
];

export function getSpec(id) {
  return PROJECTOR_SPECS.find((s) => s.id === id) || PROJECTOR_SPECS[0];
}

// 프로젝터 구분용 팔레트
export const PROJECTOR_COLORS = [
  '#4da3ff', '#58c97b', '#f2a83b', '#e36ba8',
  '#6be3d9', '#c98bff', '#ffd84d', '#ff7a5c'
];

// 환경 프리셋 기본 파라미터 (단위: m)
export const ENV_DEFAULTS = {
  room:   { width: 10, depth: 8, height: 3.2 },
  facade: { width: 22, height: 14, ground: 60 },
  curved: { radius: 6, angleDeg: 120, height: 3.5, ground: 24 },
  stage:  { width: 14, depth: 10, height: 6 }
};

export const ENV_NAMES = {
  room: '실내 벽면',
  facade: '건물 파사드',
  curved: '곡면 스크린',
  stage: '무대 + 오브젝트'
};
