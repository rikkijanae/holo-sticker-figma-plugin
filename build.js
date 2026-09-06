#!/usr/bin/env node
// Assembles src/* into the single-file ui.html that Figma needs.
// Run: node build.js   (no dependencies)
const fs = require('fs');
const p = (f) => fs.readFileSync(__dirname + '/src/' + f, 'utf8');

const out =
  p('ui.head.html') +
  '\n<script>\n' + p('holo.js').replace(/if \(typeof module[\s\S]*$/, '') + '\n</script>\n' +
  '<script>\n' + p('app.js') + '\n</script>\n';

fs.writeFileSync(__dirname + '/ui.html', out);
console.log('ui.html written (' + (out.length / 1024).toFixed(1) + ' kB)');
