import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.goto('file:///tmp/promap-sim.html');
await page.waitForTimeout(2500);
// 기본 동작 확인: 도우미 계산 + 모드 전환 + 오브젝트 추가
await page.click('#btn-assistant'); await page.waitForTimeout(300);
await page.click('#as-calc'); await page.waitForTimeout(300);
const plan = (await page.textContent('#as-result')).replace(/\s+/g,' ').slice(0, 80);
await page.click('#as-close');
await page.click('#view-mode button[data-mode="1"]'); await page.waitForTimeout(400);
await page.click('#view-mode button[data-mode="0"]');
await page.click('#btn-add-object'); await page.waitForTimeout(600);
const state = await page.evaluate(() => ({
  projectors: window.__app.projectors.length,
  objects: window.__app.objects.length,
  status: document.getElementById('metric-detail').textContent
}));
await page.screenshot({ path: '/home/user/ppororo/scripts/single-01.png' });
console.log('도우미:', plan);
console.log('상태:', JSON.stringify(state));
console.log('에러:', errors.length ? errors.join(' | ').slice(0,500) : '없음');
await browser.close();
