const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 370, height: 740 } });
  const errs = [], sent = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    // Google Fonts can't be fetched from a sandboxed test runner — not a plugin error
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(m.text())) errs.push('CONSOLE: ' + m.text());
  });
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

  // Exercise a preset switch + shuffle + apply.
  await page.click('#preset button[data-preset="1"]');
  await page.waitForTimeout(400);
  await page.click('#shuffle');
  await page.waitForTimeout(400);
  await page.click('#preset button[data-preset="0"]');
  await page.waitForTimeout(300);

  const defaults = await page.evaluate(() =>
    [...document.querySelectorAll('#swatches .chip:not(.add) .hex')].map(e => e.textContent));
  console.log('default palette:', JSON.stringify(defaults));

  // turn Auto on, then pick a colour — picking must switch it back off
  await page.click('#holoAuto');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const sw = document.querySelector('#swatches input[type=color]');
    sw.value = '#ffd76a';
    sw.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  console.log('picking a colour switched Auto off:',
    await page.evaluate(() => !document.getElementById('holoAuto').checked));

  // Add up to the shader's six-colour max, then confirm the slot locks off.
  const before = await page.evaluate(() => document.querySelectorAll('#swatches .chip:not(.add)').length);
  await page.click('#swatches .chip.add');
  await page.waitForTimeout(250);
  await page.click('#swatches .chip.add');
  await page.waitForTimeout(250);
  const atMax = await page.evaluate(() => ({
    swatches: document.querySelectorAll('#swatches .chip:not(.add)').length,
    count: document.querySelector('.palhead .n').textContent,
    addLocked: document.querySelector('#swatches .chip.add').classList.contains('full')
  }));
  console.log('from', before, 'to max:', JSON.stringify(atMax));

  // Remove two with the per-swatch badge.
  await page.click('#swatches .chip:not(.add) .kill');
  await page.waitForTimeout(200);
  await page.click('#swatches .chip:not(.add) .kill');
  await page.waitForTimeout(250);
  console.log('after two removes:', await page.evaluate(() => ({
    swatches: document.querySelectorAll('#swatches .chip:not(.add)').length,
    count: document.querySelector('.palhead .n').textContent,
    addLocked: document.querySelector('#swatches .chip.add').classList.contains('full')
  })));

  // Sections collapse to a header carrying a value summary.
  console.log('summaries:', await page.evaluate(() =>
    [...document.querySelectorAll('.sec')].map(c =>
      c.querySelector('.t').textContent + ' = "' + c.querySelector('.sum').textContent + '"' +
      (c.classList.contains('open') ? ' [open]' : ''))));

  // Texture expands, and its header summary blanks while it is open.
  await page.click('.sec:nth-child(2) .shead');
  await page.waitForTimeout(150);
  console.log('Texture open + summary blank:', await page.evaluate(() => {
    const c = document.querySelectorAll('.sec')[1];
    return c.classList.contains('open') && c.querySelector('.sum').textContent === '';
  }));
  await page.click('.sec:nth-child(2) .shead');
  await page.waitForTimeout(150);
  console.log('Texture shut + summary back:', await page.evaluate(() => {
    const c = document.querySelectorAll('.sec')[1];
    return !c.classList.contains('open') && c.querySelector('.sum').textContent === '1.0 \u00b7 1.0 \u00b7 1.0 \u00b7 0.42';
  }));
  await page.click('.sec:nth-child(2) .shead');
  await page.waitForTimeout(150);

  // Drop shadow: the switch turns it on and expands it in one go.
  await page.click('.sec:nth-child(5) .sw');
  await page.waitForTimeout(400);
  console.log('shadow on + expanded:', await page.evaluate(() => {
    const c = document.querySelectorAll('.sec')[4];
    return c.classList.contains('open') && c.querySelector('.sw').classList.contains('on');
  }));

  // Output: resolution is a segmented control now.
  await page.click('.sec:nth-child(6) .shead');
  await page.waitForTimeout(150);
  await page.click('.segsm button[data-scale="4"]');
  await page.waitForTimeout(200);

  // Size scales the placed sticker; the note warns when it outruns Resolution.
  await page.evaluate(() => {
    const s = document.querySelectorAll('.sec')[5].querySelector('input[type=range]');
    s.value = '2.5'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  console.log('size 250% @4x:', await page.evaluate(() => ({
    box: document.querySelectorAll('.sec')[5].querySelector('.valbox').textContent,
    note: document.getElementById('scaleNote').textContent
  })));
  await page.evaluate(() => {
    const s = document.querySelectorAll('.sec')[5].querySelector('input[type=range]');
    s.value = '0.5'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  console.log('size 50% @4x:', await page.evaluate(() => ({
    box: document.querySelectorAll('.sec')[5].querySelector('.valbox').textContent,
    note: document.getElementById('scaleNote').textContent
  })));

  // At 2x, scaling past 200% outruns the render and the note must appear.
  await page.click('.segsm button[data-scale="2"]');
  await page.evaluate(() => {
    const s = document.querySelectorAll('.sec')[5].querySelector('input[type=range]');
    s.value = '3'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  console.log('size 300% @2x:', await page.evaluate(() => document.getElementById('scaleNote').textContent));
  await page.click('.segsm button[data-scale="4"]');
  await page.evaluate(() => {
    const s = document.querySelectorAll('.sec')[5].querySelector('input[type=range]');
    s.value = '0.5'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);

  await page.click('.sec:nth-child(6) .shead');   // shut it so the summary shows
  await page.waitForTimeout(150);
  console.log('output summary:', await page.evaluate(() =>
    document.querySelectorAll('.sec')[5].querySelector('.sum').textContent));
  await page.click('.sec:nth-child(6) .shead');
  await page.waitForTimeout(150);

  // Foil is drawn by foil(), so the whole disc-mosaic half of the panel goes
  // away and the remaining labels switch to foil vocabulary.
  await page.click('#preset button[data-preset="2"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('.sec').forEach(c => {
    if (c.style.display !== 'none' && !c.classList.contains('open')) c.querySelector('.shead').click();
  }));
  await page.waitForTimeout(200);
  console.log('foil panel:', await page.evaluate(() =>
    [...document.querySelectorAll('.sec')].filter(c => c.style.display !== 'none').map(c =>
      c.querySelector('.t').textContent + ': ' +
      [...c.querySelectorAll('.row')].filter(r => r.style.display !== 'none')
        .map(r => r.querySelector('label').textContent).join(', '))));
  console.log('foil hides the palette:', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.palblock')).display === 'none'));
  await page.click('#preset button[data-preset="0"]');
  await page.waitForTimeout(600);
  console.log('back on Tinted, flake controls return:', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.palblock')).display !== 'none' &&
    [...document.querySelectorAll('.sec')[0].querySelectorAll('.row')]
      .every(r => r.style.display !== 'none')));

  // Reset puts the defaults back, palette included.
  await page.click('#reset');
  await page.waitForTimeout(400);
  console.log('after reset:', await page.evaluate(() => ({
    palette: [...document.querySelectorAll('#swatches .chip:not(.add) .hex')].map(e => e.textContent),
    shimmer: document.querySelector('.sec .valbox').textContent,
    size: document.querySelectorAll('.sec')[5].querySelector('.valbox').textContent
  })));

  await page.click('#apply');
  await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/ui.png', fullPage: true });

  console.log('messages to host:', JSON.stringify(sent, null, 1));
  if (errs.length) { console.log('--- ERRORS ---\n' + errs.join('\n')); process.exitCode = 1; }
  else console.log('no console/page errors');
  await browser.close();
})();
