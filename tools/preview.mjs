import { chromium } from 'playwright-core';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const base = 'http://127.0.0.1:4180/';
const shots = [
  ['shots/desktop.png', '?static=1', 2000, 1600, 1000, 1, 0],
  ['shots/wide.png', '?static=1', 2000, 1920, 1080, 1, 0],
  ['shots/pull.png', '?static=1&preset=pull&roll=0', 1600, 1600, 1000, 1, 0],
  ['shots/roll.png', '?static=1&preset=roll&roll=0', 2600, 1600, 1000, 1, 0],
  ['shots/doc.png', '?static=1', 1200, 1600, 1000, 1, 900],
  ['shots/mobile.png', '?static=1', 1800, 420, 900, 2, 0],
];
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
for (const [out, query, wait, w, h, dpr, scroll] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(base + query, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(wait);
  if (scroll) { await page.evaluate(y => window.scrollTo(0, y), scroll); await page.waitForTimeout(500); }
  await page.screenshot({ path: out });
  const m = await page.evaluate(() => ({
    header: Math.round(document.querySelector('.masthead').getBoundingClientRect().height),
    stage: Math.round(document.querySelector('.stage').getBoundingClientRect().height),
    rail: Math.round(document.querySelector('.rail').scrollHeight),
    vp: Math.round(document.querySelector('.viewport').getBoundingClientRect().height),
    scrollW: document.body.scrollWidth + '/' + innerWidth,
    my: document.querySelector('#my').textContent
  }));
  console.log(out, JSON.stringify(m), errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
  await page.close();
}
await browser.close();
