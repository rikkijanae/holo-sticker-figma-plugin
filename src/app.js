/* Shiny Sticker — plugin UI controller.
   Layout follows Plugin Panel / v5 in the Shiny Sticker Figma file:
   fixed preview, fixed footer, and a scrolling middle of white section cards
   that collapse to a header carrying a value summary. */

const PAL_MAX = 6;   // uHoloPal0..5 in the shader

// Rikki's accents. These are the plugin's defaults; the swatches stay put
// when you switch preset, because they're the user's choice, not the preset's.
const DEFAULT_PAL = ['#78ff18', '#fbff2b', '#2bf8ff', '#ff00f2'];
const SPARE_PAL = ['#ff4f27', '#a96bff'];   // offered by the Add slot

const PRESETS = [
  { // sequin flakes tinted by the artwork underneath, a few holo ones between.
    // Auto spectrum instead + Object tint 0 reproduces the old Rainbow preset,
    // which is why that tab was dropped (Rikki, 2026-09-09).
    id: 'tinted', name: 'Tinted', mode: 0,
    intensity: 1.15, tint: 1.0, holoMix: 0.25, colorVary: 0.55, flakeScale: 1.0, spread: 1.0,
    holoAuto: false, holoLift: 1.15, cover: 1.0,
    jitter: 0.42, vary: 0.08, sparkle: 0.5, angle: 35, gloss: 0.5, borderW: 7, borderHolo: 0.28
  },
  { // fine glitter dust
    id: 'glitter', name: 'Glitter', mode: 1,
    intensity: 0.9, tint: 0.0, holoMix: 0.0, colorVary: 0.45, flakeScale: 1.0, spread: 1.35,
    holoAuto: true, holoLift: 1.15, cover: 1.0,
    jitter: 0.72, vary: 0.25, sparkle: 0.85, angle: 35, gloss: 0.45, borderW: 6, borderHolo: 0.6
  },
  { // prismatic foil: a smooth sheet, so no speckle and a stronger sweep
    id: 'foil', name: 'Foil', mode: 2,
    intensity: 0.8, tint: 0.0, holoMix: 0.0, colorVary: 0.0, flakeScale: 1.0, spread: 1.1,
    holoAuto: true, holoLift: 1.15, cover: 1.0,
    jitter: 0.0, vary: 0.08, sparkle: 0.0, angle: 50, gloss: 0.92, borderW: 8, borderHolo: 0.15
  }
];

function freshState() {
  return Object.assign({
    preset: 0, seed: 7.31,
    holoColors: DEFAULT_PAL.slice(),
    border: true, shadow: false,
    shadowBlur: 8, shadowOpacity: 0.28, shadowX: 0, shadowY: 4,
    keepOriginal: true, exportScale: 3, outScale: 1
  }, PRESETS[0]);
}
const S = freshState();

// key -> [label, min, max, step]
const FIELDS = {
  intensity:     ['Shimmer',     0,   2,    0.01],
  tint:          ['Object tint', 0,   1,    0.01],
  colorVary:     ['Colour vary', 0,   1,    0.01],
  holoMix:       ['Holo flakes', 0,   1,    0.01],
  flakeScale:    ['Flake size',  0.3, 3,    0.01],
  spread:        ['Hue spread',  0.2, 3,    0.01],
  cover:         ['Coverage',    0.5, 1.15, 0.01],
  jitter:        ['Scatter',     0,   1,    0.01],
  holoLift:      ['Holo lift',   0.3, 2.5,  0.01],
  sparkle:       ['Sparkle',     0,   1,    0.01],
  angle:         ['Light angle', 0,   360,  1],
  gloss:         ['Gloss',       0,   1,    0.01],
  borderW:       ['Width',       0,   24,   0.5],
  borderHolo:    ['Silver holo', 0,   1,    0.01],
  shadowBlur:    ['Blur',        0,   30,   0.5],
  shadowOpacity: ['Opacity',     0,   1,    0.01],
  shadowX:       ['Offset X',   -20,  20,   0.5],
  shadowY:       ['Offset Y',   -20,  20,   0.5]
};

