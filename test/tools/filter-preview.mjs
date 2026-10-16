#!/usr/bin/env node
/**
 * Write a page that shows the real Geoportal drawings three times: as the service
 * draws them at the size the script asks for now, as the previous version showed
 * them (the same area asked for at half the pixels and stretched back over it, under
 * the wide white halo of 1.6.0) and as the script shows them now (the drawing at its
 * own size, under the hairline edge) - so the two treatments can be judged side by
 * side in a browser instead of on the map, and the numbers of the new one tuned.
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
  // The address of the same area with half the pixels: that is what 1.6.0 asked for
  // on the layers whose text it wanted bigger, and what the browser then stretched
  // over the same place. The service draws its labels at a size fixed in pixels, so
  // halving the pixels doubles them - at the cost of the edges of every letter.
  const half = withSize(url, Number(query.WIDTH) / 2, Number(query.HEIGHT) / 2);
  rows.push({
    name: name.replace('Geoportal - ', ''),
    kind,
    url,
    half,
    grid: layer.singleTile ? ortoGrid : null,
    // The photo under the overlay: the grid of the view for a one-image layer, the
    // cell of the same place for a layer of cells (the overlays are transparent, so
    // this is what the editor draws underneath them).
    bg: layer.singleTile ? '' : ortos[`${row},${column}`] || '',
    detail: `${query.CRS || ''} ${query.WIDTH || ''}x${query.HEIGHT || ''}`.trim()
  });
}

// The numbers the script ships, so the page opens on them and not on a copy.
const filter = env.internals.CONTRAST_FILTER;
const brightness = (filter.colour.match(/brightness\(([\d.]+)\)/) || [])[1] || '2.2';
const brightnessDark = (filter.dark.match(/brightness\(([\d.]+)\)/) || [])[1] || '2';
const saturate = (filter.colour.match(/saturate\(([\d.]+)\)/) || [])[1] || '1.7';
const edge = (filter.colour.match(/drop-shadow\(0 0 ([\d.]+)px/) || [])[1] || '1';

// The layers are asked while zooming, so the cells of one view are of one place.
const centre = env.map.getCenter();
env.close();

const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<title>Geoportal WME - podglad czytelnosci warstw</title>
<style>
  :root { --brightness: 2.2; --brightness-dark: 2; --saturate: 1.7; --edge: 1px;
          --old-b: 2.4; --old-s: 1.8; --shadow: #fff; }   /* the old numbers, fixed */
  body { margin: 0; padding: 24px 28px 60px; background: #10141a; color: #e8eef6;
         font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { margin: 0 0 18px; color: #9fb0c4; max-width: 96ch; }
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
  figcaption { color: #7f8ea3; font-size: 12px; margin-bottom: 4px; min-height: 32px; }
  .shot { background: #1b2430; border: 1px solid #263245; border-radius: 6px; overflow: hidden;
          width: 300px; }
  .shot img { display: block; width: 300px; height: auto; }
  /* The treatment of 1.6.0 before this round: three white halos, up to 2.6 px wide,
     under a drawing whose ink was lifted harder. */
  .old-f img { filter: brightness(var(--old-b)) saturate(var(--old-s)) contrast(1.1)
                       drop-shadow(0 0 0.8px #fff) drop-shadow(0 0 1.6px #fff)
                       drop-shadow(0 0 2.6px #fff); }
  /* What the script does now: the ink lifted, the colour raised, and a hairline of
     white under it - nothing else. */
  .new-f img { filter: brightness(var(--brightness)) saturate(var(--saturate))
                       drop-shadow(0 0 var(--edge) #fff) drop-shadow(0 0 var(--edge) #fff); }
  .new-f.dark img { filter: brightness(var(--brightness-dark))
                            drop-shadow(0 0 var(--edge) #fff) drop-shadow(0 0 var(--edge) #fff); }
  .stage { position: relative; width: 300px; }
  .bg-grid { position: absolute; inset: 0; display: grid; }
  .bg-grid img { width: 100%; height: 100%; display: block; }
  .stage .under { position: absolute; inset: 0; background-color: #1b2430;
                  background-position: center; background-size: 100% 100%; }
  .stage .over { position: relative; }
  .sat { background: #2a2a24; }
  .shot.has-bg, .stage.has-bg { border-color: #3a4658; }
  .shot.has-bg { background-image: var(--bg); background-size: 100% 100%; }
  .note { color: #7f8ea3; font-size: 12px; margin-top: 6px; }
  a { color: #7fd1ff; }
</style></head>
<body>
<h1>Geoportal WME &mdash; podgl&#261;d czytelno&#347;ci warstw</h1>
<p class="lead">
  Ka&#380;da warstwa jest pokazana trzy razy: <b>tak rysuje us&#322;uga</b> (obraz w takim rozmiarze,
  o jaki prosi skrypt &mdash; bez filtra), <b>tak wygl&#261;da&#322;a w poprzedniej wersji</b> (ten sam obszar
  w po&#322;owie pikseli, rozci&#261;gni&#281;ty z powrotem na to samo miejsce pod potr&oacute;jn&#261; bia&#322;&#261;
  po&#347;wiat&#261;) i <b>tak wygl&#261;da teraz</b> (obraz w swoim rozmiarze pod cienk&#261; bia&#322;&#261;
  obw&oacute;dk&#261;). Trzecia kolumna s&#322;ucha suwak&oacute;w poni&#380;ej.
  Miejsce: Imbramowice na Dolnym &#346;l&#261;sku, ${centre.lat.toFixed(5)}, ${centre.lon.toFixed(5)}.
</p>
<fieldset><legend>Filtr warstw cienkich (na &#380;ywo)</legend>
  <label>jasno&#347;&#263; kolor&oacute;w <code>brightness()</code>
    <input id="b" type="range" min="1" max="3" step="0.05" value="${brightness}"></label>
  <label>jasno&#347;&#263; czarnych linii
    <input id="bd" type="range" min="1" max="3" step="0.05" value="${brightnessDark}"></label>
  <label>kolor <code>saturate()</code>
    <input id="s" type="range" min="1" max="3" step="0.05" value="${saturate}"></label>
  <label>obw&oacute;dka <code>drop-shadow</code> (px)
    <input id="e" type="range" min="0" max="3" step="0.25" value="${edge}"></label>
<div>W skrypcie teraz: <code id="css">brightness(2.2) saturate(1.7) drop-shadow(0 0 1px #fff) &times;2</code></div>
  <div class="note">Kolumna &#347;rodkowa trzyma liczby poprzedniej wersji (1.6.0 przed t&#261; zmian&#261;):
    jasno&#347;&#263; 2.4 / 2.1, <code>saturate(1.8)</code>, <code>contrast(1.1)</code> i trzy bia&#322;e
    po&#347;wiaty 0.8 / 1.6 / 2.6 px &mdash; oraz obraz w po&#322;owie pikseli, rozci&#261;gni&#281;ty przez
    przegl&#261;dark&#281;. To w&#322;a&#347;nie te liczby i to rozci&#261;gni&#281;cie dawa&#322;y
    &bdquo;powi&#281;kszone, ale nie czystsze&rdquo; napisy.</div>
</fieldset>
${rows.map(row => `<div class="row">
  <h2>${row.name}<small>${row.kind ? `filtr: ${row.kind}` : 'bez filtra (por&#243;wnanie)'} &middot; ${row.detail}</small></h2>
  <div class="pair">
    <figure><figcaption>tak rysuje us&#322;uga &mdash; obraz w rozmiarze, o jaki prosi skrypt</figcaption>
      <div class="shot sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        ${row.grid ? `<div class="stage">${under(row, 'under')}<img class="over" src="${row.url}" alt="${row.name}" loading="lazy"></div>`
          : `<img src="${row.url}" alt="${row.name}" loading="lazy">`}</div></figure>
    ${row.kind ? `<figure class="old-f"><figcaption>poprzednio &mdash; po&#322;owa pikseli rozci&#261;gni&#281;ta, potr&oacute;jna po&#347;wiata</figcaption>
      <div class="stage sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        ${under(row, 'under')}
        <img class="over" src="${row.half}" alt="${row.name} jak w poprzedniej wersji" loading="lazy"></div>
      </figure>
      <figure class="new-f${row.kind === 'dark' ? ' dark' : ''}"><figcaption>teraz &mdash; obraz 1:1 pod cienk&#261; bia&#322;&#261; obw&oacute;dk&#261;</figcaption>
      <div class="stage sat${row.bg ? ' has-bg' : ''}"${row.bg ? ` style="--bg:url('${row.bg}')"` : ''}>
        ${under(row, 'under')}
        <img class="over" src="${row.url}" alt="${row.name} jak w skrypcie" loading="lazy"></div>
      </figure>` : ''}
  </div>
</div>`).join('\n')}
<script>
  const root = document.documentElement;
  // The numbers the script ships, so the page opens on them.
  const shipped = { b: ${brightness}, bd: ${brightnessDark}, s: ${saturate}, e: ${edge} };
  const sync = () => {
    root.style.setProperty('--brightness', document.getElementById('b').value);
    root.style.setProperty('--brightness-dark', document.getElementById('bd').value);
    root.style.setProperty('--saturate', document.getElementById('s').value);
    root.style.setProperty('--edge', document.getElementById('e').value + 'px');
    const value = (id) => document.getElementById(id).value;
    document.getElementById('css').textContent =
      'dark: brightness(' + value('bd') + ') + ' + value('e') + ' px edge  |  ' +
      'colour: brightness(' + value('b') + ') saturate(' + value('s') + ') + ' + value('e') + ' px edge';
  };
  ['b', 'bd', 's', 'e'].forEach(id => document.getElementById(id).addEventListener('input', sync));
  sync();
</script>
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
