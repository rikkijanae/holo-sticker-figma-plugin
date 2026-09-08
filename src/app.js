/* Shiny Sticker — plugin UI controller. */

const PRESETS = [
  { // 0 — sequin flakes tinted by the artwork underneath, a few holo ones between
    name: 'Tinted', mode: 0,
    intensity: 1.15, tint: 1.0, holoMix: 0.25, colorVary: 0.55, flakeScale: 1.0, spread: 1.0,
    holoAuto: false, holoN: 3, holoLift: 1.15, cover: 1.0,
    jitter: 0.42, vary: 0.08, sparkle: 0.5, angle: 35, gloss: 0.5, borderW: 7, borderHolo: 0.28
  },
  { // 1 — full-spectrum sequin confetti
    name: 'Rainbow', mode: 0,
    intensity: 1.3, tint: 0.0, holoMix: 0.0, colorVary: 0.0, flakeScale: 1.0, spread: 1.0,
    holoAuto: true, holoN: 3, holoLift: 1.15, cover: 1.0,
    jitter: 0.42, vary: 0.08, sparkle: 0.75, angle: 35, gloss: 0.55, borderW: 7, borderHolo: 0.28
  },
  { // 2 — fine glitter dust
    name: 'Glitter', mode: 1,
    intensity: 0.9, tint: 0.0, holoMix: 0.0, colorVary: 0.45, flakeScale: 1.0, spread: 1.35,
    holoAuto: true, holoN: 3, holoLift: 1.15, cover: 1.0,
    jitter: 0.72, vary: 0.25, sparkle: 0.85, angle: 35, gloss: 0.45, borderW: 6, borderHolo: 0.6
  },
  { // 3 — prismatic foil
    name: 'Foil', mode: 2,
    intensity: 0.8, tint: 0.0, holoMix: 0.0, colorVary: 0.0, flakeScale: 1.0, spread: 1.1,
    holoAuto: true, holoN: 3, holoLift: 1.15, cover: 1.0,
    jitter: 0.42, vary: 0.08, sparkle: 0.5, angle: 50, gloss: 0.7, borderW: 8, borderHolo: 0.15
  }
];

const S = Object.assign({
  preset: 0, seed: 7.31,
  // the holo palette survives preset switches — it's the user's choice
  holoColors: ['#eceaf5', '#7fd8ff', '#9dffb4', '#ffe08a'],
  border: true, shadow: false,
  shadowBlur: 8, shadowOpacity: 0.28, shadowX: 0, shadowY: 4,
  keepOriginal: true, exportScale: 3
}, PRESETS[0]);

const MAIN_FIELDS = [
  ['intensity',  'Shimmer',    0,    2,   0.01],
  ['tint',       'Object tint',0,    1,   0.01],
  ['colorVary',  'Colour vary',0,    1,   0.01],
  ['holoMix',    'Holo flakes',0,    1,   0.01],
  ['flakeScale', 'Flake size', 0.3,  3,   0.01],
  ['spread',     'Hue spread', 0.2,  3,   0.01],
  ['cover',      'Coverage',   0.5,  1.15,0.01],
  ['jitter',     'Scatter',    0,    1,   0.01],
  ['holoLift',   'Holo lift',  0.3,  2.5, 0.01],
  ['sparkle',    'Sparkle',    0,    1,   0.01],
  ['angle',      'Light angle',0,    360, 1],
  ['gloss',      'Gloss',      0,    1,   0.01]
];
const BORDER_FIELDS = [
  ['borderW',    'Width',      0,    24,  0.5],
  ['borderHolo', 'Silver holo',0,    1,   0.01]
];
const SHADOW_FIELDS = [
  ['shadowBlur',    'Blur',    0,    30,  0.5],
  ['shadowOpacity', 'Opacity', 0,    1,   0.01],
  ['shadowX',       'Offset X',-20,  20,  0.5],
  ['shadowY',       'Offset Y',-20,  20,  0.5]
];

const $ = (id) => document.getElementById(id);
const glCanvas = document.createElement('canvas');
const preview = $('preview');
const pctx = preview.getContext('2d');

let renderer, bitmap = null, nodeId = null, srcScale = 3;
let batch = null, pending = false, dirty = false, selTimer = 0;

