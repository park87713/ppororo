// 엣지 블렌딩 분석 검증: 기하 기준값과 실측 대조
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5192 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 기준 배치: TR1.6, 벽까지 4.8m → 이미지 폭 3.0m; 중심 간격 2.4m → 오버랩 0.6m = 20%
await page.evaluate(() => {
  const app = window.__app;
  app.setEnvironment('room', { width: 12, depth: 8, height: 3.2 });
  const p1 = app.projectors[0];
  Object.assign(p1.data, { position: [-1.2, 1.5, 0.8], pan: 0, tilt: 0, roll: 0, throwRatio: 1.6 });
  p1.syncFromData();
  app.addProjector({ position: [1.2, 1.5, 0.8], pan: 0, tilt: 0, throwRatio: 1.6 });
  app.touch();
});
await page.waitForTimeout(1200);

// 1. 분석 모달
await page.click('#btn-blend-calc');
await page.waitForTimeout(500);
const text1 = (await page.textContent('#blend-body')).replace(/\s+/g, ' ').trim();
step(`20% 기준 분석: ${text1.slice(0, 320)}`);
await page.screenshot({ path: 'scripts/bl-01-analysis.png' });

// 2. 측정값 램프 적용
await page.click('#blend-apply');
await page.waitForTimeout(400);
const ramp = await page.evaluate(() => ({
  value: Math.round(window.__app.manager.globals.uBlendRamp.value * 100),
  toggled: document.getElementById('blend-toggle').checked
}));
step(`램프 적용: ${ramp.value}% (≈20 기대), 토글=${ramp.toggled}`);
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/bl-02-ramp.png' });

// 3. 스택 감지 (동일 위치)
await page.evaluate(() => {
  const app = window.__app;
  const p2 = app.projectors[1];
  p2.data.position = [-1.2, 1.5, 0.8];
  p2.syncFromData();
  app.touch();
});
await page.waitForTimeout(600);
await page.click('#btn-blend-calc');
await page.waitForTimeout(500);
const text2 = (await page.textContent('#blend-body')).replace(/\s+/g, ' ');
step(`스택 감지: ${text2.includes('스택') ? '✓ 스택(이중 투사) 인식' : '✗ 미감지: ' + text2.slice(0, 120)}`);
await page.click('#modal-backdrop', { position: { x: 15, y: 300 } });

// 4. 비중첩 케이스
await page.evaluate(() => {
  const app = window.__app;
  const p2 = app.projectors[1];
  p2.data.position = [4.5, 1.5, 0.8];
  p2.syncFromData();
  app.touch();
});
await page.waitForTimeout(600);
await page.click('#btn-blend-calc');
await page.waitForTimeout(500);
const text3 = (await page.textContent('#blend-body')).replace(/\s+/g, ' ');
step(`비중첩: ${text3.includes('없습니다') ? '✓ 중첩 없음 안내' : '✗ ' + text3.slice(0, 120)}`);

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1200) : '없음'));
await browser.close();
await server.close();
