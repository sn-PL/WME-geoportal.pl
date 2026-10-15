'use strict';
/**
 * The two layers that come as tiles of the editor's own grid - the standard
 * orthophoto and the OSM base map. These are the layers whose behaviour the
 * report of round 18 called the stable one, so what makes them stable is checked
 * here: the indices are the grid's own, the tiles land where the indices say, and
 * above the last level the service's last tiles are stretched instead of the
 * layer disappearing.
 */
const { boot, params, slippyTile } = require('../lib/harness.cjs');
const { REFERENCE_POINTS } = require('../lib/fixtures.cjs');

const WORLD = 20037508.342789244;
const MERCATOR_WORLD_RESOLUTION = 156543.03392804097;

const TILE_LAYERS = {
  'Geoportal - ortofoto': {
    endpoint: 'PZGIK/ORTO/WMTS/StandardResolution',
    format: 'image/jpeg',
    layer: 'ORTOFOTOMAPA',
    matrixSet: 'EPSG:3857',
    matrixPrefix: 'EPSG:3857:'
  },
  'Geoportal - OSM': {
    endpoint: '/OSM/BaseMap/service',
    format: 'image/png',
    layer: 'osm_3857',
    matrixSet: 'GLOBAL_WEBMERCATOR',
    matrixPrefix: ''
  }
};

/** The cell of a z/x/y index, computed here and not by the layer. */
function cellOf(index) {
  const size = 2 * WORLD / Math.pow(2, index.zoom);
  return {
    left: -WORLD + index.x * size,
    top: WORLD - index.y * size,
    size
  };
}

/** The WGS84 point in the middle of a part of the map. */
const centreOf = env => {
  const centre = env.map.getCenter().clone().transform(new env.OL.Projection('EPSG:900913'), new env.OL.Projection('EPSG:4326'));
  return { lon: centre.lon, lat: centre.lat };
};

