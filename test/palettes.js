const { chromium } = require('playwright');
const fs = require('fs');
const hex = (h) => [1,3,5].map(i => parseInt(h.substr(i,2),16)/255);
const BASE = { mode:0, seed:7.31, intensity:1.15, tint:1.0, holoMix:0.32, colorVary:0.55,
  flakeScale:1.0, spread:1.0, holoAuto:false, holoLift:1.15, cover:1.0,
  jitter:0.42, vary:0.08, sparkle:0.5, angle:35, gloss:0.5,
  border:true, borderW:7, borderHolo:0.28, shadow:true, shadowBlur:8, shadowOpacity:0.28,
  shadowX:0, shadowY:4, pad:24, exportScale:3 };
const SETS = {
  'flash (current)': ['#E8EDF2','#7DC7F0','#9CE8C7'],
  'holo spectrum':   ['#FF4FC1','#3FA8F0','#3FD9A0','#FFD53D'],
  'holo + silver':   ['#E8EDF2','#FF4FC1','#3FA8F0','#FFD53D'],
};
(async () => {
  const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('ERR', e.message); process.exitCode = 1; });
  await page.goto('file://' + __dirname + '/harness.html');
  for (const src of ['smiley','cat']) {
    const dataUrl = 'data:image/png;base64,' + fs.readFileSync(`${__dirname}/${src}.png`).toString('base64');
    for (const [name, cols] of Object.entries(SETS)) {
      const o = Object.assign({}, BASE, { holoPal: cols.map(hex), holoLift: src === 'cat' ? 1.9 : 1.15 });
      const out = await page.evaluate(([u,o]) => window.runHolo(u,o), [dataUrl, o]);
      fs.writeFileSync(`${__dirname}/pal-${src}-${name.replace(/[^a-z]/gi,'')}.png`, Buffer.from(out.url.split(',')[1],'base64'));
    }
  }
  console.log('rendered', Object.keys(SETS).length * 2);
  await browser.close();
})();
