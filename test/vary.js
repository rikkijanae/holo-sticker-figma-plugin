const { chromium } = require('playwright');
const fs = require('fs');
const BASE = { mode:0, seed:7.31, intensity:1.15, tint:1.0, holoMix:0.25, colorVary:0.55,
  flakeScale:1.0, spread:1.0, holoPal:[[0.925,0.918,0.961],[0.5,0.85,1.0],[0.62,1.0,0.7]], holoAuto:false, holoLift:1.15, cover:1.0,
  jitter:0.42, vary:0.18, sparkle:0.5, angle:35, gloss:0.5,
  border:true, borderW:7, borderHolo:0.28, shadow:true, shadowBlur:8, shadowOpacity:0.28,
  shadowX:0, shadowY:4, pad:24 };
const hex = (h) => [1,3,5].map(i => parseInt(h.substr(i,2),16)/255);
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGEERROR', e.message); process.exitCode = 1; });
  await page.goto('file://' + __dirname + '/harness.html');
  const src = process.argv[2], tag = process.argv[3];
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
  const cases = [
    ['auto',      { holoMix:0.35, holoAuto:true }],
    ['sheet',     { holoMix:0.35, holoAuto:false, holoPal:[hex('#eceaf5'), hex('#7fd8ff'), hex('#9dffb4')] }],
    ['gold-only', { holoMix:0.35, holoAuto:false, holoPal:[hex('#ffd76a')], holoLift:1.6 }],
    ['four',      { holoMix:0.45, holoAuto:false, holoPal:[hex('#eceaf5'), hex('#7fd8ff'), hex('#9dffb4'), hex('#ffe08a')] }],
    ['no-holo',   { holoMix:0.0 }],
    ['loose',     { holoMix:0.35, holoAuto:false, jitter:0.9, colorVary:1.0 }],
  ];

  for (const [name, ov] of cases) {
    const out = await page.evaluate(([u,o]) => window.runHolo(u,o), [dataUrl, Object.assign({}, BASE, ov)]);
    fs.writeFileSync(`${__dirname}/v-${tag}-${name}.png`, Buffer.from(out.url.split(',')[1],'base64'));
  }
  console.log(tag, 'rendered', cases.length);
  await browser.close();
})();
