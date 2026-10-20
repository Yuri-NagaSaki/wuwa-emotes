// Assemble the single-file design prototype from src/ parts.
// usage: node build.js  -> writes tidepool-ui.html (artifact page, no doctype) and _preview.html (local check)
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const rd = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const opt = (f) => (fs.existsSync(path.join(dir, 'src', f)) ? rd(f) : '');

const css = ['font.css', 'board.css', 'tp-base.css', 'tp-components.css', 'tp-pages.css', 'tp-admin.css', 'tp-v3.css'].map(opt).join('\n');
const js = ['config.js', 'icons.js', '../data.js', 'mock.js', 'ui.js', 'pages-public.js', 'pages-ds.js', 'pages-admin.js', 'board.js']
  .map((f) => (f.startsWith('../') ? fs.readFileSync(path.join(dir, f.slice(3)), 'utf8') : opt(f))).join('\n;\n');

const page = `${rd('head.html')}
<style>
${css}
</style>
${rd('body.html')}
<script>
"use strict";
${js}
</script>
`;
fs.writeFileSync(path.join(dir, 'tidepool-ui.html'), page);
const preview = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
fs.writeFileSync(path.join(dir, '_preview.html'), preview);
console.log('built', (page.length / 1024).toFixed(0) + ' KB (css ' + (css.length / 1024).toFixed(0) + ' KB, js ' + (js.length / 1024).toFixed(0) + ' KB)');
