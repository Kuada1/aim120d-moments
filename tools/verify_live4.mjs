import { chromium } from 'playwright-core';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = 'https://kuada1.github.io/aim120d-moments/';
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
for (let attempt = 1; attempt <= 12; attempt++) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const ok = await page.evaluate(() => !!document.querySelector('#reset-btn') && document.body.innerText.includes('SOVIET FRAME'));
  if (ok) {
    // camera static check
    const th1 = await page.evaluate(() => window.__APP.scene.spherical.theta);
    await page.waitForTimeout(2500);
    const th2 = await page.evaluate(() => window.__APP.scene.spherical.theta);
    // yaw preset then reset
    await page.click('[data-preset="yaw"]');
    await page.waitForTimeout(1200);
    const yaw = await page.evaluate(() => ({ my: document.querySelector('#my').textContent, mz: document.querySelector('#mz').textContent, cn: document.querySelector('#cn').textContent }));
    await page.click('#reset-btn');
    await page.waitForTimeout(1000);
    const reset = await page.evaluate(() => ({
      alpha: document.querySelector('#alpha').value, beta: document.querySelector('#beta').value,
      de: document.querySelector('#deltaE').value, dr: document.querySelector('#deltaR').value, da: document.querySelector('#deltaA').value,
      my: document.querySelector('#my').textContent, mz: document.querySelector('#mz').textContent, mx: document.querySelector('#mx').textContent,
      auto: document.querySelector('#auto-btn').classList.contains('on'),
      presetOn: [...document.querySelectorAll('.presets button[data-preset]')].filter(b=>b.classList.contains('on')).map(b=>b.dataset.preset),
      iso: document.querySelector('[data-view="iso"]').classList.contains('on')
    }));
    await page.screenshot({ path: 'shots/live-desktop.png' });
    console.log(JSON.stringify({ attempt, cameraMoved: Math.abs(th2-th1) > 0.0005, yaw, reset, errs }, null, 1));
    await page.close();
    break;
  }
  console.log('attempt ' + attempt + ' not updated yet');
  await page.close();
  await new Promise(r => setTimeout(r, 9000));
}
const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p2.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p2.waitForTimeout(1600);
await p2.screenshot({ path: 'shots/live-mobile.png' });
console.log('mobile ok');
await browser.close();
