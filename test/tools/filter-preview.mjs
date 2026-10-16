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
const ortoCells = [];
const orto = env.layer('Geoportal - ortofoto');
if (orto) {
  orto.grid.forEach((line, row) => line.forEach((tile, column) => {
    const cell = plain(tile.imgDiv?.src || '');
    if (!cell) return;
    ortos[`${row},${column}`] = cell;
    ortoCells.push({ row, column, url: cell });
  }));
}
// The same photo, as a grid of cells of the view: a single-image layer covers the
// whole view, so its background is the whole grid, not one cell.
const ortoGrid = orto ? { rows: orto.grid.length, columns: orto.grid[0].length, cells: ortoCells } : null;

/** The photo under an overlay: one cell of the view for a layer of cells, the grid
 *  of the view for a layer that is one image. */
function under(row, className) {
  if (row.grid) {
    return `<div class="bg-grid" style="grid-template-columns:repeat(${row.grid.columns},1fr);` +
      `grid-template-rows:repeat(${row.grid.rows},1fr)">` +
      row.grid.cells.map(cell => `<img src="${cell.url}" alt="" loading="lazy">`).join('') + '</div>';
  }
  return `<div class="${className}"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}></div>`;
}

/** The same address with another image size. */
function withSize(url, width, height) {
  const query = new URLSearchParams(params(url));
  query.set('WIDTH', String(Math.max(64, Math.round(width))));
  query.set('HEIGHT', String(Math.max(64, Math.round(height))));
  return `${url.split('?')[0]}?${query}`;
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
  // The script may already ask for a magnified drawing (a layer with text to
  // read). The page shows three columns: the drawing at its own size (what the
  // service would send without the magnification), the request the script makes
  // now, and that request magnified by the slider. `wide` is the address at the
  // service's own size, which is what the slider divides.
  const base = LAYERS[name].magnify ?? 1;
  const wide = base === 1 ? url : withSize(url, Number(query.WIDTH) * base, Number(query.HEIGHT) * base);
  rows.push({
    name: name.replace('Geoportal - ', ''),
    kind,
    base,
    wide,
    url,
    grid: layer.singleTile ? ortoGrid : null,
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
  :root { --brightness: 2.4; --brightness-dark: 2.1; --saturate: 1.8; --contrast: 1.1;
          --thin: 0.8; --mid: 1.6; --halo: 2.6; --shadow: #fff; }
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
  .f-colour img { filter: brightness(var(--brightness)) saturate(var(--saturate)) contrast(var(--contrast))
                          drop-shadow(0 0 var(--thin) var(--shadow)) drop-shadow(0 0 var(--mid) var(--shadow))
                          drop-shadow(0 0 var(--halo) var(--shadow)); }
  .f-dark img { filter: brightness(var(--brightness-dark)) saturate(1)
                        drop-shadow(0 0 var(--thin) var(--shadow)) drop-shadow(0 0 var(--mid) var(--shadow))
                        drop-shadow(0 0 var(--halo) var(--shadow)); }
  .stage { position: relative; width: 300px; }
  .bg-grid { position: absolute; inset: 0; display: grid; }
  .bg-grid img { width: 100%; height: 100%; display: block; }
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
  Ka&#380;da warstwa jest pokazana trzy razy: tak, jak j&#261; rysuje us&#322;uga (po lewej), jak widzi j&#261; skrypt
  (rozja&#347;nienie tuszu, wzmocnienie koloru i bia&#322;a obw&oacute;dka pod rysunkiem) i - w trzeciej kolumnie -
  jak widzi j&#261; skrypt, gdy poprosi us&#322;ug&#281; o ten sam obszar w mniejszej liczbie pikseli
  (suwak <code>&times;m</code>) i rozci&#261;gnie obraz na tym samym miejscu: napisy us&#322;ugi, kt&oacute;rych
  wielko&#347;ci nie da si&#281; zmieni&#263;, s&#261; wtedy <code>m</code> razy wi&#281;ksze.
  Zmie&#324; liczby poni&#380;ej, a wszystkie podgl&#261;dy po prawej zmieni&#261; si&#281; od razu &mdash; powiedz,
  kt&oacute;re warto wpisa&#263; do skryptu. Adresy s&#261; w podgl&#261;dzie dla por&oacute;wnania (bez filtra).
  Miejsce: Imbramowice na Dolnym &#346;l&#261;sku, ${centre.lat.toFixed(5)}, ${centre.lon.toFixed(5)}.
</p>
<fieldset><legend>Filtr warstw cienkich (na &#380;ywo)</legend>
  <label>jasno&#347;&#263; kolor&oacute;w <code>brightness()</code>
    <input id="b" type="range" min="1" max="3" step="0.05" value="2.4"></label>
  <label>jasno&#347;&#263; czarnych linii
    <input id="bd" type="range" min="1" max="3" step="0.05" value="2.1"></label>
  <label>kolor <code>saturate()</code>
    <input id="s" type="range" min="1" max="3" step="0.05" value="1.8"></label>
  <label>kontrast tuszu <code>contrast()</code>
    <input id="k" type="range" min="1" max="1.6" step="0.02" value="1.1"></label>
  <label>obw&oacute;dka szeroka
    <input id="h" type="range" min="0" max="4" step="0.1" value="2.6"></label>
  <label>obw&oacute;dka &#347;rednia
    <input id="m2" type="range" min="0" max="3" step="0.1" value="1.6"></label>
  <label>obw&oacute;dka cienka
    <input id="t" type="range" min="0" max="2" step="0.1" value="0.8"></label>
  <label>kolor obw&oacute;dki
    <input id="c" type="color" value="#ffffff"></label>
  <label>powi&#281;kszenie rysunku <code>&times;m</code>
    <input id="m" type="range" min="1" max="3" step="0.5" value="2"></label>
  <div>W skrypcie teraz: <code id="css">brightness(2.4) saturate(1.8) contrast(1.1)</code></div>
</fieldset>
${rows.map(row => `<div class="row">
  <h2>${row.name}<small>${row.kind ? `filtr: ${row.kind}` : 'bez filtra (por&#243;wnanie)'} &middot; ${row.detail}</small></h2>
  <div class="pair">
    <figure><figcaption>tak rysuje us&#322;uga (bez powi&#281;kszenia)</figcaption>
      <div class="shot sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        ${row.grid ? `<div class="stage">${under(row, 'under')}<img class="over" src="${row.wide}" alt="${row.name}" loading="lazy"></div>`
          : `<img src="${row.wide}" alt="${row.name}" loading="lazy">`}</div></figure>
    ${row.kind ? `<figure class="filtered f-${row.kind}"><figcaption>tak widzi skrypt</figcaption>
      <div class="stage sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        ${under(row, 'under')}
        <img class="over" src="${row.url}" alt="${row.name} z filtrem" loading="lazy"></div>
      </figure>
      <figure class="filtered f-${row.kind} mag"><figcaption>skrypt z powi&#281;kszeniem &times;<span class="mv">2</span> (w skrypcie teraz: &times;${row.base})</figcaption>
      <div class="stage sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        ${under(row, 'under')}
        <img class="over" data-url="${row.wide}" alt="${row.name} z filtrem i powi&#281;kszeniem" loading="lazy"></div>
      </figure>` : ''}
  </div>
</div>`).join('\n')}
<script>
  const root = document.documentElement;
  const fields = { b: '--brightness', bd: '--brightness-dark', s: '--saturate', k: '--contrast',
                   h: '--halo', m2: '--mid', t: '--thin' };
  const sync = () => {
    Object.entries(fields).forEach(([id, name]) =>
      root.style.setProperty(name, document.getElementById(id).value));
    root.style.setProperty('--shadow', document.getElementById('c').value);
    const hex = document.getElementById('c').value;
    const short = hex.length === 7 && hex[1] === hex[2] && hex[3] === hex[4] && hex[5] === hex[6]
      ? '#' + hex[1] + hex[3] + hex[5] + '' : hex;
    const b = document.getElementById('b').value, bd = document.getElementById('bd').value;
    const s = document.getElementById('s').value, k = document.getElementById('k').value;
    const h = document.getElementById('h').value, mid = document.getElementById('m2').value;
    const t = document.getElementById('t').value;
    const halos = 'drop-shadow(0 0 ' + t + 'px ' + short + ') drop-shadow(0 0 ' + mid + 'px ' + short + ')' +
      ' drop-shadow(0 0 ' + h + 'px ' + short + ')';
    document.getElementById('css').textContent =
      'dark: brightness(' + bd + ') ' + halos + '  |  colour: brightness(' + b + ') saturate(' + s + ') contrast(' + k + ') ' + halos;
  };
  // The magnified column: the same address with the size divided by m, stretched
  // over the same place - the browser does the rest, exactly as on the map.
  const magnified = (url, m) => {
    if (m <= 1) return url;
    const u = new URL(url);
    ['WIDTH', 'HEIGHT'].forEach(key => {
      const value = Number(u.searchParams.get(key));
      if (value) u.searchParams.set(key, Math.max(64, Math.round(value / m)));
    });
    return u.toString();
  };
  const resize = () => {
    const m = Number(document.getElementById('m').value);
    document.querySelectorAll('img[data-url]').forEach(img => {
      img.src = magnified(img.dataset.url, m);
    });
    document.querySelectorAll('.mv').forEach(span => { span.textContent = String(m); });
  };
  ['b','bd','s','k','h','m2','t','c'].forEach(id => document.getElementById(id).addEventListener('input', sync));
  document.getElementById('m').addEventListener('input', resize);
  sync();
  resize();
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
