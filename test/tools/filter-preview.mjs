#!/usr/bin/env node
/**
 * Write a page that shows the real Geoportal drawings three times, over the real
 * ortho photo, in one box of the same size each:
 *
 *   - as the service draws the cell at its own size (no filter) - the reference,
 *   - as the previous version showed it (the drawing of 1:1 under the wide white
 *     halo of the rounds up to 22, which is what the reports are about),
 *   - as the script shows it now (the image of half the pixels, which makes the
 *     service draw its letters twice as big, stretched back and put through the
 *     filters that snap every edge onto the pixel grid).
 *
 * The drawings are loaded straight from the Geoportal, for the address the script's
 * own request has, and both treatments use the script's own filter strings, so what
 * the page shows is what the map shows - only without the editor around it.
 *
 *   node test/tools/filter-preview.mjs            # writes test/.cache/filter-preview.html
 *   node test/tools/filter-preview.mjs --serve    # ...and serves it on :8012
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

/** The layers worth looking at: every layer whose letters are re-drawn, plus the
 *  two that keep their own colour, for comparison. */
const SHOW = [
  'Geoportal - podział adm',
  'Geoportal - Miasta',
  'Geoportal - gminy',
  'Geoportal - powiaty',
  'Geoportal - województwa',
  'Geoportal - Granica PL',
  'Geoportal - obiekty topograficzne',
  'Geoportal - adresy',
  'Geoportal - ulice',
  'Geoportal - place',
  'Geoportal - przejazdy kolejowe (wymagany duży zoom)',
  'Geoportal - drogi',
  'BDOT - Numer drogi'
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
  // The same cell with the pixels the map draws it with: that is the drawing of the
  // previous rounds, at one pixel per pixel.
  const full = withSize(url, Number(query.WIDTH) * 2, Number(query.HEIGHT) * 2);
  rows.push({
    name: name.replace('Geoportal - ', ''),
    kind,
    url,
    full,
    bg: layer.singleTile ? '' : ortos[`${row},${column}`] || '',
    detail: `${query.CRS || ''} ${query.WIDTH || ''}x${query.HEIGHT || ''}`.trim()
  });
}

// The numbers and the filter elements the script ships, so the page opens on them.
const filter = env.internals.CONTRAST_FILTER;
const svg = env.internals.CONTRAST_SVG;
const centre = env.map.getCenter();
env.close();

