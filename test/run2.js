// Renders the four preset tabs on a supplied PNG, for eyeballing.
const { chromium } = require('playwright');
const fs = require('fs');
const PRESETS = {
  tinted:  { mode:0, intensity:1.15, tint:1.0, holoMix:0.25, colorVary:0.55, spread:1.0,  jitter:0.42, vary:0.18, sparkle:0.5,  angle:35, gloss:0.5,  borderW:7, borderHolo:0.28 },
  rainbow: { mode:0, intensity:1.3,  tint:0.0, holoMix:0.0,  colorVary:0.0, spread:1.0,  jitter:0.42, vary:0.18, sparkle:0.75, angle:35, gloss:0.55, borderW:7, borderHolo:0.28 },
  glitter: { mode:1, intensity:0.9,  tint:0.0, holoMix:0.0,  colorVary:0.45, spread:1.35, jitter:0.72, vary:0.4,  sparkle:0.85, angle:35, gloss:0.45, borderW:6, borderHolo:0.6 },
  foil:    { mode:2, intensity:0.8,  tint:0.0, holoMix:0.0,  colorVary:0.0, spread:1.1,  jitter:0.42, vary:0.18, sparkle:0.5,  angle:50, gloss:0.7,  borderW:8, borderHolo:0.15 }
};
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGEERROR', e.message); process.exitCode = 1; });
  await page.goto('file://' + __dirname + '/harness.html');
  const src = process.argv[2];
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
  for (const [name, ov] of Object.entries(PRESETS)) {
    const o = Object.assign({ flakeScale:1.0, seed:7.31, border:true, shadow:true,
      holoPal:[[0.925,0.918,0.961],[0.5,0.85,1.0],[0.62,1.0,0.7]], holoAuto:false, holoLift:1.15, cover:1.0, colorVary:0.55,
      shadowBlur:8, shadowOpacity:0.28, shadowX:0, shadowY:4, pad:24 }, ov);
    const out = await page.evaluate(([u,o]) => window.runHolo(u,o), [dataUrl, o]);
    fs.writeFileSync(__dirname + '/p-' + name + '.png', Buffer.from(out.url.split(',')[1],'base64'));
    console.log(name, out.w + 'x' + out.h);
  }
  await browser.close();
})();
