// 2차 UX 검증: 기즈모 드래그 실증 + 수정 사항 확인
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5197 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => d.accept());
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5197/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 화면 좌표 헬퍼: 월드 좌표 → 캔버스 픽셀
const toScreen = (wx, wy, wz) => page.evaluate(([x, y, z]) => {
  const app = window.__app;
  const v = new (Object.getPrototypeOf(app.camera.position).constructor)(x, y, z);
  v.project(app.camera);
  const r = app.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
}, [wx, wy, wz]);

// 1. 기즈모 드래그 (X축 화살표)
const p0 = await page.evaluate(() => window.__app.projectors[0].data.position.slice());
step(`드래그 전 위치: [${p0.map((v) => v.toFixed(2))}]`);
const origin = await toScreen(p0[0], p0[1], p0[2]);
const xTip = await toScreen(p0[0] + 1, p0[1], p0[2]);
const dir = { x: xTip.x - origin.x, y: xTip.y - origin.y };
const len = Math.hypot(dir.x, dir.y);
const grab = { x: origin.x + (dir.x / len) * 55, y: origin.y + (dir.y / len) * 55 };
await page.mouse.move(grab.x, grab.y);
await page.waitForTimeout(300);
await page.mouse.down();
await page.waitForTimeout(200);
await page.mouse.move(grab.x + (dir.x / len) * 80, grab.y + (dir.y / len) * 80, { steps: 12 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(500);
const p1 = await page.evaluate(() => window.__app.projectors[0].data.position.slice());
const moved = Math.abs(p1[0] - p0[0]) > 0.1;
step(`기즈모 X 드래그 → 위치 [${p1.map((v) => v.toFixed(2))}], X 이동됨: ${moved}`);
const fieldVal = await page.evaluate(() => {
  const rows = document.querySelectorAll('#props-body .prop-row3');
  return rows[1]?.querySelectorAll('input')[0]?.value; // 위치 XYZ 행
});
step(`속성 패널 X 필드 동기화: ${fieldVal}`);

// 2. 파사드에서 신규 추가 → 환경 인지형 스폰
await page.selectOption('#env-preset', 'facade');
await page.waitForTimeout(800);
await page.click('#btn-add-projector');
await page.waitForTimeout(800);
const spawn = await page.evaluate(() => {
  const p = window.__app.selectedProjector();
  return { pos: p.data.position.map((v) => +v.toFixed(2)), tilt: +p.data.tilt.toFixed(1) };
});
step(`파사드 신규 스폰: pos=[${spawn.pos}], tilt=${spawn.tilt}° (면을 향해야 함)`);
await page.screenshot({ path: 'scripts/ux2-01-facade-spawn.png' });

// 3. 삭제 → 인접 자동 선택
await page.click('#btn-add-projector');
await page.waitForTimeout(400);
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
const afterDel = await page.evaluate(() => ({
  count: window.__app.projectors.length,
  selected: window.__app.selectedProjector()?.data.name || null
}));
step(`삭제 후: ${afterDel.count}대, 자동 선택=${afterDel.selected}`);

// 4. 도우미: 명암비 7:1 기본 → 스택/대수 반영
await page.click('#btn-assistant');
await page.waitForTimeout(300);
await page.click('#as-calc');
await page.waitForTimeout(300);
const planText = (await page.textContent('#as-result')).replace(/\s+/g, ' ').trim();
step(`도우미(파사드, 명암비 7:1): ${planText.slice(0, 280)}`);
await page.click('#as-apply');
await page.waitForTimeout(1500);
const appliedCount = await page.evaluate(() => window.__app.projectors.length);
step(`적용 대수: ${appliedCount}`);
await page.screenshot({ path: 'scripts/ux2-02-plan-stack.png' });

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1500) : '없음'));
await browser.close();
await server.close();
