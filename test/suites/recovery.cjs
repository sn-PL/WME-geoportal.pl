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

  // An image kept for a layer that is then hidden must not stay on the map.
  // OpenLayers puts it next to the base layer - outside the layer's own element -
  // exactly when it rescales it, which is the case that leaves a picture behind
  // that hiding the layer cannot hide; that rescaling is gone (see the zoom rules
  // below), so whatever is kept sits inside the layer's element.
  await env.sleep(50);
  env.map.setCenter(env.map.getCenter(), env.map.getZoom() - 1, false, true);
  await env.sleep(120);
  report.check('after a zoom nothing of the image the layer was showing is kept',
    drogi.backBuffer === null,
    drogi.backBuffer ? `kept: parent ${drogi.backBuffer.parentNode === drogi.div ? 'inside' : 'outside'} the layer element` : 'nothing kept');
  env.deliver(env.tileAt(drogi, 0, 0));
  const panCentre = env.map.getCenter();
  const panStep = env.map.getResolution() * 700;
  env.map.setCenter(new env.OL.LonLat(panCentre.lon + panStep, panCentre.lat), env.map.getZoom());
  await env.sleep(120);
  const keptOnMap = drogi.backBuffer;
  report.check('an image kept through a pan sits inside the layer\'s own element',
    keptOnMap !== null && keptOnMap.parentNode === drogi.div,
    keptOnMap ? `parent ${keptOnMap.parentNode === drogi.div ? 'inside' : 'outside'} the layer element` : 'nothing kept');
  env.registry['Geoportal - drogi'].setVisibility(false);
  await env.sleep(60);
  report.check('hiding the layer leaves nothing of it on the map',
    drogi.backBuffer === null ||
    keptOnMap.parentNode === null || keptOnMap.parentNode === drogi.div,
    drogi.backBuffer === null ? 'the kept image was released'
      : `kept inside the hidden layer element: ${keptOnMap.parentNode === drogi.div}`);
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

  // OpenLayers keeps the picture of the view the layer was drawing while the next
  // one is on its way, and lets it go 2.5 s after the last cell arrived. Three
  // rules for it, one per way the view changes:
  //
  //  - a zoom rescales that picture to the new resolution and keeps it over the
  //    new view. It is not the layer's drawing any more, it is the old geometry
  //    and its labels at the size of the old zoom - the doubled, washed-out
  //    repeat of the parcels report. A zoom therefore starts from nothing.
  //  - a pan at the same zoom keeps it: still the right size, and it covers the
  //    map until the new image is delivered, a refused refresh included.
  //  - on a grid of cells it goes as soon as every cell is drawn, not 2.5 s later:
  //    over a service that refuses part of its answers those 2.5 s stretch into
  //    minutes in which the old and the new drawing stand on top of one another.
  const zooming = await boot({ enabled: 'all' });
  await zooming.drawAll();
  const parcels = zooming.layer('Geoportal - podział adm');   // one image of the view
  const road = zooming.layer('Geoportal - drogi');            // one image of the view
  zooming.tilesWithImage(parcels).forEach(tile => zooming.deliver(tile));
  zooming.deliver(zooming.tileAt(road, 0, 0));
  await zooming.setZoom(19);
  await zooming.sleep(120);
  report.check('a zoom does not carry the previous image of a one-image layer over the new view',
    parcels.backBuffer === null,
    parcels.backBuffer ? `${parcels.backBuffer.childNodes.length} old image(s) still drawn` : 'the new view starts empty');
  report.check('the same for the road layer',
    road.backBuffer === null,
    road.backBuffer ? `${road.backBuffer.childNodes.length} old image(s) still drawn` : 'the new view starts empty');
  report.check('and the new view is asked for straight away',
    zooming.requestsOf(parcels).length > 0 && zooming.requestsOf(road).length > 0,
    `${zooming.requestsOf(parcels).length} + ${zooming.requestsOf(road).length} requests of the new view`);

  // The parcels are one image of the view now, so the hold that keeps a delivered
  // image on the map through a refused refresh is what stands between a refusal and
  // an empty layer: the service that refused is asked again about a second later.
  const heldParcels = await boot({ enabled: 'all' });
  await heldParcels.drawAll();
  const parcelsHeld = heldParcels.layer('Geoportal - podział adm');
  const parcelsTile = heldParcels.tileAt(parcelsHeld, 0, 0);
  heldParcels.deliver(parcelsTile);
  const shown = plain(parcelsTile.imgDiv.src);
  await pan(heldParcels, 300);
  heldParcels.giveUp(parcelsTile);
  await heldParcels.sleep(60);
  const parcelsKept = parcelsHeld.backBuffer && parcelsHeld.backBuffer.querySelector('img');
  report.check('the parcels layer is one image of the view, and a refused refresh keeps it on the map',
    parcelsHeld.singleTile === true && parcelsHeld.ratio === 1 && Boolean(parcelsKept) &&
    plain(parcelsKept.src) === shown,
    parcelsKept ? 'the refused view is still covered by the delivered one' : 'the layer went empty');
  heldParcels.close();

  // A layer of cells at a zoom: OpenLayers rescales the previous view's container
  // to the new resolution and draws it over the new view; that is where the old
  // drawing - old geometry and old label positions - doubled what the new view
  // shows. Nothing of it may be carried over.
  const topo = zooming.layer('Geoportal - obiekty topograficzne');
  const topoCells = zooming.tilesWithImage(topo);
  report.check('a layer of cells was drawing before the zoom', topoCells.length > 0, `${topoCells.length} cells`);
  await zooming.setZoom(19);
  await zooming.sleep(150);
  report.check('a zoom does not carry the previous cells of the layer over the new view',
    topo.backBuffer === null,
    topo.backBuffer ? `${topo.backBuffer.childNodes.length} old cells still drawn` : 'the new view starts empty');

  // A pan at the same zoom: the picture the layer was showing stays while the new
  // image is fetched - and a refused refresh must not take it away.
  zooming.deliver(zooming.tileAt(road, 0, 0));
  const shownBefore = plain(zooming.tileAt(road, 0, 0).imgDiv.src);
  const centre = zooming.map.getCenter();
  const step = zooming.map.getResolution() * 700;
  zooming.map.setCenter(new zooming.OL.LonLat(centre.lon + step, centre.lat), zooming.map.getZoom());
  await zooming.sleep(120);
  const kept = road.backBuffer && road.backBuffer.querySelector('img');
  report.check('a pan keeps the picture the layer was showing, at the size it was drawn',
    Boolean(kept) && plain(kept.src) === shownBefore,
    kept ? 'the image of the previous view is on the map' : 'nothing kept');
  zooming.giveUp(zooming.tileAt(road, 0, 0));
  await zooming.sleep(50);
  report.check('a refused refresh of the new view does not take it away',
    road.backBuffer !== null && Boolean(road.backBuffer.querySelector('img')),
    road.backBuffer ? 'the delivered view is still on the map' : 'the map went empty');
  await zooming.sleep(1400); // the layer's own retry
  zooming.deliver(zooming.tileAt(road, 0, 0));
  await zooming.sleep(30);
  report.check('a delivered image lets it go',
    road.backBuffer === null || road.backBuffer.childNodes.length === 0,
    road.backBuffer ? 'still held' : 'released');
  zooming.close();

  // A layer of cells never carries a picture of the previous view through a pan -
  // OpenLayers builds that container for these layers only when the scale changes,
  // which is the case the report showed. A cell the service refuses is a hole with
  // the editor's base map behind it, and the rest of the grid is untouched.
  const gridded = await boot({ enabled: 'all' });
  await gridded.drawAll();
  const grid = gridded.layer('Geoportal - obiekty topograficzne');
  gridded.tilesWithImage(grid).forEach(tile => gridded.deliver(tile));
  const griddedCentre = gridded.map.getCenter();
  const griddedStep = gridded.map.getResolution() * 900;
  gridded.map.setCenter(new gridded.OL.LonLat(griddedCentre.lon + griddedStep, griddedCentre.lat), gridded.map.getZoom());
  await gridded.sleep(150);
  report.check('a pan of a layer of cells leaves no drawing of the previous view on the map',
    grid.backBuffer === null,
    grid.backBuffer ? `${grid.backBuffer.childNodes.length} old cells still drawn` : 'the new view is drawn on its own');
  const held = gridded.tilesWithImage(grid);
  gridded.giveUp(held[0]);
  held.slice(1).forEach(tile => gridded.deliver(tile));
  await gridded.sleep(50);
  report.check('a refused cell of the new view does not disturb the rest of the grid',
    gridded.tilesWithImage(grid).length === held.length,
    `${gridded.tilesWithImage(grid).length} of ${held.length} cells still have their image`);
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