module.exports = async function tiles(report) {
  report.suite('the tile layers of the editor\'s own grid');

  const env = await boot({ enabled: 'all' });
  await env.drawAll();

  for (const [name, expected] of Object.entries(TILE_LAYERS)) {
    const layer = env.layer(name);
    const urls = env.requestsOf(layer);
    const query = params(urls[0] || '');

    report.check(`“${name}” is a tile layer of the editor's grid`,
      layer.CLASS_NAME === 'OpenLayers.Layer.XYZ' && layer.singleTile === false &&
      layer.tileSize.w === 256 && layer.tileSize.h === 256 && layer.alwaysInRange === true,
      `${layer.CLASS_NAME}, ${layer.tileSize.w} px, singleTile=${layer.singleTile}, alwaysInRange=${layer.alwaysInRange}`);

    report.check(`“${name}” steps its grid by the resolutions of the Web Mercator levels`,
      layer.resolutions.length === 20 &&
      layer.resolutions[0] === MERCATOR_WORLD_RESOLUTION &&
      layer.resolutions[18] === MERCATOR_WORLD_RESOLUTION / Math.pow(2, 18) &&
      layer.getServerResolution() === MERCATOR_WORLD_RESOLUTION / Math.pow(2, 18),
      `${layer.resolutions.length} levels, level 18 resolution ${layer.getServerResolution().toFixed(6)}`);

    report.check(`“${name}” asks the service for a tile by index, not by bounding box`,
      query.SERVICE === 'WMTS' && query.REQUEST === 'GetTile' && query.VERSION === '1.0.0' &&
      query.LAYER === expected.layer && query.STYLE === 'default' &&
      query.FORMAT === expected.format && query.TILEMATRIXSET === expected.matrixSet &&
      !('BBOX' in query) && !('WIDTH' in query),
      Object.entries(query).map(([key, value]) => `${key}=${value}`).join(' ').slice(0, 130));

    const indices = urls.map(url => {
      const match = params(url).TILEMATRIX.match(new RegExp(`^${expected.matrixPrefix}(\\d+)$`));
      return {
        zoom: match && Number(match[1]),
        y: Number(params(url).TILEROW),
        x: Number(params(url).TILECOL)
      };
    });
    report.check(`“${name}” names the level in the matrix the service publishes`,
      indices.every(index => Number.isInteger(index.zoom) && Number.isInteger(index.x) && Number.isInteger(index.y)) &&
      new Set(indices.map(index => index.zoom)).size === 1 &&
      indices.every(index => index.zoom === 18),
      `${urls.length} tiles, all at level ${indices[0] && indices[0].zoom}`);

    // The indices have to be the grid's own: recomputed here from the map centre.
    const centre = centreOf(env);
    const wanted = slippyTile(centre, 18);
    report.check(`“${name}” asks for the tile the grid puts under the view centre`,
      indices.some(index => index.x === wanted.x && index.y === wanted.y),
      `centre ${centre.lon.toFixed(5)}, ${centre.lat.toFixed(5)} → x=${wanted.x}, y=${wanted.y}; ` +
      `${indices.filter(index => index.x === wanted.x && index.y === wanted.y).length} such tile(s)`);

    // And the image has to be drawn in the cell of its indices, or the whole layer
    // would be shifted against the map.
    const drawn = env.tilesWithImage(layer).filter(tile => {
      const match = decodeURIComponent(String(tile.imgDiv.src)).match(/TILEROW=(\d+)&TILECOL=(\d+)$/);
      return match && tile.bounds;
    });
    const misplaced = drawn.filter(tile => {
      const match = decodeURIComponent(String(tile.imgDiv.src)).match(/TILEROW=(\d+)&TILECOL=(\d+)$/);
      const cell = cellOf({ zoom: 18, x: Number(match[2]), y: Number(match[1]) });
      return Math.abs(tile.bounds.left - cell.left) > 0.01 || Math.abs(tile.bounds.top - cell.top) > 0.01 ||
        Math.abs(tile.bounds.getWidth() - cell.size) > 0.01;
    });
    report.check(`“${name}” draws every tile in the cell its indices name`,
      drawn.length > 0 && misplaced.length === 0,
      `${drawn.length} tiles checked, ${misplaced.length} off the grid ` +
      `(cell ${cellOf({ zoom: 18, x: wanted.x, y: wanted.y }).size.toFixed(2)} m at level 18)`);

    report.check(`“${name}” asks for cells of the view instead of one big image`,
      urls.length >= 12 && urls.length <= 40 && urls.every(url => url.includes(expected.endpoint)),
      `${urls.length} requests for an 800x600 view`);
  }

  // Past the last level the service has, the layer keeps asking for that level and
  // OpenLayers stretches it - the layer must not vanish where the data still is.
  await env.setZoom(21);
  await env.waitFor(() => env.map.getZoom() === 21);
  for (const [name, expected] of Object.entries(TILE_LAYERS)) {
    const layer = env.layer(name);
    const level19 = MERCATOR_WORLD_RESOLUTION / Math.pow(2, 19);
    const url = layer.getURL(env.map.getExtent());
    const query = params(String(url));
    const centre = centreOf(env);
    const wanted = slippyTile(centre, 19);
    report.check(`“${name}” asks for level 19 while the map is at zoom 21`,
      String(layer.getServerResolution()) === String(level19) &&
      query.TILEMATRIX === `${expected.matrixPrefix}19`,
      `server resolution ${layer.getServerResolution().toFixed(6)} vs level 19 ${level19.toFixed(6)}, ` +
      `TILEMATRIX=${query.TILEMATRIX}`);
    report.check(`“${name}” stretches the level 19 tile the view centre falls in`,
      Number(query.TILECOL) === wanted.x && Number(query.TILEROW) === wanted.y,
      `asked col ${query.TILECOL}, row ${query.TILEROW}; the grid says ${wanted.x}, ${wanted.y}`);
  }
  await env.setZoom(18);
  await env.drawAll();

  // One refused tile is one hole: the neighbours keep their images and the layer
  // stays on the map - the difference from one refused image per view.
  const orto = env.layer('Geoportal - ortofoto');
  const tilesWithImage = env.tilesWithImage(orto);
  const hole = tilesWithImage[Math.floor(tilesWithImage.length / 2)];
  const before = tilesWithImage.length;
  const neighbour = tilesWithImage.find(tile => tile !== hole);
  env.giveUp(hole);
  report.check('a refused tile is marked as failed and stays a hole',
    env.isFailed(hole) && !env.isFailed(neighbour),
    `hole ${env.isFailed(hole)}, neighbour ${env.isFailed(neighbour)}`);
  report.check('the tiles around the hole stay on the map with their own addresses',
    env.tilesWithImage(orto).length === before &&
    env.tilesWithImage(orto).filter(tile => !env.isFailed(tile)).length === before - 1,
    `${before - 1} of ${before} tiles still drawn`);
  report.check('the layer itself is still visible with one tile missing',
    orto.getVisibility() === true && orto.div.parentNode !== null,
    `visibility=${orto.getVisibility()}`);

  report.check('the tile layers produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');
  report.check('the view centre of the harness is the crossing the reports are about',
    Math.abs(centreOf(env).lon - REFERENCE_POINTS.imbramowice.lon) < 0.001 &&
    Math.abs(centreOf(env).lat - REFERENCE_POINTS.imbramowice.lat) < 0.001,
    `${centreOf(env).lon.toFixed(5)}, ${centreOf(env).lat.toFixed(5)}`);

  env.close();
};
