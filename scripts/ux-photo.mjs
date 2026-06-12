// 사진→3D 재구성 검증: 합성 깊이맵 경로(완전 검증) + 실모델 경로(차단 환경 graceful 실패)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';

const server = await createServer({ root: process.cwd(), server: { port: 5190 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
const dialogs = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('dialog', async (d) => { dialogs.push(d.message().slice(0, 90)); await d.accept(); });
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5190/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1. 합성 사진(벽돌 패턴) + 합성 깊이맵(중앙 돌출 기둥) → 표면 생성
await page.evaluate(async () => {
  const photo = document.createElement('canvas');
  photo.width = 400; photo.height = 300;
  const pc = photo.getContext('2d');
  pc.fillStyle = '#8a6f55'; pc.fillRect(0, 0, 400, 300);
  pc.strokeStyle = '#5d4a38';
  for (let y = 0; y < 300; y += 25) { pc.beginPath(); pc.moveTo(0, y); pc.lineTo(400, y); pc.stroke(); }
  for (let x = 0; x < 400; x += 50) { pc.beginPath(); pc.moveTo(x, 0); pc.lineTo(x, 300); pc.stroke(); }

  const depth = document.createElement('canvas');
  depth.width = 200; depth.height = 150;
  const dc = depth.getContext('2d');
  dc.fillStyle = '#333'; dc.fillRect(0, 0, 200, 150); // 배경(멀리)
  dc.fillStyle = '#eee'; dc.fillRect(80, 0, 40, 150); // 중앙 세로 기둥(가까이)

  await window.__app._addPhotoFromData({
    fileName: 'wall.jpg',
    photoB64: photo.toDataURL('image/jpeg', 0.9),
    depthB64: depth.toDataURL('image/png'),
    width: 4,
    depthScale: 0.8
  }, { silent: false });
});
await page.waitForTimeout(1000);

const s1 = await page.evaluate(() => {
  const o = window.__app.objects[0];
  const pos = o.mesh.geometry.getAttribute('position');
  let zMin = 1e9, zMax = -1e9;
  for (let i = 0; i < pos.count; i++) {
    zMin = Math.min(zMin, pos.getZ(i));
    zMax = Math.max(zMax, pos.getZ(i));
  }
  const mat = o.mesh.material;
  return {
    type: o.data.type,
    zSpread: +(zMax - zMin).toFixed(2),
    hasMap: mat.uniforms?.uHasMap?.value,
    mapOk: !!mat.uniforms?.uMap?.value,
    receivers: window.__app.manager.receivers.length,
    panel: document.querySelector('#props-body h4')?.textContent
  };
});
step(`합성 경로: type=${s1.type}, 릴리프 깊이=${s1.zSpread}m(≈0.73 기대), 텍스처=${s1.hasMap}/${s1.mapOk}, 리시버=${s1.receivers}, 패널="${s1.panel}"`);

// 2. 폭 변경 4→6m
await page.evaluate(() => {
  const o = window.__app.objects[0];
  o.data.width = 6;
  o.rebuild();
  window.__app.touch();
});
await page.waitForTimeout(500);
const w6 = await page.evaluate(() => {
  const o = window.__app.objects[0];
  o.mesh.geometry.computeBoundingBox();
  const b = o.mesh.geometry.boundingBox;
  return +(b.max.x - b.min.x).toFixed(2);
});
step(`폭 변경: 실측 ${w6}m (6 기대)`);

// 3. 프로젝터로 릴리프에 투사 + 스크린샷 (기둥 그림자 확인용 측면 투사)
await page.evaluate(() => {
  const app = window.__app;
  const p = app.projectors[0];
  p.data.position = [3.5, 1.6, 2.5];
  p.syncFromData();
  p.aimAt(app.objects[0].group.position.clone());
  app.touch();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/ph-01-relief.png' });
step('릴리프 투사 스크린샷 저장');

// 4. 저장/불러오기 라운드트립
const dl = page.waitForEvent('download');
await page.click('#btn-save');
const saved = await (await dl).path();
await page.evaluate(() => window.__app.removeObject(window.__app.objects[0].data.id));
const fc = page.waitForEvent('filechooser');
await page.click('#btn-load');
await (await fc).setFiles(saved);
await page.waitForFunction(() => window.__app.objects.length === 1, { timeout: 10000 });
const rt = await page.evaluate(() => {
  const o = window.__app.objects[0];
  return { type: o.data.type, width: o.data.width, name: o.data.name };
});
step(`라운드트립: ${JSON.stringify(rt)} (photo/6m 기대)`);

// 5. 실모델 경로: HF 차단 환경에서 graceful 실패 + 버튼 복구
const fc2 = page.waitForEvent('filechooser');
await page.click('#btn-add-photo');
await (await fc2).setFiles(path.resolve('scripts/vw-01-quad.png'));
await page.waitForTimeout(20000);
const btnState = await page.evaluate(() => ({
  disabled: document.getElementById('btn-add-photo').disabled,
  text: document.getElementById('btn-add-photo').textContent
}));
step(`실모델 경로(차단 환경): 알림="${dialogs[dialogs.length - 1] || '없음'}" 버튼복구=${!btnState.disabled}/"${btnState.text}"`);

console.log('\n=== ERRORS(예상된 모델 다운로드 실패 제외) ===');
const realErrors = errors.filter((e) => !/huggingface|fetch|Failed to load|ERR_|403|network/i.test(e));
console.log(realErrors.length ? realErrors.join('\n').slice(0, 1200) : '없음');
await browser.close();
await server.close();