const box = 320;
const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<title>Geoportal WME - podglad podpisow</title>
<style>
  body { margin: 0; padding: 24px 28px 60px; background: #10141a; color: #e8eef6;
         font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p.lead { margin: 0 0 16px; color: #9fb0c4; max-width: 100ch; }
  code { color: #7fd1ff; }
  fieldset { border: 1px solid #263245; border-radius: 8px; padding: 12px 16px; margin: 0 0 22px; }
  legend { color: #9fb0c4; padding: 0 6px; }
  label { display: inline-block; margin-right: 18px; white-space: nowrap; }
  input[type=range] { vertical-align: middle; width: 160px; }
  .row { border-top: 1px solid #1e2735; padding: 14px 0; }
  .row h2 { font-size: 15px; margin: 0 0 8px; font-weight: 600; }
  .row h2 small { color: #7f8ea3; font-weight: 400; margin-left: 8px; }
  .pair { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { color: #7f8ea3; font-size: 12px; margin-bottom: 4px; min-height: 34px; }
  .stage { position: relative; width: ${box}px; height: ${box}px; background: #1b2430;
           border: 1px solid #263245; border-radius: 6px; overflow: hidden; }
  .stage .under { position: absolute; inset: 0; background-position: center;
                  background-size: 100% 100%; }
  .stage .over { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* What round 23 did: the alpha threshold applied to the whole drawing, which
     hardened the wide white halo the boundary service draws under its names into one
     pale slab and left the letters inside it barely darker than the slab. */
  .prev .over { filter: brightness(1.8) saturate(1.4) url(#geoportal-round23); }
  /* What the script does now: the image of half the pixels, which the service drew
     twice as large, stretched back over the cell and put through the filter of the
     layer's own kind - the letters white, every edge snapped onto the pixel grid. */
  .now :is(.over) { }
</style>
${svg}
<svg id="geoportal-round23-filter" width="0" height="0" style="position:absolute;left:0;top:0;pointer-events:none">
  <defs><filter id="geoportal-round23" x="-20%" y="-20%" width="140%" height="140%"
    color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="4"
    intercept="-1.1"/></feComponentTransfer></filter></defs>
</svg>
</head>
<body>
<h1>Geoportal WME &mdash; podgl&#261;d podpis&oacute;w</h1>
<p class="lead">
  Trzy razy ten sam kawa&#322;ek mapy, w ramkach tej samej wielko&#347;ci:
  <b>tak rysuje us&#322;uga</b> (kom&oacute;rka 256 px, bez filtra),
  <b>tak pokaza&#322;a to runda 23</b> (pr&#243;g krycia na ca&#322;ym rysunku &mdash; z bladego
  napisu i w&#322;asnej bia&#322;ej otoczki us&#322;ugi robi&#322; si&#281; jeden jasny plac) i
  <b>tak jest teraz</b> (obraz w po&#322;owie pikseli, rozci&#261;gni&#281;ty na to samo miejsce,
  pod filtrem, kt&oacute;ry robi z niego bia&#322;e litery z tward&#261; kraw&#281;dzi&#261;).
  Miejsce: Imbramowice, ${centre.lat.toFixed(5)}, ${centre.lon.toFixed(5)}.
</p>
<fieldset><legend>Podgl&#261;d</legend>
  <label>powi&#281;kszenie ramki <input id="z" type="range" min="1" max="3" step="1" value="2">
    <code id="zx">2&times;</code></label>
  <div class="note">Trzecia kolumna u&#380;ywa filtr&oacute;w, kt&oacute;re skrypt ma teraz:
    <code>white</code> (kreski i punkty: bia&#322;y atrament + czarna obw&oacute;dka),
    <code>outline</code> (warstwy granic: <b>rysunek us&#322;ugi bez zmian</b> + ta sama czarna
    obw&oacute;dka), <code>dark</code> i <code>colour</code> (drogi, BDOT) bez zmian od rundy 20.</div>
</fieldset>
${rows.map(row => `<div class="row">
  <h2>${row.name}<small>${row.kind ? `filtr: ${row.kind}` : 'bez filtra'} &middot; ${row.detail}</small></h2>
  <div class="pair">
    <figure><figcaption>tak rysuje us&#322;uga &mdash; 256 px, bez filtra</figcaption>
      <div class="stage"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}>
        <img class="over" src="${row.full}" alt="${row.name}" loading="lazy"></div></figure>
    <figure class="prev"><figcaption>runda 23 &mdash; pr&#243;g na ca&#322;ym rysunku (zbity plac)</figcaption>
      <div class="stage"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}>
        <img class="over" src="${row.full}" alt="${row.name} jak do tej pory" loading="lazy"></div></figure>
    <figure class="now"><figcaption>teraz &mdash; po&#322;owa pikseli, kolor us&#322;ugi, czarna obw&oacute;dka</figcaption>
      <div class="stage"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}>
        <img class="over" src="${row.url}" alt="${row.name} jak teraz" loading="lazy"
             style="filter:${row.kind ? filter[row.kind] : 'none'}"></div></figure>
  </div>
</div>`).join('\n')}
<script>
  const zoom = document.getElementById('z');
  const sync = () => {
    const scale = Number(zoom.value);
    document.getElementById('zx').textContent = scale + '\\u00d7';
    document.querySelectorAll('.stage').forEach(stage => {
      stage.style.width = (${box} * scale) + 'px';
      stage.style.height = (${box} * scale) + 'px';
    });
  };
  zoom.addEventListener('input', sync);
  sync();
</script>
</body></html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`[preview] ${path.relative(process.cwd(), OUT)}: ${rows.length} layers ` +
  `(${rows.filter(row => row.kind).length} of them with a filter)`);

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