// Controls a preset's shader path never reads are hidden, not just left at
// zero — a slider that does nothing is worse than no slider. Foil is drawn by
// foil(), which only reads uFlakeScale, uSeed, uAngle and uSpread, so the whole
// disc-mosaic half of the panel is dead there. Light angle and Sparkle are cut
// from Foil by choice (Rikki: "remove light"); Gloss stays and carries it.
const HIDDEN = {
  // uSpread reaches the flake path only through `rainbow`, and at Object tint 1
  // with Auto spectrum off that value is replaced outright — so Hue spread is
  // dead on Tinted. It still works on Glitter (tint 0) and as Spectrum on Foil.
  tinted: ['spread'],
  foil: ['holoMix', 'colorVary', 'jitter', 'cover', 'holoLift', 'sparkle',
         'angle', 'tint', 'palette']
};
const presetId = () => PRESETS[S.preset].id;
const isHidden = (key) => (HIDDEN[presetId()] || []).indexOf(key) >= 0;

// Foil is a prismatic sheet, not a mosaic, so it drops the flake vocabulary.
// uFlakeScale sizes the domain-warped fbm and uSpread sets how many spectral
// bands the sweep runs through — "Swirl size" and "Spectrum" are what those
// actually do here.
const LABELS = {
  foil: { intensity: 'Sheen', flakeScale: 'Swirl size', spread: 'Spectrum' }
};
const TITLES = {
  foil: { flakes: 'Foil', texture: 'Pattern', light: 'Finish' }
};
const labelOf = (key) => ((LABELS[presetId()] || {})[key]) || FIELDS[key][0];
const titleOf = (sec) => ((TITLES[presetId()] || {})[sec.id]) || sec.title;

const SECTIONS = [
  { id: 'flakes',  title: 'Flakes',         open: true,  fields: ['intensity', 'tint', 'colorVary', 'holoMix'], palette: true },
  { id: 'texture', title: 'Texture',        open: false, fields: ['flakeScale', 'spread', 'cover', 'jitter'] },
  { id: 'light',   title: 'Light',          open: false, fields: ['holoLift', 'sparkle', 'angle', 'gloss'] },
  { id: 'border',  title: 'Die-cut border', open: false, fields: ['borderW', 'borderHolo'], toggle: 'border', brief: ['borderW'] },
  { id: 'shadow',  title: 'Drop shadow',    open: false, fields: ['shadowBlur', 'shadowOpacity', 'shadowX', 'shadowY'], toggle: 'shadow', brief: ['shadowBlur', 'shadowOpacity'] },
  { id: 'output',  title: 'Output',         open: false, fields: [], output: true }
];

const $ = (id) => document.getElementById(id);
const glCanvas = document.createElement('canvas');
const preview = $('preview');
const pctx = preview.getContext('2d');

let renderer, bitmap = null, nodeId = null, srcScale = 3;
let batch = null, pending = false, dirty = false, selTimer = 0;

try { renderer = new HoloRenderer(glCanvas); }
catch (e) { showError(e.message); }

// ---------------------------------------------------------------- formatting

function pct() { return Math.round(S.outScale * 100) + '%'; }

function fmt(key) {
  const f = FIELDS[key], v = S[key];
  if (f[3] >= 1) return key === 'angle' ? Math.round(v) + '°' : String(Math.round(v));
  const s = (+v).toFixed(2);
  return s.charAt(s.length - 1) === '0' ? s.slice(0, -1) : s;
}

function summary(sec) {
  if (sec.output) return S.exportScale + 'x · ' + pct() + ' · ' + (S.keepOriginal ? 'keep' : 'replace');
  if (sec.toggle && !S[sec.toggle]) return 'Off';
  const keys = (sec.brief || sec.fields).filter((k) => !isHidden(k));
  return keys.map(fmt).join(' · ');
}

