'use strict';
/**
 * What happens when a service refuses an image, which it does in bursts - and what
 * happens to the drawing a layer has already delivered when another area is asked
 * for.
 *
 * The refusal: a refused image is a hole (OpenLayers counts it as loaded, the
 * stylesheet hides it), and the layer asks for it again about a second later under
 * an address no cache can answer with the refusal.
 *
 * The drawing: an image belongs to the view it was rendered for. OpenLayers keeps
 * the previous drawing - its "back buffer" - over the new view while the new one
 * is on its way, and rescales it when the scale changes; its labels then stand
 * beside the labels of the new drawing, at the offset between the two, which is
 * what the doubled numbers and names of the reports were. So it may stay on the
 * map only for as long as the view it was rendered for is the view being asked
 * for; a pan to another view has to let it go at the request itself, and a zoom
 * never carries it over (see applyBackBuffer).
 *
 * The road layer is the one that asks for a single image of the whole view - it is
 * where a refused image used to wipe the layer off the map. The parcels layer is
 * the one of cells: there a pan must cost the strip it uncovers and nothing else.
 */
const { boot, plain } = require('../lib/harness.cjs');

/** Pan far enough that the view leaves the layer's own margin, so a new image is asked for. */
async function pan(env, pixels) {
  const centre = env.map.getCenter();
  const step = env.map.getResolution() * pixels;
  env.map.setCenter(new env.OL.LonLat(centre.lon + step, centre.lat), env.map.getZoom());
  await env.sleep(80);
}

