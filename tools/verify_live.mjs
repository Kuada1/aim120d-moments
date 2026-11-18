import { chromium } from 'playwright-core';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = 'https://kuada1.github.io/aim120d-moments/';
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errs = [], failed = [], statuses = {};
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('requestfailed', r => failed.push(r.url() + ' :: ' + r.failure().errorText));
page.on('response', r => { const u = r.url(); if (u.startsWith(url)) statuses[u.replace(url, '')] = r.status(); });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'shots/live-desktop.png' });
const info = await page.evaluate(() => ({
  title: document.title,
  canvas: !!document.querySelector('#gl'),
  my: document.querySelector('#my').textContent,
  wx: document.querySelector('#wx').textContent,
  chartW: document.querySelector('#chart-y').width,
  charts: [...document.querySelectorAll('.chart-cell canvas')].map(c => c.width + 'x' + c.height),
  cssLoaded: getComputedStyle(document.body).backgroundColor,
  font: getComputedStyle(document.querySelector('h1')).fontFamily,
  mesh: !!window.AIM120D_MESH,
  aero: !!window.Aero,
  chartsApi: !!window.MomentChart,
  scene: !!window.MissileScene,
  bodyOverflow: document.body.scrollWidth > innerWidth
}));
const fps = await page.evaluate(() => new Promise(res => { let n=0; const t0=performance.now(); const f=()=>{n++; if(performance.now()-t0<1500) requestAnimationFrame(f); else res(+(n/(performance.now()-t0)*1000).toFixed(1));}; requestAnimationFrame(f); }));
console.log(JSON.stringify({ errs, failed, statuses, info, fps }, null, 1));

// mobile live
const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs2 = [];
p2.on('pageerror', e => errs2.push(e.message));
await p2.goto(url + '?static=1', { waitUntil: 'networkidle', timeout: 60000 });
await p2.waitForTimeout(2000);
await p2.screenshot({ path: 'shots/live-mobile.png' });
console.log('MOBILE ERRORS:', errs2);
await browser.close();
