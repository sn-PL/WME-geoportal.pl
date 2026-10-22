#!/usr/bin/env node
/**
 * Write a page that shows the real Geoportal drawings three times, over the real
 * ortho photo, in one box of the same size each:
 *
 *   - as the service draws the cell at its own size (no filter) - the reference,
 *   - as the versions of rounds 23-27 showed it (the whole drawing turned into white
 *     ink, the image asked for at half the pixels and stretched back - the white
 *     blob of a parcel number that the report of 10.2026 caught, and the white band
 *     a street became),
 *   - as the script shows it now (round 28: exactly the drawing of the service, at
 *     one image pixel per pixel of the map, with the one treatment its ink asks for -
 *     a black casing for the boundary layers, a lift for the roads and the BDOT).
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

const filters = env.internals.CONTRAST_FILTER;
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
  // What the middle column shows: for every drawing that rounds 23-27 recoloured, the
  // chain of those rounds - the whole drawing made white and stretched from half the
  // pixels, which is the white blob of a number and the white band of a street. For
  // the layers whose ink was never recoloured (the boundaries, the roads, the BDOT
  // surfaces) the column shows the same filter the script uses, and says so.
  const previous = !kind
    ? { css: 'brightness(0) invert(1) url(#geoportal-previous)', caption: 'poprzednio (rundy 23-27) &mdash; ca&#322;y rysunek bielony i rozci&#261;gni&#281;ty z po&#322;owy pikseli' }
    : { css: filters[kind], caption: kind === 'outline'
        ? 'bez zmian od rundy 24 &mdash; rysunek us&#322;ugi + obw&oacute;dka'
        : 'bez zmian od rundy 20 &mdash; rozja&#347;nienie i bia&#322;a kraw&#281;d&#378;' };
  rows.push({
    name: name.replace('Geoportal - ', ''),
    kind,
    url,
    full,
    previous,
    bg: layer.singleTile ? '' : ortos[`${row},${column}`] || '',
    detail: `${query.CRS || ''} ${query.WIDTH || ''}x${query.HEIGHT || ''}`.trim()
  });
}

// The treatments the script ships, and the historical chain of rounds 23-27, which
// the page carries itself (the script no longer has an SVG filter at all).
const filter = filters;
const svg = '';
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
  /* The previous round: the same white re-draw and the same one pixel casing, but the
     threshold straight onto the doubled raster - every edge of the service's pixel a
     step of two screen pixels, which is the ragged lettering of the report. The filter
     string comes per row, so the middle column says what each layer actually did. */
  /* What the script does now: the image of half the pixels, which the service drew
     twice as large, stretched back over the cell and put through the filter of the
     layer's own kind - the letters white, the contour smoothed, every edge snapped
     onto the pixel grid. */
  .now :is(.over) { }
</style>
${svg}
<svg id="geoportal-previous-filter" width="0" height="0" style="position:absolute;left:0;top:0;pointer-events:none">
  <defs><filter id="geoportal-previous" x="-20%" y="-20%" width="140%" height="140%"
    color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0.8" result="soft"/><feComponentTransfer in="soft" result="ink"><feFuncA type="linear" slope="20"
    intercept="-8.5"/></feComponentTransfer><feMorphology in="ink" operator="dilate" radius="1"
    result="grown"/><feFlood flood-color="#000" result="black"/><feComposite in="black" in2="grown"
    operator="in" result="casing"/><feMerge><feMergeNode in="casing"/><feMergeNode in="ink"/></feMerge></filter></defs>
</svg>
</head>
<body>
<h1>Geoportal WME &mdash; podgl&#261;d podpis&oacute;w</h1>
<p class="lead">
  Trzy razy ten sam kawa&#322;ek mapy, w ramkach tej samej wielko&#347;ci:
  <b>tak rysuje us&#322;uga</b> (obraz 1:1, bez filtra),
  <b>tak by&#322;o poprzednio</b> (pr&#243;g wprost na podwojonym rastrze &mdash; ka&#380;da
  kraw&#281;d&#378; piksela us&#322;ugi to na ekranie schodek z dw&oacute;ch pikseli) i
  <b>tak jest teraz</b> (ten sam obraz, ale przed progiem lekko rozmyty, wi&#281;c kontur
  jest g&#322;adki, a kraw&#281;d&#378; nadal twarda).
  Miejsce: Imbramowice, ${centre.lat.toFixed(5)}, ${centre.lon.toFixed(5)}.
</p>
<fieldset><legend>Podgl&#261;d</legend>
  <label>powi&#281;kszenie ramki <input id="z" type="range" min="1" max="3" step="1" value="2">
    <code id="zx">2&times;</code></label>
  <div class="note">Trzecia kolumna u&#380;ywa filtr&oacute;w, kt&oacute;re skrypt ma teraz:
    <code>outline</code> (warstwy granic: <b>rysunek us&#322;ugi bez zmian</b> + jednopikselowa
    czarna obw&oacute;dka), <code>dark</code> i <code>colour</code> (drogi, BDOT: rozja&#347;nienie
    i bia&#322;a kraw&#281;d&#378;) &mdash; a warstwy z numerami, ulicami i podpisami
    <b>nie maj&#261; &#380;adnego filtra</b>: s&#261; takie, jakie rysuje us&#322;uga.
    Runda 28 usuwa ostatnie przerabianie rysunku: <b>ka&#380;da warstwa jest
    proszona o dok&#322;adnie tyle pikseli, ile zajmuje na mapie</b> (jedna
    kom&oacute;rka 256 px siatki edytora), wi&#281;c nie ma ju&#380; ani rozci&#261;gania,
    ani bielenia. Kolumna &bdquo;poprzednio&rdquo; pokazuje &#322;a&#324;cuch z rund
    23&ndash;27: ca&#322;y rysunek na bia&#322;y atrament i rozci&#261;gni&#281;ty z po&#322;owy
    pikseli &mdash; tak powstawa&#322;a bia&#322;a plama z numeru dzia&#322;ki
    (ciemne cyfry na bia&#322;ej tabliczce s&#261; <b>oba</b> atramentem, wi&#281;c po
    wybieleniu zlewaj&#261; si&#281; w jeden bia&#322;y kszta&#322;t) oraz bia&#322;a
    wst&#281;ga z powierzchni ulicy.</div>
</fieldset>
${rows.map(row => `<div class="row">
  <h2>${row.name}<small>${row.kind ? `filtr: ${row.kind}` : 'bez filtra'} &middot; ${row.detail}</small></h2>
  <div class="pair">
    <figure><figcaption>tak rysuje us&#322;uga &mdash; obraz 1:1, bez filtra</figcaption>
      <div class="stage"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}>
        <img class="over" src="${row.full}" alt="${row.name}" loading="lazy"></div></figure>
    <figure class="prev"><figcaption>${row.previous.caption}</figcaption>
      <div class="stage"${row.bg ? ` style="background-image:url('${row.bg}')"` : ''}>
        <img class="over" src="${row.full}" alt="${row.name} jak do tej pory" loading="lazy"
             style="filter:${row.previous.css}"></div></figure>
    <figure class="now"><figcaption>teraz &mdash; kontur wyg&#322;adzony, twarda kraw&#281;d&#378;, czarna obw&oacute;dka</figcaption>
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
