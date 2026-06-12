// 커스텀 투사 오브젝트 기능 검증
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5195 } });
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

await page.goto('http://localhost:5195/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1. 박스 추가 → 리스트/선택/속성/리시버 등록
await page.selectOption('#obj-type', 'box');
await page.click('#btn-add-object');
await page.waitForTimeout(700);
const s1 = await page.evaluate(() => ({
  objects: window.__app.objects.length,
  receivers: window.__app.manager.receivers.length,
  selected: window.__app.selectedObject()?.data.name,
  propsTitle: document.querySelector('#props-body h4')?.textContent
}));
step(`박스 추가: 오브젝트 ${s1.objects}, 리시버 ${s1.receivers}(환경4+1 기대), 선택=${s1.selected}, 패널="${s1.propsTitle}"`);
await page.screenshot({ path: 'scripts/obj-01-box.png' });

// 2. 크기 변경 (폭 3m)
const sizeInput = page.locator('#props-body .prop-group:nth-child(2) input[type=number]').first();
await sizeInput.fill('3');
await sizeInput.press('Enter');
await page.waitForTimeout(600);
const width = await page.evaluate(() => {
  const o = window.__app.selectedObject();
  o.mesh.geometry.computeBoundingBox();
  const b = o.mesh.geometry.boundingBox;
  return +(b.max.x - b.min.x).toFixed(2);
});
step(`크기 폭 1.5→3 변경: 지오메트리 실측 폭 = ${width}m`);

// 3. 구 + 벽/판 추가 (판은 양면 수광)
await page.selectOption('#obj-type', 'sphere');
await page.click('#btn-add-object');
await page.waitForTimeout(400);
await page.selectOption('#obj-type', 'plane');
await page.click('#btn-add-object');
await page.waitForTimeout(600);
const s3 = await page.evaluate(() => ({
  count: window.__app.objects.length,
  planeSide: window.__app.objects[2].mesh.material.side
}));
step(`구+판 추가: 총 ${s3.count}개, 판 side=${s3.planeSide} (DoubleSide=2 기대)`);
await page.screenshot({ path: 'scripts/obj-02-three.png' });

// 4. 캔버스 클릭으로 박스 선택
await page.evaluate(() => window.__app.select(null));
const boxPx = await page.evaluate(() => {
  const app = window.__app;
  const v = app.objects[0].group.position.clone().project(app.camera);
  const r = app.renderer.domElement.getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
});
await page.click('#panes', { position: { x: Math.round(boxPx.x), y: Math.round(boxPx.y) } });
await page.waitForTimeout(400);
const picked = await page.evaluate(() => window.__app.selectedObject()?.data.name || null);
step(`캔버스 클릭 선택: ${picked} (O1 기대)`);

// 5. 기즈모 드래그로 오브젝트 이동
const p0 = await page.evaluate(() => window.__app.selectedObject().data.position.map((v) => +v.toFixed(2)));
const o0 = await page.evaluate(() => {
  const app = window.__app;
  const g = app.selectedObject().group.position;
  const pr = (x, y, z) => {
    const v = new (Object.getPrototypeOf(g).constructor)(x, y, z).project(app.camera);
    const r = app.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  };
  return { o: pr(g.x, g.y, g.z), t: pr(g.x + 1, g.y, g.z) };
});
const dx = o0.t.x - o0.o.x, dy = o0.t.y - o0.o.y;
const dl = Math.hypot(dx, dy);
const gx = o0.o.x + (dx / dl) * 55, gy = o0.o.y + (dy / dl) * 55;
await page.mouse.move(gx, gy);
await page.mouse.down();
await page.mouse.move(gx + (dx / dl) * 70, gy + (dy / dl) * 70, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
const p1 = await page.evaluate(() => window.__app.selectedObject().data.position.map((v) => +v.toFixed(2)));
step(`오브젝트 기즈모 드래그: [${p0}] → [${p1}] 이동=${p0[0] !== p1[0]}`);

// 6. Ctrl+D 복제 → Delete 삭제
await page.keyboard.press('Control+d');
await page.waitForTimeout(400);
const afterDup = await page.evaluate(() => window.__app.objects.length);
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
const afterDel = await page.evaluate(() => window.__app.objects.length);
step(`Ctrl+D 복제 → ${afterDup}개, Delete → ${afterDel}개`);

// 7. 저장/불러오기 라운드트립 (오브젝트 보존)
const dl2 = page.waitForEvent('download');
await page.click('#btn-save');
const file = await dl2;
const path = await file.path();
await page.evaluate(() => { while (window.__app.objects.length) window.__app.removeObject(window.__app.objects[0].data.id); });
const fc = page.waitForEvent('filechooser');
await page.click('#btn-load');
await (await fc).setFiles(path);
await page.waitForTimeout(900);
const loaded = await page.evaluate(() => ({
  objects: window.__app.objects.map((o) => `${o.data.name}(${o.data.type})`),
  boxW: window.__app.objects[0]?.data.size.w
}));
step(`라운드트립: [${loaded.objects}], 박스 폭=${loaded.boxW} (3 기대)`);

// 8. 환경 전환에도 오브젝트 유지 + 무대 프리셋과 공존
await page.selectOption('#env-preset', 'stage');
await page.waitForTimeout(900);
const envKeep = await page.evaluate(() => ({
  objects: window.__app.objects.length,
  receivers: window.__app.manager.receivers.length
}));
step(`무대 전환: 오브젝트 ${envKeep.objects}개 유지, 리시버 ${envKeep.receivers}`);
await page.screenshot({ path: 'scripts/obj-03-stage.png' });

console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 1500) : '없음'));
await browser.close();
await server.close();