module.exports = async function recovery(report) {
  report.suite('recovering from refused images');

  const env = await boot({ enabled: 'all' });
  await env.drawAll();
  const drogi = env.layer('Geoportal - drogi');
  const tile = env.tileAt(drogi, 0, 0);
  const firstAddress = plain(tile.imgDiv.src);

  report.check('the road layer shows its image for the whole view',
    Boolean(firstAddress) && new URL(firstAddress).searchParams.get('WIDTH') === '1200',
    `${new URL(firstAddress).searchParams.get('WIDTH')}x${new URL(firstAddress).searchParams.get('HEIGHT')}`);

  env.deliver(tile);
  report.check('a delivered image is on the map and not marked as failed',
    !env.isFailed(tile) && drogi.div.contains(tile.imgDiv), `in the layer's element: ${drogi.div.contains(tile.imgDiv)}`);

  // Another view: the layer asks for a new image, and the picture it was showing
  // belongs to the view it was rendered for - it goes at the request, not when the
  // answer to that request arrives. A copy left on the map would show its labels at
  // the offset of the pan, which is the doubling of the reports.
  await pan(env, 300);
  const replacement = plain(tile.imgDiv.src);
  report.check('panning to another view asks for a new image of it',
    replacement !== firstAddress,
    replacement === firstAddress ? 'the same image is still asked for' : 'a new GetMap for the new view');
  report.check('and lets the picture of the previous view go at the request',
    drogi.backBuffer === null,
    drogi.backBuffer ? `${drogi.backBuffer.childNodes.length} old image(s) still drawn` : 'nothing of the old view is on the map');

  // Refuse it twice - OpenLayers' own single retry (IMAGE_RELOAD_ATTEMPTS) and then
  // its give-up. Nothing of the old drawing may come back with the refusal.
  env.giveUp(tile);
  report.check('the refused image is marked as failed and hidden by the stylesheet rule',
    env.isFailed(tile) && !/olImageLoadError/.test(drogi.div.className),
    `tile marked: ${env.isFailed(tile)}`);
  report.check('a refused view does not bring the picture of the previous one back',
    drogi.backBuffer === null,
    drogi.backBuffer ? 'the old drawing is on the map again' : 'the layer shows nothing until the retry arrives');

  // The script's own retry: after a second the same view is asked for again, under
  // a fresh address, so no cache can answer with the refusal.
  const addressBeforeRetry = tile.imgDiv.src;
  await env.sleep(1400);
  const retried = tile.imgDiv.src;
  report.check('the refused image is asked for again about a second later',
    retried !== addressBeforeRetry && /&_=\d+/.test(retried),
    `new address has a timestamp: ${/&_=\d+/.test(retried)}`);
  report.check('the retry asks for the same view, only under a new address',
    plain(retried) === plain(addressBeforeRetry),
    plain(retried) === plain(addressBeforeRetry) ? 'same GetMap parameters' : plain(retried).slice(-60));
  report.check('the retry goes out only once, not once per refused image',
    env.requestsOf(drogi).filter(url => /&_=\d+/.test(url)).length === 1,
    `${env.requestsOf(drogi).filter(url => /&_=\d+/.test(url)).length} stamped requests`);

  env.deliver(tile);
  report.check('a delivered retry clears the failure',
    !env.isFailed(tile) && drogi.div.contains(tile.imgDiv),
    `failed: ${env.isFailed(tile)}`);

  // A zoom is a new drawing, not a bigger copy of the old one: the picture of the
  // previous view may not be rescaled over the new view.
  await env.sleep(50);
  env.map.setCenter(env.map.getCenter(), env.map.getZoom() - 1, false, true);
  await env.sleep(120);
  report.check('after a zoom nothing of the image the layer was showing is kept',
    drogi.backBuffer === null,
    drogi.backBuffer ? `kept: parent ${drogi.backBuffer.parentNode === drogi.div ? 'inside' : 'outside'} the layer element` : 'nothing kept');

  // The tile layers: a refused cell is one hole, and after the retry the grid is
  // drawn again - the layer must not stop asking for its cells.
  const orto = env.layer('Geoportal - ortofoto');
  await env.drawAll();
  const cells = env.tilesWithImage(orto);
  const hole = cells[Math.floor(cells.length / 2)];
  const address = hole.imgDiv.src;
  env.giveUp(hole);
  await env.sleep(1400);
  report.check('a refused tile of a tile layer is asked for again under a fresh address',
    hole.imgDiv.src !== address && /&_=\d+/.test(hole.imgDiv.src),
    `${plain(hole.imgDiv.src).slice(-40)}`);
  env.deliver(hole);
  report.check('the tile layer keeps the rest of its grid through the refusal and the retry',
    env.tilesWithImage(orto).length === cells.length && !env.isFailed(hole),
    `${env.tilesWithImage(orto).length} of ${cells.length} cells drawn`);

  report.check('the recovery run produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');
  env.close();

  // The parcels and the boundaries are cells of the editor's grid again. That is
  // what makes a pan cheap - and it is also the reason a pan can never leave a
  // second drawing of the labels on the map: OpenLayers moves the cells it has
  // instead of fetching the view again, and builds its container of the previous
  // view only when the scale changes, which is the case the zoom rules above
  // answer. Measured here on the cells themselves.
  const gridded = await boot({ enabled: 'all' });
  await gridded.drawAll();
  const parcels = gridded.layer('Geoportal - podział adm');
  const parcelsCells = gridded.tilesWithImage(parcels);
  gridded.deliver(parcelsCells[0]);
  const cellAddresses = () => new Set(gridded.requestsOf(parcels));
  const before = cellAddresses();

  report.check('the parcels layer asks for cells of the editor\'s grid',
    parcels.singleTile === false && parcels.ratio === 1.5 && parcelsCells.length > 1,
    `${parcelsCells.length} cells of the view`);

  await pan(gridded, 100);
  const small = cellAddresses();
  report.check('a pan inside the margin of the cells asks the service for nothing at all',
    [...small].every(url => before.has(url)) && small.size === before.size,
    `${[...small].filter(url => !before.has(url)).length} new requests for a 100 px pan of ${small.size} cells`);
  report.check('and leaves no second drawing of the previous view on the map',
    parcels.backBuffer === null,
    parcels.backBuffer ? `${parcels.backBuffer.childNodes.length} old cells still drawn` : 'the cells on the map are the ones asked for');

  const beforeBig = cellAddresses();
  await pan(gridded, 700);
  const big = cellAddresses();
  const added = [...big].filter(url => !beforeBig.has(url));
  const kept = [...beforeBig].filter(url => big.has(url));
  report.check('a pan past the margin keeps the cells it has and asks only for the strip it uncovers',
    kept.length > 0 && added.length < big.size && added.length <= Math.ceil(700 / 256 + 1) * 5,
    `${added.length} new requests of ${big.size} cells, ${kept.length} cells reused where they were`);
  const held = gridded.tilesWithImage(parcels);
  gridded.giveUp(held[0]);
  held.slice(1).forEach(tile => gridded.deliver(tile));
  await gridded.sleep(50);
  report.check('a refused cell of the new view is one hole, and the rest of the grid keeps its image',
    gridded.tilesWithImage(parcels).length === held.length,
    `${gridded.tilesWithImage(parcels).length} of ${held.length} cells still have their image`);

  // A zoom of a layer of cells: the cells of the old scale are not carried over.
  const topo = gridded.layer('Geoportal - obiekty topograficzne');
  const topoCells = gridded.tilesWithImage(topo);
  report.check('a layer of cells was drawing before the zoom', topoCells.length > 0, `${topoCells.length} cells`);
  await gridded.setZoom(19);
  await gridded.sleep(150);
  report.check('a zoom does not carry the previous cells of a layer over the new view',
    topo.backBuffer === null,
    topo.backBuffer ? `${topo.backBuffer.childNodes.length} old cells still drawn` : 'the new view starts empty');
  report.check('and the new view is asked for straight away',
    gridded.requestsOf(topo).length > 0 && gridded.requestsOf(parcels).length > 0,
    `${gridded.requestsOf(topo).length} + ${gridded.requestsOf(parcels).length} requests of the new view`);
  report.check('the grid run produced no uncaught error',
    gridded.recorded.uncaught.length === 0, gridded.recorded.uncaught.join(' | ') || 'none');
  gridded.close();

  // Retries belong to the view they were started in: as long as nothing is
  // missing, a new view asks under clean addresses - a stamped address is only
  // for an image that has to get past a cache holding the refusal.
  const quiet = await boot({ enabled: 'all' });
  await quiet.drawAll();
  const quietOrto = quiet.layer('Geoportal - ortofoto');
  quiet.deliver(quiet.tileAt(quietOrto, 0, 0));
  await pan(quiet, 400);
  await quiet.drawAll();
  const stamped = quiet.requestsOf(quietOrto).filter(url => /&_=\d+/.test(url));
  report.check('a view with nothing missing asks under clean addresses',
    quiet.requestsOf(quietOrto).length > 0 && stamped.length === 0,
    `${stamped.length} stamped of ${quiet.requestsOf(quietOrto).length} requests`);
  // And a refusal puts the layer's recovery in place: the retry, about a second
  // later, asks for the missing cell under an address with a timestamp on it.
  const quietHole = quiet.tilesWithImage(quietOrto)[0];
  const cleanAddress = plain(quietHole.imgDiv.src);
  quiet.giveUp(quietHole);
  await quiet.sleep(1400);
  const stampedAfterRefusal = quiet.requestsOf(quietOrto).filter(url => /&_=\d+/.test(url));
  report.check('after a refusal the layer asks for the missing cell under a fresh address',
    stampedAfterRefusal.length > 0 && plain(quietHole.imgDiv.src) === cleanAddress,
    `${stampedAfterRefusal.length} of ${quiet.requestsOf(quietOrto).length} requests carry a timestamp; ` +
    `the address without one still names the same tile: ${plain(quietHole.imgDiv.src) === cleanAddress}`);
  quiet.close();
};