// ---------------------------------------------------------------- sections

const syncs = [];     // called whenever S changes wholesale (preset switch, reset)
const host = $('sections');

// Assigned by buildPalette / buildOutput while the section loop runs below, so
// they have to be declared here — a later `let` would clobber the real ones.
let paintPalette = () => {};
let paintOutput = () => {};

SECTIONS.forEach((sec) => {
  const card = document.createElement('div');
  card.className = 'card sec' + (sec.open ? ' open' : '');

  const head = document.createElement('div');
  head.className = 'shead';
  head.innerHTML = '<span class="t"></span><span class="sum"></span>';
  const title = head.querySelector('.t');
  title.textContent = sec.title;
  card.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'rows';
  card.appendChild(rows);
  host.appendChild(card);          // in the document before we look ids up

  const sum = head.querySelector('.sum');
  // Blank while the card is open — the rows below already show every value.
  const setSummary = () => { sum.textContent = card.classList.contains('open') ? '' : summary(sec); };

  // header affordance: a switch for the optional sections, a chevron otherwise
  let sw = null;
  if (sec.toggle) {
    sw = document.createElement('button');
    sw.className = 'sw' + (S[sec.toggle] ? ' on' : '');
    sw.setAttribute('aria-label', sec.title);
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      S[sec.toggle] = !S[sec.toggle];
      sw.classList.toggle('on', S[sec.toggle]);
      card.classList.toggle('open', S[sec.toggle]);
      setSummary();
      schedule();
    });
    head.appendChild(sw);
  } else {
    const chev = document.createElement('span');
    chev.className = 'chev';
    head.appendChild(chev);
  }

  head.addEventListener('click', () => {
    if (sec.toggle && !S[sec.toggle]) return;   // nothing to show while it's off
    card.classList.toggle('open');
    setSummary();
  });

  const rowsByKey = [];
  sec.fields.forEach((key) => {
    const [label, min, max, step] = FIELDS[key];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<label></label>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '">' +
      '<span class="valbox"></span>';
    const lab = row.querySelector('label');
    lab.textContent = label;
    const input = row.querySelector('input');
    const box = row.querySelector('.valbox');
    const sync = () => {
      input.value = S[key];
      box.textContent = fmt(key);
      const pct = ((S[key] - min) / (max - min)) * 100;
      input.style.backgroundImage =
        'linear-gradient(90deg,var(--action) 0%,var(--action) ' + pct + '%,var(--track) ' + pct + '%,var(--track) 100%)';
      setSummary();
    };
    input.addEventListener('input', () => { S[key] = parseFloat(input.value); sync(); schedule(); });
    rows.appendChild(row);
    rowsByKey.push([key, row, lab]);
    syncs.push(sync);
    sync();
  });

  let palBlock = null;
  if (sec.palette) palBlock = buildPalette(rows, setSummary);
  if (sec.output) buildOutput(rows, setSummary);

  // A card whose every control is hidden disappears rather than sitting empty.
  const applyVis = () => {
    let live = sec.output === true;
    title.textContent = titleOf(sec);
    for (const [key, row, lab] of rowsByKey) {
      const h = isHidden(key);
      row.style.display = h ? 'none' : '';
      lab.textContent = labelOf(key);
      if (!h) live = true;
    }
    if (palBlock) {
      const h = isHidden('palette');
      palBlock.style.display = h ? 'none' : '';
      if (!h) live = true;
    }
    card.style.display = live ? '' : 'none';
  };

  syncs.push(() => {
    if (sw) { sw.classList.toggle('on', S[sec.toggle]); card.classList.toggle('open', S[sec.toggle]); }
    applyVis();
    setSummary();
  });
  applyVis();
  setSummary();
});

// ---------------------------------------------------------------- palette

