#!/usr/bin/env node
/**
 * Write a page that shows the real Geoportal drawings twice - as the service sends
 * them and with the filter the script puts on the layer - so the readability of the
 * thin-stroke layers can be judged (and the numbers tuned) in a browser instead of
 * on the map.
 *
 *   node test/tools/filter-preview.mjs            # writes test/.cache/filter-preview.html
 *   node test/tools/filter-preview.mjs --serve    # ...and serves test/.cache on :8012
 *
 * The page needs the internet: it loads each drawing straight from the Geoportal,
 * for the address the layer's own request has (the cell of the view centre for the
 * tile layers, the whole view for a single-tile layer).
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(HERE, '..');
const OUT = path.join(TEST_DIR, '.cache', 'filter-preview.html');
const require = createRequire(import.meta.url);
const { boot, params, plain } = require(path.join(TEST_DIR, 'lib', 'harness.cjs'));
const { LAYERS } = require(path.join(TEST_DIR, 'lib', 'fixtures.cjs'));

/** The layers worth looking at: every filtered one, plus one unfiltered for control. */
const SHOW = [
  'Geoportal - podział adm',
  'Geoportal - Miasta',
  'Geoportal - gminy',
  'Geoportal - powiaty',
  'Geoportal - województwa',
  'Geoportal - Granica PL',
  'Geoportal - drogi',
  'Geoportal - przejazdy kolejowe (wymagany duży zoom)',
  'Geoportal - obiekty topograficzne',
  'BDOT - Numer drogi',
  'Geoportal - adresy'
];

// The place of the report: Imbramowice, the coordinates shown in its screenshots.
const env = await boot({
  view: { w: 1000, h: 700 }, zoom: 18, enabled: 'all',
  center: { lon: 16.56859, lat: 50.96774 }
});
await env.drawAll();

// The photo of every cell of the view, by grid position, so each overlay can be
// shown over the imagery the editor would have under it.
const ortos = {};
const orto = env.layer('Geoportal - ortofoto');
if (orto) {
  orto.grid.forEach((line, row) => line.forEach((tile, column) => {
    const cell = plain(tile.imgDiv?.src || '');
    if (cell) ortos[`${row},${column}`] = cell;
  }));
}

const rows = [];
for (const name of SHOW) {
  const layer = env.layer(name);
  if (!layer) continue;
  const kind = LAYERS[name].contrast || '';
  let url = '';
  let row = null, column = null;
  if (layer.singleTile) {
    url = env.requestOf(layer);
  } else {
    row = Math.floor(layer.grid.length / 2);
    column = Math.floor(layer.grid[row].length / 2);
    const tile = env.tileAt(layer, row, column);
    url = plain(tile?.imgDiv?.src || '') || env.requestOf(layer);
  }
  if (!url) continue;
  const query = params(url);
  rows.push({
    name: name.replace('Geoportal - ', ''),
    kind,
    url,
    // The cell of the same grid, as the ortho service draws it: the overlays are
    // transparent, so this is what the editor shows underneath them.
    bg: layer.singleTile ? '' : ortos[`${row},${column}`] || '',
    detail: `${query.CRS || ''} ${query.WIDTH || ''}x${query.HEIGHT || ''}`.trim()
  });
}

// The layers are asked while zooming, so the cells of one view are of one place.
const centre = env.map.getCenter();
env.close();

