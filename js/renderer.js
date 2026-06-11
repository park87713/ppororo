/* WebGL 렌더러: 서피스(쿼드/메시)를 호모그래피 워핑하여 출력 캔버스에 그린다.
 *
 * 쿼드는 정점 4개만으로 정확한 투시 워핑을 한다:
 * 출력 코너 → 소스 UV 호모그래피 H를 구해 각 정점에 H·[x,y,1] (동차 좌표)를
 * varying으로 넘기고, 프래그먼트에서 w로 나누면 보간이 호모그래피와 정확히 일치한다.
 * (H·[x,y,1]는 (x,y)에 선형이므로 화면 선형 보간이 곧 정확한 값이다.) */
"use strict";

const VERT_SRC = `
attribute vec2 a_pos;    // 출력 픽셀 좌표
attribute vec3 a_tex;    // 동차 텍스처 좌표 (uv*w, w)
attribute vec3 a_param;  // 동차 서피스 파라미터 좌표 (엣지 블렌딩용)
uniform vec2 u_res;
varying vec3 v_tex;
varying vec3 v_param;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_tex = a_tex;
  v_param = a_param;
}`;

const FRAG_SRC = `
precision mediump float;
varying vec3 v_tex;
varying vec3 v_param;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform vec3 u_tint;
uniform vec4 u_blend; // 좌 우 상 하 블렌드 폭 (파라미터 공간 0..0.5)

float edgeFade(float d, float w) {
  if (w <= 0.0005) return 1.0;
  float t = clamp(d / w, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t); // smoothstep
}

void main() {
  vec2 uv = clamp(v_tex.xy / v_tex.z, 0.0, 1.0);
  vec4 c = texture2D(u_tex, uv);

  vec3 rgb = (c.rgb - 0.5) * u_contrast + 0.5;
  rgb += (u_brightness - 1.0);
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(luma), rgb, u_saturation);
  rgb *= u_tint;

  vec2 p = clamp(v_param.xy / v_param.z, 0.0, 1.0);
  float fade = edgeFade(p.x, u_blend.x)
             * edgeFade(1.0 - p.x, u_blend.y)
             * edgeFade(p.y, u_blend.z)
             * edgeFade(1.0 - p.y, u_blend.w);

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a * u_opacity * fade);
}`;

