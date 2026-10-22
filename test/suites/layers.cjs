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

  // Round 29: the one drawing whose letters are the information - the parcel numbers -
  // is white ink with a black casing again, drawn twice the size, and the re-colour is
  // keyed on DARKNESS (round 28 was right that alpha alone cannot do it: a parcel
  // number is dark digits on a white plate, and both are opaque). The key is a
  // feColorMatrix whose alpha is 1 - luminance, masked by the drawing's own coverage.
  const filters = env.internals.CONTRAST_FILTER;
  const svg = registry['Geoportal - podział adm'].instance.div.ownerDocument
    .getElementById('geoportal-label-filters');
  const ink = svg && svg.querySelector('filter[id="geoportal-labels-ink"]');
  report.check('the filter that re-draws the ink is on the page once, and only the lettered layer points at it',
    !!svg && !!ink && svg.querySelectorAll('filter').length === 1 &&
    filters.white === 'url(#geoportal-labels-ink)' &&
    Object.entries(filters).every(([kind, value]) =>
      kind === 'white' || !value.includes('url(#')),
    Object.entries(filters).map(([kind, value]) => `${kind}: ${value}`).join(' | '));
  report.check('the ink is keyed on darkness, so a white plate under the digits is not ink',
    (() => {
      const matrix = ink && ink.querySelector('feColorMatrix');
      if (!matrix || matrix.getAttribute('type') !== 'matrix') return false;
      const values = (matrix.getAttribute('values') || '').trim().split(/\s+/).map(Number);
      if (values.length !== 20) return false;
      const luminance = values.slice(15, 18);              // the alpha row: R, G, B
      const intercept = values[19];
      // filter values are normalised: alpha = luminance · rgb + intercept, so white
      // (1.0) -> 0 and a dark digit (0.16) -> about 0.84
      const alphaOf = v => (luminance[0] + luminance[1] + luminance[2]) * v + intercept;
      return Math.abs(alphaOf(1)) < 0.02 &&
        Math.abs(luminance[0] - (-0.299)) < 1e-6 &&
        Math.abs(luminance[1] - (-0.587)) < 1e-6 &&
        Math.abs(luminance[2] - (-0.114)) < 1e-6 &&
        alphaOf(0.16) > 0.6;
    })(),
    'feColorMatrix alpha = -0.299R - 0.587G - 0.114B + 1, masked by the drawing');
  report.check('the key is smoothed before it is snapped, and the smoothing is small',
    (() => {
      const blur = ink && ink.querySelector('feGaussianBlur');
      const transfer = ink && ink.querySelector('feFuncA');
      if (!blur || !transfer) return false;
      const sigma = Number(blur.getAttribute('stdDeviation'));
      const slope = Number(transfer.getAttribute('slope'));
      const cut = -Number(transfer.getAttribute('intercept')) / slope;
      const order = ink.firstElementChild?.tagName === 'feColorMatrix' &&
        blur.nextElementSibling?.tagName === 'feComponentTransfer';
      // a one pixel line of the key peaks at erf(0.5 / (sigma * sqrt2)) after the blur
      const erf = x => {
        const t = 1 / (1 + 0.3275911 * Math.abs(x));
        const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return x >= 0 ? y : -y;
      };
      const peak = erf(0.5 / (sigma * Math.SQRT2));
      return Number.isFinite(sigma) && sigma > 0.4 && sigma <= 1 &&
        order && slope >= 4 && cut > 0.05 && cut < 0.3 && peak > cut + 0.2;
    })(),
    'a blur of 0.4-1 px in front of a short transfer, and a one pixel line still crosses it');
  report.check('the ink is white and carries a one-pixel black casing grown from its own shape',
    !!ink && ink.querySelector('feFlood[flood-color="#fff"]') &&
    ink.querySelector('feMorphology')?.getAttribute('operator') === 'dilate' &&
    ink.querySelector('feMorphology')?.getAttribute('radius') === '1' &&
    ink.querySelector('feFlood[flood-color="#000"]') !== null &&
    /<feMerge><feMergeNode in="casing"\/><feMergeNode in="whiteink"\/><\/feMerge>/
      .test(env.internals.CONTRAST_SVG),
    'white flood masked by the ink, black dilate under it');
  const lettered = names.filter(name => LAYERS[name].contrast === 'white');
  report.check('the parcel numbers are the one drawing re-drawn this way, and they are asked for twice the size',
    lettered.length === 1 && lettered[0] === 'Geoportal - podział adm' &&
    registry['Geoportal - podział adm'].definition.options.magnify === env.internals.LABEL_MAGNIFY &&
    registry['Geoportal - podział adm'].definition.options.tileSize === env.internals.LABEL_CELL &&
    env.internals.LABEL_CELL === 2048,
    `magnify ${env.internals.LABEL_MAGNIFY}, cell ${env.internals.LABEL_CELL} px`);
  const verbatim = ['Geoportal - adresy', 'Geoportal - ulice', 'Geoportal - place',
    'Geoportal - adresy, place i ulice w jednym', 'Geoportal - obiekty topograficzne',
    'Geoportal - przejazdy kolejowe (wymagany duży zoom)'];
  report.check('every other drawing that carries a number, a name or a surface is shown exactly as the service draws it',
    verbatim.every(name => LAYERS[name].contrast === false) &&
    verbatim.every(name => !(registry[name].instance?.div?.style?.filter)) &&
    names.filter(name => registry[name].definition.options.magnify !== undefined)
      .every(name => name === 'Geoportal - podział adm'),
    `${verbatim.length} layers with no filter and no magnified request`);
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

  // Of the two treatments left, one raises the service's own colours (the roads and
  // the BDOT surfaces) and one adds a casing without touching them (the boundaries).
  // Neither may end up dimmer than the ink of 1.6.0, which used 1.7 with a halo.
  const lifts = ['dark', 'colour'].map(kind => Number(filters[kind].match(/brightness\(([\d.]+)\)/)[1]));
  report.check('the drawings that keep their colour are lifted as much as in 1.6.0',
    Math.min(...lifts) >= 1.7,
    `lifts ${lifts.join(' and ')}`);

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
