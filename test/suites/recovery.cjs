'use strict';
/**
 * What happens when a service refuses an image, which it does in bursts: the
 * image that is already on screen has to stay there, the refused one has to be
 * asked for again - under an address no cache can answer with the refusal - and
 * an image kept for a layer the user has just hidden must not stay on the map.
 *
 * The road layer is the one that still fetches a single image for the whole view;
 * it is where a refused image used to wipe the whole layer off the map.
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

  // A fresh view: the layer asks for a new image. Refuse it twice - OpenLayers'
  // own single retry (IMAGE_RELOAD_ATTEMPTS) and then its give-up.
  await pan(env, 300);
  const replacement = plain(tile.imgDiv.src);
  report.check('panning past the margin asks for a new image of the view',
    replacement !== firstAddress && drogi.backBuffer !== null,
    drogi.backBuffer ? 'the delivered image is kept for the transition' : 'nothing kept');

  const keptImage = drogi.backBuffer && drogi.backBuffer.querySelector('img');
  env.giveUp(tile);

  report.check('the refused image is marked as failed and hidden by the stylesheet rule',
    env.isFailed(tile) && !/olImageLoadError/.test(drogi.div.className),
    `tile marked: ${env.isFailed(tile)}`);
  report.check('a refused refresh does not wipe the image already on screen',
    drogi.backBuffer !== null && drogi.backBuffer.parentNode === drogi.div &&
    drogi.backBuffer.querySelector('img') === keptImage,
    `kept image ${keptImage ? 'still in the layer element' : 'gone'}`);
  report.check('the refused image is not what the layer is showing',
    drogi.backBuffer.querySelector('img').src !== tile.imgDiv.src,
    `kept ${plain(drogi.backBuffer.querySelector('img').src).slice(-24)} vs refused ${plain(tile.imgDiv.src).slice(-24)}`);

  // The script's own retry: after a second the same cell is asked for again, under
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
  // For a one-image layer OpenLayers removes the kept image on the next tick
  // (removeBackBufferDelay is 0 for single-tile layers, 2.5 s for tile grids).
  const released = await env.waitFor(() => drogi.backBuffer === null, 1000);
  report.check('a delivered retry clears the failure and lets the kept image go',
    !env.isFailed(tile) && released,
    `failed: ${env.isFailed(tile)}, kept image: ${released ? 'released' : 'still held'}`);

  // An image kept for a layer that is then hidden must not stay on the map: after
  // a zoom OpenLayers puts that image next to the base layer, outside the layer's
  // own element, where hiding the layer cannot hide it.
  await env.sleep(50);
  env.map.setCenter(env.map.getCenter(), env.map.getZoom() - 1, false, true);
  await env.sleep(120);
  const outside = drogi.backBuffer;
  report.check('after a zoom the image kept for the layer sits outside the layer\'s element',
    outside !== null && outside.parentNode !== drogi.div,
    outside ? `parent ${outside.parentNode === drogi.div ? 'inside' : 'outside'} the layer element` : 'nothing kept');
  const keptOnMap = outside;
  env.registry['Geoportal - drogi'].setVisibility(false);
  await env.sleep(60);
  report.check('hiding the layer takes the image kept for it off the map',
    drogi.backBuffer === null && (keptOnMap === null || keptOnMap.parentNode === null),
    `backBuffer: ${drogi.backBuffer === null ? 'released' : 'kept'}, element on the map: ${keptOnMap && keptOnMap.parentNode !== null}`);
  env.registry['Geoportal - drogi'].setVisibility(true);

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
