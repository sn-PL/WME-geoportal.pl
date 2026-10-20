'use strict';
/**
 * What every layer actually asks its service for: the request it builds for the
 * view, the system, the axis order of the BBOX, the size, and - the round-18
 * finding - that a service's own error is never asked for as a picture.
 */
const { boot, params } = require('../lib/harness.cjs');
const { LAYERS, LAYER_ORDER, REFERENCE_POINTS } = require('../lib/fixtures.cjs');
const reference = require('../lib/epsg2180.cjs');

/** The view as WGS84 bounds, taken from OpenLayers itself rather than assumed. */
function viewBounds(env) {
  const extent = env.map.getExtent();
  const converted = extent.clone().transform(new env.OL.Projection('EPSG:900913'), new env.OL.Projection('EPSG:4326'));
  return { left: converted.left, bottom: converted.bottom, right: converted.right, top: converted.top };
}

module.exports = async function requests(report) {
  report.suite('the requests each layer builds');

  const env = await boot({ enabled: 'all', view: { w: 800, h: 600 }, zoom: 18 });
  await env.drawAll();
  const view = viewBounds(env);
  const wmsLayers = LAYER_ORDER.filter(name => LAYERS[name].kind !== 'tiles');

  for (const name of wmsLayers) {
    const expected = LAYERS[name];
    const layer = env.layer(name);
    const url = env.requestOf(layer);
    if (!url) {
      report.check(`“${name}” has an address to ask for`, false, 'no request was made');
      continue;
    }
    const query = params(url);
    const problems = [];
    if (query.SERVICE !== 'WMS') problems.push(`SERVICE=${query.SERVICE}`);
    if (query.VERSION !== '1.3.0') problems.push(`VERSION=${query.VERSION}`);
    if (query.REQUEST !== 'GetMap') problems.push(`REQUEST=${query.REQUEST}`);
    if (!('STYLES' in query)) problems.push('no STYLES');
    if (query.FORMAT !== expected.format) problems.push(`FORMAT=${query.FORMAT}`);
    if (expected.format === 'image/png' && query.TRANSPARENT !== 'true') problems.push(`TRANSPARENT=${query.TRANSPARENT}`);
    if (expected.format === 'image/jpeg' && 'TRANSPARENT' in query) problems.push('TRANSPARENT on a JPEG');
    if (query.CRS !== expected.crs) problems.push(`CRS=${query.CRS}`);
    if (query.EXCEPTIONS !== 'XML') problems.push(`EXCEPTIONS=${query.EXCEPTIONS}`);
    if (query.LAYERS !== expected.layers) problems.push(`LAYERS=${query.LAYERS}`);
    report.check(`“${name}” asks for the right thing`, problems.length === 0, problems.join(', ') || 'all parameters as expected');
  }

  // The round-18 rule, over every request of every state the layers can be in: a
  // service failure must not be drawn into the image (INIMAGE) but answered as a
  // document, which the browser then cannot paint on the map.
  const everyRequest = [];
  for (const name of LAYER_ORDER) {
    const layer = env.layer(name);
    if (!layer || LAYERS[name].kind === 'tiles') continue;
    everyRequest.push(...env.requestsOf(layer).map(url => ({ name, url })));
  }
  const withInimage = everyRequest.filter(({ url }) => /EXCEPTIONS=INIMAGE/i.test(url));
  const withoutExceptions = everyRequest.filter(({ url }) => !/EXCEPTIONS=XML/i.test(url));
  report.check('no request asks a service to paint its error into the picture',
    withInimage.length === 0 && withoutExceptions.length === 0,
    `${everyRequest.length} requests over ${wmsLayers.length} layers; ` +
    `${withInimage.length} INIMAGE, ${withoutExceptions.length} without EXCEPTIONS=XML`);

  // The BBOX of a 4326 request: WMS 1.3.0 axis order (latitude first), and the
  // view's own rectangle.
  const flat4326 = LAYER_ORDER.filter(name => LAYERS[name].kind !== 'tiles' && LAYERS[name].crs === 'EPSG:4326');
  for (const name of flat4326) {
    const expected = LAYERS[name];
    const query = params(env.requestOf(env.layer(name)));
    const box = query.BBOX.split(',').map(Number);
    const problems = [];
    if (box.length !== 4) problems.push(`BBOX=${query.BBOX}`);
    else if (expected.singleTile) {
      // A single-tile layer renders a view plus its margin (ratio 1.5 by default).
      const ratio = expected.ratio;
      const width = (view.right - view.left) * ratio, height = (view.top - view.bottom) * ratio;
      const centreLon = (view.left + view.right) / 2, centreLat = (view.bottom + view.top) / 2;
      if (Math.abs(box[0] - (centreLat - height / 2)) > 1e-6) problems.push(`BBOX bottom ${box[0]}`);
      if (Math.abs(box[1] - (centreLon - width / 2)) > 1e-6) problems.push(`BBOX left ${box[1]}`);
      if (Math.abs(box[2] - (centreLat + height / 2)) > 1e-6) problems.push(`BBOX top ${box[2]}`);
      if (Math.abs(box[3] - (centreLon + width / 2)) > 1e-6) problems.push(`BBOX right ${box[3]}`);
    } else if (box[0] < box[2] && box[1] < box[3]) {
      // A tile: inside the view and small (one cell of the editor's grid).
      if (box[0] < view.bottom - 0.01 || box[2] > view.top + 0.01 ||
          box[1] < view.left - 0.01 || box[3] > view.right + 0.01) problems.push(`BBOX outside the view: ${query.BBOX}`);
    } else problems.push(`BBOX not ascending: ${query.BBOX}`);
    report.check(`“${name}” asks in latitude, longitude (WMS 1.3.0 in EPSG:4326)`,
      problems.length === 0, problems.join(', ') || `BBOX ${box.map(v => v.toFixed(5)).join(', ')}`);
  }

  // The BBOX of a 2180 request. The script takes the corner points of the area it
  // is drawing and wraps them in a rectangle of the national grid, which is what
  // any client does when the request system is not the map's own; the rectangle
  // therefore has to *contain* that area, and may only be a little larger than it
  // (the national grid's meridians converge away from 19°E, so the bounding box of
  // a true-north rectangle is up to a few per cent bigger).
  const pointsAlong = (bounds, steps) => {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push([bounds.left + (bounds.right - bounds.left) * t, bounds.bottom]);
      out.push([bounds.left + (bounds.right - bounds.left) * t, bounds.top]);
      out.push([bounds.left, bounds.bottom + (bounds.top - bounds.bottom) * t]);
      out.push([bounds.right, bounds.bottom + (bounds.top - bounds.bottom) * t]);
    }
    return out;
  };
  const coveredBy = (bounds, box) => {
    const corners = pointsAlong(bounds, 8).map(([lon, lat]) => env.internals.to2180(lon, lat));
    const northing = corners.map(point => point.northing), easting = corners.map(point => point.easting);
    // The BBOX is rounded to the centimetre, so a point exactly on the boundary
    // may land a few millimetres outside it.
    const slack = 0.02;
    const covers = corners.every(point =>
      box[0] - slack <= point.northing && point.northing <= box[2] + slack &&
      box[1] - slack <= point.easting && point.easting <= box[3] + slack);
    const overshoot = Math.max(
      (box[2] - box[0]) / (Math.max(...northing) - Math.min(...northing)) - 1,
      (box[3] - box[1]) / (Math.max(...easting) - Math.min(...easting)) - 1
    );
    return { covers, overshoot };
  };

  const flat2180 = LAYER_ORDER.filter(name => LAYERS[name].kind !== 'tiles' && LAYERS[name].crs === 'EPSG:2180');
  for (const name of flat2180) {
    const layer = env.layer(name);
    const tile = LAYERS[name].kind === 'view' ? null : env.tileAt(layer, 1, 1);
    const query = params(tile ? String(tile.imgDiv.src) : env.requestOf(layer));
    const box = query.BBOX.split(',').map(Number);
    const problems = [];
    if (box.length !== 4) problems.push(`BBOX=${query.BBOX}`);
    else {
      if (!(box[0] < box[2] && box[1] < box[3])) problems.push(`not ascending: ${query.BBOX}`);
      // The area this request has to show: the layer's own of that request.
      const drawn = tile
        ? tile.bounds.clone().transform(new env.OL.Projection('EPSG:900913'), new env.OL.Projection('EPSG:4326'))
        : new env.OL.Bounds(view.left, view.bottom, view.right, view.top);
      const { covers, overshoot } = coveredBy(drawn, box);
      if (!covers) problems.push('the request does not cover the area it is drawn for');
      if (overshoot > 0.12) problems.push(`request ${(overshoot * 100).toFixed(1)}% larger than the area`);
      const insidePoland = [box[0], box[2]].every(value => value > 100000 && value < 900000) &&
        [box[1], box[3]].every(value => value > 100000 && value < 900000);
      if (!insidePoland) problems.push(`outside Poland's 2180 numbers: ${query.BBOX}`);
    }
    report.check(`“${name}” asks in northing, easting (EPSG:2180) for the area it draws`,
      problems.length === 0,
      problems.join(', ') || `BBOX ${box.map(value => value.toFixed(1)).join(', ')}` +
        (tile ? ' for one tile' : ' for the view'));
  }

  // Sizes: a tile layer asks for cells of the editor's grid, the BDOT switches for
  // the view itself (ratio 1), the road layer for the view plus its margin - and
  // nothing past the megapixel the composition refuses. A cell is asked for at
  // exactly the pixels the map draws it with, except for the drawings whose letters
  // are the information: those ask for half of them, because the one way to get a
  // service letter bigger is to have it drawn in an image of half the pixels and
  // stretched over the place (the filter of the layer then sharpens it) - and those
  // same layers are drawn in cells of the map of their own size - twice the editor's
  // (1024 px) or eight times it (2048 px, the two layers whose every parcel or obręb
  // carries a number) - so a view is made of a fraction of the images, every one of
  // which the service puts its own copy of every name into. The addresses, the streets
  // and the places are not among them since round 27: they are the service's drawing,
  // cell for cell.
  for (const name of LAYER_ORDER.filter(name => LAYERS[name].kind === 'grid')) {
    const requests = env.requestsOf(env.layer(name));
    const sizes = [...new Set(requests.map(url => `${params(url).WIDTH}x${params(url).HEIGHT}`))];
    const magnify = LAYERS[name].magnify ?? 1;
    const cell = LAYERS[name].cell ?? 256;
    const want = cell / magnify;
    report.check(`“${name}” asks for cells of ${cell} px of map, at 1/${magnify} of the pixels of the cell it draws`,
      sizes.length === 1 && sizes[0] === `${want}x${want}`,
      `${requests.length} cells, sizes ${sizes.join(', ')}`);
    const drawn = env.tileAt(env.layer(name), 0, 0)?.getTile()?.style;
    report.check(`“${name}” is drawn in its own ${cell} px cell of the map`,
      !drawn || drawn.width === `${cell}px`,
      drawn ? `cell ${drawn.width} x ${drawn.height}` : 'no cell measured');
  }

  // Round 25: the images a view is made of, counted. This is what the repeated
  // numbers of the reports are - a service renders every name of the ground an image
  // covers into that image, so the number of images over a view is the number of
  // chances for one number to be drawn twice - and this is the number that fell.
  const gridSize = { w: 800, h: 600 };
  const cellsOver = cell => (Math.ceil(gridSize.w / cell) + 1) * (Math.ceil(gridSize.h / cell) + 1);
  for (const name of LAYER_ORDER.filter(name => LAYERS[name].cell)) {
    const layer = env.layer(name);
    const asked = params(env.requestOf(layer));
    const image = env.tileAt(layer, 0, 0)?.imgDiv;
    const cell = image ? parseFloat(image.style.width) : 0;
    const images = layer.grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    report.check(`“${name}” draws an 800x600 view out of far fewer images than the editor's own cells`,
      cell === LAYERS[name].cell && images <= cellsOver(cell) && images * 4 <= cellsOver(256),
      `${images} images of ${cell} px (asked for ${asked.WIDTH}x${asked.HEIGHT}), against ` +
      `${cellsOver(256)} images of 256 px, ${cellsOver(cell)} if all of them covered the view`);
  }

  const oneImage = ['Geoportal - drogi',
    ...Object.keys(LAYERS).filter(key => LAYERS[key].category === 'BDOT (Szczegółowa)')];
  for (const name of oneImage) {
    const query = params(env.requestOf(env.layer(name)));
    const width = Number(query.WIDTH), height = Number(query.HEIGHT);
    const expected = LAYERS[name];
    const wanted = {
      w: Math.floor(800 * expected.ratio),
      h: Math.floor(600 * expected.ratio)
    };
    const problems = [];
    if (Math.abs(width - wanted.w) > 1 || Math.abs(height - wanted.h) > 1) {
      problems.push(`${width}x${height}, expected about ${wanted.w}x${wanted.h}`);
    }
    if (width * height > env.internals.MAX_VIEW_PIXELS) problems.push(`${width * height} px past the cap`);
    report.check(`“${name}” asks for one image of ${expected.ratio === 1 ? 'the view' : 'the view plus its margin'}, at its own size`,
      problems.length === 0, problems.join(', ') || `${width}x${height} for ${Math.floor(800 * expected.ratio)}x${Math.floor(600 * expected.ratio)} px of view`);
  }

  // The size rule of the whole round, checked on every overlay at once: what a
  // service is asked for is what the map draws, pixel for pixel - and the drawings
  // whose letters are the information are the one exception, and by exactly the
  // factor their letters are made bigger with.
  const scaled = [];
  for (const name of LAYER_ORDER.filter(name => LAYERS[name].kind !== 'tiles')) {
    const tile = env.tileAt(env.layer(name), 0, 0);
    const asked = params(tile?.imgDiv?.src || '');
    const drawn = parseFloat(tile?.imgDiv?.style?.width || '');
    const magnify = LAYERS[name].magnify ?? 1;
    if (!asked.WIDTH || !drawn) continue;
    if (Number(asked.WIDTH) * magnify !== drawn ||
        Number(asked.HEIGHT) * magnify !== parseFloat(tile.imgDiv.style.height)) {
      scaled.push(`${name.replace('Geoportal - ', '')}: asked ${asked.WIDTH}x${asked.HEIGHT}, drawn ` +
        `${drawn}x${parseFloat(tile.imgDiv.style.height)} (x${magnify})`);
    }
  }
  report.check('every overlay is asked for at the size the map draws it, pixel for pixel or one half of it',
    scaled.length === 0, scaled.join(' | ') || `${LAYER_ORDER.length} layers, no other stretched image among them`);

  const railRequests = env.requestsOf(env.layer('Geoportal - przejazdy kolejowe (wymagany duży zoom)'));
  const crossing = REFERENCE_POINTS.imbramowice;
  const crossingTile = railRequests.map(url => params(url).BBOX.split(',').map(Number))
    .find(box => box[0] <= crossing.northing && crossing.northing <= box[2] &&
                 box[1] <= crossing.easting && crossing.easting <= box[3]);
  report.check('the crossing at Imbramowice is inside one of the crossing tiles asked for',
    Boolean(crossingTile),
    crossingTile ? `BBOX ${crossingTile.join(', ')} holds N ${crossing.northing}, E ${crossing.easting}` :
      `${railRequests.length} tiles, none covering the crossing`);
  env.close();

  // The same layer on a larger screen: 1400x900 is the size at which the
  // composition used to answer a document instead of a picture, which is what put
  // a grey plate on the map. The request has to stay inside the cap.
  const big = await boot({ enabled: 'all', view: { w: 1400, h: 900 }, zoom: 18 });
  await big.drawAll();
  const bigQuery = params(big.requestOf(big.layer('BDOT - Gruntowa')));
  const bigSize = [Number(bigQuery.WIDTH), Number(bigQuery.HEIGHT)];
  report.check('on a 1400x900 view the BDOT request stays inside the megapixel cap',
    bigSize[0] * bigSize[1] <= big.internals.MAX_VIEW_PIXELS && bigSize[0] > 400,
    `${bigSize.join('x')} = ${bigSize[0] * bigSize[1]} px (cap ${big.internals.MAX_VIEW_PIXELS}); ` +
    `asked for a ${1400}x${900} view, brought down to ${bigSize.join('x')}`);
  report.check('the capped request keeps the view\'s shape',
    Math.abs(bigSize[0] / bigSize[1] - 1400 / 900) < 0.01,
    `${(bigSize[0] / bigSize[1]).toFixed(4)} asked vs ${(1400 / 900).toFixed(4)} view`);

  const roadBig = params(big.requestOf(big.layer('Geoportal - drogi')));
  report.check('the road layer, which renders a margin, is capped as well',
    Number(roadBig.WIDTH) * Number(roadBig.HEIGHT) <= big.internals.MAX_VIEW_PIXELS,
    `${roadBig.WIDTH}x${roadBig.HEIGHT} = ${Number(roadBig.WIDTH) * Number(roadBig.HEIGHT)} px`);
  big.close();
};