try { renderer = new HoloRenderer(glCanvas); }
catch (e) { showError(e.message); }

// ---------------------------------------------------------------- controls

function slider(host, [key, label, min, max, step]) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML =
    '<label>' + label + '</label>' +
    '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '">' +
    '<span class="val"></span>';
  const input = row.querySelector('input');
  const val = row.querySelector('.val');
  const sync = () => {
    input.value = S[key];
    val.textContent = step >= 1 ? Math.round(S[key]) : (+S[key]).toFixed(2).replace(/0$/, '');
    const pct = ((S[key] - min) / (max - min)) * 100;
    input.style.background =
      'linear-gradient(90deg, var(--fg) 0%, var(--fg) ' + pct + '%, var(--track) ' + pct + '%, var(--track) 100%)';
  };
  input.addEventListener('input', () => { S[key] = parseFloat(input.value); sync(); schedule(); });
  sync();
  host.appendChild(row);
  return sync;
}

const syncs = [];
// everything up to and including Holo flakes goes above the colour swatch
const SPLIT = MAIN_FIELDS.findIndex((f) => f[0] === 'holoMix') + 1;
MAIN_FIELDS.slice(0, SPLIT).forEach((f) => syncs.push(slider($('mainTop'), f)));
MAIN_FIELDS.slice(SPLIT).forEach((f) => syncs.push(slider($('mainBottom'), f)));
BORDER_FIELDS.forEach((f) => syncs.push(slider($('borderRows'), f)));
SHADOW_FIELDS.forEach((f) => syncs.push(slider($('shadowRows'), f)));

const tabs = $('preset');
PRESETS.forEach((p, i) => {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.dataset.preset = i;
  b.className = i === S.preset ? 'on' : '';
  tabs.appendChild(b);
});
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  [...tabs.children].forEach((x) => x.classList.toggle('on', x === b));
  S.preset = +b.dataset.preset;
  Object.assign(S, PRESETS[S.preset]);
  syncs.forEach((f) => f());
  schedule();
});

function toggle(id, key, groupId) {
  const el = $(id);
  el.checked = S[key];
  el.addEventListener('change', () => {
    S[key] = el.checked;
    if (groupId) $(groupId).classList.toggle('collapsed', !el.checked);
    schedule();
  });
  if (groupId) $(groupId).classList.toggle('collapsed', !el.checked);
}
toggle('border', 'border', 'g-border');
toggle('shadow', 'shadow', 'g-shadow');
toggle('keep', 'keepOriginal');

const autoBox = $('holoAuto');
const swatchHost = $('swatches');
function buildSwatches() {
  swatchHost.innerHTML = '';
  S.holoColors.slice(0, S.holoN).forEach((hex, i) => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = hex;
    inp.title = 'Holo colour ' + (i + 1);
    inp.addEventListener('input', () => {
      S.holoColors[i] = inp.value;
      if (S.holoAuto) { S.holoAuto = false; syncHolo(); }   // picking implies manual
      schedule();
    });
    swatchHost.appendChild(inp);
  });
  $('palMinus').disabled = S.holoN <= 1;
  $('palPlus').disabled = S.holoN >= 4;
}
function syncHolo() {
  autoBox.checked = S.holoAuto;
  swatchHost.style.opacity = S.holoAuto ? 0.35 : 1;
  buildSwatches();
}
autoBox.addEventListener('change', () => { S.holoAuto = autoBox.checked; syncHolo(); schedule(); });
$('palPlus').addEventListener('click', () => { S.holoN = Math.min(4, S.holoN + 1); S.holoAuto = false; syncHolo(); schedule(); });
$('palMinus').addEventListener('click', () => { S.holoN = Math.max(1, S.holoN - 1); syncHolo(); schedule(); });
syncs.push(syncHolo);
syncHolo();

$('shuffle').addEventListener('click', () => { S.seed = Math.random() * 97; schedule(); });
$('res').addEventListener('change', () => {
  S.exportScale = +$('res').value;
  post({ type: 'request-source', scale: S.exportScale, pad: padPx() });
});

// ---------------------------------------------------------------- rendering

function padPx() {
  let p = 6;
  if (S.border) p += S.borderW;
  if (S.shadow) p += S.shadowBlur + Math.max(Math.abs(S.shadowX), Math.abs(S.shadowY));
  return Math.ceil(p);
}