const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<title>Geoportal WME - podglad czytelnosci warstw</title>
<style>
  :root { --brightness: 1.8; --saturate: 1.5; --halo: 1.8; --thin: 0.9; --shadow: #fff; }
  body { margin: 0; padding: 24px 28px 60px; background: #10141a; color: #e8eef6;
         font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { margin: 0 0 18px; color: #9fb0c4; max-width: 90ch; }
  fieldset { border: 1px solid #263245; border-radius: 8px; padding: 12px 16px; margin: 0 0 22px; }
  legend { color: #9fb0c4; padding: 0 6px; }
  label { display: inline-block; margin-right: 18px; white-space: nowrap; }
  input[type=range] { vertical-align: middle; width: 140px; }
  code { color: #7fd1ff; }
  .row { border-top: 1px solid #1e2735; padding: 14px 0; }
  .row h2 { font-size: 15px; margin: 0 0 8px; font-weight: 600; }
  .row h2 small { color: #7f8ea3; font-weight: 400; margin-left: 8px; }
  .pair { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { color: #7f8ea3; font-size: 12px; margin-bottom: 4px; }
  .shot { background: #1b2430; border: 1px solid #263245; border-radius: 6px; overflow: hidden;
          width: 300px; }
  .shot img { display: block; width: 300px; height: auto; image-rendering: -webkit-optimize-contrast; }
  .filtered img { filter: brightness(var(--brightness)) saturate(var(--saturate))
                          drop-shadow(0 0 0 var(--shadow)) drop-shadow(0 0 0 var(--shadow)); }
  .f-colour img { filter: brightness(var(--brightness)) saturate(var(--saturate))
                          drop-shadow(0 0 var(--thin) var(--shadow)) drop-shadow(0 0 var(--halo) var(--shadow)); }
  .f-dark img { filter: brightness(var(--brightness)) saturate(1)
                        drop-shadow(0 0 var(--thin) var(--shadow)) drop-shadow(0 0 var(--halo) var(--shadow)); }
  .stage { position: relative; width: 300px; }
  .stage .under { position: absolute; inset: 0; background-color: #1b2430;
                  background-position: center; background-size: 100% 100%; }
  .stage .over { position: relative; }
  .sat { background: #2a2a24; }
  .shot.has-bg, .stage.has-bg { border-color: #3a4658; }
  .shot.has-bg { background-image: var(--bg); background-size: 100% 100%; }
  a { color: #7fd1ff; }
</style></head>
<body>
<h1>Geoportal WME &mdash; podgl&#261;d czytelno&#347;ci warstw</h1>
<p class="lead">
  Ka&#380;da warstwa jest pokazana tak, jak j&#261; rysuje us&#322;uga (po lewej) i tak, jak widzi j&#261; skrypt
  (po prawej): rozja&#347;nienie tuszu, wzmocnienie koloru i bia&#322;a obw&oacute;dka pod rysunkiem.
  Zmie&#324; liczby poni&#380;ej, a wszystkie podgl&#261;dy po prawej zmieni&#261; si&#281; od razu &mdash; powiedz,
  kt&oacute;re warto wpisa&#263; do skryptu. Adresy s&#261; w podgl&#261;dzie dla por&oacute;wnania (bez filtra).
  Miejsce: Imbramowice na Dolnym &#346;l&#261;sku, ${centre.lat.toFixed(5)}, ${centre.lon.toFixed(5)}.
</p>
<fieldset><legend>Filtr warstw cienkich (na &#380;ywo)</legend>
  <label>jasno&#347;&#263; <code>brightness()</code>
    <input id="b" type="range" min="1" max="2.6" step="0.05" value="1.8"></label>
  <label>kolor <code>saturate()</code>
    <input id="s" type="range" min="1" max="2.4" step="0.05" value="1.5"></label>
  <label>obw&oacute;dka <code>drop-shadow()</code>
    <input id="h" type="range" min="0" max="3" step="0.1" value="1.8"></label>
  <label>obw&oacute;dka cienka
    <input id="t" type="range" min="0" max="2" step="0.1" value="0.9"></label>
  <label>kolor obw&oacute;dki
    <input id="c" type="color" value="#ffffff"></label>
  <div>W skrypcie: <code id="css">brightness(1.8) saturate(1.5) drop-shadow(0 0 0.9px #fff) drop-shadow(0 0 1.8px #fff)</code></div>
</fieldset>
${rows.map(row => `<div class="row">
  <h2>${row.name}<small>${row.kind ? `filtr: ${row.kind}` : 'bez filtra (por&#243;wnanie)'} &middot; ${row.detail}</small></h2>
  <div class="pair">
    <figure><figcaption>tak rysuje us&#322;uga</figcaption>
      <div class="shot sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        <img src="${row.url}" alt="${row.name}" loading="lazy"></div></figure>
    ${row.kind ? `<figure class="filtered f-${row.kind}"><figcaption>tak widzi skrypt</figcaption>
      <div class="stage sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        <div class="under"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}></div>
        <img class="over" src="${row.url}" alt="${row.name} z filtrem" loading="lazy"></div>
      </figure>` : ''}
  </div>
</div>`).join('\n')}
<script>
  const root = document.documentElement;
  const fields = { b: '--brightness', s: '--saturate', h: '--halo', t: '--thin' };
  const sync = () => {
    Object.entries(fields).forEach(([id, name]) =>
      root.style.setProperty(name, document.getElementById(id).value));
    root.style.setProperty('--shadow', document.getElementById('c').value);
    const hex = document.getElementById('c').value;
    const short = hex.length === 7 && hex[1] === hex[2] && hex[3] === hex[4] && hex[5] === hex[6]
      ? '#' + hex[1] + hex[3] + hex[5] + '' : hex;
    const b = document.getElementById('b').value, s = document.getElementById('s').value;
    const h = document.getElementById('h').value, t = document.getElementById('t').value;
    document.getElementById('css').textContent =
      'dark: brightness(' + b + ') drop-shadow(0 0 ' + t + 'px ' + short + ') drop-shadow(0 0 ' + h + 'px ' + short + ')' +
      '  |  colour: brightness(' + b + ') saturate(' + s + ') drop-shadow(0 0 ' + t + 'px ' + short + ') drop-shadow(0 0 ' + h + 'px ' + short + ')';
  };
  ['b','s','h','t','c'].forEach(id => document.getElementById(id).addEventListener('input', sync));
  sync();
</script>
</body></html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`[preview] ${path.relative(process.cwd(), OUT)}: ${rows.length} layers ` +
  `(${rows.filter(row => row.kind).length} with a filter)`);

if (process.argv.includes('--serve')) {
  const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || 8012);
  const server = http.createServer((request, response) => {
    const file = path.join(TEST_DIR, '.cache', decodeURIComponent(request.url.split('?')[0]) === '/' ?
      path.basename(OUT) : path.basename(request.url.split('?')[0]));
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404); response.end('not found'); return; }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(data);
    });
  });
  server.listen(port, '0.0.0.0', () => console.log(`[preview] http://0.0.0.0:${port}/filter-preview.html`));
}
