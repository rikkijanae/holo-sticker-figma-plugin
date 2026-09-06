// Times consecutive preview renders — the first pays for the SDF pass, the
// rest should hit the cache. (swiftshader = CPU, so absolute numbers are
// pessimistic; the ratio is what matters.)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('file://' + __dirname + '/harness.html');
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(__dirname + '/smiley.png').toString('base64');
  const t = await page.evaluate(async (u) => {
    const bmp = await createImageBitmap(await (await fetch(u)).blob());
    const c = document.createElement('canvas');
    const r = new HoloRenderer(c);
    r.setSource(bmp);
    const gl = r.gl;
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const o = { mode:0, seed:7.31, intensity:1.15, tint:1.0, holoMix:0.25, colorVary:0.55, flakeScale:1.0,
      spread:1.0, holoPal:[[0.9,0.9,0.95],[0.5,0.85,1],[0.6,1,0.7]], holoAuto:false, holoLift:1.15,
      jitter:0.42, vary:0.08, sparkle:0.5, angle:35, gloss:0.5, border:true, borderW:7, borderHolo:0.28,
      shadow:true, shadowBlur:8, shadowOpacity:0.28, shadowX:0, shadowY:4, pad:24, exportScale:1.5 };
    const times = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      r.render(Object.assign({}, o, { angle: 35 + i }), 1);   // slider-drag style change
      sync();
      times.push(Math.round(performance.now() - t0));
    }
    // and a pad change, which must invalidate the cache
    const t0 = performance.now();
    r.render(Object.assign({}, o, { borderW: 12 }), 1); sync();
    times.push('pad-change:' + Math.round(performance.now() - t0));
    return { size: c.width + 'x' + c.height, times };
  }, dataUrl);
  console.log(JSON.stringify(t));
  await browser.close();
})();
