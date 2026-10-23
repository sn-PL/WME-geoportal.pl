#!/usr/bin/env node
/**
 * Write a page that shows the real Geoportal drawings three times, over the real
 * ortho photo, in one box of the same size each:
 *
 *   - as the service draws the cell at its own size (no filter) - the reference,
 *   - as round 35 showed it (the bright side of the numbers flooded without regard to
 *     opacity, so the service's soft white halo became white too: the glow of the report,
 *     and what merged the digits),
 *   - as the script shows it now (round 36: the parcel drawing is two layers, and the
 *     numbers are inked only where the service drew them at full opacity, so the halo is
 *     dropped before anything is flooded - the white body stays white, the service's own
 *     dark outline and the gaps between digits stay black).
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
  // What the middle column shows: for the drawings the script re-colours, what the
  // previous rounds did - the round 23-27 coverage-keyed white (the unreadable white
  // plate of the round-28 report) for the parcel numbers, and the plain casing of
  // rounds 24-29 for the boundary layers. For every drawing the script leaves alone it
  // shows the same treatment the script uses.
  const previous = kind === 'white'
    ? { css: 'url(#geoportal-r35-ink)', caption: 'poprzednio (runda 35) &mdash; bielenie po jasno&#347;ci: bia&#322;a po&#347;wiata us&#322;ugi zlewa cyfry i &#347;wieci' }
    : kind === 'names'
      ? { css: 'url(#geoportal-r35-numerals)', caption: 'poprzednio (runda 35) &mdash; nazwy bez zmian od rundy 33' }
      : kind
        ? { css: filters[kind], caption: 'bez zmian od rundy 20 &mdash; rozja&#347;nienie i bia&#322;a kraw&#281;d&#378;' }
        : { css: 'none', caption: 'od rundy 28: dok&#322;adnie rysunek us&#322;ugi, bez filtra' };
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

// The treatments the script ships - including its own SVG filter, which the parcel
// numbers point at - and the historical chain of rounds 23-27, which the page carries
// itself so the blob of that report can be seen beside the current drawing.
const filter = filters;
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
  /* The column of the round before: the filters the script shipped as 1.6.0 up to round
     31, carried verbatim - the parcel numbers inked from their whole silhouette with a
     grown casing, which fused the digits, and the boundary names grown from the dark key,
     which whitened the boundary lines. Side by side with the current filters they are the
     comparison of the report of 10.2026. */
  /* What the script does now: the image of half the pixels, which the service drew
     twice as large, stretched back over the cell and put through the filter of the
     layer's own kind - the letters white, the contour smoothed, every edge snapped
     onto the pixel grid. */
  .now :is(.over) { }
</style>
${svg}
<svg id="geoportal-r35-filter" width="0" height="0" style="position:absolute;left:0;top:0;pointer-events:none">
  <defs>
    <filter id="geoportal-r35-ink" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" result="lum" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.299 0.587 0.114 0 0"/><feComponentTransfer in="SourceAlpha" result="cov"><feFuncA type="linear" slope="4" intercept="-2"/></feComponentTransfer><feColorMatrix in="SourceGraphic" type="matrix" result="bl" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1 0 1 0 0"/><feComponentTransfer in="bl" result="bluea"><feFuncA type="linear" slope="6" intercept="-2.4"/></feComponentTransfer><feComponentTransfer in="bluea" result="blueb"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer><feComposite in="blueb" in2="cov" operator="in" result="bluem"/><feFlood flood-color="#fff" result="fb"/><feComposite in="fb" in2="bluem" operator="in" result="bluew"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="bluew"/></feMerge></filter>
    <filter id="geoportal-r35-numerals" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" result="lum" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.299 0.587 0.114 0 0"/><feComponentTransfer in="SourceAlpha" result="cov"><feFuncA type="linear" slope="4" intercept="-2"/></feComponentTransfer><feComponentTransfer in="lum" result="whitea"><feFuncA type="linear" slope="1.3158" intercept="-0.3158"/></feComponentTransfer><feComponentTransfer in="whitea" result="whiteb"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer><feComposite in="whiteb" in2="cov" operator="in" result="whitem"/><feFlood flood-color="#fff" result="fwhite"/><feComposite in="fwhite" in2="whitem" operator="in" result="white"/><feMorphology in="whitem" operator="dilate" radius="1" result="fat"/><feComposite in="fat" in2="whitem" operator="out" result="ring0"/><feComposite in="ring0" in2="cov" operator="in" result="ringm"/><feFlood flood-color="#000" result="fr"/><feComposite in="fr" in2="ringm" operator="in" result="casing"/><feComponentTransfer in="SourceGraphic" result="crisp"><feFuncR type="linear" slope="2" intercept="-0.500"/><feFuncG type="linear" slope="2" intercept="-0.500"/><feFuncB type="linear" slope="2" intercept="-0.500"/></feComponentTransfer><feMerge><feMergeNode in="casing"/><feMergeNode in="crisp"/><feMergeNode in="white"/></feMerge></filter>
  </defs>