function buildPalette(rows, setSummary) {
  const block = document.createElement('div');
  block.className = 'palblock';
  const head = document.createElement('div');
  head.className = 'palhead';
  head.innerHTML = '<span class="t">Holo colours</span><span class="n"></span>';
  const chips = document.createElement('div');
  chips.className = 'chips';
  chips.id = 'swatches';

  const autoRow = document.createElement('div');
  autoRow.innerHTML = '<label class="check"><input type="checkbox" id="holoAuto">Auto spectrum instead</label>';
  const autoBox = autoRow.querySelector('input');

  block.appendChild(head);
  block.appendChild(chips);
  block.appendChild(autoRow);
  rows.appendChild(block);

  const count = head.querySelector('.n');

  paintPalette = () => {
    autoBox.checked = S.holoAuto;
    chips.classList.toggle('auto', S.holoAuto);
    count.textContent = S.holoColors.length + ' / ' + PAL_MAX;
    chips.innerHTML = '';

    S.holoColors.forEach((hex, i) => {
      const chip = document.createElement('div');
      chip.className = 'chip';

      const well = document.createElement('div');
      well.className = 'well';
      const fill = document.createElement('div');
      fill.className = 'fillcol';
      fill.style.background = hex;
      well.appendChild(fill);

      const pick = document.createElement('input');
      pick.type = 'color';
      pick.value = hex;
      pick.title = 'Holo colour ' + (i + 1);
      pick.addEventListener('input', () => {
        S.holoColors[i] = pick.value;
        fill.style.background = pick.value;
        label.textContent = pick.value.replace('#', '').toUpperCase();
        if (S.holoAuto) { S.holoAuto = false; paintPalette(); }   // picking implies manual
        schedule();
      });
      well.appendChild(pick);

      if (S.holoColors.length > 1) {
        const kill = document.createElement('button');
        kill.className = 'kill';          // the cross itself is CSS, see .kill
        kill.title = 'Remove this colour';
        kill.setAttribute('aria-label', 'Remove ' + hex.replace('#', '').toUpperCase());
        kill.addEventListener('click', (e) => {
          e.stopPropagation();
          S.holoColors.splice(i, 1);
          paintPalette(); setSummary(); schedule();
        });
        well.appendChild(kill);
      }

      const label = document.createElement('span');
      label.className = 'hex';
      label.textContent = hex.replace('#', '').toUpperCase();

      chip.appendChild(well);
      chip.appendChild(label);
      chips.appendChild(chip);
    });

    const add = document.createElement('div');
    add.className = 'chip add' + (S.holoColors.length >= PAL_MAX ? ' full' : '');
    add.innerHTML = '<div class="well">+</div><span class="hex">Add</span>';
    add.addEventListener('click', () => {
      if (S.holoColors.length >= PAL_MAX) return;
      const spare = SPARE_PAL.concat(DEFAULT_PAL).find((c) => S.holoColors.indexOf(c) < 0);
      S.holoColors.push(spare || '#ffffff');
      S.holoAuto = false;
      paintPalette(); setSummary(); schedule();
    });
    chips.appendChild(add);
  };

  autoBox.addEventListener('change', () => { S.holoAuto = autoBox.checked; paintPalette(); schedule(); });
  syncs.push(() => paintPalette());
  paintPalette();
  return block;
}

// ---------------------------------------------------------------- output

