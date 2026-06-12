// 헤드리스 렌더링 스모크 테스트: 셰이더 컴파일/런타임 에러 검출 + 스크린샷
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5199 } });
await server.listen();

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    const t = msg.text();
    if (!t.includes('GPU stall') && !t.includes('Automatic fallback')) errors.push(`[${msg.type()}] ${t}`);
  }
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/shot-1-default.png' });

// 프로젝터 추가 → 멀티 투사
await page.click('#btn-add-projector');
await page.waitForTimeout(800);

// 커버리지 모드
await page.click('#view-mode button[data-mode="1"]');
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/shot-2-coverage.png' });

// 조도 모드 + 무대 환경
await page.click('#view-mode button[data-mode="2"]');
await page.selectOption('#env-preset', 'stage');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'scripts/shot-3-stage-lux.png' });

// 세팅 도우미: 곡면 환경에서 계산 → 적용
await page.click('#view-mode button[data-mode="0"]');
await page.selectOption('#env-preset', 'curved');
await page.waitForTimeout(600);
await page.click('#btn-assistant');
await page.waitForTimeout(300);
await page.click('#as-calc');
await page.waitForTimeout(300);
const resultText = await page.textContent('#as-result');
console.log('도우미 결과:', resultText.replace(/\s+/g, ' ').slice(0, 300));
await page.click('#as-apply');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/shot-4-curved-plan.png' });

const count = await page.evaluate(() => document.querySelectorAll('#projector-list li').length);
console.log('배치된 프로젝터 수:', count);
console.log('상태바:', await page.textContent('#status-bar'));

if (errors.length) {
  console.log('--- 콘솔 에러/경고 ---');
  for (const e of errors.slice(0, 20)) console.log(e.slice(0, 500));
  process.exitCode = 1;
} else {
  console.log('콘솔 에러 없음 ✓');
}

await browser.close();
await server.close();
