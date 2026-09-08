// Shiny Sticker — Figma plugin main thread.
// Exports the selection to PNG, hands the pixels to the UI (which does the
// WebGL work), then puts the processed result back in as an image node.

figma.showUI(__html__, { width: 370, height: 740, title: 'Shiny Sticker by Rikki Janae' });

var MAX_IMAGE_DIM = 4096; // Figma's hard limit for createImage()
var PREVIEW_MAX = 640;    // preview exports are capped to this many px

// ---------------------------------------------------------------- selection

function exportable(node) {
  return node && typeof node.exportAsync === 'function' && 'absoluteBoundingBox' in node;
}

function currentTargets() {
  return figma.currentPage.selection.filter(exportable);
}

// Largest export scale that keeps the padded output inside Figma's limit.
function pickScale(w, h, padDesignPx, requested) {
  var scale = requested;
  while (scale > 0.5) {
    var ow = Math.ceil((w + padDesignPx * 2) * scale);
    var oh = Math.ceil((h + padDesignPx * 2) * scale);
    if (ow <= MAX_IMAGE_DIM && oh <= MAX_IMAGE_DIM) return scale;
    scale -= 0.5;
  }
  return 0.5;
}

async function sendSource(node, scale, padDesignPx, tag, extra, preview) {
  var box = node.absoluteRenderBounds || node.absoluteBoundingBox;
  if (!box || box.width < 1 || box.height < 1) {
    figma.ui.postMessage({ type: 'error', message: '"' + node.name + '" has no visible pixels.' });
    return false;
  }
  var s = pickScale(box.width, box.height, padDesignPx, scale);
  if (preview) {
    // The preview only needs enough pixels to fill the panel. Everything in
    // the shader is in design px, so a lower export scale looks identical.
    var m = Math.max(box.width, box.height) + padDesignPx * 2;
    s = Math.max(0.25, Math.min(s, PREVIEW_MAX / m));
  }
  var bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: s } });
  var msg = {
    type: tag,
    bytes: bytes,
    nodeId: node.id,
    name: node.name,
    scale: s,
    requestedScale: scale
  };
  if (extra) for (var k in extra) msg[k] = extra[k];
  figma.ui.postMessage(msg);
  return true;
}

async function pushSelection(scale, padDesignPx) {
  var targets = currentTargets();
  if (targets.length === 0) {
    figma.ui.postMessage({ type: 'no-selection' });
    return;
  }
  // The preview always shows the first selected layer.
  await sendSource(targets[0], scale, padDesignPx, 'source', {
    count: targets.length
  }, true);
}

// ---------------------------------------------------------------- insertion

function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v);
  return new Uint8Array(Object.keys(v).map(function (k) { return v[k]; }));
}

function place(node, bytes, scale, padOutputPx, keepOriginal) {
  var image = figma.createImage(toBytes(bytes));
  var abb = node.absoluteBoundingBox;
  var arb = node.absoluteRenderBounds || abb;
  var padUnits = padOutputPx / scale;

  var rect = figma.createRectangle();
  rect.name = node.name + ' — holo';
  rect.resize(arb.width + padUnits * 2, arb.height + padUnits * 2);
  rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];

  var parent = node.parent || figma.currentPage;
  var index = 'children' in parent ? parent.children.indexOf(node) + 1 : 0;
  parent.insertChild(Math.max(index, 0), rect);

  // node.x/y are parent-relative; the abb -> arb delta is the render-bounds offset.
  rect.x = node.x + (arb.x - abb.x) - padUnits;
  rect.y = node.y + (arb.y - abb.y) - padUnits;

  if (!keepOriginal) node.visible = false;
  return rect;
}

// ---------------------------------------------------------------- messaging

var made = [];

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'ready' || msg.type === 'request-source') {
    await pushSelection(msg.scale || 3, msg.pad || 40);
    return;
  }

  // UI wants the pixels for item N of the current selection.
  if (msg.type === 'request-batch') {
    var targets = currentTargets();
    if (msg.index === 0) made = [];
    if (msg.index >= targets.length) {
      if (made.length) figma.currentPage.selection = made;
      figma.notify(made.length + (made.length === 1 ? ' holo sticker' : ' holo stickers') + ' ✦');
      figma.ui.postMessage({ type: 'done' });
      return;
    }
    var ok = await sendSource(targets[msg.index], msg.scale, msg.pad, 'batch-source', {
      index: msg.index,
      total: targets.length
    });
    if (!ok) figma.ui.postMessage({ type: 'skip', index: msg.index, total: targets.length });
    return;
  }

  // UI finished a full-res render.
  if (msg.type === 'result') {
    var node = await figma.getNodeByIdAsync(msg.nodeId);
    if (node) made.push(place(node, msg.bytes, msg.scale, msg.pad, msg.keepOriginal));
    figma.ui.postMessage({ type: 'placed', index: msg.index, total: msg.total });
    return;
  }

  if (msg.type === 'resize') {
    figma.ui.resize(370, Math.max(420, Math.min(1000, Math.round(msg.height))));
    return;
  }

  if (msg.type === 'close') figma.closePlugin();
};

figma.on('selectionchange', function () {
  figma.ui.postMessage({ type: 'selection-changed' });
});