function buildOutput(rows, setSummary) {
  // Size scales the placed sticker on canvas; Resolution is how many pixels
  // are rendered into it. Effective sharpness is exportScale / outScale, so
  // the row warns once scaling outruns the render.
  const sizeRow = document.createElement('div');
  sizeRow.className = 'row';
  sizeRow.innerHTML =
    '<label>Size</label>' +
    '<input type="range" min="0.25" max="3" step="0.05">' +
    '<span class="valbox"></span>';
  const sizeInput = sizeRow.querySelector('input');
  const sizeBox = sizeRow.querySelector('.valbox');
  // Kept free of paintOutput so paintOutput can call it without recursing.
  const syncSize = () => {
    sizeInput.value = S.outScale;
    sizeBox.textContent = pct();
    const p = ((S.outScale - 0.25) / (3 - 0.25)) * 100;
    sizeInput.style.backgroundImage =
      'linear-gradient(90deg,var(--action) 0%,var(--action) ' + p + '%,var(--track) ' + p + '%,var(--track) 100%)';
  };
  sizeInput.addEventListener('input', () => {
    S.outScale = parseFloat(sizeInput.value);
    syncSize(); setSummary(); paintOutput();
  });
  rows.appendChild(sizeRow);
  syncSize();

  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label>Resolution</label><div class="segsm"></div>';
  const seg = row.querySelector('.segsm');
  [2, 3, 4].forEach((n) => {
    const b = document.createElement('button');
    b.textContent = n + 'x';
    b.dataset.scale = n;
    b.addEventListener('click', () => {
      S.exportScale = n;
      paintOutput(); setSummary();
      post({ type: 'request-source', scale: S.exportScale, pad: padPx() });
    });
    seg.appendChild(b);
  });

  const note = document.createElement('div');
  note.className = 'note';
  note.id = 'scaleNote';

  const keepRow = document.createElement('div');
  keepRow.innerHTML = '<label class="check"><input type="checkbox" id="keep">Keep the original layer</label>';
  const keep = keepRow.querySelector('input');

  rows.appendChild(row);
  rows.appendChild(note);
  rows.appendChild(keepRow);

  keep.checked = S.keepOriginal;
  keep.addEventListener('change', () => { S.keepOriginal = keep.checked; setSummary(); });

  paintOutput = () => {
    [...seg.children].forEach((b) => b.classList.toggle('on', +b.dataset.scale === S.exportScale));
    keep.checked = S.keepOriginal;
    syncSize();
    const density = S.exportScale / S.outScale;
    note.textContent = density < 1
      ? 'Soft at this size. Raise Resolution to ' + Math.ceil(S.outScale) + 'x or higher.'
      : '';
    note.style.display = note.textContent ? 'block' : 'none';
  };
  syncs.push(() => { paintOutput(); });
  paintOutput();
}

// ---------------------------------------------------------------- presets

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
  Object.assign(S, PRESETS[S.preset]);   // the palette is deliberately not in PRESETS
  syncs.forEach((f) => f());
  schedule();
});

$('shuffle').addEventListener('click', () => { S.seed = Math.random() * 97; schedule(); });
$('reset').addEventListener('click', () => {
  Object.assign(S, freshState());
  [...tabs.children].forEach((x, i) => x.classList.toggle('on', i === S.preset));
  syncs.forEach((f) => f());
  schedule();
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
    holoN: S.holoColors.length,
    holoPal: S.holoColors.map(hexRGB)
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

const CREDIT = 'Vibe Coded by <a href="https://rikkijanae.com" target="_blank" rel="noopener">Rikki Janae</a>';
function setMeta(text) { $('meta').innerHTML = text ? text : CREDIT; }
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
  setMeta('Rendering…');
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
    setMeta('');
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
    // The credit line stays put; only transient status replaces it.
    setMeta(msg.scale < msg.requestedScale ? 'Capped to ' + msg.scale + 'x' : '');
    schedule();
    return;
  }

  if (msg.type === 'batch-source') {
    batch = { i: msg.index, total: msg.total };
    setMeta('Rendering ' + (msg.index + 1) + '/' + msg.total + '…');
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
      outScale: S.outScale,
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
    setMeta('Done');
    setTimeout(() => { if (!batch) setMeta(''); }, 1600);
    // The new image is now selected, which triggers a fresh preview.
    return;
  }

  if (msg.type === 'error') showError(msg.message);
};

setMeta('');
post({ type: 'ready', scale: S.exportScale, pad: padPx() });
