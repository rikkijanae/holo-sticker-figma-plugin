const { chromium } = require('playwright');
const fs = require('fs');
const hex = (h) => [1,3,5].map(i => parseInt(h.substr(i,2),16)/255);
const ACCENTS = ['#FF31B4','#FF4F27','#FFF92C','#7DEA13','#24BDFF'];
const BASE = { mode:0, seed:7.31, intensity:1.15, tint:1.0, holoMix:0.42, colorVary:0.55,
  flakeScale:1.0, spread:1.0, holoAuto:false, holoLift:1.15, cover:1.0,
  jitter:0.42, vary:0.08, sparkle:0.5, angle:35, gloss:0.5,
  border:true, borderW:7, borderHolo:0.28, shadow:false, shadowBlur:8, shadowOpacity:0.28,
  shadowX:0, shadowY:4, pad:14, exportScale:3,
  holoPal: ACCENTS.map(hex) };
const LIFTS = [1.15, 1.6, 2.0, 2.4];
(async () => {
  const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('ERR', e.message); process.exitCode = 1; });
  await page.goto('file://' + __dirname + '/harness.html');
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(`${__dirname}/star.png`).toString('base64');
  for (const lift of LIFTS) {
    const o = Object.assign({}, BASE, { holoLift: lift });
    const out = await page.evaluate(([u,o]) => window.runHolo(u,o), [dataUrl, o]);
    fs.writeFileSync(`${__dirname}/v5-lift${String(lift).replace('.','_')}.png`, Buffer.from(out.url.split(',')[1],'base64'));
  }
  console.log('ok');
  await browser.close();
})();
