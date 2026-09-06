const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 720 } });
  const errs = [], sent = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.exposeFunction('__toHost', (m) => { sent.push(m); });

  // Stub the Figma host before ui.html's scripts run.
  await page.addInitScript(() => {
    window.parent = window;
    window.postMessage = (m) => window.__toHost(JSON.parse(JSON.stringify(
      m.pluginMessage ? { ...m.pluginMessage, bytes: m.pluginMessage.bytes ? '<' + m.pluginMessage.bytes.length + ' bytes>' : undefined } : m)));
    window.__fromHost = (msg) => window.dispatchEvent(
      Object.assign(new MessageEvent('message'), {}) ) ;
  });
  await page.goto('file://' + __dirname + '/../ui.html');
  await page.waitForTimeout(300);

  const b64 = fs.readFileSync(__dirname + '/smiley.png').toString('base64');
  // Deliver a 'source' message exactly as code.js would.
  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ev = new MessageEvent('message', {
      data: { pluginMessage: { type: 'source', bytes, nodeId: '1:2', name: 'Star',
                               scale: 3, requestedScale: 3, count: 1 } }
    });
    window.dispatchEvent(ev);
    if (typeof onmessage === 'function') onmessage(ev);
  }, b64);
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => ({
    previewVisible: getComputedStyle(document.getElementById('preview')).display,
    previewSize: [document.getElementById('preview').width, document.getElementById('preview').height],
    meta: document.getElementById('meta').textContent,
    applyDisabled: document.getElementById('apply').disabled,
    err: document.getElementById('err').textContent,
    sliders: document.querySelectorAll('input[type=range]').length
  }));
  console.log('UI state:', JSON.stringify(state));

  // Exercise a preset switch + slider drag + apply.
  await page.click('#preset button[data-preset="1"]');
  await page.waitForTimeout(400);
  await page.click('#shuffle');
  await page.waitForTimeout(400);
  await page.click('#preset button[data-preset="0"]');
  await page.waitForTimeout(300);
  // turn Auto on, then pick a colour — picking must switch it back off
  await page.click('#holoAuto');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const sw = document.querySelector('#swatches input');
    sw.value = '#ffd76a';
    sw.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const autoOff = await page.evaluate(() => !document.getElementById('holoAuto').checked);
  console.log('picking a colour switched Auto off:', autoOff);
  await page.click('#palPlus');
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => document.querySelectorAll('#swatches input').length);
  console.log('swatches after +:', n);
  await page.click('#shadow');
  await page.waitForTimeout(400);
  await page.click('#apply');
  await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/ui.png', fullPage: true });

  console.log('messages to host:', JSON.stringify(sent, null, 1));
  if (errs.length) { console.log('--- ERRORS ---\n' + errs.join('\n')); process.exitCode = 1; }
  else console.log('no console/page errors');
  await browser.close();
})();
