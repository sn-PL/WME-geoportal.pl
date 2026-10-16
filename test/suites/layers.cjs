'use strict';
/**
 * The layer list itself: which layers the script builds, from which service, with
 * which parameters, when they are shown, at which opacity and with which filter.
 * These are the checks a rewrite has to keep passing - one row per layer.
 */
const { boot } = require('../lib/harness.cjs');
const { LAYERS, LAYER_ORDER, CATEGORIES, SERVICES } = require('../lib/fixtures.cjs');

module.exports = async function layers(report) {
  report.suite('the layer list and its definitions');

  const env = await boot({ enabled: 'all' });
  const registry = env.registry;
  const names = Object.keys(registry);

  report.check('every layer of the list exists, in the order the script defines them',
    names.join('|') === LAYER_ORDER.join('|'),
    `${names.length} layers; ${names.filter(name => !LAYER_ORDER.includes(name)).join(', ') || 'no extras'}` +
    (names.length === LAYER_ORDER.length ? '' : ` (expected ${LAYER_ORDER.length})`));

  for (const [name, expected] of Object.entries(LAYERS)) {
    const entry = registry[name];
    if (!entry) {
      report.check(`layer ${name} is built`, false, 'missing from the registry');
      continue;
    }
    const definition = entry.definition;
    const layer = entry.instance;
    const options = definition.options;
    const problems = [];
    if (!definition.url.includes(expected.service)) problems.push(`service ${definition.url}`);
    if (expected.kind === 'tiles') {
      if (layer && layer.CLASS_NAME !== 'OpenLayers.Layer.XYZ') problems.push(`class ${layer.CLASS_NAME}`);
      if (layer && layer.singleTile !== false) problems.push(`instance singleTile=${layer.singleTile}`);
    } else {
      if (definition.layers !== expected.layers) problems.push(`LAYERS=${definition.layers}`);
      if (definition.format !== expected.format) problems.push(`format ${definition.format}`);
      if (layer && layer.CLASS_NAME !== 'OpenLayers.Layer.WMS') problems.push(`class ${layer.CLASS_NAME}`);
      if (layer && layer.singleTile !== expected.singleTile) problems.push(`instance singleTile=${layer.singleTile}`);
      if (layer && layer.ratio !== expected.ratio) problems.push(`instance ratio=${layer.ratio}`);
      if ((options.crs ?? 'EPSG:4326') !== expected.crs) problems.push(`crs=${options.crs}`);
      if ((options.singleTile ?? true) !== expected.singleTile) problems.push(`singleTile=${options.singleTile}`);
      if ((options.ratio ?? 1.5) !== expected.ratio) problems.push(`ratio=${options.ratio}`);
    }
    if ((options.minZ ?? 0) !== expected.minZ) problems.push(`minZ=${options.minZ}`);
    if ((options.hasOpacity !== false) !== expected.hasOpacity) problems.push(`hasOpacity=${options.hasOpacity}`);
    if ((options.contrast ?? false) !== expected.contrast) problems.push(`contrast=${options.contrast}`);
    if (!layer) problems.push('no layer instance');
    report.check(`“${name}” is what the list says it is`, problems.length === 0, problems.join(', '));
  }

  // A layer belongs to exactly one category, and no layer is missing from the menu.
  const inCategories = Object.values(CATEGORIES).flat();
  report.check('every layer sits in exactly one category',
    inCategories.length === LAYER_ORDER.length &&
    new Set(inCategories).size === inCategories.length &&
    LAYER_ORDER.every(name => inCategories.includes(name)),
    `${inCategories.length} entries for ${LAYER_ORDER.length} layers`);

  // These services draw thin strokes and small labels, and the editor's imagery
  // swallows them: every such layer carries the same lifted filter, and no other
  // layer is filtered at all (a filter is expensive).
  const filtered = names.filter(name => {
    const filter = registry[name].instance?.div?.style?.filter || '';
    return filter.length > 0;
  });
  const expectedFiltered = Object.entries(LAYERS).filter(([, e]) => e.contrast).map(([name]) => name);
  report.check('exactly the thin-drawn overlays carry the contrast filter',
    filtered.length === expectedFiltered.length && expectedFiltered.every(name => filtered.includes(name)),
    `${filtered.length} layers of ${names.length}`);
  report.check('every one of the six boundary layers of the report was among them',
    ['Geoportal - podział adm', 'Geoportal - Miasta', 'Geoportal - gminy', 'Geoportal - powiaty',
      'Geoportal - województwa', 'Geoportal - Granica PL'].every(name => filtered.includes(name)),
    'parcels, towns, communes, counties, provinces, state border');
  report.check('each filtered layer carries the filter its ink asks for, and nothing else',
    filtered.every(name => {
      const filter = registry[name].instance.div.style.filter;
      return filter === env.internals.CONTRAST_FILTER[LAYERS[name].contrast];
    }),
    Object.entries(env.internals.CONTRAST_FILTER).map(([kind, value]) => `${kind}: ${value}`).join(' | '));

  // The drawings whose letters are the information are not filtered at all any
  // more: they are re-drawn. Every pixel's alpha is pushed to 0 or 1, which snaps
  // the service's grey, anti-aliased letters back onto the pixel grid, the letters
  // are made pure white on the way in, and a one-pixel casing is grown around each
  // of them - the letter's own edge, not a halo. That is an SVG filter, because no
  // CSS filter function can express either of those two operations, and it has to be
  // an element of the editor's page: the layer points at it by name.
  const filters = env.internals.CONTRAST_FILTER;
  const svg = registry['Geoportal - podział adm'].instance.div.ownerDocument
    .getElementById('geoportal-label-filters');
  const filterElement = id => svg && svg.querySelector(`filter[id="${id}"]`);
  const ink = filterElement('geoportal-labels-ink');
  report.check('the filter that re-draws the ink is on the page, once',
    !!svg && !!ink && (svg.querySelectorAll('filter').length === 1) &&
    Object.values(filters).every(filter => !filter.includes('url(#') ||
      filter.includes('url(#geoportal-labels-ink)')),
    svg ? `${svg.querySelectorAll('filter').length} filter, pointed at by ${Object.values(filters).filter(f => f.includes('url(#')).length} layers` : 'no filter on the page');
  report.check('every edge is snapped back onto the pixel grid, nothing is left half lit',
    (() => {
      const transfer = ink && ink.querySelector('feFuncA');
      return transfer && transfer.getAttribute('type') === 'linear' &&
        Number(transfer.getAttribute('slope')) >= 10;
    })(),
    'alpha * slope + intercept with a steep slope, i.e. every pixel is ink or it is not');
  // Round 26: the threshold alone left the staircases of the doubled raster in the
  // letter's contour (every edge of the service's pixel is two screen pixels of step).
  // A small blur in front of the threshold turns those steps into ramps, and the
  // threshold puts the colour back onto one line of a ramp - a smooth contour with a
  // hard edge. It has to be small: the drawing's own one pixel lines must survive it.
  report.check('the contour is smoothed before it is snapped, and the smoothing is small',
    (() => {
      const blurs = ink ? [...ink.querySelectorAll('feGaussianBlur, feDropShadow')] : [];
      if (blurs.length !== 1) return false;
      const sigma = Number(blurs[0].getAttribute('stdDeviation'));
      const first = ink.firstElementChild;
      const order = first === blurs[0] && blurs[0].nextElementSibling?.tagName === 'feComponentTransfer';
      return Number.isFinite(sigma) && sigma > 0.4 && sigma <= 1 && order;
    })(),
    'one feGaussianBlur of 0.4-1 px in front of the transfer: the step of one raster pixel becomes a ramp');
  report.check('the letters carry a one-pixel casing grown from their own shape',
    !!ink && ink.querySelector('feMorphology')?.getAttribute('operator') === 'dilate' &&
    ink.querySelector('feMorphology')?.getAttribute('radius') === '1' &&
    ink.querySelector('feFlood')?.getAttribute('flood-color') === '#000' &&
    Object.values(filters).every(filter =>
      [...filter.matchAll(/drop-shadow\(0 0 ([\d.]+)px/g)].every(match => Number(match[1]) <= 1)),
    'dilate one pixel, flood black, composite under the ink');
  report.check('the smoothing is a smoothing: a one pixel line of the drawing survives it',
    (() => {
      if (!ink) return false;
      const sigma = Number(ink.querySelector('feGaussianBlur')?.getAttribute('stdDeviation'));
      const transfer = ink.querySelector('feFuncA');
      const slope = Number(transfer?.getAttribute('slope'));
      const intercept = Number(transfer?.getAttribute('intercept'));
      const cut = -intercept / slope;                       // where the transfer turns ink on
      // The peak of a one pixel wide line after a gaussian of sigma [screen px], the
      // line being two screen pixels wide because of LABEL_MAGNIFY.
      const erf = x => {                                     // Abramowitz-Stegun 7.1.26
        const t = 1 / (1 + 0.3275911 * Math.abs(x));
        const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return x >= 0 ? y : -y;
      };
      const peak = erf(1 / (sigma * Math.SQRT2));
      return peak > cut + 0.05;
    })(),
    'the blurred centre of a line stays above the threshold the transfer turns on at');
  const lettered = names.filter(name => LAYERS[name].contrast === 'white');
  report.check('every drawing that is strokes and points is white ink with a black outline',
    /^brightness\(0\) invert\(1\) url\(#geoportal-labels-ink\)$/.test(filters.white) &&
    lettered.length === 7 &&
    ['Geoportal - podział adm', 'Geoportal - obiekty topograficzne', 'Geoportal - adresy',
      'Geoportal - ulice', 'Geoportal - place', 'Geoportal - adresy, place i ulice w jednym',
      'Geoportal - przejazdy kolejowe (wymagany duży zoom)']
      .every(name => LAYERS[name].contrast === 'white'),
    `${lettered.length} layers: parcels, topographic objects, addresses, streets, places, crossings`);
  // The five boundary layers draw translucent coloured areas along with their names,
  // so they cannot be made white without painting those areas over the map as white
  // slabs. Their names come from the service as a very pale letter on a slightly
  // paler plate of its own (measured: 230, 217, 231 against 250, 248, 251), so they
  // are pulled apart with contrast instead of being lifted into the same white, and
  // they take the same one pixel of black outline as every other layer.
  report.check('the layers that draw coloured areas keep their ink and only gain the black outline',
    filters.outline === 'drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)' &&
    ['Geoportal - Miasta', 'Geoportal - gminy', 'Geoportal - powiaty', 'Geoportal - województwa',
      'Geoportal - Granica PL'].every(name => LAYERS[name].contrast === 'outline') &&
    Object.entries(LAYERS).filter(([, entry]) => entry.contrast === 'outline').length === 5,
    filters.outline);
  report.check('nothing of those layers is recoloured, brightened or thresholded',
    !filters.outline.includes('invert') && !filters.outline.includes('brightness') &&
    !filters.outline.includes('url(#') && !filters.outline.includes('#fff'),
    'the coloured areas, the boundary lines and the pale lettering stay what the service drew');
  report.check('only the drawings whose colour is the map itself keep a white casing',
    LAYERS['Geoportal - drogi'].contrast === 'dark' &&
    Object.entries(LAYERS).filter(([, entry]) => entry.contrast === 'colour').length === 8 &&
    filters.dark.includes('#fff') && filters.colour.includes('#fff'),
    'the road classes and the BDOT surfaces');

  // A magnified drawing - the layer asks for the same area at half the pixels and the
  // browser stretches it back over the place - is the only lever that makes a
  // service's letters bigger, and it is used for exactly the drawings whose letters
  // are the information. Every other layer is asked for the pixels it is drawn with.
  const magnified = names.filter(name => registry[name].definition.options.magnify !== undefined);
  report.check('every drawing whose letters are the information asks for half the pixels',
    magnified.length === 12 &&
    magnified.every(name => registry[name].definition.options.magnify === env.internals.LABEL_MAGNIFY) &&
    magnified.every(name => LAYERS[name].contrast === 'white' || LAYERS[name].contrast === 'outline'),
    `${magnified.length} layers, all at twice the size`);
  report.check('no other layer is drawn at a size other than its own',
    names.filter(name => registry[name].definition.options.magnify === undefined ||
      registry[name].definition.options.magnify === 1).length === names.length - 12,
    'the ortho, the roads, the BDOT surfaces and the thematic maps');

  // Of the four ways a drawing is made to read over the imagery, two lift the ink the
  // service drew (the road network and the BDOT surfaces), one whitens it outright
  // (the drawings whose letters are the information) and one only raises the service's
  // own colours (the names it draws white itself). None of them may end up dimmer
  // than the ink of 1.6.0, which used 1.7 with a single 1.5 px halo.
  const lifts = ['dark', 'colour'].map(kind => Number(filters[kind].match(/brightness\(([\d.]+)\)/)[1]));
  report.check('the drawings that keep their colour are lifted as much as in 1.6.0',
    Math.min(...lifts) >= 1.7 && filters.white.startsWith('brightness(0) invert(1)'),
    `lifts ${lifts.join(' and ')}; the letters of the rest are made white outright`);

  // Opacity: a layer without a slider always draws at full opacity, whatever an
  // older version left in the settings.
  const opacityStale = await boot({
    enabled: 'all',
    settings: { layerOpacity: Object.fromEntries(LAYER_ORDER.map(name => [name, 0.25])) }
  });
  const dimmed = LAYER_ORDER.filter(name => {
    const entry = opacityStale.registry[name];
    return !entry.hasOpacity && entry.instance && entry.instance.opacity !== 1;
  });
  report.check('a slider-less layer cannot be dimmed by a stale saved opacity',
    dimmed.length === 0, dimmed.join(', ') || 'all pinned to 1.0');
  const allowed = ['Geoportal - ortofoto', 'Geoportal - ortofoto high res', 'Geoportal - OSM'];
  const withSliders = LAYER_ORDER.filter(name => opacityStale.registry[name].hasOpacity);
  report.check('opacity sliders exist only for the three layers that cover the view',
    withSliders.length === allowed.length && allowed.every(name => withSliders.includes(name)),
    withSliders.map(name => name.replace('Geoportal - ', '')).join(', '));
  opacityStale.close();

  // Zoom gates: a layer is shown from its own first zoom and hidden below it.
  const gates = [...new Set(LAYER_ORDER.map(name => LAYERS[name].minZ))].filter(minZ => minZ > 0).sort((a, b) => a - b);
  for (const gate of gates) {
    await env.setZoom(gate - 1);
    const early = LAYER_ORDER.filter(name => LAYERS[name].minZ === gate)
      .filter(name => env.registry[name].instance?.getVisibility() !== false);
    await env.setZoom(gate);
    const late = LAYER_ORDER.filter(name => LAYERS[name].minZ === gate)
      .filter(name => env.registry[name].instance?.getVisibility() !== true);
    report.check(`the layers from zoom ${gate} are hidden at ${gate - 1} and shown at ${gate}`,
      early.length === 0 && late.length === 0,
      (early.concat(late).map(name => name.replace('Geoportal - ', '')).join(', ')) ||
      `${LAYER_ORDER.filter(name => LAYERS[name].minZ === gate).length} layers`);
  }
  await env.setZoom(18);

  // z-index: the enabled layers are stacked upwards from 2040, in list order.
  env.integration.fixZIndex();
  const stacked = LAYER_ORDER
    .filter(name => env.registry[name].instance && env.registry[name].isEnabled)
    .map(name => ({ name, z: Number(env.registry[name].instance.getZIndex()) }));
  report.check('the layers are stacked upwards from z-index 2040, in list order',
    stacked.length > 0 &&
    stacked.every((entry, index, all) => index === 0
      ? entry.z === env.internals.Z_INDEX_BASE
      : entry.z === all[index - 1].z + 1),
    stacked.slice(0, 3).map(entry => `${entry.name.replace('Geoportal - ', '')}=${entry.z}`).join(', ') +
    ` … ${stacked.length} layers`);

  // Nothing is built for a layer the user has not switched on.
  const idle = await boot({ enabled: [] });
  const builtWhileOff = LAYER_ORDER.filter(name => idle.registry[name].instance);
  report.check('a layer that is switched off is not created',
    builtWhileOff.length === 0, builtWhileOff.join(', ') || 'none of ' + LAYER_ORDER.length);
  idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].setVisibility(true);
  report.check('switching a layer on creates it (and switching it off hides it)',
    Boolean(idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].instance) &&
    idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].instance.getVisibility() === true,
    String(idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].instance?.getVisibility()));
  idle.close();

  // The OSM base map is rank-gated: a level-1 editor gets it, a fresh account does not.
  const basic = await boot({ enabled: 'all', rank: 0 });
  report.check('the OSM base map is only offered to editors who may use it',
    !basic.registry['Geoportal - OSM'] && Object.keys(basic.registry).length === LAYER_ORDER.length - 1,
    `${Object.keys(basic.registry).length} layers at rank 0`);
  report.check('the rest of the list does not depend on the rank',
    LAYER_ORDER.filter(name => name !== 'Geoportal - OSM')
      .every(name => Boolean(basic.registry[name])),
    'all others present at rank 0');
  basic.close();

  report.check('a full boot produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');
  report.check('no layer points at a service that is not one of the Geoportal addresses',
    LAYER_ORDER.every(name => Object.values(SERVICES).some(service => env.registry[name].definition.url.includes(service))),
    [...new Set(LAYER_ORDER.map(name => new URL(env.registry[name].definition.url).host))].join(', '));

  env.close();
};
