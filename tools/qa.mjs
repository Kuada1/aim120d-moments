import { chromium } from 'playwright-core';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const base = 'http://127.0.0.1:4180/';
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
const results = {};

// 1) desktop functional
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  await page.goto(base + '?static=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ my: document.querySelector('#my').textContent, a: document.querySelector('#alpha').value }));
  await page.click('[data-preset="pull"]');
  await page.waitForTimeout(1200);
  const afterPull = await page.evaluate(() => ({ my: document.querySelector('#my').textContent, a: document.querySelector('#alpha').value, de: document.querySelector('#deltaE').value, on: document.querySelector('[data-preset="pull"]').classList.contains('on') }));
  await page.click('[data-view="front"]');
  await page.waitForTimeout(900);
  const viewOn = await page.evaluate(() => document.querySelector('[data-view="front"]').classList.contains('on'));
  await page.click('#auto-btn');
  await page.waitForTimeout(5600);
  const afterAuto = await page.evaluate(() => ({ a: document.querySelector('#alpha').value, b: document.querySelector('#beta').value, auto: document.querySelector('#auto-btn').classList.contains('on'), presetOn: [...document.querySelectorAll('.presets button[data-preset]')].filter(b=>b.classList.contains('on')).map(b=>b.dataset.preset) }));
  const fps = await page.evaluate(() => new Promise(res => { let n=0; const t0=performance.now(); const f=()=>{n++; if(performance.now()-t0<1500) requestAnimationFrame(f); else res(n/(performance.now()-t0)*1000);}; requestAnimationFrame(f); }));
  const chartInk = await page.evaluate(() => {
    const c = document.querySelector('#chart-y'); const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return Math.round(n / (c.width * c.height) * 1000) / 10;
  });
  const overflow = await page.evaluate(() => ({ sw: document.body.scrollWidth, iw: innerWidth }));
  results.desktop = { errs, failed, before, afterPull, viewOn, afterAuto, fps: +fps.toFixed(1), chartInkPct: chartInk, overflow };
  await page.close();
}

// 2) small mobile
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '?static=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const vp = document.querySelector('.viewport').getBoundingClientRect();
    const labels = [...document.querySelectorAll('.lbl')].filter(e => e.style.display !== 'none').map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y), out: r.x < vp.x - 2 || r.right > vp.right + 2 }; });
    return { vp: { w: Math.round(vp.width), h: Math.round(vp.height) }, overflowX: document.body.scrollWidth > innerWidth, labels, stage: Math.round(document.querySelector('.stage').getBoundingClientRect().height) };
  });
  await page.screenshot({ path: 'shots/mobile-390.png', fullPage: false });
  results.mobile = { errs, ...m };
  await page.close();
}

// 3) file:// compatibility
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await page.goto('file:///C:/Users/HUAWEI/Documents/deepseek-harness/default-workspace/aim120d-moments/index.html?static=1', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  results.file = { errs, my: await page.evaluate(() => document.querySelector('#my').textContent) };
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
