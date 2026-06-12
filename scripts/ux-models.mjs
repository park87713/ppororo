// 3D 모델 불러오기(.obj/.glb/.stl) 검증
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promap-models-'));

// --- 테스트 픽스처 생성 ---
// OBJ: 박스 + 지붕(두 오브젝트)
fs.writeFileSync(path.join(tmp, 'house.obj'), `
o body
v -1 0 -1
v 1 0 -1
v 1 2 -1
v -1 2 -1
v -1 0 1
v 1 0 1
v 1 2 1
v -1 2 1
f 1 2 3 4
f 5 8 7 6
f 1 4 8 5
f 2 6 7 3
f 4 3 7 8
f 1 5 6 2
o roof
v -1.2 2 -1.2
v 1.2 2 -1.2
v 1.2 2 1.2
v -1.2 2 1.2
v 0 3.2 0
f 9 10 13
f 10 11 13
f 11 12 13
f 12 9 13
`);

// GLB: 최소 스펙 수제 삼각형
function makeGlb() {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 2, 0] }]
  });
  const jsonBuf = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const bin = Buffer.alloc(36);
  [0, 0, 0, 2, 0, 0, 0, 2, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonBuf.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonBuf.length);
  bin.copy(out, 28 + jsonBuf.length);
  return out;
}
fs.writeFileSync(path.join(tmp, 'tri.glb'), makeGlb());

// STL: 바이너리 피라미드(4면)
function makeStl() {
  const tris = [
    [[0, 0, 0], [1, 0, 0], [0.5, 1, 0.5]],
    [[1, 0, 0], [1, 0, 1], [0.5, 1, 0.5]],
    [[1, 0, 1], [0, 0, 1], [0.5, 1, 0.5]],
    [[0, 0, 1], [0, 0, 0], [0.5, 1, 0.5]]
  ];
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, ti) => {
    const o = 84 + ti * 50 + 12;
    t.flat().forEach((v, i) => buf.writeFloatLE(v, o + i * 4));
  });
  return buf;
}
fs.writeFileSync(path.join(tmp, 'pyramid.stl'), makeStl());

// --- 브라우저 구동 ---
const server = await createServer({ root: process.cwd(), server: { port: 5194 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => { errors.push(`[dialog] ${d.message()}`); d.accept(); });
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5194/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

async function importFile(file) {
  const fc = page.waitForEvent('filechooser');
  await page.click('#btn-add-model');
  await (await fc).setFiles(file);
  await page.waitForFunction(
    (n) => window.__app.objects.length === n,
    (await page.evaluate(() => window.__app.objects.length)) + 1,
    { timeout: 10000 }
  );
}

// 1. OBJ 임포트 (멀티 메시)
await importFile(path.join(tmp, 'house.obj'));
const s1 = await page.evaluate(() => {
  const o = window.__app.objects[0];
  const THREE_Box = o.bbox.constructor;
  const box = new THREE_Box().setFromObject(o.group);
  return {
    type: o.data.type,
    meshes: o.meshes.length,
    receivers: window.__app.manager.receivers.length,
    sizeY: +(box.max.y - box.min.y).toFixed(2),
    minY: +box.min.y.toFixed(2),
    selected: window.__app.selectedObject()?.data.name,
    panelTitle: document.querySelector('#props-body h4')?.textContent
  };
});
step(`OBJ: type=${s1.type}, 메시 ${s1.meshes}개, 리시버 ${s1.receivers}, 정규화 높이=${s1.sizeY}m(2 기대), 바닥=${s1.minY}, 패널="${s1.panelTitle}"`);

// 2. 최대 변 2→4m 리스케일
const sizeInput = page.locator('#props-body .prop-group:nth-child(2) input[type=number]').first();
await sizeInput.fill('4');
await sizeInput.press('Enter');
await page.waitForTimeout(500);
const s2 = await page.evaluate(() => {
  const o = window.__app.objects[0];
  const box = new o.bbox.constructor().setFromObject(o.group);
  return +(box.max.y - box.min.y).toFixed(2);
});
step(`리스케일 4m: 실측 높이=${s2} (4 기대)`);
await page.screenshot({ path: 'scripts/mdl-01-obj.png' });

// 3. GLB + STL 임포트
await importFile(path.join(tmp, 'tri.glb'));
await importFile(path.join(tmp, 'pyramid.stl'));
const s3 = await page.evaluate(() => window.__app.objects.map((o) => `${o.data.fileName}(메시${o.meshes.length})`));
step(`GLB/STL 임포트: [${s3}]`);

// 4. 캔버스 클릭으로 모델 선택
await page.evaluate(() => window.__app.select(null));
const px = await page.evaluate(() => {
  const app = window.__app;
  const g = app.objects[0].group.position.clone();
  g.y += 1;
  const v = g.project(app.camera);
  const r = app.renderer.domElement.getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
});
await page.click('#panes', { position: { x: Math.round(px.x), y: Math.round(px.y) } });
await page.waitForTimeout(400);
step(`캔버스 클릭 선택: ${await page.evaluate(() => window.__app.selectedObject()?.data.name || null)} (O1 기대)`);

// 5. 저장/불러오기 라운드트립 (base64 임베드 복원)
const dl = page.waitForEvent('download');
await page.click('#btn-save');
const file = await dl;
const savedPath = await file.path();
await page.evaluate(() => { while (window.__app.objects.length) window.__app.removeObject(window.__app.objects[0].data.id); });
const fc2 = page.waitForEvent('filechooser');
await page.click('#btn-load');
await (await fc2).setFiles(savedPath);
await page.waitForFunction(() => window.__app.objects.length === 3, { timeout: 10000 });
const s5 = await page.evaluate(() => window.__app.objects.map((o) => `${o.data.fileName}:${o.data.targetSize}m`));
step(`라운드트립: [${s5}] (house 4m 유지 기대)`);
await page.screenshot({ path: 'scripts/mdl-02-final.png' });

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1500) : '없음'));
await browser.close();
await server.close();