const UNIT_QUAD = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    if (!gl) throw new Error("WebGL을 사용할 수 없습니다.");
    this.gl = gl;

    this.program = this._buildProgram(VERT_SRC, FRAG_SRC);
    gl.useProgram(this.program);

    this.loc = {
      a_pos: gl.getAttribLocation(this.program, "a_pos"),
      a_tex: gl.getAttribLocation(this.program, "a_tex"),
      a_param: gl.getAttribLocation(this.program, "a_param"),
      u_res: gl.getUniformLocation(this.program, "u_res"),
      u_tex: gl.getUniformLocation(this.program, "u_tex"),
      u_opacity: gl.getUniformLocation(this.program, "u_opacity"),
      u_brightness: gl.getUniformLocation(this.program, "u_brightness"),
      u_contrast: gl.getUniformLocation(this.program, "u_contrast"),
      u_saturation: gl.getUniformLocation(this.program, "u_saturation"),
      u_tint: gl.getUniformLocation(this.program, "u_tint"),
      u_blend: gl.getUniformLocation(this.program, "u_blend"),
    };

    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();

    // 미디어가 없을 때 쓰는 1x1 회색 텍스처
    this.fallbackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fallbackTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
                  gl.UNSIGNED_BYTE, new Uint8Array([80, 80, 80, 255]));

    this.textures = new Map(); // mediaId -> { tex, isVideo }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _buildProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error("셰이더 컴파일 실패: " + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("프로그램 링크 실패: " + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  /* 미디어 텍스처 확보. 비디오는 매 프레임 갱신한다. */
  _bindMediaTexture(media) {
    const gl = this.gl;
    if (!media || !media.source) {
      gl.bindTexture(gl.TEXTURE_2D, this.fallbackTex);
      return;
    }
    let entry = this.textures.get(media.id);
    if (!entry) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      entry = { tex, uploaded: false };
      this.textures.set(media.id, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);

    const isVideo = media.kind === "video";
    if (isVideo) {
      if (media.source.readyState >= 2) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.source);
        entry.uploaded = true;
      } else if (!entry.uploaded) {
        gl.bindTexture(gl.TEXTURE_2D, this.fallbackTex);
      }
    } else if (!entry.uploaded || media.dirty) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.source);
      entry.uploaded = true;
      media.dirty = false;
    }
  }

  releaseMedia(mediaId) {
    const entry = this.textures.get(mediaId);
    if (entry) {
      this.gl.deleteTexture(entry.tex);
      this.textures.delete(mediaId);
    }
  }

  /* 쿼드 서피스 지오메트리: 정점 4개 + 동차 좌표 */
  _quadGeometry(s) {
    const hTex = H3.quadToQuad(s.dst, s.src);
    const hParam = H3.quadToQuad(s.dst, UNIT_QUAD);
    const verts = new Float32Array(4 * 8);
    for (let i = 0; i < 4; i++) {
      const [x, y] = s.dst[i];
      const t = H3.applyHomogeneous(hTex, x, y);
      const p = H3.applyHomogeneous(hParam, x, y);
      verts.set([x, y, t[0], t[1], t[2], p[0], p[1], p[2]], i * 8);
    }
    return { verts, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
  }

  /* 메시 서피스 지오메트리: 컨트롤 그리드를 삼각형으로 분할.
   * 소스 UV는 src 코너 사각형의 이중선형 보간. */
  _meshGeometry(s) {
    const { cols, rows, points, src } = s;
    const verts = new Float32Array(cols * rows * 8);
    const [s0, s1, s2, s3] = src; // TL TR BR BL
    let vi = 0;
    for (let j = 0; j < rows; j++) {
      const v = j / (rows - 1);
      for (let i = 0; i < cols; i++) {
        const u = i / (cols - 1);
        const [x, y] = points[j * cols + i];
        const tu = (1 - v) * ((1 - u) * s0[0] + u * s1[0]) + v * ((1 - u) * s3[0] + u * s2[0]);
        const tv = (1 - v) * ((1 - u) * s0[1] + u * s1[1]) + v * ((1 - u) * s3[1] + u * s2[1]);
        verts.set([x, y, tu, tv, 1, u, v, 1], vi);
        vi += 8;
      }
    }
    const indices = new Uint16Array((cols - 1) * (rows - 1) * 6);
    let ii = 0;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.set([a, b, d, a, d, c], ii);
        ii += 6;
      }
    }
    return { verts, indices };
  }

  render(state, mediaById) {
    const gl = this.gl;
    const { w, h } = state.output;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniform2f(this.loc.u_res, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.loc.u_tex, 0);

    for (const s of state.surfaces) {
      if (!s.visible) continue;

      const geo = s.type === "mesh" ? this._meshGeometry(s) : this._quadGeometry(s);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.DYNAMIC_DRAW);

      const STRIDE = 8 * 4;
      gl.enableVertexAttribArray(this.loc.a_pos);
      gl.vertexAttribPointer(this.loc.a_pos, 2, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(this.loc.a_tex);
      gl.vertexAttribPointer(this.loc.a_tex, 3, gl.FLOAT, false, STRIDE, 8);
      gl.enableVertexAttribArray(this.loc.a_param);
      gl.vertexAttribPointer(this.loc.a_param, 3, gl.FLOAT, false, STRIDE, 20);

      this._bindMediaTexture(mediaById(s.mediaId));

      const tint = hexToRgb(s.tint);
      gl.uniform1f(this.loc.u_opacity, s.opacity);
      gl.uniform1f(this.loc.u_brightness, s.brightness);
      gl.uniform1f(this.loc.u_contrast, s.contrast);
      gl.uniform1f(this.loc.u_saturation, s.saturation);
      gl.uniform3f(this.loc.u_tint, tint[0], tint[1], tint[2]);
      gl.uniform4f(this.loc.u_blend, s.blend.l, s.blend.r, s.blend.t, s.blend.b);

      gl.drawElements(gl.TRIANGLES, geo.indices.length, gl.UNSIGNED_SHORT, 0);
    }
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
