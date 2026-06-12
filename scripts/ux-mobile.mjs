// 모바일(터치) 구동 검증: iPhone급 뷰포트 + CDP 터치 제스처
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5196 } });
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  deviceScaleFactor: 2,
  browserName: undefined
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => d.accept());
const step = (s) => console.log('STEP:', s);

await page.goto('http://localhost:5196/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

// 1. 초기 레이아웃: 패널 드로어 숨김 + 뷰포트 전체폭
const layout = await page.evaluate(() => ({
  vw: document.getElementById('viewport').clientWidth,
  win: window.innerWidth,
  leftHidden: getComputedStyle(document.getElementById('left-panel')).transform !== 'none'
}));
step(`레이아웃: viewport ${layout.vw}px / window ${layout.win}px, 좌패널 드로어화=${layout.leftHidden}`);
await page.screenshot({ path: 'scripts/mob-01-initial.png' });

// 2. ☰ → 좌측 드로어 → 리스트 탭 → 속성 드로어 자동 전환
await page.tap('#btn-panel-left');
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/mob-02-left-drawer.png' });
await page.tap('#projector-list li');
await page.waitForTimeout(500);
const drawerState = await page.evaluate(() => ({
  left: document.getElementById('left-panel').classList.contains('open'),
  right: document.getElementById('right-panel').classList.contains('open'),
  props: !document.getElementById('props-body').hidden
}));
step(`리스트 탭 → 좌닫힘=${!drawerState.left}, 속성 드로어 열림=${drawerState.right}, 속성표시=${drawerState.props}`);
await page.screenshot({ path: 'scripts/mob-03-props-drawer.png' });

// 3. 백드롭 탭으로 닫기
await page.tap('#drawer-backdrop', { position: { x: 15, y: 300 } });
await page.waitForTimeout(400);
const closed = await page.evaluate(() => !document.getElementById('right-panel').classList.contains('open'));
step(`백드롭 탭 → 드로어 닫힘: ${closed}`);

// 4. 터치 스와이프로 카메라 회전 (CDP 터치 이벤트)
const camBefore = await page.evaluate(() => window.__app.camera.position.toArray().map((v) => +v.toFixed(2)));
const cdp = await ctx.newCDPSession(page);
const swipe = async (x1, y1, x2, y2) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 }]
    });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
await swipe(195, 500, 90, 460);
await page.waitForTimeout(600);
const camAfter = await page.evaluate(() => window.__app.camera.position.toArray().map((v) => +v.toFixed(2)));
step(`터치 스와이프 궤도 회전: [${camBefore}] → [${camAfter}] 변화=${camBefore[0] !== camAfter[0]}`);

// 5. 뷰포트 툴: 회전 모드 탭
await page.tap('#vt-rotate');
await page.waitForTimeout(200);
const mode = await page.evaluate(() => window.__app.transform.mode);
step(`'회전' 버튼 탭 → 기즈모 모드: ${mode}`);
await page.tap('#vt-move');

// 6. 정조준 버튼
await page.tap('#vt-aim');
await page.waitForTimeout(300);
step('정조준 버튼 탭 — 에러 없으면 통과');

// 7. 도우미 모달 (모바일 폭 맞춤)
await page.tap('#btn-assistant');
await page.waitForTimeout(400);
await page.tap('#as-calc');
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/mob-04-assistant.png' });
const modalFits = await page.evaluate(() => {
  const m = document.getElementById('assistant-modal');
  return m.getBoundingClientRect().width <= window.innerWidth;
});
step(`도우미 모달 폭 적합: ${modalFits}`);
await page.tap('#as-close');

// 8. 캔버스에서 프로젝터 본체 탭 선택
await page.evaluate(() => window.__app.frameView());
await page.waitForTimeout(400);
const projPx = await page.evaluate(() => {
  const app = window.__app;
  const p = app.projectors[0];
  const v = p.worldPosition().project(app.camera);
  const r = app.renderer.domElement.getBoundingClientRect();
  // 캔버스 기준 상대 좌표
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
});
await page.evaluate(() => window.__app.select(null));
await page.tap('#viewport canvas', { position: { x: Math.round(projPx.x), y: Math.round(projPx.y) } });
await page.waitForTimeout(400);
const tappedSel = await page.evaluate(() => window.__app.selectedProjector()?.data.name || null);
step(`캔버스 본체 탭 선택: ${tappedSel}`);
await page.screenshot({ path: 'scripts/mob-05-final.png' });

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1500) : '없음'));
await browser.close();
await server.close();