</svg>
</head>
<body>
<h1>Geoportal WME &mdash; podgl&#261;d podpis&oacute;w</h1>
<p class="lead">
  Trzy razy ten sam kawa&#322;ek mapy, w ramkach tej samej wielko&#347;ci:
  <b>tak rysuje us&#322;uga</b> (obraz 1:1, bez filtra),
  <b>tak by&#322;o w rundzie 31</b> (atrament z ca&#322;ej sylwetki plus pogrubiona
  obw&oacute;dka &mdash; cyfry, linie i nazwy zlewa&#322;y si&#281; w jedn&#261; bia&#322;&#261; plam&#281;) i
  <b>tak jest teraz</b> (ostry pr&oacute;g na jasno&#347;ci rysunku, nic nie jest
  pogrubiane: cyfra to jej bia&#322;e wype&#322;nienie i w&#322;asny ciemny kontur,
  nazwa granicy to ciemne litery na bia&#322;o z jednopikselow&#261; obw&oacute;dk&#261;,
  a halo, linie i przezroczyste obszary zostaj&#261; jak w us&#322;udze).
  Miejsce: Imbramowice, ${centre.lat.toFixed(5)}, ${centre.lon.toFixed(5)}.
</p>
<fieldset><legend>Podgl&#261;d</legend>
  <label>powi&#281;kszenie ramki <input id="z" type="range" min="1" max="3" step="1" value="2">
    <code id="zx">2&times;</code></label>
  <div class="note">Trzecia kolumna u&#380;ywa filtr&oacute;w, kt&oacute;re skrypt ma teraz:
    <code>white</code> (numery dzia&#322;ek) i <code>names</code> (nazwy granic) &mdash;
    oba ci&#281;te twardym progiem, bez morfologii, wi&#281;c nie ma czego zlewa&#263;;
    obraz z kom&oacute;rki 2048 px w po&#322;owie pikseli (litery s&#261; dwa razy wi&#281;ksze),
    tabliczki, linie dzia&#322;ek i przezroczyste obszary zostaj&#261; jak w us&#322;udze;
    <code>dark</code> i <code>colour</code> (drogi, BDOT: rozja&#347;nienie) &mdash;
    a adresy, ulice, place, przejazdy i obiekty topograficzne <b>nie maj&#261;
    &#380;adnego filtra</b>. &#346;rodkowa kolumna to filtry rundy 31, do&#322;&#261;czone
    dos&#322;ownie: wtedy cyfry i nazwy zlewa&#322;y si&#281; w jedn&#261; bia&#322;&#261; plam&#281;
    i bielone by&#322;y te&#380; linie granic.
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
    <figure class="now"><figcaption>${row.kind === 'white'
      ? 'teraz &mdash; lite bia&#322;e cyfry z czarn&#261; obw&oacute;dk&#261;, dwa razy wi&#281;ksze'
      : row.kind === 'names'
        ? 'teraz &mdash; bia&#322;e nazwy, ich halo staje si&#281; czarn&#261; obw&oacute;dk&#261;'
        : 'teraz &mdash; rysunek bez przerabiania'}</figcaption>
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