function hexRGB(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function opts() {
  return Object.assign({}, S, {
    pad: padPx(), exportScale: srcScale,
    holoPal: S.holoColors.slice(0, S.holoN).map(hexRGB)
  });
}

function schedule() {
  if (!bitmap || !renderer) return;
  dirty = true;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (dirty) { dirty = false; drawPreview(); }
  });
}

function drawPreview() {
  const o = opts();
  const fullW = bitmap.width + Math.ceil(o.pad * srcScale) * 2;
  const fullH = bitmap.height + Math.ceil(o.pad * srcScale) * 2;
  const k = Math.min(1, 720 / Math.max(fullW, fullH));
  const r = renderer.render(o, k);
  preview.width = r.width;
  preview.height = r.height;
  pctx.clearRect(0, 0, r.width, r.height);
  pctx.drawImage(glCanvas, 0, 0);
  preview.style.display = 'block';
  $('hint').style.display = 'none';
}

function toPng() {
  return new Promise((res, rej) => {
    glCanvas.toBlob((b) => {
      if (!b) return rej(new Error('Could not encode the image.'));
      b.arrayBuffer().then((ab) => res(new Uint8Array(ab)), rej);
    }, 'image/png');
  });
}

// ---------------------------------------------------------------- messaging

function post(m) { parent.postMessage({ pluginMessage: m }, '*'); }

function toU8(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v);
  return new Uint8Array(Object.keys(v).map((k) => v[k]));
}

function showError(m) { const e = $('err'); e.textContent = m; e.style.display = 'block'; }
function clearError() { $('err').style.display = 'none'; }

async function loadSource(msg) {
  const blob = new Blob([toU8(msg.bytes)], { type: 'image/png' });
  bitmap = await createImageBitmap(blob);
  renderer.setSource(bitmap);
  nodeId = msg.nodeId;
  srcScale = msg.scale;
}

$('apply').addEventListener('click', () => {
  if (!renderer) return;
  batch = { i: 0, total: 1 };
  $('apply').disabled = true;
  $('meta').textContent = 'Rendering…';
  post({ type: 'request-batch', index: 0, scale: S.exportScale, pad: padPx() });
});

onmessage = async (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === 'no-selection') {
    bitmap = null; nodeId = null;
    preview.style.display = 'none';
    $('hint').style.display = 'block';
    $('hint').textContent = 'Select a layer on the canvas';
    $('apply').disabled = true;
    $('meta').textContent = '';
    return;
  }

  if (msg.type === 'selection-changed') {
    // Figma fires this on every click; coalesce so a quick scrub through the
    // layers doesn't queue an export for each one.
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (!batch) post({ type: 'request-source', scale: S.exportScale, pad: padPx() });
    }, 120);
    return;
  }

  if (msg.type === 'source') {
    clearError();
    await loadSource(msg);
    $('apply').disabled = false;
    $('meta').textContent = msg.count > 1 ? msg.count + ' layers selected' : msg.name;
    if (msg.scale < msg.requestedScale) {
      $('meta').textContent += ' · capped to ' + msg.scale + 'x';
    }
    schedule();
    return;
  }

  if (msg.type === 'batch-source') {
    batch = { i: msg.index, total: msg.total };
    $('meta').textContent = 'Rendering ' + (msg.index + 1) + '/' + msg.total + '…';
    await loadSource(msg);
    const o = opts();
    const r = renderer.render(o, 1);
    const bytes = await toPng();
    post({
      type: 'result',
      bytes: bytes,
      nodeId: msg.nodeId,
      scale: r.scale,
      pad: r.padOut,
      keepOriginal: S.keepOriginal,
      index: msg.index,
      total: msg.total
    });
    return;
  }

  if (msg.type === 'placed' || msg.type === 'skip') {
    post({ type: 'request-batch', index: msg.index + 1, scale: S.exportScale, pad: padPx() });
    return;
  }

  if (msg.type === 'done') {
    batch = null;
    $('apply').disabled = false;
    $('meta').textContent = 'Done';
    // The new image is now selected, which triggers a fresh preview.
    return;
  }

  if (msg.type === 'error') showError(msg.message);
};

post({ type: 'ready', scale: S.exportScale, pad: padPx() });
