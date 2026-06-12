// 장초점(최대 14.6:1) 300m 원거리 투사 검증
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5193 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5193/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 파사드 + 가용 깊이 350m, 장초점 기종으로 300m 투사
await page.evaluate(() => {
  const app = window.__app;
  app.setEnvironment('facade', { width: 40, height: 25, ground: 350 });
  const p = app.projectors[0];
  app.changeSpec(p.data.id, 'uhd20000lt');
  p.data.throwRatio = 14.6;
  p.data.position = [0, 12, 300];
  p.data.pan = 0;
  p.data.tilt = 0;
  p.syncFromData();
  app.touch();
});
await page.waitForTimeout(1500);
const m = await page.evaluate(() => {
  const app = window.__app;
  const p = app.projectors[0];
  const r = p.computeMetrics(app.receiverMeshes);
  return r && {
    dist: +r.dist.toFixed(1),
    w: +r.w.toFixed(2),
    h: +r.h.toFixed(2),
    pxm: +r.pxPerM.toFixed(0),
    lux: +r.lux.toFixed(0),
    tr: p.data.throwRatio,
    fov: +p.camera.fov.toFixed(2)
  };
});
step(`300m 장초점: TR=${m.tr}, 투사거리 ${m.dist}m, 화면 ${m.w}×${m.h}m, ${m.pxm}px/m, ${m.lux}lx, fovY=${m.fov}°`);
// 기대값: w = 300/14.6 = 20.55m

// 도우미 TR 상한 확인
await page.click('#btn-assistant');
await page.waitForTimeout(300);
const specOptions = await page.evaluate(() => [...document.querySelectorAll('#as-spec option')].map((o) => o.value));
step(`도우미 기종 목록: ${specOptions.join(', ')}`);
await page.selectOption('#as-spec', 'uhd20000lt');
const trVal = await page.inputValue('#as-tr');
step(`장초점 선택 시 기본 TR: ${trVal} (11.0 = (7.4+14.6)/2 기대)`);
await page.click('#as-close');

// 화면 확인
await page.evaluate(() => {
  const app = window.__app;
  app.controls.target.set(0, 12, 0);
  app.camera.position.set(60, 40, 380);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/lt-01-300m.png' });

// 커스텀 스로우비 슬라이더 상한
await page.evaluate(() => {
  const app = window.__app;
  app.changeSpec(app.projectors[0].data.id, 'custom');
  app.select(app.projectors[0].data.id);
});
await page.waitForTimeout(500);
const slider = await page.evaluate(() => {
  const r = document.querySelector('#props-body .prop-group:nth-child(3) input[type=range]');
  return { min: r.min, max: r.max };
});
step(`커스텀 스로우비 범위: ${slider.min} ~ ${slider.max}`);

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1200) : '없음'));
await browser.close();
await server.close();
