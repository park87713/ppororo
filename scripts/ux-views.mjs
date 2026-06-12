// 뷰포트 분할 검증: 레이아웃 전환, 분할창별 시점/컨트롤, 직교 뷰 픽킹·기즈모, 저장 복원
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5191 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5191/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1. 기본 1분할 + 자유 시점 컨트롤 동작
const s1 = await page.evaluate(() => ({
  panes: window.__app.views.panes.length,
  type: window.__app.views.panes[0].type,
  hasControls: !!window.__app.controls
}));
step(`기본: ${s1.panes}분할, 시점=${s1.type}, 컨트롤=${s1.hasControls}`);

// 2. 4분할 전환 → 자유/상면/정면/측면
await page.click('#split-mode button[data-n="4"]');
await page.waitForTimeout(1000);
const s2 = await page.evaluate(() => window.__app.views.panes.map((p) => p.type));
step(`4분할: [${s2}]`);
await page.screenshot({ path: 'scripts/vw-01-quad.png' });

// 3. 상면(top) 분할창에서 프로젝터 클릭 선택
await page.evaluate(() => window.__app.select(null));
const topPick = await page.evaluate(() => {
  const app = window.__app;
  const pane = app.views.panes[1]; // top
  const cam = pane.camera;
  cam.updateMatrixWorld(true);
  const v = app.projectors[0].worldPosition().project(cam);
  const r = app.views.container.getBoundingClientRect();
  return {
    x: r.left + (pane.rect.x + ((v.x + 1) / 2) * pane.rect.w) * r.width,
    y: r.top + (pane.rect.y + ((1 - v.y) / 2) * pane.rect.h) * r.height
  };
});
await page.mouse.click(topPick.x, topPick.y);
await page.waitForTimeout(500);
const picked = await page.evaluate(() => window.__app.selectedProjector()?.data.name || null);
step(`상면 뷰에서 클릭 선택: ${picked} (P1 기대)`);

// 4. 상면 뷰에서 기즈모 드래그 (X축)
const before = await page.evaluate(() => window.__app.projectors[0].data.position.map((v) => +v.toFixed(2)));
const drag = await page.evaluate(() => {
  const app = window.__app;
  const pane = app.views.panes[1];
  const cam = pane.camera;
  const g = app.projectors[0].group.position;
  const r = app.views.container.getBoundingClientRect();
  const pr = (x, y, z) => {
    const v = new g.constructor(x, y, z).project(cam);
    return {
      x: r.left + (pane.rect.x + ((v.x + 1) / 2) * pane.rect.w) * r.width,
      y: r.top + (pane.rect.y + ((1 - v.y) / 2) * pane.rect.h) * r.height
    };
  };
  return { o: pr(g.x, g.y, g.z), t: pr(g.x + 1, g.y, g.z), pane: app.transformPane?.type };
});
step(`드래그 전 기즈모 바인딩 분할창: ${drag.pane} (top 기대 — 클릭 시 자동 전환)`);
const dx = drag.t.x - drag.o.x, dy = drag.t.y - drag.o.y;
const dl = Math.hypot(dx, dy);
const gx = drag.o.x + (dx / dl) * 50, gy = drag.o.y + (dy / dl) * 50;
await page.mouse.move(gx, gy);
await page.mouse.down();
await page.mouse.move(gx + (dx / dl) * 60, gy + (dy / dl) * 60, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
const after = await page.evaluate(() => window.__app.projectors[0].data.position.map((v) => +v.toFixed(2)));
step(`상면 뷰 기즈모 드래그: [${before}] → [${after}] 이동=${before[0] !== after[0]}`);

// 5. 분할창 시점 변경: 측면 → 프로젝터 POV
await page.evaluate(() => {
  const app = window.__app;
  app.views.setPaneType(app.views.panes[3], 'projector');
});
await page.waitForTimeout(800);
const label = await page.evaluate(() => window.__app.views.panes[3].label.textContent);
step(`프로젝터 POV 분할창: 라벨="${label}"`);
await page.screenshot({ path: 'scripts/vw-02-projector-pov.png' });

// 6. 저장 상태에 분할 레이아웃 포함 + 복원
const split = await page.evaluate(() => window.__app.serialize().display.split);
step(`직렬화: ${JSON.stringify(split)}`);
await page.evaluate(() => window.__app.views.setLayout(1));
await page.waitForTimeout(400);
await page.evaluate((s) => window.__app.views.applyState(s), split);
await page.waitForTimeout(600);
const restored = await page.evaluate(() => window.__app.views.panes.map((p) => p.type));
step(`복원: [${restored}]`);

// 7. 2/3분할 + 환경 전환 시 직교 뷰 리프레이밍
await page.click('#split-mode button[data-n="3"]');
await page.waitForTimeout(500);
await page.selectOption('#env-preset', 'facade');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'scripts/vw-03-three-facade.png' });
const s7 = await page.evaluate(() => ({
  panes: window.__app.views.panes.length,
  ext: +window.__app.views.panes[1].ext?.toFixed(1)
}));
step(`3분할+파사드: ${s7.panes}분할, 직교 범위=${s7.ext}m (환경 크기 반영)`);

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1500) : '없음'));
await browser.close();
await server.close();
