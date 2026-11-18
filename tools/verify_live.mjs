import { chromium } from 'playwright-core';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = 'https://kuada1.github.io/aim120d-moments/';
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
for (let attempt = 1; attempt <= 12; attempt++) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(url + '?static=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1400);
  const h = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize);
  if (h && parseFloat(h) < 60) {
    const a = await page.evaluate(() => ({ th: window.__APP.scene.spherical.theta, auto: window.__APP.scene.autoRotate, header: Math.round(document.querySelector('.masthead').getBoundingClientRect().height), stage: Math.round(document.querySelector('.stage').getBoundingClientRect().height) }));
    await page.waitForTimeout(2600);
    const b = await page.evaluate(() => ({ th: window.__APP.scene.spherical.theta }));
    await page.screenshot({ path: 'shots/live-desktop.png' });
    console.log(JSON.stringify({ attempt, h1: h, header: a.header, stage: a.stage, autoRotate: a.auto, rotated: Math.abs(b.th - a.th) > 0.0005, errs }));
    await page.close();
    break;
  }
  console.log('attempt ' + attempt + ' still old (' + h + ')');
  await page.close();
  await new Promise(r => setTimeout(r, 8000));
}
// mobile live
const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p2.goto(url + '?static=1', { waitUntil: 'networkidle', timeout: 60000 });
await p2.waitForTimeout(1800);
await p2.screenshot({ path: 'shots/live-mobile.png' });
console.log('mobile ok');
await browser.close();
