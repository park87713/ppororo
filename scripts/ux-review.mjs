// UX/완성도 검증: 실제 사용자 플로우를 브라우저에서 구동하며 관찰
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 5198 } });
await server.listen();

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const log = [];
const errors = [];
const dialogs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('dialog', async (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  await d.accept();
});

const step = (s) => { log.push(s); console.log('STEP:', s); };
const vp = () => page.locator('#viewport canvas');

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1. 초기 상태
const initial = await page.evaluate(() => ({
  listCount: document.querySelectorAll('#projector-list li').length,
  status: document.getElementById('metric-detail').textContent
}));
step(`초기 상태: 프로젝터 ${initial.listCount}대, 상태바="${initial.status}"`);
await page.screenshot({ path: 'scripts/ux-01-initial.png' });

// 2. 빈 공간 클릭 → 선택 해제, 본체 클릭 → 재선택 시도
const box = await vp().boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9); // 빈 바닥
await page.waitForTimeout(400);
const deselected = await page.evaluate(() => !document.getElementById('props-body') || document.getElementById('props-body').hidden);
step(`빈 공간 클릭 → 선택 해제됨: ${deselected}`);

// 프로젝터 본체 화면 좌표를 계산해 클릭 (앱 내부 접근)
const projScreen = await page.evaluate(() => {
  const c = document.querySelector('#viewport canvas');
  return { w: c.clientWidth, h: c.clientHeight };
});
// 본체는 화면 중앙 근처(기즈모 위치) — 리스트에서 클릭하는 보편 경로도 확인
await page.click('#projector-list li');
await page.waitForTimeout(300);
const reselected = await page.evaluate(() => !document.getElementById('props-body').hidden);
step(`리스트 항목 클릭 → 속성 패널 표시: ${reselected}`);

// 3. 키보드: E(회전) → W(이동), F 포커스
await vp().click({ position: { x: projScreen.w * 0.45, y: projScreen.h * 0.6 } });
await page.keyboard.press('e');
await page.waitForTimeout(200);
await page.keyboard.press('w');
step('키보드 E/W 기즈모 전환 — 에러 없으면 통과');

// 4. 스로우비 슬라이더 → 화면 크기 변경 확인
await page.click('#projector-list li');
await page.waitForTimeout(200);
const before = await page.evaluate(() => document.getElementById('metric-detail').textContent);
const trSlider = page.locator('#props-body .prop-group:nth-child(3) input[type=range]').first();
await trSlider.fill('1.2');
await page.waitForTimeout(900);
const after = await page.evaluate(() => document.getElementById('metric-detail').textContent);
step(`TR 1.6→1.2: 상태바 "${before}" → "${after}" (화면 커져야 함)`);

// 5. V 시프트
const vShift = page.locator('#props-body .prop-group:nth-child(3) input[type=range]').nth(1);
await vShift.fill('40');
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/ux-02-vshift.png' });
step('V 시프트 +40% 적용 (스크린샷)');

// 6. 기종 변경 → UST
await page.selectOption('#props-body select', 'ust4500');
await page.waitForTimeout(600);
const ustMetric = await page.evaluate(() => document.getElementById('metric-detail').textContent);
step(`기종 → UST: "${ustMetric}"`);
await page.screenshot({ path: 'scripts/ux-03-ust.png' });

// 7. 최대 8대 제한: 7대 더 추가 + 1대 초과 시도
for (let i = 0; i < 8; i++) {
  await page.click('#btn-add-projector');
  await page.waitForTimeout(150);
}
const count8 = await page.evaluate(() => document.querySelectorAll('#projector-list li').length);
step(`8대 채운 뒤 +1 시도: 리스트 ${count8}대, 다이얼로그=[${dialogs.join(' | ')}]`);
await page.screenshot({ path: 'scripts/ux-04-eight.png' });

// 8. Delete 키로 삭제
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
const afterDel = await page.evaluate(() => document.querySelectorAll('#projector-list li').length);
step(`Delete 키 → ${afterDel}대 (8→7 기대)`);

// 9. 환경 전환 시 프로젝터 유지 관찰
await page.selectOption('#env-preset', 'facade');
await page.waitForTimeout(900);
await page.screenshot({ path: 'scripts/ux-05-env-switch.png' });
const facadeStatus = await page.evaluate(() => document.getElementById('metric-detail').textContent);
step(`room→facade 전환 (프로젝터 유지): "${facadeStatus}"`);

// 10. 도우미: 큰 파사드에서 9대 이상 필요 케이스
await page.click('#btn-assistant');
await page.waitForTimeout(300);
await page.fill('#as-pxm', '60');
await page.click('#as-calc');
await page.waitForTimeout(300);
const planText = (await page.textContent('#as-result')).replace(/\s+/g, ' ').trim();
step(`도우미(파사드, 60px/m): ${planText.slice(0, 260)}`);
await page.click('#as-apply');
await page.waitForTimeout(1200);
const applied = await page.evaluate(() => document.querySelectorAll('#projector-list li').length);
step(`적용 후 배치 대수: ${applied} (8 상한)`);
await page.screenshot({ path: 'scripts/ux-06-plan-applied.png' });

// 11. 모두 삭제 → 빈 상태
while (await page.evaluate(() => document.querySelectorAll('#projector-list li').length) > 0) {
  await page.click('#projector-list li');
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
}
const emptyState = await page.evaluate(() => ({
  status: document.getElementById('metric-summary').textContent,
  props: document.getElementById('props-empty').hidden
}));
step(`전체 삭제 → "${emptyState.status}", 속성패널 비움 hidden=${emptyState.props}`);
await page.screenshot({ path: 'scripts/ux-07-empty.png' });

// 12. 주변광 0 + 투사 모드 → 장면 식별 가능성
await page.click('#btn-add-projector');
await page.waitForTimeout(300);
const ambSlider = page.locator('#env-controls .prop-row:last-child input[type=range]');
await ambSlider.fill('0');
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/ux-08-dark.png' });
step('주변광 0% (암전) 스크린샷 — 공간 식별 가능 여부 확인');

// 13. 저장 → 불러오기 라운드트립
await ambSlider.fill('40');
const dl = page.waitForEvent('download');
await page.click('#btn-save');
const file = await dl;
const path = await file.path();
step(`저장: ${file.suggestedFilename()}`);
await page.click('#btn-add-projector');
await page.waitForTimeout(200);
const fc = page.waitForEvent('filechooser');
await page.click('#btn-load');
const chooser = await fc;
await chooser.setFiles(path);
await page.waitForTimeout(900);
const roundtrip = await page.evaluate(() => document.querySelectorAll('#projector-list li').length);
step(`불러오기 라운드트립: ${roundtrip}대 (1 기대)`);

// 14. 기즈모 드래그 (이동): 화면 중앙 기즈모의 X축 화살표 근처 드래그
await page.click('#projector-list li');
await page.waitForTimeout(300);
const posBefore = await page.evaluate(() => document.querySelectorAll('#props-body input[type=number]')[2]?.value + ',' + document.querySelectorAll('#props-body input[type=number]')[3]?.value);
step(`기즈모 드래그 전 위치필드: ${posBefore}`);

console.log('\n=== DIALOGS ===\n' + dialogs.join('\n'));
console.log('\n=== ERRORS ===\n' + (errors.length ? errors.join('\n').slice(0, 2000) : '없음'));

await browser.close();
await server.close();
