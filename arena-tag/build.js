#!/usr/bin/env node
// Bundles the modular src/*.js files + style.css + index.html into one
// self-contained ArenaTag.html with no external requests and no ES module
// imports, so it can be opened directly via file:// (double-click, no
// local server needed). Re-run this after editing src/ to refresh it.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

// Dependency order: each file only refers to identifiers already defined
// earlier in this list.
const ORDER = [
  'config', 'rng', 'skins', 'storage', 'modes', 'maps',
  'world', 'entity', 'ai', 'camera', 'renderer', 'touch',
  'input', 'game', 'ui', 'main',
];

function stripModuleSyntax(src) {
  return src
    .replace(/^import .*;$/gm, '')
    .replace(/^export\s+(const|class|function)/gm, '$1');
}

let bundle = '';
for (const name of ORDER) {
  const file = path.join(SRC, `${name}.js`);
  let code = stripModuleSyntax(fs.readFileSync(file, 'utf8'));
  bundle += `\n/* ---- ${name}.js ---- */\n${code}\n`;
  if (name === 'storage') {
    // storage.js was imported as `import * as store from './storage.js'`;
    // rebuild that namespace object now that its functions are in scope.
    bundle += '\nconst store = { load, save, addCoins, buySkin, equipSkin, recordMatch };\n';
  }
}

const wrapped = `(function () {\n'use strict';\n${bundle}\n})();\n`;

// Sanity check: no top-level identifier should be declared twice, since
// everything now shares one function scope.
const decls = [...wrapped.matchAll(/^(?:const|let|class|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const seen = new Map();
for (const d of decls) seen.set(d, (seen.get(d) || 0) + 1);
const dupes = [...seen.entries()].filter(([, n]) => n > 1);
if (dupes.length) {
  console.error('Bundle has duplicate top-level identifiers:', dupes);
  process.exit(1);
}

const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css" />', `<style>\n${css}\n</style>`);
html = html.replace(
  '<script type="module" src="src/main.js"></script>',
  `<script>\n${wrapped}\n</script>`,
);

fs.writeFileSync(path.join(ROOT, 'ArenaTag.html'), html);
console.log('Built ArenaTag.html (%d KB)', (Buffer.byteLength(html) / 1024).toFixed(1));
