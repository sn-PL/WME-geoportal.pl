'use strict';
/**
 * The maths the script does on its own: the EPSG:2180 transformation it needs for
 * the services that draw in the national system, the BBOX it builds from a view,
 * the size cap on a view image and the zoom level derived from a request.
 *
 * These checks run without a browser page - they read the transformations the
 * script publishes on `window.__geoportalPl.internals` after a boot.
 */
const { boot } = require('../lib/harness.cjs');
const { REFERENCE_POINTS } = require('../lib/fixtures.cjs');
const reference = require('../lib/epsg2180.cjs');

module.exports = async function coordinates(report) {
  report.suite('coordinates and request arithmetic');

  const env = await boot({ enabled: [] });
  const internals = env.internals;

  report.check('the script publishes the transformations, the version and the tuned constants',
    typeof internals.to2180 === 'function' && typeof internals.bounds2180 === 'function' &&
    internals.VERSION === '1.6.0' && internals.MAX_VIEW_PIXELS === 1200000 &&
    Array.isArray(internals.IMAGE_RETRY_DELAYS) && internals.Z_INDEX_BASE === 2040,
    `version=${internals.VERSION}, retries=${JSON.stringify(internals.IMAGE_RETRY_DELAYS)}`);

  // EPSG:2180 against PROJ: the script's series has to land on the authority's
  // numbers, otherwise every request of the layers that ask in 2180 is shifted.
  const points = Object.entries(REFERENCE_POINTS);
  let worstForward = 0, worstName = '';
  for (const [name, point] of points) {
    const got = internals.to2180(point.lon, point.lat);
    const off = Math.hypot(got.easting - point.easting, got.northing - point.northing);
    if (off > worstForward) { worstForward = off; worstName = name; }
  }
  report.check('WGS84 → EPSG:2180 matches PROJ at every reference point within a millimetre',
    worstForward < 0.001,
    `worst ${(worstForward * 1000).toFixed(3)} mm (${worstName}) over ${points.length} points`);

  // And the other way round, against this repository's own implementation, over
  // points that are not in the fixture table at all.
  let worstRoundTrip = 0;
  for (let lon = 14; lon <= 24; lon += 0.25) {
    for (let lat = 49; lat <= 54.9; lat += 0.25) {
      const projected = internals.to2180(lon, lat);
      const back = reference.from2180(projected.easting, projected.northing);
      worstRoundTrip = Math.max(worstRoundTrip, reference.metresBetween(back, { lon, lat }));
    }
  }
  report.check('the transformation is invertible: a grid over Poland comes back to the same place',
    worstRoundTrip < 0.01,
    `worst round trip ${(worstRoundTrip * 1000).toFixed(3)} mm over ${(41 * 24)} points`);

  // A BBOX in EPSG:2180 is northing, easting, northing, easting - and it has to be
  // the view's own rectangle, not a swapped or mirrored one.
  const Bounds = env.OL.Bounds;
  const view = new Bounds(16.56, 50.96, 16.58, 50.98); // left, bottom, right, top in lon/lat
  const box = internals.bounds2180(view);
  const corners = [[16.56, 50.96], [16.56, 50.98], [16.58, 50.96], [16.58, 50.98]]
    .map(([lon, lat]) => internals.to2180(lon, lat));
  const expected = {
    minN: Math.min(...corners.map(c => c.northing)),
    maxN: Math.max(...corners.map(c => c.northing)),
    minE: Math.min(...corners.map(c => c.easting)),
    maxE: Math.max(...corners.map(c => c.easting))
  };
  report.check('an EPSG:2180 BBOX is northing, easting, northing, easting, ascending',
    box.length === 4 && box[0] < box[2] && box[1] < box[3],
    box.join(', '));
  report.check('the BBOX is the view\'s own rectangle to the centimetre',
    Math.abs(box[0] - expected.minN) <= 0.005 && Math.abs(box[2] - expected.maxN) <= 0.005 &&
    Math.abs(box[1] - expected.minE) <= 0.005 && Math.abs(box[3] - expected.maxE) <= 0.005,
    `script ${box.join(', ')} vs corners ${[expected.minN, expected.minE, expected.maxN, expected.maxE].map(v => v.toFixed(2)).join(', ')}`);

  // The reference point of the round-17 report has to fall inside a crossing-tile
  // request; a transposed BBOX would put it hundreds of kilometres away.
  const point = REFERENCE_POINTS.imbramowice;
  const tiny = new Bounds(point.lon - 0.001, point.lat - 0.001, point.lon + 0.001, point.lat + 0.001);
  const tinyBox = internals.bounds2180(tiny);
  report.check('a view at the Imbramowice crossing is inside Poland\'s 2180 numbers',
    tinyBox[0] > 100000 && tinyBox[0] < 900000 && tinyBox[1] > 100000 && tinyBox[1] < 900000 &&
    Math.abs(tinyBox[1] - point.easting) < 200 && Math.abs(tinyBox[0] - point.northing) < 200,
    `BBOX ${tinyBox.join(', ')} around E ${point.easting}, N ${point.northing}`);

  // The cap on a view image: a request past about a megapixel is refused by the
  // services, so the script shrinks it and stretches the answer over the view.
  const { wms } = { wms: env.integration.wms };
  const unchanged = wms.requestImageSize({ w: 1366, h: 878 });
  report.check('a view under the cap is asked for at its own size',
    unchanged.w === 1366 && unchanged.h === 878, `${unchanged.w}x${unchanged.h}`);

  const capped = wms.requestImageSize({ w: 2100, h: 1350 });
  report.check('a view past the cap is shrunk inside it',
    capped.w * capped.h <= 1200000, `${capped.w}x${capped.h} = ${capped.w * capped.h} px`);
  report.check('the shrunk request keeps the view\'s proportions',
    Math.abs(capped.w / capped.h - 2100 / 1350) < 0.01 &&
    Math.abs(capped.w / capped.h - 2100 / 1350) < 0.01,
    `asked ${(capped.w / capped.h).toFixed(4)}, view ${(2100 / 1350).toFixed(4)}`);

  const barelyOver = wms.requestImageSize({ w: 1400, h: 858 }); // 1 201 200 px, just past
  report.check('the cap is the only thing that shrinks a request',
    barelyOver.w * barelyOver.h <= 1200000 && barelyOver.w >= 1390,
    `${barelyOver.w}x${barelyOver.h} for 1400x858`);

  // The zoom level of a request: in async mode the SDK state lags behind, so the
  // level is derived from the resolution of the request itself.
  const zoomAt = (zoomLevel, zoomResolution, resolution) => {
    env.integration.wms.zoomLevel = zoomLevel;
    env.integration.wms.zoomResolution = zoomResolution;
    return env.integration.wms.zoomAt(resolution);
  };
  const base = 0.5972; // metres per pixel at zoom 18 in Web Mercator
  report.check('a request is placed at the SDK zoom level when the resolution matches',
    zoomAt(18, base, base) === 18, `zoomAt(${base}) = ${zoomAt(18, base, base)}`);
  report.check('a request one level in is placed one level up',
    zoomAt(18, base, base / 2) === 19 && zoomAt(18, base, base / 4) === 20,
    `${zoomAt(18, base, base / 2)}, ${zoomAt(18, base, base / 4)}`);
  report.check('a request one level out is placed one level down',
    zoomAt(18, base, base * 2) === 17 && zoomAt(18, base, base * 8) === 15,
    `${zoomAt(18, base, base * 2)}, ${zoomAt(18, base, base * 8)}`);
  report.check('without a known resolution the SDK zoom level is used as it is',
    zoomAt(16, null, base) === 16, `zoomAt with no resolution = ${zoomAt(16, null, base)}`);

  report.check('booting the script produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');

  env.close();
};
